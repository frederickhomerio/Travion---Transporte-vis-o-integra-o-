import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Cadastros } from '../lib/cadastros';
import { consultarCnpjBrasilApi } from '../lib/cnpj';
import { CONFIG_PADRAO, type Configuracoes, type DadosCnpj, type Perfil, type Permissao, type Sessao } from '../types';
import type { Api, CotacaoCna, EstadoConexao, EventoTempoReal, LogoCandidata } from './api';

const COLUNAS_EMBARQUE =
  'id,codigo,cliente_id,comercial_id,filial_id,produto_id,origem_cidade,origem_uf,local_coleta_id,destino_cidade,destino_uf,' +
  'local_entrega_id,status_liberacao,data_liberacao,cadencia_valor,cadencia_unidade,toneladas_por_veiculo,observacao_interna,' +
  'situacao,is_demo,chave_importacao,versao,atualizado_em,atualizado_por_nome,suspenso_em,encerrado_em,encerrado_por_nome,encerrado_motivo';

const COLUNAS_CLIENTE =
  'id,nome,documento,comercial_id,restricao_comercial,ativo,is_demo,razao_social,inscricao_estadual,situacao_cadastral,' +
  'atividade_principal,logradouro,numero,complemento,bairro,municipio,uf,cep,email,telefone_cadastro,telefone_comercial,' +
  'telefone_financeiro,logo_url,dados_consultados_em';

type Res<T> = { data: T | null; error: { message: string } | null };

function ok<T>(r: Res<T>): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Lê todas as páginas (o PostgREST limita a 1.000 linhas por requisição). */
async function todos<T>(consulta: (de: number, ate: number) => PromiseLike<Res<T[]>>): Promise<T[]> {
  const tam = 1000;
  const saida: T[] = [];
  for (let de = 0; ; de += tam) {
    const lote = ok(await consulta(de, de + tam - 1)) ?? [];
    saida.push(...lote);
    if (lote.length < tam) return saida;
  }
}

