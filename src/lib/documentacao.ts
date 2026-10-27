// Regras de apresentação da documentação (Apoio Operacional). Funções puras; quem decide é o servidor.

import type {
  CategoriaAnexo, FormaPagamento, LoteErp, Pedagio, SolicitacaoDoc, StatusDoc, TipoOperacao, TipoSolicitacaoDoc, UnidadeFreteDoc,
} from '../types';
import { cidadeAnuncio } from './anuncio';
import { normalizar } from './texto';

export const TIPO_DOC: Record<TipoSolicitacaoDoc, string> = { lote_emissao: 'Lote e Emissão', emissao: 'Emissão' };
export const STATUS_DOC: Record<StatusDoc, string> = {
  enviado: 'Enviado', em_atendimento: 'Em atendimento', aguardando_informacao: 'Aguardando informação',
  documentacao_disponivel: 'Documentação disponível', cancelado: 'Cancelado',
};
export const UNIDADE_DOC: Record<UnidadeFreteDoc, string> = { rs_tonelada: 'R$/t', rs_viagem: 'R$/viagem' };
export const OPERACAO: Record<TipoOperacao, string> = { exportacao: 'Exportação', mi_tributado: 'Mercado Interno Tributado', mi_isento: 'Mercado Interno Isento' };
export const PAGAMENTO: Record<FormaPagamento, string> = { cheque: 'Cheque', pagbem: 'Pagbem' };
export const PEDAGIO: Record<Pedagio, string> = { sem_parar: 'Sem Parar', move_mais: 'Move Mais', conect_car: 'Conect Car', veloe: 'Veloe', nao_ha: 'Não há' };
export const CATEGORIA: Record<CategoriaAnexo, string> = {
  nf: 'NF', evidencia_frete: 'Evidência do frete', correcao: 'Correção', cte: 'CT-e', mdfe: 'MDF-e', outro_emitido: 'Outro documento emitido',
};
export const CATEGORIAS_SAIDA: CategoriaAnexo[] = ['cte', 'mdfe', 'outro_emitido'];
export const ABERTOS: StatusDoc[] = ['enviado', 'em_atendimento', 'aguardando_informacao'];
export const TIPOS_ARQUIVO = 'application/pdf,image/png,image/jpeg,image/webp';
export const LIMITE_ARQUIVO = 15 * 1024 * 1024;
export const PLACA_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

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

/** Tempo de espera (aberta) ou total até a documentação ficar disponível. */
export function tempoDoc(s: SolicitacaoDoc, agora: number): { rotulo: string; texto: string } {
  if (s.status === 'documentacao_disponivel' && s.concluido_em) return { rotulo: 'Total', texto: duracao(Date.parse(s.concluido_em) - Date.parse(s.enviado_em)) };
  if (s.status === 'cancelado') return { rotulo: 'Cancelada', texto: '—' };
  return { rotulo: s.status === 'enviado' ? 'Aguardando há' : 'Aberta há', texto: duracao(agora - Date.parse(s.enviado_em)) };
}

/** Quem precisa agir agora. */
export function vezDe(s: SolicitacaoDoc): string | null {
  if (s.status === 'aguardando_informacao') return `Resposta de ${s.solicitante_nome}`;
  if (s.status === 'enviado') return 'Apoio (ninguém assumiu)';
  if (s.status === 'em_atendimento') return `Apoio: ${s.responsavel_nome ?? '—'}`;
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

export type Atalho = 'abertas' | 'novas' | 'minhas' | 'aguardando' | 'concluidas';
export interface FiltrosFila { atalho: Atalho; busca: string; filial: string; centro: string; responsavel: string }
export const FILTROS_FILA: FiltrosFila = { atalho: 'abertas', busca: '', filial: '', centro: '', responsavel: '' };

export function noAtalho(s: SolicitacaoDoc, atalho: Atalho, eu: string): boolean {
  switch (atalho) {
    case 'abertas': return ABERTOS.includes(s.status);
    case 'novas': return s.status === 'enviado';
    case 'minhas': return s.responsavel_id === eu && (s.status === 'em_atendimento' || s.status === 'aguardando_informacao');
    case 'aguardando': return s.status === 'aguardando_informacao';
    case 'concluidas': return s.status === 'documentacao_disponivel' || s.status === 'cancelado';
  }
}

export function filtrarFila(ss: SolicitacaoDoc[], f: FiltrosFila, eu: string): SolicitacaoDoc[] {
  const t = normalizar(f.busca);
  const tPlaca = normalizarPlaca(f.busca);
  return ss
    .filter((s) => noAtalho(s, f.atalho, eu))
    .filter((s) => !f.filial || s.retrato.filial_id === f.filial)
    .filter((s) => !f.centro || (s.retrato.centro_custo_id ?? '') === f.centro)
    .filter((s) => !f.responsavel || (f.responsavel === '-' ? !s.responsavel_id : s.responsavel_id === f.responsavel))
    .filter((s) => !t || (tPlaca.length >= 3 && [s.placa, ...s.placas_reboque].some((p) => p.includes(tPlaca)))
      || normalizar(s.retrato.lote_numero ?? '').includes(t) || normalizar(s.retrato.cliente ?? '').includes(t)
      || String(s.numero) === f.busca.trim() || (s.nomes_nf ?? []).some((n) => normalizar(n).includes(t)))
    .sort((a, b) => (f.atalho === 'concluidas'
      ? (b.concluido_em ?? b.cancelado_em ?? b.atualizado_em).localeCompare(a.concluido_em ?? a.cancelado_em ?? a.atualizado_em)
      : a.enviado_em.localeCompare(b.enviado_em)));
}

/** Texto para colar no ERP ou numa conversa. */
export function resumoDoc(s: SolicitacaoDoc): string {
  const r = s.retrato;
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
    `Pagamento: ${PAGAMENTO[s.forma_pagamento]} · Pedágio: ${PEDAGIO[s.pedagio]}`,
    `Observação no CT-e: ${s.exige_obs_cte ? s.obs_cte : 'não exigida'}`,
    `Um CT-e por NF: ${s.cte_por_nf ? 'Sim' : 'Não'}`,
    s.observacoes ? `Observações: ${s.observacoes}` : null,
    `Solicitante: ${s.solicitante_nome}`,
  ].filter(Boolean).join('\n');
}

export const ehImagem = (mime: string) => mime.startsWith('image/');
export const fmtTamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
