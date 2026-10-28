import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarraFiltros } from '../components/Filtros';
import { Layout } from '../components/Layout';
import { AbrirPosicoes } from '../components/AbrirPosicoes';
import { ImagemAnuncio, ModalDivulgacao } from '../components/AnuncioFrete';
import { DetalhesEmbarque } from '../components/DetalhesEmbarque';
import { BotaoDocumentacao, SolicitarDocumentacao } from '../components/doc/DocumentacaoEmbarque';
import { NovoEmbarque } from '../components/NovoEmbarque';
import { ConfirmarEncerramento, ConfirmarSuspensao, EmbarquesSuspensos } from '../components/SuspenderEncerrar';
import { Alerta, Carregando, EstadoVazio, Icone, Modal, Segmentado, useAviso } from '../components/ui';
import { useApp, useIndices, useLinhas } from '../data/store';
import { type DadosAnuncio, cidadeAnuncio, semDemo, valorFrete, UNIDADE_ANUNCIO } from '../lib/anuncio';
import { type Indices, codigoEmbarque, nome } from '../lib/cadastros';
import { aplicarFiltros } from '../lib/filtros';
import { fmtPct, fmtReais, fmtT, hojeSP } from '../lib/formato';
import { normalizar } from '../lib/texto';
import { type ItemLista, baixarListaPdf, desenharLista, textoLista } from '../lib/listaExport';
import { reativavel } from '../lib/suspensao';
import type { Embarque, Financeiro, LinhaFrete } from '../types';

type Campo = 'origem' | 'destino' | 'filial' | 'produto';
type CampoBusca = 'nenhum' | Campo;
type Agrupar = 'nenhum' | Campo;
const CHAVE_AGRUPAR = 'travion-agrupar-v2';
const AGRUPAMENTOS: Agrupar[] = ['nenhum', 'origem', 'destino', 'filial', 'produto'];

