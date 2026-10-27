// Sino de notificações internas (persistentes no servidor): contador de não lidas e abertura direta da solicitação.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDoc } from '../../data/documentacao';
import { useApp } from '../../data/store';
import { fmtDataHora } from '../../lib/formato';
import type { NotificacaoApp } from '../../types';

export function Sino() {
  const { api } = useApp();
  const { estado, recarregarNotificacoes } = useDoc();
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const naoLidas = estado.notificacoes.filter((n) => !n.lida_em).length;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberto]);

  if (!estado.ativo) return null;
  const abrir = async (n: NotificacaoApp) => {
    setAberto(false);
    if (!n.lida_em) { try { await api.doc.marcarLidas([n.id]); } catch { /* fica não lida */ } void recarregarNotificacoes(); }
    if (n.destino === 'apoio') nav(`/apoio/${n.solicitacao_id}`);
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
          {!estado.notificacoes.length ? <p className="suave sino-vazio">Nenhuma notificação.</p> : (
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