export function criarSupabaseApi(url: string, chaveAnon: string): Api {
  const sb: SupabaseClient = createClient(url, chaveAnon, {
    // PKCE: o retorno dos links de e-mail vem em ?code=..., sem conflitar com as rotas em #/
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => ok(await sb.rpc(fn, args)) as T;

  const api: Api = {
    modo: 'supabase',

    async sessaoAtual() {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return null;
      const perfil = ok(await sb.from('perfis').select('id,nome,email,papel,status,comercial_id,criado_em').eq('id', uid).maybeSingle()) as Perfil | null;
      if (!perfil) return null;
      const [catalogo, papel, proprias, filiais] = await Promise.all([
        sb.from('permissoes').select('chave'),
        sb.from('papel_permissoes').select('chave').eq('papel', perfil.papel),
        sb.from('perfil_permissoes').select('chave,permitido').eq('perfil_id', uid),
        sb.from('perfil_filiais').select('filial_id').eq('perfil_id', uid),
      ]);
      const permissoes = new Set<Permissao>();
      if (perfil.status === 'ativo') {
        if (perfil.papel === 'administrador') {
          for (const p of ok(catalogo) ?? []) permissoes.add(p.chave as Permissao);
        } else {
          for (const p of ok(papel) ?? []) permissoes.add(p.chave as Permissao);
          for (const p of ok(proprias) ?? []) {
            if (p.permitido) permissoes.add(p.chave as Permissao);
            else permissoes.delete(p.chave as Permissao);
          }
        }
      }
      return { perfil, permissoes, filiais: (ok(filiais) ?? []).map((f) => f.filial_id) } as Sessao;
    },

    async entrar(email, senha) {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw new Error(error.message);
    },
    async cadastrar(nome, email, senha) {
      const { data, error } = await sb.auth.signUp({
        email, password: senha,
        options: { data: { nome }, emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw new Error(error.message);
      return { confirmarEmail: !data.session };
    },
    async recuperarSenha(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw new Error(error.message);
    },
    async definirNovaSenha(senha) {
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) throw new Error(error.message);
    },
    async sair() {
      await sb.auth.signOut();
    },
    aoMudarAutenticacao(cb) {
      const { data } = sb.auth.onAuthStateChange((evento) => cb(evento));
      return () => data.subscription.unsubscribe();
    },

    async carregarCadastros(demo) {
      const [filiais, comerciais, clientes, produtos, locais, cidades, centros_custo] = await Promise.all([
        todos((a, b) => sb.from('filiais').select('id,nome,codigo,supervisor,centro_custo_id,ativo,is_demo').eq('is_demo', demo).order('nome').range(a, b)),
        todos((a, b) => sb.from('comerciais').select('id,nome,email,telefone,ativo,is_demo').eq('is_demo', demo).order('nome').range(a, b)),
        todos((a, b) => sb.from('clientes').select(COLUNAS_CLIENTE).eq('is_demo', demo).order('nome').range(a, b)),
        todos((a, b) => sb.from('produtos').select('id,nome,valor_pauta_kg,valor_pauta_data,cna_produto,preco_fonte,ativo,is_demo').eq('is_demo', demo).order('nome').range(a, b)),
        todos((a, b) => sb.from('locais').select('id,nome,cidade,uf,tipo,link_mapa,ativo,is_demo').eq('is_demo', demo).order('nome').range(a, b)),
        todos((a, b) => sb.from('cidades').select('id,nome,uf,uso,ativo,is_demo').eq('is_demo', demo).order('nome').range(a, b)),
        todos((a, b) => sb.from('centros_custo').select('id,nome,ativo,is_demo').eq('is_demo', demo).order('nome').range(a, b)),
      ]);
      return { filiais, comerciais, clientes, produtos, locais, cidades, centros_custo } as unknown as Cadastros;
    },

    async carregarConfiguracoes() {
      const linhas = ok(await sb.from('configuracoes').select('chave,valor')) ?? [];
      const cfg: Configuracoes = { ...CONFIG_PADRAO };
      for (const l of linhas) (cfg as unknown as Record<string, unknown>)[l.chave] = l.valor;
      return cfg;
    },

    async carregarEmbarques(demo) {
      return todos((a, b) => sb.from('embarques').select(COLUNAS_EMBARQUE).eq('is_demo', demo).order('codigo').range(a, b)) as never;
    },
    async carregarPosicoes(demo, inicio, fim) {
      return todos((a, b) => sb.from('posicoes_diarias').select('*').eq('is_demo', demo)
        .gte('data_operacional', inicio).lte('data_operacional', fim).order('data_operacional').order('id').range(a, b)) as never;
    },
    async carregarFinanceiro(demo) {
      return todos((a, b) => sb.from('embarque_financeiro').select('*, embarques!inner(is_demo)').eq('embarques.is_demo', demo).range(a, b))
        .then((ls) => ls.map((l) => { const { embarques: _e, ...f } = l as Record<string, unknown>; void _e; return f; })) as never;
    },
    async carregarHistorico(embarqueId) {
      return ok(await sb.from('historico_alteracoes').select('*').eq('embarque_id', embarqueId)
        .order('alterado_em', { ascending: false }).limit(300)) as never;
    },
    async carregarMeta(demo, data) {
      return ok(await sb.from('metas_diarias').select('*').eq('is_demo', demo).eq('data_operacional', data).maybeSingle()) as never;
    },
    async ultimaDataComPosicao(demo, antesDe) {
      const r = ok(await sb.from('posicoes_diarias').select('data_operacional').eq('is_demo', demo)
        .lt('data_operacional', antesDe).order('data_operacional', { ascending: false }).limit(1)) ?? [];
      return r[0]?.data_operacional ?? null;
    },
    async dadosOrigem(embarqueId) {
      const r = ok(await sb.from('embarque_dados_origem').select('dados').eq('embarque_id', embarqueId).maybeSingle()) as { dados: unknown } | null;
      return (r?.dados as Record<string, unknown>) ?? null;
    },

    atualizarPosicao: (id, alteracoes, base, forcar = false) =>
      rpc('atualizar_posicao', { p_posicao_id: id, p_alteracoes: alteracoes, p_base: base, p_forcar: forcar }),
    confirmarPosicao: (id, valores, base) =>
      rpc('confirmar_posicao', { p_posicao_id: id, p_valores: valores, p_base: base }),
    agoraServidor: () => rpc<string>('agora_servidor', {}),
    atualizarEmbarque: (id, alteracoes, base, forcar = false) =>
      rpc('atualizar_embarque', { p_embarque_id: id, p_alteracoes: alteracoes, p_base: base, p_forcar: forcar }),
    async encerrarEmbarque(id, motivo) {
      const r = await rpc<{ registro: never }>('encerrar_embarque', { p_embarque_id: id, p_motivo: motivo });
      return r.registro;
    },
    atualizarFinanceiro: (id, alteracoes, base, forcar = false) =>
      rpc('atualizar_financeiro', { p_embarque_id: id, p_alteracoes: alteracoes, p_base: base, p_forcar: forcar }),
    async criarEmbarque(dados, demo) {
      const r = await rpc<{ registro: never }>('criar_embarque', { p_dados: dados, p_is_demo: demo });
      return r.registro;
    },
    abrirPosicoes: (data, transportar, ids, demo) =>
      rpc('abrir_posicoes', { p_data: data, p_transportar_saldos: transportar, p_embarque_ids: ids, p_is_demo: demo }),
    salvarCadastro: (tipo, id, dados, demo) => rpc('salvar_cadastro', { p_tipo: tipo, p_id: id, p_dados: dados, p_is_demo: demo }),
    obterLocal: (nome, cidade, uf, tipo, demo) =>
      rpc('obter_local', { p_nome: nome, p_cidade: cidade, p_uf: uf, p_tipo: tipo, p_is_demo: demo }),
    obterCidade: (nome, uf, demo) => rpc('obter_cidade', { p_nome: nome, p_uf: uf, p_is_demo: demo }),
    async buscarLogos(site, nome) {
      const { data, error } = await sb.functions.invoke('buscar-logo', { body: { site, nome } });
      if (!error) return (data as { candidatas: LogoCandidata[] }).candidatas;
      const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
      throw new Error(corpo?.erro ?? 'A busca de logo não respondeu. Tente de novo ou envie a imagem.');
    },
    async precoCna(produto) {
      const { data, error } = await sb.functions.invoke('preco-cna', { body: { produto } });
      if (!error) return data as { produtos: string[]; cotacoes: CotacaoCna[] };
      const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
      throw new Error(corpo?.erro ?? 'A consulta de preços da CNA não respondeu. Tente de novo.');
    },
    async consultarCnpj(cnpj) {
      const { data, error } = await sb.functions.invoke('consulta-cnpj', { body: { cnpj } });
      if (!error) return data as DadosCnpj;
      // Resposta de erro da função (ex.: CNPJ inexistente) traz a mensagem no corpo.
      const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
      if (corpo?.erro && (error as { context?: Response }).context?.status === 404) throw new Error(corpo.erro);
      // Função indisponível: tenta direto na base pública (sem inscrição estadual).
      return consultarCnpjBrasilApi(cnpj);
    },
    salvarConfiguracao: (chave, valor) => rpc('salvar_configuracao', { p_chave: chave, p_valor: valor }),
    salvarMeta: (m) => rpc('salvar_meta_diaria', {
      p_data: m.data_operacional, p_is_demo: m.is_demo, p_meta_faturamento: m.meta_faturamento,
      p_meta_margem: m.meta_margem, p_meta_volume_t: m.meta_volume_t, p_observacao: m.observacao,
    }),

    async listarLinks(clienteId) {
      return ok(await sb.from('links_cliente')
        .select('id,cliente_id,token_prefixo,descricao,mostrar_carregados,mostrar_volumes,expira_em,revogado_em,ultimo_acesso_em,acessos,criado_em')
        .eq('cliente_id', clienteId).order('criado_em', { ascending: false })) as never;
    },
    criarLink: (clienteId, horas, carregados, volumes, descricao) => rpc('criar_link_cliente', {
      p_cliente_id: clienteId, p_validade_horas: horas, p_mostrar_carregados: carregados,
      p_mostrar_volumes: volumes, p_descricao: descricao,
    }),
    revogarLink: (id) => rpc('revogar_link_cliente', { p_link_id: id }),
    posicaoPublica: (token) => rpc('posicao_publica', { p_token: token }),

    importarPlanilha: (payload) => rpc('importar_planilha', { p_payload: payload }),
    async embarquesPorChave(chaves, demo) {
      if (chaves.length === 0) return [];
      const saida = [];
      for (let i = 0; i < chaves.length; i += 200) {
        saida.push(...(ok(await sb.from('embarques').select('id,codigo,chave_importacao').eq('is_demo', demo)
          .in('chave_importacao', chaves.slice(i, i + 200))) ?? []));
      }
      return saida;
    },

    async listarUsuarios() {
      const [perfis, filiais, perms] = await Promise.all([
        todos((a, b) => sb.from('perfis').select('id,nome,email,papel,status,comercial_id,criado_em').order('nome').range(a, b)),
        todos((a, b) => sb.from('perfil_filiais').select('perfil_id,filial_id').range(a, b)),
        todos((a, b) => sb.from('perfil_permissoes').select('perfil_id,chave,permitido').range(a, b)),
      ]);
      return (perfis as never[]).map((p: { id: string }) => ({
        ...(p as object),
        filiais: (filiais as Array<{ perfil_id: string; filial_id: string }>).filter((f) => f.perfil_id === p.id).map((f) => f.filial_id),
        permissoes: Object.fromEntries((perms as Array<{ perfil_id: string; chave: string; permitido: boolean }>)
          .filter((x) => x.perfil_id === p.id).map((x) => [x.chave, x.permitido])),
      })) as never;
    },
    async atualizarUsuario(id, dados) {
      await rpc('admin_atualizar_usuario', { p_perfil_id: id, p_dados: dados });
    },
    async listarConvites() {
      return ok(await sb.from('convites').select('*').is('usado_em', null).order('criado_em', { ascending: false })) as never;
    },
    async criarConvite(dados) {
      await rpc('criar_convite', { p_dados: dados });
    },
    excluirConvite: (id) => rpc('excluir_convite', { p_id: id }),
    async matrizPermissoes() {
      const [catalogo, papeis] = await Promise.all([
        sb.from('permissoes').select('chave,grupo,descricao').order('grupo'),
        sb.from('papel_permissoes').select('papel,chave'),
      ]);
      return { catalogo: ok(catalogo) ?? [], papeis: ok(papeis) ?? [] } as never;
    },
    salvarPermissaoPapel: (papel, chave, permitido) =>
      rpc('salvar_permissao_papel', { p_papel: papel, p_chave: chave, p_permitido: permitido }),
    async carregarDadosDemo() {
      await rpc('carregar_dados_demo', {});
    },
    async limparDadosDemo() {
      await rpc('limpar_dados_demo', {});
    },

    assinar(aoEvento, aoEstado) {
      let estado: EstadoConexao = 'conectando';
      let teveErro = false;
      const mudar = (s: EstadoConexao) => { estado = s; aoEstado(s); };
      const canal = sb.channel('travion-alteracoes');
      for (const tabela of ['posicoes_diarias', 'embarques', 'embarque_financeiro'] as const) {
        canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, (payload) => {
          if (payload.eventType === 'DELETE') {
            aoEvento({ tabela: 'recarregar', tipo: 'TUDO' });
            return;
          }
          aoEvento({ tabela, tipo: payload.eventType, registro: payload.new } as EventoTempoReal);
        });
      }
      canal.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Ao reconectar, recarrega tudo para não perder alterações feitas enquanto estava desconectado.
          if (teveErro) aoEvento({ tabela: 'recarregar', tipo: 'TUDO' });
          teveErro = false;
          mudar(navigator.onLine ? 'conectado' : 'offline');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          teveErro = true;
          mudar(navigator.onLine ? 'reconectando' : 'offline');
        } else if (status === 'CLOSED') {
          teveErro = true;
          mudar('offline');
        }
      });
      const off = () => { teveErro = true; mudar('offline'); };
      const on = () => { if (estado === 'offline') mudar('reconectando'); };
      window.addEventListener('offline', off);
      window.addEventListener('online', on);
      return () => {
        window.removeEventListener('offline', off);
        window.removeEventListener('online', on);
        void sb.removeChannel(canal);
      };
    },
  };
  return api;
}
