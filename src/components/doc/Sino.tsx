// Sino de notificações internas (persistentes no servidor): contador de não lidas e abertura direta da solicitação.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDoc } from '../../data/documentacao';
import { useApp } from '../../data/store';
import { fmtDataHora } from '../../lib/formato';
import type { NotificacaoApp } from '../../types';
import { useInd } from '../../industrializado/dados';
import { faltaConferencia, marcadoSemConferencia, pedidoCarga } from '../../industrializado/regras';
import { ROTULO_CHECAGEM } from '../../industrializado/tipos';

export function Sino() {
  const { api, pode } = useApp();
  const { estado, recarregarNotificacoes } = useDoc();
  const ind = useInd();
  // Industrializado: veículo marcou o combinado sem Cadastro, Monitoramento e OC/Vínculo conferidos.
  // Fica no sino enquanto a situação durar (some sozinho quando as 3 conferências forem marcadas).
  const alertasInd = pode('ind.pagina') ? ind.viagens.filter(marcadoSemConferencia) : [];
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const naoLidas = (estado.ativo ? estado.notificacoes.filter((n) => !n.lida_em).length : 0) + alertasInd.length;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberto]);

  if (!estado.ativo && !alertasInd.length && !pode('ind.pagina')) return null;
  const abrir = async (n: NotificacaoApp) => {
    setAberto(false);
    if (!n.lida_em) { try { await api.doc.marcarLidas([n.id]); } catch { /* fica não lida */ } void recarregarNotificacoes(); }
    if (n.destino === 'apoio') nav(`/apoio/${n.solicitacao_id}`);
    else if (n.destino === 'cadastro') nav(`/cadastro?s=${n.solicitacao_id}`);
    else if (n.destino === 'estadia') nav(`/estadia/consultar?s=${n.solicitacao_id}`);
    else nav(`/?emb=${n.embarque_id}&doc=${n.solicitacao_id}`);
  };
  return (
    <div className="sino" ref={caixa}>
      <button className="sino-btn" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}
        aria-label={naoLidas ? `Notificações: ${naoLidas} não lida(s)` : 'Notificações'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {naoLidas > 0 && <span className="sino-cont">{naoLidas > 99 ? '99+' : naoLidas}</span>}
      </button>
      {aberto && (
        <div className="sino-painel" role="dialog" aria-label="Notificações">
          <div className="sino-cab">
            <strong>Notificações</strong>
            {naoLidas > 0 && <button className="btn sutil peq" onClick={async () => { await api.doc.marcarLidas(null).catch(() => undefined); void recarregarNotificacoes(); }}>Marcar todas como lidas</button>}
          </div>
          {alertasInd.length > 0 && (
            <ul>
              {alertasInd.map((v) => (
                <li key={`ind-${v.id}`}>
                  <button className="sino-item nao-lida alerta-ind" onClick={() => { setAberto(false); nav(`/industrializado?quadro=contratados&v=${v.id}`); }}>
                    <strong>Veículo marcado sem conferência · Pedido {pedidoCarga(v)}</strong>
                    <span>{v.motorista ?? 'Motorista'} ({v.placa_cavalo ?? 'sem placa'}) · {ind.clientePorId[v.cliente_id]?.nome ?? ''}</span>
                    <span>Falta: {faltaConferencia(v).map((c) => ROTULO_CHECAGEM[c]).join(', ')}</span>
                    <span className="suave pequeno">Marcou em {fmtDataHora(v.combinado!.marcou_em!)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!estado.ativo ? (!alertasInd.length && <p className="suave sino-vazio">Nenhuma notificação.</p>) : !estado.notificacoes.length ? (!alertasInd.length && <p className="suave sino-vazio">Nenhuma notificação.</p>) : (
            <ul>
              {estado.notificacoes.slice(0, 30).map((n) => (
                <li key={n.id}>
                  <button className={`sino-item${n.lida_em ? '' : ' nao-lida'}`} onClick={() => void abrir(n)}>
                    <strong>{n.titulo}</strong><span>{n.texto}</span><span className="suave pequeno">{fmtDataHora(n.criada_em)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
