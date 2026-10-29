// Painel Operacional (aba Análise): cálculos sobre os chamados do Apoio e o histórico de eventos (migração 1900).
// Funções puras. Horários vêm do servidor; a exibição e os agrupamentos por dia/hora usam America/Sao_Paulo.
//
// Etapas do chamado, a partir dos eventos:
//   fila        enviado → assumido, e corrigido → retomado (fila de retorno após a correção)
//   atendimento assumido/retomado → devolvido/concluído/cancelado
//   pendência   devolvido → corrigido (aguardando o solicitante)
//   cliente     enviado_cliente/pago_pendencia → retorno_cliente/concluído (Estadia: aguardando o cliente, não é atendimento ativo)
// Nada é estimado: sequência de eventos incompleta deixa o chamado fora das medianas ("sem registro").

import type { MotivoDevolucao, StatusDoc, TipoSolicitacaoDoc } from '../types';
import { FUSO } from './formato';

export type EventoFluxo =
  | 'enviado' | 'assumido' | 'devolvido' | 'corrigido' | 'retomado' | 'transferido' | 'concluido' | 'cancelado' | 'reaberto' | 'status_alterado'
  | 'enviado_cliente' | 'pago_pendencia' | 'retorno_cliente';

export interface SolPainel {
  id: string; numero: number; tipo: TipoSolicitacaoDoc; status: StatusDoc;
  filial_id: string | null; centro_custo_id: string | null;
  solicitante_id: string; solicitante_nome: string; responsavel_id: string | null; responsavel_nome: string | null;
  enviado_em: string;
}
export interface EventoPainel {
  s: string; evento: EventoFluxo; em: string; responsavel_id: string | null; responsavel_nome: string | null;
  motivo: MotivoDevolucao | null; origem: 'registro' | 'historico';
}
export interface DadosPainel {
  /** Horário do servidor na consulta. */
  agora: string;
  /** Início da medição completa (retomada explícita e motivo da devolução). */
  inicio_registro: string | null;
  /** Primeiro chamado registrado no Travion: antes disso não há dados. */
  inicio_dados: string | null;
  solicitacoes: SolPainel[];
  eventos: EventoPainel[];
}

/** Tipos de demanda do painel. */
export type TipoDemanda = TipoSolicitacaoDoc;
export const TIPOS_DEMANDA: Array<{ id: TipoDemanda; rotulo: string; ativo: boolean }> = [
  { id: 'cadastro', rotulo: 'Cadastro', ativo: true },
  { id: 'emissao', rotulo: 'Emissão', ativo: true },
  { id: 'lote_emissao', rotulo: 'Lote e Emissão', ativo: true },
  { id: 'estadia', rotulo: 'Estadia', ativo: true },
];
export type IdOperacao = 'cadastro' | 'emissao' | 'estadia';
/** prazo_min: prazo de espera na fila (pedido de 28/10/2026: Cadastro 30 min, Emissão 20 min, Estadia 24 h de prazo médio de envio; 29/10: Estadia passou para 96 h). */
export const OPERACOES: Array<{ id: IdOperacao; rotulo: string; tipos: TipoSolicitacaoDoc[]; prazo_min?: number; composicao?: string; futura?: boolean }> = [
  { id: 'cadastro', rotulo: 'Cadastro', tipos: ['cadastro'], prazo_min: 30 },
  { id: 'emissao', rotulo: 'Emissão', tipos: ['emissao', 'lote_emissao'], prazo_min: 20, composicao: 'Emissão + Lote e Emissão' },
  { id: 'estadia', rotulo: 'Estadia', tipos: ['estadia'], prazo_min: 96 * 60 },
];

/** Tolerância de atraso que ainda fica em amarelo. */
export const TOLERANCIA_ATRASO_MS = 5 * 60000;
export type SituacaoPrazo = 'no_prazo' | 'atencao' | 'atrasado';

/** Verde dentro do prazo, amarelo com até 5 min de atraso, vermelho acima disso. Sem espera medida: sem situação. */
export function situacaoPrazo(esperaMs: number | null, prazoMin: number | undefined): SituacaoPrazo | null {
  if (esperaMs === null || !prazoMin) return null;
  const atraso = esperaMs - prazoMin * 60000;
  return atraso <= 0 ? 'no_prazo' : atraso <= TOLERANCIA_ATRASO_MS ? 'atencao' : 'atrasado';
}

