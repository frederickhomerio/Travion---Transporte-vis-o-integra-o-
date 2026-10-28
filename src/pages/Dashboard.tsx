import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { AbasAnalise } from './analise/AbasAnalise';
import { Alerta, Carregando, EstadoVazio, Segmentado } from '../components/ui';
import { mensagemErro } from '../data/api';
import { linhasDaData, useApp, useIndices } from '../data/store';
import { nome } from '../lib/cadastros';
import { type Indicadores, type TipoPeriodo, diasDoIntervalo, indicadores, faixaBarra, indicadoresPorGrupo, intervaloPeriodo } from '../lib/dashboard';
import { FILTROS_VAZIOS, aplicarFiltros } from '../lib/filtros';
import { fmtDataCurta, fmtNum, fmtPct, fmtReais, fmtT, hojeSP } from '../lib/formato';
import type { LinhaFrete } from '../types';

type Visao = 'geral' | 'filiais' | 'centros';

const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const TITULO_PERIODO: Record<TipoPeriodo, string> = { dia: 'do dia', semana: 'da semana', mes: 'do mês' };

/** R$ compacto: 812.200 → "R$ 812,2 mil". */
function mil(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `R$ ${fmtNum(v / 1_000_000, 2)} mi`;
  if (Math.abs(v) >= 10_000) return `R$ ${fmtNum(v / 1000, 1)} mil`;
  return fmtReais(v, 0);
}

