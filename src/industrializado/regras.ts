// Regras do módulo Industrializado (puras, testadas em regras.test.ts).

import {
  CHECAGENS, ETAPAS_FLUXO, ROTULO_CHECAGEM, ROTULO_ETAPA, type ChecagemInd, type ClienteInd, type EtapaInd, type OcorrenciaInd, type ValoresInd, type ViagemInd,
} from './tipos';

export const META_MARGEM_PCT = 12;
export const PRAZO_CANHOTO_DIAS = 30;
/** Laranja: faltam até 2 horas para o horário combinado e o veículo não marcou. */
export const ALERTA_COMBINADO_MIN = 120;

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

/** ok = verde, aviso = amarelo, laranja, atraso = vermelho, neutro = cinza. */
export type NivelAlerta = 'ok' | 'aviso' | 'laranja' | 'atraso' | 'neutro';
export interface AlertaCombinado { nivel: NivelAlerta; texto: string; minutos: number | null }

/** Verde: marcou. Amarelo: faltam mais de 2 horas. Laranja: faltam até 2 horas. Vermelho: passou do horário sem marcar. */
export function alertaCombinado(v: Pick<ViagemInd, 'combinado'>, agora: Date = new Date()): AlertaCombinado {
  const c = v.combinado;
  if (!c) return { nivel: 'neutro', texto: 'Sem combinado', minutos: null };
  if (c.marcou_em) return { nivel: 'ok', texto: 'Marcado', minutos: null };
  const faltam = Math.round((Date.parse(c.para) - agora.getTime()) / 60000);
  if (faltam < 0) return { nivel: 'atraso', texto: `Atrasado ${duracao(-faltam)}`, minutos: faltam };
  if (faltam <= ALERTA_COMBINADO_MIN) return { nivel: 'laranja', texto: `Faltam ${duracao(faltam)}`, minutos: faltam };
  return { nivel: 'aviso', texto: `Faltam ${duracao(faltam)}`, minutos: faltam };
}

// ---------------------------------------------------------------------------
// Descarga (veículos em trânsito): vermelho hoje, amarelo amanhã, verde D+2 ou mais
// ---------------------------------------------------------------------------

const diaLocal = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400e3;

export function alertaDescarga(v: Pick<ViagemInd, 'paradas'>, agora: Date = new Date()): { nivel: NivelAlerta; texto: string; quando: string | null } {
  const p = v.paradas.filter((x) => x.tipo === 'entrega' && x.situacao !== 'concluida' && x.situacao !== 'recusada')
    .sort((a, b) => a.ordem - b.ordem)[0];
  if (!p?.agendado_para) return { nivel: 'neutro', texto: 'Sem data de descarga', quando: null };
  const d = diaLocal(new Date(p.agendado_para)) - diaLocal(agora);
  if (d <= 0) return { nivel: 'atraso', texto: d < 0 ? `Descarga atrasada (${-d} d)` : 'Descarga hoje', quando: p.agendado_para };
  if (d === 1) return { nivel: 'aviso', texto: 'Descarga amanhã', quando: p.agendado_para };
  return { nivel: 'ok', texto: `Descarga em D+${d}`, quando: p.agendado_para };
}

// ---------------------------------------------------------------------------
// Quadros do Painel
// ---------------------------------------------------------------------------

export interface QuadrosPainel {
  disponiveis: ViagemInd[]; contratados: ViagemInd[]; emissao: ViagemInd[]; transito: ViagemInd[]; marcados: ViagemInd[]; comOcorrencia: ViagemInd[];
}

