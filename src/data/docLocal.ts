// Documentação na prévia local: mesmas regras das funções da migração 1610, dados fictícios no navegador.
// Metadados em localStorage (outras abas simulam outros usuários em tempo real) e arquivos em IndexedDB.

import type {
  AnexoDoc, CategoriaAnexo, ConferenciaEstadia, DuplicadaEstadia, Embarque, LoteErp, MensagemDoc, MotivoDevolucao, NotificacaoApp, PagamentoEstadia,
  Perfil, Permissao, RetornoEstadia, RetratoDoc, SolicitacaoDoc, StatusDoc,
} from '../types';
import type { ApiDoc, ArquivoDoc, EventoDoc, ResultadoDoc } from './api';
import { LIMITE_CADASTRO, MAX_MOTORISTA, MAX_VEICULO, TIPOS_CADASTRO, telefoneValido, tipoCadastro } from '../lib/documentacao';
import { LIMITES_ESTADIA, MOTIVOS_ESTADIA, NUMERO_DOC_RE, RESULTADO_ESTADIA, calcularEstadia, fmtNumeroH, fmtReais, fmtToneladas, pesoToneladas } from '../lib/estadia';
import { type EventoFluxo, type EventoPainel, type SolPainel, dataSP, diaHoraSP, inicioDiaSP } from '../lib/painelOperacional';

const CHAVE = 'travion-previa-doc-v2';
const TIPOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const LIMITE = 15 * 1024 * 1024;
const PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const SAIDA: CategoriaAnexo[] = ['cte', 'mdfe', 'outro_emitido'];

