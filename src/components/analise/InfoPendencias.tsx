// Ícone de informação dos valores em R$ do Dashboard: mostra quais lotes deixaram o valor "Não validado" (erro)
// ou ficaram fora do cálculo em R$/t (aviso), com atalho para abrir o lote na Lista de Fretes.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useIndices } from '../../data/store';
import { nome } from '../../lib/cadastros';
import type { PendenciaFinanceira } from '../../lib/dashboard';
import { cidadeAnuncio } from '../../lib/anuncio';

export function InfoPendencias({ itens, rotulo = 'Ver o que falta para validar' }: { itens: PendenciaFinanceira[]; rotulo?: string }) {
  const idx = useIndices();
  const { estado } = useApp();
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberto]);
  if (!itens.length) return null;
  const erros = itens.filter((p) => p.tipo === 'erro').length;
  return (
    <span className="ip" ref={caixa}>
      <button type="button" className={`ip-btn${erros ? ' erro' : ''}`} onClick={() => setAberto((a) => !a)} aria-expanded={aberto}
        aria-label={rotulo} title={rotulo}>i</button>
      {aberto && (
        <div className="ip-painel" role="dialog" aria-label="Lotes com problema no frete">
          <div className="ip-cab">
            <strong>{erros ? `${erros} lote(s) impedem a validação` : 'Avisos do frete (não impedem a validação)'}</strong>
            {itens.length > erros && erros > 0 && <span>e {itens.length - erros} aviso(s), que não impedem a validação</span>}
          </div>
          <ul>
            {itens.map((p) => {
              const e = estado.embarques[p.embarque_id];
              return (
                <li key={p.embarque_id} className={p.tipo}>
                  <div className="ip-txt">
                    <strong>{e ? nome(idx.cliente, e.cliente_id) : 'Lote'}</strong>
                    {e && <span className="ip-rota">{cidadeAnuncio(e.origem_cidade, e.origem_uf)} ➜ {cidadeAnuncio(e.destino_cidade, e.destino_uf)} · {nome(idx.filial, e.filial_id)}</span>}
                    <span className="ip-prob">{p.tipo === 'erro' ? '■ ' : '● '}{p.problema}</span>
                  </div>
                  <button type="button" className="btn peq" onClick={() => nav(`/?emb=${p.embarque_id}`)}>Abrir lote</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </span>
  );
}