export function ListaFretes() {
  const { estado, pode } = useApp();
  const [params, setParams] = useSearchParams();
  const idx = useIndices();
  const todas = useLinhas();
  const { definirData } = useApp();
  // A lista é sempre a do dia (sem escolher data operacional).
  useEffect(() => { const h = hojeSP(); if (estado.data !== h) definirData(h); }, [estado.data, definirData]);
  const [buscarPor, setBuscarPor] = useState<CampoBusca>('nenhum');
  const [texto, setTexto] = useState('');
  // Vitrine para a equipe de campo: só fretes liberados e ativos.
  const liberados = useMemo(() => aplicarFiltros(todas, { ...estado.filtros, busca: '' }, idx)
    .filter((l) => l.embarque.status_liberacao === 'liberado' && l.embarque.situacao === 'ativo'), [todas, estado.filtros, idx]);
  const linhas = useMemo(() => {
    const t = normalizar(texto);
    return t && buscarPor !== 'nenhum' ? liberados.filter((l) => normalizar(chaveGrupo(l, buscarPor, idx)) === t) : liberados;
  }, [liberados, texto, buscarPor, idx]);
  const sugestoes = useMemo(() => buscarPor === 'nenhum' ? [] : [...new Set(liberados.map((l) => chaveGrupo(l, buscarPor, idx)))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [liberados, buscarPor, idx]);
  const [agrupar, setAgrupar] = useState<Agrupar>(() => {
    try { const v = localStorage.getItem(CHAVE_AGRUPAR) as Agrupar; return AGRUPAMENTOS.includes(v) ? v : 'nenhum'; } catch { return 'nenhum'; }
  });
  const [gerando, setGerando] = useState(false);
  const [lista, setLista] = useState<ItemLista[] | null>(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  // Notificação de documentação abre Detalhes do embarque → Documentação → Solicitação.
  const [docAberta, setDocAberta] = useState<string | null>(null);
  useEffect(() => {
    const emb = params.get('emb');
    if (!emb) return;
    setDetalhe(emb); setDocAberta(params.get('doc'));
    setParams({}, { replace: true });
  }, [params, setParams]);
  const [abrir, setAbrir] = useState(false);
  const [novo, setNovo] = useState(false);
  const [rapido, setRapido] = useState<string | null>(null);
  const [formDoc, setFormDoc] = useState<string | null>(null);
  const [anuncioNovo, setAnuncioNovo] = useState<string | null>(null);
  const [imagem, setImagem] = useState<DadosAnuncio | null>(null);
  const [suspender, setSuspender] = useState<Embarque | null>(null);
  const [encerrar, setEncerrar] = useState<Embarque | null>(null);
  const [verSuspensos, setVerSuspensos] = useState(false);
  const avisar = useAviso();
  const suspensos = useMemo(() => todas.map((l) => l.embarque).filter(reativavel), [todas]);

  const dadosAnuncio = (l: LinhaFrete): DadosAnuncio => anuncioDe(l, idx, estado.financeiro[l.embarque.id] ?? null);
  const acoesLinha: AcoesLinha = {
    detalhes: (id) => setRapido(id),
    imagem: (l) => setImagem(dadosAnuncio(l)),
    suspender: pode('embarques.liberar') ? (l) => setSuspender(l.embarque) : undefined,
    encerrar: pode('embarques.encerrar') ? (l) => setEncerrar(l.embarque) : undefined,
  };
  const verFrete = pode('financeiro.ver');

  const grupos = useMemo(() => {
    if (agrupar === 'nenhum') return [{ chave: '', titulo: '', linhas }];
    const m = new Map<string, LinhaFrete[]>();
    for (const l of linhas) {
      const k = chaveGrupo(l, agrupar, idx);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return [...m.entries()]
      .map(([k, ls]) => ({ chave: k, titulo: k, linhas: ls }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  }, [linhas, agrupar, idx]);

  const mudarAgrupar = (a: Agrupar) => { setAgrupar(a); try { localStorage.setItem(CHAVE_AGRUPAR, a); } catch { /* preferência local */ } };

  // Lista para divulgar, na mesma ordem e agrupamento da tela.
  const itensLista = (): ItemLista[] => grupos.flatMap((g) => g.linhas.map((l) => {
    const d = anuncioDe(l, idx, estado.financeiro[l.embarque.id] ?? null);
    const v = valorFrete(d.frete);
    return { grupo: g.titulo, cliente: nome(idx.cliente, l.embarque.cliente_id), origem_cidade: d.origem_cidade, origem_uf: d.origem_uf, coleta: d.coleta,
      destino_cidade: d.destino_cidade, destino_uf: d.destino_uf, entrega: d.entrega, produto: d.produto, frete: v, anuncio: d };
  }));
  const gerarPdf = async () => {
    setGerando(true);
    try { await baixarListaPdf(itensLista(), estado.data, verFrete); }
    catch (e) { avisar('erro', (e as Error).message); } finally { setGerando(false); }
  };
  const desenharListaAtual = useCallback((c: HTMLCanvasElement) => desenharLista(c, lista ?? [], estado.data, verFrete), [lista, estado.data, verFrete]);
  const botoesExportar = (
    <>
      <button className="btn" disabled={!linhas.length} onClick={() => setLista(itensLista())}><Icone nome="baixar" tam={18} />Lista de fretes</button>
      <button className="btn" disabled={!linhas.length || gerando} onClick={gerarPdf}><Icone nome="baixar" tam={18} />{gerando ? 'Gerando…' : 'Exportar PDF'}</button>
      <button className="btn" disabled={!linhas.length} onClick={() => exportarCSV(linhas, idx, estado.data)}><Icone nome="baixar" tam={18} />CSV</button>
    </>
  );

  const acoes = (
    <div className="grupo-btn esconder-celular">
      {pode('embarques.liberar') && <BotaoSuspensos n={suspensos.length} aoClicar={() => setVerSuspensos(true)} />}
      {pode('posicoes.abrir') && <button className="btn" onClick={() => setAbrir(true)}>Abrir posições</button>}
      {pode('embarques.criar') && <button className="btn primario" onClick={() => setNovo(true)}><Icone nome="mais" tam={18} />Novo embarque</button>}
    </div>
  );

  return (
    <Layout titulo="Lista de Fretes" acoes={acoes}>
      <div className="controles-lista">
        <div className="controle-linha">
          <span className="controle-rot">Buscar por</span>
          <div className="controle-corpo">
            <Segmentado rotulo="Buscar por" valor={buscarPor} aoMudar={(v) => { setBuscarPor(v); setTexto(''); }}
              opcoes={[{ valor: 'nenhum', rotulo: 'Nenhum' }, { valor: 'origem', rotulo: 'Cidade origem' }, { valor: 'destino', rotulo: 'Cidade destino' },
                { valor: 'filial', rotulo: 'Filial' }, { valor: 'produto', rotulo: 'Produto' }]} />
            {buscarPor !== 'nenhum' && <select className="entrada controle-valor" aria-label="Valor da busca" value={texto} onChange={(e) => setTexto(e.target.value)}>
              <option value="">{{ nenhum: '', origem: 'Todas as origens', destino: 'Todos os destinos', filial: 'Todas as filiais', produto: 'Todos os produtos' }[buscarPor]}</option>
              {sugestoes.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>}
          </div>
        </div>
        <div className="controle-linha">
          <span className="controle-rot">Agrupar por</span>
          <div className="controle-corpo">
            <Segmentado rotulo="Agrupar por" valor={agrupar} aoMudar={mudarAgrupar}
              opcoes={[{ valor: 'nenhum', rotulo: 'Nenhum' }, { valor: 'origem', rotulo: 'Cidade origem' }, { valor: 'destino', rotulo: 'Cidade destino' },
                { valor: 'filial', rotulo: 'Filial' }, { valor: 'produto', rotulo: 'Produto' }]} />
          </div>
        </div>
        <div className="controle-linha">
          <span className="controle-rot"><strong>{linhas.length}</strong> frete(s)</span>
          <div className="controle-corpo controle-botoes">{botoesExportar}</div>
        </div>
      </div>
      <BarraFiltros linhas={todas} semData semBusca />

      <div className="grupo-btn so-celular" style={{ marginBottom: 12 }}>
        {pode('embarques.liberar') && <BotaoSuspensos n={suspensos.length} aoClicar={() => setVerSuspensos(true)} />}
        {pode('posicoes.abrir') && <button className="btn" onClick={() => setAbrir(true)}>Abrir posições</button>}
        {pode('embarques.criar') && <button className="btn primario" onClick={() => setNovo(true)}><Icone nome="mais" tam={18} />Novo embarque</button>}
      </div>

      {estado.erro && <Alerta tipo="erro"><span><strong>Erro ao carregar:</strong> {estado.erro}</span></Alerta>}


      {estado.carregando && Object.keys(estado.embarques).length === 0 ? <Carregando /> : linhas.length === 0 ? (
        <div className="cartao"><EstadoVazio titulo={todas.length === 0 ? 'Nenhum embarque cadastrado' : 'Nenhum frete liberado'}>
          <p>{todas.length === 0 ? (pode('embarques.criar') ? 'Cadastre um embarque ou importe a planilha em Administração.' : 'Ainda não há embarques no seu escopo.') : 'Nenhum frete liberado com estes filtros. Embarques suspensos ficam no botão Suspensos.'}</p>
        </EstadoVazio></div>
      ) : (
        <>
          <div className="cartao tabela-fretes-wrap">
            <table className="tabela-fretes">
              <thead>
                <tr><th>Origem</th><th>Destino</th><th>Produto</th>{verFrete && <><th className="n-frete">Frete motorista</th><th className="n-frete">Margem</th></>}<th className="td-acao"><span className="sr">Ações</span></th></tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <GrupoTabela key={g.chave} g={g} idx={idx} verFrete={verFrete} acoes={acoesLinha} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="cartoes-fretes">
            {grupos.map((g) => (
              <div key={g.chave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.titulo && <TituloGrupo titulo={g.titulo} linhas={g.linhas} />}
                {g.linhas.map((l) => <CartaoFrete key={l.embarque.id} l={l} idx={idx} verFrete={verFrete} acoes={acoesLinha} />)}
              </div>
            ))}
          </div>
        </>
      )}

      {rapido && <DetalhesRapidos embarqueId={rapido} aoFechar={() => setRapido(null)} aoFichaCompleta={() => { setDetalhe(rapido); setRapido(null); }}
        aoSolicitarDoc={() => { setFormDoc(rapido); setRapido(null); }}
        aoAcompanharDoc={(sid) => { setDetalhe(rapido); setDocAberta(sid); setRapido(null); }} />}
      {formDoc && estado.embarques[formDoc] && <SolicitarDocumentacao embarque={estado.embarques[formDoc]} aoFechar={() => setFormDoc(null)}
        aoEnviada={(s) => { setFormDoc(null); setDetalhe(s.embarque_id); setDocAberta(s.id); }} />}
      {imagem && <ImagemAnuncio dados={imagem} aoFechar={() => setImagem(null)} />}
      {lista && (
        <ModalDivulgacao titulo="Divulgação da lista de fretes" desenhar={desenharListaAtual} texto={textoLista(lista, estado.data, verFrete)}
          arquivoNome={`lista-fretes-${estado.data}.jpg`} tipo="image/jpeg" aoFechar={() => setLista(null)} />
      )}
      {suspender && <ConfirmarSuspensao e={suspender} aoFechar={() => setSuspender(null)} />}
      {encerrar && <ConfirmarEncerramento e={encerrar} aoFechar={() => setEncerrar(null)} />}
      {verSuspensos && <EmbarquesSuspensos embarques={suspensos} aoFechar={() => setVerSuspensos(false)} />}
      {detalhe && <DetalhesEmbarque embarqueId={detalhe} solicitacaoDoc={docAberta} aoFechar={() => { setDetalhe(null); setDocAberta(null); }} />}
      {abrir && <AbrirPosicoes aoFechar={() => setAbrir(false)} />}
      {novo && <NovoEmbarque aoFechar={(id) => { setNovo(false); if (id) setAnuncioNovo(id); }} />}
      {anuncioNovo && estado.embarques[anuncioNovo] && (
        <ImagemAnuncio titulo="Anúncio do novo frete" dados={anuncioDe({ embarque: estado.embarques[anuncioNovo] } as LinhaFrete, idx, estado.financeiro[anuncioNovo] ?? null)}
          aoFechar={() => setAnuncioNovo(null)} />
      )}
    </Layout>
  );
}

function chaveGrupo(l: LinhaFrete, agrupar: Agrupar, idx: Indices): string {
  const e = l.embarque;
  if (agrupar === 'origem') return cidadeAnuncio(e.origem_cidade, e.origem_uf).toUpperCase();
  if (agrupar === 'destino') return cidadeAnuncio(e.destino_cidade, e.destino_uf).toUpperCase();
  if (agrupar === 'filial') return semDemo(nome(idx.filial, e.filial_id));
  if (agrupar === 'produto') return semDemo(nome(idx.produto, e.produto_id, 'Produto a informar'));
  return '';
}

function subtituloGrupo(linhas: LinhaFrete[]) {
  return `${linhas.length} frete(s)`;
}

function TituloGrupo({ titulo, linhas }: { titulo: string; linhas: LinhaFrete[] }) {
  return <div className="grupo-titulo"><span>{titulo}</span><span className="pequeno suave" style={{ fontWeight: 500 }}>{subtituloGrupo(linhas)}</span></div>;
}

type AcoesLinha = {
  detalhes: (id: string) => void; imagem: (l: LinhaFrete) => void;
  suspender?: (l: LinhaFrete) => void; encerrar?: (l: LinhaFrete) => void;
};

function BotaoSuspensos({ n, aoClicar }: { n: number; aoClicar: () => void }) {
  return <button className="btn" onClick={aoClicar}>Suspensos{n > 0 && <span className="contador-suspensos">{n}</span>}</button>;
}

function anuncioDe(l: LinhaFrete, idx: Indices, fin: Financeiro | null): DadosAnuncio {
  const e = l.embarque;
  return {
    origem_cidade: e.origem_cidade, origem_uf: e.origem_uf, coleta: e.local_coleta_id ? nome(idx.local, e.local_coleta_id) : null,
    destino_cidade: e.destino_cidade, destino_uf: e.destino_uf, entrega: e.local_entrega_id ? nome(idx.local, e.local_entrega_id) : null,
    produto: e.produto_id ? nome(idx.produto, e.produto_id) : null,
    link_mapa: (e.local_coleta_id && idx.local.get(e.local_coleta_id)?.link_mapa) || null,
    frete: fin ? { frete_motorista: fin.frete_motorista, unidade_frete: fin.unidade_frete } : null,
  };
}

/** Cidade em destaque e o local entre parênteses, como no anúncio ("MONTIVIDIU-GO (FAZ. SEGREDO)"). */
function PontoRota({ cidade, uf, local }: { cidade: string; uf: string | null; local: string | null }) {
  return (
    <div className="ponto-rota">
      <div className="cidade">{cidadeAnuncio(cidade, uf).toUpperCase()}</div>
      <div className="local">{local ? `(${semDemo(local).toUpperCase()})` : '(local a informar)'}</div>
    </div>
  );
}

function FreteMotorista({ fin }: { fin: Financeiro | null | undefined }) {
  const v = valorFrete(fin ?? null);
  if (!v) return <span className="suave pequeno">A combinar</span>;
  const u = fin ? UNIDADE_ANUNCIO[fin.unidade_frete] : '';
  return <span className="frete-valor">{v}{u && <small> {u}</small>}</span>;
}

/** Margem do embarque = frete empresa − frete motorista, em R$ e em % do frete empresa. Nunca vai no anúncio. */
function Margem({ fin }: { fin: Financeiro | null | undefined }) {
  const emp = fin?.frete_empresa;
  const mot = fin?.frete_motorista;
  if (emp == null || mot == null || !(emp > 0)) return <span className="suave pequeno">—</span>;
  const m = emp - mot;
  return (
    <span className={`margem ${m < 0 ? 'negativa' : ''}`} title={`Frete empresa ${fmtReais(emp)} − frete motorista ${fmtReais(mot)}`}>
      {fmtReais(m)}<small> · {fmtPct((m / emp) * 100)}</small>
    </span>
  );
}

function BotoesAnuncio({ l, acoes }: { l: LinhaFrete; acoes: AcoesLinha }) {
  return (
    <div className="grupo-btn botoes-anuncio">
      <button className="btn peq" onClick={() => acoes.detalhes(l.embarque.id)}>Detalhes</button>
      <button className="btn peq primario" onClick={() => acoes.imagem(l)} title="Imagem e texto para divulgar no WhatsApp">Divulgação</button>
      {acoes.suspender && <button className="btn peq suspender" onClick={() => acoes.suspender!(l)} title="Tirar da Lista de Fretes e das Posições de Embarque">Suspender</button>}
      {acoes.encerrar && <button className="btn peq encerrar" onClick={() => acoes.encerrar!(l)} title="Encerrar e arquivar, sem reativação">Encerrar</button>}
    </div>
  );
}

function GrupoTabela({ g, idx, verFrete, acoes }: {
  g: { chave: string; titulo: string; linhas: LinhaFrete[] }; idx: Indices; verFrete: boolean; acoes: AcoesLinha;
}) {
  const { estado } = useApp();
  return (
    <>
      {g.titulo && (
        <tr className="grupo-cab"><td colSpan={verFrete ? 6 : 4}>{g.titulo}<span className="totais">{subtituloGrupo(g.linhas)}</span></td></tr>
      )}
      {g.linhas.map((l) => {
        const e = l.embarque;
        return (
          <tr key={e.id}>
            <td><PontoRota cidade={e.origem_cidade} uf={e.origem_uf} local={e.local_coleta_id ? nome(idx.local, e.local_coleta_id) : null} /></td>
            <td><PontoRota cidade={e.destino_cidade} uf={e.destino_uf} local={e.local_entrega_id ? nome(idx.local, e.local_entrega_id) : null} /></td>
            <td className="td-produto">{semDemo(nome(idx.produto, e.produto_id))}</td>
            {verFrete && <><td className="n-frete"><FreteMotorista fin={estado.financeiro[e.id]} /></td><td className="n-frete"><Margem fin={estado.financeiro[e.id]} /></td></>}
            <td className="td-acao"><BotoesAnuncio l={l} acoes={acoes} /></td>
          </tr>
        );
      })}
    </>
  );
}

function CartaoFrete({ l, idx, verFrete, acoes }: { l: LinhaFrete; idx: Indices; verFrete: boolean; acoes: AcoesLinha }) {
  const { estado } = useApp();
  const e = l.embarque;
  return (
    <article className="cartao cartao-frete">
      <div className="rota-anuncio">
        <div><span className="rot-rota">Origem</span>
          <PontoRota cidade={e.origem_cidade} uf={e.origem_uf} local={e.local_coleta_id ? nome(idx.local, e.local_coleta_id) : null} /></div>
        <span className="seta" aria-hidden="true">➜</span>
        <div><span className="rot-rota">Destino</span>
          <PontoRota cidade={e.destino_cidade} uf={e.destino_uf} local={e.local_entrega_id ? nome(idx.local, e.local_entrega_id) : null} /></div>
      </div>
      <div className="rodape">
        <span className="pequeno suave">{semDemo(nome(idx.produto, e.produto_id, 'Produto a informar'))}</span>
        {verFrete && <span style={{ textAlign: 'right' }}><FreteMotorista fin={estado.financeiro[e.id]} /><br /><span className="pequeno">Margem <Margem fin={estado.financeiro[e.id]} /></span></span>}
      </div>
      <BotoesAnuncio l={l} acoes={acoes} />
    </article>
  );
}

/** Detalhes rápidos para a equipe de campo: veículos na porta, em trânsito e observações. */
function DetalhesRapidos({ embarqueId, aoFechar, aoFichaCompleta, aoSolicitarDoc, aoAcompanharDoc }: {
  embarqueId: string; aoFechar: () => void; aoFichaCompleta: () => void; aoSolicitarDoc: () => void; aoAcompanharDoc: (solicitacaoId: string) => void;
}) {
  const { estado } = useApp();
  const idx = useIndices();
  const e = estado.embarques[embarqueId];
  const p = Object.values(estado.posicoes).find((x) => x.embarque_id === embarqueId && x.data_operacional === estado.data) ?? null;
  if (!e) return null;
  const cap = p?.toneladas_por_veiculo ?? e.toneladas_por_veiculo;
  const box = (rot: string, v: number | null | undefined) => (
    <div className="cont-box"><div className="rot">{rot}</div><div className="num grande">{v ?? '—'}</div><div className="pequeno suave">{v ? fmtT(v * cap) : ''}</div></div>
  );
  const obs = [e.observacao_interna, p?.obs_operacional].filter(Boolean) as string[];
  return (
    <Modal titulo={`${cidadeAnuncio(e.origem_cidade, e.origem_uf)} ➜ ${cidadeAnuncio(e.destino_cidade, e.destino_uf)}`} aoFechar={aoFechar} rodape={
      <><BotaoDocumentacao embarque={e} aoSolicitar={aoSolicitarDoc} aoAcompanhar={aoAcompanharDoc} />
        <button className="btn" onClick={aoFichaCompleta}>Ficha completa</button><button className="btn" onClick={aoFechar}>Fechar</button></>
    }>
      <div className="pequeno suave" style={{ marginBottom: 10 }}>
        {codigoEmbarque(e.codigo)} · {semDemo(nome(idx.produto, e.produto_id, 'Produto a informar'))} · {semDemo(nome(idx.cliente, e.cliente_id))}
      </div>
      {p ? (
        <div className="detalhes-rapidos">{box('Na porta', p.porta)}{box('Em trânsito', p.transito)}{box('Carregados', p.carregados)}</div>
      ) : <Alerta tipo="info">Sem posição aberta nesta data: ainda não há contagem de veículos.</Alerta>}
      <h3 className="pequeno" style={{ margin: '14px 0 4px' }}>Observação do embarque</h3>
      {obs.length ? obs.map((o) => <p key={o} style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{o}</p>) : <p className="suave" style={{ margin: 0 }}>Sem observação.</p>}
    </Modal>
  );
}

function exportarCSV(linhas: LinhaFrete[], idx: Indices, data: string) {
  // Exporta somente o que o usuário já pode ver (dados recebidos do servidor com RLS); sem valores financeiros.
  const cab = ['Código', 'Data', 'Cliente', 'Carteira', 'Filial', 'Produto', 'Origem', 'UF origem', 'Coleta', 'Destino', 'UF destino', 'Entrega',
    'Status', 'Porta', 'Trânsito', 'Carregados', 'Capacidade (t)', 'Volume porta (t)', 'Volume trânsito (t)', 'Volume carregado (t)', 'Projetado (t)', 'Atualizado em'];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
  const corpo = linhas.map((l) => {
    const e = l.embarque;
    const p = l.posicao;
    const cap = p?.toneladas_por_veiculo ?? e.toneladas_por_veiculo;
    return [codigoEmbarque(e.codigo), p ? data : '', nome(idx.cliente, e.cliente_id), nome(idx.comercial, e.comercial_id, ''), nome(idx.filial, e.filial_id),
      nome(idx.produto, e.produto_id, ''), e.origem_cidade, e.origem_uf ?? '', nome(idx.local, e.local_coleta_id, ''), e.destino_cidade, e.destino_uf ?? '',
      nome(idx.local, e.local_entrega_id, ''), e.status_liberacao, p?.porta ?? '', p?.transito ?? '', p?.carregados ?? '', num(cap),
      p ? num((p.porta ?? 0) * cap) : '', p ? num((p.transito ?? 0) * cap) : '', p ? num((p.carregados ?? 0) * cap) : '',
      p ? num(((p.porta ?? 0) + (p.carregados ?? 0)) * cap) : '', p?.atualizado_em ?? ''].map(esc).join(';');
  });
  const blob = new Blob(['﻿' + [cab.join(';'), ...corpo].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lista-fretes-${data}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