/** Uma viagem fica em um só quadro. Finalizadas sem ocorrência pendente saem do painel. */
export function quadrosPainel(viagens: ViagemInd[], ocorrencias: OcorrenciaInd[]): QuadrosPainel {
  const q: QuadrosPainel = { disponiveis: [], contratados: [], emissao: [], transito: [], marcados: [], comOcorrencia: [] };
  const pendente = new Set(ocorrencias.filter((o) => o.situacao === 'aberta' || o.situacao === 'aprovada').map((o) => o.viagem_id));
  for (const v of viagens) {
    const noCliente = v.paradas.some((p) => p.tipo === 'entrega' && (p.situacao === 'chegou' || p.situacao === 'em_operacao'));
    switch (v.etapa) {
      case 'lancada': (v.placa_cavalo ? q.contratados : q.disponiveis).push(v); break;
      case 'contratado': case 'coleta_agendada': case 'carregando': q.contratados.push(v); break;
      case 'carregada': q.emissao.push(v); break;
      case 'documentada': q.transito.push(v); break;
      case 'transito': case 'entregas': (noCliente ? q.marcados : q.transito).push(v); break;
      case 'entregue': case 'encerrada': if (pendente.has(v.id)) q.comOcorrencia.push(v); break;
      default: break;
    }
  }
  return q;
}

/** Meta do dia: cargas com coleta prevista para a data e quantas já foram retiradas (passaram de Carregando). */
export function retiradasDoDia(viagens: ViagemInd[], data: string): { previstas: number; retiradas: number } {
  const doDia = viagens.filter((v) => v.coleta_prevista === data && v.etapa !== 'cancelada');
  const depois = ETAPAS_FLUXO.indexOf('carregada');
  return { previstas: doDia.length, retiradas: doDia.filter((v) => ETAPAS_FLUXO.indexOf(v.etapa) >= depois).length };
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
      p.push(...avisoConferencia(v, 'emitir os documentos'));
      p.push('A documentação sai pela Emissão do Industrializado');
      break;
    case 'documentada':
      p.push(...avisoConferencia(v, 'seguir para Em trânsito'));
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
  p.push(...avisoConferencia(v, 'emitir os documentos'));
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
/** Como a carga aparece nas telas: pelo pedido do cliente (o código IND fica só para busca interna). */
export function pedidoCarga(v: { pedido: string | null }): string { return v.pedido?.trim() || 'Sem pedido'; }

// ---------------------------------------------------------------------------
// Conferências (Cadastro, Monitoramento, OC/Vínculo)
// ---------------------------------------------------------------------------
/** Conferências ainda não marcadas na viagem. */
export function faltaConferencia(v: Pick<ViagemInd, 'checagens'>): ChecagemInd[] {
  return CHECAGENS.filter((c) => !v.checagens?.[c]);
}
/** Etapas em que a falta de conferência ainda gera alerta (até a saída para a viagem). */
const ETAPAS_CONFERENCIA: EtapaInd[] = ['lancada', 'contratado', 'coleta_agendada', 'carregando', 'carregada', 'documentada'];
/** Veículo já marcou o combinado mas ainda falta alguma conferência: vira notificação no sino e alerta no Painel. */
export function marcadoSemConferencia(v: Pick<ViagemInd, 'checagens' | 'combinado' | 'etapa'>): boolean {
  return !!v.combinado?.marcou_em && ETAPAS_CONFERENCIA.includes(v.etapa) && faltaConferencia(v).length > 0;
}
/** Sem Cadastro, Monitoramento e OC/Vínculo marcados, a carga não é documentada nem sai para trânsito. */
export function avisoConferencia(v: Pick<ViagemInd, 'checagens'>, para: string): string[] {
  const f = faltaConferencia(v);
  return f.length ? [`Marque ${f.map((c) => ROTULO_CHECAGEM[c]).join(', ')} antes de ${para}`] : [];
}

/** Etapas em que um combinado novo é de trânsito (tracking até a descarga). */
export const ETAPAS_TRANSITO: EtapaInd[] = ['carregada', 'documentada', 'transito', 'entregas'];
/** Combinado de trânsito da viagem (o da coleta não aparece depois de carregado). */
export function combinadoTransito<T extends Pick<ViagemInd, 'combinado'>>(v: T): T['combinado'] {
  return v.combinado?.fase === 'transito' ? v.combinado : null;
}
/** Combinado que vale agora: até carregar, o da coleta; depois de carregado, só o de trânsito. */
export function combinadoAtual<T extends Pick<ViagemInd, 'combinado' | 'etapa'>>(v: T): T['combinado'] {
  return ['lancada', 'contratado', 'coleta_agendada', 'carregando'].includes(v.etapa) ? v.combinado : combinadoTransito(v);
}