export const CONCLUIDO: StatusDoc[] = ['documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado'];
/** Estadia aguardando o cliente (encaminhada, ou paga com receita pendente): fora do atendimento ativo. */
export const NO_CLIENTE: StatusDoc[] = ['aguardando_cliente', 'pago_pendencia'];
export const NA_FILA: StatusDoc[] = ['enviado', 'correcao_recebida'];
/** Desempate de eventos no mesmo instante (a migração preencheu resposta e retomada automática juntas). */
const ORDEM: Record<EventoFluxo, number> = {
  enviado: 0, reaberto: 1, assumido: 2, transferido: 3, devolvido: 4, corrigido: 5, retomado: 6, enviado_cliente: 7, pago_pendencia: 8,
  retorno_cliente: 9, status_alterado: 10, concluido: 11, cancelado: 12,
};

// ---------------------------------------------------------------------------
// Datas em America/Sao_Paulo. O Brasil não tem horário de verão desde 2019: o dia local é UTC−3 fixo.
// ---------------------------------------------------------------------------
const DIA_MS = 86400e3;
export const inicioDiaSP = (data: string) => Date.parse(`${data}T00:00:00-03:00`);
const partesFmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
/** Dia da semana (0 = segunda) e hora local. */
export function diaHoraSP(ms: number): { dia: number; hora: number } {
  const p = partesFmt.formatToParts(new Date(ms));
  return { dia: DOW[p.find((x) => x.type === 'weekday')!.value], hora: Number(p.find((x) => x.type === 'hour')!.value) % 24 };
}
const dataFmt = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dataSP = (ms: number) => dataFmt.format(new Date(ms));
export const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
export const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// ---------------------------------------------------------------------------
// Linha do tempo de cada chamado
// ---------------------------------------------------------------------------
export type Etapa = 'fila' | 'atendimento' | 'pendencia' | 'cliente';
export interface Intervalo { etapa: Etapa; de: number; ate: number; responsavel_id: string | null }
export interface LinhaChamado {
  s: SolPainel;
  /** Sequência de eventos consistente do envio até agora. */
  completo: boolean;
  fila_ms: number; atendimento_ms: number; pendencia_ms: number;
  /** Estadia: tempo aguardando o retorno do cliente (inclui pago em pendência). */
  cliente_ms: number;
  /** Conclusão − envio original (só concluídos com sequência completa). */
  total_ms: number | null;
  devolucoes: number;
  motivos: MotivoDevolucao[];
  /** Quem assumiu o chamado (ou recebeu por transferência), por id. */
  assumiram: Map<string, string>;
  /** Responsável no encerramento (convenção das métricas finais). */
  concluido_por: { id: string; nome: string } | null;
  /** Entrada no episódio atual de fila (chamado aguardando atendimento agora); null se não está na fila ou sem registro. */
  inicio_fila_atual: number | null;
  intervalos: Intervalo[];
}

export function ordenarEventos(evs: EventoPainel[]): Map<string, EventoPainel[]> {
  const por = new Map<string, EventoPainel[]>();
  for (const e of evs) { const l = por.get(e.s); if (l) l.push(e); else por.set(e.s, [e]); }
  for (const l of por.values()) l.sort((a, b) => Date.parse(a.em) - Date.parse(b.em) || ORDEM[a.evento] - ORDEM[b.evento]);
  return por;
}

