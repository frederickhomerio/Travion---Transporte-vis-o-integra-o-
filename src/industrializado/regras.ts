// Regras do módulo Industrializado (puras, testadas em regras.test.ts).

import {
  ETAPAS_FLUXO, ROTULO_ETAPA, type ClienteInd, type EtapaInd, type OcorrenciaInd, type ValoresInd, type ViagemInd,
} from './tipos';

export const META_MARGEM_PCT = 12;
export const PRAZO_CANHOTO_DIAS = 30;
/** Antecedência do alerta do combinado com o motorista. */
export const ALERTA_COMBINADO_MIN = 60;

const H = 3600e3;
const DIA = 24 * H;

// ---------------------------------------------------------------------------
// Margem final da carga
// ---------------------------------------------------------------------------

export interface Margem {
  receita: number; despesa: number; margem: number; pct: number | null;
  /** Valores somados (os da carga mais os das ocorrências aprovadas ou pagas). */
  linhas: ValoresInd;
  abaixoMeta: boolean;
}

/**
 * Receita = frete empresa + custo extra + pedágio + CT-e complementar.
 * Despesa = frete motorista + descarga + diária.
 * Ocorrências aprovadas ou pagas entram assim: valor ao cliente soma no CT-e complementar;
 * valor ao motorista soma na diária (ocorrência de diária) ou no frete motorista (demais tipos).
 */
export function calcularMargem(v: ViagemInd, ocorrencias: OcorrenciaInd[] = []): Margem {
  const l: ValoresInd = { ...v.valores };
  for (const o of ocorrencias) {
    if (o.viagem_id !== v.id || (o.situacao !== 'aprovada' && o.situacao !== 'paga')) continue;
    l.cte_complementar += o.valor_cliente;
    if (o.tipo === 'diaria') l.diaria += o.valor_motorista; else l.frete_motorista += o.valor_motorista;
  }
  const receita = l.frete_empresa + l.custo_extra + l.pedagio + l.cte_complementar;
  const despesa = l.frete_motorista + l.descarga + l.diaria;
  const margem = receita - despesa;
  const pct = receita > 0 ? (margem / receita) * 100 : null;
  return { receita, despesa, margem, pct, linhas: l, abaixoMeta: pct !== null && pct < META_MARGEM_PCT };
}

// ---------------------------------------------------------------------------
// Tracking: combinado entre funcionário e motorista
// ---------------------------------------------------------------------------

export type NivelAlerta = 'ok' | 'aviso' | 'atraso' | 'neutro';
export interface AlertaCombinado { nivel: NivelAlerta; texto: string; minutos: number | null }

/** Verde quando o veículo marcou; amarelo de 1 hora antes até o horário; vermelho depois do horário sem marcar. */
export function alertaCombinado(v: Pick<ViagemInd, 'combinado'>, agora: Date = new Date()): AlertaCombinado {
  const c = v.combinado;
  if (!c) return { nivel: 'neutro', texto: 'Sem combinado', minutos: null };
  if (c.marcou_em) return { nivel: 'ok', texto: 'Veículo marcou', minutos: null };
  const faltam = Math.round((Date.parse(c.para) - agora.getTime()) / 60000);
  if (faltam < 0) return { nivel: 'atraso', texto: `Não marcou, ${duracao(-faltam)} de atraso`, minutos: faltam };
  if (faltam <= ALERTA_COMBINADO_MIN) return { nivel: 'aviso', texto: `Faltam ${duracao(faltam)} e o veículo não marcou`, minutos: faltam };
  return { nivel: 'neutro', texto: `Combinado em ${duracao(faltam)}`, minutos: faltam };
}

export function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

// ---------------------------------------------------------------------------
// Canhoto (30 dias após a entrega)
// ---------------------------------------------------------------------------

export interface AlertaCanhoto { nivel: NivelAlerta; dias: number | null; texto: string }

export function alertaCanhoto(v: Pick<ViagemInd, 'entregue_em' | 'canhoto_fisico_em'>, agora: Date = new Date()): AlertaCanhoto {
  if (!v.entregue_em) return { nivel: 'neutro', dias: null, texto: 'Ainda não entregue' };
  if (v.canhoto_fisico_em) return { nivel: 'ok', dias: null, texto: 'Canhoto físico recebido' };
  const dias = Math.floor((agora.getTime() - Date.parse(v.entregue_em)) / DIA);
  if (dias > PRAZO_CANHOTO_DIAS) return { nivel: 'atraso', dias, texto: `${dias} dias sem canhoto físico (prazo ${PRAZO_CANHOTO_DIAS})` };
  if (dias >= PRAZO_CANHOTO_DIAS - 5) return { nivel: 'aviso', dias, texto: `${dias} dias, prazo vence em ${PRAZO_CANHOTO_DIAS - dias}` };
  return { nivel: 'neutro', dias, texto: `${dias} de ${PRAZO_CANHOTO_DIAS} dias` };
}

