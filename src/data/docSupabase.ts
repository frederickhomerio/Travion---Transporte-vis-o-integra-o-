// Documentação / Apoio Operacional no Supabase: tabelas com RLS, funções da migração 1610 e bucket privado "documentacao".

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnexoDoc, LoteErp, MensagemDoc, NotificacaoApp, SolicitacaoDoc } from '../types';
import type { ApiDoc, ResultadoDoc } from './api';

const BUCKET = 'documentacao';
/** Concluídas e canceladas ficam na fila por 30 dias; as abertas, sempre. */
const DIAS_CONCLUIDAS = 30;

type Res<T> = { data: T | null; error: { message: string } | null };
function ok<T>(r: Res<T>): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

const COM_NFS = '*, doc_anexos(nome, categoria)';
type ComAnexos = SolicitacaoDoc & { doc_anexos?: Array<{ nome: string; categoria: string }> };
const comNomes = ({ doc_anexos, ...s }: ComAnexos): SolicitacaoDoc =>
  ({ ...s, nomes_nf: (doc_anexos ?? []).filter((a) => a.categoria === 'nf' || a.categoria === 'correcao').map((a) => a.nome) });

/** Nome seguro para o caminho no Storage (o nome original fica no cadastro do anexo). */
function nomeArquivo(nome: string) {
  const ext = (nome.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '').toLowerCase();
  return `${crypto.randomUUID()}${ext}`;
}

export function criarDocSupabase(sb: SupabaseClient, rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<T>): ApiDoc {
  const uid = async () => {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('Sua sessão expirou. Entre novamente.');
    return id;
  };

  return {
    async listar(desde) {
      let q = sb.from('solicitacoes_doc').select(COM_NFS).order('enviado_em', { ascending: false }).limit(2000);
      let ql = sb.from('lotes_erp').select('*').limit(5000);
      if (desde) {
        q = q.gte('atualizado_em', desde);
        ql = ql.gte('atualizado_em', desde);
      } else {
        const corte = new Date(Date.now() - DIAS_CONCLUIDAS * 86400e3).toISOString();
        q = q.or(`status.in.(enviado,em_atendimento,aguardando_informacao),atualizado_em.gte.${corte}`);
      }
      const [s, l] = await Promise.all([q, ql]);
      return { solicitacoes: (ok(s) as ComAnexos[]).map(comNomes), lotes: ok(l) as LoteErp[] };
    },
    async listarDoEmbarque(embarqueId) {
      const [s, l] = await Promise.all([
        sb.from('solicitacoes_doc').select(COM_NFS).eq('embarque_id', embarqueId).order('numero', { ascending: false }),
        sb.from('lotes_erp').select('*').eq('embarque_id', embarqueId),
      ]);
      return { solicitacoes: (ok(s) as ComAnexos[]).map(comNomes), lotes: ok(l) as LoteErp[] };
    },
    async detalhe(id) {
      const s = ok(await sb.from('solicitacoes_doc').select('id,tipo,lote_id').eq('id', id).maybeSingle()) as Pick<SolicitacaoDoc, 'id' | 'tipo' | 'lote_id'> | null;
      if (!s) throw new Error('Solicitação não encontrada ou fora do seu escopo.');
      let origem: string | null = null;
      if (s.tipo === 'emissao' && s.lote_id) {
        const l = ok(await sb.from('lotes_erp').select('solicitacao_id').eq('id', s.lote_id).maybeSingle()) as { solicitacao_id: string | null } | null;
        origem = l?.solicitacao_id ?? null;
      }
      const [m, a, ev] = await Promise.all([
        sb.from('doc_mensagens').select('*').eq('solicitacao_id', id).order('criado_em'),
        sb.from('doc_anexos').select('*').eq('solicitacao_id', id).order('enviado_em'),
        origem ? sb.from('doc_anexos').select('*').eq('solicitacao_id', origem).eq('categoria', 'evidencia_frete').order('enviado_em')
          : Promise.resolve({ data: [], error: null }),
      ]);
      return { mensagens: ok(m) as MensagemDoc[], anexos: [...(ok(a) as AnexoDoc[]), ...(ok(ev) as AnexoDoc[])] };
    },
    async enviarArquivo(arquivo) {
      const caminho = `envios/${await uid()}/${nomeArquivo(arquivo.name)}`;
      const r = await sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (r.error) throw new Error(/mime|type/i.test(r.error.message) ? 'Tipo de arquivo não aceito (use PDF, PNG, JPG ou WEBP).'
        : /size|large/i.test(r.error.message) ? 'Arquivo maior que 15 MB.' : r.error.message);
      return { caminho, nome: arquivo.name };
    },
    async baixar(caminho) {
      const r = await sb.storage.from(BUCKET).download(caminho);
      if (r.error || !r.data) throw new Error('Não foi possível abrir o arquivo (sem acesso ou indisponível).');
      return r.data;
    },
    criar: (embarqueId, dados, anexos) => rpc<ResultadoDoc>('criar_solicitacao_doc', { p_embarque_id: embarqueId, p_dados: dados, p_anexos: anexos }),
    assumir: (id) => rpc<ResultadoDoc>('assumir_solicitacao_doc', { p_id: id }),
    registrarLote: (id, numero) => rpc<ResultadoDoc>('registrar_lote_doc', { p_id: id, p_numero: numero }),
    solicitarAjuste: (id, texto, referencia) => rpc<ResultadoDoc>('solicitar_ajuste_doc', { p_id: id, p_texto: texto, p_referencia: referencia }),
    responder: (id, texto, anexos) => rpc<ResultadoDoc>('responder_ajuste_doc', { p_id: id, p_texto: texto, p_anexos: anexos }),
    anexarEmitidos: (id, anexos) => rpc<ResultadoDoc>('anexar_documentos_doc', { p_id: id, p_anexos: anexos }),
    concluir: (id) => rpc<ResultadoDoc>('concluir_solicitacao_doc', { p_id: id }),
    cancelar: (id, motivo) => rpc<ResultadoDoc>('cancelar_solicitacao_doc', { p_id: id, p_motivo: motivo }),
    async notificacoes() {
      return ok(await sb.from('notificacoes').select('*').order('criada_em', { ascending: false }).limit(100)) as NotificacaoApp[];
    },
    async marcarLidas(ids) { await rpc('marcar_notificacoes_lidas', { p_ids: ids }); },
    assinar(aoEvento, aoEstado) {
      const canal = sb.channel(`travion-doc-${Math.random().toString(36).slice(2)}`);
      canal.on('postgres_changes', { event: '*', schema: 'public', table: 'solicitacoes_doc' }, (p) =>
        aoEvento({ tabela: 'solicitacoes', id: (p.new as { id?: string })?.id }));
      canal.on('postgres_changes', { event: '*', schema: 'public', table: 'lotes_erp' }, () => aoEvento({ tabela: 'lotes' }));
      canal.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doc_mensagens' }, (p) =>
        aoEvento({ tabela: 'detalhe', id: (p.new as { solicitacao_id?: string })?.solicitacao_id }));
      canal.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doc_anexos' }, (p) =>
        aoEvento({ tabela: 'detalhe', id: (p.new as { solicitacao_id?: string })?.solicitacao_id }));
      canal.on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes' }, () => aoEvento({ tabela: 'notificacoes' }));
      canal.subscribe((status) => aoEstado(status === 'SUBSCRIBED'));
      return () => { void sb.removeChannel(canal); };
    },
  };
}
