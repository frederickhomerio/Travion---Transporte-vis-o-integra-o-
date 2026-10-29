// Aba Apoio Operacional: abre na fila de demandas. Assumir é atômico no servidor; o atendimento em dois quadros
// só abre depois que a atribuição foi confirmada. A fila se atualiza sozinha (tempo real + consulta a cada 15 s).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusDocPill, TipoNumero, useAgora } from '../components/doc/Comum';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, Carregando, EstadoVazio, useAviso } from '../components/ui';
import { mensagemErro } from '../data/api';
import { useDoc } from '../data/documentacao';
import { useApp } from '../data/store';
import { type Atalho, FILTROS_FILA, type FiltrosFila, TIPO_FILA, type TipoFila, filtrarFila, filtrarSemAtalho, fmtPlaca, noAtalho, rotaDoc, tempoDoc } from '../lib/documentacao';
import { fmtHora } from '../lib/formato';
import { documentosEstadia, periodoEstadia } from '../lib/estadia';
import type { SolicitacaoDoc } from '../types';

const CHAVE_FILTROS = 'travion-fila-apoio';
let rolagemFila = 0;

function lerFiltros(): FiltrosFila {
  // A fila não filtra por filial nem centro de custo: zera o que tenha ficado salvo de versões anteriores.
  try {
    const f = { ...FILTROS_FILA, ...(JSON.parse(sessionStorage.getItem(CHAVE_FILTROS) ?? '{}') as Partial<FiltrosFila>), filial: '', centro: '' };
    return f.tipo && !(f.tipo in TIPO_FILA) ? { ...f, tipo: 'documentacao' } : f;
  } catch { return FILTROS_FILA; }
}

const ROTULO_ATALHO: Record<Atalho, string> = {
  abertas: 'Todas em aberto', novas: 'Novas', minhas: 'Minhas em atendimento',
  aguardando: 'Aguardando informação', cliente: 'Aguardando cliente', concluidas: 'Concluídas',
};

