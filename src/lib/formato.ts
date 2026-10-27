// Formatação no padrão brasileiro e datas no fuso America/Sao_Paulo.

export const FUSO = 'America/Sao_Paulo';

const fmtDataISO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHoraSP = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const fmtDataHoraSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Data operacional de hoje (YYYY-MM-DD) em America/Sao_Paulo. */
export function hojeSP(agora: Date = new Date()): string {
  return fmtDataISO.format(agora);
}

/** Soma dias a uma data YYYY-MM-DD (sem efeito de fuso). */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

/** 2026-10-26 → 26/10/2026 */
export function fmtData(data: string | null | undefined): string {
  if (!data) return '—';
  const [a, m, d] = data.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** 2026-10-26 → 26/10 */
export function fmtDataCurta(data: string | null | undefined): string {
  if (!data) return '—';
  const [, m, d] = data.slice(0, 10).split('-');
  return `${d}/${m}`;
}

export function fmtHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return fmtHoraSP.format(new Date(iso));
}

export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return fmtDataHoraSP.format(new Date(iso)).replace(',', '');
}

/** "27/10/2026 às 14:22" (horário de Brasília). */
export function fmtDataAsHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtData(hojeSP(d))} às ${fmtHoraSP.format(d)}`;
}

export function fmtNum(n: number | null | undefined, casas = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Toneladas: "1.280 t" (até 1 casa quando houver fração). */
export function fmtT(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const casas = Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1;
  return `${fmtNum(n, casas)} t`;
}

export function fmtReais(n: number | null | undefined, casas = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function fmtPct(n: number | null | undefined, casas = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${fmtNum(n, casas)}%`;
}

export const ROTULO_STATUS: Record<string, string> = {
  liberado: 'Liberado',
  suspenso: 'Suspenso',
  nao_informado: 'Não informado',
};

export const ROTULO_PAPEL: Record<string, string> = {
  administrador: 'Administrador',
  gestor: 'Gestor',
  supervisor: 'Supervisor',
  embarcador: 'Comercial de Fretes',
  apoio: 'Apoio Operacional',
  operacao: 'Apoio Operacional',
  comercial: 'Coordenador Comercial',
  consulta: 'Consulta interna',
};

export const ROTULO_UNIDADE_FRETE: Record<string, string> = {
  nao_confirmada: 'Não confirmada',
  rs_tonelada: 'R$/t',
  rs_viagem: 'R$/viagem',
  outra: 'Outra',
};

export const ROTULO_CADENCIA: Record<string, string> = {
  veiculos_dia: 'veículos/dia',
  toneladas_dia: 't/dia',
};
