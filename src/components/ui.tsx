import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ROTULO_STATUS } from '../lib/formato';
import type { StatusLiberacao } from '../types';

// ---------------------------------------------------------------------------
// Ícones (SVG inline, sem dependências)
// ---------------------------------------------------------------------------
const caminhos: Record<string, string> = {
  lista: 'M4 6h16M4 12h16M4 18h16',
  painel: 'M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-4H4v4Zm10-16v4h6V4h-6Z',
  cliente: 'M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  analise: 'M4 19h16M7 16V9m5 7V5m5 11v-4',
  posicao: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  filtro: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  fechar: 'M6 6l12 12M18 6 6 18',
  mais: 'M12 5v14M5 12h14',
  seta: 'M5 12h14m-5-5 5 5-5 5',
  copiar: 'M9 9h10v10H9zM5 15V5h10',
  baixar: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
  email: 'M4 6h16v12H4zM4 7l8 6 8-6',
  whats: 'M5 19l1.3-3.9A7.5 7.5 0 1 1 9 18.2L5 19Z',
  importar: 'M12 15V4m0 11-4-4m4 4 4-4M4 15v4h16v-4',
  sair: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  atualizar: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  caminhao: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
};

export function Icone({ nome, tam = 20 }: { nome: keyof typeof caminhos | string; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={caminhos[nome] ?? ''} />
    </svg>
  );
}

export function Logo({ tam = 30 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#3a0a12" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="7.25" fill="none" stroke="#c6a044" strokeWidth="1.5" />
      <path d="M9 10h14M16 10v13" stroke="#e3c579" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
export function BadgeStatus({ status }: { status: StatusLiberacao }) {
  const simb = status === 'liberado' ? '●' : status === 'suspenso' ? '■' : '○';
  return <span className={`badge ${status}`}><span aria-hidden="true">{simb}</span>{ROTULO_STATUS[status]}</span>;
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------
export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className="estado" role="status"><span className="girando" /><p>{texto}</p></div>;
}

export function EstadoVazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="estado"><h2>{titulo}</h2>{children}</div>;
}

export function AcessoNegado({ motivo }: { motivo?: string }) {
  return (
    <div className="estado" role="alert">
      <h2>Acesso negado</h2>
      <p>{motivo ?? 'Seu perfil não tem permissão para esta área. Fale com um administrador se precisar de acesso.'}</p>
    </div>
  );
}

export function Alerta({ tipo, children }: { tipo: 'erro' | 'aviso' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`alerta ${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Modal e gaveta
// ---------------------------------------------------------------------------
function useEsc(aoFechar: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [aoFechar]);
}

export function Modal({ titulo, aoFechar, children, rodape }: { titulo: string; aoFechar: () => void; children: ReactNode; rodape?: ReactNode }) {
  useEsc(aoFechar);
  return (
    <div className="fundo-modal centro" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab"><h2>{titulo}</h2></div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}

export function Gaveta({ titulo, subtitulo, aoFechar, children, extra }: { titulo: ReactNode; subtitulo?: ReactNode; aoFechar: () => void; children: ReactNode; extra?: ReactNode }) {
  useEsc(aoFechar);
  return (
    <div className="fundo-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <aside className="gaveta" role="dialog" aria-modal="true">
        <div className="gaveta-cab">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{titulo}</h2>
            {subtitulo && <div className="suave pequeno" style={{ marginTop: 4 }}>{subtitulo}</div>}
          </div>
          {extra}
          <button className="btn btn-icone" onClick={aoFechar} aria-label="Fechar"><Icone nome="fechar" /></button>
        </div>
        <div className="gaveta-corpo">{children}</div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avisos rápidos (toasts)
// ---------------------------------------------------------------------------
interface Toast { id: number; tipo: 'ok' | 'erro' | 'info'; texto: string }
const ToastCtx = createContext<(tipo: Toast['tipo'], texto: string) => void>(() => undefined);

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const avisar = useCallback((tipo: Toast['tipo'], texto: string) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l.slice(-3), { id, tipo, texto }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      <div className="toasts" aria-live="polite">
        {lista.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`}>
            <span>{t.texto}</span>
            <button aria-label="Fechar aviso" onClick={() => setLista((l) => l.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useAviso = () => useContext(ToastCtx);

export function Segmentado<T extends string>({ valor, opcoes, aoMudar, rotulo }: { valor: T; opcoes: Array<{ valor: T; rotulo: string }>; aoMudar: (v: T) => void; rotulo: string }) {
  return (
    <div className="segmentado" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o.valor} type="button" className={o.valor === valor ? 'ativo' : ''} aria-pressed={o.valor === valor} onClick={() => aoMudar(o.valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
