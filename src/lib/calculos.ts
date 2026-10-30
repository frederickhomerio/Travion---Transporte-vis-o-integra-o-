// Regras de cálculo do Travion (fonte única para Lista de Fretes, Dashboard e Posições de Embarque).
// Ver docs/REGRAS_DE_NEGOCIO.md para a origem de cada fórmula na planilha.

import type { Configuracoes, Embarque, Financeiro, LinhaFrete, Posicao, UnidadeCadencia, UnidadeFrete } from '../types';

export interface ContadoresCapacidade {
  porta: number | null;
  transito: number | null;
  carregados: number | null;
  toneladas_por_veiculo: number;
}

export interface Volumes {
  porta: number;
  transito: number;
  carregados: number;
  porta_t: number;
  transito_t: number;
  carregado_t: number;
  /** porta + trânsito + carregados (soma das posições informadas, não é frota única) */
  total_veiculos: number;
  /** volume na porta + volume carregado (a projeção da planilha não inclui trânsito) */
  projetado_t: number;
  /** porta + trânsito + carregado */
  potencial_t: number;
  /** quantos dos três contadores estão sem informação */
  nao_informados: number;
}

const n0 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function volumes(p: ContadoresCapacidade): Volumes {
  const cap = p.toneladas_por_veiculo;
  const porta = n0(p.porta);
  const transito = n0(p.transito);
  const carregados = n0(p.carregados);
  const porta_t = porta * cap;
  const transito_t = transito * cap;
  const carregado_t = carregados * cap;
  return {
    porta, transito, carregados, porta_t, transito_t, carregado_t,
    total_veiculos: porta + transito + carregados,
    projetado_t: porta_t + carregado_t,
    potencial_t: porta_t + transito_t + carregado_t,
    nao_informados: [p.porta, p.transito, p.carregados].filter((v) => v === null || v === undefined).length,
  };
}

export interface MetaLote {
  veiculos: number | null;
  volume_t: number | null;
  origem: 'cadencia' | 'sem_meta';
  unidade: UnidadeCadencia | null;
}

/**
 * Meta do lote no dia: a meta diária do embarque (obrigatória desde a migração 2100; preservada na posição).
 * Sem meta informada, fica "sem meta" (não há mais meta padrão por lote).
 */
export function metaLote(meta: { valor: number | null; unidade: UnidadeCadencia; capacidade: number }): MetaLote {
  const cap = meta.capacidade;
  if (meta.valor !== null && meta.valor > 0) {
    if (meta.unidade === 'toneladas_dia') {
      return { veiculos: cap > 0 ? meta.valor / cap : null, volume_t: meta.valor, origem: 'cadencia', unidade: 'toneladas_dia' };
    }
    return { veiculos: meta.valor, volume_t: meta.valor * cap, origem: 'cadencia', unidade: 'veiculos_dia' };
  }
  return { veiculos: null, volume_t: null, origem: 'sem_meta', unidade: null };
}

export function metaDaPosicao(p: Posicao): MetaLote {
  return metaLote({ valor: p.meta_valor, unidade: p.meta_unidade, capacidade: p.toneladas_por_veiculo });
}

export function metaDoEmbarque(e: Embarque): MetaLote {
  return metaLote({ valor: e.cadencia_valor, unidade: e.cadencia_unidade, capacidade: e.toneladas_por_veiculo });
}

/** Aderência % = projetado ÷ disponibilizado × 100. Sem denominador válido → null ("Sem meta definida"). Sem teto de 100%. */
export function aderencia(projetado_t: number, disponibilizado_t: number | null): number | null {
  if (disponibilizado_t === null || !Number.isFinite(disponibilizado_t) || disponibilizado_t <= 0) return null;
  return (projetado_t / disponibilizado_t) * 100;
}

/** Média simples dos valores numéricos (como AVERAGE da planilha). */
export function mediaSimples(valores: Array<number | null | undefined>, incluirZero: boolean): number | null {
  const nums = valores.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && (incluirZero || v !== 0));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export interface ResumoFinanceiro {
  ticket_empresa: number | null;
  ticket_motorista: number | null;
  faturamento_projetado: number | null;
  margem_pct: number | null;
  margem_projetada: number | null;
  lotes_com_frete_empresa: number;
  lotes_com_frete_motorista: number;
  lotes_unidade_nao_confirmada: number;
  lotes_unidade_incompativel: number;
  /** Lotes com frete por viagem ou por m³: ficam fora do faturamento, tickets e margem em R$/t (não invalidam). */
  lotes_fora_rs_t: number;
  /** Projeções só são válidas com fretes em R$/t confirmados. */
  valido: boolean;
  motivos: string[];
}