interface ObjetoArq { caminho: string; dono: string; tipo: string; tamanho: number }
interface BancoDoc {
  seq: number;
  solicitacoes: SolicitacaoDoc[]; lotes: LoteErp[]; mensagens: MensagemDoc[]; anexos: AnexoDoc[];
  notificacoes: Array<NotificacaoApp & { destinatario_id: string; chave: string }>;
  objetos: ObjetoArq[];
  /** Eventos do fluxo (como a tabela solicitacao_eventos da migração 1900). */
  eventos?: EventoPainel[];
  /** Estadia (migração 2000): código EST-nnn, versões do cálculo, retornos do cliente e pagamentos informados. */
  seqEstadia?: number;
  conferencias?: ConferenciaEstadia[]; retornos?: RetornoEstadia[]; pagamentos?: PagamentoEstadia[];
}
const FINAIS: StatusDoc[] = ['documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado', 'cancelado'];
const CONCLUSOES: StatusDoc[] = ['documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado'];
const ABERTOS_DOC: StatusDoc[] = ['enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'aguardando_cliente', 'pago_pendencia'];
const CATS_ESTADIA: CategoriaAnexo[] = ['est_documento', 'est_nf_carga', 'est_comprovante', 'est_agendamento', 'est_tratativa'];
const ROTULO_CAT_ESTADIA: Record<string, string> = {
  est_documento: 'CT-e ou NFS', est_nf_carga: 'Nota fiscal da carga', est_comprovante: 'Comprovantes de início e fim', est_agendamento: 'Agendamento',
  est_tratativa: 'Tratativa com cliente ou mesa', est_retorno: 'Evidência do retorno do cliente', est_pagamento: 'Comprovante de pagamento', correcao: 'Correção',
};

export interface CtxDocLocal {
  perfil(): Perfil | null;
  tem(p: Permissao): boolean;
  embarques(): Embarque[];
  veEmbarque(e: Embarque): boolean;
  retrato(e: Embarque): Omit<RetratoDoc, 'lote_numero'>;
  noEscopo(filial: string, comercial: string | null): boolean;
  ehAdmin(): boolean;
  /** O usuário tem filiais no perfil (então precisa escolher uma no cadastro). */
  temFiliais(): boolean;
  /** Cliente que o usuário pode ver (null se não existe ou está fora do alcance). */
  cliente(id: string): { id: string; nome: string; comercial_id: string | null; carteira: string | null } | null;
  filial(id: string): { id: string; nome: string; centro_custo_id: string | null; centro_custo: string | null } | null;
}

const uid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function erro(msg: string): never { throw new Error(msg); }

// ---------------------------------------------------------------------------
// Arquivos (IndexedDB)
// ---------------------------------------------------------------------------
function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open('travion-previa-arquivos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('arquivos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
async function gravarArq(caminho: string, blob: Blob) {
  const db = await abrirIdb();
  await new Promise<void>((ok, falha) => {
    const tx = db.transaction('arquivos', 'readwrite');
    tx.objectStore('arquivos').put(blob, caminho);
    tx.oncomplete = () => ok();
    tx.onerror = () => falha(tx.error);
  });
}
async function lerArq(caminho: string): Promise<Blob | null> {
  const db = await abrirIdb();
  return new Promise((ok, falha) => {
    const r = db.transaction('arquivos').objectStore('arquivos').get(caminho);
    r.onsuccess = () => ok((r.result as Blob) ?? null);
    r.onerror = () => falha(r.error);
  });
}

/** PDF de uma página só com texto (para os anexos fictícios da prévia). */
export function pdfDemo(titulo: string, linhas: string[]): Blob {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const corpo = [
    '0.35 0.05 0.13 RG 2 w 36 36 523 770 re S 0.35 0.05 0.13 rg 36 760 523 46 re f',
    `BT 1 1 1 rg /F2 18 Tf 52 776 Td (${esc(titulo)}) Tj ET`,
    'BT 0.1 0.1 0.2 rg /F1 12 Tf 52 730 Td 20 TL',
    ...linhas.map((l) => `(${esc(l)}) Tj T*`),
    'ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${corpo.length} >>\nstream\n${corpo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let s = '%PDF-1.4\n';
  const pos: number[] = [];
  objs.forEach((o, i) => { pos.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Imagem fictícia (print de conversa com o valor combinado). */
async function imagemDemo(linhas: string[]): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 720; c.height = 960;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e1d6'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#075e54'; g.fillRect(0, 0, c.width, 90);
  g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('Conversa (demonstração)', 30, 58);
  let y = 150;
  for (const [i, l] of linhas.entries()) {
    const dir = i % 2 === 1;
    g.fillStyle = dir ? '#dcf8c6' : '#fff';
    g.fillRect(dir ? 200 : 30, y - 40, 490, 64);
    g.fillStyle = '#222'; g.font = '26px sans-serif';
    g.fillText(l, dir ? 220 : 50, y);
    y += 100;
  }
  return new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
}

// ---------------------------------------------------------------------------
/** Além da API, o lote do ERP informado na criação do embarque (a criação fica na API principal da prévia). */
export type ApiDocLocal = ApiDoc & { registrarLoteInicial(embarqueId: string, numero: string, nome: string): void };

export function criarDocLocal(ctx: CtxDocLocal): ApiDocLocal {
  let db: BancoDoc = (() => {
    try { const s = localStorage.getItem(CHAVE); if (s) return JSON.parse(s) as BancoDoc; } catch { /* recria */ }
    return { seq: 0, solicitacoes: [], lotes: [], mensagens: [], anexos: [], notificacoes: [], objetos: [] };
  })();
  const ouvintes = new Set<(e: EventoDoc) => void>();
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch { /* só em memória */ } };
  const emitir = (e: EventoDoc) => { for (const o of ouvintes) setTimeout(() => o(e), 0); };

  const eu = () => {
    const p = ctx.perfil();
    if (!p || p.status !== 'ativo') erro('Seu acesso ainda não foi aprovado ou está bloqueado.');
    return p;
  };
  const exigir = (c: Permissao) => { eu(); if (!ctx.tem(c)) erro('Você não tem permissão para esta ação.'); };
  const embarque = (id: string) => ctx.embarques().find((e) => e.id === id);
  const podeVer = (embarqueId: string) => {
    const e = embarque(embarqueId);
    return !!e && (ctx.tem('documentacao.ver') || ctx.tem('apoio.pagina')) && ctx.veEmbarque(e);
  };
  // Cadastro: o solicitante sempre vê; quem tem cadastro.ver (ou a fila) vê os da sua filial ou carteira.
  const podeVerReg = (s: SolicitacaoDoc) => {
    if (s.tipo !== 'cadastro' && s.tipo !== 'estadia') return !!s.embarque_id && podeVer(s.embarque_id);
    const p = ctx.perfil();
    if (!p || p.status !== 'ativo') return false;
    return s.solicitante_id === p.id || ((ctx.tem(s.tipo === 'cadastro' ? 'cadastro.ver' : 'estadia.ver') || ctx.tem('apoio.pagina'))
      && (ctx.ehAdmin() || (!!s.filial_id && ctx.noEscopo(s.filial_id, null)) || (!!s.comercial_id && ctx.noEscopo('', s.comercial_id))));
  };
  const carregar = (id: string) => {
    eu();
    const s = db.solicitacoes.find((x) => x.id === id);
    if (!s || !podeVerReg(s)) erro('Solicitação não encontrada ou fora do seu escopo.');
    return s;
  };
  // Mesmo papel do gatilho do banco: cada mudança gravada de etapa ou de responsável vira um evento.
  let motivoPendencia: MotivoDevolucao | null = null;
  const registrarFluxo = (s: SolicitacaoDoc, antes: { status: SolicitacaoDoc['status']; resp: string | null } | null) => {
    let ev: EventoFluxo;
    if (!antes) ev = 'enviado';
    else if (antes.status !== s.status) {
      ev = FINAIS.includes(antes.status) ? 'reaberto'
        : antes.status === 'enviado' && s.status === 'em_atendimento' ? 'assumido'
        : s.status === 'aguardando_informacao' ? 'devolvido'
        : antes.status === 'aguardando_informacao' && (s.status === 'correcao_recebida' || s.status === 'em_atendimento') ? 'corrigido'
        : antes.status === 'correcao_recebida' && s.status === 'em_atendimento' ? 'retomado'
        : s.status === 'aguardando_cliente' ? 'enviado_cliente'
        : s.status === 'pago_pendencia' ? 'pago_pendencia'
        : (antes.status === 'aguardando_cliente' || antes.status === 'pago_pendencia') && s.status === 'em_atendimento' ? 'retorno_cliente'
        : CONCLUSOES.includes(s.status) ? 'concluido'
        : s.status === 'cancelado' ? 'cancelado' : 'status_alterado';
    } else if (antes.resp !== s.responsavel_id) ev = 'transferido';
    else return;
    (db.eventos ??= []).push({ s: s.id, evento: ev, em: antes ? agora() : s.enviado_em, responsavel_id: s.responsavel_id, responsavel_nome: s.responsavel_nome,
      motivo: ev === 'devolvido' ? motivoPendencia ?? 'sem_registro' : null, origem: 'registro' });
  };
  const tocar = (s: SolicitacaoDoc, mud: Partial<SolicitacaoDoc> = {}) => {
    const antes = { status: s.status, resp: s.responsavel_id };
    Object.assign(s, mud, { versao: s.versao + 1, atualizado_em: agora() });
    registrarFluxo(s, antes);
    return s;
  };
  const evento = (s: SolicitacaoDoc, tipo: MensagemDoc['tipo'], texto: string, referencia: string | null = null, autor?: Perfil) => {
    const m: MensagemDoc = { id: uid(), solicitacao_id: s.id, tipo, texto, referencia, autor_id: autor?.id ?? ctx.perfil()?.id ?? null,
      autor_nome: autor?.nome ?? ctx.perfil()?.nome ?? 'Sistema', criado_em: agora() };
    db.mensagens.push(m);
    return m;
  };
  const notificar = (dest: string | null, tipo: NotificacaoApp['tipo'], titulo: string, texto: string, s: SolicitacaoDoc, destino: NotificacaoApp['destino'], chave: string) => {
    if (!dest || dest === ctx.perfil()?.id || db.notificacoes.some((n) => n.destinatario_id === dest && n.chave === chave)) return;
    db.notificacoes.push({ id: uid(), destinatario_id: dest, chave, tipo, titulo, texto, solicitacao_id: s.id, embarque_id: s.embarque_id, destino, criada_em: agora(), lida_em: null });
  };
  const rotulo = (s: SolicitacaoDoc) => (s.tipo === 'estadia' ? `Estadia ${s.est_codigo} · ${s.placa}`
    : `${s.tipo === 'lote_emissao' ? 'Lote e Emissão' : s.tipo === 'emissao' ? 'Emissão' : 'Cadastro'} nº ${s.numero} · ${s.placa}`);
  const vincular = (s: SolicitacaoDoc, anexos: ArquivoDoc[], cats: CategoriaAnexo[], mensagem: string | null) => {
    const p = eu();
    let n = 0;
    for (const a of anexos ?? []) {
      if (!cats.includes(a.categoria)) erro('Categoria de anexo não permitida nesta etapa.');
      if (!a.caminho.startsWith(`envios/${p.id}/`)) erro('Arquivo enviado por outro usuário.');
      const o = db.objetos.find((x) => x.caminho === a.caminho && x.dono === p.id);
      if (!o) erro(`Arquivo não encontrado no armazenamento: envie novamente (${a.nome}).`);
      if (o.tamanho <= 0) erro(`Arquivo vazio ou envio incompleto: ${a.nome}.`);
      const amplo = s.tipo === 'cadastro' || s.tipo === 'estadia';
      if (amplo ? !TIPOS_CADASTRO[o.tipo] || o.tamanho > LIMITE_CADASTRO : !TIPOS.includes(o.tipo) || o.tamanho > LIMITE) {
        erro(amplo ? `Arquivo não aceito (tipo ou tamanho acima de 10 MB): ${a.nome}.` : `Arquivo não aceito (use PDF ou imagem até 15 MB): ${a.nome}.`);
      }
      if (!db.anexos.some((x) => x.caminho === a.caminho)) {
        db.anexos.push({ id: uid(), solicitacao_id: s.id, categoria: a.categoria, caminho: a.caminho, nome: a.nome.slice(0, 200) || 'arquivo',
          tipo_mime: o.tipo, tamanho: o.tamanho, mensagem_id: mensagem, enviado_por_nome: p.nome, enviado_em: agora() });
      }
      n++;
    }
    return n;
  };
  const responsavel = (s: SolicitacaoDoc, status: SolicitacaoDoc['status'][]) => {
    exigir('apoio.atender');
    if (s.responsavel_id !== ctx.perfil()?.id) erro(`Somente o responsável pelo atendimento (${s.responsavel_nome ?? 'ninguém'}) pode fazer isso.`);
    if (!status.includes(s.status)) erro('A solicitação não está numa etapa que permite esta ação.');
  };
  const fim = (s: SolicitacaoDoc, extra: Partial<ResultadoDoc> = {}): ResultadoDoc => {
    salvar();
    emitir({ tabela: 'solicitacoes', id: s.id });
    emitir({ tabela: 'notificacoes' });
    return { status: 'ok', registro: clone(s), ...extra } as ResultadoDoc;
  };

  const carregarEstadia = (id: string, versao: number | null) => {
    const s = carregar(id);
    if (s.tipo !== 'estadia') erro('Esta solicitação não é de estadia.');
    if (versao != null && s.versao !== versao) erro('A estadia foi alterada por outra pessoa enquanto você editava. Os dados foram atualizados: confira e salve de novo.');
    return s;
  };
  const numerosEstadia = (lista: string[], max: number, rot: string) => {
    const v = [...new Set((lista ?? []).map((x) => x.replace(/\s+/g, '').toUpperCase()).filter(Boolean))].sort();
    if (!v.length) erro(`Informe ${rot}.`);
    if (v.length > max) erro(`No máximo ${max} números em ${rot}.`);
    if (v.some((x) => !NUMERO_DOC_RE.test(x))) erro(`Número inválido em ${rot}: use só letras, números, ponto, barra ou hífen.`);
    return v;
  };
  /** Campos de emissão vazios (a estadia não tem embarque). */
  const base = (): Omit<SolicitacaoDoc, 'id' | 'numero' | 'tipo' | 'status' | 'placa' | 'observacoes' | 'retrato' | 'solicitante_id' | 'solicitante_nome' | 'enviado_em' | 'versao' | 'atualizado_em'> => ({
    embarque_id: null, lote_id: null, placas_reboque: [], frete_empresa: 0, frete_empresa_unidade: 'rs_tonelada', frete_motorista: 0,
    frete_motorista_unidade: 'rs_tonelada', tipo_operacao: null, forma_pagamento: 'pagbem', pedagio: 'nao_ha', exige_obs_cte: false, obs_cte: null,
    cte_por_nf: false, responsavel_id: null, responsavel_nome: null, assumido_em: null, concluido_em: null, concluido_por_nome: null,
    cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null,
  });

  // Sementes: algumas demandas em cada etapa, com arquivos fictícios.
  let pronto: Promise<void> = Promise.resolve();
  const semear = async () => {
    const es = ctx.embarques().filter((e) => e.is_demo);
    if (es.length < 6) return;
    const perfil = (id: string, nome: string) => ({ id, nome, email: null, papel: 'apoio', status: 'ativo', comercial_id: null, criado_em: agora() } as Perfil);
    const gestor = perfil('perfil-1', 'Gestor Rio Verde (prévia)');
    const sup = perfil('perfil-5', 'Supervisor Jataí (prévia)');
    const lucia = perfil('perfil-2', 'Apoio Operacional (prévia)');
    const paulo = lucia;
    const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
    const arquivo = async (dono: string, nome: string, blob: Blob) => {
      const caminho = `envios/${dono}/${uid()}${nome.slice(nome.lastIndexOf('.'))}`;
      await gravarArq(caminho, blob);
      db.objetos.push({ caminho, dono, tipo: blob.type, tamanho: blob.size });
      return caminho;
    };
    const nf = (n: string, e: Embarque, placa: string) => pdfDemo(`DANFE (demonstração) · NF-e ${n}`, [
      `Destinatário: ${ctx.retrato(e).cliente ?? ''}`, `Origem: ${e.origem_cidade}/${e.origem_uf ?? ''}`,
      `Destino: ${e.destino_cidade}/${e.destino_uf ?? ''}`, `Produto: ${ctx.retrato(e).produto ?? ''}`, `Peso líquido: 37.420 kg`,
      `Placa: ${placa}`, `Chave de acesso: 5226 1012 3456 7800 0190 5500 1000 0${n} 1000 0${n}`, '', 'Documento fictício para a prévia do Travion.']);
    const sols: Array<[number, SolicitacaoDoc['tipo'], SolicitacaoDoc['status'], Perfil, Perfil | null, string, number]> = [
      [0, 'lote_emissao', 'documentacao_disponivel', gestor, paulo, 'RVD2A41', 600],
      [0, 'emissao', 'em_atendimento', gestor, paulo, 'QWE4F21', 95],
      [2, 'lote_emissao', 'enviado', sup, null, 'JTA1B22', 18],
      [5, 'lote_emissao', 'aguardando_informacao', sup, lucia, 'ITB7C30', 140],
      [0, 'emissao', 'enviado', gestor, null, 'GOX3H55', 6],
    ];
    let lote: LoteErp | null = null;
    for (const [i, [ei, tipo, status, sol, resp, placa, idade]] of sols.entries()) {
      const e = es[ei];
      const id = uid();
      const s: SolicitacaoDoc = {
        id, numero: ++db.seq, embarque_id: e.id, lote_id: tipo === 'emissao' ? lote?.id ?? null : null, tipo, status, placa, placas_reboque: i === 0 ? ['RVD2A42'] : [],
        frete_empresa: [155, 155, 230, 79, 155][i], frete_empresa_unidade: 'rs_tonelada', frete_motorista: [144, 142, 180, 73, 144][i], frete_motorista_unidade: 'rs_tonelada',
        tipo_operacao: ['mi_tributado', 'mi_tributado', 'exportacao', 'mi_isento', 'mi_tributado'][i] as SolicitacaoDoc['tipo_operacao'],
        forma_pagamento: i % 2 ? 'cheque' : 'pagbem', pedagio: (['sem_parar', 'veloe', 'nao_ha', 'move_mais', 'sem_parar'] as const)[i],
        exige_obs_cte: i === 0 || i === 2, obs_cte: i === 0 || i === 2 ? 'Informar pedido de compra 4500123987 no CT-e' : null, cte_por_nf: i === 3,
        observacoes: i === 2 ? 'Cliente pediu prioridade: carreta já carregada aguardando documentos.' : null,
        retrato: { ...ctx.retrato(e), lote_numero: tipo === 'emissao' ? lote?.numero ?? null : null },
        solicitante_id: sol.id, solicitante_nome: sol.nome, responsavel_id: resp?.id ?? null, responsavel_nome: resp?.nome ?? null,
        enviado_em: min(idade), assumido_em: resp ? min(idade - 4) : null,
        concluido_em: status === 'documentacao_disponivel' ? min(idade - 75) : null, concluido_por_nome: status === 'documentacao_disponivel' ? resp?.nome ?? null : null,
        cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null, versao: 3, atualizado_em: min(Math.max(idade - 75, 1)),
      };
      db.solicitacoes.push(s);
      const m = (tipo: MensagemDoc['tipo'], texto: string, autor: Perfil, quando: number, referencia: string | null = null) =>
        db.mensagens.push({ id: uid(), solicitacao_id: id, tipo, texto, referencia, autor_id: autor.id, autor_nome: autor.nome, criado_em: min(quando) });
      const anexo = async (cat: CategoriaAnexo, nome: string, blob: Blob, por: Perfil, quando: number) => {
        db.anexos.push({ id: uid(), solicitacao_id: id, categoria: cat, caminho: await arquivo(por.id, nome, blob), nome, tipo_mime: blob.type,
          tamanho: blob.size, mensagem_id: null, enviado_por_nome: por.nome, enviado_em: min(quando) });
      };
      m('evento', tipo === 'lote_emissao' ? 'Solicitação de lote e emissão enviada ao apoio' : `Solicitação de emissão enviada ao apoio (lote ${lote?.numero})`, sol, idade);
      await anexo('nf', `NF-${41230 + i}.pdf`, nf(String(41230 + i), e, placa), sol, idade);
      if (tipo === 'lote_emissao') await anexo('evidencia_frete', `evidencia-frete-${i + 1}.png`, await imagemDemo(['Fechado frete empresa?', `R$ ${s.frete_empresa},00/t ok`, 'Motorista sai hoje', `R$ ${s.frete_motorista},00/t`]), sol, idade);
      if (resp) m('evento', `Atendimento assumido por ${resp.nome}`, resp, idade - 4);
      if (i === 0) {
        lote = { id: uid(), embarque_id: e.id, numero: 'L-24817', solicitacao_id: id, registrado_por_nome: paulo.nome, registrado_em: min(idade - 30), versao: 1, atualizado_em: min(idade - 30) };
        db.lotes.push(lote);
        s.lote_id = lote.id; s.retrato.lote_numero = lote.numero;
        m('evento', 'Lote L-24817 registrado (gerado no ERP). Emissão desta nota segue em atendimento.', paulo, idade - 30, 'lote');
        await anexo('cte', 'CTe-118204.pdf', pdfDemo('DACTE (demonstração) · CT-e 118204', ['Lote L-24817', `Placa ${placa}`, 'Documento fictício.']), paulo, idade - 70);
        await anexo('mdfe', 'MDFe-55102.pdf', pdfDemo('DAMDFE (demonstração) · MDF-e 55102', ['Lote L-24817', `Placa ${placa}`, 'Documento fictício.']), paulo, idade - 70);
        m('evento', `Documentação disponível, conferida e liberada por ${paulo.nome}`, paulo, idade - 75);
      }
      if (status === 'aguardando_informacao') {
        m('pendencia', 'A evidência do frete não mostra o valor do frete motorista. Envie o print com os dois valores, por favor.', lucia, idade - 20, 'evidencia_frete');
        db.mensagens[db.mensagens.length - 1].motivo = 'informacao_incompleta';
        db.notificacoes.push({ id: uid(), destinatario_id: sol.id, chave: `ajuste:${id}`, tipo: 'ajuste_solicitado', titulo: 'Ajuste solicitado pelo apoio',
          texto: `${rotulo(s)}: A evidência do frete não mostra o valor do frete motorista.`, solicitacao_id: id, embarque_id: e.id, destino: 'embarque', criada_em: min(idade - 20), lida_em: null });
      }
      if (status === 'documentacao_disponivel') {
        db.notificacoes.push({ id: uid(), destinatario_id: sol.id, chave: `disponivel:${id}`, tipo: 'documentacao_disponivel', titulo: 'Documentação disponível',
          texto: rotulo(s), solicitacao_id: id, embarque_id: e.id, destino: 'embarque', criada_em: min(idade - 75), lida_em: null });
      }
    }
    await semearCadastros();
    await semearEstadias();
  };
  // Cadastros fictícios (motorista e veículos de demonstração; nenhum documento real).
  const semearCadastros = async () => {
    const es = ctx.embarques().filter((e) => e.is_demo);
    if (es.length < 6 || db.solicitacoes.some((s) => s.tipo === 'cadastro')) { salvar(); return; }
    const perfil = (id: string, nome: string) => ({ id, nome } as Perfil);
    const gestor = perfil('perfil-1', 'Gestor Rio Verde (prévia)');
    const sup = perfil('perfil-5', 'Supervisor Jataí (prévia)');
    const apoio = perfil('perfil-2', 'Apoio Operacional (prévia)');
    const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
    const itens: Array<[number, SolicitacaoDoc['status'], Perfil, Perfil | null, string, string, number, boolean, number]> = [
      [1, 'enviado', gestor, null, 'RTV5E81', '(64) 99812-3344', 58000, true, 12],
      [3, 'em_atendimento', sup, apoio, 'JTX2A90', '(64) 98144-7720', 92500.5, false, 70],
      [0, 'cadastro_concluido', gestor, apoio, 'MTV8C14', '(64) 99677-0102', 85000, true, 400],
    ];
    for (const [ei, status, sol, resp, placa, tel, valor, primeiro, idade] of itens) {
      const e = es[ei];
      const r0 = ctx.retrato(e);
      const id = uid();
      const s: SolicitacaoDoc = {
        id, numero: ++db.seq, embarque_id: null, lote_id: null, tipo: 'cadastro', status, placa, placas_reboque: [],
        frete_empresa: 0, frete_empresa_unidade: 'rs_tonelada', frete_motorista: 0, frete_motorista_unidade: 'rs_tonelada', tipo_operacao: null,
        forma_pagamento: 'pagbem', pedagio: 'nao_ha', exige_obs_cte: false, obs_cte: null, cte_por_nf: false,
        observacoes: ei === 3 ? 'Motorista chega amanhã cedo para carregar; cadastro com prioridade.' : null,
        retrato: { ...r0, codigo: null, coleta: null, entrega: null, lote_numero: null },
        filial_id: e.filial_id, comercial_id: e.comercial_id, cliente_id: e.cliente_id, telefone_motorista: tel, mercadoria: r0.produto ?? 'Soja',
        valor_carga: valor, origem_cidade: e.origem_cidade, origem_uf: e.origem_uf, destino_cidade: e.destino_cidade, destino_uf: e.destino_uf,
        primeiro_embarque: primeiro, erp_referencia: status === 'cadastro_concluido' ? 'MOT-20931' : null,
        retorno_solicitante: status === 'cadastro_concluido' ? 'Motorista e cavalo cadastrados; carreta já existia no ERP.' : null,
        solicitante_id: sol.id, solicitante_nome: sol.nome, responsavel_id: resp?.id ?? null, responsavel_nome: resp?.nome ?? null,
        enviado_em: min(idade), assumido_em: resp ? min(idade - 5) : null,
        concluido_em: status === 'cadastro_concluido' ? min(idade - 40) : null, concluido_por_nome: status === 'cadastro_concluido' ? apoio.nome : null,
        cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null, versao: 2, atualizado_em: min(status === 'cadastro_concluido' ? idade - 40 : idade - 5),
      };
      db.solicitacoes.push(s);
      const m = (texto: string, autor: Perfil, quando: number, referencia: string | null = null) =>
        db.mensagens.push({ id: uid(), solicitacao_id: id, tipo: 'evento', texto, referencia, autor_id: autor.id, autor_nome: autor.nome, criado_em: min(quando) });
      const docs: Array<[CategoriaAnexo, string, string[]]> = [
        ['motorista', 'CNH-motorista.pdf', ['CNH (demonstração)', 'Nome: Motorista Fictício da Silva', 'Categoria: E', 'Validade: 12/2029']],
        ['motorista', 'comprovante-endereco.pdf', ['Comprovante de endereço (demonstração)', 'Rua Fictícia, 100 · Rio Verde/GO']],
        ['veiculo', `CRLV-${placa}.pdf`, [`CRLV (demonstração) · cavalo ${placa}`, 'Ano 2019 · Scania R450']],
        ['veiculo', 'CRLV-carreta.pdf', ['CRLV (demonstração) · carreta', 'Graneleira 3 eixos']],
      ];
      for (const [cat, nome, linhas] of docs) {
        const blob = pdfDemo(linhas[0], [...linhas.slice(1), '', 'Documento fictício para a prévia do Travion.']);
        const caminho = `envios/${sol.id}/${uid()}.pdf`;
        await gravarArq(caminho, blob);
        db.objetos.push({ caminho, dono: sol.id, tipo: blob.type, tamanho: blob.size });
        db.anexos.push({ id: uid(), solicitacao_id: id, categoria: cat, caminho, nome, tipo_mime: blob.type, tamanho: blob.size,
          mensagem_id: null, enviado_por_nome: sol.nome, enviado_em: min(idade) });
      }
      m('Cadastro enviado ao apoio', sol, idade);
      if (resp) m(`Atendimento assumido por ${resp.nome}`, resp, idade - 5);
      if (status === 'cadastro_concluido') {
        m(`Cadastro concluído no ERP, confirmado por ${apoio.nome} · referência MOT-20931`, apoio, idade - 40, 'conclusao');
        db.notificacoes.push({ id: uid(), destinatario_id: sol.id, chave: `cadastro_concluido:${id}`, tipo: 'cadastro_concluido',
          titulo: `Cadastro da placa ${placa.slice(0, 3)}-${placa.slice(3)} concluído`, texto: `Cadastro nº ${s.numero} · ${s.retrato.cliente ?? ''}`,
          solicitacao_id: id, embarque_id: null, destino: 'cadastro', criada_em: min(idade - 40), lida_em: null });
      }
    }
    db.eventos = eventosDosRegistros(db, 'registro');
    salvar();
  };
  // Estadias fictícias (documentos de demonstração; nenhum dado real). O exemplo da especificação fica em atendimento,
  // sem conferência, para o apoio informar limite 24 h e retroagir 12 h e ver os R$ 261,70.
  const semearEstadias = async () => {
    const es = ctx.embarques().filter((e) => e.is_demo);
    if (es.length < 6 || db.solicitacoes.some((s) => s.tipo === 'estadia')) { salvar(); return; }
    const pessoa = (id: string, nome: string) => ({ id, nome } as Perfil);
    const gestor = pessoa('perfil-1', 'Gestor Rio Verde (prévia)');
    const sup = pessoa('perfil-5', 'Supervisor Jataí (prévia)');
    const com = pessoa('perfil-6', 'Embarcador (prévia)');
    const apoio = pessoa('perfil-2', 'Apoio Operacional (prévia)');
    const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
    const dia = (d: number) => dataSP(Date.now() - d * 86400e3);
    const ids: string[] = [];
    type Item = { ei: number; sol: Perfil; status: StatusDoc; placa: string; tipoDoc: 'cte' | 'nfs'; docs: string[]; nfs: string[];
      inicio: string; saida: string; tarifa: number; peso: number; unidade: 't' | 'kg'; motivo: SolicitacaoDoc['est_motivo']; acordo?: boolean; idade: number;
      sindicato?: string; obs?: string };
    const itens: Item[] = [
      { ei: 0, sol: gestor, status: 'em_atendimento', placa: 'EFU2G04', tipoDoc: 'cte', docs: ['000184512'], nfs: ['0045871', '0045872'],
        inicio: '2026-10-02T13:09:00-03:00', saida: '2026-10-03T16:37:00-03:00', tarifa: 0.45, peso: 37.6, unidade: 't', motivo: 'demora_descarga', idade: 95,
        obs: 'Descarga parada por fila no armazém do cliente; motorista avisou às 14h do dia 02.' },
      { ei: 2, sol: sup, status: 'enviado', placa: 'RVD3B19', tipoDoc: 'nfs', docs: ['2026/000311'], nfs: ['0098120'],
        inicio: `${dia(3)}T07:40:00-03:00`, saida: `${dia(2)}T18:05:00-03:00`, tarifa: 0.5, peso: 36800, unidade: 'kg', motivo: 'falta_cota', acordo: true, idade: 140,
        sindicato: 'Sindicato dos Transportadores de Jataí' },
      { ei: 1, sol: com, status: 'aguardando_cliente', placa: 'JTA8C77', tipoDoc: 'cte', docs: ['000183977', '000183978'], nfs: ['0045530'],
        inicio: `${dia(6)}T09:15:00-03:00`, saida: `${dia(5)}T15:45:00-03:00`, tarifa: 0.42, peso: 38.2, unidade: 't', motivo: 'agendamento_alongado', idade: 3 * 1440 },
      { ei: 3, sol: gestor, status: 'aprovada', placa: 'MTV1D52', tipoDoc: 'cte', docs: ['000182640'], nfs: ['0044102'],
        inicio: `${dia(12)}T10:00:00-03:00`, saida: `${dia(10)}T22:30:00-03:00`, tarifa: 0.45, peso: 37.9, unidade: 't', motivo: 'troca_nota', idade: 9 * 1440 },
    ];
    for (const it of itens) {
      const e = es[it.ei];
      const r0 = ctx.retrato(e);
      const id = uid();
      ids.push(id);
      const pesoT = pesoToneladas(it.peso, it.unidade);
      const acordo = !!it.acordo;
      const atendido = it.status !== 'enviado';
      const s: SolicitacaoDoc = {
        ...base(), id, numero: ++db.seq, tipo: 'estadia', status: it.status, placa: it.placa, observacoes: it.obs ?? null,
        retrato: { ...r0, codigo: null, origem_cidade: '', origem_uf: null, coleta: null, destino_cidade: '', destino_uf: null, entrega: null, produto: null, lote_numero: null },
        filial_id: e.filial_id, comercial_id: e.comercial_id, cliente_id: e.cliente_id,
        est_codigo: `EST-${String((db.seqEstadia = (db.seqEstadia ?? 0) + 1)).padStart(3, '0')}`, est_tipo_documento: it.tipoDoc, est_documentos: it.docs,
        est_nfs_carga: it.nfs, est_sindicato: !!it.sindicato, est_sindicato_nome: it.sindicato ?? null,
        est_inicio: new Date(it.inicio).toISOString(), est_saida: new Date(it.saida).toISOString(), est_tarifa: it.tarifa, est_peso_t: pesoT,
        est_peso_informado: it.peso, est_peso_unidade: it.unidade, est_motivo: it.motivo, est_motivo_outro: null, est_modalidade: acordo ? 'acordo' : 'padrao',
        est_acordo_valor: acordo ? 480 : null, est_acordo_confirmado_por: acordo ? 'Mesa comercial (prévia)' : null, est_acordo_data: acordo ? dia(2) : null,
        est_acordo_descricao: acordo ? 'Cliente aceitou pagar R$ 480,00 pela falta de cota, conforme conversa com a mesa.' : null,
        solicitante_id: it.sol.id, solicitante_nome: it.sol.nome, responsavel_id: atendido ? apoio.id : null, responsavel_nome: atendido ? apoio.nome : null,
        enviado_em: min(it.idade), assumido_em: atendido ? min(it.idade - 6) : null, versao: 2, atualizado_em: min(atendido ? it.idade - 6 : it.idade),
      };
      db.solicitacoes.push(s);
      const m = (texto: string, autor: Perfil, quando: number, referencia: string | null = null) => {
        const x: MensagemDoc = { id: uid(), solicitacao_id: id, tipo: 'evento', texto, referencia, autor_id: autor.id, autor_nome: autor.nome, criado_em: min(quando) };
        db.mensagens.push(x);
        return x;
      };
      const anexo = async (cat: CategoriaAnexo, nome: string, blob: Blob, por: Perfil, quando: number, mensagem: string | null = null) => {
        const caminho = `envios/${por.id}/${uid()}${nome.slice(nome.lastIndexOf('.'))}`;
        await gravarArq(caminho, blob);
        db.objetos.push({ caminho, dono: por.id, tipo: blob.type, tamanho: blob.size });
        db.anexos.push({ id: uid(), solicitacao_id: id, categoria: cat, caminho, nome, tipo_mime: blob.type, tamanho: blob.size, mensagem_id: mensagem,
          enviado_por_nome: por.nome, enviado_em: min(quando) });
      };
      const fim1 = 'Documento fictício para a prévia do Travion.';
      const doc = it.tipoDoc === 'cte' ? 'DACTE' : 'NFS-e';
      for (const n of it.docs) {
        await anexo('est_documento', `${it.tipoDoc === 'cte' ? 'CTe' : 'NFSe'}-${n.replace(/\//g, '-')}.pdf`, pdfDemo(`${doc} (demonstração) · ${n}`, [
          `Tomador: ${r0.cliente ?? ''}`, `Placa: ${it.placa}`, `Peso: ${pesoT.toLocaleString('pt-BR')} t`, '', fim1]), it.sol, it.idade);
      }
      for (const n of it.nfs) await anexo('est_nf_carga', `NF-${n}.pdf`, pdfDemo(`DANFE (demonstração) · NF-e ${n}`, [`Destinatário: ${r0.cliente ?? ''}`, `Placa: ${it.placa}`, '', fim1]), it.sol, it.idade);
      await anexo('est_comprovante', 'ticket-entrada.png', await imagemDemo(['Ticket de entrada (demonstração)', `Placa ${it.placa}`, `Entrada ${it.inicio.slice(8, 10)}/${it.inicio.slice(5, 7)} ${it.inicio.slice(11, 16)}`]), it.sol, it.idade);
      await anexo('est_comprovante', 'ticket-saida.png', await imagemDemo(['Ticket de saída (demonstração)', `Placa ${it.placa}`, `Saída ${it.saida.slice(8, 10)}/${it.saida.slice(5, 7)} ${it.saida.slice(11, 16)}`]), it.sol, it.idade);
      if (it.motivo === 'agendamento_alongado') await anexo('est_agendamento', 'agendamento.pdf', pdfDemo('Agendamento (demonstração)', [`Janela prevista: ${it.inicio.slice(11, 16)}`, fim1]), it.sol, it.idade);
      if (acordo) await anexo('est_tratativa', 'acordo-mesa.png', await imagemDemo(['Fechamos a estadia?', 'R$ 480,00 pela falta de cota', 'Ok, pode lançar', 'Obrigado!']), it.sol, it.idade);
      m(`Estadia ${s.est_codigo} enviada ao apoio`, it.sol, it.idade);
      if (atendido) m(`Atendimento assumido por ${apoio.nome}`, apoio, it.idade - 6);
      if (it.status === 'aguardando_cliente' || it.status === 'aprovada') {
        const calc = calcularEstadia({ inicio: s.est_inicio, saida: s.est_saida, tarifa: it.tarifa, peso_t: pesoT, limite_h: 24, retroagir_h: it.status === 'aprovada' ? 0 : 12 })!;
        const conf: ConferenciaEstadia = { id: uid(), solicitacao_id: id, versao: 1, inicio: s.est_inicio!, saida: s.est_saida!, tarifa: it.tarifa, peso_t: pesoT,
          limite_h: 24, retroagir_h: it.status === 'aprovada' ? 0 : 12, ...calc, alteracoes: {}, observacao: null, autor_nome: apoio.nome, criado_em: min(it.idade - 40) };
        (db.conferencias ??= []).push(conf);
        Object.assign(s, { est_conferencia_id: conf.id, est_conferencia_versao: 1, est_limite_h: conf.limite_h, est_retroagir_h: conf.retroagir_h,
          est_horas_validas: calc.horas_validas, est_valor_calculado: calc.valor, est_conferido_em: conf.criado_em, est_conferido_por_nome: apoio.nome,
          est_encaminhado_em: min(it.idade - 45) });
        m(`Memória de cálculo v1 salva: ${it.tarifa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} × ${fmtToneladas(pesoT)} × ${calc.horas_validas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h válidas = ${fmtReais(calc.valor)} (limite 24 h, retroagir ${conf.retroagir_h} h)`, apoio, it.idade - 40, 'calculo');
        m(`Encaminhada ao cliente pelo apoio (fora do app), conferência v1: ${fmtReais(calc.valor)} · enviado por e-mail ao financeiro do cliente`, apoio, it.idade - 45, 'cliente');
        if (it.status === 'aprovada') {
          const pm = m(`Pagamento informado (feito fora do app) em ${dia(7).split('-').reverse().join('/')}: ${fmtReais(calc.valor)}, com receita pendente · pago ao motorista antes do aceite do cliente`, apoio, 7 * 1440, 'pagamento');
          await anexo('est_pagamento', 'comprovante-pagamento.png', await imagemDemo(['Comprovante (demonstração)', `Pix ${fmtReais(calc.valor)}`, 'Favorecido: motorista']), apoio, 7 * 1440, pm.id);
          (db.pagamentos ??= []).push({ id: uid(), solicitacao_id: id, valor_pago: calc.valor, data_pagamento: dia(7), observacao: 'pago ao motorista antes do aceite do cliente',
            conferencia_id: conf.id, mensagem_id: pm.id, autor_nome: apoio.nome, criado_em: min(7 * 1440) });
          const rm = m(`Retorno do cliente registrado (${dia(5).split('-').reverse().join('/')}): Aprovada, valor aprovado ${fmtReais(calc.valor)} · Cliente aprovou por e-mail · situação Pago em pendência → Aprovada (pagamento e pendência de receita continuam registrados)`, apoio, 5 * 1440, 'retorno');
          await anexo('est_retorno', 'aprovacao-cliente.png', await imagemDemo(['E-mail do cliente (demonstração)', 'Estadia aprovada', `Valor ${fmtReais(calc.valor)}`]), apoio, 5 * 1440, rm.id);
          (db.retornos ??= []).push({ id: uid(), solicitacao_id: id, resultado: 'aprovada', valor_aprovado: calc.valor, justificativa: 'Cliente aprovou por e-mail', data_retorno: dia(5),
            conferencia_id: conf.id, valor_calculado: calc.valor, status_anterior: 'pago_pendencia', status_novo: 'aprovada', mensagem_id: rm.id, autor_nome: apoio.nome, criado_em: min(5 * 1440) });
          Object.assign(s, { est_valor_pago: calc.valor, est_pago_em: dia(7), est_resultado: 'aprovada', est_valor_aprovado: calc.valor, est_retorno_em: min(5 * 1440),
            concluido_em: min(5 * 1440), concluido_por_nome: apoio.nome, atualizado_em: min(5 * 1440), versao: 6 });
          db.notificacoes.push({ id: uid(), destinatario_id: it.sol.id, chave: `estadia_retorno:${id}`, tipo: 'estadia_atualizada', titulo: 'Estadia aprovada pelo cliente',
            texto: `${rotulo(s)} · ${r0.cliente ?? ''} · ${fmtReais(calc.valor)}`, solicitacao_id: id, embarque_id: null, destino: 'estadia', criada_em: min(5 * 1440), lida_em: null });
        } else {
          Object.assign(s, { atualizado_em: min(it.idade - 45), versao: 4 });
          db.notificacoes.push({ id: uid(), destinatario_id: it.sol.id, chave: `estadia_cliente:${id}`, tipo: 'estadia_atualizada', titulo: 'Estadia aguardando retorno do cliente',
            texto: `${rotulo(s)} · ${r0.cliente ?? ''} · valor calculado ${fmtReais(calc.valor)}`, solicitacao_id: id, embarque_id: null, destino: 'estadia', criada_em: min(it.idade - 45), lida_em: null });
        }
      }
    }
    const novos = new Set(ids);
    (db.eventos ??= []).push(...eventosDosRegistros(db, 'registro').filter((e) => novos.has(e.s)));
    salvar();
  };
  // Prévia gravada antes do Painel Operacional: eventos refeitos a partir dos horários gravados (como a migração 1900).
  if (!db.eventos) db.eventos = eventosDosRegistros(db, 'historico');
  // Dados da prévia recriados (novos embarques): recomeça a documentação fictícia.
  const ids = new Set(ctx.embarques().map((e) => e.id));
  if (!db.solicitacoes.some((s) => s.embarque_id && ids.has(s.embarque_id)) && typeof document !== 'undefined') {
    db = { seq: 0, solicitacoes: [], lotes: [], mensagens: [], anexos: [], notificacoes: [], objetos: [], eventos: [] };
    pronto = semear().catch(() => undefined);
  } else if (!db.solicitacoes.some((s) => s.tipo === 'cadastro') && typeof document !== 'undefined') {
    pronto = semearCadastros().then(semearEstadias).catch(() => undefined);
  } else if (!db.solicitacoes.some((s) => s.tipo === 'estadia') && typeof document !== 'undefined') {
    pronto = semearEstadias().catch(() => undefined);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (ev) => {
      if (ev.key !== CHAVE || !ev.newValue) return;
      try { db = JSON.parse(ev.newValue) as BancoDoc; } catch { return; }
      emitir({ tabela: 'solicitacoes' }); emitir({ tabela: 'notificacoes' }); emitir({ tabela: 'lotes' });
    });
  }

  // Abas da prévia simulam usuários diferentes: a trava entre abas + releitura imita o "assumir" atômico do servidor.
  const comTrava = <T,>(fn: () => Promise<T>): Promise<T> => {
    const reler = () => { try { const t = localStorage.getItem(CHAVE); if (t) db = JSON.parse(t) as BancoDoc; } catch { /* segue com a memória */ } };
    if (typeof navigator === 'undefined' || !navigator.locks) { reler(); return fn(); }
    return navigator.locks.request(CHAVE, () => { reler(); return fn(); }) as Promise<T>;
  };

  const filiaisDaPrevia = () => [...new Set(ctx.embarques().map((e) => e.filial_id))]
    .map((id) => ({ id, centro: ctx.filial(id)?.centro_custo_id ?? null }));
  const comNomes = (s: SolicitacaoDoc): SolicitacaoDoc => ({ ...s, nomes_nf: db.anexos.filter((a) => a.solicitacao_id === s.id && (a.categoria === 'nf' || a.categoria === 'correcao')).map((a) => a.nome) });
  const visiveis = () => db.solicitacoes.filter(podeVerReg);
  const offline = () => { if (!navigator.onLine) erro('Failed to fetch'); };

  return {
    registrarLoteInicial(embarqueId, numero, nome) {
      if (db.lotes.some((l) => l.embarque_id === embarqueId)) return;
      db.lotes.push({ id: uid(), embarque_id: embarqueId, numero, solicitacao_id: null, registrado_por_nome: nome, registrado_em: agora(), versao: 1, atualizado_em: agora() });
      salvar();
      emitir({ tabela: 'lotes' });
    },
    async listar(desde) {
      await pronto;
      eu();
      const ss = visiveis().filter((s) => !desde || s.atualizado_em >= desde).map(comNomes);
      const ls = db.lotes.filter((l) => podeVer(l.embarque_id) && (!desde || l.atualizado_em >= desde));
      return clone({ solicitacoes: ss, lotes: ls });
    },
    async listarDoEmbarque(embarqueId) {
      await pronto;
      if (!podeVer(embarqueId)) return { solicitacoes: [], lotes: [] };
      return clone({ solicitacoes: db.solicitacoes.filter((s) => s.embarque_id === embarqueId).map(comNomes), lotes: db.lotes.filter((l) => l.embarque_id === embarqueId) });
    },
    async detalhe(id) {
      await pronto;
      const s = carregar(id);
      const origem = s.tipo === 'emissao' ? db.lotes.find((l) => l.id === s.lote_id)?.solicitacao_id : null;
      return clone({
        mensagens: db.mensagens.filter((m) => m.solicitacao_id === id).sort((a, b) => a.criado_em.localeCompare(b.criado_em)),
        anexos: [...db.anexos.filter((a) => a.solicitacao_id === id),
          ...db.anexos.filter((a) => origem && a.solicitacao_id === origem && a.categoria === 'evidencia_frete')],
        ...(s.tipo === 'estadia' ? { estadia: {
          conferencias: (db.conferencias ?? []).filter((c) => c.solicitacao_id === id).sort((a, b) => a.versao - b.versao),
          retornos: (db.retornos ?? []).filter((r) => r.solicitacao_id === id),
          pagamentos: (db.pagamentos ?? []).filter((r) => r.solicitacao_id === id),
        } } : {}),
      });
    },
    async enviarArquivo(arquivo, cadastro) {
      offline();
      const p = eu();
      if (!ctx.tem('documentacao.solicitar') && !ctx.tem('apoio.atender') && !ctx.tem('cadastro.solicitar') && !ctx.tem('estadia.solicitar')) erro('Você não tem permissão para enviar arquivos.');
      const tipo = cadastro ? tipoCadastro(arquivo.name, arquivo.type) : TIPOS.includes(arquivo.type) ? arquivo.type : null;
      if (!tipo) erro(cadastro ? 'Tipo de arquivo não aceito no cadastro.' : 'Tipo de arquivo não aceito (use PDF, PNG, JPG ou WEBP).');
      if (arquivo.size <= 0) erro('Arquivo vazio.');
      if (arquivo.size > (cadastro ? LIMITE_CADASTRO : LIMITE)) erro(cadastro ? 'Arquivo maior que 10 MB.' : 'Arquivo maior que 15 MB.');
      const ext = arquivo.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]?.toLowerCase() ?? '';
      const caminho = `envios/${p.id}/${uid()}${ext}`;
      try { await gravarArq(caminho, arquivo); } catch { erro('Não foi possível guardar o arquivo neste navegador (prévia).'); }
      db.objetos.push({ caminho, dono: p.id, tipo, tamanho: arquivo.size });
      salvar();
      return { caminho, nome: arquivo.name };
    },
    async baixar(caminho) {
      await pronto;
      const p = eu();
      const a = db.anexos.find((x) => x.caminho === caminho);
      if (!(caminho.startsWith(`envios/${p.id}/`) || (a && db.solicitacoes.some((s) => s.id === a.solicitacao_id && podeVerReg(s))))) {
        erro('Não foi possível abrir o arquivo (sem acesso ou indisponível).');
      }
      const b = await lerArq(caminho);
      if (!b) erro('Arquivo não está neste navegador (a prévia guarda os arquivos só localmente).');
      return b;
    },
    async criar(embarqueId, d, anexos) {
      offline();
      await pronto;
      exigir('documentacao.solicitar');
      const p = eu();
      const rep = db.solicitacoes.find((s) => s.solicitante_id === p.id && (s as SolicitacaoDoc & { chave_envio?: string }).chave_envio === d.chave_envio);
      if (rep) return { status: 'ok', registro: clone(rep), repetido: true };
      const e = embarque(embarqueId);
      if (!e || !podeVer(e.id)) erro('Embarque não encontrado ou fora do seu escopo.');
      if (e.situacao !== 'ativo' || e.encerrado_em) erro('Embarque arquivado ou encerrado: não aceita novas solicitações.');
      const lote = db.lotes.find((l) => l.embarque_id === e.id);
      let tipoOp = d.tipo_operacao;
      const aberta = lote ? undefined : db.solicitacoes.find((s) => s.embarque_id === e.id && s.tipo === 'lote_emissao' && s.status !== 'cancelado');
      const emissao = !!lote || !!aberta;
      if (lote) {
        tipoOp = db.solicitacoes.find((s) => s.id === lote.solicitacao_id)?.tipo_operacao ?? tipoOp;
      } else {
        // Primeira nota aberta: a emissão entra na fila e é vinculada ao lote quando ele for registrado.
        if (aberta) tipoOp = aberta.tipo_operacao ?? tipoOp;
        else if (!tipoOp) erro('Informe o tipo de operação.');
      }
      const placa = d.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!PLACA.test(placa)) erro('Placa inválida: use o formato ABC1D23 ou ABC1234.');
      const reboques = (d.placas_reboque ?? []).map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
      if (reboques.some((x) => !PLACA.test(x))) erro('Placa de carreta inválida: use o formato ABC1D23 ou ABC1234.');
      if (!(d.frete_empresa > 0) || !(d.frete_motorista > 0)) erro('Confira fretes (valores maiores que zero, unidade R$/t ou R$/viagem), pagamento e pedágio.');
      if (d.exige_obs_cte && !d.obs_cte?.trim()) erro('Informe qual observação o cliente exige no CT-e.');
      if (d.forma_pagamento === 'pix' && !['proprietario', 'motorista'].includes(d.pix_titular ?? '')) erro('No PIX, informe se a chave é do proprietário ou do motorista.');
      if (d.forma_pagamento === 'pix' && (!d.pix_chave?.trim() || d.pix_chave.trim().length > 140)) erro('Informe a chave PIX (até 140 caracteres).');
      const cats: CategoriaAnexo[] = emissao ? ['nf'] : ['nf', 'evidencia_frete'];
      if (!anexos.some((a) => a.categoria === 'nf')) erro('Anexe ao menos uma NF.');
      if (!emissao && !anexos.some((a) => a.categoria === 'evidencia_frete')) erro('Anexe a evidência do frete.');
      const s: SolicitacaoDoc & { chave_envio: string } = {
        id: uid(), numero: ++db.seq, embarque_id: e.id, lote_id: lote?.id ?? null, tipo: emissao ? 'emissao' : 'lote_emissao', status: 'enviado',
        placa, placas_reboque: reboques, frete_empresa: d.frete_empresa, frete_empresa_unidade: d.frete_empresa_unidade,
        frete_motorista: d.frete_motorista, frete_motorista_unidade: d.frete_motorista_unidade, tipo_operacao: tipoOp,
        forma_pagamento: d.forma_pagamento, pix_titular: d.forma_pagamento === 'pix' ? d.pix_titular ?? null : null, pix_chave: d.forma_pagamento === 'pix' ? d.pix_chave?.trim() ?? null : null, pedagio: d.pedagio, exige_obs_cte: d.exige_obs_cte, obs_cte: d.exige_obs_cte ? d.obs_cte!.trim() : null,
        cte_por_nf: d.cte_por_nf, observacoes: d.observacoes?.trim() || null, retrato: { ...ctx.retrato(e), lote_numero: lote?.numero ?? null },
        solicitante_id: p.id, solicitante_nome: p.nome, responsavel_id: null, responsavel_nome: null, enviado_em: agora(), assumido_em: null,
        concluido_em: null, concluido_por_nome: null, cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null,
        versao: 1, atualizado_em: agora(), chave_envio: d.chave_envio,
      };
      db.solicitacoes.push(s);
      try { vincular(s, anexos, cats, null); } catch (x) { db.solicitacoes.pop(); db.seq--; throw x; }
      registrarFluxo(s, null);
      evento(s, 'evento', lote ? `Solicitação de emissão enviada ao apoio (lote ${lote.numero})`
        : aberta ? `Solicitação de emissão enviada ao apoio (na fila: lote em geração na solicitação nº ${aberta.numero})` : 'Solicitação de lote e emissão enviada ao apoio');
      return fim(s);
    },
    assumir: (id) => comTrava(async () => {
      offline();
      exigir('apoio.atender');
      const s = carregar(id);
      const p = eu();
      if (s.responsavel_id) return { status: s.responsavel_id === p.id ? 'ok' : 'ja_assumida', registro: clone(s) };
      if (s.status !== 'enviado') return { status: 'indisponivel', registro: clone(s) };
      tocar(s, { responsavel_id: p.id, responsavel_nome: p.nome, status: 'em_atendimento', assumido_em: agora() });
      evento(s, 'evento', `Atendimento assumido por ${p.nome}`);
      return fim(s);
    }),
    async registrarLote(id, numero) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento', 'aguardando_informacao']);
      if ((s.tipo !== 'lote_emissao' && s.tipo !== 'emissao') || !s.embarque_id) erro('Só Lote e Emissão ou Emissão registram o lote.');
      const embarqueId = s.embarque_id;
      const n = numero.trim();
      if (!n || n.length > 60) erro('Informe o código do lote do ERP.');
      const ini = db.solicitacoes.find((x) => x.embarque_id === embarqueId && x.tipo === 'lote_emissao' && x.status !== 'cancelado');
      let l = db.lotes.find((x) => x.embarque_id === embarqueId);
      if (l) {
        if (s.tipo === 'emissao' || (l.solicitacao_id && l.solicitacao_id !== s.id)) {
          // Lote já criado para o embarque: vincula se o código conferir.
          if (l.numero.toUpperCase() !== n.toUpperCase()) erro(`Este embarque já tem o lote ${l.numero} criado. Confira o código no ERP.`);
          if (s.lote_id === l.id) return { status: 'sem_alteracao', registro: clone(s), lote: clone(l) };
          evento(s, 'evento', `Vinculada ao lote ${l.numero} (já criado no ERP)`, 'lote');
        } else {
          // Lote informado na criação do embarque: o apoio confirma (ou corrige) e ele passa a ser desta solicitação.
          if (!l.solicitacao_id) l.solicitacao_id = s.id;
          if (l.numero === n && s.lote_id === l.id) return { status: 'sem_alteracao', registro: clone(s), lote: clone(l) };
          if (l.numero !== n) {
            evento(s, 'evento', `Número do lote corrigido de ${l.numero} para ${n}`, 'lote');
            Object.assign(l, { numero: n, versao: l.versao + 1, atualizado_em: agora() });
          } else evento(s, 'evento', `Vinculada ao lote ${l.numero}`, 'lote');
        }
      } else {
        l = { id: uid(), embarque_id: embarqueId, numero: n, solicitacao_id: ini?.id ?? s.id, registrado_por_nome: eu().nome, registrado_em: agora(), versao: 1, atualizado_em: agora() };
        db.lotes.push(l);
        evento(s, 'evento', `Lote ${n} registrado (gerado no ERP) e vinculado. A emissão segue em atendimento.`, 'lote');
      }
      const lote = l;
      tocar(s, { lote_id: lote.id, retrato: { ...s.retrato, lote_numero: lote.numero } });
      // Demais solicitações do embarque sem lote (a inicial e a fila) passam a apontar para o lote.
      for (const f of db.solicitacoes) {
        if (f.id === s.id || f.embarque_id !== embarqueId || (f.tipo !== 'emissao' && f.tipo !== 'lote_emissao') || f.status === 'cancelado') continue;
        if (!f.lote_id || (f.lote_id === lote.id && f.retrato.lote_numero !== lote.numero)) tocar(f, { lote_id: lote.id, retrato: { ...f.retrato, lote_numero: lote.numero } });
      }
      emitir({ tabela: 'lotes' });
      return fim(s, { lote: clone(lote) });
    },
    async solicitarAjuste(id, texto, referencia, motivo, motivoOutro) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento']);
      if (!motivo || motivo === 'sem_registro') erro('Escolha o motivo da devolução.');
      const outro = motivoOutro?.trim().slice(0, 200) || null;
      if (motivo === 'outro' && !outro) erro('Descreva o motivo "Outro".');
      if (!texto.trim()) erro('Descreva o que falta ou precisa ser corrigido.');
      const m = evento(s, 'pendencia', texto.trim().slice(0, 4000), referencia);
      Object.assign(m, { motivo, motivo_outro: motivo === 'outro' ? outro : null });
      motivoPendencia = motivo;
      tocar(s, { status: 'aguardando_informacao' });
      motivoPendencia = null;
      notificar(s.solicitante_id, 'ajuste_solicitado', 'Ajuste solicitado pelo apoio', `${rotulo(s)}: ${texto.trim().slice(0, 140)}`, s,
        s.tipo === 'cadastro' ? 'cadastro' : s.tipo === 'estadia' ? 'estadia' : 'embarque', `ajuste:${m.id}`);
      return fim(s);
    },
    async responder(id, texto, anexos) {
      offline();
      const s = carregar(id);
      exigir(s.tipo === 'cadastro' ? 'cadastro.solicitar' : s.tipo === 'estadia' ? 'estadia.solicitar' : 'documentacao.solicitar');
      if (s.status !== 'aguardando_informacao') erro('Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
      if (!texto.trim()) erro('Escreva a resposta para o apoio.');
      const m = evento(s, 'resposta', texto.trim().slice(0, 4000));
      if (s.tipo === 'cadastro') {
        // Correções entram como nova versão: os anteriores ficam; o limite vale para os arquivos desta resposta.
        const conta = (c: CategoriaAnexo) => (anexos ?? []).filter((a) => a.categoria === c).length;
        if (conta('motorista') > MAX_MOTORISTA || conta('veiculo') > MAX_VEICULO) { db.mensagens.pop(); erro('Na resposta: até 4 documentos do motorista e 10 dos veículos.'); }
      }
      if (s.tipo === 'estadia') {
        for (const [c, n] of Object.entries(LIMITES_ESTADIA.max)) {
          if ((anexos ?? []).filter((a) => a.categoria === c).length > n) { db.mensagens.pop(); erro(`No máximo ${n} arquivo(s) em ${ROTULO_CAT_ESTADIA[c] ?? c}.`); }
        }
      }
      try {
        vincular(s, anexos, s.tipo === 'cadastro' ? ['motorista', 'veiculo', 'correcao'] : s.tipo === 'estadia' ? [...CATS_ESTADIA, 'correcao'] : ['nf', 'evidencia_frete', 'correcao'], m.id);
      } catch (x) { db.mensagens.pop(); throw x; }
      // Volta para a fila do responsável: a nova espera começa agora, até ele retomar.
      tocar(s, { status: 'correcao_recebida' });
      notificar(s.responsavel_id, 'resposta_enviada', 'Correção recebida: retome o atendimento', `${rotulo(s)}: ${texto.trim().slice(0, 140)}`, s, 'apoio', `resposta:${m.id}`);
      return fim(s);
    },
    retomar: (id) => comTrava(async () => {
      offline();
      const s = carregar(id);
      if (s.status === 'em_atendimento' && s.responsavel_id === ctx.perfil()?.id) return { status: 'ok', registro: clone(s) };
      responsavel(s, ['correcao_recebida']);
      tocar(s, { status: 'em_atendimento' });
      evento(s, 'evento', `Atendimento retomado por ${eu().nome}`);
      return fim(s);
    }),
    async filaApoio() {
      await pronto;
      exigir('analise.fila');
      const na = db.solicitacoes.filter((s) => s.status === 'enviado' || s.status === 'correcao_recebida');
      const ids = new Set(na.map((s) => s.id));
      return {
        agora: new Date().toISOString(),
        solicitacoes: na.map((s): SolPainel => ({ id: s.id, numero: s.numero, tipo: s.tipo, status: s.status, filial_id: null, centro_custo_id: null,
          solicitante_id: '', solicitante_nome: '', responsavel_id: null, responsavel_nome: null, enviado_em: s.enviado_em })),
        eventos: (db.eventos ?? []).filter((e) => ids.has(e.s)).map((e) => ({ ...e, responsavel_id: null, responsavel_nome: null, motivo: null })),
      };
    },
    async painel(desde, ate, alteradosDesde) {
      await pronto;
      exigir('analise.operacional');
      const de = Date.parse(desde);
      const a = Date.parse(ate);
      if (!(a > de)) erro('Período inválido.');
      if (a - de > 400 * 86400e3) erro('Escolha um período de até 400 dias.');
      const abertos = ABERTOS_DOC;
      const reais = visiveis().filter((s) => {
        const t = Date.parse(s.enviado_em);
        return ((t >= de && t < a) || abertos.includes(s.status)) && (!alteradosDesde || s.atualizado_em >= alteradosDesde);
      });
      const ids = new Set(reais.map((s) => s.id));
      const sols: SolPainel[] = reais.map((s) => ({
        id: s.id, numero: s.numero, tipo: s.tipo, status: s.status, filial_id: s.retrato.filial_id, centro_custo_id: s.retrato.centro_custo_id,
        solicitante_id: s.solicitante_id, solicitante_nome: s.solicitante_nome, responsavel_id: s.responsavel_id, responsavel_nome: s.responsavel_nome,
        enviado_em: s.enviado_em,
      }));
      const evs = (db.eventos ?? []).filter((e) => ids.has(e.s));
      // Histórico fictício da prévia (só concluídos/cancelados), para os quadros terem o que mostrar.
      const fic = historicoFicticio(filiaisDaPrevia(), Date.now());
      const f = alteradosDesde ? null : fic;
      if (f) {
        for (const s of f.solicitacoes) {
          const t = Date.parse(s.enviado_em);
          if (t >= de && t < a && (ctx.ehAdmin() || !s.filial_id || ctx.noEscopo(s.filial_id, null))) { sols.push(s); ids.add(s.id); }
        }
        evs.push(...f.eventos.filter((e) => ids.has(e.s)));
      }
      const datas = [...db.solicitacoes.map((s) => s.enviado_em), fic.inicio].sort();
      return clone({ agora: agora(), inicio_registro: fic.inicio, inicio_dados: datas[0] ?? null, solicitacoes: sols, eventos: evs });
    },
    async anexarEmitidos(id, anexos) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento', 'aguardando_informacao']);
      if (s.tipo === 'cadastro') erro('Cadastro não recebe documentos emitidos: confirme a conclusão do cadastro.');
      if (s.tipo === 'estadia') erro('Estadia não recebe documentos emitidos: use a memória de cálculo e o retorno do cliente.');
      if ((s.tipo === 'lote_emissao' || s.tipo === 'emissao') && !s.lote_id) erro('Informe o código do lote do ERP e vincule a solicitação antes de anexar os documentos emitidos.');
      const n = vincular(s, anexos, SAIDA, null);
      if (!n) erro('Nenhum arquivo para anexar.');
      evento(s, 'evento', `${n} documento(s) emitido(s) anexado(s), em conferência`, 'documentos');
      tocar(s);
      return fim(s);
    },
    async concluir(id) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento']);
      if (s.tipo === 'cadastro') erro('Use "Confirmar cadastro concluído" para cadastros.');
      if (s.tipo === 'estadia') erro('Estadia termina pelo retorno do cliente ou por Encerrar.');
      if (!db.anexos.some((a) => a.solicitacao_id === s.id && SAIDA.includes(a.categoria))) erro('Anexe ao menos um documento emitido (CT-e, MDF-e ou outro) antes de liberar.');
      if (s.tipo === 'lote_emissao' && !s.lote_id) erro('Registre o número do lote gerado no ERP antes de liberar a documentação.');
      if (s.tipo === 'emissao' && !s.lote_id) erro('Esta emissão está na fila do lote em geração: registre o lote na solicitação de lote e emissão antes de liberar.');
      tocar(s, { status: 'documentacao_disponivel', concluido_em: agora(), concluido_por_nome: eu().nome });
      evento(s, 'evento', `Documentação disponível, conferida e liberada por ${eu().nome}`);
      notificar(s.solicitante_id, 'documentacao_disponivel', 'Documentação disponível', `${rotulo(s)} · ${s.retrato.cliente ?? ''}`, s, 'embarque', `disponivel:${s.id}`);
      return fim(s);
    },
    async cancelar(id, motivo) {
      offline();
      const s = carregar(id);
      const p = eu();
      if (FINAIS.includes(s.status)) erro('Solicitação já concluída, encerrada ou cancelada.');
      if (!(ctx.tem('documentacao.cancelar') || (s.solicitante_id === p.id && s.status === 'enviado'))) erro('Você não tem permissão para cancelar esta solicitação.');
      if (!motivo.trim()) erro('Informe o motivo do cancelamento.');
      if (db.lotes.some((l) => l.solicitacao_id === s.id)) erro('O lote já foi registrado nesta solicitação: conclua a emissão em vez de cancelar.');
      tocar(s, { status: 'cancelado', cancelado_em: agora(), cancelado_por_nome: p.nome, cancelado_motivo: motivo.trim().slice(0, 1000) });
      evento(s, 'evento', `Solicitação cancelada por ${p.nome}: ${motivo.trim()}`);
      if (s.tipo === 'estadia') notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia cancelada', `${rotulo(s)} · ${motivo.trim().slice(0, 140)}`, s, 'estadia', `estadia_cancelada:${s.id}:${s.versao}`);
      return fim(s);
    },
    async criarCadastro(d, anexos) {
      offline();
      await pronto;
      exigir('cadastro.solicitar');
      const p = eu();
      const rep = db.solicitacoes.find((s) => s.solicitante_id === p.id && (s as SolicitacaoDoc & { chave_envio?: string }).chave_envio === d.chave_envio);
      if (rep) return { status: 'ok', registro: clone(rep), repetido: true };
      const placa = d.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!PLACA.test(placa)) erro('Placa do cavalo inválida: use o formato ABC1D23 ou ABC1234.');
      if (!telefoneValido(d.telefone_motorista ?? '')) erro('Telefone do motorista inválido: informe DDD + número.');
      if (!(Number(d.valor_carga) > 0)) erro('Informe o valor da carga (maior que zero).');
      if (!d.mercadoria?.trim()) erro('Informe a mercadoria.');
      const ouf = (d.origem_uf ?? '').trim().toUpperCase();
      const duf = (d.destino_uf ?? '').trim().toUpperCase();
      if (!d.origem_cidade?.trim() || !/^[A-Z]{2}$/.test(ouf)) erro('Informe a origem (cidade e UF).');
      if (!d.destino_cidade?.trim() || !/^[A-Z]{2}$/.test(duf)) erro('Informe o destino (cidade e UF).');
      if (typeof d.primeiro_embarque !== 'boolean') erro('Responda se é o primeiro embarque do motorista.');
      const c = ctx.cliente(d.cliente_id);
      if (!c) erro('Selecione um cliente autorizado.');
      if (d.filial_id && !ctx.noEscopo(d.filial_id, null)) erro('Filial fora do seu escopo.');
      if (!d.filial_id && !ctx.ehAdmin() && ctx.temFiliais()) erro('Selecione a filial.');
      const aberta = db.solicitacoes.find((s) => s.tipo === 'cadastro' && s.placa === placa && ['enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida'].includes(s.status));
      if (aberta) return { status: 'cadastro_aberto', numero: aberta.numero, situacao: aberta.status, registro: podeVerReg(aberta) ? clone(aberta) : null } as unknown as ResultadoDoc;
      const conta = (cat: CategoriaAnexo) => (anexos ?? []).filter((a) => a.categoria === cat).length;
      if (!conta('motorista')) erro('Anexe ao menos um documento do motorista.');
      if (!conta('veiculo')) erro('Anexe ao menos um documento dos veículos.');
      if (conta('motorista') > MAX_MOTORISTA) erro('Documentos do motorista: no máximo 4 arquivos.');
      if (conta('veiculo') > MAX_VEICULO) erro('Documentos dos veículos: no máximo 10 arquivos.');
      const f = d.filial_id ? ctx.filial(d.filial_id) : null;
      const s: SolicitacaoDoc & { chave_envio: string } = {
        id: uid(), numero: ++db.seq, embarque_id: null, lote_id: null, tipo: 'cadastro', status: 'enviado', placa, placas_reboque: [],
        frete_empresa: 0, frete_empresa_unidade: 'rs_tonelada', frete_motorista: 0, frete_motorista_unidade: 'rs_tonelada', tipo_operacao: null,
        forma_pagamento: 'pagbem', pedagio: 'nao_ha', exige_obs_cte: false, obs_cte: null, cte_por_nf: false,
        observacoes: d.observacoes?.trim().slice(0, 2000) || null,
        retrato: { codigo: null, cliente: c.nome, cliente_id: c.id, carteira: c.carteira, filial: f?.nome ?? null, filial_id: f?.id ?? null,
          centro_custo: f?.centro_custo ?? null, centro_custo_id: f?.centro_custo_id ?? null, origem_cidade: d.origem_cidade.trim(), origem_uf: ouf,
          coleta: null, destino_cidade: d.destino_cidade.trim(), destino_uf: duf, entrega: null, produto: d.mercadoria.trim(), lote_numero: null },
        filial_id: f?.id ?? null, comercial_id: c.comercial_id, cliente_id: c.id, telefone_motorista: d.telefone_motorista.trim().slice(0, 40),
        mercadoria: d.mercadoria.trim().slice(0, 200), valor_carga: Math.round(Number(d.valor_carga) * 100) / 100,
        origem_cidade: d.origem_cidade.trim(), origem_uf: ouf, destino_cidade: d.destino_cidade.trim(), destino_uf: duf,
        primeiro_embarque: d.primeiro_embarque, erp_referencia: null, retorno_solicitante: null,
        solicitante_id: p.id, solicitante_nome: p.nome, responsavel_id: null, responsavel_nome: null, enviado_em: agora(), assumido_em: null,
        concluido_em: null, concluido_por_nome: null, cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null,
        versao: 1, atualizado_em: agora(), chave_envio: d.chave_envio,
      };
      db.solicitacoes.push(s);
      const antes = db.anexos.length;
      try { vincular(s, anexos, ['motorista', 'veiculo'], null); } catch (x) { db.solicitacoes.pop(); db.anexos.length = antes; db.seq--; throw x; }
      registrarFluxo(s, null);
      evento(s, 'evento', 'Cadastro enviado ao apoio');
      return fim(s);
    },
    async concluirCadastro(id, referencia, retorno) {
      offline();
      const s = carregar(id);
      if (s.tipo !== 'cadastro') erro('Esta solicitação não é de cadastro.');
      if (s.status === 'aguardando_informacao') erro('Há pendência aguardando resposta do comercial: resolva antes de concluir.');
      responsavel(s, ['em_atendimento']);
      const ref = referencia?.trim().slice(0, 120) || null;
      tocar(s, { status: 'cadastro_concluido', concluido_em: agora(), concluido_por_nome: eu().nome, erp_referencia: ref,
        retorno_solicitante: retorno?.trim().slice(0, 2000) || null });
      evento(s, 'evento', `Cadastro concluído no ERP, confirmado por ${eu().nome}${ref ? ` · referência ${ref}` : ''}`, 'conclusao');
      notificar(s.solicitante_id, 'cadastro_concluido', `Cadastro da placa ${s.placa.slice(0, 3)}-${s.placa.slice(3)} concluído`,
        `Cadastro nº ${s.numero} · ${s.retrato.cliente ?? ''}${s.retorno_solicitante ? ` · ${s.retorno_solicitante.slice(0, 120)}` : ''}`, s, 'cadastro', `cadastro_concluido:${s.id}`);
      return fim(s);
    },
    async criarEstadia(d, anexos) {
      offline();
      await pronto;
      exigir('estadia.solicitar');
      const p = eu();
      const rep = db.solicitacoes.find((s) => s.solicitante_id === p.id && (s as SolicitacaoDoc & { chave_envio?: string }).chave_envio === d.chave_envio);
      if (rep) return { status: 'ok', registro: clone(rep), repetido: true };
      if (d.tipo_documento !== 'cte' && d.tipo_documento !== 'nfs') erro('Escolha o tipo de documento (CT-e ou Nota Fiscal de Serviço).');
      const docs = numerosEstadia(d.documentos, 20, d.tipo_documento === 'cte' ? 'o(s) número(s) do CT-e' : 'o(s) número(s) da NFS');
      const nfs = numerosEstadia(d.nfs_carga, 50, 'o(s) número(s) da nota fiscal da carga');
      const placa = (d.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!PLACA.test(placa)) erro('Placa do veículo inválida: use o formato ABC1D23 ou ABC1234.');
      if (typeof d.sindicato !== 'boolean') erro('Responda se possui sindicato.');
      const sindNome = d.sindicato_nome?.trim().slice(0, 120) || null;
      if (d.sindicato && !sindNome) erro('Informe qual sindicato.');
      const ini = Date.parse(d.inicio); const sai = Date.parse(d.saida);
      if (!Number.isFinite(ini) || !Number.isFinite(sai)) erro('Informe início e saída da estadia.');
      if (sai <= ini) erro('A saída precisa ser depois do início da estadia.');
      if (sai > Date.now() + 15 * 60e3) erro('A saída não pode estar no futuro.');
      if (sai - ini > 60 * 86400e3) erro('Permanência acima de 60 dias: confira as datas.');
      if (!(d.tarifa > 0) || d.tarifa > 10000) erro('Informe a tarifa da estadia em R$/t/h (maior que zero).');
      if (d.peso_unidade !== 't' && d.peso_unidade !== 'kg') erro('Escolha a unidade do peso (t ou kg).');
      if (!(d.peso > 0)) erro('Informe o peso do veículo (maior que zero).');
      const pesoT = pesoToneladas(d.peso, d.peso_unidade);
      if (pesoT <= 0) erro('Peso do veículo muito pequeno: confira a unidade.');
      if (pesoT > 100) erro('Peso acima de 100 t: confira o valor e a unidade (t ou kg).');
      if (!MOTIVOS_ESTADIA.includes(d.motivo)) erro('Escolha o motivo da estadia.');
      const outro = d.motivo_outro?.trim().slice(0, 200) || null;
      if (d.motivo === 'outro' && !outro) erro('Descreva o motivo "Outro".');
      if (d.modalidade !== 'padrao' && d.modalidade !== 'acordo') erro('Escolha o tipo de estadia.');
      const acordo = d.modalidade === 'acordo';
      if (acordo) {
        if (!(Number(d.acordo_valor) > 0)) erro('Informe o valor acordado em reais.');
        if (!d.acordo_confirmado_por?.trim()) erro('Informe quem confirmou o acordo.');
        if (!d.acordo_data) erro('Informe a data da confirmação do acordo.');
        if (d.acordo_data > dataSP(Date.now())) erro('A data da confirmação do acordo não pode estar no futuro.');
        if (!d.acordo_descricao?.trim()) erro('Descreva a tratativa do acordo.');
      }
      const c = ctx.cliente(d.cliente_id);
      if (!c) erro('Selecione um cliente autorizado.');
      if (d.filial_id && !ctx.noEscopo(d.filial_id, null)) erro('Filial fora do seu escopo.');
      if (!d.filial_id && !ctx.ehAdmin() && ctx.temFiliais()) erro('Selecione a filial.');
      const inicio = new Date(ini).toISOString(); const saida = new Date(sai).toISOString();
      if (!d.confirmar_duplicidade) {
        const dups: DuplicadaEstadia[] = db.solicitacoes
          .filter((x) => x.tipo === 'estadia' && x.status !== 'cancelado')
          .map((x) => {
            const periodo = x.placa === placa && Date.parse(x.est_inicio!) < sai && ini < Date.parse(x.est_saida!);
            const documento = x.cliente_id === c.id && x.est_tipo_documento === d.tipo_documento && (x.est_documentos ?? []).some((n) => docs.includes(n));
            return periodo || documento ? { id: podeVerReg(x) ? x.id : null, codigo: x.est_codigo!, placa: x.placa, inicio: x.est_inicio!, saida: x.est_saida!,
              status: x.status, motivo: periodo ? 'periodo' : 'documento' } as DuplicadaEstadia : null;
          })
          .filter((x): x is DuplicadaEstadia => !!x);
        if (dups.length) return { status: 'possivel_duplicidade', duplicadas: dups } as unknown as ResultadoDoc;
      }
      for (const [cat, n] of Object.entries(LIMITES_ESTADIA.max)) {
        if ((anexos ?? []).filter((a) => a.categoria === cat).length > n) erro(`No máximo ${n} arquivo(s) em ${ROTULO_CAT_ESTADIA[cat] ?? cat}.`);
      }
      const conta = (cat: CategoriaAnexo) => (anexos ?? []).filter((a) => a.categoria === cat).length;
      if (!conta('est_documento')) erro('Anexe o CT-e ou a Nota Fiscal de Serviço.');
      if (!conta('est_nf_carga')) erro('Anexe a nota fiscal da carga.');
      if (!conta('est_comprovante')) erro('Anexe os comprovantes de início e fim da estadia.');
      if (acordo && !conta('est_tratativa')) erro('Anexe a evidência do acordo com o cliente ou a mesa.');
      const f = d.filial_id ? ctx.filial(d.filial_id) : null;
      const s: SolicitacaoDoc & { chave_envio: string } = {
        ...base(), id: uid(), numero: ++db.seq, tipo: 'estadia', status: 'enviado', placa,
        observacoes: d.observacoes?.trim().slice(0, 2000) || null,
        retrato: { codigo: null, cliente: c.nome, cliente_id: c.id, carteira: c.carteira, filial: f?.nome ?? null, filial_id: f?.id ?? null,
          centro_custo: f?.centro_custo ?? null, centro_custo_id: f?.centro_custo_id ?? null, origem_cidade: '', origem_uf: null,
          coleta: null, destino_cidade: '', destino_uf: null, entrega: null, produto: null, lote_numero: null },
        filial_id: f?.id ?? null, comercial_id: c.comercial_id, cliente_id: c.id,
        est_codigo: `EST-${String((db.seqEstadia = (db.seqEstadia ?? 0) + 1)).padStart(3, '0')}`, est_tipo_documento: d.tipo_documento,
        est_documentos: docs, est_nfs_carga: nfs, est_sindicato: d.sindicato, est_sindicato_nome: d.sindicato ? sindNome : null,
        est_inicio: inicio, est_saida: saida, est_tarifa: d.tarifa, est_peso_t: pesoT, est_peso_informado: d.peso, est_peso_unidade: d.peso_unidade,
        est_motivo: d.motivo, est_motivo_outro: d.motivo === 'outro' ? outro : null, est_modalidade: d.modalidade,
        est_acordo_valor: acordo ? Math.round(Number(d.acordo_valor) * 100) / 100 : null, est_acordo_confirmado_por: acordo ? d.acordo_confirmado_por!.trim().slice(0, 120) : null,
        est_acordo_data: acordo ? d.acordo_data : null, est_acordo_descricao: acordo ? d.acordo_descricao!.trim().slice(0, 2000) : null,
        solicitante_id: p.id, solicitante_nome: p.nome, enviado_em: agora(), versao: 1, atualizado_em: agora(), chave_envio: d.chave_envio,
      };
      db.solicitacoes.push(s);
      const antes = db.anexos.length;
      try { vincular(s, anexos, CATS_ESTADIA, null); } catch (x) { db.solicitacoes.pop(); db.anexos.length = antes; db.seq--; db.seqEstadia!--; throw x; }
      registrarFluxo(s, null);
      evento(s, 'evento', `Estadia ${s.est_codigo} enviada ao apoio`);
      return fim(s);
    },
    conferirEstadia: (id, d, versao) => comTrava(async () => {
      offline();
      const s = carregarEstadia(id, versao);
      responsavel(s, ['em_atendimento']);
      if (d.limite_h == null || d.retroagir_h == null || !Number.isFinite(d.limite_h) || !Number.isFinite(d.retroagir_h)) {
        erro('Informe "Cobrar após quantas horas" e "Horas a retroagir" (zero é um valor válido; vazio não).');
      }
      if (d.limite_h < 0 || d.limite_h > 720 || d.retroagir_h < 0 || d.retroagir_h > 720) erro('Horas entre 0 e 720.');
      const inicio = d.inicio ? new Date(d.inicio).toISOString() : s.est_inicio!;
      const saida = d.saida ? new Date(d.saida).toISOString() : s.est_saida!;
      const tarifa = d.tarifa ?? s.est_tarifa!;
      const peso = Math.round((d.peso_t ?? s.est_peso_t!) * 1000) / 1000;
      if (Date.parse(saida) <= Date.parse(inicio)) erro('A saída precisa ser depois do início da estadia.');
      if (!(tarifa > 0) || tarifa > 10000) erro('Tarifa em R$/t/h maior que zero.');
      if (!(peso > 0) || peso > 100) erro('Peso em toneladas entre 0 e 100: confira a unidade.');
      const obs = d.observacao?.trim().slice(0, 1000) || null;
      const alt: ConferenciaEstadia['alteracoes'] = {};
      if (inicio !== s.est_inicio) alt.inicio = { original: s.est_inicio, usado: inicio };
      if (saida !== s.est_saida) alt.saida = { original: s.est_saida, usado: saida };
      if (tarifa !== s.est_tarifa) alt.tarifa = { original: s.est_tarifa, usado: tarifa };
      if (peso !== s.est_peso_t) alt.peso_t = { original: s.est_peso_t, usado: peso };
      if (Object.keys(alt).length && !obs) erro('Você alterou dados enviados pelo solicitante: explique na observação da conferência.');
      const calc = calcularEstadia({ inicio, saida, tarifa, peso_t: peso, limite_h: d.limite_h, retroagir_h: d.retroagir_h })!;
      const vs = (db.conferencias ??= []).filter((c) => c.solicitacao_id === s.id);
      const ult = vs[vs.length - 1];
      if (ult && ult.inicio === inicio && ult.saida === saida && ult.tarifa === tarifa && ult.peso_t === peso && ult.limite_h === d.limite_h
        && ult.retroagir_h === d.retroagir_h && (ult.observacao ?? null) === obs) return { status: 'sem_alteracao', registro: clone(s) };
      const p = eu();
      const conf: ConferenciaEstadia = { id: uid(), solicitacao_id: s.id, versao: (ult?.versao ?? 0) + 1, inicio, saida, tarifa, peso_t: peso,
        limite_h: d.limite_h, retroagir_h: d.retroagir_h, ...calc, alteracoes: alt, observacao: obs, autor_nome: p.nome, criado_em: agora() };
      db.conferencias.push(conf);
      tocar(s, { est_conferencia_id: conf.id, est_conferencia_versao: conf.versao, est_limite_h: d.limite_h, est_retroagir_h: d.retroagir_h,
        est_horas_validas: calc.horas_validas, est_valor_calculado: calc.valor, est_conferido_em: conf.criado_em, est_conferido_por_nome: p.nome });
      evento(s, 'evento', `Memória de cálculo v${conf.versao} salva: ${tarifa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} × ${fmtToneladas(peso)} × ${calc.horas_validas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h válidas = ${fmtReais(calc.valor)} (limite ${fmtNumeroH(d.limite_h)}, retroagir ${fmtNumeroH(d.retroagir_h)})${Object.keys(alt).length ? ` · dados ajustados pelo apoio: ${obs}` : ''}`, 'calculo');
      return fim(s, { conferencia: clone(conf) });
    }),
    encaminharClienteEstadia: (id, observacao, versao) => comTrava(async () => {
      offline();
      const s = carregarEstadia(id, versao);
      responsavel(s, ['em_atendimento']);
      if (!s.est_conferencia_id) erro('Salve a memória de cálculo antes de aguardar o retorno do cliente.');
      const obs = observacao?.trim().slice(0, 1000) || null;
      tocar(s, { status: 'aguardando_cliente', est_encaminhado_em: agora() });
      evento(s, 'evento', `Encaminhada ao cliente pelo apoio (fora do app), conferência v${s.est_conferencia_versao}: ${fmtReais(s.est_valor_calculado ?? 0)}${obs ? ` · ${obs}` : ''}`, 'cliente');
      notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia aguardando retorno do cliente', `${rotulo(s)} · ${s.retrato.cliente ?? ''} · valor calculado ${fmtReais(s.est_valor_calculado ?? 0)}`, s, 'estadia', `estadia_cliente:${s.id}:${s.versao}`);
      return fim(s);
    }),
    registrarRetornoEstadia: (id, d, anexos, versao) => comTrava(async () => {
      offline();
      const s = carregarEstadia(id, versao);
      responsavel(s, ['em_atendimento', 'aguardando_cliente', 'pago_pendencia']);
      if (!s.est_conferencia_id) erro('Salve a memória de cálculo antes de registrar o retorno do cliente.');
      if (!['aprovada', 'aprovada_parcial', 'rejeitada'].includes(d.resultado)) erro('Escolha o resultado do cliente.');
      const just = d.justificativa?.trim().slice(0, 2000);
      if (!just) erro('Descreva o retorno do cliente (justificativa).');
      const hoje = dataSP(Date.now());
      const data = d.data_retorno || hoje;
      if (data > hoje) erro('A data do retorno não pode estar no futuro.');
      const valor = d.resultado === 'rejeitada' ? null : Math.round((d.resultado === 'aprovada' ? d.valor_aprovado ?? s.est_valor_calculado! : d.valor_aprovado ?? 0) * 100) / 100;
      if (d.resultado !== 'rejeitada' && !(valor! > 0)) erro('Informe o valor aprovado pelo cliente (maior que zero).');
      if (!(anexos ?? []).some((a) => a.categoria === 'est_retorno')) erro('Anexe a evidência do retorno do cliente.');
      if (anexos.filter((a) => a.categoria === 'est_retorno').length > LIMITES_ESTADIA.max.est_retorno) erro(`No máximo ${LIMITES_ESTADIA.max.est_retorno} arquivo(s) em evidência do retorno.`);
      const antes = s.status;
      const novo: StatusDoc = d.resultado === 'aprovada' ? 'aprovada' : d.resultado === 'aprovada_parcial' ? 'aprovada_parcial' : 'em_atendimento';
      const m = evento(s, 'evento', `Retorno do cliente registrado (${data.split('-').reverse().join('/')}): ${RESULTADO_ESTADIA[d.resultado]}${valor != null ? `, valor aprovado ${fmtReais(valor)}` : ''} · ${just}${
        antes === 'pago_pendencia' && novo === 'aprovada' ? ' · situação Pago em pendência → Aprovada (pagamento e pendência de receita continuam registrados)'
        : antes === 'pago_pendencia' && novo === 'aprovada_parcial' ? ' · situação Pago em pendência → Aprovada parcialmente (pagamento continua registrado)' : ''}`, 'retorno');
      try { vincular(s, anexos, ['est_retorno'], m.id); } catch (x) { db.mensagens.pop(); throw x; }
      const p = eu();
      const ret: RetornoEstadia = { id: uid(), solicitacao_id: s.id, resultado: d.resultado, valor_aprovado: valor, justificativa: just, data_retorno: data,
        conferencia_id: s.est_conferencia_id, valor_calculado: s.est_valor_calculado ?? 0, status_anterior: antes, status_novo: novo, mensagem_id: m.id,
        autor_nome: p.nome, criado_em: agora() };
      (db.retornos ??= []).push(ret);
      const fecha = novo === 'aprovada' || novo === 'aprovada_parcial';
      tocar(s, { status: novo, est_resultado: d.resultado, est_valor_aprovado: valor, est_retorno_em: agora(),
        ...(fecha ? { concluido_em: agora(), concluido_por_nome: p.nome } : {}) });
      notificar(s.solicitante_id, 'estadia_atualizada',
        d.resultado === 'aprovada' ? 'Estadia aprovada pelo cliente' : d.resultado === 'aprovada_parcial' ? 'Estadia aprovada parcialmente' : 'Estadia rejeitada pelo cliente',
        `${rotulo(s)} · ${s.retrato.cliente ?? ''}${valor != null ? ` · ${fmtReais(valor)}` : ''}`, s, 'estadia', `estadia_retorno:${ret.id}`);
      return fim(s);
    }),
    registrarPagamentoEstadia: (id, d, anexos, versao) => comTrava(async () => {
      offline();
      const s = carregarEstadia(id, versao);
      responsavel(s, ['em_atendimento', 'aguardando_cliente', 'pago_pendencia']);
      if (!s.est_conferencia_id) erro('Salve a memória de cálculo antes de registrar o pagamento.');
      if (!(d.valor_pago > 0)) erro('Informe o valor efetivamente pago (maior que zero).');
      if (!d.data_pagamento) erro('Informe a data do pagamento.');
      if (d.data_pagamento > dataSP(Date.now())) erro('A data do pagamento não pode estar no futuro.');
      if (!(anexos ?? []).some((a) => a.categoria === 'est_pagamento')) erro('Anexe o comprovante do pagamento.');
      if (anexos.filter((a) => a.categoria === 'est_pagamento').length > LIMITES_ESTADIA.max.est_pagamento) erro(`No máximo ${LIMITES_ESTADIA.max.est_pagamento} arquivo(s) em comprovante de pagamento.`);
      const obs = d.observacao?.trim().slice(0, 1000) || null;
      const valor = Math.round(d.valor_pago * 100) / 100;
      const m = evento(s, 'evento', `Pagamento informado (feito fora do app) em ${d.data_pagamento.split('-').reverse().join('/')}: ${fmtReais(valor)}, com receita pendente${obs ? ` · ${obs}` : ''}`, 'pagamento');
      try { vincular(s, anexos, ['est_pagamento'], m.id); } catch (x) { db.mensagens.pop(); throw x; }
      const pag: PagamentoEstadia = { id: uid(), solicitacao_id: s.id, valor_pago: valor, data_pagamento: d.data_pagamento, observacao: obs,
        conferencia_id: s.est_conferencia_id, mensagem_id: m.id, autor_nome: eu().nome, criado_em: agora() };
      (db.pagamentos ??= []).push(pag);
      const todos = db.pagamentos.filter((x) => x.solicitacao_id === s.id);
      tocar(s, { status: 'pago_pendencia', est_valor_pago: Math.round(todos.reduce((a, x) => a + x.valor_pago, 0) * 100) / 100,
        est_pago_em: todos.map((x) => x.data_pagamento).sort().pop() ?? null });
      notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia paga com receita pendente', `${rotulo(s)} · ${s.retrato.cliente ?? ''} · pago ${fmtReais(valor)}`, s, 'estadia', `estadia_pagamento:${pag.id}`);
      return fim(s);
    }),
    encerrarEstadia: (id, motivo, versao) => comTrava(async () => {
      offline();
      const s = carregarEstadia(id, versao);
      responsavel(s, ['em_atendimento']);
      if (s.est_resultado !== 'rejeitada') erro('Encerrar vale para estadia que não gerou cobrança: registre antes o retorno do cliente como Rejeitada.');
      const m = motivo?.trim().slice(0, 1000);
      if (!m) erro('Informe o motivo do encerramento.');
      const p = eu();
      tocar(s, { status: 'encerrado', est_encerrado_motivo: m, concluido_em: agora(), concluido_por_nome: p.nome });
      evento(s, 'evento', `Estadia encerrada sem cobrança por ${p.nome}: ${m}${s.est_valor_pago != null ? ` · pagamento informado de ${fmtReais(s.est_valor_pago)} continua registrado` : ''}`, 'encerramento');
      notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia encerrada', `${rotulo(s)} · ${s.retrato.cliente ?? ''} · ${m.slice(0, 120)}`, s, 'estadia', `estadia_encerrada:${s.id}:${s.versao}`);
      return fim(s);
    }),
    reabrirEstadia: (id, motivo) => comTrava(async () => {
      offline();
      exigir('estadia.reabrir');
      const s = carregarEstadia(id, null);
      if (!['cancelado', 'encerrado', 'aprovada', 'aprovada_parcial'].includes(s.status)) erro('Só estadia cancelada, encerrada ou aprovada pode ser reaberta.');
      const m = motivo?.trim().slice(0, 1000);
      if (!m) erro('Informe o motivo da reabertura.');
      const antes = s.status;
      tocar(s, { status: s.responsavel_id ? 'em_atendimento' : 'enviado', concluido_em: null, concluido_por_nome: null });
      evento(s, 'evento', `Estadia reaberta por ${eu().nome} (estava ${antes === 'cancelado' ? 'Cancelada' : antes === 'encerrado' ? 'Encerrada' : antes === 'aprovada' ? 'Aprovada' : 'Aprovada parcialmente'}): ${m}`, 'reabertura');
      notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia reaberta', `${rotulo(s)} · ${m.slice(0, 140)}`, s, 'estadia', `estadia_reaberta:${s.id}:${s.versao}`);
      notificar(s.responsavel_id, 'estadia_atualizada', 'Estadia reaberta para você', `${rotulo(s)} · ${m.slice(0, 140)}`, s, 'apoio', `estadia_reaberta_apoio:${s.id}:${s.versao}`);
      return fim(s);
    }),
    async buscarEstadias(campo, valor) {
      await pronto;
      eu();
      const v = campo === 'placa' ? valor.toUpperCase().replace(/[^A-Z0-9]/g, '') : valor.trim().toUpperCase();
      return clone(visiveis().filter((s) => s.tipo === 'estadia'
        && (campo === 'placa' ? s.placa === v : s.est_tipo_documento === 'cte' && (s.est_documentos ?? []).includes(v)))
        .sort((a, b) => b.enviado_em.localeCompare(a.enviado_em)).map(comNomes));
    },
    async notificacoes() {
      await pronto;
      const p = ctx.perfil();
      if (!p) return [];
      return clone(db.notificacoes.filter((n) => n.destinatario_id === p.id && db.solicitacoes.some((s) => s.id === n.solicitacao_id && podeVerReg(s)))
        .sort((a, b) => b.criada_em.localeCompare(a.criada_em)));
    },
    async marcarLidas(ids) {
      const p = eu();
      for (const n of db.notificacoes) if (n.destinatario_id === p.id && !n.lida_em && (!ids || ids.includes(n.id))) n.lida_em = agora();
      salvar();
      emitir({ tabela: 'notificacoes' });
    },
    assinar(aoEvento, aoEstado) {
      ouvintes.add(aoEvento);
      const t = setTimeout(() => aoEstado(navigator.onLine), 80);
      const on = () => aoEstado(true);
      const off = () => aoEstado(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => { clearTimeout(t); ouvintes.delete(aoEvento); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    },
  };
}

