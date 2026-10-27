// Estado do aplicativo: sessão, cadastros, embarques, posições e tempo real.
// Os dados vêm sempre do servidor (já filtrados pelo RLS). A interface nunca marca uma alteração
// como salva antes de o servidor confirmar.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { CADASTROS_VAZIOS, type Cadastros, type Indices, indexar } from '../lib/cadastros';
import { FILTROS_VAZIOS, type Filtros } from '../lib/filtros';
import { hojeSP } from '../lib/formato';
import { CONFIG_PADRAO, type Configuracoes, type Embarque, type Financeiro, type LinhaFrete, type Permissao, type Posicao, type Sessao } from '../types';
import { type Api, type EstadoConexao, mensagemErro } from './api';

export interface Estado {
  pronto: boolean;
  sessao: Sessao | null;
  demo: boolean;
  carregando: boolean;
  erro: string | null;
  conexao: EstadoConexao;
  cadastros: Cadastros;
  config: Configuracoes;
  embarques: Record<string, Embarque>;
  financeiro: Record<string, Financeiro>;
  posicoes: Record<string, Posicao>;
  /** intervalos de datas já carregados */
  datasCarregadas: string[];
  data: string;
  filtros: Filtros;
}

const CHAVE_DEMO = 'travion-modo-demo';
const lerDemo = () => { try { return localStorage.getItem(CHAVE_DEMO) === '1'; } catch { return false; } };

class Store {
  estado: Estado;
  private ouvintes = new Set<() => void>();
  constructor(demoInicial: boolean) {
    this.estado = {
      pronto: false, sessao: null, demo: demoInicial, carregando: false, erro: null, conexao: 'conectando',
      cadastros: CADASTROS_VAZIOS, config: CONFIG_PADRAO, embarques: {}, financeiro: {}, posicoes: {},
      datasCarregadas: [], data: hojeSP(), filtros: FILTROS_VAZIOS,
    };
  }
  get = () => this.estado;
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => this.ouvintes.delete(f); };
  set(p: Partial<Estado> | ((e: Estado) => Partial<Estado>)) {
    const parcial = typeof p === 'function' ? p(this.estado) : p;
    this.estado = { ...this.estado, ...parcial };
    for (const o of this.ouvintes) o();
  }
}

interface Contexto {
  api: Api;
  store: Store;
  pode: (p: Permissao) => boolean;
  recarregar: () => Promise<void>;
  garantirPeriodo: (inicio: string, fim: string) => Promise<void>;
  aplicarPosicao: (p: Posicao) => void;
  aplicarEmbarque: (e: Embarque) => void;
  aplicarFinanceiro: (f: Financeiro) => void;
  definirData: (d: string) => void;
  definirFiltros: (f: Partial<Filtros>) => void;
  definirDemo: (demo: boolean) => void;
  atualizarSessao: () => Promise<void>;
}

const Ctx = createContext<Contexto | null>(null);

