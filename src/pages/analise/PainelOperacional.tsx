// Aba Análise → Painel Operacional: filas do Apoio agora, atendimento por colaborador, mapa de calor das chegadas,
// evolução das demandas e resumo. Visualização normal, quadro expandido e Modo TV (tela do Apoio Operacional).
// Os cálculos ficam em lib/painelOperacional.ts; o servidor aplica permissão e escopo na consulta.

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { GraficoLinha, MapaCalorGrade } from '../../components/analise/Graficos';
import { Layout } from '../../components/Layout';
import { AcessoNegado, Alerta, Carregando, Icone, Segmentado } from '../../components/ui';
import { usePainel } from '../../data/painel';
import { useApp } from '../../data/store';
import { intervaloPeriodo } from '../../lib/dashboard';
import { MOTIVO_DEVOLUCAO, duracao } from '../../lib/documentacao';
import { fmtDataCurta, fmtDataHora, fmtHora, fmtNum, fmtPct, hojeSP } from '../../lib/formato';
import {
  DIAS_CURTOS, DIAS_SEMANA, type FiltrosPainel, type LinhaChamado, OPERACOES, type SituacaoPrazo, TIPOS_DEMANDA, type TipoDemanda, type VisaoEvolucao,
  dataSP, evolucao, filaAtual, grupoHistorico, intervaloMs, linhasDoPainel, mapaCalor, noEscopo, porColaborador, resumo, situacaoPrazo,
} from '../../lib/painelOperacional';
import type { MotivoDevolucao, TipoSolicitacaoDoc } from '../../types';
import { AbasAnalise } from './AbasAnalise';

type IdQuadro = 'filas' | 'equipe' | 'mapa' | 'evolucao' | 'resumo';
const QUADROS: Array<{ id: IdQuadro; rotulo: string }> = [
  { id: 'filas', rotulo: 'Filas por operação' },
  { id: 'equipe', rotulo: 'Atendimento por colaborador' },
  { id: 'mapa', rotulo: 'Mapa de calor' },
  { id: 'evolucao', rotulo: 'Evolução das demandas' },
  { id: 'resumo', rotulo: 'Resumo geral' },
];
type Atalho = 'hoje' | 'semana' | 'mes' | 'personalizado';
const TIPOS_ATIVOS = TIPOS_DEMANDA.filter((t) => t.ativo).map((t) => t.id);
const ROTULO_TIPO = Object.fromEntries(TIPOS_DEMANDA.map((t) => [t.id, t.rotulo])) as Record<TipoDemanda, string>;
type Modo = 'normal' | 'expandido' | 'tv';

interface Preferencias { atalho: Atalho; inicio: string; fim: string; tipos: TipoDemanda[]; filial: string; centro: string; colaborador: string;
  solicitante: string; visaoEvol: VisaoEvolucao; tiposEvol: TipoDemanda[]; tv: IdQuadro[]; passoMapa: 1 | 2; filtrosRecolhidos: boolean }

function periodoDoAtalho(a: Atalho, hoje: string, atual: { inicio: string; fim: string }) {
  if (a === 'hoje') return { inicio: hoje, fim: hoje };
  if (a === 'semana') return intervaloPeriodo(hoje, 'semana');
  if (a === 'mes') return intervaloPeriodo(hoje, 'mes');
  return atual;
}

function lerPreferencias(chave: string, hoje: string): Preferencias {
  const padrao: Preferencias = { atalho: 'mes', ...intervaloPeriodo(hoje, 'mes'), tipos: TIPOS_ATIVOS, filial: '', centro: '', colaborador: '',
    solicitante: '', visaoEvol: 'dia', tiposEvol: TIPOS_ATIVOS, tv: ['filas', 'equipe', 'evolucao'], passoMapa: 2, filtrosRecolhidos: false };
  try {
    const p = JSON.parse(localStorage.getItem(chave) ?? 'null') as Partial<Preferencias> | null;
    if (!p) return padrao;
    const r = { ...padrao, ...p };
    return { ...r, ...periodoDoAtalho(r.atalho, hoje, r), tv: r.tv?.length ? r.tv : padrao.tv };
  } catch { return padrao; }
}

const fmtDur = (ms: number | null) => (ms === null ? '—' : duracao(ms));

export function PainelOperacional() {
  const { pode, estado } = useApp();
  const ok = pode('analise.operacional');
  if (!ok) return <Layout titulo="Análise · Painel Operacional"><AbasAnalise /><AcessoNegado motivo="Seu usuário não tem acesso ao Painel Operacional (Administração → Permissões)." /></Layout>;
  return <Painel perfilId={estado.sessao!.perfil.id} />;
}

