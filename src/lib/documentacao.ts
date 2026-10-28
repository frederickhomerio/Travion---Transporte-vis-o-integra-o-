// Regras de apresentação da documentação (Apoio Operacional). Funções puras; quem decide é o servidor.

import type {
  CategoriaAnexo, FormaPagamento, LoteErp, TitularPix, MotivoDevolucao, Pedagio, SolicitacaoDoc, StatusDoc, TipoOperacao, TipoSolicitacaoDoc, UnidadeFreteDoc,
} from '../types';
import { cidadeAnuncio } from './anuncio';
import { normalizar } from './texto';
import { resumoEstadia } from './estadia';

export const TIPO_DOC: Record<TipoSolicitacaoDoc, string> = { lote_emissao: 'Lote e Emissão', emissao: 'Emissão', cadastro: 'Cadastro', estadia: 'Estadia' };
export const STATUS_DOC: Record<StatusDoc, string> = {
  enviado: 'Enviado', em_atendimento: 'Em atendimento', aguardando_informacao: 'Aguardando informação', correcao_recebida: 'Correção recebida',
  documentacao_disponivel: 'Documentação disponível', cadastro_concluido: 'Cadastro concluído', cancelado: 'Cancelado',
  aguardando_cliente: 'Aguardando retorno do cliente', pago_pendencia: 'Pago em pendência', aprovada: 'Aprovada',
  aprovada_parcial: 'Aprovada parcialmente', encerrado: 'Encerrado',
};
export const UNIDADE_DOC: Record<UnidadeFreteDoc, string> = { rs_tonelada: 'R$/t', rs_viagem: 'R$/viagem' };
export const OPERACAO: Record<TipoOperacao, string> = { exportacao: 'Exportação', mi_tributado: 'Mercado Interno Tributado', mi_isento: 'Mercado Interno Isento' };
export const PAGAMENTO: Record<FormaPagamento, string> = { cheque: 'Cheque', pagbem: 'Pagbem', pix: 'PIX' };
export const TITULAR_PIX: Record<TitularPix, string> = { proprietario: 'Chave do proprietário', motorista: 'Chave do motorista' };
/** "PIX · Chave do motorista: 64999…" ou só o nome da forma de pagamento. */
export const textoPagamento = (s: Pick<SolicitacaoDoc, 'forma_pagamento' | 'pix_titular' | 'pix_chave'>) =>
  s.forma_pagamento === 'pix' && s.pix_titular ? `PIX · ${TITULAR_PIX[s.pix_titular]}: ${s.pix_chave ?? '—'}` : PAGAMENTO[s.forma_pagamento] ?? '—';
export const PEDAGIO: Record<Pedagio, string> = { sem_parar: 'Sem Parar', move_mais: 'Move Mais', conect_car: 'Conect Car', veloe: 'Veloe', nao_ha: 'Não há' };
export const CATEGORIA: Record<CategoriaAnexo, string> = {
  nf: 'NF', evidencia_frete: 'Evidência do frete', correcao: 'Correção', cte: 'CT-e', mdfe: 'MDF-e', outro_emitido: 'Outro documento emitido',
  motorista: 'Documento do motorista', veiculo: 'Documento do veículo',
  est_documento: 'CT-e ou Nota Fiscal de Serviço', est_nf_carga: 'Nota fiscal da carga', est_comprovante: 'Comprovante de início e fim',
  est_agendamento: 'Agendamento', est_tratativa: 'Tratativa com cliente ou mesa', est_retorno: 'Evidência do retorno do cliente',
  est_pagamento: 'Comprovante de pagamento',
};
export const CATEGORIAS_SAIDA: CategoriaAnexo[] = ['cte', 'mdfe', 'outro_emitido'];
export const ABERTOS: StatusDoc[] = ['enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'aguardando_cliente', 'pago_pendencia'];
/** Motivos da devolução (pedir ajuste). */
export const MOTIVO_DEVOLUCAO: Record<MotivoDevolucao, string> = {
  documento_ausente: 'Documento ausente', documento_ilegivel: 'Documento ilegível', divergencia_dados: 'Divergência de dados',
  informacao_incompleta: 'Informação incompleta', outro: 'Outro', sem_registro: 'Sem registro',
};
export const MOTIVOS_ESCOLHA: MotivoDevolucao[] = ['documento_ausente', 'documento_ilegivel', 'divergencia_dados', 'informacao_incompleta', 'outro'];
export const TIPOS_ARQUIVO = 'application/pdf,image/png,image/jpeg,image/webp';
export const LIMITE_ARQUIVO = 15 * 1024 * 1024;
export const PLACA_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

// Cadastro: os formatos do formulário de referência (PDF, imagem, Word, Excel, PowerPoint, vídeo, áudio), até 10 MB.
export const TIPOS_CADASTRO: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/aac': 'aac', 'audio/webm': 'weba',
};
/** Extensão → tipo, para arquivos que o navegador entrega sem tipo (comum em .heic, .ogg, .opus do WhatsApp). */
const EXT_CADASTRO: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac',
};
export const ACEITA_CADASTRO = [...Object.keys(TIPOS_CADASTRO), ...Object.keys(EXT_CADASTRO).map((e) => `.${e}`)].join(',');
export const LIMITE_CADASTRO = 10 * 1024 * 1024;
export const MAX_MOTORISTA = 4;
export const MAX_VEICULO = 10;
export const FORMATOS_CADASTRO = 'PDF, imagem (JPG, PNG, WEBP, GIF, HEIC), Word, Excel, PowerPoint, vídeo (MP4, MOV, WEBM, 3GP) e áudio (MP3, M4A, OGG/OPUS, WAV, AAC)';

