// Estado da documentação (solicitações, lotes, detalhes e notificações) com sincronização em duas vias:
// tempo real (quando a assinatura é confirmada) e consulta incremental a cada 15 s como reforço.
// Registros são identificados pelo id; a versão maior vence, então evento e consulta não duplicam nada.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { AnexoDoc, LoteErp, MensagemDoc, NotificacaoApp, SolicitacaoDoc } from '../types';
import { mensagemErro, type ResultadoDoc } from './api';
import { useApp } from './store';

export const INTERVALO_SYNC_MS = 15000;
const INTERVALO_NOTIF_MS = 30000;
/** Margem para registros gravados por transações que terminaram depois da última consulta. */
const MARGEM_MS = 60000;

export interface DetalheDoc { mensagens: MensagemDoc[]; anexos: AnexoDoc[]; versao: number }

export interface EstadoDoc {
  ativo: boolean;
  carregado: boolean;
  erro: string | null;
  solicitacoes: Record<string, SolicitacaoDoc>;
  /** Lote por embarque_id. */
  lotes: Record<string, LoteErp>;
  detalhes: Record<string, DetalheDoc>;
  notificacoes: NotificacaoApp[];
  /** Horário (do navegador) da última sincronização bem-sucedida com o servidor. */
  ultimaSync: number | null;
  falhaSync: boolean;
  tempoReal: boolean;
}

const VAZIO: EstadoDoc = {
  ativo: false, carregado: false, erro: null, solicitacoes: {}, lotes: {}, detalhes: {}, notificacoes: [],
  ultimaSync: null, falhaSync: false, tempoReal: false,
};

class StoreDoc {
  estado: EstadoDoc = VAZIO;
  private ouvintes = new Set<() => void>();
  get = () => this.estado;
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => this.ouvintes.delete(f); };
  set(p: Partial<EstadoDoc> | ((e: EstadoDoc) => Partial<EstadoDoc>)) {
    this.estado = { ...this.estado, ...(typeof p === 'function' ? p(this.estado) : p) };
    for (const o of this.ouvintes) o();
  }
  mesclar(ss: SolicitacaoDoc[], ls: LoteErp[]) {
    if (!ss.length && !ls.length) return;
    this.set((e) => {
      const solicitacoes = { ...e.solicitacoes };
      for (const s of ss) {
        const a = solicitacoes[s.id];
        if (!a || a.versao <= s.versao) solicitacoes[s.id] = s.nomes_nf || !a?.nomes_nf ? s : { ...s, nomes_nf: a.nomes_nf };
      }
      const lotes = { ...e.lotes };
      for (const l of ls) { const a = lotes[l.embarque_id]; if (!a || a.versao <= l.versao) lotes[l.embarque_id] = l; }
      return { solicitacoes, lotes };
    });
  }
}

interface CtxDoc {
  store: StoreDoc;
  sincronizar: (completo?: boolean) => Promise<void>;
  aplicar: (r: ResultadoDoc) => void;
  carregarDetalhe: (id: string) => Promise<void>;
  carregarEmbarque: (embarqueId: string) => Promise<void>;
  recarregarNotificacoes: () => Promise<void>;
}
const Ctx = createContext<CtxDoc | null>(null);