// ---------------------------------------------------------------------------
// Painel Operacional na prévia
// ---------------------------------------------------------------------------
/** Eventos a partir dos horários gravados (mesma regra da migração 1900). */
function eventosDosRegistros(db: BancoDoc, origem: EventoPainel['origem']): EventoPainel[] {
  const out: EventoPainel[] = [];
  const ev = (s: SolicitacaoDoc, evento: EventoFluxo, em: string | null, motivo: MotivoDevolucao | null = null) => {
    if (em) out.push({ s: s.id, evento, em, responsavel_id: evento === 'enviado' ? null : s.responsavel_id,
      responsavel_nome: evento === 'enviado' ? null : s.responsavel_nome, motivo, origem });
  };
  for (const s of db.solicitacoes) {
    ev(s, 'enviado', s.enviado_em);
    if (s.responsavel_id) ev(s, 'assumido', s.assumido_em);
    for (const m of db.mensagens.filter((x) => x.solicitacao_id === s.id)) {
      if (m.tipo === 'pendencia') ev(s, 'devolvido', m.criado_em, m.motivo ?? 'sem_registro');
      if (m.tipo === 'resposta') { ev(s, 'corrigido', m.criado_em); ev(s, 'retomado', m.criado_em); }
    }
    if (s.tipo === 'estadia') {
      if (s.est_encaminhado_em) ev(s, 'enviado_cliente', s.est_encaminhado_em);
      for (const p of (db.pagamentos ?? []).filter((x) => x.solicitacao_id === s.id)) ev(s, 'pago_pendencia', p.criado_em);
      if (s.est_resultado === 'rejeitada' && s.est_retorno_em) ev(s, 'retorno_cliente', s.est_retorno_em);
    }
    if (CONCLUSOES.includes(s.status)) ev(s, 'concluido', s.concluido_em);
    if (s.status === 'cancelado') ev(s, 'cancelado', s.cancelado_em);
  }
  return out;
}