/** Unidades que não se convertem em toneladas: o lote sai do cálculo em R$/t em vez de invalidar o escopo inteiro. */
export const FORA_RS_T: UnidadeFrete[] = ['rs_viagem', 'rs_m3'];
const foraRsT = (l: LinhaFrete) => !!l.financeiro && FORA_RS_T.includes(l.financeiro.unidade_frete);

export function resumoFinanceiro(
  fin: Array<Financeiro | null>,
  projetado_t: number,
  cfg: Pick<Configuracoes, 'ticket_inclui_frete_zero'>,
  fora = 0,
): ResumoFinanceiro {
  const comEmp = fin.filter((f) => f && typeof f.frete_empresa === 'number') as Financeiro[];
  const comMot = fin.filter((f) => f && typeof f.frete_motorista === 'number') as Financeiro[];
  const comFrete = fin.filter((f) => f && (typeof f.frete_empresa === 'number' || typeof f.frete_motorista === 'number')) as Financeiro[];
  const te = mediaSimples(comEmp.map((f) => f.frete_empresa), cfg.ticket_inclui_frete_zero);
  const tm = mediaSimples(comMot.map((f) => f.frete_motorista), cfg.ticket_inclui_frete_zero);
  const naoConf = comFrete.filter((f) => f.unidade_frete === 'nao_confirmada').length;
  const incomp = comFrete.filter((f) => f.unidade_frete === 'outra' || FORA_RS_T.includes(f.unidade_frete)).length;
  const semFrete = fin.length - comEmp.length;

  const faturamento = te !== null ? projetado_t * te : null;
  const margemPct = te !== null && tm !== null && te > 0 ? 1 - tm / te : null;
  const margemRs = faturamento !== null && margemPct !== null ? faturamento * margemPct : null;

  const motivos: string[] = [];
  if (naoConf > 0) motivos.push(`${naoConf} lote(s) com unidade do frete não confirmada`);
  if (incomp > 0) motivos.push(`${incomp} lote(s) com frete em unidade incompatível com toneladas`);
  if (fora > 0) motivos.push(`${fora} lote(s) com frete por viagem ou por m³ fora do cálculo em R$/t`);
  if (semFrete > 0) motivos.push(`${semFrete} lote(s) sem frete empresa numérico`);
  if (te === null) motivos.push('Nenhum frete empresa numérico no escopo');
  if (tm === null) motivos.push('Nenhum frete motorista numérico no escopo');

  return {
    ticket_empresa: te,
    ticket_motorista: tm,
    faturamento_projetado: faturamento,
    margem_pct: margemPct === null ? null : margemPct * 100,
    margem_projetada: margemRs,
    lotes_com_frete_empresa: comEmp.length,
    lotes_com_frete_motorista: comMot.length,
    lotes_unidade_nao_confirmada: naoConf,
    lotes_unidade_incompativel: incomp,
    lotes_fora_rs_t: fora,
    valido: naoConf === 0 && incomp === 0 && te !== null && tm !== null,
    motivos,
  };
}

export interface Resumo extends Volumes {
  lotes: number;
  lotes_cadencia_propria: number;
  meta_veiculos: number | null;
  disponibilizado_t: number | null;
  aderencia_pct: number | null;
  lotes_sem_informacao: number;
  lotes_suspensos_com_veiculos: number;
  financeiro: ResumoFinanceiro | null;
}

/** Financeiro só dos lotes em R$/t (ou a confirmar): volume projetado e fretes desses lotes; os demais são contados à parte. */
function financeiroDentro(comPos: LinhaFrete[], cfg: Configuracoes): ResumoFinanceiro {
  const dentro = comPos.filter((l) => !foraRsT(l));
  const proj = dentro.reduce((s, l) => s + volumes(l.posicao as Posicao).projetado_t, 0);
  return resumoFinanceiro(dentro.map((l) => l.financeiro), proj, cfg, comPos.length - dentro.length);
}

/**
 * Resumo de um conjunto de linhas numa data. Lote = embarque com posição na data.
 * Embarques sem posição na data não entram nas contas.
 */
export function resumir(linhas: LinhaFrete[], cfg: Configuracoes, comFinanceiro: boolean): Resumo {
  const comPos = linhas.filter((l) => l.posicao !== null);
  const acc: Volumes = {
    porta: 0, transito: 0, carregados: 0, porta_t: 0, transito_t: 0, carregado_t: 0,
    total_veiculos: 0, projetado_t: 0, potencial_t: 0, nao_informados: 0,
  };
  let metaV = 0;
  let metaT = 0;
  let semMeta = 0;
  let cadPropria = 0;
  let semInfo = 0;
  let suspensosComVeiculos = 0;
  for (const l of comPos) {
    const p = l.posicao as Posicao;
    const v = volumes(p);
    for (const k of Object.keys(acc) as Array<keyof Volumes>) acc[k] += v[k];
    if (v.nao_informados === 3) semInfo++;
    if (l.embarque.status_liberacao === 'suspenso' && v.total_veiculos > 0) suspensosComVeiculos++;
    const m = metaDaPosicao(p);
    if (m.origem === 'cadencia') cadPropria++;
    if (m.volume_t === null) semMeta++;
    else {
      metaT += m.volume_t;
      metaV += m.veiculos ?? 0;
    }
  }
  const disponibilizado = comPos.length > 0 && semMeta < comPos.length ? metaT : null;
  return {
    ...acc,
    lotes: comPos.length,
    lotes_cadencia_propria: cadPropria,
    meta_veiculos: disponibilizado === null ? null : metaV,
    disponibilizado_t: disponibilizado,
    aderencia_pct: aderencia(acc.projetado_t, disponibilizado),
    lotes_sem_informacao: semInfo,
    lotes_suspensos_com_veiculos: suspensosComVeiculos,
    financeiro: comFinanceiro ? financeiroDentro(comPos, cfg) : null,
  };
}

