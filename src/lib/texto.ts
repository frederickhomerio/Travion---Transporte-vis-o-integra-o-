// Normalização de textos e números vindos da planilha ou digitados.

/** Mesmo critério do banco (private.normalizar): sem acentos, maiúsculas, espaços simples. */
export function normalizar(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove espaços extras mantendo acentos e caixa originais. */
export function limpar(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Converte valores como 61, "R$ 67,50", "138,50", "1.234,56" ou "1234.5" em número.
 * Retorna null para vazio e undefined para texto que não é número (inconsistência).
 */
export function parseNumeroBR(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  let s = String(v).trim();
  if (s === '') return null;
  s = s.replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}

/** Contador: inteiro >= 0. Retorna null para vazio e undefined para valor inválido. */
export function parseContador(v: unknown): number | null | undefined {
  const n = parseNumeroBR(v);
  if (n === null || n === undefined) return n;
  if (n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

export function parseUF(v: unknown): string | null | undefined {
  const s = normalizar(v);
  if (!s) return null;
  return /^[A-Z]{2}$/.test(s) ? s : undefined;
}

export function parseStatus(v: unknown): 'liberado' | 'suspenso' | 'nao_informado' | undefined {
  const s = normalizar(v);
  if (!s) return 'nao_informado';
  if (s.startsWith('LIBERAD')) return 'liberado';
  if (s.startsWith('SUSPENS')) return 'suspenso';
  if (s === 'NAO INFORMADO') return 'nao_informado';
  return undefined;
}

/** Observação sugere suspensão? (só gera sugestão; nunca altera status sozinha) */
export function sugereSuspensao(obs: unknown): boolean {
  return /\bSUSPENS/.test(normalizar(obs));
}

export function contem(texto: string, busca: string): boolean {
  return normalizar(texto).includes(normalizar(busca));
}
