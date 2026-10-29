// Quadros por centro de custo ao lado da data (Posição do Cliente): verde quando todas as posições do centro
// foram atualizadas na última hora, vermelho quando falta alguma (pedido de 29/10/2026).

import { useMemo } from 'react';
import { nome, type Indices } from '../lib/cadastros';
import { centroDaLinha, SEM_CENTRO } from '../lib/posicoes';
import type { LinhaFrete } from '../types';
import { useAgora } from './doc/Comum';

const UMA_HORA = 3600_000;

/** Última atualização da posição (contadores ou confirmação), em ms; 0 quando nunca foi atualizada. */
export function ultimaAtualizacao(p: NonNullable<LinhaFrete['posicao']>): number {
  return Math.max(Date.parse(p.atualizado_em ?? '') || 0, Date.parse(p.confirmado_em ?? '') || 0);
}
export const atualizadaNaHora = (p: NonNullable<LinhaFrete['posicao']>, agora: number) => {
  const t = ultimaAtualizacao(p);
  return t > 0 && agora - t <= UMA_HORA;
};

export function AtualizacaoCentros({ linhas, idx }: { linhas: LinhaFrete[]; idx: Indices }) {
  const agora = useAgora(60000);
  const centros = useMemo(() => {
    const m = new Map<string, { total: number; ok: number }>();
    for (const l of linhas) {
      const e = l.embarque;
      if (!l.posicao || e.situacao !== 'ativo' || e.status_liberacao === 'suspenso' || e.encerrado_em) continue;
      const cc = centroDaLinha(l, idx);
      const g = m.get(cc) ?? { total: 0, ok: 0 };
      g.total++;
      if (atualizadaNaHora(l.posicao, agora)) g.ok++;
      m.set(cc, g);
    }
    return [...m.entries()].map(([cc, g]) => ({ cc, nome: cc === SEM_CENTRO ? 'Sem centro' : nome(idx.centroCusto, cc), ...g }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [linhas, idx, agora]);
  if (!centros.length) return null;
  return (
    <div className="ac-centros" role="list" aria-label="Atualização das posições por centro de custo na última hora">
      {centros.map((c) => {
        const tudo = c.ok === c.total;
        return (
          <div key={c.cc} role="listitem" className={`ac-centro ${tudo ? 'ok' : 'falta'}`}
            title={tudo ? 'Todas as posições atualizadas na última hora' : `${c.total - c.ok} posição(ões) sem atualização na última hora`}>
            <strong>{c.nome}</strong>
            <span>{c.ok}/{c.total} na última hora</span>
          </div>
        );
      })}
    </div>
  );
}