/** Tipo do arquivo do cadastro: o do navegador, ou deduzido da extensão; null se não for aceito. */
export function tipoCadastro(nome: string, mime: string): string | null {
  if (TIPOS_CADASTRO[mime]) return mime;
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  return (!mime || mime === 'application/octet-stream') && EXT_CADASTRO[ext] ? EXT_CADASTRO[ext] : null;
}

/** Telefone com DDD (10 ou 11 dígitos; aceita +55 e zero de operadora). Guarda-se o texto digitado. */
export function telefoneValido(t: string): boolean {
  let d = t.replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
  if (/^0\d{10,11}$/.test(d)) d = d.slice(1);
  return /^[1-9][1-9]\d{8,9}$/.test(d);
}

/** Valor em reais no padrão brasileiro: "85.000,00" → 85000. Vazio → null; inválido → NaN. */
export function lerReais(t: string): number | null {
  const s = t.trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  let n: number;
  if (s.includes(',')) n = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : NaN;
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''));
  else n = /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) ? n : NaN;
}
/** Referências da pendência no Cadastro (o que o apoio pede para corrigir). */
export const REF_CADASTRO: Record<string, string> = {
  '': 'Geral', motorista: 'Documento do motorista', veiculo: 'Documento do veículo', placa: 'Placa do cavalo', telefone: 'Telefone do motorista',
  valor: 'Valor da carga', cliente: 'Cliente', rota: 'Origem / destino', mercadoria: 'Mercadoria',
};
export const fmtReais2 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const normalizarPlaca = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const fmtPlaca = (p: string) => (p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p);
export const rotaDoc = (s: SolicitacaoDoc) =>
  `${cidadeAnuncio(s.retrato.origem_cidade, s.retrato.origem_uf)} ➜ ${cidadeAnuncio(s.retrato.destino_cidade, s.retrato.destino_uf)}`;
export const fmtFrete = (v: number, u: UnidadeFreteDoc) =>
  `${v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} ${UNIDADE_DOC[u]}`;

