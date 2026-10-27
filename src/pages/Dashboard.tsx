import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarraFiltros } from '../components/Filtros';
import { Layout } from '../components/Layout';
import { Alerta, Carregando, EstadoVazio, Segmentado } from '../components/ui';
import { mensagemErro } from '../data/api';
import { linhasDaData, useApp, useIndices, useLinhas } from '../data/store';
import { nome } from '../lib/cadastros';
import { type Resumo, resumir, resumirPeriodo, resumirPorGrupo } from '../lib/calculos';
import { aplicarFiltros } from '../lib/filtros';
import { fmtData, fmtDataCurta, fmtNum, fmtPct, fmtReais, fmtT, somarDias } from '../lib/formato';
import type { MetaDiaria } from '../types';

// Paleta categórica validada (slots 1–3): porta, trânsito, carregados. Cada cor vem sempre com rótulo.
const COR = { porta: '#2a78d6', transito: '#eb6834', carregados: '#1baf7a', meta: '#9aa3b2', projetado: '#2a78d6' };

export function Dashboard() {
  const { estado, pode, definirFiltros, garantirPeriodo } = useApp();
  const idx = useIndices();
  const todas = useLinhas();
  const linhas = useMemo(() => aplicarFiltros(todas, { ...estado.filtros, busca: '' }, idx), [todas, estado.filtros, idx]);
  const fin = pode('financeiro.ver');
  const r = useMemo(() => resumir(linhas, estado.config, fin), [linhas, estado.config, fin]);
  const [modo, setModo] = useState<'dia' | 'periodo'>('dia');
  const [inicio, setInicio] = useState(somarDias(estado.data, -6));
  const [carregandoPeriodo, setCarregandoPeriodo] = useState(false);
  const [erroPeriodo, setErroPeriodo] = useState<string | null>(null);

  useEffect(() => {
    if (modo !== 'periodo' || inicio > estado.data) return;
    setCarregandoPeriodo(true);
    setErroPeriodo(null);
    garantirPeriodo(inicio, estado.data).catch((e) => setErroPeriodo(mensagemErro(e))).finally(() => setCarregandoPeriodo(false));
  }, [modo, inicio, estado.data, garantirPeriodo]);

  const porFilial = useMemo(() => resumirPorGrupo(linhas, (l) => l.embarque.filial_id, estado.config, fin,
    estado.filtros.filial_id ? [] : estado.cadastros.filiais.filter((f) => f.ativo).map((f) => f.id)), [linhas, estado.config, fin, estado.cadastros.filiais, estado.filtros.filial_id]);
  const porCliente = useMemo(() => resumirPorGrupo(linhas, (l) => l.embarque.cliente_id, estado.config, fin), [linhas, estado.config, fin]);

  const dadosFilial = [...porFilial.entries()].map(([id, x]) => ({ nome: nome(idx.filial, id), ...x }))
    .sort((a, b) => b.total_veiculos - a.total_veiculos || a.nome.localeCompare(b.nome, 'pt-BR'));
  const top10 = [...porCliente.entries()].map(([id, x]) => ({ nome: nome(idx.cliente, id), total: x.total_veiculos }))
    .filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
  const clientesTabela = [...porCliente.entries()].map(([id, x]) => {
    const cli = idx.cliente.get(id);
    return { id, nome: cli?.nome ?? '—', carteira: nome(idx.comercial, cli?.comercial_id, 'Sem carteira'), r: x };
  }).sort((a, b) => b.r.total_veiculos - a.r.total_veiculos || a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <Layout titulo="Dashboard Operacional">
      <BarraFiltros linhas={todas} semBusca extra={
        <div className="campo"><span>Liberação</span>
          <Segmentado rotulo="Filtro por liberação" valor={estado.filtros.status || 'todos'} aoMudar={(v) => definirFiltros({ status: v === 'todos' ? '' : v as never })}
            opcoes={[{ valor: 'todos', rotulo: 'Visão geral' }, { valor: 'liberado', rotulo: 'Liberados' }, { valor: 'suspenso', rotulo: 'Suspensos' }, { valor: 'nao_informado', rotulo: 'Não informado' }]} />
        </div>
      } />

      <div className="grupo-btn" style={{ marginBottom: 12 }}>
        <Segmentado rotulo="Período" valor={modo} aoMudar={setModo} opcoes={[{ valor: 'dia', rotulo: `Dia ${fmtDataCurta(estado.data)}` }, { valor: 'periodo', rotulo: 'Vários dias' }]} />
        {modo === 'periodo' && (
          <label className="campo" style={{ width: 170 }}><span>De</span>
            <input className="entrada" type="date" value={inicio} max={estado.data} onChange={(e) => e.target.value && setInicio(e.target.value)} />
          </label>
        )}
        {modo === 'periodo' && <span className="suave pequeno">até {fmtData(estado.data)} (data operacional selecionada)</span>}
      </div>

      {estado.carregando && !Object.keys(estado.embarques).length ? <Carregando /> : modo === 'periodo' ? (
        <Periodo inicio={inicio} fim={estado.data} carregando={carregandoPeriodo} erro={erroPeriodo} />
      ) : r.lotes === 0 ? (
        <div className="cartao"><EstadoVazio titulo={`Sem posições em ${fmtData(estado.data)}`}><p>Abra as posições do dia na Lista de Fretes ou escolha outra data/filtro.</p></EstadoVazio></div>
      ) : (
        <>
          {r.lotes_suspensos_com_veiculos > 0 && !estado.filtros.status && (
            <div style={{ marginBottom: 12 }}><Alerta tipo="erro"><span><strong>{r.lotes_suspensos_com_veiculos} lote(s) suspenso(s) com veículos</strong> continuam no acompanhamento geral.</span></Alerta></div>
          )}
          <h2 className="sr">Veículos</h2>
          <div className="kpis">
            <Kpi rot="Veículos na porta" val={fmtNum(r.porta)} det={fmtT(r.porta_t)} cor={COR.porta} />
            <Kpi rot="Veículos em trânsito" val={fmtNum(r.transito)} det={fmtT(r.transito_t)} cor={COR.transito} />
            <Kpi rot="Veículos carregados" val={fmtNum(r.carregados)} det={`${fmtT(r.carregado_t)} carregado`} cor={COR.carregados} />
            <Kpi rot="Total operacional" val={fmtNum(r.total_veiculos)} det="soma das posições informadas (não é frota única)" />
            <Kpi rot="Quantidade de lotes" val={fmtNum(r.lotes)} det={`${r.lotes_cadencia_propria} com cadência própria`} />
            <Kpi rot="Meta de veículos por lote" val={fmtNum(estado.config.meta_veiculos_lote_padrao, 1)} det={`padrão · meta total ${fmtNum(r.meta_veiculos, 1)} veículos`} />
          </div>
          <div className="kpis">
            <Kpi rot="Volume disponibilizado (meta)" val={r.disponibilizado_t === null ? 'Sem meta definida' : fmtT(r.disponibilizado_t)} medio={r.disponibilizado_t === null} det="Σ meta de cada lote × capacidade" />
            <Kpi rot="Volume projetado" val={fmtT(r.projetado_t)} destaque det="porta + carregado (sem trânsito)" />
            <Kpi rot="Volume carregado" val={fmtT(r.carregado_t)} det="já carregado no dia" />
            <Kpi rot="Volume em trânsito" val={fmtT(r.transito_t)} det={`potencial com trânsito: ${fmtT(r.potencial_t)}`} />
            <Kpi rot="Aderência" val={r.aderencia_pct === null ? 'Sem meta definida' : fmtPct(r.aderencia_pct)} medio={r.aderencia_pct === null} destaque det="projetado ÷ disponibilizado (sem teto de 100%)" />
          </div>
          {r.lotes_sem_informacao > 0 && <p className="suave pequeno">{r.lotes_sem_informacao} lote(s) com contadores não informados entram com zero nas somas.</p>}

          {fin && r.financeiro && <Financeiro r={r} />}

          <div className="secao-titulo"><h2>Análises</h2><span className="suave pequeno">Mesmos filtros, data e permissões dos cartões acima</span></div>
          <div className="graficos">
            <div className="cartao grafico">
              <h3>Desempenho por filial — veículos</h3>
              <Legenda itens={[['Porta', COR.porta], ['Trânsito', COR.transito], ['Carregados', COR.carregados]]} />
              <ResponsiveContainer width="100%" height={Math.max(180, dadosFilial.length * 34 + 40)}>
                <BarChart data={dadosFilial} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 0 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#4b5563' }} />
                  <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 12, fill: '#374151' }} />
                  <Tooltip formatter={(v, n) => [fmtNum(Number(v)), String(n)]} />
                  <Bar dataKey="porta" name="Porta" stackId="v" fill={COR.porta} stroke="#fff" strokeWidth={2} />
                  <Bar dataKey="transito" name="Trânsito" stackId="v" fill={COR.transito} stroke="#fff" strokeWidth={2} />
                  <Bar dataKey="carregados" name="Carregados" stackId="v" fill={COR.carregados} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="cartao grafico">
              <h3>Meta × projeção por filial (t)</h3>
              <Legenda itens={[['Meta (disponibilizado)', COR.meta], ['Projetado', COR.projetado]]} />
              <ResponsiveContainer width="100%" height={Math.max(180, dadosFilial.length * 40 + 40)}>
                <BarChart data={dadosFilial.map((d) => ({ nome: d.nome, meta: d.disponibilizado_t ?? 0, projetado: d.projetado_t }))} layout="vertical" margin={{ left: 8, right: 40, top: 8, bottom: 0 }} barGap={2}>
                  <CartesianGrid horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 12, fill: '#4b5563' }} tickFormatter={(v) => fmtNum(v)} />
                  <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 12, fill: '#374151' }} />
                  <Tooltip formatter={(v, n) => [fmtT(Number(v)), String(n)]} />
                  <Bar dataKey="meta" name="Meta" fill={COR.meta} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="projetado" name="Projetado" fill={COR.projetado} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="cartao grafico">
              <h3>Distribuição entre porta, trânsito e carregados</h3>
              <Distribuicao r={r} />
            </div>

            <div className="cartao grafico">
              <h3>Top 10 clientes por total operacional</h3>
              {top10.length === 0 ? <p className="suave">Nenhum cliente com veículos.</p> : (
                <ResponsiveContainer width="100%" height={top10.length * 32 + 30}>
                  <BarChart data={top10} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 0 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" width={170} tick={{ fontSize: 11, fill: '#374151' }} tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
                    <Tooltip formatter={(v) => [`${fmtNum(Number(v))} veículos`, 'Total operacional']} />
                    <Bar dataKey="total" fill={COR.porta} radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="total" position="right" style={{ fontSize: 12, fill: '#111827' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="secao-titulo"><h2>Desempenho por filial</h2></div>
          <div className="cartao rolagem-x">
            <table className="tabela">
              <thead><tr><th>Filial</th><th className="n">Lotes</th><th className="n">Porta</th><th className="n">Trânsito</th><th className="n">Carregados</th><th className="n">Total</th><th className="n">Meta (t)</th><th className="n">Projetado (t)</th><th className="n">Aderência</th>{fin && <th className="n">Frete méd. emp.</th>}</tr></thead>
              <tbody>
                {dadosFilial.map((d) => (
                  <tr key={d.nome}><td>{d.nome}</td><td className="n">{d.lotes}</td><td className="n">{d.porta}</td><td className="n">{d.transito}</td><td className="n">{d.carregados}</td>
                    <td className="n"><strong>{d.total_veiculos}</strong></td><td className="n">{d.disponibilizado_t === null ? '—' : fmtNum(d.disponibilizado_t)}</td><td className="n">{fmtNum(d.projetado_t)}</td>
                    <td className="n">{d.aderencia_pct === null ? 'Sem meta' : fmtPct(d.aderencia_pct)}</td>{fin && <td className="n">{fmtReais(d.financeiro?.ticket_empresa)}</td>}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="secao-titulo"><h2>Resumo por cliente e carteira</h2></div>
          <div className="cartao rolagem-x">
            <table className="tabela">
              <thead><tr><th>Cliente</th><th>Carteira</th><th className="n">Lotes</th><th className="n">Porta</th><th className="n">Trânsito</th><th className="n">Carregados</th><th className="n">Total</th><th className="n">Projetado (t)</th>{fin && <th className="n">Frete méd. emp.</th>}</tr></thead>
              <tbody>
                {clientesTabela.map((c) => (
                  <tr key={c.id}><td>{c.nome}</td><td>{c.carteira}</td><td className="n">{c.r.lotes}</td><td className="n">{c.r.porta}</td><td className="n">{c.r.transito}</td><td className="n">{c.r.carregados}</td>
                    <td className="n"><strong>{c.r.total_veiculos}</strong></td><td className="n">{fmtNum(c.r.projetado_t)}</td>{fin && <td className="n">{fmtReais(c.r.financeiro?.ticket_empresa)}</td>}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Layout>
  );
}

function Kpi({ rot, val, det, destaque, medio, cor }: { rot: string; val: string; det?: string; destaque?: boolean; medio?: boolean; cor?: string }) {
  return (
    <div className={`cartao kpi ${destaque ? 'destaque' : ''}`} style={cor ? { borderTop: `4px solid ${cor}` } : undefined}>
      <div className="rot">{rot}</div>
      <div className={`val ${medio ? 'medio' : ''}`}>{val}</div>
      {det && <div className="det">{det}</div>}
    </div>
  );
}

function Legenda({ itens }: { itens: Array<[string, string]> }) {
  return <div className="legenda">{itens.map(([n, c]) => <span key={n}><i style={{ background: c }} />{n}</span>)}</div>;
}

function Distribuicao({ r }: { r: Resumo }) {
  const total = r.total_veiculos || 1;
  const partes: Array<[string, number, string]> = [['Porta', r.porta, COR.porta], ['Trânsito', r.transito, COR.transito], ['Carregados', r.carregados, COR.carregados]];
  return (
    <div>
      <div style={{ display: 'flex', height: 34, borderRadius: 6, overflow: 'hidden', gap: 2, background: '#fff' }} role="img"
        aria-label={partes.map(([n, v]) => `${n} ${v}`).join(', ')}>
        {partes.filter(([, v]) => v > 0).map(([n, v, c]) => (
          <div key={n} title={`${n}: ${v} (${fmtPct((v / total) * 100)})`} style={{ width: `${(v / total) * 100}%`, background: c }} />
        ))}
      </div>
      <table className="tabela" style={{ marginTop: 10 }}>
        <tbody>
          {partes.map(([n, v, c]) => (
            <tr key={n}><td><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 6 }} />{n}</td>
              <td className="n"><strong>{v}</strong> veículos</td><td className="n">{fmtPct((v / total) * 100)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Financeiro({ r }: { r: Resumo }) {
  const { api, estado } = useApp();
  const f = r.financeiro!;
  const [mostrar, setMostrar] = useState(false);
  const [meta, setMeta] = useState<MetaDiaria | null>(null);
  useEffect(() => { api.carregarMeta(estado.demo, estado.data).then(setMeta).catch(() => setMeta(null)); }, [api, estado.demo, estado.data]);
  const exibir = f.valido || mostrar;
  const v = (n: number | null, fmt: (x: number | null) => string) => (exibir ? fmt(n) : 'Não validado');
  return (
    <>
      <div className="secao-titulo">
        <h2>Indicadores financeiros <span className="badge aviso">Estimativa</span></h2>
        <span className="suave pequeno">Metodologia da planilha: tickets por média simples dos fretes numéricos</span>
      </div>
      {!f.valido && (
        <div style={{ marginBottom: 12 }}>
          <Alerta tipo="aviso">
            <div style={{ flex: 1 }}>
              <strong>Projeções financeiras não validadas.</strong> Faturamento = volume (t) × ticket, o que exige frete em R$/t confirmado.
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{f.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
            <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} />Ver estimativa mesmo assim</label>
          </Alerta>
        </div>
      )}
      <div className="kpis">
        <Kpi rot="Ticket médio empresa" val={fmtReais(f.ticket_empresa)} medio det={`${f.lotes_com_frete_empresa} lote(s) com frete numérico`} />
        <Kpi rot="Ticket médio motorista" val={fmtReais(f.ticket_motorista)} medio det={`${f.lotes_com_frete_motorista} lote(s) com frete numérico`} />
        <Kpi rot="Projeção de faturamento" val={v(f.faturamento_projetado, (x) => fmtReais(x, 0))} medio det={meta?.meta_faturamento != null ? `meta do dia ${fmtReais(meta.meta_faturamento, 0)}` : 'sem meta do dia'} />
        <Kpi rot="Projeção de margem bruta" val={v(f.margem_projetada, (x) => fmtReais(x, 0))} medio det={meta?.meta_margem != null ? `meta do dia ${fmtReais(meta.meta_margem, 0)}` : 'sem meta do dia'} />
        <Kpi rot="Margem bruta %" val={f.margem_pct === null ? '—' : v(f.margem_pct, (x) => fmtPct(x))} medio det="1 − ticket motorista ÷ ticket empresa" />
        <Kpi rot="Meta diária de volume" val={meta?.meta_volume_t != null ? fmtT(meta.meta_volume_t) : 'Sem meta'} medio
          det={meta?.meta_volume_t ? `projetado ${fmtPct((r.projetado_t / meta.meta_volume_t) * 100)} da meta` : 'configure em Administração → Metas'} />
      </div>
    </>
  );
}

function Periodo({ inicio, fim, carregando, erro }: { inicio: string; fim: string; carregando: boolean; erro: string | null }) {
  const { estado } = useApp();
  const idx = useIndices();
  const dias = useMemo(() => {
    const out: string[] = [];
    for (let d = inicio; d <= fim && out.length < 62; d = somarDias(d, 1)) out.push(d);
    return out;
  }, [inicio, fim]);
  const porDia = useMemo(() => dias.map((d) => {
    const ls = aplicarFiltros(linhasDaData(estado, d), { ...estado.filtros, busca: '' }, idx);
    return { data: d, rot: fmtDataCurta(d), ...resumir(ls, estado.config, false) };
  }), [dias, estado, idx]);
  const embarques = useMemo(() => {
    const ids = new Set(porDia.length ? aplicarFiltros(Object.values(estado.embarques).map((e) => ({ embarque: e, posicao: null, financeiro: null })), { ...estado.filtros, busca: '', soMovimentacao: false, incluirArquivados: true }, idx).map((l) => l.embarque.id) : []);
    return Object.values(estado.embarques).filter((e) => ids.has(e.id));
  }, [estado.embarques, estado.filtros, idx, porDia.length]);
  const rp = useMemo(() => resumirPeriodo(embarques, Object.values(estado.posicoes), inicio, fim, estado.config), [embarques, estado.posicoes, inicio, fim, estado.config]);

  if (inicio > fim) return <Alerta tipo="aviso">A data inicial deve ser anterior à data final.</Alerta>;
  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (carregando) return <Carregando texto="Carregando posições do período…" />;
  return (
    <>
      <Alerta tipo="info">
        <span>Em vários dias, <strong>porta e trânsito são saldos</strong> (última posição de cada lote no período) e <strong>carregados são acumulados</strong>.
          Os retratos diários não são somados como se fossem veículos únicos.</span>
      </Alerta>
      <div className="kpis" style={{ marginTop: 12 }}>
        <Kpi rot={`Saldo na porta (${fmtDataCurta(fim)})`} val={fmtNum(rp.porta_saldo)} det={fmtT(rp.porta_saldo_t)} cor={COR.porta} />
        <Kpi rot={`Saldo em trânsito (${fmtDataCurta(fim)})`} val={fmtNum(rp.transito_saldo)} det={fmtT(rp.transito_saldo_t)} cor={COR.transito} />
        <Kpi rot="Carregados no período" val={fmtNum(rp.carregados_acumulados)} det={fmtT(rp.carregado_acumulado_t)} cor={COR.carregados} />
        <Kpi rot="Lotes com posição" val={fmtNum(rp.lotes)} det={`${rp.dias} dia(s) com posição`} />
        <Kpi rot="Meta do período" val={rp.meta_periodo_t === null ? 'Sem meta definida' : fmtT(rp.meta_periodo_t)} medio det="Σ metas diárias dos lotes" />
        <Kpi rot="Aderência do carregado" val={rp.aderencia_carregado_pct === null ? 'Sem meta definida' : fmtPct(rp.aderencia_carregado_pct)} medio destaque det="carregado acumulado ÷ meta do período" />
      </div>
      <div className="cartao grafico">
        <h3>Veículos carregados por dia</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={porDia} margin={{ left: 0, right: 8, top: 16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="rot" tick={{ fontSize: 12, fill: '#4b5563' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#4b5563' }} width={36} />
            <Tooltip formatter={(v) => [fmtNum(Number(v)), 'Carregados']} labelFormatter={(l) => `Dia ${l}`} />
            <Bar dataKey="carregados" fill={COR.carregados} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="cartao rolagem-x" style={{ marginTop: 14 }}>
        <table className="tabela">
          <thead><tr><th>Data</th><th className="n">Lotes</th><th className="n">Porta (saldo)</th><th className="n">Trânsito (saldo)</th><th className="n">Carregados (dia)</th><th className="n">Projetado (t)</th><th className="n">Aderência do dia</th></tr></thead>
          <tbody>
            {porDia.map((d) => (
              <tr key={d.data}><td>{fmtData(d.data)}</td><td className="n">{d.lotes}</td><td className="n">{d.porta}</td><td className="n">{d.transito}</td><td className="n">{d.carregados}</td>
                <td className="n">{fmtNum(d.projetado_t)}</td><td className="n">{d.aderencia_pct === null ? '—' : fmtPct(d.aderencia_pct)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
