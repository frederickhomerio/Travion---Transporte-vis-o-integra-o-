// Minhas Solicitações (Dashboard Embarques) e botão Baixar documentos (Lista de Fretes): emissões e cadastros enviados
// pelo usuário logado. Os documentos emitidos só aparecem depois que o apoio libera a documentação.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDoc } from '../../data/documentacao';
import { useApp } from '../../data/store';
import { ABERTOS, CATEGORIA, CATEGORIAS_SAIDA, TIPO_DOC, docsParaBaixar, fmtPlaca, minhasSolicitacoes, rotaDoc, tempoDoc } from '../../lib/documentacao';
import { mensagemErro } from '../../data/api';
import type { SolicitacaoDoc } from '../../types';
import { Icone } from '../ui';
import { JanelaAnexos, StatusDocPill, TipoNumero, useAgora, useArquivo } from './Comum';

type Recorte = 'todas' | 'abertas' | 'disponiveis';
const ROTULO_RECORTE: Record<Recorte, string> = { todas: 'Todas', abertas: 'Em aberto', disponiveis: 'Documentação disponível' };
const LIMITE = 10;

const clienteLote = (s: SolicitacaoDoc) => (s.tipo === 'cadastro' ? 'Cadastro no ERP' : s.retrato.lote_numero ? `Lote ${s.retrato.lote_numero}` : 'Lote a gerar');

function useMinhas() {
  const { estado: app } = useApp();
  const { estado } = useDoc();
  const eu = app.sessao?.perfil.id ?? '';
  const lista = useMemo(() => minhasSolicitacoes(Object.values(estado.solicitacoes), eu), [estado.solicitacoes, eu]);
  return { lista, carregado: estado.carregado, ativo: estado.ativo };
}

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

/** Quadro do Dashboard Embarques: fila das minhas solicitações de emissão e cadastro. */
export function MinhasSolicitacoes() {
  const { lista, carregado, ativo } = useMinhas();
  const agora = useAgora(15000);
  const [recorte, setRecorte] = useState<Recorte>('todas');
  const [todas, setTodas] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  if (!ativo) return null;
  const filtradas = lista.filter((s) => recorte === 'todas' || (recorte === 'abertas' ? ABERTOS.includes(s.status) : docsParaBaixar(s)));
  const vis = todas ? filtradas : filtradas.slice(0, LIMITE);
  const contar = (r: Recorte) => lista.filter((s) => r === 'todas' || (r === 'abertas' ? ABERTOS.includes(s.status) : docsParaBaixar(s))).length;
  return (
    <section className="cartao dash-sec ms" aria-label="Minhas Solicitações">
      <div className="dash-sec-topo">
        <h3>Minhas Solicitações</h3>
        <select className="entrada ms-recorte" value={recorte} onChange={(e) => { setRecorte(e.target.value as Recorte); setTodas(false); }} aria-label="Quais solicitações">
          {(Object.keys(ROTULO_RECORTE) as Recorte[]).map((r) => <option key={r} value={r}>{ROTULO_RECORTE[r]} ({contar(r)})</option>)}
        </select>
      </div>
      {!carregado ? <p className="suave">Carregando…</p> : !filtradas.length ? (
        <p className="suave">{lista.length ? 'Nenhuma solicitação neste recorte.' : 'As emissões e os cadastros que você enviar aparecem aqui.'}</p>
      ) : (
        <div className="ao-tabela-wrap">
          <table className="ao-tabela ms-tabela">
            <thead><tr><th>Solicitação</th><th>Cliente e lote</th><th>Placa e rota</th><th>Tempo</th><th>Status</th><th><span className="sr">Documentos</span></th></tr></thead>
            <tbody>
              {vis.map((s) => {
                const t = tempoDoc(s, agora);
                const exp = aberta === s.id;
                return [
                  <tr key={s.id} className={exp ? 'ms-aberta' : ''}>
                    <td data-rot="Solicitação"><TipoNumero s={s} /></td>
                    <td data-rot="Cliente e lote"><span className="ao-l1">{s.retrato.cliente}</span><span className="ao-l2">{clienteLote(s)}</span></td>
                    <td data-rot="Placa e rota"><span className="ao-l1">{fmtPlaca(s.placa)}</span><span className="ao-l2">{s.tipo === 'cadastro' ? 'Cadastro de motorista e veículo' : rotaDoc(s)}</span></td>
                    <td data-rot="Tempo"><span className="ao-l2">{t.rotulo}</span><span className="ao-l1">{t.texto}</span></td>
                    <td data-rot="Status"><StatusDocPill status={s.status} /></td>
                    <td className="ao-acao">
                      {docsParaBaixar(s) && (
                        <button className={`btn peq ${exp ? 'secundario' : 'primario'}`} aria-expanded={exp} onClick={() => setAberta(exp ? null : s.id)}>
                          <Icone nome="baixar" tam={16} />{exp ? 'Fechar' : 'Baixar documentos'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  exp && <tr key={`${s.id}-docs`} className="ms-linha-docs"><td colSpan={6}><DocsEmitidos s={s} /></td></tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtradas.length > LIMITE && <button className="btn" style={{ marginTop: 12 }} onClick={() => setTodas((x) => !x)}>{todas ? 'Mostrar menos' : `Mostrar todas (${filtradas.length})`}</button>}
    </section>
  );
}

/** Botão ao lado das notificações (Lista de Fretes): abre as emissões liberadas por Cliente e lote / Placa e rota. */
export function BotaoBaixarDocs() {
  const { lista, ativo } = useMinhas();
  const [aberto, setAberto] = useState(false);
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
  if (!ativo) return null;
  const prontas = lista.filter(docsParaBaixar);
  return (
    <div className="sino ms-baixar" ref={caixa}>
      <button className="btn ms-baixar-btn" aria-label="Baixar documentos" title="Baixar documentos" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <Icone nome="baixar" tam={18} /><span className="ms-txt">Baixar documentos</span>{prontas.length > 0 && <span className="ms-cont">{prontas.length}</span>}
      </button>
      {aberto && (
        <div className="sino-painel ms-painel" role="dialog" aria-label="Baixar documentos">
          <div className="sino-cab"><strong>Documentação disponível</strong><span className="suave pequeno">Suas emissões liberadas</span></div>
          {!prontas.length ? <p className="suave sino-vazio">Nenhuma emissão com documentação disponível.</p> : (
            <ul>
              {prontas.map((s) => (
                <li key={s.id} className={sel === s.id ? 'ms-sel' : ''}>
                  <button className="sino-item ms-item" aria-expanded={sel === s.id} onClick={() => setSel(sel === s.id ? null : s.id)}>
                    <span className="ms-item-col"><strong>{s.retrato.cliente}</strong><span className="suave pequeno">{clienteLote(s)}</span></span>
                    <span className="ms-item-col"><strong>{fmtPlaca(s.placa)}</strong><span className="suave pequeno">{rotaDoc(s)}</span></span>
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