/** Agrupa linhas por uma chave e resume cada grupo. Chaves sem linhas (ex.: filial nova) entram zeradas. */
export function resumirPorGrupo(
  linhas: LinhaFrete[],
  chave: (l: LinhaFrete) => string,
  cfg: Configuracoes,
  comFinanceiro: boolean,
  chavesObrigatorias: string[] = [],
): Map<string, Resumo> {
  const grupos = new Map<string, LinhaFrete[]>();
  for (const k of chavesObrigatorias) grupos.set(k, []);
  for (const l of linhas) {
    const k = chave(l);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(l);
  }
  const res = new Map<string, Resumo>();
  for (const [k, ls] of grupos) res.set(k, resumir(ls, cfg, comFinanceiro));
  return res;
}

// ---------------------------------------------------------------------------
// Período (vários dias)
// ---------------------------------------------------------------------------

export interface ResumoPeriodo {
  dias: number;
  data_inicio: string;
  data_fim: string;
  lotes: number;
  /** Saldo na última posição de cada lote dentro do período (não é soma de dias) */
  porta_saldo: number;
  transito_saldo: number;
  porta_saldo_t: number;
  transito_saldo_t: number;
  /** Carregamentos acumulados no período (soma dos acumulados diários) */
  carregados_acumulados: number;
  carregado_acumulado_t: number;
  /** Soma das metas diárias de cada lote nos dias com posição */
  meta_periodo_t: number | null;
  /** carregado acumulado ÷ meta do período × 100 */
  aderencia_carregado_pct: number | null;
  posicoes: number;
}

export function resumirPeriodo(
  embarques: Embarque[],
  posicoes: Posicao[],
  inicio: string,
  fim: string,
): ResumoPeriodo {
  const ids = new Set(embarques.map((e) => e.id));
  const doPeriodo = posicoes.filter((p) => ids.has(p.embarque_id) && p.data_operacional >= inicio && p.data_operacional <= fim);
  const porEmbarque = new Map<string, Posicao[]>();
  for (const p of doPeriodo) {
    if (!porEmbarque.has(p.embarque_id)) porEmbarque.set(p.embarque_id, []);
    porEmbarque.get(p.embarque_id)!.push(p);
  }
  let portaS = 0, transS = 0, portaT = 0, transT = 0, carr = 0, carrT = 0, meta = 0, semMeta = 0;
  for (const ps of porEmbarque.values()) {
    ps.sort((a, b) => a.data_operacional.localeCompare(b.data_operacional));
    const ultima = ps[ps.length - 1];
    portaS += n0(ultima.porta);
    transS += n0(ultima.transito);
    portaT += n0(ultima.porta) * ultima.toneladas_por_veiculo;
    transT += n0(ultima.transito) * ultima.toneladas_por_veiculo;
    for (const p of ps) {
      carr += n0(p.carregados);
      carrT += n0(p.carregados) * p.toneladas_por_veiculo;
      const m = metaDaPosicao(p);
      if (m.volume_t === null) semMeta++;
      else meta += m.volume_t;
    }
  }
  const metaPeriodo = doPeriodo.length > 0 && semMeta < doPeriodo.length ? meta : null;
  return {
    dias: new Set(doPeriodo.map((p) => p.data_operacional)).size,
    data_inicio: inicio,
    data_fim: fim,
    lotes: porEmbarque.size,
    porta_saldo: portaS,
    transito_saldo: transS,
    porta_saldo_t: portaT,
    transito_saldo_t: transT,
    carregados_acumulados: carr,
    carregado_acumulado_t: carrT,
    meta_periodo_t: metaPeriodo,
    aderencia_carregado_pct: aderencia(carrT, metaPeriodo),
    posicoes: doPeriodo.length,
  };
}

/** Linha tem movimentação na data? (algum contador > 0) */
export function temMovimentacao(p: Posicao | null): boolean {
  if (!p) return false;
  return n0(p.porta) + n0(p.transito) + n0(p.carregados) > 0;
}