export function ProvedorDoc({ children }: { children: ReactNode }) {
  const { api, estado } = useApp();
  const ref = useRef<StoreDoc>();
  if (!ref.current) ref.current = new StoreDoc();
  const store = ref.current;
  const emCurso = useRef(false);
  const perms = estado.sessao?.permissoes;
  const ativo = !!estado.sessao && estado.sessao.perfil.status === 'ativo'
    && !!perms && (perms.has('documentacao.ver') || perms.has('apoio.pagina') || perms.has('cadastro.ver') || perms.has('cadastro.solicitar'));
  const perfilId = estado.sessao?.perfil.id ?? null;

  const sincronizar = useCallback(async (completo = false) => {
    if (emCurso.current) return; // sem consultas sobrepostas
    emCurso.current = true;
    try {
      const e = store.get();
      let desde: string | null = null;
      if (!completo && e.carregado) {
        const max = Object.values(e.solicitacoes).reduce((m, s) => (s.atualizado_em > m ? s.atualizado_em : m), '');
        const maxL = Object.values(e.lotes).reduce((m, l) => (l.atualizado_em > m ? l.atualizado_em : m), max);
        desde = maxL ? new Date(Date.parse(maxL) - MARGEM_MS).toISOString() : null;
      }
      const r = await api.doc.listar(desde);
      if (!desde) store.set({ solicitacoes: {}, lotes: {} });
      store.mesclar(r.solicitacoes, r.lotes);
      store.set({ carregado: true, erro: null, falhaSync: false, ultimaSync: Date.now() });
    } catch (err) {
      store.set({ falhaSync: true, erro: store.get().carregado ? null : mensagemErro(err) });
    } finally {
      emCurso.current = false;
    }
  }, [api, store]);

  const carregarDetalhe = useCallback(async (id: string) => {
    const s = store.get().solicitacoes[id];
    const d = await api.doc.detalhe(id);
    store.set((e) => ({ detalhes: { ...e.detalhes, [id]: { ...d, versao: s?.versao ?? 0 } } }));
  }, [api, store]);

  const carregarEmbarque = useCallback(async (embarqueId: string) => {
    const r = await api.doc.listarDoEmbarque(embarqueId);
    store.mesclar(r.solicitacoes, r.lotes);
  }, [api, store]);

  const recarregarNotificacoes = useCallback(async () => {
    try { store.set({ notificacoes: await api.doc.notificacoes() }); } catch { /* a próxima rodada tenta de novo */ }
  }, [api, store]);

  useEffect(() => {
    store.set({ ...VAZIO, ativo });
    if (!ativo) return;
    void sincronizar(true);
    void recarregarNotificacoes();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const cancelar = api.doc.assinar((ev) => {
      if (ev.tabela === 'notificacoes') { void recarregarNotificacoes(); return; }
      if (ev.tabela === 'detalhe' && ev.id && store.get().detalhes[ev.id]) void carregarDetalhe(ev.id).catch(() => undefined);
      clearTimeout(debounce);
      debounce = setTimeout(() => void sincronizar(), 250);
    }, (ok) => {
      const antes = store.get().tempoReal;
      store.set({ tempoReal: ok });
      if (ok && !antes) void sincronizar(); // ao (re)estabelecer a assinatura, busca o que pode ter passado
    });
    const t = setInterval(() => { if (document.visibilityState === 'visible') void sincronizar(); }, INTERVALO_SYNC_MS);
    const tn = setInterval(() => { if (document.visibilityState === 'visible') void recarregarNotificacoes(); }, INTERVALO_NOTIF_MS);
    const voltar = () => { if (document.visibilityState === 'visible') { void sincronizar(); void recarregarNotificacoes(); } };
    const online = () => { void sincronizar(); void recarregarNotificacoes(); };
    const offline = () => store.set({ falhaSync: true, tempoReal: false });
    document.addEventListener('visibilitychange', voltar);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      clearTimeout(debounce); clearInterval(t); clearInterval(tn); cancelar();
      document.removeEventListener('visibilitychange', voltar);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [api, store, ativo, perfilId, sincronizar, recarregarNotificacoes, carregarDetalhe]);

  const ctx = useMemo<CtxDoc>(() => ({
    store, sincronizar, carregarDetalhe, carregarEmbarque, recarregarNotificacoes,
    aplicar: (r) => store.mesclar([r.registro], r.lote ? [r.lote] : []),
  }), [store, sincronizar, carregarDetalhe, carregarEmbarque, recarregarNotificacoes]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useDoc() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ProvedorDoc ausente');
  const estado = useSyncExternalStore(c.store.assinar, c.store.get);
  return { ...c, estado };
}

/** Detalhe (mensagens e anexos) sempre alinhado à versão atual da solicitação. */
export function useDetalheDoc(id: string | null) {
  const { estado, carregarDetalhe } = useDoc();
  const s = id ? estado.solicitacoes[id] : undefined;
  const d = id ? estado.detalhes[id] : undefined;
  const versao = s?.versao ?? 0;
  const precisa = !!id && (!d || d.versao < versao);
  const erroRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !precisa) return;
    carregarDetalhe(id).then(() => { erroRef.current = null; }, (e) => { erroRef.current = mensagemErro(e); });
  }, [id, precisa, versao, carregarDetalhe]);
  return { detalhe: d ?? null, carregando: precisa && !d, erro: erroRef.current };
}
