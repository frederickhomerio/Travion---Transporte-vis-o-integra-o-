// Minhas solicitações (Dashboard Embarques) e botão Baixar documentos (Lista de Fretes). O quadro é uma fila única de
// acompanhamento (Cadastro, Emissão e Lote e Emissão) das solicitações que o servidor deixa a pessoa ver (escopo), com
// cronômetro do atendimento. Os documentos emitidos só aparecem depois que o apoio libera a documentação.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDoc } from '../../data/documentacao';
import { useApp, useIndices } from '../../data/store';
import { nome } from '../../lib/cadastros';
import {
  CATEGORIA, CATEGORIAS_SAIDA, TIPO_DOC, type TempoAtendimento, docsDoEscopo, docsParaBaixar, filialDaSolicitacao, filtrarAcompanhamento, fmtHMS, fmtPlaca,
  rotaDoc, solicitacoesAcompanhamento, tempoAtendimento,
} from '../../lib/documentacao';
import { mensagemErro } from '../../data/api';
import type { SolicitacaoDoc } from '../../types';
import { Icone, Modal } from '../ui';
import { JanelaAnexos, StatusDocPill, useAgora, useArquivo } from './Comum';

const LIMITE = 15;

const clienteLote = (s: SolicitacaoDoc) => (s.tipo === 'cadastro' ? 'Cadastro no ERP' : s.retrato.lote_numero ? `Lote ${s.retrato.lote_numero}` : 'Lote a gerar');

/** Documentos emitidos de uma emissão liberada: Ver, Baixar e Baixar todos. */
function DocsEmitidos({ s }: { s: SolicitacaoDoc }) {
  const { estado, carregarDetalhe } = useDoc();
  const arquivo = useArquivo();
  const [erro, setErro] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const d = estado.detalhes[s.id];
  const atual = d && d.versao === s.versao;
  useEffect(() => {
    if (!atual) carregarDetalhe(s.id).then(() => setErro(null), (e) => setErro(mensagemErro(e)));
  }, [s.id, atual, carregarDetalhe]);
  const emitidos = (d?.anexos ?? []).filter((a) => a.solicitacao_id === s.id && CATEGORIAS_SAIDA.includes(a.categoria));
  if (erro && !d) return <p className="ms-docs-msg">Não foi possível carregar os documentos: {erro}</p>;
  if (!d) return <p className="ms-docs-msg">Carregando os documentos…</p>;
  if (!emitidos.length) return <p className="ms-docs-msg">Nenhum documento emitido anexado.</p>;
  const todos = async () => { for (const a of emitidos) await arquivo(a, 'baixar'); };
  return (
    <div className="ms-docs">
      <ul>
        {emitidos.map((a) => (
          <li key={a.id}>
            <span><span className="badge info">{CATEGORIA[a.categoria]}</span> {a.nome}</span>
            <span className="grupo-btn"><button className="btn peq" onClick={() => setVer(a.id)}>Ver</button><button className="btn peq" onClick={() => void arquivo(a, 'baixar')}>Baixar</button></span>
          </li>
        ))}
      </ul>
      {emitidos.length > 1 && <button className="btn primario peq" onClick={() => void todos()}><Icone nome="baixar" tam={16} />Baixar todos ({emitidos.length})</button>}
      {ver && <JanelaAnexos titulo={`${TIPO_DOC[s.tipo]} nº ${s.numero}`} anexos={emitidos} inicial={ver} aoFechar={() => setVer(null)} />}
    </div>
  );
}

/** Relógio que corre a cada segundo, alinhado ao horário do servidor (os tempos vêm de horários gravados pelo servidor;
 *  recarregar, navegar ou fechar o navegador não zera nada). */