function Painel({ perfilId }: { perfilId: string }) {
  const { estado } = useApp();
  const hoje = hojeSP();
  const chavePref = `travion-painel-operacional-${perfilId}`;
  const [pref, setPref] = useState<Preferencias>(() => lerPreferencias(chavePref, hoje));
  useEffect(() => { try { localStorage.setItem(chavePref, JSON.stringify(pref)); } catch { /* preferência local */ } }, [chavePref, pref]);
  const mudar = (p: Partial<Preferencias>) => setPref((x) => ({ ...x, ...p }));
  const [dataEvol, setDataEvol] = useState(hoje);
  const [expandido, setExpandido] = useState<IdQuadro | null>(null);
  const [modo, setModo] = useState<'normal' | 'tv'>('normal');
  const [escolhendoTv, setEscolhendoTv] = useState(false);

  // Janela da consulta: período histórico + período da evolução e o anterior equivalente.
  const hist = intervaloMs(pref.inicio, pref.fim);
  const ev0 = useMemo(() => evolucao([], pref.visaoEvol, dataEvol, 0, null), [pref.visaoEvol, dataEvol]);
  const desde = new Date(Math.min(hist.de, ev0.periodoAnterior.de)).toISOString();
  const ate = new Date(Math.max(hist.ate, ev0.periodo.ate)).toISOString();
  const painel = usePainel(desde, ate, true);

  const [tique, setTique] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setTique(Date.now()), 10000); return () => clearInterval(t); }, []);
  const agora = tique + painel.desvio;

  const dados = painel.dados;
  const linhas = useMemo(() => (dados ? linhasDoPainel(dados, agora) : []), [dados, agora]);
  const escopo = useMemo(() => linhas.filter((l) => noEscopo(l.s, pref)), [linhas, pref]);
  const filtros: FiltrosPainel = pref;
  const grupo = useMemo(() => grupoHistorico(escopo, filtros), [escopo, filtros]);

  const filiais = estado.cadastros.filiais.filter((f) => f.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const centros = estado.cadastros.centros_custo.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const colaboradores = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of linhas) for (const [id, n] of l.assumiram) m.set(id, n);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [linhas]);
  const solicitantes = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of linhas) m.set(l.s.solicitante_id, l.s.solicitante_nome);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [linhas]);

  const nomeFilial = pref.filial ? filiais.find((f) => f.id === pref.filial)?.nome ?? 'Filial' : 'Todas as filiais';
  const nomeCentro = pref.centro ? centros.find((c) => c.id === pref.centro)?.nome ?? 'Centro de custo' : 'todos os centros de custo';
  const txtEscopo = `${nomeFilial} · ${nomeCentro}`;
  const txtPeriodo = pref.inicio === pref.fim ? fmtDataCurta(pref.inicio) : `${fmtDataCurta(pref.inicio)} a ${fmtDataCurta(pref.fim)}`;
  const txtTipos = pref.tipos.length ? pref.tipos.map((t) => ROTULO_TIPO[t]).join(', ') : 'nenhum tipo';

  const inicioRegistro = dados?.inicio_registro ? Date.parse(dados.inicio_registro) : null;
  const semRegistroGrupo = grupo.filter((l) => !l.completo).length;

  const ctx: CtxQuadro = { modo: 'normal', agora, linhas: escopo, grupo, pref, mudar, dataEvol, setDataEvol, inicioDados: dados?.inicio_dados ? Date.parse(dados.inicio_dados) : null,
    txtPeriodo, txtTipos };
  const render = (id: IdQuadro, m: Modo) => {
    const c = { ...ctx, modo: m };
    const expandir = m === 'normal' ? () => { setExpandido(id); window.scrollTo(0, 0); } : undefined;
    switch (id) {
      case 'filas': return <QFilas key={id} c={c} aoExpandir={expandir} />;
      case 'equipe': return <QEquipe key={id} c={c} aoExpandir={expandir} />;
      case 'mapa': return <QMapa key={id} c={c} aoExpandir={expandir} />;
      case 'evolucao': return <QEvolucao key={id} c={c} aoExpandir={expandir} />;
      case 'resumo': return <QResumo key={id} c={c} aoExpandir={expandir} />;
    }
  };

  const sinc = <Sincronia ultimaSync={painel.ultimaSync} falha={painel.falhaSync} tempoReal={painel.tempoReal} />;

  if (modo === 'tv') {
    return <ModoTv quadros={pref.tv} render={(id) => render(id, 'tv')} cabecalho={`Histórico: ${txtPeriodo} · ${txtTipos} · ${txtEscopo}`} sinc={sinc}
      aoSair={() => setModo('normal')} />;
  }

  return (
    <Layout titulo="Análise · Painel Operacional">
      <AbasAnalise />
      <div className="po">
        <div className="po-topo">
          <div className="po-topo-txt">
            <h2 className="po-titulo">Painel Operacional</h2>
            <span className="suave pequeno">Demandas do Apoio Operacional · horários de Brasília</span>
          </div>
          <div className="po-topo-acoes">
            {sinc}
            <button className="btn" onClick={() => setEscolhendoTv(true)}>Modo TV · escolher quadros</button>
          </div>
        </div>

        {escolhendoTv && (
          <EscolherTv inicial={pref.tv} aoFechar={() => setEscolhendoTv(false)}
            aoAplicar={(tv) => { mudar({ tv }); setEscolhendoTv(false); setExpandido(null); setModo('tv'); }} />
        )}

        {painel.erro && !dados && <Alerta tipo="erro">Não foi possível carregar o painel: {painel.erro}</Alerta>}
        {painel.carregando && !dados && <Carregando texto="Carregando o painel…" />}

        {dados && (
          <>
            {!expandido && (
              <Filtros pref={pref} mudar={mudar} hoje={hoje} txtPeriodo={txtPeriodo} txtTipos={txtTipos} filiais={filiais} centros={centros} colaboradores={colaboradores} solicitantes={solicitantes} />
            )}
            {inicioRegistro !== null && inicioRegistro > hist.de && (
              <Alerta tipo="info">
                Medição completa desde {fmtDataHora(dados.inicio_registro)}. Nos chamados anteriores valem os horários já gravados (envio, assumido,
                pendências, respostas e conclusão); neles a retomada após a correção era automática e o motivo da devolução não era registrado.
              </Alerta>
            )}
            {semRegistroGrupo > 0 && <Alerta tipo="aviso">{semRegistroGrupo} chamado(s) do período sem registro completo dos eventos: ficam fora das medianas.</Alerta>}

            {expandido ? (
              <div className="po-expandido">
                <button className="btn sutil peq" onClick={() => setExpandido(null)}>← Voltar ao painel completo</button>
                {render(expandido, 'expandido')}
              </div>
            ) : (
              <div className="po-quadros">{QUADROS.map((q) => render(q.id, 'normal'))}</div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Filtros históricos
// ---------------------------------------------------------------------------
function SeletorTipos({ valor, aoMudar, rotulo }: { valor: TipoDemanda[]; aoMudar: (v: TipoDemanda[]) => void; rotulo: string }) {
  return (
    <div className="po-tipos" role="group" aria-label={rotulo}>
      <span className="po-rot">{rotulo}</span>
      {TIPOS_DEMANDA.map((t) => (
        <label key={t.id} className={`po-chip${valor.includes(t.id) ? ' ativo' : ''}${t.ativo ? '' : ' futuro'}`} title={t.ativo ? undefined : 'Em breve: a aba Estadia ainda será construída'}>
          <input type="checkbox" disabled={!t.ativo} checked={valor.includes(t.id)}
            onChange={(e) => aoMudar(e.target.checked ? [...valor, t.id] : valor.filter((x) => x !== t.id))} />
          {t.rotulo}{!t.ativo && <small> · em breve</small>}
        </label>
      ))}
      <button type="button" className="btn sutil peq" onClick={() => aoMudar(valor.length === TIPOS_ATIVOS.length ? [] : TIPOS_ATIVOS)}>
        {valor.length === TIPOS_ATIVOS.length ? 'Limpar' : 'Todos'}
      </button>
    </div>
  );
}

function Filtros({ pref, mudar, hoje, txtPeriodo, txtTipos, filiais, centros, colaboradores, solicitantes }: {
  pref: Preferencias; mudar: (p: Partial<Preferencias>) => void; hoje: string; txtPeriodo: string; txtTipos: string;
  filiais: Array<{ id: string; nome: string }>; centros: Array<{ id: string; nome: string }>;
  colaboradores: Array<[string, string]>; solicitantes: Array<[string, string]>;
}) {
  const atalho = (a: Atalho) => mudar({ atalho: a, ...periodoDoAtalho(a, hoje, pref) });
  const nome = (lista: Array<[string, string]>, id: string) => lista.find(([i]) => i === id)?.[1];
  // Resumo do que está filtrado, para quando os filtros estão recolhidos.
  const extras = [
    pref.filial && (pref.filial === '-' ? 'Sem filial' : filiais.find((f) => f.id === pref.filial)?.nome),
    pref.centro && (pref.centro === '-' ? 'Sem centro de custo' : centros.find((c) => c.id === pref.centro)?.nome),
    pref.colaborador && nome(colaboradores, pref.colaborador),
    pref.solicitante && nome(solicitantes, pref.solicitante),
  ].filter(Boolean) as string[];
  const resumo = (
    <span className="po-filtros-resumo">
      <strong>{txtPeriodo}</strong> · {txtTipos}{extras.length ? ` · ${extras.join(' · ')}` : ''}
    </span>
  );
  if (pref.filtrosRecolhidos) {
    return (
      <section className="cartao po-filtros recolhido" aria-label="Filtros do painel (recolhidos)">
        <div className="po-filtros-cab">
          <span className="po-filtros-tit"><Icone nome="filtro" tam={16} />Filtros</span>
          {resumo}
          <button type="button" className="btn sutil peq" aria-expanded={false} onClick={() => mudar({ filtrosRecolhidos: false })}>Mostrar filtros</button>
        </div>
      </section>
    );
  }
  return (
    <section className="cartao po-filtros" aria-label="Filtros do painel">
      <div className="po-filtros-cab">
        <span className="po-filtros-tit"><Icone nome="filtro" tam={16} />Filtros</span>
        <button type="button" className="btn sutil peq" aria-expanded onClick={() => mudar({ filtrosRecolhidos: true })}>Recolher filtros</button>
      </div>
      <div className="po-filtros-linha">
        <Segmentado rotulo="Período" valor={pref.atalho === 'personalizado' ? ('' as Atalho) : pref.atalho} aoMudar={atalho}
          opcoes={[{ valor: 'hoje', rotulo: 'Hoje' }, { valor: 'semana', rotulo: 'Semana' }, { valor: 'mes', rotulo: 'Mês' }]} />
        <label className="campo po-data"><span>De</span>
          <input type="date" className="entrada" value={pref.inicio} max={pref.fim}
            onChange={(e) => e.target.value && mudar({ atalho: 'personalizado', inicio: e.target.value })} />
        </label>
        <label className="campo po-data"><span>Até</span>
          <input type="date" className="entrada" value={pref.fim} min={pref.inicio}
            onChange={(e) => e.target.value && mudar({ atalho: 'personalizado', fim: e.target.value })} />
        </label>
      </div>
      <SeletorTipos rotulo="Tipos de demanda" valor={pref.tipos} aoMudar={(tipos) => mudar({ tipos })} />
      <div className="po-filtros-linha">
        <label className="campo"><span>Filial</span>
          <select className="entrada" value={pref.filial} onChange={(e) => mudar({ filial: e.target.value })}>
            <option value="">Todas</option>{filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}<option value="-">Sem filial</option>
          </select>
        </label>
        <label className="campo"><span>Centro de custo</span>
          <select className="entrada" value={pref.centro} onChange={(e) => mudar({ centro: e.target.value })}>
            <option value="">Todos</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}<option value="-">Sem centro de custo</option>
          </select>
        </label>
        <label className="campo"><span>Colaborador do apoio</span>
          <select className="entrada" value={pref.colaborador} onChange={(e) => mudar({ colaborador: e.target.value })}>
            <option value="">Todos</option>{colaboradores.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        <label className="campo"><span>Solicitante</span>
          <select className="entrada" value={pref.solicitante} onChange={(e) => mudar({ solicitante: e.target.value })}>
            <option value="">Todos</option>{solicitantes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quadros
// ---------------------------------------------------------------------------
interface CtxQuadro {
  modo: Modo; agora: number; linhas: LinhaChamado[]; grupo: LinhaChamado[]; pref: Preferencias; mudar: (p: Partial<Preferencias>) => void;
  dataEvol: string; setDataEvol: (d: string) => void; inicioDados: number | null; txtPeriodo: string; txtTipos: string;
}

function Quadro({ id, titulo, sub, modo, aoExpandir, children, extra }: {
  id: IdQuadro; titulo: string; sub?: ReactNode; modo: Modo; aoExpandir?: () => void; children: ReactNode; extra?: ReactNode;
}) {
  return (
    <section className={`cartao po-q po-q-${id} po-${modo}`} aria-label={titulo}>
      <div className="po-q-cab">
        <div>
          <h3>{titulo}</h3>
          {sub && <span className="po-q-sub">{sub}</span>}
        </div>
        <div className="po-q-acoes">
          {extra}
          {aoExpandir && <button type="button" className="btn sutil peq" onClick={aoExpandir} aria-label={`Expandir ${titulo}`}>⤢ Expandir</button>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SemTipos({ tipos }: { tipos: TipoDemanda[] }) {
  if (!tipos.length) return <p className="po-vazio">Nenhum tipo de demanda selecionado. Marque ao menos um tipo nos filtros.</p>;
  return null;
}

const ROTULO_SITUACAO: Record<SituacaoPrazo, string> = {
  no_prazo: '● Dentro do prazo', atencao: '▲ Atraso de até 5 min', atrasado: '■ Atraso acima de 5 min',
};

function QFilas({ c, aoExpandir }: { c: CtxQuadro; aoExpandir?: () => void }) {
  return (
    <Quadro id="filas" titulo="Tempo de fila por operação" sub="Situação agora: chamados aguardando o apoio assumir ou retomar" modo={c.modo} aoExpandir={aoExpandir}>
      <div className="po-filas">
        {OPERACOES.map((op) => {
          if (op.futura) {
            return (
              <div key={op.id} className="po-fila futura">
                <div className="po-fila-cab">{op.rotulo}<span className="po-breve">Em breve</span></div>
                <div className="po-fila-corpo">
                  <span className="po-fila-rot">Espera média atual</span>
                  <span className="po-fila-val">—</span>
                  <div className="po-fila-linha"><span>Chamados na fila</span><strong>—</strong></div>
                  <div className="po-fila-linha"><span>Mais antigo aguardando</span><strong>—</strong></div>
                  <span className="po-fila-nota">Sem dados: a aba Estadia ainda será construída.</span>
                </div>
              </div>
            );
          }
          const f = filaAtual(c.linhas, op.tipos as TipoSolicitacaoDoc[], c.agora);
          const sit = situacaoPrazo(f.media_ms, op.prazo_min);
          const sitAntigo = situacaoPrazo(f.mais_antigo_ms, op.prazo_min);
          return (
            <div key={op.id} className={`po-fila${sit ? ` prazo-${sit}` : ''}`}>
              <div className="po-fila-cab">{op.rotulo}{op.prazo_min && <span className="po-prazo">Prazo {op.prazo_min} min</span>}</div>
              <div className="po-fila-corpo">
                <span className="po-fila-rot">Espera média atual</span>
                <span className="po-fila-val">{fmtDur(f.media_ms)}</span>
                <span className={`po-sit${sit ? ` prazo-${sit}` : ''}`}>{sit ? ROTULO_SITUACAO[sit] : f.quantidade ? 'Sem horário de entrada' : 'Fila vazia'}</span>
                <div className="po-fila-linha"><span>Chamados na fila</span><strong>{f.quantidade}</strong></div>
                <div className="po-fila-linha"><span>Mais antigo aguardando</span><strong className={sitAntigo ? `txt-prazo-${sitAntigo}` : undefined}>{fmtDur(f.mais_antigo_ms)}</strong></div>
                {op.composicao && <span className="po-fila-nota">{op.composicao}</span>}
                {f.retorno > 0 && <span className="po-fila-nota">{f.retorno} na fila de retorno (correção recebida)</span>}
                {f.sem_registro > 0 && <span className="po-fila-nota">{f.sem_registro} sem registro do horário de entrada</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Quadro>
  );
}

function QEquipe({ c, aoExpandir }: { c: CtxQuadro; aoExpandir?: () => void }) {
  const linhas = useMemo(() => porColaborador(c.grupo), [c.grupo]);
  const tv = c.modo === 'tv';
  const caixa = useRef<HTMLDivElement>(null);
  const [cabem, setCabem] = useState(6);
  useEffect(() => {
    const el = caixa.current;
    if (!tv || !el) return;
    const medir = () => {
      const cab = el.querySelector('thead')?.getBoundingClientRect().height ?? 40;
      const lin = el.querySelector('tbody tr')?.getBoundingClientRect().height || 56;
      setCabem(Math.max(1, Math.floor((el.clientHeight - cab - 4) / lin)));
    };
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    medir();
    return () => ro.disconnect();
  }, [tv, linhas.length]);
  const porPagina = tv ? cabem : linhas.length || 1;
  const [pagina, setPagina] = useState(0);
  const paginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  useEffect(() => { if (pagina >= paginas) setPagina(0); }, [pagina, paginas]);
  const visiveis = linhas.slice(pagina * porPagina, (pagina + 1) * porPagina);
  return (
    <Quadro id="equipe" titulo="Atendimento por colaborador do apoio" modo={c.modo} aoExpandir={aoExpandir}
      sub={`Enviados de ${c.txtPeriodo} · ${c.txtTipos}. Concluídos e medianas contam para quem encerrou o chamado.`}
      extra={tv && paginas > 1 ? (
        <span className="po-pag">
          <button className="btn peq" onClick={() => setPagina((p) => (p + paginas - 1) % paginas)} aria-label="Página anterior">‹</button>
          Página {pagina + 1} de {paginas} · {linhas.length} colaboradores
          <button className="btn peq" onClick={() => setPagina((p) => (p + 1) % paginas)} aria-label="Próxima página">›</button>
        </span>
      ) : undefined}>
      <SemTipos tipos={c.pref.tipos} />
      {c.pref.tipos.length > 0 && (linhas.length === 0 ? <p className="po-vazio">Nenhum chamado assumido no período.</p> : (
        <div className={tv ? 'po-tab-caixa' : 'rolagem-x'} ref={caixa}>
          <table className="tabela po-tab">
            <thead>
              <tr>
                <th>Colaborador</th><th className="n">Assumidos</th><th className="n">Concluídos</th><th className="n">Em atendimento</th>
                <th className="n">Em pendência</th><th className="n">Tempo em atendimento<small>mediana</small></th><th className="n">Prazo total<small>mediana</small></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((x) => (
                <tr key={x.id}>
                  <td><strong>{x.nome}</strong>{!tv && <small className="po-tipos-col">{Object.entries(x.tipos).map(([t, n]) => `${ROTULO_TIPO[t as TipoDemanda]} ${n}`).join(' · ')}</small>}</td>
                  <td className="n">{x.assumidos}</td>
                  <td className="n">{x.concluidos}</td>
                  <td className="n">{x.em_atendimento}</td>
                  <td className="n">{x.em_pendencia}</td>
                  <td className="n"><strong>{x.amostra ? fmtDur(x.mediana_atendimento_ms) : 'Sem registro'}</strong><small>{x.amostra ? `amostra ${x.amostra}` : ''}</small></td>
                  <td className="n"><strong>{x.amostra ? fmtDur(x.mediana_total_ms) : 'Sem registro'}</strong><small>{x.amostra ? `amostra ${x.amostra}` : ''}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {!tv && linhas.length > 0 && (
        <p className="po-nota">Ordem alfabética, sem ranking. Tempo em atendimento mede a permanência na etapa (não atividade contínua); pendência é situação do processo e
          não indica falha do colaborador. Amostra = concluídos com registro completo.</p>
      )}
    </Quadro>
  );
}

function QMapa({ c, aoExpandir }: { c: CtxQuadro; aoExpandir?: () => void }) {
  const passo = c.pref.passoMapa;
  const m = useMemo(() => mapaCalor(c.grupo, passo), [c.grupo, passo]);
  const [cel, setCel] = useState<[number, number] | null>(null);
  const { ate } = intervaloMs(c.pref.inicio, c.pref.fim);
  const semDados = c.inicioDados === null || ate <= c.inicioDados;
  return (
    <Quadro id="mapa" titulo="Mapa de calor · chegada dos chamados" modo={c.modo} aoExpandir={aoExpandir}
      sub={`Envio original, ${c.txtPeriodo}: volume acumulado (soma dos dias equivalentes, não é média por dia). Todas as 24 horas.`}
      extra={c.modo !== 'tv' ? <Segmentado rotulo="Faixa" valor={String(passo) as '1' | '2'} aoMudar={(v) => c.mudar({ passoMapa: Number(v) as 1 | 2 })}
        opcoes={[{ valor: '1', rotulo: '1 h' }, { valor: '2', rotulo: '2 h' }]} /> : undefined}>
      <SemTipos tipos={c.pref.tipos} />
      {c.pref.tipos.length > 0 && (semDados ? <p className="po-vazio">Sem dados históricos neste período (antes do início do registro no Travion).</p> : (
        <>
          <MapaCalorGrade matriz={m.matriz} max={m.max} passo={passo} dias={DIAS_CURTOS} escolhida={cel} aoEscolher={(d, f) => setCel([d, f])} />
          <p className="po-mapa-det" role="status">
            {cel ? <><strong>{DIAS_SEMANA[cel[0]]}, {String(cel[1] * passo).padStart(2, '0')}h às {String((cel[1] + 1) * passo).padStart(2, '0')}h:</strong> {m.matriz[cel[0]][cel[1]]} chamado(s) no período.</>
              : m.total ? `${m.total} chamados no período. Toque numa célula para ver o dia e a faixa.` : 'Nenhum chamado no período (zero real, com registro).'}
          </p>
        </>
      ))}
    </Quadro>
  );
}

function QEvolucao({ c, aoExpandir }: { c: CtxQuadro; aoExpandir?: () => void }) {
  const visao = c.pref.visaoEvol;
  const tipos = c.pref.tiposEvol;
  const envios = useMemo(() => c.linhas.filter((l) => tipos.includes(l.s.tipo)).map((l) => Date.parse(l.s.enviado_em)), [c.linhas, tipos]);
  const r = useMemo(() => evolucao(envios, visao, c.dataEvol, c.agora, c.inicioDados), [envios, visao, c.dataEvol, c.agora, c.inicioDados]);
  const cmp = r.comparavel;
  const rotAnterior = visao === 'dia' ? 'Dia anterior' : visao === 'semana' ? 'Semana anterior' : 'Mês anterior';
  const fmtIntervalo = (ms: number) => (visao === 'dia' ? `${fmtDataCurta(dataSP(ms))} ${fmtHora(new Date(ms).toISOString())}` : `${DIAS_CURTOS[(new Date(ms - 3 * 3600e3).getUTCDay() + 6) % 7]} ${fmtDataCurta(dataSP(ms))}`);
  const detalhe = (i: number) => {
    const a = r.inicios[i];
    const p = r.iniciosAnterior[i];
    return {
      titulo: visao === 'dia' ? `${fmtDataCurta(dataSP(a))} · ${r.rotulos[i]} às ${String(i + 1).padStart(2, '0')}h` : fmtIntervalo(a),
      atual: r.atual[i], anterior: r.anterior[i], rotuloAnterior: p === null ? `${rotAnterior}: sem equivalente` : `${rotAnterior} (${fmtIntervalo(p)})`,
    };
  };
  const variacao = cmp.situacao === 'nao_iniciado' ? 'Período ainda não começou'
    : cmp.situacao === 'sem_dados_anteriores' ? 'Sem dados do período anterior'
    : cmp.situacao === 'sem_base' ? 'Sem base percentual anterior'
    : `${cmp.variacao_pct! > 0 ? '+' : ''}${fmtPct(cmp.variacao_pct)} ${cmp.variacao_pct! > 0 ? '(aumento de volume)' : cmp.variacao_pct! < 0 ? '(redução de volume)' : '(mesmo volume)'}`;
  const tv = c.modo === 'tv';
  return (
    <Quadro id="evolucao" titulo="Evolução das demandas" modo={c.modo} aoExpandir={aoExpandir}
      sub={`Novas solicitações recebidas · ${visao === 'dia' ? 'por hora, 00h às 23h' : visao === 'semana' ? 'por dia, segunda a domingo' : 'por dia do mês'}`}>
      {!tv && (
        <div className="po-evol-filtros">
          <Segmentado rotulo="Visualização" valor={visao} aoMudar={(v) => c.mudar({ visaoEvol: v })}
            opcoes={[{ valor: 'dia', rotulo: 'Dia' }, { valor: 'semana', rotulo: 'Semana' }, { valor: 'mes', rotulo: 'Mês' }]} />
          <label className="campo po-data"><span>Data de referência</span>
            <input type="date" className="entrada" value={c.dataEvol} onChange={(e) => e.target.value && c.setDataEvol(e.target.value)} />
          </label>
          <SeletorTipos rotulo="Tipos" valor={tipos} aoMudar={(t) => c.mudar({ tiposEvol: t })} />
        </div>
      )}
      {!tipos.length ? <SemTipos tipos={tipos} /> : (
        <>
          <div className="po-evol-kpis">
            <div><span>Recebidos no recorte comparável</span><strong>{cmp.atual ?? '—'}</strong></div>
            <div><span>Período anterior equivalente</span><strong>{cmp.anterior ?? '—'}</strong></div>
            <div><span>Variação do volume</span><strong className="po-var">{variacao}</strong></div>
          </div>
          <div className="po-legenda">
            <span><i className="gl-leg-atual" />{visao === 'dia' ? fmtDataCurta(c.dataEvol) : visao === 'semana' ? `Semana de ${fmtDataCurta(dataSP(r.periodo.de))}` : `Mês ${dataSP(r.periodo.de).slice(5, 7)}/${dataSP(r.periodo.de).slice(0, 4)}`} (linha contínua)</span>
            <span><i className="gl-leg-ant" />{rotAnterior} (tracejada)</span>
            <span className="suave">Unidade: solicitações</span>
          </div>
          <div className="po-evol-graf">
            <GraficoLinha rotulos={r.rotulos} atual={r.atual} anterior={r.anterior} detalhe={detalhe} altura={tv ? 'auto' : c.modo === 'expandido' ? 380 : 240} />
          </div>
          <p className="po-nota">
            {cmp.corte !== null && <>Comparação até {fmtDataHora(new Date(cmp.corte).toISOString())}, só nos intervalos equivalentes já observados. </>}
            {cmp.dias_sem_equivalente.length > 0 && <>Dias {cmp.dias_sem_equivalente.join(', ')} não existem no mês anterior: aparecem na linha, fora do percentual. </>}
            Intervalos futuros ou sem registro ficam sem linha. Menos demandas não quer dizer, por si, mais eficiência.
          </p>
        </>
      )}
    </Quadro>
  );
}

function QResumo({ c, aoExpandir }: { c: CtxQuadro; aoExpandir?: () => void }) {
  const r = useMemo(() => resumo(c.grupo), [c.grupo]);
  const motivos = Object.entries(r.motivos).filter(([m]) => m !== 'sem_registro').sort((a, b) => b[1] - a[1]);
  return (
    <Quadro id="resumo" titulo="Resumo geral da operação" modo={c.modo} aoExpandir={aoExpandir} sub={`Chamados enviados de ${c.txtPeriodo} · ${c.txtTipos} · situação agora`}>
      <SemTipos tipos={c.pref.tipos} />
      {c.pref.tipos.length > 0 && (
        <>
          <div className="po-resumo">
            <div><span>Recebidos</span><strong>{fmtNum(r.recebidos)}</strong></div>
            <div><span>Concluídos</span><strong>{fmtNum(r.concluidos)}</strong></div>
            <div><span>Em atendimento</span><strong>{fmtNum(r.em_atendimento)}</strong></div>
            <div><span>Parados por pendência</span><strong>{fmtNum(r.pendencia)}</strong></div>
          </div>
          <p className="po-nota">Não é a soma de todas as situações: dos recebidos, {r.na_fila} estão na fila e {r.cancelados} foram cancelados.</p>
          {c.modo !== 'tv' && (
            <p className="po-nota">
              <strong>Pendências:</strong> {r.com_devolucao} chamado(s) com devolução · {r.devolucoes} devolução(ões) · {r.devolvidos_mais_de_uma_vez} devolvido(s) mais de uma vez ·
              {' '}{fmtDur(r.tempo_pendencia_ms || null)} aguardando correção (soma).
              {motivos.length > 0 && <> Motivos: {motivos.map(([m, n]) => `${MOTIVO_DEVOLUCAO[m as MotivoDevolucao]} ${n}`).join(' · ')}.</>}
              {(r.motivos.sem_registro ?? 0) > 0 && <> {r.motivos.sem_registro} sem motivo registrado (antes da medição completa).</>}
            </p>
          )}
        </>
      )}
    </Quadro>
  );
}

// ---------------------------------------------------------------------------
// Sincronização, Modo TV
// ---------------------------------------------------------------------------
function Sincronia({ ultimaSync, falha, tempoReal }: { ultimaSync: number | null; falha: boolean; tempoReal: boolean }) {
  const hora = ultimaSync ? new Date(ultimaSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const estado = falha ? 'erro' : tempoReal ? 'ok' : 'parcial';
  return (
    <span className={`po-sinc po-sinc-${estado}`} role="status">
      {falha ? `Sem conexão · dados de ${hora}` : tempoReal ? `Tempo real ativo · atualizado ${hora}` : `Atualização a cada 15 s · ${hora}`}
    </span>
  );
}

function EscolherTv({ inicial, aoFechar, aoAplicar }: { inicial: IdQuadro[]; aoFechar: () => void; aoAplicar: (q: IdQuadro[]) => void }) {
  const [sel, setSel] = useState<IdQuadro[]>(inicial);
  return (
    <section className="cartao po-tv-escolha" aria-label="Modo TV: escolher quadros">
      <strong>Modo TV · escolha os quadros</strong>
      <div className="po-tv-opcoes">
        {QUADROS.map((q) => (
          <label key={q.id} className={`po-chip${sel.includes(q.id) ? ' ativo' : ''}`}>
            <input type="checkbox" checked={sel.includes(q.id)} onChange={(e) => setSel(e.target.checked ? QUADROS.map((x) => x.id).filter((x) => x === q.id || sel.includes(x)) : sel.filter((x) => x !== q.id))} />
            {q.rotulo}
          </label>
        ))}
      </div>
      {!sel.length && <small className="erro-campo">Escolha ao menos um quadro.</small>}
      {sel.length >= 4 && <small className="suave">Com 4 ou mais quadros a tela pode não comportar tudo sem rolagem; o painel avisa se isso acontecer.</small>}
      <div className="po-tv-botoes">
        <button className="btn primario" disabled={!sel.length} onClick={() => aoAplicar(sel)}>Aplicar Modo TV</button>
        <button className="btn sutil" onClick={aoFechar}>Cancelar</button>
      </div>
    </section>
  );
}

function ModoTv({ quadros, render, cabecalho, sinc, aoSair }: {
  quadros: IdQuadro[]; render: (id: IdQuadro) => ReactNode; cabecalho: string; sinc: ReactNode; aoSair: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const grade = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [transborda, setTransborda] = useState(false);
  useEffect(() => {
    const mudou = () => setCheia(!!document.fullscreenElement);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) aoSair(); };
    document.addEventListener('fullscreenchange', mudou);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('fullscreenchange', mudou);
      window.removeEventListener('keydown', esc);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [aoSair]);
  useEffect(() => {
    const el = grade.current;
    if (!el) return;
    const medir = () => setTransborda(el.scrollHeight > el.clientHeight + 4
      || [...el.querySelectorAll<HTMLElement>('.po-q')].some((q) => q.scrollHeight > q.clientHeight + 4));
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    const t = setInterval(medir, 2000);
    return () => { ro.disconnect(); clearInterval(t); };
  }, [quadros]);
  const telaCheia = async () => {
    setAviso(null);
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => undefined); return; }
    const el = caixa.current;
    if (!el?.requestFullscreen) { setAviso('Este navegador não permite tela inteira por aqui. Use a tecla F11.'); return; }
    try { await el.requestFullscreen(); } catch { setAviso('O navegador bloqueou a tela inteira. Use a tecla F11 para ocupar a tela toda.'); }
  };
  // Filas e evolução lado a lado; equipe numa linha inteira; mapa e resumo lado a lado.
  const ordem = (['filas', 'evolucao', 'equipe', 'mapa', 'resumo'] as IdQuadro[]).filter((id) => quadros.includes(id));
  return (
    <div className="tv" ref={caixa} data-n={ordem.length}>
      <header className="tv-cab">
        <div>
          <strong className="tv-titulo">Painel Operacional</strong>
          <span className="tv-contexto">{cabecalho}</span>
        </div>
        <div className="tv-acoes">
          {sinc}
          <button className="btn" onClick={() => void telaCheia()}>{cheia ? 'Sair da tela inteira' : 'Tela inteira'}</button>
          <button className="btn primario" onClick={aoSair}>Voltar ao painel</button>
        </div>
      </header>
      {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}
      {transborda && <Alerta tipo="aviso">Os quadros escolhidos não cabem inteiros nesta tela. Volte ao painel e reduza a seleção no Modo TV.</Alerta>}
      <div className="tv-grade" ref={grade}>{ordem.map((id) => render(id))}</div>
    </div>
  );
}