/** Monta a linha do tempo de um chamado; intervalos abertos contam até `agora`. */
export function linhaDoTempo(s: SolPainel, evs: EventoPainel[], agora: number): LinhaChamado {
  const l: LinhaChamado = {
    s, completo: evs.length > 0 && evs[0].evento === 'enviado', fila_ms: 0, atendimento_ms: 0, pendencia_ms: 0, cliente_ms: 0, total_ms: null,
    devolucoes: 0, motivos: [], assumiram: new Map(), concluido_por: null, inicio_fila_atual: null, intervalos: [],
  };
  let etapa: Etapa | 'fim' | null = null;
  let desde = 0;
  let resp: string | null = null;
  const fechar = (ate: number) => {
    if (etapa && etapa !== 'fim' && ate >= desde) {
      l.intervalos.push({ etapa, de: desde, ate, responsavel_id: resp });
      l[`${etapa}_ms` as const] += ate - desde;
    }
  };
  const ir = (nova: Etapa | 'fim', t: number, validoDe: Array<Etapa | 'fim' | null>) => {
    if (!validoDe.includes(etapa)) l.completo = false;
    fechar(t);
    etapa = nova; desde = t;
  };
  for (const e of evs) {
    const t = Date.parse(e.em);
    switch (e.evento) {
      case 'enviado': ir('fila', t, [null]); break;
      // Reaberto volta ao responsável (atendimento) ou, sem responsável, à fila.
      case 'reaberto': ir(e.responsavel_id ? 'atendimento' : 'fila', t, ['fim']); break;
      case 'assumido': ir('atendimento', t, ['fila']); break;
      case 'retomado': ir('atendimento', t, ['fila']); break;
      case 'devolvido': ir('pendencia', t, ['atendimento']); l.devolucoes++; if (e.motivo) l.motivos.push(e.motivo); break;
      case 'corrigido': ir('fila', t, ['pendencia']); break;
      case 'transferido': fechar(t); desde = t; break;
      case 'enviado_cliente': ir('cliente', t, ['atendimento']); break;
      case 'pago_pendencia': ir('cliente', t, ['atendimento', 'cliente']); break;
      case 'retorno_cliente': ir('atendimento', t, ['cliente']); break;
      case 'concluido':
        ir('fim', t, ['atendimento', 'cliente']);
        if (e.responsavel_id) l.concluido_por = { id: e.responsavel_id, nome: e.responsavel_nome ?? '—' };
        l.total_ms = t - Date.parse(s.enviado_em);
        break;
      case 'cancelado': ir('fim', t, ['fila', 'atendimento', 'pendencia', 'cliente']); break;
      default: l.completo = false;
    }
    resp = e.responsavel_id;
    if ((e.evento === 'assumido' || e.evento === 'transferido') && e.responsavel_id) l.assumiram.set(e.responsavel_id, e.responsavel_nome ?? '—');
  }
  // A etapa calculada precisa bater com a situação atual do chamado.
  const esperada: Etapa | 'fim' | null = NA_FILA.includes(s.status) ? 'fila' : s.status === 'em_atendimento' ? 'atendimento'
    : s.status === 'aguardando_informacao' ? 'pendencia' : NO_CLIENTE.includes(s.status) ? 'cliente' : 'fim';
  if (etapa !== esperada) l.completo = false;
  if (etapa === 'fila' && esperada === 'fila') l.inicio_fila_atual = desde;
  else if (s.status === 'enviado' && !evs.length) l.inicio_fila_atual = Date.parse(s.enviado_em); // envio gravado no próprio chamado
  if (etapa && etapa !== 'fim') fechar(Math.max(agora, desde));
  if (!(l.completo && CONCLUIDO.includes(s.status))) l.total_ms = null;
  if (s.responsavel_id && !l.assumiram.size && s.status !== 'enviado') l.assumiram.set(s.responsavel_id, s.responsavel_nome ?? '—');
  return l;
}

export function linhasDoPainel(d: Pick<DadosPainel, 'solicitacoes' | 'eventos'>, agora: number): LinhaChamado[] {
  const por = ordenarEventos(d.eventos);
  return d.solicitacoes.map((s) => linhaDoTempo(s, por.get(s.id) ?? [], agora));
}

// ---------------------------------------------------------------------------
// Fila atual por operação (situação agora, não média histórica)
// ---------------------------------------------------------------------------
export interface FilaOperacao { quantidade: number; retorno: number; media_ms: number | null; mais_antigo_ms: number | null; sem_registro: number }

export function filaAtual(linhas: LinhaChamado[], tipos: TipoSolicitacaoDoc[], agora: number): FilaOperacao {
  const na = linhas.filter((l) => tipos.includes(l.s.tipo) && NA_FILA.includes(l.s.status));
  const esperas = na.filter((l) => l.inicio_fila_atual !== null).map((l) => Math.max(0, agora - l.inicio_fila_atual!));
  return {
    quantidade: na.length,
    retorno: na.filter((l) => l.s.status === 'correcao_recebida').length,
    media_ms: esperas.length ? esperas.reduce((a, b) => a + b, 0) / esperas.length : null,
    mais_antigo_ms: esperas.length ? Math.max(...esperas) : null,
    sem_registro: na.length - esperas.length,
  };
}