export function ProvedorDados({ api, children }: { api: Api; children: ReactNode }) {
  const storeRef = useRef<Store>();
  if (!storeRef.current) storeRef.current = new Store(api.modo === 'local' ? true : lerDemo());
  const store = storeRef.current;

  const carregarData = useCallback(async (inicio: string, fim: string) => {
    const { demo } = store.get();
    const ps = await api.carregarPosicoes(demo, inicio, fim);
    store.set((e) => {
      const posicoes = { ...e.posicoes };
      for (const id of Object.keys(posicoes)) {
        const d = posicoes[id].data_operacional;
        if (d >= inicio && d <= fim) delete posicoes[id];
      }
      for (const p of ps) posicoes[p.id] = p;
      const datas = new Set(e.datasCarregadas);
      datas.add(`${inicio}..${fim}`);
      return { posicoes, datasCarregadas: [...datas] };
    });
  }, [api, store]);

  const recarregar = useCallback(async () => {
    const { sessao, demo, data } = store.get();
    if (!sessao || sessao.perfil.status !== 'ativo') return;
    store.set({ carregando: true, erro: null });
    try {
      const [cadastros, config, embarques, financeiro] = await Promise.all([
        api.carregarCadastros(demo),
        api.carregarConfiguracoes(),
        api.carregarEmbarques(demo),
        sessao.permissoes.has('financeiro.ver') ? api.carregarFinanceiro(demo) : Promise.resolve([] as Financeiro[]),
      ]);
      store.set({
        cadastros, config,
        embarques: Object.fromEntries(embarques.map((e) => [e.id, e])),
        financeiro: Object.fromEntries(financeiro.map((f) => [f.embarque_id, f])),
        posicoes: {}, datasCarregadas: [],
      });
      await carregarData(data, data);
      store.set({ carregando: false });
    } catch (e) {
      store.set({ carregando: false, erro: mensagemErro(e) });
    }
  }, [api, store, carregarData]);

  const atualizarSessao = useCallback(async () => {
    try {
      const sessao = await api.sessaoAtual();
      store.set({ sessao, pronto: true });
    } catch (e) {
      store.set({ pronto: true, erro: mensagemErro(e) });
    }
  }, [api, store]);

  // Sessão
  useEffect(() => {
    void atualizarSessao();
    return api.aoMudarAutenticacao((ev) => {
      if (ev === 'SIGNED_OUT') store.set({ sessao: null, embarques: {}, posicoes: {}, financeiro: {}, cadastros: CADASTROS_VAZIOS });
      else if (ev === 'SIGNED_IN' || ev === 'USER_UPDATED') void atualizarSessao();
    });
  }, [api, store, atualizarSessao]);

  // Dados + tempo real
  const sessaoId = useSyncExternalStore(store.assinar, () => `${store.get().sessao?.perfil.id}|${store.get().sessao?.perfil.status}|${[...(store.get().sessao?.permissoes ?? [])].join(',')}|${store.get().demo}`);
  useEffect(() => {
    const { sessao } = store.get();
    if (!sessao || sessao.perfil.status !== 'ativo') return;
    void recarregar();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelar = api.assinar((ev) => {
      const { demo } = store.get();
      if (ev.tabela === 'recarregar') {
        clearTimeout(timer);
        timer = setTimeout(() => void recarregar(), 300);
      } else if (ev.tabela === 'posicoes_diarias') {
        if (ev.registro.is_demo === demo) store.set((e) => ({ posicoes: { ...e.posicoes, [ev.registro.id]: maisRecente(e.posicoes[ev.registro.id], ev.registro) } }));
      } else if (ev.tabela === 'embarques') {
        if (ev.registro.is_demo === demo) store.set((e) => ({ embarques: { ...e.embarques, [ev.registro.id]: maisRecente(e.embarques[ev.registro.id], ev.registro) } }));
      } else if (ev.tabela === 'embarque_financeiro') {
        store.set((e) => (e.embarques[ev.registro.embarque_id]
          ? { financeiro: { ...e.financeiro, [ev.registro.embarque_id]: maisRecente(e.financeiro[ev.registro.embarque_id], ev.registro) } }
          : {}));
      }
    }, (conexao) => store.set({ conexao }));
    return () => { clearTimeout(timer); cancelar(); };
  }, [api, store, sessaoId, recarregar]);

  const ctx = useMemo<Contexto>(() => ({
    api, store,
    pode: (p) => store.get().sessao?.permissoes.has(p) ?? false,
    recarregar,
    garantirPeriodo: async (inicio, fim) => {
      const ja = store.get().datasCarregadas.some((r) => { const [a, b] = r.split('..'); return a <= inicio && b >= fim; });
      if (!ja) await carregarData(inicio, fim);
    },
    aplicarPosicao: (p) => store.set((e) => ({ posicoes: { ...e.posicoes, [p.id]: maisRecente(e.posicoes[p.id], p) } })),
    aplicarEmbarque: (x) => store.set((e) => ({ embarques: { ...e.embarques, [x.id]: maisRecente(e.embarques[x.id], x) } })),
    aplicarFinanceiro: (f) => store.set((e) => ({ financeiro: { ...e.financeiro, [f.embarque_id]: maisRecente(e.financeiro[f.embarque_id], f) } })),
    definirData: (d) => {
      store.set({ data: d });
      void ctx.garantirPeriodo(d, d).catch((err) => store.set({ erro: mensagemErro(err) }));
    },
    definirFiltros: (f) => store.set((e) => ({ filtros: { ...e.filtros, ...f } })),
    definirDemo: (demo) => {
      try { localStorage.setItem(CHAVE_DEMO, demo ? '1' : '0'); } catch { /* preferência só desta sessão */ }
      store.set({ demo, filtros: FILTROS_VAZIOS });
    },
    atualizarSessao,
  }), [api, store, recarregar, carregarData, atualizarSessao]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

/** Evita que um evento antigo (versão menor) sobrescreva um mais novo. */
function maisRecente<T extends { versao: number }>(atual: T | undefined, novo: T): T {
  if (atual && atual.versao > novo.versao) return atual;
  return novo;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ProvedorDados ausente');
  const estado = useSyncExternalStore(c.store.assinar, c.store.get);
  return { ...c, estado };
}

export function useIndices(): Indices {
  const { estado } = useApp();
  return useMemo(() => indexar(estado.cadastros), [estado.cadastros]);
}

/** Linhas (embarque + posição + financeiro) para uma data. */
export function linhasDaData(estado: Estado, data: string): LinhaFrete[] {
  const porEmbarque = new Map<string, Posicao>();
  for (const p of Object.values(estado.posicoes)) if (p.data_operacional === data) porEmbarque.set(p.embarque_id, p);
  return Object.values(estado.embarques)
    .filter((e) => e.situacao === 'ativo' || porEmbarque.has(e.id))
    .map((e) => ({ embarque: e, posicao: porEmbarque.get(e.id) ?? null, financeiro: estado.financeiro[e.id] ?? null }))
    .sort((a, b) => a.embarque.codigo - b.embarque.codigo);
}

export function useLinhas(data?: string): LinhaFrete[] {
  const { estado } = useApp();
  const d = data ?? estado.data;
  return useMemo(() => linhasDaData(estado, d), [estado.embarques, estado.posicoes, estado.financeiro, d]); // eslint-disable-line react-hooks/exhaustive-deps
}