export function Dashboard() {
  const { estado, pode, garantirPeriodo } = useApp();
  const idx = useIndices();
  const fin = pode('financeiro.ver');
  const hoje = hojeSP();
  const [tipo, setTipo] = useState<TipoPeriodo>('dia');
  const [visao, setVisao] = useState<Visao>('geral');
  const [alvo, setAlvo] = useState('');
  const [mostrarNaoValidado, setMostrarNaoValidado] = useState(false);
  const [todosClientes, setTodosClientes] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { inicio, fim } = intervaloPeriodo(hoje, tipo);
  const dias = useMemo(() => diasDoIntervalo(inicio, fim, hoje), [inicio, fim, hoje]);

  useEffect(() => {
    if (tipo === 'dia') return;
    setCarregando(true);
    setErro(null);
    garantirPeriodo(inicio, dias[dias.length - 1]).catch((e) => setErro(mensagemErro(e))).finally(() => setCarregando(false));
  }, [tipo, inicio, dias, garantirPeriodo]);

  const filiaisAtivas = estado.cadastros.filiais.filter((f) => f.ativo);
  const centrosAtivos = estado.cadastros.centros_custo.filter((c) => c.ativo);
  const noEscopo = (l: LinhaFrete) => {
    if (!alvo) return true;
    if (visao === 'filiais') return l.embarque.filial_id === alvo;
    if (visao === 'centros') return (idx.filial.get(l.embarque.filial_id)?.centro_custo_id ?? '') === alvo;
    return true;
  };
  const porDia = useMemo(
    () => dias.map((d) => aplicarFiltros(linhasDaData(estado, d), FILTROS_VAZIOS, idx).filter(noEscopo)),
    [dias, estado, idx, visao, alvo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const r = useMemo(() => indicadores(porDia, estado.config, fin), [porDia, estado.config, fin]);
  const filiaisEscopo = filiaisAtivas.filter((f) => noEscopo({ embarque: { filial_id: f.id } } as LinhaFrete)).map((f) => f.id);
  const porFilial = useMemo(() => indicadoresPorGrupo(porDia, (l) => l.embarque.filial_id, estado.config, fin, filiaisEscopo),
    [porDia, estado.config, fin, filiaisEscopo.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const porCentro = useMemo(() => indicadoresPorGrupo(porDia, (l) => idx.filial.get(l.embarque.filial_id)?.centro_custo_id ?? '', estado.config, fin),
    [porDia, estado.config, fin, idx]);
  const porCliente = useMemo(() => indicadoresPorGrupo(porDia, (l) => l.embarque.cliente_id, estado.config, fin), [porDia, estado.config, fin]);

  const exibirRs = fin && (r.valido || mostrarNaoValidado);
  const rs = (v: number | null) => (exibirRs ? mil(v) : fin ? 'Não validado' : '—');

  const tituloData = tipo === 'dia'
    ? `Dia ${fmtDataCurta(hoje)} (${DIA_SEMANA[new Date(`${hoje}T12:00:00Z`).getUTCDay()]})`
    : `${tipo === 'semana' ? 'Semana' : 'Mês'} de ${fmtDataCurta(inicio)} a ${fmtDataCurta(fim)} · dia ${dias.length} de ${diasDoIntervalo(inicio, fim, fim).length}`;

  const filiaisLista = [...porFilial.entries()].map(([id, x]) => ({ id, nome: nome(idx.filial, id), x }))
    .sort((a, b) => b.x.projetado_t - a.x.projetado_t || a.nome.localeCompare(b.nome, 'pt-BR'));
  const centrosLista = [...porCentro.entries()].filter(([, x]) => x.lotes > 0)
    .map(([id, x]) => ({ id, nome: id ? nome(idx.centroCusto, id) : 'Sem centro de custo', x }))
    .sort((a, b) => b.x.projetado_t - a.x.projetado_t);
  const clientes = [...porCliente.entries()].filter(([, x]) => x.lotes > 0)
    .map(([id, x]) => ({ id, nome: nome(idx.cliente, id), x }))
    .sort((a, b) => (b.x.faturamento ?? b.x.projetado_t) - (a.x.faturamento ?? a.x.projetado_t));

  return (
    <Layout titulo="Análise · Dashboard Operacional">
      <AbasAnalise />
      <div className="dash">
        <div className="dash-topo">
          <span className="dash-periodo">{tituloData}</span>
          <div className="dash-controles">
            <Segmentado rotulo="Visão" valor={visao} aoMudar={(v) => { setVisao(v); setAlvo(''); }}
              opcoes={[{ valor: 'geral', rotulo: 'Geral' }, { valor: 'filiais', rotulo: 'Filiais' }, { valor: 'centros', rotulo: 'Centros de custo' }]} />
            {visao !== 'geral' && (
              <label className="campo"><span>{visao === 'filiais' ? 'Filial' : 'Centro de custo'}</span>
                <select className="entrada" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
                  <option value="">Todos</option>
                  {(visao === 'filiais' ? filiaisAtivas : centrosAtivos).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
            )}
            <label className="campo"><span>Período</span>
              <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPeriodo)}>
                <option value="dia">Dia · {fmtDataCurta(hoje)}</option>
                <option value="semana">Semana · seg {fmtDataCurta(intervaloPeriodo(hoje, 'semana').inicio)} a dom {fmtDataCurta(intervaloPeriodo(hoje, 'semana').fim)}</option>
                <option value="mes">Mês · {fmtDataCurta(intervaloPeriodo(hoje, 'mes').inicio)} a {fmtDataCurta(intervaloPeriodo(hoje, 'mes').fim)}</option>
              </select>
            </label>
          </div>
        </div>

        {erro ? <Alerta tipo="erro">{erro}</Alerta> : (estado.carregando && !Object.keys(estado.embarques).length) || carregando ? <Carregando /> : r.lotes === 0 ? (
          <div className="cartao"><EstadoVazio titulo="Sem posições no período"><p>Abra as posições do dia ou escolha outro período.</p></EstadoVazio></div>
        ) : (
          <>
            {fin && !r.valido && (
              <Alerta tipo="aviso">
                <div style={{ flex: 1 }}>
                  <strong>Valores em R$ não validados.</strong> Faturamento e margens precisam de frete em R$/t confirmado.
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
                <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={mostrarNaoValidado} onChange={(e) => setMostrarNaoValidado(e.target.checked)} />Ver estimativa mesmo assim</label>
              </Alerta>
            )}

            <Destaque r={r} tipo={tipo} fin={exibirRs} />

            <div className="dash-kpis">
              {fin && <Kpi rot="Faturamento projetado" val={rs(r.faturamento)} det={r.faturamento_disponibilizado ? `Meta ${rs(r.faturamento_disponibilizado)} · ${fmtPct(r.faturamento !== null ? (r.faturamento / r.faturamento_disponibilizado) * 100 : null)}` : 'Sem meta'} />}
              <Kpi rot="Volume projetado" val={fmtT(r.projetado_t)} det={r.disponibilizado_t === null ? 'Sem volume disponibilizado' : `Disponibilizado ${fmtT(r.disponibilizado_t)}`} />
              {fin && <Kpi rot="Ticket médio empresa" val={exibirRs ? `${fmtReais(r.ticket_empresa)}/t` : rs(null)} det="média ponderada pelo volume" />}
              {fin && <Kpi rot="Ticket médio motorista" val={exibirRs ? `${fmtReais(r.ticket_motorista)}/t` : rs(null)} det="média ponderada pelo volume" />}
              {fin && <Kpi rot="Margem bruta projetada" val={rs(r.margem_bruta)} det={exibirRs ? `${fmtPct(r.margem_bruta_pct)} do faturamento` : ''} />}
              {fin && <Kpi rot="Margem líquida" val={rs(r.margem_liquida)} det={exibirRs ? `${fmtPct(r.margem_liquida_pct)} · bruta − 1,8% do faturamento` : ''} />}
              {!fin && <Kpi rot="Aderência" val={fmtPct(r.aderencia_pct)} det="projetado ÷ disponibilizado" />}
              {!fin && <Kpi rot="Carregados" val={`${fmtNum(r.carregados)} veículos`} det={tipo === 'dia' ? 'no dia' : 'somados no período'} />}
            </div>

            <div className="dash-linha">
              <section className="cartao dash-sec dash-filiais">
                <div className="dash-sec-topo">
                  <h3>Meta x Projeção {exibirRs ? 'de faturamento ' : ''}por filial</h3>
                  <div className="legenda"><span><i style={{ background: 'var(--cinza-300)' }} />Meta</span><span><i className="faixa-vermelho" />Projeção até 60%</span><span><i className="faixa-amarelo" />60,1% a 80%</span><span><i className="faixa-verde" />acima de 80%</span></div>
                </div>
                <BarrasMeta itens={filiaisLista} rs={exibirRs} />
                <span className="suave pequeno">Meta = volume disponibilizado {exibirRs ? '× frete empresa ' : ''}· projeção = porta + carregados{exibirRs ? ' × frete empresa' : ''}</span>
              </section>

              <section className="cartao dash-sec dash-disp">
                <h3>Disponibilizado x Projetado</h3>
                <div><span className="suave pequeno">Volume disponibilizado (meta dos lotes)</span><div className="dash-num">{r.disponibilizado_t === null ? 'Sem meta' : fmtT(r.disponibilizado_t)}</div></div>
                <div><span className="suave pequeno">Volume projetado</span><div className="dash-num vinho">{fmtT(r.projetado_t)}</div></div>
                <div className="dash-barra"><div className={classeFaixa(r.aderencia_pct)} style={{ width: `${Math.min(r.aderencia_pct ?? 0, 100)}%` }} /></div>
                <span><strong>{fmtPct(r.aderencia_pct)}</strong> de aderência{r.disponibilizado_t !== null && r.disponibilizado_t > r.projetado_t
                  ? ` · faltam ${fmtT(r.disponibilizado_t - r.projetado_t)} (${Math.ceil((r.disponibilizado_t - r.projetado_t) / (estado.config.capacidade_padrao_t || 40))} cargas)` : ''}</span>
                <div className="dash-veiculos">
                  <div><span>Na porta</span><strong>{fmtNum(r.porta)} veículos</strong></div>
                  <div><span>Em trânsito</span><strong>{fmtNum(r.transito)} veículos</strong></div>
                  <div><span>Carregados</span><strong>{fmtNum(r.carregados)} veículos</strong></div>
                </div>
              </section>
            </div>

            <section className="cartao dash-sec">
              <div className="dash-sec-topo">
                <h3>Volume, faturamento e margem por cliente</h3>
                <span className="suave pequeno">{exibirRs ? 'Ordenado por faturamento projetado' : 'Ordenado por volume projetado'}</span>
              </div>
              <div className="rolagem-x">
                <table className="tabela">
                  <thead><tr><th>Cliente</th><th className="n">Volume</th>{exibirRs && <><th className="n">Faturamento</th><th className="n">Ticket médio</th><th className="n">Margem líquida (R$)</th><th className="n">Margem líquida (%)</th></>}</tr></thead>
                  <tbody>
                    {(todosClientes ? clientes : clientes.slice(0, 10)).map((c) => (
                      <tr key={c.id}><td><strong>{c.nome}</strong></td><td className="n">{fmtT(c.x.projetado_t)}</td>
                        {exibirRs && <><td className="n">{mil(c.x.faturamento)}</td><td className="n">{fmtReais(c.x.ticket_empresa)}</td>
                          <td className="n"><strong>{mil(c.x.margem_liquida)}</strong></td><td className="n"><strong>{fmtPct(c.x.margem_liquida_pct)}</strong></td></>}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {clientes.length > 10 && <button type="button" className="btn peq" style={{ alignSelf: 'flex-start' }} onClick={() => setTodosClientes(!todosClientes)}>{todosClientes ? 'Mostrar só os 10 primeiros' : `Mostrar todos (${clientes.length})`}</button>}
            </section>

            {centrosLista.length > 0 && (
              <section className="dash-sec-solta">
                <h3>Meta x Projeção por centro de custo</h3>
                <div className="dash-centros">
                  {centrosLista.map((c) => {
                    const meta = exibirRs ? c.x.faturamento_disponibilizado : c.x.disponibilizado_t;
                    const proj = exibirRs ? c.x.faturamento : c.x.projetado_t;
                    const pct = meta && proj !== null ? (proj / meta) * 100 : null;
                    const f = (v: number | null) => (exibirRs ? mil(v) : fmtT(v));
                    return (
                      <div key={c.id || 'sem'} className="cartao dash-centro">
                        <div className="dash-centro-topo"><strong>{c.nome}</strong><span>{pct === null ? 'Sem meta' : fmtPct(pct)}</span></div>
                        <div className="dash-barra fina"><div className={classeFaixa(pct)} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} /></div>
                        <div className="dash-centro-nums">
                          <div><span>Meta</span><strong>{f(meta)}</strong></div>
                          <div><span>Projeção</span><strong>{f(proj)}</strong></div>
                          {exibirRs && <div><span>Margem bruta</span><strong>{fmtPct(c.x.margem_bruta_pct)}</strong></div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function Destaque({ r, tipo, fin }: { r: Indicadores; tipo: TipoPeriodo; fin: boolean }) {
  const meta = fin ? r.faturamento_disponibilizado : r.disponibilizado_t;
  const proj = fin ? r.faturamento : r.projetado_t;
  const f = (v: number | null) => (fin ? mil(v) : fmtT(v));
  const pct = meta && proj !== null ? (proj / meta) * 100 : null;
  return (
    <section className="dash-destaque">
      <div className="dash-destaque-txt">
        <span className="dash-destaque-rot">{fin ? 'Faturamento' : 'Volume'} {TITULO_PERIODO[tipo]}</span>
        <span className="dash-destaque-val">{pct === null ? 'Sem meta' : `${fmtPct(pct)} da meta`}</span>
        <span className="dash-destaque-det">Projeção {f(proj)} · meta {f(meta)}{meta !== null && proj !== null && meta > proj ? ` · faltam ${f(meta - proj)}` : ''}</span>
      </div>
      <div className="dash-destaque-barra">
        <div className="trilho"><div className={classeFaixa(pct)} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} /></div>
        <div className="escala"><span>0</span><span>Meta = volume disponibilizado{fin ? ' × frete empresa' : ''}</span><span>Meta</span></div>
      </div>
    </section>
  );
}

/** Classe de cor da barra pela faixa de % (vermelho / amarelo / verde); sem meta fica neutra. */
function classeFaixa(pct: number | null | undefined): string {
  const f = faixaBarra(pct);
  return f ? `faixa-${f}` : 'faixa-neutra';
}

function Kpi({ rot, val, det }: { rot: string; val: string; det?: string }) {
  return (
    <div className="cartao dash-kpi">
      <span className="rot">{rot}</span>
      <span className="val">{val}</span>
      {det && <span className="det">{det}</span>}
    </div>
  );
}

function BarrasMeta({ itens, rs }: { itens: Array<{ id: string; nome: string; x: Indicadores }>; rs: boolean }) {
  const vals = itens.map((i) => ({
    ...i,
    meta: (rs ? i.x.faturamento_disponibilizado : i.x.disponibilizado_t) ?? 0,
    proj: (rs ? i.x.faturamento : i.x.projetado_t) ?? 0,
  }));
  const max = Math.max(1, ...vals.map((v) => Math.max(v.meta, v.proj)));
  if (!vals.length) return <p className="suave">Nenhuma filial no escopo.</p>;
  return (
    <div className="dash-barras">
      {vals.map((v) => (
        <div key={v.id} className="dash-barras-linha" title={`${v.nome}: projeção ${rs ? mil(v.proj) : fmtT(v.proj)} · meta ${rs ? mil(v.meta) : fmtT(v.meta)}`}>
          <span className="nome">{v.nome}</span>
          <div className="trilho">
            <div className="meta" style={{ width: `${(v.meta / max) * 100}%` }} />
            <div className={`proj ${classeFaixa(v.meta > 0 ? (v.proj / v.meta) * 100 : null)}`} style={{ width: `${(v.proj / max) * 100}%` }} />
          </div>
          <span className="pct">{v.meta > 0 ? <><strong>{fmtPct((v.proj / v.meta) * 100)}</strong> da meta</> : 'Sem meta'}</span>
        </div>
      ))}
    </div>
  );
}