// ---------------------------------------------------------------------------
// Filtros históricos
// ---------------------------------------------------------------------------
export interface FiltrosPainel {
  inicio: string; fim: string; tipos: TipoDemanda[];
  filial: string; centro: string; colaborador: string; solicitante: string;
}

/** Escopo (filial / centro de custo): vale para todos os quadros, inclusive filas e evolução. */
export function noEscopo(s: SolPainel, f: Pick<FiltrosPainel, 'filial' | 'centro'>): boolean {
  if (f.filial && (f.filial === '-' ? !!s.filial_id : s.filial_id !== f.filial)) return false;
  if (f.centro && (f.centro === '-' ? !!s.centro_custo_id : s.centro_custo_id !== f.centro)) return false;
  return true;
}

/** Período em instantes: do início do dia inicial ao fim do dia final (horário de Brasília). */
export const intervaloMs = (inicio: string, fim: string) => ({ de: inicioDiaSP(inicio), ate: inicioDiaSP(fim) + DIA_MS });

/** Grupo histórico: chamados enviados no período, dos tipos marcados (seleção vazia = nenhum), no escopo e nos filtros de pessoas. */
export function grupoHistorico(linhas: LinhaChamado[], f: FiltrosPainel): LinhaChamado[] {
  const { de, ate } = intervaloMs(f.inicio, f.fim);
  return linhas.filter((l) => {
    const t = Date.parse(l.s.enviado_em);
    return t >= de && t < ate && f.tipos.includes(l.s.tipo) && noEscopo(l.s, f)
      && (!f.solicitante || l.s.solicitante_id === f.solicitante)
      && (!f.colaborador || l.assumiram.has(f.colaborador) || l.s.responsavel_id === f.colaborador);
  });
}

// ---------------------------------------------------------------------------
// Atendimento por colaborador do apoio (sem ranking: ordem alfabética)
// ---------------------------------------------------------------------------
export interface LinhaEquipe {
  id: string; nome: string;
  assumidos: number; concluidos: number; em_atendimento: number; em_pendencia: number;
  mediana_atendimento_ms: number | null; mediana_total_ms: number | null;
  /** Concluídos com sequência completa usados nas medianas. */
  amostra: number;
  /** Concluídos sem registro completo (fora das medianas). */
  sem_registro: number;
  tipos: Partial<Record<TipoSolicitacaoDoc, number>>;
}