function useRelogioServidor() {
  const { api } = useApp();
  const [desvio, setDesvio] = useState(0);
  const agora = useAgora(1000);
  useEffect(() => {
    let vivo = true;
    const pedido = Date.now();
    api.agoraServidor().then((iso) => { if (vivo) setDesvio(Date.parse(iso) - (pedido + Date.now()) / 2); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [api]);
  return agora + desvio;
}

function TempoCelula({ t, compacto = true }: { t: TempoAtendimento; compacto?: boolean }) {
  if (t.tipo === 'aguardando') return <span className="ms-tempo aguardando">{compacto ? 'Aguardando início' : 'Aguardando início do atendimento'}</span>;
  if (t.tipo === 'indisponivel') return <span className="ms-tempo suave">Tempo indisponível</span>;
  if (t.tipo === 'cancelada') return <span className="ms-tempo suave">—</span>;
  return (
    <span className={`ms-tempo ${t.tipo}`} title={t.tipo === 'correndo' ? 'Em atendimento: conta desde que o apoio assumiu' : 'Tempo total, do Assumir até a finalização'}>
      <span className="mono">{fmtHMS(t.ms)}</span>{t.tipo === 'finalizado' && <span className="ms-tempo-fim"> total</span>}
    </span>
  );
}

/** Acompanhar: só o status atual e o tempo de atendimento. */
function Acompanhar({ s, agora, aoFechar }: { s: SolicitacaoDoc; agora: number; aoFechar: () => void }) {
  const t = tempoAtendimento(s, agora);
  return (
    <Modal titulo={`${TIPO_DOC[s.tipo]} nº ${s.numero}`} aoFechar={aoFechar} rodape={<button className="btn primario" onClick={aoFechar}>Fechar</button>}>
      <div className="ms-acomp">
        <div><span className="ms-acomp-rot">Status atual</span><StatusDocPill status={s.status} /></div>
        <div><span className="ms-acomp-rot">Tempo de atendimento</span>
          <span className="ms-acomp-tempo"><TempoCelula t={t} compacto={false} /></span>
          <span className="pequeno suave">{t.tipo === 'correndo' ? 'Contando desde que o apoio assumiu.' : t.tipo === 'finalizado' ? 'Do Assumir até a finalização.' : ''}</span>
        </div>
      </div>
    </Modal>
  );
}

/** Quadro do Dashboard Embarques: fila única de acompanhamento (Cadastro, Emissão e Lote e Emissão) das solicitações
 *  visíveis no escopo, com três filtros: placa, filial e responsável pelo envio. Não assume nada (isso é no Apoio). */
export function MinhasSolicitacoes() {
  const { estado: app } = useApp();
  const { estado } = useDoc();
  const idx = useIndices();
  const eu = app.sessao?.perfil.id ?? '';
  const lista = useMemo(() => solicitacoesAcompanhamento(Object.values(estado.solicitacoes)), [estado.solicitacoes]);
  const agora = useRelogioServidor();
  const [placa, setPlaca] = useState('');
  const [filialId, setFilialId] = useState('');
  // Começa nas solicitações da própria pessoa (quando ela tem alguma); "Todos" mostra as demais do escopo autorizado.
  const [enviadoPor, setEnviadoPor] = useState<string | null>(null);
  const porPadrao = lista.some((s) => s.solicitante_id === eu) ? eu : '';
  const quem = enviadoPor ?? porPadrao;
  const [todas, setTodas] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [acompanhar, setAcompanhar] = useState<string | null>(null);
  const filiais = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of lista) { const id = filialDaSolicitacao(s); if (id && !m.has(id)) m.set(id, s.retrato?.filial ?? nome(idx.filial, id)); }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [lista, idx]);
  const remetentes = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of lista) if (!m.has(s.solicitante_id)) m.set(s.solicitante_id, s.solicitante_nome);
    if (eu && !m.has(eu)) m.set(eu, app.sessao?.perfil.nome || 'Eu');
    return [...m.entries()].sort((a, b) => (a[0] === eu ? -1 : b[0] === eu ? 1 : a[1].localeCompare(b[1], 'pt-BR')));
  }, [lista, eu, app.sessao]);
  if (!estado.ativo) return null;
  const filtradas = filtrarAcompanhamento(lista, { placa, filialId, enviadoPor: quem });
  const vis = todas ? filtradas : filtradas.slice(0, LIMITE);
  const sAcomp = acompanhar ? estado.solicitacoes[acompanhar] : null;
  const filtrando = !!(placa || filialId || quem);
  return (
    <section className="cartao dash-sec ms" aria-label="Minhas solicitações">
      <div className="dash-sec-topo">
        <h3>Minhas solicitações</h3>
        <span className="suave pequeno">Cadastro, Emissão e Lote e Emissão · {filtradas.length} de {lista.length}</span>
      </div>
      <div className="ms-filtros">
        <label className="campo"><span>Placa</span>
          <input className="entrada" type="search" value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder="Ex.: EFU-2G04" aria-label="Filtrar por placa" />
        </label>
        <label className="campo"><span>Filial</span>
          <select className="entrada" value={filialId} onChange={(e) => setFilialId(e.target.value)}>
            <option value="">Todas as filiais</option>
            {filiais.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        <label className="campo"><span>Responsável pelo envio</span>
          <select className="entrada" value={quem} onChange={(e) => setEnviadoPor(e.target.value)}>
            <option value="">Todos do meu escopo</option>
            {remetentes.map(([id, n]) => <option key={id} value={id}>{id === eu ? `${n} (eu)` : n}</option>)}
          </select>
        </label>
      </div>
      {!estado.carregado ? <p className="suave">Carregando…</p> : !filtradas.length ? (
        <p className="suave">{lista.length && filtrando ? 'Nenhuma solicitação com estes filtros.' : 'As emissões e os cadastros enviados aparecem aqui.'}</p>
      ) : (
        <div className="ms-tabela-wrap">
          <table className="ms-acomp-tabela">
            <thead><tr><th>Solicitação</th><th>Placa</th><th>Filial</th><th>Enviado por</th><th>Tempo de atendimento</th><th>Status</th><th>Apoio responsável</th><th><span className="sr">Ação</span></th></tr></thead>
            <tbody>
              {vis.map((s) => {
                const exp = aberta === s.id;
                const fil = filialDaSolicitacao(s);
                return [
                  <tr key={s.id} className={exp ? 'ms-aberta' : ''}>
                    <td><span className="ms-tipo">{TIPO_DOC[s.tipo]}</span><span className="ms-num"> · nº {s.numero}</span></td>
                    <td className="mono">{fmtPlaca(s.placa)}</td>
                    <td>{s.retrato?.filial ?? (fil ? nome(idx.filial, fil) : '—')}</td>
                    <td>{s.solicitante_nome}</td>
                    <td><TempoCelula t={tempoAtendimento(s, agora)} /></td>
                    <td><StatusDocPill status={s.status} /></td>
                    <td>{s.responsavel_nome ?? <span className="suave">Ainda não assumido</span>}</td>
                    <td className="ms-acoes">
                      <button className="btn peq" onClick={() => setAcompanhar(s.id)}>Acompanhar</button>
                      {docsParaBaixar(s) && (
                        <button className={`btn peq ${exp ? 'secundario' : 'primario'}`} aria-expanded={exp} onClick={() => setAberta(exp ? null : s.id)}>
                          <Icone nome="baixar" tam={16} />{exp ? 'Fechar' : 'Documentos'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  exp && <tr key={`${s.id}-docs`} className="ms-linha-docs"><td colSpan={8}><DocsEmitidos s={s} /></td></tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtradas.length > LIMITE && <button className="btn" style={{ marginTop: 12 }} onClick={() => setTodas((x) => !x)}>{todas ? 'Mostrar menos' : `Mostrar todas (${filtradas.length})`}</button>}
      {sAcomp && <Acompanhar s={sAcomp} agora={agora} aoFechar={() => setAcompanhar(null)} />}
    </section>
  );
}

/** Botão ao lado das notificações (Lista de Fretes): emissões liberadas de todo o centro de custo do usuário,
 *  por Cliente e lote / Placa e rota. */
export function BotaoBaixarDocs() {
  const { estado } = useDoc();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    // A janela de visualização de anexo fica fora da caixa: clique nela não fecha o painel.
    const fora = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!caixa.current?.contains(el) && !el.closest('.fundo-modal')) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.fundo-modal')) setAberto(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberto]);
  const todas = useMemo(() => docsDoEscopo(Object.values(estado.solicitacoes)), [estado.solicitacoes]);
  if (!estado.ativo) return null;
  const prontas = busca ? docsDoEscopo(todas, busca) : todas;
  return (
    <div className="sino ms-baixar" ref={caixa}>
      <button className="btn ms-baixar-btn" aria-label="Baixar documentos" title="Baixar documentos" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <Icone nome="baixar" tam={18} /><span className="ms-txt">Baixar documentos</span>{todas.length > 0 && <span className="ms-cont">{todas.length > 99 ? '99+' : todas.length}</span>}
      </button>
      {aberto && (
        <div className="sino-painel ms-painel" role="dialog" aria-label="Baixar documentos">
          <div className="sino-cab"><strong>Documentação disponível</strong><span className="suave pequeno">Emissões liberadas do seu centro de custo</span></div>
          {todas.length > 5 && <div className="ms-busca"><input className="entrada" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, lote, placa ou quem enviou" aria-label="Buscar documentação" autoFocus /></div>}
          {!prontas.length ? <p className="suave sino-vazio">{todas.length ? 'Nada encontrado com esta busca.' : 'Nenhuma emissão com documentação disponível.'}</p> : (
            <ul>
              {prontas.map((s) => (
                <li key={s.id} className={sel === s.id ? 'ms-sel' : ''}>
                  <button className="sino-item ms-item" aria-expanded={sel === s.id} onClick={() => setSel(sel === s.id ? null : s.id)}>
                    <span className="ms-item-col"><strong>{s.retrato.cliente}</strong><span className="suave pequeno">{clienteLote(s)}</span></span>
                    <span className="ms-item-col"><strong>{fmtPlaca(s.placa)}</strong><span className="suave pequeno">{rotaDoc(s)}</span></span>
                    <span className="ms-item-por suave pequeno">{TIPO_DOC[s.tipo]} nº {s.numero} · enviada por {s.solicitante_nome}</span>
                  </button>
                  {sel === s.id && <DocsEmitidos s={s} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