// ---------------------------------------------------------------------------
// Avanço de etapa
// ---------------------------------------------------------------------------

export function proximaEtapa(e: EtapaInd): EtapaInd | null {
  const i = ETAPAS_FLUXO.indexOf(e);
  return i < 0 || i >= ETAPAS_FLUXO.length - 1 ? null : ETAPAS_FLUXO[i + 1];
}
export function etapaAnterior(e: EtapaInd): EtapaInd | null {
  const i = ETAPAS_FLUXO.indexOf(e);
  return i <= 0 ? null : ETAPAS_FLUXO[i - 1];
}

/** O que falta para a viagem sair da etapa atual. Lista vazia = pode avançar. */
export function pendenciasAvanco(v: ViagemInd, cliente: ClienteInd | undefined, ocorrencias: OcorrenciaInd[] = []): string[] {
  const p: string[] = [];
  switch (v.etapa) {
    case 'lancada':
      if (!v.motorista) p.push('Informe o motorista');
      if (!v.placa_cavalo) p.push('Informe a placa do cavalo');
      break;
    case 'contratado':
      for (const x of v.paradas) if (x.tipo === 'coleta' && x.exige_agendamento && !x.agendado_para) p.push(`Informe o horário agendado da coleta em ${x.local}`);
      break;
    case 'carregada':
      if (cliente?.exige_po && !v.po) p.push(`${cliente.nome} exige PO depois de carregado`);
      p.push('A documentação sai pela Emissão do Industrializado');
      break;
    case 'entregas':
      if (v.paradas.some((x) => x.tipo === 'entrega' && x.situacao !== 'concluida' && x.situacao !== 'recusada')) p.push('Feche todas as entregas (concluída ou recusada)');
      break;
    case 'entregue':
      p.push(...pendenciasEncerrar(v, ocorrencias));
      break;
    case 'encerrada': case 'cancelada':
      p.push(`Viagem ${ROTULO_ETAPA[v.etapa].toLowerCase()}`);
      break;
    default: break;
  }
  return p;
}

/** Encerrar exige canhoto físico, comprovante conferido e nenhuma ocorrência aberta. */
export function pendenciasEncerrar(v: ViagemInd, ocorrencias: OcorrenciaInd[]): string[] {
  const p: string[] = [];
  if (!v.canhoto_fisico_em) p.push('Receber o canhoto físico');
  if (!v.comprovante_ok_em) p.push('Conferir o comprovante de entrega');
  const abertas = ocorrencias.filter((o) => o.viagem_id === v.id && o.situacao === 'aberta').length;
  if (abertas) p.push(abertas === 1 ? 'Resolver 1 ocorrência aberta' : `Resolver ${abertas} ocorrências abertas`);
  return p;
}

/** Documentos que a Emissão precisa informar antes de liberar. */
export function pendenciasEmissao(v: ViagemInd, cliente: ClienteInd | undefined, d: { cte: string; nfs: string; po: string }): string[] {
  const p: string[] = [];
  if (!d.cte.trim()) p.push('Informe o CT-e');
  if (!d.nfs.trim()) p.push('Informe as NFs');
  if (cliente?.exige_po && !d.po.trim() && !v.po) p.push(`${cliente.nome} exige PO`);
  return p;
}

// ---------------------------------------------------------------------------
// Apoio às telas
// ---------------------------------------------------------------------------

export function rota(v: Pick<ViagemInd, 'paradas'>): { origem: string; destino: string; coletas: number; entregas: number } {
  const cs = v.paradas.filter((x) => x.tipo === 'coleta').sort((a, b) => a.ordem - b.ordem);
  const es = v.paradas.filter((x) => x.tipo === 'entrega').sort((a, b) => a.ordem - b.ordem);
  const nome = (x?: { cidade: string; uf: string }) => (x ? `${x.cidade}/${x.uf}` : '—');
  return { origem: nome(cs[0]), destino: nome(es[es.length - 1]), coletas: cs.length, entregas: es.length };
}

/** Próxima parada agendada ainda não concluída. */
export function proximoAgendamento(v: Pick<ViagemInd, 'paradas'>) {
  return v.paradas
    .filter((x) => x.agendado_para && x.situacao !== 'concluida' && x.situacao !== 'recusada')
    .sort((a, b) => Date.parse(a.agendado_para!) - Date.parse(b.agendado_para!))[0] ?? null;
}

export function codigoOcorrencia(n: number): string { return `OC-${String(n).padStart(4, '0')}`; }
export function codigoViagem(n: number): string { return `IND-${String(n).padStart(4, '0')}`; }