function aleatorio(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLABORADORES_PREVIA: Array<[string, string, number]> = [
  ['previa-ana', 'Ana Souza (prévia)', 5], ['previa-bruno', 'Bruno Lima (prévia)', 4], ['previa-carla', 'Carla Mendes (prévia)', 4],
  ['previa-diego', 'Diego Rocha (prévia)', 3], ['perfil-2', 'Apoio Operacional (prévia)', 2],
];
const SOLICITANTES_PREVIA: Array<[string, string]> = [
  ['perfil-1', 'Gestor Rio Verde (prévia)'], ['perfil-5', 'Supervisor Jataí (prévia)'], ['perfil-6', 'Embarcador (prévia)'],
  ['perfil-3', 'Coordenador Comercial (prévia)'],
];
const MOTIVOS_PREVIA: MotivoDevolucao[] = ['documento_ausente', 'documento_ausente', 'documento_ilegivel', 'divergencia_dados', 'divergencia_dados', 'informacao_incompleta', 'outro'];
/** Chegadas por hora (pico de manhã e no meio da tarde; poucas à noite). */
const PESO_HORA = [0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 1.5, 4, 8, 9, 8, 6, 3, 5, 8, 8, 7, 5, 3, 1.5, 1, 0.8, 0.5, 0.3];
const cacheFicticio = new Map<string, { solicitacoes: SolPainel[]; eventos: EventoPainel[]; inicio: string }>();

/** 75 dias de chamados fictícios já encerrados, iguais a cada consulta (semente por dia). Nunca vão para o servidor. */
function historicoFicticio(filiais: Array<{ id: string; centro: string | null }>, agoraMs: number) {
  const chave = `${filiais.map((f) => f.id).join()}|${Math.floor(agoraMs / 300e3)}`;
  const c = cacheFicticio.get(chave);
  if (c) return c;
  const H = 3600e3;
  const MIN = 60e3;
  const DIA = 86400e3;
  const hoje0 = inicioDiaSP(dataSP(agoraMs));
  const inicio = hoje0 - 75 * DIA;
  const sols: SolPainel[] = [];
  const evs: EventoPainel[] = [];
  const somaPeso = PESO_HORA.reduce((a, b) => a + b, 0);
  const somaColab = COLABORADORES_PREVIA.reduce((a, x) => a + x[2], 0);
  let numero = 90000;
  for (let d = 75; d >= 0; d--) {
    const dia0 = hoje0 - d * DIA;
    const r = aleatorio(Math.floor(dia0 / DIA) * 7919);
    const dow = diaHoraSP(dia0 + 12 * H).dia;
    const base = dow < 5 ? 14 : dow === 5 ? 5 : 2;
    const n = Math.round(base * (0.7 + 0.6 * r()));
    for (let k = 0; k < n; k++) {
      let x = r() * somaPeso;
      let hora = 0;
      while (hora < 23 && x > PESO_HORA[hora]) { x -= PESO_HORA[hora]; hora++; }
      let t = dia0 + hora * H + Math.floor(r() * H);
      const u = r();
      const tipo: SolPainel['tipo'] = u < 0.42 ? 'emissao' : u < 0.6 ? 'lote_emissao' : u < 0.88 ? 'cadastro' : 'estadia';
      let y = r() * somaColab;
      const colab = COLABORADORES_PREVIA.find((cb) => (y -= cb[2]) < 0) ?? COLABORADORES_PREVIA[0];
      const sol = SOLICITANTES_PREVIA[Math.floor(r() * SOLICITANTES_PREVIA.length)];
      const fil = filiais.length ? filiais[Math.floor(r() * filiais.length)] : { id: null, centro: null };
      const id = `previa-hist-${dia0}-${k}`;
      const lista: EventoPainel[] = [];
      const resp = { responsavel_id: colab[0], responsavel_nome: colab[1] };
      const ev = (evento: EventoFluxo, em: number, motivo: MotivoDevolucao | null = null, comResp = true) =>
        lista.push({ s: id, evento, em: new Date(em).toISOString(), ...(comResp ? resp : { responsavel_id: null, responsavel_nome: null }), motivo, origem: 'registro' });
      const enviado = t;
      ev('enviado', t, null, false);
      // Estadia: prazo de 24 h na fila; depois do atendimento, espera o retorno do cliente (fora do atendimento ativo).
      t += (tipo === 'estadia' ? 20 + r() * r() * 1700 : 2 + r() * r() * 45) * MIN;
      let status: SolPainel['status'] = tipo === 'cadastro' ? 'cadastro_concluido' : tipo === 'estadia' ? 'aprovada' : 'documentacao_disponivel';
      if (r() < 0.03) { ev('cancelado', t, null, false); status = 'cancelado'; } else {
        ev('assumido', t);
        let voltas = r() < 0.22 ? (r() < 0.25 ? 2 : 1) : 0;
        while (voltas-- > 0) {
          t += (5 + r() * 30) * MIN;
          ev('devolvido', t, MOTIVOS_PREVIA[Math.floor(r() * MOTIVOS_PREVIA.length)]);
          t += (15 + r() * r() * 240) * MIN;
          ev('corrigido', t);
          t += (1 + r() * 20) * MIN;
          ev('retomado', t);
        }
        t += ((tipo === 'cadastro' ? 15 : 8) + r() * 50) * MIN;
        if (tipo === 'estadia') {
          ev('enviado_cliente', t);
          t += (4 + r() * 70) * H;
          const x = r();
          if (x < 0.25) { ev('pago_pendencia', t); t += (6 + r() * 48) * H; }
          if (x > 0.85) { ev('retorno_cliente', t); t += (5 + r() * 30) * MIN; status = 'encerrado'; }
          else if (x > 0.7) status = 'aprovada_parcial';
        }
        ev('concluido', t);
      }
      if (t > agoraMs - 5 * MIN) continue; // só chamados já encerrados
      sols.push({ id, numero: ++numero, tipo, status, filial_id: fil.id, centro_custo_id: fil.centro, solicitante_id: sol[0], solicitante_nome: sol[1],
        responsavel_id: status === 'cancelado' ? null : colab[0], responsavel_nome: status === 'cancelado' ? null : colab[1], enviado_em: new Date(enviado).toISOString() });
      evs.push(...lista);
    }
  }
  const res = { solicitacoes: sols, eventos: evs, inicio: new Date(inicio).toISOString() };
  cacheFicticio.clear();
  cacheFicticio.set(chave, res);
  return res;
}
