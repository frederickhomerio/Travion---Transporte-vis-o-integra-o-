import type { LinhaFrete, StatusLiberacao } from '../types';
import { type Indices, codigoEmbarque, nome } from './cadastros';
import { temMovimentacao } from './calculos';
import { contem, normalizar } from './texto';

export interface Filtros {
  busca: string;
  cliente_id: string;
  filial_id: string;
  comercial_id: string;
  produto_id: string;
  origem: string;
  destino: string;
  status: '' | StatusLiberacao;
  soMovimentacao: boolean;
  incluirSemPosicao: boolean;
  incluirArquivados: boolean;
}

export const FILTROS_VAZIOS: Filtros = {
  busca: '', cliente_id: '', filial_id: '', comercial_id: '', produto_id: '', origem: '', destino: '', status: '',
  soMovimentacao: false, incluirSemPosicao: true, incluirArquivados: false,
};

export function filtrosAtivos(f: Filtros): number {
  return (['cliente_id', 'filial_id', 'comercial_id', 'produto_id', 'origem', 'destino', 'status'] as const).filter((k) => f[k]).length
    + (f.soMovimentacao ? 1 : 0) + (f.busca.trim() ? 1 : 0) + (f.incluirArquivados ? 1 : 0) + (!f.incluirSemPosicao ? 1 : 0);
}

export function aplicarFiltros(linhas: LinhaFrete[], f: Filtros, idx: Indices): LinhaFrete[] {
  const busca = normalizar(f.busca);
  return linhas.filter((l) => {
    const e = l.embarque;
    if (!f.incluirArquivados && e.situacao === 'arquivado') return false;
    if (!f.incluirSemPosicao && !l.posicao) return false;
    if (f.cliente_id && e.cliente_id !== f.cliente_id) return false;
    if (f.filial_id && e.filial_id !== f.filial_id) return false;
    if (f.comercial_id && (f.comercial_id === '__sem' ? e.comercial_id !== null : e.comercial_id !== f.comercial_id)) return false;
    if (f.produto_id && e.produto_id !== f.produto_id) return false;
    if (f.origem && normalizar(e.origem_cidade) !== f.origem) return false;
    if (f.destino && normalizar(e.destino_cidade) !== f.destino) return false;
    if (f.status && e.status_liberacao !== f.status) return false;
    if (f.soMovimentacao && !temMovimentacao(l.posicao)) return false;
    if (busca) {
      const alvo = [
        codigoEmbarque(e.codigo), nome(idx.cliente, e.cliente_id), nome(idx.filial, e.filial_id), nome(idx.comercial, e.comercial_id, ''),
        nome(idx.produto, e.produto_id, ''), e.origem_cidade, e.destino_cidade, nome(idx.local, e.local_coleta_id, ''),
        nome(idx.local, e.local_entrega_id, ''), l.posicao?.obs_operacional ?? '', l.posicao?.obs_cliente ?? '',
      ].join(' ');
      if (!contem(alvo, busca)) return false;
    }
    return true;
  });
}

/** Valores distintos de cidades (para os filtros de origem/destino). */
export function cidades(linhas: LinhaFrete[], campo: 'origem_cidade' | 'destino_cidade'): Array<{ valor: string; rotulo: string }> {
  const m = new Map<string, string>();
  for (const l of linhas) {
    const c = l.embarque[campo];
    if (c && !m.has(normalizar(c))) m.set(normalizar(c), c);
  }
  return [...m.entries()].map(([valor, rotulo]) => ({ valor, rotulo })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}
