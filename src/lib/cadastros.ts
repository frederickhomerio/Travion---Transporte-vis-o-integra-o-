import type { Cliente, Comercial, Filial, Local, Produto } from '../types';

export interface Cadastros {
  filiais: Filial[];
  comerciais: Comercial[];
  clientes: Cliente[];
  produtos: Produto[];
  locais: Local[];
}

export interface Indices {
  filial: Map<string, Filial>;
  comercial: Map<string, Comercial>;
  cliente: Map<string, Cliente>;
  produto: Map<string, Produto>;
  local: Map<string, Local>;
}

export function indexar(c: Cadastros): Indices {
  return {
    filial: new Map(c.filiais.map((x) => [x.id, x])),
    comercial: new Map(c.comerciais.map((x) => [x.id, x])),
    cliente: new Map(c.clientes.map((x) => [x.id, x])),
    produto: new Map(c.produtos.map((x) => [x.id, x])),
    local: new Map(c.locais.map((x) => [x.id, x])),
  };
}

export const CADASTROS_VAZIOS: Cadastros = { filiais: [], comerciais: [], clientes: [], produtos: [], locais: [] };

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
