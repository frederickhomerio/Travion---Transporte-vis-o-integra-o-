// Cartão da posição de embarque de um cliente. Usado na prévia interna, na imagem/PDF e no link público.
// Mostra apenas dados liberados para o cliente: nunca valores financeiros, observações internas ou nomes de usuários.

import { forwardRef } from 'react';
import { fmtData, fmtDataHora, fmtHora, fmtT } from '../lib/formato';

export interface ItemCartao {
  origem: string; coleta?: string | null; destino: string; entrega?: string | null; produto?: string | null;
  porta: number; transito: number; carregados?: number;
  porta_t?: number; transito_t?: number; carregado_t?: number;
  observacao?: string | null;
}

export interface DadosCartao {
  cliente: string;
  data: string | null;
  atualizado_em: string | null;
  itens: ItemCartao[];
  mostrarCarregados: boolean;
  mostrarVolumes: boolean;
  demonstrativo?: boolean;
}

export const CartaoPosicao = forwardRef<HTMLDivElement, { d: DadosCartao; rodape?: string }>(function CartaoPosicao({ d, rodape }, ref) {
  const tot = d.itens.reduce((t, i) => ({
    porta: t.porta + i.porta, transito: t.transito + i.transito, carregados: t.carregados + (i.carregados ?? 0),
  }), { porta: 0, transito: 0, carregados: 0 });
  return (
    <div className="previa-posicao" ref={ref}>
      <div className="cab">
        {d.demonstrativo && <div className="badge aviso" style={{ marginBottom: 6 }}>DADOS DEMONSTRATIVOS</div>}
        <div className="pequeno suave" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Posição de embarque</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{d.cliente}</div>
        <div className="pequeno">Data: <strong>{fmtData(d.data)}</strong> · Atualizado às <strong>{fmtHora(d.atualizado_em)}</strong></div>
      </div>
      {d.itens.length === 0 && <p className="suave" style={{ margin: 0 }}>Nenhuma posição registrada para esta data.</p>}
      {d.itens.map((i, n) => (
        <div className="item" key={n}>
          <div><span className="suave pequeno">Origem:</span> <strong>{i.origem}</strong>{i.coleta && <> <span className="suave pequeno">— Coleta:</span> {i.coleta}</>}</div>
          <div><span className="suave pequeno">Destino:</span> <strong>{i.destino}</strong>{i.entrega && <> <span className="suave pequeno">— Entrega:</span> {i.entrega}</>}</div>
          {i.produto && <div className="pequeno"><span className="suave">Produto:</span> {i.produto}</div>}
          <div className="nums">
            <div><b>{i.porta}</b><span>Porta</span></div>
            <div><b>{i.transito}</b><span>Trânsito p/ coleta</span></div>
            {d.mostrarCarregados && <div><b>{i.carregados ?? 0}</b><span>Carregados</span></div>}
          </div>
          {d.mostrarVolumes && (
            <div className="pequeno suave" style={{ marginTop: 6 }}>
              Volume na porta: {fmtT(i.porta_t)} · Em trânsito: {fmtT(i.transito_t)}{d.mostrarCarregados && <> · Carregado: {fmtT(i.carregado_t)}</>}
            </div>
          )}
          {i.observacao && <div className="pequeno" style={{ marginTop: 6 }}><span className="suave">Observação:</span> {i.observacao}</div>}
        </div>
      ))}
      {d.itens.length > 1 && (
        <div className="item" style={{ fontWeight: 700 }}>
          Total — Porta: {tot.porta} · Trânsito: {tot.transito}{d.mostrarCarregados && <> · Carregados: {tot.carregados}</>}
        </div>
      )}
      {rodape && <div className="pequeno suave" style={{ marginTop: 10, borderTop: '1px solid var(--cinza-200)', paddingTop: 8 }}>{rodape}</div>}
    </div>
  );
});

export const rodapeInstantaneo = (agora = new Date().toISOString()) =>
  `Retrato gerado em ${fmtDataHora(agora)} (horário de Brasília). Os números podem mudar ao longo do dia.`;