export function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export function porColaborador(grupo: LinhaChamado[]): LinhaEquipe[] {
  const por = new Map<string, LinhaEquipe & { _at: number[]; _tot: number[] }>();
  const linha = (id: string, nome: string) => {
    let x = por.get(id);
    if (!x) {
      x = { id, nome, assumidos: 0, concluidos: 0, em_atendimento: 0, em_pendencia: 0, mediana_atendimento_ms: null, mediana_total_ms: null,
        amostra: 0, sem_registro: 0, tipos: {}, _at: [], _tot: [] };
      por.set(id, x);
    }
    return x;
  };
  for (const l of grupo) {
    for (const [id, nome] of l.assumiram) {
      const x = linha(id, nome);
      x.assumidos++;
      x.tipos[l.s.tipo] = (x.tipos[l.s.tipo] ?? 0) + 1;
    }
    const r = l.s.responsavel_id;
    if (r && l.s.status === 'em_atendimento') linha(r, l.s.responsavel_nome ?? '—').em_atendimento++;
    if (r && l.s.status === 'aguardando_informacao') linha(r, l.s.responsavel_nome ?? '—').em_pendencia++;
    if (CONCLUIDO.includes(l.s.status)) {
      const c = l.concluido_por ?? (r ? { id: r, nome: l.s.responsavel_nome ?? '—' } : null);
      if (!c) continue;
      const x = linha(c.id, c.nome);
      x.concluidos++;
      if (l.completo && l.total_ms !== null) { x._at.push(l.atendimento_ms); x._tot.push(l.total_ms); } else x.sem_registro++;
    }
  }
  return [...por.values()].map(({ _at, _tot, ...x }) => ({
    ...x, amostra: _at.length, mediana_atendimento_ms: mediana(_at), mediana_total_ms: mediana(_tot),
  })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Mapa de calor: chegada dos chamados (envio original) por dia da semana × faixa de horário, volume acumulado
// ---------------------------------------------------------------------------
export function mapaCalor(grupo: LinhaChamado[], passoHoras: 1 | 2): { matriz: number[][]; max: number; total: number } {
  const colunas = 24 / passoHoras;
  const matriz = Array.from({ length: 7 }, () => Array<number>(colunas).fill(0));
  for (const l of grupo) {
    const { dia, hora } = diaHoraSP(Date.parse(l.s.enviado_em));
    matriz[dia][Math.floor(hora / passoHoras)]++;
  }
  return { matriz, max: Math.max(0, ...matriz.flat()), total: grupo.length };
}

// ---------------------------------------------------------------------------
// Evolução das demandas: novas solicitações por hora (dia), por dia (semana/mês), contra o período anterior equivalente
// ---------------------------------------------------------------------------
export type VisaoEvolucao = 'dia' | 'semana' | 'mes';
export interface SerieEvolucao {
  rotulos: string[];
  /** Início de cada intervalo (atual e anterior equivalente); null quando não há equivalente. */
  inicios: number[];
  iniciosAnterior: Array<number | null>;
  /** null = intervalo não observado (futuro ou antes do início dos dados). */
  atual: Array<number | null>;
  anterior: Array<number | null>;
  periodo: { de: number; ate: number };
  periodoAnterior: { de: number; ate: number };
  /** Comparação só nos intervalos equivalentes já observados. */
  comparavel: {
    corte: number | null;
    atual: number | null;
    anterior: number | null;
    variacao_pct: number | null;
    situacao: 'ok' | 'sem_base' | 'sem_dados_anteriores' | 'nao_iniciado';
    /** Dias do mês atual sem equivalente no anterior (ficam na linha, fora do percentual). */
    dias_sem_equivalente: number[];
  };
}

const diasNoMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate(); // m 1..12

export function evolucao(envios: number[], visao: VisaoEvolucao, dataRef: string, agora: number, inicioDados: number | null): SerieEvolucao {
  const [a, m, d] = dataRef.split('-').map(Number);
  let de: number; let n: number; let passo: number; let deAnt: number; let nAnt: number;
  let rotulo: (i: number) => string;
  if (visao === 'dia') {
    de = inicioDiaSP(dataRef); n = 24; passo = 3600e3; deAnt = de - DIA_MS; nAnt = 24;
    rotulo = (i) => `${String(i).padStart(2, '0')}h`;
  } else if (visao === 'semana') {
    const dow = (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
    de = inicioDiaSP(dataRef) - dow * DIA_MS; n = 7; passo = DIA_MS; deAnt = de - 7 * DIA_MS; nAnt = 7;
    rotulo = (i) => DIAS_CURTOS[i];
  } else {
    const mm = String(m).padStart(2, '0');
    de = inicioDiaSP(`${a}-${mm}-01`); n = diasNoMes(a, m); passo = DIA_MS;
    const [ap, mp] = m === 1 ? [a - 1, 12] : [a, m - 1];
    deAnt = inicioDiaSP(`${ap}-${String(mp).padStart(2, '0')}-01`); nAnt = diasNoMes(ap, mp);
    rotulo = (i) => String(i + 1);
  }
  const ate = de + n * passo;
  const ateAnt = deAnt + nAnt * passo;
  const contar = (x: number, y: number) => envios.reduce((c, t) => c + (t >= x && t < y ? 1 : 0), 0);
  const observado = (x: number) => x < agora && (inicioDados === null || x + passo > inicioDados);
  const inicios = Array.from({ length: n }, (_, i) => de + i * passo);
  const iniciosAnterior = inicios.map((_, i) => (i < nAnt ? deAnt + i * passo : null));
  const atual = inicios.map((x) => (observado(x) ? contar(x, x + passo) : null));
  const anterior = iniciosAnterior.map((x) => (x !== null && observado(x) ? contar(x, x + passo) : null));

  // Corte: até agora (período em andamento) ou o fim do período; no mês, só os dias que existem no mês anterior.
  const sem = visao === 'mes' ? Array.from({ length: Math.max(0, n - nAnt) }, (_, i) => nAnt + i + 1) : [];
  const corteBruto = Math.min(agora, ate);
  const corte = visao === 'mes' ? Math.min(corteBruto, de + nAnt * passo) : corteBruto;
  let comparavel: SerieEvolucao['comparavel'];
  if (corteBruto <= de) {
    comparavel = { corte: null, atual: null, anterior: null, variacao_pct: null, situacao: 'nao_iniciado', dias_sem_equivalente: sem };
  } else {
    const vAtual = contar(de, corte);
    const fimAnt = deAnt + (corte - de);
    const semDados = inicioDados === null || deAnt < inicioDiaSP(dataSP(inicioDados));
    const vAnt = semDados ? null : contar(deAnt, fimAnt);
    comparavel = {
      corte, atual: vAtual, anterior: vAnt,
      variacao_pct: vAnt ? ((vAtual - vAnt) / vAnt) * 100 : null,
      situacao: vAnt === null ? 'sem_dados_anteriores' : vAnt === 0 ? 'sem_base' : 'ok',
      dias_sem_equivalente: sem.filter((dia) => de + (dia - 1) * passo < corteBruto),
    };
  }
  return {
    rotulos: inicios.map((_, i) => rotulo(i)), inicios, iniciosAnterior, atual, anterior,
    periodo: { de, ate }, periodoAnterior: { de: deAnt, ate: ateAnt }, comparavel,
  };
}

// ---------------------------------------------------------------------------
// Resumo geral do grupo histórico (não são categorias exclusivas: Recebidos é o total do grupo)
// ---------------------------------------------------------------------------
export interface ResumoPainel {
  recebidos: number; concluidos: number; em_atendimento: number; pendencia: number; na_fila: number; cancelados: number;
  /** Estadia aguardando o cliente (encaminhada ou paga com receita pendente). */
  aguardando_cliente: number; tempo_cliente_ms: number;
  com_devolucao: number; devolucoes: number; devolvidos_mais_de_uma_vez: number; tempo_pendencia_ms: number;
  motivos: Partial<Record<MotivoDevolucao, number>>;
}

export function resumo(grupo: LinhaChamado[]): ResumoPainel {
  const r: ResumoPainel = {
    recebidos: grupo.length, concluidos: 0, em_atendimento: 0, pendencia: 0, na_fila: 0, cancelados: 0, aguardando_cliente: 0, tempo_cliente_ms: 0,
    com_devolucao: 0, devolucoes: 0, devolvidos_mais_de_uma_vez: 0, tempo_pendencia_ms: 0, motivos: {},
  };
  for (const l of grupo) {
    if (CONCLUIDO.includes(l.s.status)) r.concluidos++;
    else if (l.s.status === 'em_atendimento') r.em_atendimento++;
    else if (l.s.status === 'aguardando_informacao') r.pendencia++;
    else if (NA_FILA.includes(l.s.status)) r.na_fila++;
    else if (l.s.status === 'cancelado') r.cancelados++;
    else if (NO_CLIENTE.includes(l.s.status)) r.aguardando_cliente++;
    r.tempo_cliente_ms += l.cliente_ms;
    if (l.devolucoes) r.com_devolucao++;
    if (l.devolucoes > 1) r.devolvidos_mais_de_uma_vez++;
    r.devolucoes += l.devolucoes;
    r.tempo_pendencia_ms += l.pendencia_ms;
    for (const mo of l.motivos) r.motivos[mo] = (r.motivos[mo] ?? 0) + 1;
  }
  return r;
}

/** Junta a consulta incremental: substitui os chamados devolvidos e todos os eventos deles. */
export function mesclarPainel(base: DadosPainel, novo: DadosPainel): DadosPainel {
  const ids = new Set(novo.solicitacoes.map((s) => s.id));
  if (!ids.size) return { ...base, agora: novo.agora, inicio_registro: novo.inicio_registro, inicio_dados: novo.inicio_dados };
  return {
    ...novo,
    solicitacoes: [...base.solicitacoes.filter((s) => !ids.has(s.id)), ...novo.solicitacoes],
    eventos: [...base.eventos.filter((e) => !ids.has(e.s)), ...novo.eventos],
  };
}
