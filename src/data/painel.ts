// Dados do Painel Operacional: consulta completa ao mudar o período, tempo real (mudanças nas solicitações) e
// consulta incremental de reforço a cada 15 s enquanto a página está visível. Sem consultas sobrepostas.

import { useCallback, useEffect, useRef, useState } from 'react';
import { mensagemErro } from './api';
import { useApp } from './store';
import { type DadosPainel, mesclarPainel } from '../lib/painelOperacional';

export const INTERVALO_PAINEL_MS = 15000;
/** Margem para gravações de transações que terminaram depois da última consulta. */
const MARGEM_MS = 60000;

export interface EstadoPainel {
  dados: DadosPainel | null;
  carregando: boolean;
  erro: string | null;
  /** Horário (do navegador) da última sincronização bem-sucedida. */
  ultimaSync: number | null;
  falhaSync: boolean;
  tempoReal: boolean;
  /** Diferença relógio do servidor − navegador, para os contadores de espera. */
  desvio: number;
}

export function usePainel(desde: string, ate: string, ativo: boolean) {
  const { api } = useApp();
  const [st, setSt] = useState<EstadoPainel>({ dados: null, carregando: true, erro: null, ultimaSync: null, falhaSync: false, tempoReal: false, desvio: 0 });
  const ref = useRef(st);
  ref.current = st;
  const emCurso = useRef(false);
  const pendente = useRef(false);
  const janela = useRef(`${desde}|${ate}`);

  const buscar = useCallback(async (completo: boolean) => {
    if (emCurso.current) { pendente.current = true; return; }
    emCurso.current = true;
    const chave = `${desde}|${ate}`;
    try {
      const base = completo ? null : ref.current.dados;
      const alterados = base ? new Date(Date.parse(base.agora) - MARGEM_MS).toISOString() : null;
      const pedido = Date.now();
      const r = await api.doc.painel(desde, ate, alterados);
      if (janela.current !== chave) return; // período mudou durante a consulta
      const desvio = Date.parse(r.agora) - (pedido + Date.now()) / 2;
      setSt((e) => ({ ...e, dados: base ? mesclarPainel(base, r) : r, carregando: false, erro: null, falhaSync: false, ultimaSync: Date.now(), desvio }));
    } catch (err) {
      setSt((e) => ({ ...e, carregando: false, falhaSync: true, erro: e.dados ? null : mensagemErro(err) }));
    } finally {
      emCurso.current = false;
      if (pendente.current) { pendente.current = false; void buscar(false); }
    }
  }, [api, desde, ate]);

  useEffect(() => {
    if (!ativo) return;
    janela.current = `${desde}|${ate}`;
    setSt((e) => ({ ...e, dados: null, carregando: true, erro: null }));
    void buscar(true);
  }, [ativo, desde, ate, buscar]);

  useEffect(() => {
    if (!ativo) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const cancelar = api.doc.assinar((ev) => {
      if (ev.tabela !== 'solicitacoes') return;
      clearTimeout(debounce);
      debounce = setTimeout(() => void buscar(false), 400);
    }, (ok) => {
      const antes = ref.current.tempoReal;
      setSt((e) => ({ ...e, tempoReal: ok }));
      if (ok && !antes && ref.current.dados) void buscar(false); // ao (re)conectar, busca o que pode ter passado
    });
    const t = setInterval(() => { if (document.visibilityState === 'visible') void buscar(false); }, INTERVALO_PAINEL_MS);
    const voltar = () => { if (document.visibilityState === 'visible') void buscar(false); };
    const online = () => void buscar(false);
    const offline = () => setSt((e) => ({ ...e, falhaSync: true, tempoReal: false }));
    document.addEventListener('visibilitychange', voltar);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      clearTimeout(debounce); clearInterval(t); cancelar();
      document.removeEventListener('visibilitychange', voltar);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [api, ativo, buscar]);

  return { ...st, recarregar: () => buscar(true) };
}
