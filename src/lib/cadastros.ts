import type { CentroCusto, Cidade, Cliente, Comercial, Filial, Local, Produto } from '../types';

export interface Cadastros {
  filiais: Filial[];
  comerciais: Comercial[];
  clientes: Cliente[];
  produtos: Produto[];
  locais: Local[];
  cidades: Cidade[];
  centros_custo: CentroCusto[];
}

export interface Indices {
  filial: Map<string, Filial>;
  comercial: Map<string, Comercial>;
  cliente: Map<string, Cliente>;
  produto: Map<string, Produto>;
  local: Map<string, Local>;
  centroCusto: Map<string, CentroCusto>;
}

export function indexar(c: Cadastros): Indices {
  return {
    filial: new Map(c.filiais.map((x) => [x.id, x])),
    comercial: new Map(c.comerciais.map((x) => [x.id, x])),
    cliente: new Map(c.clientes.map((x) => [x.id, x])),
    produto: new Map(c.produtos.map((x) => [x.id, x])),
    local: new Map(c.locais.map((x) => [x.id, x])),
    centroCusto: new Map(c.centros_custo.map((x) => [x.id, x])),
  };
}

export const CADASTROS_VAZIOS: Cadastros = { filiais: [], comerciais: [], clientes: [], produtos: [], locais: [], cidades: [], centros_custo: [] };

export function nome<T extends { nome: string }>(m: Map<string, T>, id: string | null | undefined, padrao = '—'): string {
  if (!id) return padrao;
  return m.get(id)?.nome ?? padrao;
}

export function cidadeUF(cidade: string | null | undefined, uf: string | null | undefined): string {
  if (!cidade) return '—';
  return uf ? `${cidade}/${uf}` : cidade;
}

export function codigoEmbarque(codigo: number): string {
  return `EMB-${String(codigo).padStart(6, '0')}`;
}

/** CNPJ só com dígitos e com os dígitos verificadores corretos. */
export function cnpjValido(v: string | null | undefined): boolean {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) { soma += Number(c) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

export function formatarCnpj(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 14);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Separa "Rio Verde/GO" em cidade e UF. */
export function separarCidadeUF(v: string): { cidade: string; uf: string | null } {
  const m = v.trim().match(/^(.*?)\s*[/-]\s*([A-Za-z]{2})$/);
  return m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : { cidade: v.trim(), uf: null };
}

/** Máscara de telefone brasileiro enquanto digita: (64) 99999-0000 ou (64) 3600-0000. */
export function formatarTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Máscara de CNPJ enquanto digita. */
export function mascaraCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Cliente com restrição "NÃO CARREGAR" (carteira bloqueada na planilha antiga): dispensa comercial. */
export function naoCarregar(restricao: string | null | undefined): boolean {
  return (restricao ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase() === 'NAO CARREGAR';
}