/** Duração legível: "8 min", "2 h 05 min", "3 d 4 h". */
export function duracao(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const CONCLUIDOS: StatusDoc[] = ['documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado'];

/** Tempo de espera (aberta) ou total até a conclusão. */
export function tempoDoc(s: SolicitacaoDoc, agora: number): { rotulo: string; texto: string } {
  if (CONCLUIDOS.includes(s.status) && s.concluido_em) return { rotulo: 'Total', texto: duracao(Date.parse(s.concluido_em) - Date.parse(s.enviado_em)) };
  if (s.status === 'cancelado') return { rotulo: 'Cancelada', texto: '—' };
  return { rotulo: s.status === 'enviado' ? 'Aguardando há' : 'Aberta há', texto: duracao(agora - Date.parse(s.enviado_em)) };
}

/** Quem precisa agir agora. */
export function vezDe(s: SolicitacaoDoc): string | null {
  if (s.status === 'aguardando_informacao') return `Resposta de ${s.solicitante_nome}`;
  if (s.status === 'enviado') return 'Apoio (ninguém assumiu)';
  if (s.status === 'em_atendimento') return `Apoio: ${s.responsavel_nome ?? '—'}`;
  if (s.status === 'aguardando_cliente') return `Cliente (registra: ${s.responsavel_nome ?? '—'})`;
  if (s.status === 'pago_pendencia') return `Retorno do cliente (registra: ${s.responsavel_nome ?? '—'})`;
  if (s.status === 'correcao_recebida') return `Apoio: retomar (${s.responsavel_nome ?? '—'})`;
  return null;
}

export type AcaoDoc = { tipo: 'gerar' } | { tipo: 'acompanhar'; solicitacao: SolicitacaoDoc } | { tipo: 'emitir'; lote: LoteErp };

/** Botão de Detalhes do embarque: Gerar lote e emissão / Acompanhar solicitação / Emitir documentação. */
export function acaoDocumentacao(lote: LoteErp | undefined, doEmbarque: SolicitacaoDoc[]): AcaoDoc {
  if (lote) return { tipo: 'emitir', lote };
  const aberta = doEmbarque.find((s) => s.tipo === 'lote_emissao' && s.status !== 'cancelado');
  return aberta ? { tipo: 'acompanhar', solicitacao: aberta } : { tipo: 'gerar' };
}

/** Avisos de possível duplicidade (não impedem: a mesma placa pode fazer viagens diferentes). */
export function avisosDuplicidade(placa: string, nomesNf: string[], doEmbarque: SolicitacaoDoc[], agora = Date.now()): string[] {
  const p = normalizarPlaca(placa);
  const avisos: string[] = [];
  const recentes = doEmbarque.filter((s) => s.status !== 'cancelado' && agora - Date.parse(s.enviado_em) < 48 * 3600e3);
  const mesmaPlaca = recentes.filter((s) => s.placa === p);
  if (p && mesmaPlaca.length) {
    avisos.push(`A placa ${fmtPlaca(p)} já tem ${mesmaPlaca.length === 1 ? 'a solicitação' : 'as solicitações'} ${mesmaPlaca.map((s) => `nº ${s.numero}`).join(', ')} neste embarque nas últimas 48 horas.`);
  }
  const nomes = new Set(nomesNf.map((n) => normalizar(n)));
  const repetidas = doEmbarque.filter((s) => s.status !== 'cancelado' && (s.nomes_nf ?? []).some((n) => nomes.has(normalizar(n))));
  if (repetidas.length) avisos.push(`Arquivo de NF com o mesmo nome já enviado na solicitação ${repetidas.map((s) => `nº ${s.numero}`).join(', ')}.`);
  return avisos;
}

export type Atalho = 'abertas' | 'novas' | 'minhas' | 'aguardando' | 'cliente' | 'concluidas';
export interface FiltrosFila { atalho: Atalho; busca: string; filial: string; centro: string; responsavel: string; tipo: TipoSolicitacaoDoc | '' }
export const FILTROS_FILA: FiltrosFila = { atalho: 'abertas', busca: '', filial: '', centro: '', responsavel: '', tipo: '' };

export function noAtalho(s: SolicitacaoDoc, atalho: Atalho, eu: string): boolean {
  switch (atalho) {
    case 'abertas': return ABERTOS.includes(s.status);
    case 'novas': return s.status === 'enviado';
    case 'minhas': return s.responsavel_id === eu && ABERTOS.includes(s.status) && s.status !== 'enviado';
    case 'aguardando': return s.status === 'aguardando_informacao';
    case 'cliente': return s.status === 'aguardando_cliente' || s.status === 'pago_pendencia';
    case 'concluidas': return CONCLUIDOS.includes(s.status) || s.status === 'cancelado';
  }
}

/** Filtros da fila sem o atalho: valem para a lista e para os números de cada atalho. */
export function filtrarSemAtalho(ss: SolicitacaoDoc[], f: Omit<FiltrosFila, 'atalho'>): SolicitacaoDoc[] {
  const t = normalizar(f.busca);
  const tPlaca = normalizarPlaca(f.busca);
  return ss
    .filter((s) => !f.tipo || s.tipo === f.tipo)
    .filter((s) => !f.filial || s.retrato.filial_id === f.filial)
    .filter((s) => !f.centro || (s.retrato.centro_custo_id ?? '') === f.centro)
    .filter((s) => !f.responsavel || (f.responsavel === '-' ? !s.responsavel_id : s.responsavel_id === f.responsavel))
    .filter((s) => !t || (tPlaca.length >= 3 && [s.placa, ...s.placas_reboque].some((p) => p.includes(tPlaca)))
      || normalizar(s.retrato.lote_numero ?? '').includes(t) || normalizar(s.retrato.cliente ?? '').includes(t)
      || String(s.numero) === f.busca.trim() || (s.nomes_nf ?? []).some((n) => normalizar(n).includes(t))
      || normalizar(s.est_codigo ?? '') === t || [...(s.est_documentos ?? []), ...(s.est_nfs_carga ?? [])].some((n) => normalizar(n) === t));
}

export function filtrarFila(ss: SolicitacaoDoc[], f: FiltrosFila, eu: string): SolicitacaoDoc[] {
  return filtrarSemAtalho(ss, f)
    .filter((s) => noAtalho(s, f.atalho, eu))
    .sort((a, b) => (f.atalho === 'concluidas'
      ? (b.concluido_em ?? b.cancelado_em ?? b.atualizado_em).localeCompare(a.concluido_em ?? a.cancelado_em ?? a.atualizado_em)
      : a.enviado_em.localeCompare(b.enviado_em)));
}

/** Texto para colar no ERP ou numa conversa. */
export function resumoDoc(s: SolicitacaoDoc): string {
  const r = s.retrato;
  if (s.tipo === 'estadia') return resumoEstadia(s);
  if (s.tipo === 'cadastro') {
    return [
      `Cadastro nº ${s.numero}`,
      `Placa do cavalo: ${fmtPlaca(s.placa)}`,
      `Telefone do motorista: ${s.telefone_motorista ?? '—'}`,
      `Mercadoria: ${s.mercadoria ?? '—'}`,
      `Cliente: ${r.cliente ?? '—'}`,
      `Valor da carga: ${s.valor_carga != null ? fmtReais2(s.valor_carga) : '—'}`,
      `Origem: ${cidadeAnuncio(r.origem_cidade, r.origem_uf)}`,
      `Destino: ${cidadeAnuncio(r.destino_cidade, r.destino_uf)}`,
      `Primeiro embarque do motorista: ${s.primeiro_embarque ? 'Sim' : 'Não'}`,
      r.filial ? `Filial: ${r.filial}${r.centro_custo ? ` · Centro de custo: ${r.centro_custo}` : ''}` : null,
      s.observacoes ? `Observações: ${s.observacoes}` : null,
      `Solicitante: ${s.solicitante_nome}`,
    ].filter(Boolean).join('\n');
  }
  return [
    `${TIPO_DOC[s.tipo]} nº ${s.numero}`,
    `Cliente: ${r.cliente ?? '—'}`,
    `Lote: ${r.lote_numero ?? 'a gerar'}`,
    `Placa: ${fmtPlaca(s.placa)}${s.placas_reboque.length ? ` + ${s.placas_reboque.map(fmtPlaca).join(', ')}` : ''}`,
    `Origem: ${cidadeAnuncio(r.origem_cidade, r.origem_uf)}${r.coleta ? ` (${r.coleta})` : ''}`,
    `Destino: ${cidadeAnuncio(r.destino_cidade, r.destino_uf)}${r.entrega ? ` (${r.entrega})` : ''}`,
    `Produto: ${r.produto ?? '—'}`,
    `Filial: ${r.filial ?? '—'}${r.centro_custo ? ` · Centro de custo: ${r.centro_custo}` : ''}`,
    `Frete empresa: ${fmtFrete(s.frete_empresa, s.frete_empresa_unidade)}`,
    `Frete motorista: ${fmtFrete(s.frete_motorista, s.frete_motorista_unidade)}`,
    s.tipo_operacao ? `Tipo de operação: ${OPERACAO[s.tipo_operacao]}` : null,
    `Pagamento: ${textoPagamento(s)} · Pedágio: ${PEDAGIO[s.pedagio]}`,
    `Observação no CT-e: ${s.exige_obs_cte ? s.obs_cte : 'não exigida'}`,
    `Um CT-e por NF: ${s.cte_por_nf ? 'Sim' : 'Não'}`,
    s.observacoes ? `Observações: ${s.observacoes}` : null,
    `Solicitante: ${s.solicitante_nome}`,
  ].filter(Boolean).join('\n');
}

/** Imagens que o navegador mostra (HEIC fica para baixar). */
export const ehImagem = (mime: string) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime);
export const ehPdf = (mime: string) => mime === 'application/pdf';
export const fmtTamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
