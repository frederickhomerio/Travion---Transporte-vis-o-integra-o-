// Lista de Fretes: três estados (Liberados, Suspensos, Encerrados) e a vitrine de todos os centros de custo (02/11/2026).

import type { Embarque, Financeiro, ItemVitrine, LinhaFrete } from '../types';

export type AbaEmbarque = 'liberados' | 'suspensos' | 'encerrados';

/** Aba de cada embarque. Encerrado = situacao 'arquivado' com encerrado_em; o status_liberacao de um encerrado guarda o
 *  estado anterior e não decide a aba. Devolve null para combinações que não deveriam existir. */
export function abaDoEmbarque(e: Pick<Embarque, 'situacao' | 'encerrado_em' | 'status_liberacao'>): AbaEmbarque | null {
  if (e.situacao === 'arquivado') return e.encerrado_em ? 'encerrados' : null;
  if (e.encerrado_em) return null;
  if (e.status_liberacao === 'liberado') return 'liberados';
  if (e.status_liberacao === 'suspenso') return 'suspensos';
  return null;
}

/** Linha da vitrine: a linha da Lista de Fretes e se a pessoa pode agir nela (centro de custo autorizado). */
export interface LinhaVitrine extends LinhaFrete {
  noEscopo: boolean;
  centroCustoId: string | null;
}

/** Monta as linhas da vitrine. No escopo, usa o embarque completo e o financeiro que a pessoa já recebe (com margem);
 *  fora do escopo, só os campos da vitrine (sem cliente, carteira, frete empresa ou margem). */
export function linhasVitrine(itens: ItemVitrine[], embarques: Record<string, Embarque>, financeiro: Record<string, Financeiro>): LinhaVitrine[] {
  return itens.map((v) => {
    const completo = v.no_escopo ? embarques[v.id] : undefined;
    const freteVitrine: Financeiro = {
      embarque_id: v.id, frete_empresa: null, frete_motorista: v.frete_motorista, unidade_frete: v.unidade_frete ?? 'nao_confirmada',
      frete_empresa_original: null, frete_motorista_original: null, versao: 0, atualizado_em: v.atualizado_em,
    };
    const embarque: Embarque = completo ?? {
      id: v.id, codigo: v.codigo, cliente_id: '', comercial_id: null, filial_id: v.filial_id, produto_id: v.produto_id,
      origem_cidade: v.origem_cidade, origem_uf: v.origem_uf, local_coleta_id: v.local_coleta_id,
      destino_cidade: v.destino_cidade, destino_uf: v.destino_uf, local_entrega_id: v.local_entrega_id,
      status_liberacao: 'liberado', data_liberacao: null, cadencia_valor: null, cadencia_unidade: 'veiculos_dia',
      toneladas_por_veiculo: 0, observacao_interna: null, situacao: 'ativo', is_demo: false, chave_importacao: null, versao: 0,
      atualizado_em: v.atualizado_em, atualizado_por_nome: null,
    };
    return {
      embarque, posicao: null, financeiro: (completo && financeiro[v.id]) || freteVitrine,
      // Só age quem tem o centro de custo autorizado E já recebeu o embarque completo (a RLS confirmou o acesso).
      noEscopo: v.no_escopo && !!completo, centroCustoId: v.centro_custo_id,
    };
  });
}

/** Enquanto a vitrine não chega, a lista mostra os liberados do próprio escopo (o que a pessoa já tinha antes). */
export function linhasDoEscopo(linhas: LinhaFrete[], centroDaFilial: (filialId: string) => string | null): LinhaVitrine[] {
  return linhas.filter((l) => abaDoEmbarque(l.embarque) === 'liberados')
    .map((l) => ({ ...l, noEscopo: true, centroCustoId: centroDaFilial(l.embarque.filial_id) }));
}

/** Limite do motivo da reativação (o servidor confere o mesmo). */
export const LIMITE_MOTIVO = 500;
export const motivoValido = (m: string) => m.trim().length > 0 && m.trim().length <= LIMITE_MOTIVO;