export function ApoioOperacional() {
  const { api, estado: app, pode } = useApp();
  const { estado, aplicar, sincronizar } = useDoc();
  const nav = useNavigate();
  const avisar = useAviso();
  const agora = useAgora(15000);
  const [f, setF] = useState<FiltrosFila>(lerFiltros);
  const [assumindo, setAssumindo] = useState<string | null>(null);
  const eu = app.sessao?.perfil.id ?? '';
  const todas = useMemo(() => Object.values(estado.solicitacoes), [estado.solicitacoes]);
  const lista = useMemo(() => filtrarFila(todas, f, eu), [todas, f, eu]);

  useEffect(() => { try { sessionStorage.setItem(CHAVE_FILTROS, JSON.stringify(f)); } catch { /* só nesta tela */ } }, [f]);
  // Volta do atendimento na mesma posição da lista.
  useLayoutEffect(() => {
    const el = document.querySelector('.conteudo');
    if (el && rolagemFila) el.scrollTop = rolagemFila;
    return () => { if (el) rolagemFila = el.scrollTop; };
  }, []);

  // Sinal de demandas novas desde que a tela abriu (sem mexer nos filtros nem no foco).
  const vistas = useRef<Set<string> | null>(null);
  if (vistas.current === null && estado.carregado) vistas.current = new Set(todas.filter((s) => s.status === 'enviado').map((s) => s.id));
  const novas = vistas.current ? todas.filter((s) => s.status === 'enviado' && !vistas.current!.has(s.id)) : [];
  const novasOcultas = novas.filter((s) => !lista.includes(s)).length;
  const reconhecer = () => { for (const s of novas) vistas.current?.add(s.id); setF((x) => ({ ...x })); };

  const opcoes = useMemo(() => {
    const resp = new Map<string, string>();
    for (const s of todas) {
      if (s.responsavel_id) resp.set(s.responsavel_id, s.responsavel_nome ?? '—');
    }
    const ord = (m: Map<string, string>) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    return { resp: ord(resp) };
  }, [todas]);

  // Os números dos atalhos seguem os filtros escolhidos (tipo, responsável e busca).
  const filtradas = useMemo(() => filtrarSemAtalho(todas, f), [todas, f.tipo, f.responsavel, f.busca]); // eslint-disable-line react-hooks/exhaustive-deps
  const contagem = (a: Atalho) => filtradas.filter((s) => noAtalho(s, a, eu)).length;

  if (!pode('apoio.pagina')) return <Layout titulo="Apoio Operacional"><AcessoNegado /></Layout>;

  const assumir = async (s: SolicitacaoDoc) => {
    setAssumindo(s.id);
    try {
      const r = await api.doc.assumir(s.id);
      aplicar(r);
      if (r.status === 'ok') nav(`/apoio/${s.id}`);
      else if (r.status === 'ja_assumida') { avisar('info', `${r.registro.responsavel_nome} assumiu esta demanda antes. A fila foi atualizada.`); void sincronizar(); }
      else { avisar('info', 'Esta demanda não está mais disponível para assumir.'); void sincronizar(); }
    } catch (e) {
      avisar('erro', `Não foi possível assumir: ${mensagemErro(e)}`);
    } finally { setAssumindo(null); }
  };

  const desatualizada = estado.falhaSync || app.conexao === 'offline';
  return (
    <Layout titulo="Apoio Operacional">
      <div className="ao">
        <div className="ao-sync" aria-live="polite">
          {desatualizada ? <span className="ao-sync-falha">Sem conexão com o servidor: a fila pode estar desatualizada.</span>
            : estado.ultimaSync ? <span>Sincronizado às {fmtHora(new Date(estado.ultimaSync).toISOString())}{estado.tempoReal ? ' · tempo real ativo' : ' · atualização a cada 15 s'}</span>
            : <span>Conectando…</span>}
          {novas.length > 0 && (
            <button className="ao-novas" onClick={reconhecer}>
              {novas.length} nova(s) demanda(s){novasOcultas ? ` (${novasOcultas} fora dos filtros atuais)` : ''} · ok
            </button>
          )}
        </div>

        <div className="ao-filtros">
          <select className="entrada ao-atalho" value={f.atalho} onChange={(e) => setF({ ...f, atalho: e.target.value as Atalho })} aria-label="Atalhos da fila">
            {(Object.keys(ROTULO_ATALHO) as Atalho[]).map((a) => <option key={a} value={a}>{ROTULO_ATALHO[a]} ({contagem(a)})</option>)}
          </select>
          <input className="entrada" type="search" value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })}
            placeholder="Buscar placa, lote, cliente, NF, CT-e ou nº" aria-label="Buscar na fila" />
          <select className="entrada" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoFila | '' })} aria-label="Tipo de solicitação">
            <option value="">Todos os tipos</option>
            {(Object.keys(TIPO_FILA) as TipoFila[]).map((t) => <option key={t} value={t}>{TIPO_FILA[t]}</option>)}
          </select>
          <select className="entrada" value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })} aria-label="Responsável">
            <option value="">Todos os responsáveis</option><option value="-">Sem responsável</option>
            {opcoes.resp.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>

        {!estado.carregado && !estado.erro ? <Carregando texto="Carregando a fila…" /> : estado.erro && !estado.carregado ? (
          <Alerta tipo="erro">{estado.erro}</Alerta>
        ) : !lista.length ? (
          <div className="cartao"><EstadoVazio titulo="Nenhuma demanda aqui"><p>{todas.length ? 'Nada com estes filtros ou atalho.' : 'Quando o comercial enviar uma solicitação, ela aparece aqui sozinha.'}</p></EstadoVazio></div>
        ) : (
          <div className="cartao ao-tabela-wrap">
            <table className="ao-tabela">
              <thead><tr>
                <th>Solicitação</th><th>Cliente e lote</th><th>Placa e rota</th><th>Comercial</th><th>Tempo</th><th>Status</th><th>Responsável</th><th>Pendência</th><th><span className="sr">Ação</span></th>
              </tr></thead>
              <tbody>
                {lista.map((s) => {
                  const t = tempoDoc(s, agora);
                  const meu = s.responsavel_id === eu;
                  const nova = novas.includes(s);
                  return (
                    <tr key={s.id} className={nova ? 'ao-nova' : ''}>
                      <td data-rot="Solicitação"><TipoNumero s={s} /></td>
                      <td data-rot="Cliente e lote"><span className="ao-l1">{s.retrato.cliente}</span><span className="ao-l2">{s.tipo === 'estadia' ? documentosEstadia(s) : s.tipo === 'cadastro' ? 'Cadastro no ERP' : s.retrato.lote_numero ? `Lote ${s.retrato.lote_numero}` : 'Lote a gerar'}</span></td>
                      <td data-rot="Placa e rota"><span className="ao-l1">{fmtPlaca(s.placa)}</span><span className="ao-l2">{s.tipo === 'estadia' ? periodoEstadia(s) : rotaDoc(s)}</span></td>
                      <td data-rot="Comercial">{s.solicitante_nome}</td>
                      <td data-rot="Tempo"><span className="ao-l2">{t.rotulo}</span><span className="ao-l1">{t.texto}</span></td>
                      <td data-rot="Status"><StatusDocPill status={s.status} /></td>
                      <td data-rot="Responsável">{s.responsavel_nome ?? <span className="suave">—</span>}</td>
                      <td data-rot="Pendência">{s.status === 'aguardando_informacao' ? <span className="ao-pend">Resposta de {s.solicitante_nome}</span>
                        : s.status === 'correcao_recebida' ? <span className="ao-pend">Correção recebida: retomar</span>
                        : s.status === 'aguardando_cliente' || s.status === 'pago_pendencia' ? <span className="ao-pend cliente">Retorno do cliente</span> : <span className="suave">—</span>}</td>
                      <td className="ao-acao">
                        {!s.responsavel_id && s.status === 'enviado' && pode('apoio.atender') ? (
                          <button className="btn primario peq" disabled={!!assumindo} onClick={() => void assumir(s)}>{assumindo === s.id ? 'Assumindo…' : 'Assumir'}</button>
                        ) : meu && s.status === 'correcao_recebida' ? (
                          <button className="btn primario peq" onClick={() => nav(`/apoio/${s.id}`)}>Retomar atendimento</button>
                        ) : meu && ['em_atendimento', 'aguardando_informacao', 'aguardando_cliente', 'pago_pendencia'].includes(s.status) ? (
                          <button className="btn secundario peq" onClick={() => nav(`/apoio/${s.id}`)}>Continuar atendimento</button>
                        ) : (
                          <button className="btn peq" onClick={() => nav(`/apoio/${s.id}`)}>Consultar</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
