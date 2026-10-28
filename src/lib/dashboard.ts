// Indicadores do Dashboard Embarques (Modelo A): período dia/semana/mês, faturamento, margens e agrupamentos.

import type { Configuracoes, LinhaFrete } from '../types';
import { resumir } from './calculos';
import { somarDias } from './formato';

export type TipoPeriodo = 'dia' | 'semana' | 'mes';

/** Margem líquida = margem bruta − 1,8% do faturamento (regra definida pela coordenação comercial em 27/10/2026). */
export const DESCONTO_MARGEM_LIQUIDA = 0.018;

/** Dia: a própria data. Semana: segunda a domingo. Mês: do dia 1 ao último dia. */
export function intervaloPeriodo(data: string, tipo: TipoPeriodo): { inicio: string; fim: string } {
  if (tipo === 'dia') return { inicio: data, fim: data };
  const [a, m, d] = data.split('-').map(Number);
  if (tipo === 'semana') {
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
    const inicio = somarDias(data, -((dow + 6) % 7));
    return { inicio, fim: somarDias(inicio, 6) };
  }
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { inicio: `${a}-${mm}-01`, fim: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

/** Datas do intervalo, sem passar de `ate` (não há posições no futuro). */
export function diasDoIntervalo(inicio: string, fim: string, ate: string): string[] {
  const out: string[] = [];
  const limite = fim < ate ? fim : ate;
  for (let d = inicio; d <= limite && out.length < 31; d = somarDias(d, 1)) out.push(d);
  return out;
}

export interface Indicadores {
  dias: number;
  lotes: number;
  /** Porta e trânsito: saldo do último dia. Carregados: soma dos dias. */
  porta: number;
  transito: number;
  carregados: number;
  projetado_t: number;
  disponibilizado_t: number | null;
  aderencia_pct: number | null;
  faturamento: number | null;
  /** Volume disponibilizado × frete empresa: a meta de faturamento até existir o módulo de metas. */
  faturamento_disponibilizado: number | null;
  ticket_empresa: number | null;
  ticket_motorista: number | null;
  margem_bruta: number | null;
  margem_bruta_pct: number | null;
  margem_liquida: number | null;
  margem_liquida_pct: number | null;
  valido: boolean;
  motivos: string[];
}

/** Soma os resumos diários de um conjunto de linhas (uma lista de linhas por dia). */
export function indicadores(porDia: LinhaFrete[][], cfg: Configuracoes, comFinanceiro: boolean): Indicadores {
  let lotes = 0, porta = 0, transito = 0, carregados = 0, proj = 0, disp = 0, temDisp = false;
  let fat = 0, fatDisp = 0, margem = 0, temFin = false, pesoTe = 0, somaTe = 0, pesoTm = 0, somaTm = 0;
  let ultimoTe: number | null = null, ultimoTm: number | null = null;
  let valido = true;
  const motivos = new Set<string>();
  porDia.forEach((ls, i) => {
    const r = resumir(ls, cfg, comFinanceiro);
    lotes = Math.max(lotes, r.lotes);
    if (i === porDia.length - 1) { porta = r.porta; transito = r.transito; }
    carregados += r.carregados;
    proj += r.projetado_t;
    if (r.disponibilizado_t !== null) { disp += r.disponibilizado_t; temDisp = true; }
    const f = r.financeiro;
    if (!f || r.lotes === 0) return;
    if (!f.valido) { valido = false; f.motivos.forEach((m) => motivos.add(m)); }
    if (f.ticket_empresa !== null) {
      temFin = true;
      ultimoTe = f.ticket_empresa;
      somaTe += f.ticket_empresa * r.projetado_t; pesoTe += r.projetado_t;
      fat += f.faturamento_projetado ?? 0;
      fatDisp += (r.disponibilizado_t ?? 0) * f.ticket_empresa;
    }
    if (f.ticket_motorista !== null) { ultimoTm = f.ticket_motorista; somaTm += f.ticket_motorista * r.projetado_t; pesoTm += r.projetado_t; }
    margem += f.margem_projetada ?? 0;
  });
  const comFin = comFinanceiro && temFin;
  const faturamento = comFin ? fat : null;
  const margemBruta = comFin ? margem : null;
  const margemLiquida = comFin ? margem - fat * DESCONTO_MARGEM_LIQUIDA : null;
  const pct = (v: number | null) => (v !== null && faturamento ? (v / faturamento) * 100 : null);
  const disponibilizado = temDisp ? disp : null;
  return {
    dias: porDia.length,
    lotes, porta, transito, carregados,
    projetado_t: proj,
    disponibilizado_t: disponibilizado,
    aderencia_pct: disponibilizado ? (proj / disponibilizado) * 100 : null,
    faturamento,
    faturamento_disponibilizado: comFin && temDisp ? fatDisp : null,
    ticket_empresa: comFin ? (pesoTe > 0 ? somaTe / pesoTe : ultimoTe) : null,
    ticket_motorista: comFin ? (pesoTm > 0 ? somaTm / pesoTm : ultimoTm) : null,
    margem_bruta: margemBruta,
    margem_bruta_pct: pct(margemBruta),
    margem_liquida: margemLiquida,
    margem_liquida_pct: pct(margemLiquida),
    valido: comFinanceiro && temFin && valido,
    motivos: [...motivos],
  };
}

/** Indicadores por grupo (filial, centro de custo, cliente). Chaves obrigatórias entram mesmo sem linhas. */
export function indicadoresPorGrupo(
  porDia: LinhaFrete[][],
  chave: (l: LinhaFrete) => string,
  cfg: Configuracoes,
  comFinanceiro: boolean,
  obrigatorias: string[] = [],
): Map<string, Indicadores> {
  const chaves = new Set(obrigatorias);
  for (const ls of porDia) for (const l of ls) if (l.posicao) chaves.add(chave(l));
  const out = new Map<string, Indicadores>();
  for (const k of chaves) out.set(k, indicadores(porDia.map((ls) => ls.filter((l) => chave(l) === k)), cfg, comFinanceiro));
  return out;
}

export type FaixaBarra = 'vermelho' | 'amarelo' | 'verde';

/** Cor das barras de % (regra da coordenação comercial, 28/10/2026): até 60% vermelho, 60,1% a 80% amarelo, acima de 80% verde.
 *  Compara o valor arredondado a 1 casa, o mesmo que aparece na tela. Sem meta, a barra fica neutra (null). */
export function faixaBarra(pct: number | null | undefined): FaixaBarra | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const p = Math.round(pct * 10) / 10;
  if (p <= 60) return 'vermelho';
  if (p <= 80) return 'amarelo';
  return 'verde';
}
