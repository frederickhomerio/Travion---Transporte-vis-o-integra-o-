// CPF: máscara 000.000.000-00 e conferência dos dígitos verificadores.

export const soDigitosCpf = (s: string) => s.replace(/\D/g, '').slice(0, 11);

/** Formata enquanto digita: 000.000.000-00 (no máximo 11 dígitos). */
export function mascaraCpf(s: string): string {
  const d = soDigitosCpf(s);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function dv(d: string): number {
  let soma = 0;
  for (let i = 0; i < d.length; i++) soma += Number(d[i]) * (d.length + 1 - i);
  const r = (soma * 10) % 11;
  return r === 10 ? 0 : r;
}

/** CPF válido: 11 dígitos, não todos iguais, e os dois dígitos verificadores conferem. */
export function cpfValido(s: string): boolean {
  const d = s.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10]);
}

/** Completa 9 dígitos com os verificadores (usado nos dados de exemplo da prévia). */
export function completarCpf(base9: string): string {
  const b = base9.replace(/\D/g, '').padStart(9, '0').slice(0, 9);
  const d1 = dv(b);
  return mascaraCpf(`${b}${d1}${dv(b + d1)}`);
}
