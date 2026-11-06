// Telas do módulo Industrializado (exclusivo do centro de custo Industrializado, filial Goiânia).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, EstadoVazio, Modal, Segmentado } from '../components/ui';
import { fmtData, fmtDataHora, fmtPct, fmtReais, hojeSP } from '../lib/formato';
import { normalizar } from '../lib/texto';
import type { Permissao } from '../types';
import {
  ChipCanhoto, ChipCombinado, ChipEtapa, ChipNivel, DetalhesViagem, FILIAL_IND, FormViagem, ModalCombinado, ModalMotivo, ModalOcorrencia,
  ParadasTracking, Rota, useExecutar,
} from './componentes';
import { restaurarPrevia, useInd } from './dados';
import {
  alertaCanhoto, alertaCombinado, alertaDescarga, calcularMargem, codigoViagem, pendenciasAvanco, pendenciasEmissao, pendenciasEncerrar,
  PRAZO_CANHOTO_DIAS, proximaEtapa, proximoAgendamento, quadrosPainel, retiradasDoDia, type NivelAlerta, type QuadrosPainel,
} from './regras';
import {
  ETAPAS_FLUXO, ROTULO_ETAPA, ROTULO_OCORRENCIA, ROTULO_SIT_OCORRENCIA, ROTULO_TIPO_CARGA,
  type ClienteInd, type EtapaInd, type OcorrenciaInd, type ViagemInd,
} from './tipos';

/** Atualiza a tela a cada 30 s (alertas de horário). */
function useRelogio() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), 30000); return () => clearInterval(t); }, []);
}

function Pagina({ titulo, permissao = 'ind.pagina', acoes, children }: { titulo: string; permissao?: Permissao; acoes?: ReactNode; children: ReactNode }) {
  const { pode } = useInd();
  useRelogio();
  return (
    <Layout titulo={titulo} aoLadoTitulo={<span className="badge info">{FILIAL_IND}</span>} acoes={acoes}>
      {!pode('ind.pagina') || !pode(permissao) ? <AcessoNegado motivo="Esta tela é do módulo Industrializado. Fale com o administrador se precisar de acesso." /> : children}
    </Layout>
  );
}

const ativa = (v: ViagemInd) => v.etapa !== 'encerrada' && v.etapa !== 'cancelada';

// ===========================================================================
// Painel (torre de controle)
// ===========================================================================
export function PainelInd() {
  const { viagens, ocorrencias, clientePorId, metas, acoes, pode } = useInd();
  const exec = useExecutar();
  const [sel, setSel] = useState<ChaveQuadro | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [modal, setModal] = useState<{ tipo: 'combinado' | 'ocorrencia' | 'emissao'; v: ViagemInd } | null>(null);
  const q = quadrosPainel(viagens, ocorrencias);
  const cont = (vs: ViagemInd[], f: (v: ViagemInd) => NivelAlerta) => {
    const c: Partial<Record<NivelAlerta, number>> = {};
    for (const v of vs) { const n = f(v); c[n] = (c[n] ?? 0) + 1; }
    return c;
  };
  const corContratado = (v: ViagemInd) => alertaCombinado(v).nivel;
  const corTransito = (v: ViagemInd) => alertaDescarga(v).nivel;
  const quadros: Array<{ k: ChaveQuadro; titulo: string; desc: string; vs: ViagemInd[]; cores?: Partial<Record<NivelAlerta, number>>; ordem?: NivelAlerta[] }> = [
    { k: 'disponiveis', titulo: 'Cargas Disponíveis', desc: 'Lançadas e ainda sem placa: disponíveis para contratação', vs: q.disponiveis },
    { k: 'contratados', titulo: 'Veículos Contratados', desc: 'Placa vinculada, indo para o carregamento', vs: q.contratados, cores: cont(q.contratados, corContratado), ordem: ['atraso', 'laranja', 'aviso', 'ok', 'neutro'] },
    { k: 'emissao', titulo: 'Aguardando Emissão', desc: 'Carregados: informar CT-e, MDF-e, NF (e PO quando exigido)', vs: q.emissao },
    { k: 'transito', titulo: 'Veículos em Trânsito', desc: 'Tracking até a chegada no cliente', vs: q.transito, cores: cont(q.transito, corTransito), ordem: ['atraso', 'aviso', 'ok', 'neutro'] },
    { k: 'marcados', titulo: 'Veículos Marcados', desc: 'No local do cliente para descarga', vs: q.marcados },
    { k: 'comOcorrencia', titulo: 'Finalizados com Ocorrência', desc: 'Entregues com ocorrência ainda pendente (sem ocorrência, saem do painel)', vs: q.comOcorrencia },
  ];
  const atual = quadros.find((x) => x.k === sel) ?? null;

  return (
    <Pagina titulo="Painel Industrializado">
      <div className="ind-quadros">
        {quadros.map((x) => {
          const pior = x.ordem?.find((n) => n !== 'neutro' && x.cores?.[n]) ?? (x.vs.length ? 'info' : 'vazio');
          return (
            <button key={x.k} type="button" className={`cartao ind-quadro-btn ${pior}${sel === x.k ? ' selecionado' : ''}`} aria-pressed={sel === x.k} onClick={() => setSel(sel === x.k ? null : x.k)}>
              <span className="rot">{x.titulo}</span>
              <span className="ind-kpi-val num">{x.vs.length}</span>
              {x.ordem ? (
                <span className="ind-cores">{x.ordem.filter((n) => x.cores?.[n]).map((n) => <span key={n} className={`ind-chip ${n}`}>{x.cores![n]} {ROTULO_COR[x.k === 'transito' ? 'transito' : 'contratado'][n]}</span>)}</span>
              ) : <span className="suave pequeno">{x.desc}</span>}
              <span className="ind-entrar">{sel === x.k ? 'Fechar lista' : 'Ver lista →'}</span>
            </button>
          );
        })}
      </div>

      {atual && (
        <section className="cartao ind-lista-quadro">
          <div className="cartao-cab"><div><h2>{atual.titulo} ({atual.vs.length})</h2><div className="suave pequeno">{atual.desc}</div></div>
            <button className="btn sutil peq" onClick={() => setSel(null)}>Fechar</button></div>
          {atual.vs.length === 0 ? <div className="cartao-corpo suave">Nenhuma carga neste quadro.</div> : (
            <div style={{ overflowX: 'auto' }}>
              {atual.k === 'contratados' || atual.k === 'transito' ? (
                (atual.ordem ?? []).filter((n) => atual.cores?.[n]).map((n) => {
                  const vs = atual.vs.filter((v) => (atual.k === 'contratados' ? corContratado(v) : corTransito(v)) === n)
                    .sort((a, b) => (atual.k === 'contratados' ? Date.parse(a.combinado?.para ?? '') - Date.parse(b.combinado?.para ?? '') : Date.parse(alertaDescarga(a).quando ?? '') - Date.parse(alertaDescarga(b).quando ?? '')));
                  return (
                    <div key={n} className={`ind-faixa ${n}`}>
                      <h3><span className={`ind-chip ${n}`}>{ROTULO_COR[atual.k === 'transito' ? 'transito' : 'contratado'][n]}</span> <span className="suave pequeno">{vs.length}</span></h3>
                      <TabelaQuadro k={atual.k} vs={vs} clientePorId={clientePorId} ocorrencias={ocorrencias} abrir={setAberta} acao={(tipo, v) => setModal({ tipo, v })} marcou={(v) => exec(() => acoes.registrarMarcou(v.id), 'Marcação registrada.')} pode={pode} />
                    </div>
                  );
                })
              ) : <TabelaQuadro k={atual.k} vs={atual.vs} clientePorId={clientePorId} ocorrencias={ocorrencias} abrir={setAberta} acao={(tipo, v) => setModal({ tipo, v })} marcou={() => undefined} pode={pode} />}
            </div>
          )}
        </section>
      )}

      <MetaDia viagens={viagens} metas={metas} podeEditar={pode('ind.meta')} definir={(d, n) => exec(() => acoes.definirMeta(d, n), 'Meta salva.')} />

      <p className="suave pequeno" style={{ marginTop: 16 }}>
        Prévia com dados fictícios. <button className="btn sutil peq" onClick={() => restaurarPrevia()}>Restaurar dados da prévia</button>
      </p>
      {modal?.tipo === 'combinado' && <ModalCombinado v={modal.v} aoFechar={() => setModal(null)} />}
      {modal?.tipo === 'ocorrencia' && <ModalOcorrencia v={modal.v} aoFechar={() => setModal(null)} />}
      {modal?.tipo === 'emissao' && <ModalEmissao v={modal.v} aoFechar={() => setModal(null)} />}
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

type ChaveQuadro = keyof QuadrosPainel;
const ROTULO_COR: Record<'contratado' | 'transito', Partial<Record<NivelAlerta, string>>> = {
  contratado: { atraso: 'Atrasados', laranja: 'Até 2 h para marcar', aviso: 'Mais de 2 h para marcar', ok: 'Marcados', neutro: 'Sem combinado' },
  transito: { atraso: 'Descarga hoje', aviso: 'Descarga amanhã', ok: 'Descarga D+2 ou mais', neutro: 'Sem data de descarga' },
};

function TabelaQuadro({ k, vs, clientePorId, ocorrencias, abrir, acao, marcou, pode }: {
  k: ChaveQuadro; vs: ViagemInd[]; clientePorId: Record<string, ClienteInd>; ocorrencias: OcorrenciaInd[];
  abrir: (id: string) => void; acao: (t: 'combinado' | 'ocorrencia' | 'emissao', v: ViagemInd) => void; marcou: (v: ViagemInd) => void; pode: (p: Permissao) => boolean;
}) {
  const cab: Record<ChaveQuadro, string[]> = {
    disponiveis: ['Pedido / veículo', 'Cliente', 'Rota', 'Retirada prevista', 'Lançada'],
    contratados: ['Pedido / veículo', 'Cliente', 'Motorista / placa', 'Combinado', 'Horário', 'Situação'],
    emissao: ['Pedido / veículo', 'Cliente', 'Rota', 'Carregada há', 'PO'],
    transito: ['Pedido / veículo', 'Cliente', 'Motorista / placa', 'Descarga', 'Previsão', 'Situação'],
    marcados: ['Pedido / veículo', 'Cliente', 'Local da descarga', 'Chegou', 'No local há'],
    comOcorrencia: ['Pedido / veículo', 'Cliente', 'Etapa', 'Ocorrências pendentes'],
  };
  const min = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : null);
  const tempo = (m: number | null) => (m === null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
  return (
    <table className="tabela ind-tabela">
      <thead><tr>{cab[k].map((c) => <th key={c}>{c}</th>)}<th /></tr></thead>
      <tbody>{vs.map((v) => {
        const cli = clientePorId[v.cliente_id];
        const via = <td><button className="btn sutil peq" onClick={() => abrir(v.id)}><strong>{v.pedido ?? 'Sem pedido'}</strong></button><div className="suave pequeno">{v.tipo_veiculo || '—'}</div></td>;
        const mot = <td>{v.motorista ?? '—'}<div className="suave pequeno">{[v.placa_cavalo, v.placa_carreta].filter(Boolean).join(' / ')}</div></td>;
        if (k === 'disponiveis') return (
          <tr key={v.id}>{via}<td>{cli?.nome}</td><td><Rota v={v} /></td><td>{v.coleta_prevista ? fmtData(v.coleta_prevista) : '—'}</td><td className="pequeno">{fmtDataHora(v.criado_em)}</td>
            <td>{pode('ind.lancar') && <button className="btn primario peq" onClick={() => abrir(v.id)}>Vincular placa</button>}</td></tr>
        );
        if (k === 'contratados') { const a = alertaCombinado(v); return (
          <tr key={v.id}>{via}<td>{cli?.nome}</td>{mot}<td>{v.combinado?.o_que ?? '—'}<div className="suave pequeno">{ROTULO_ETAPA[v.etapa]}</div></td>
            <td>{v.combinado ? fmtDataHora(v.combinado.para) : '—'}{v.combinado?.marcou_em && <div className="suave pequeno">marcou {fmtDataHora(v.combinado.marcou_em)}</div>}</td>
            <td><ChipNivel nivel={a.nivel}>{a.texto}</ChipNivel></td>
            <td style={{ whiteSpace: 'nowrap' }}>{pode('ind.avancar') && <>
              {v.combinado && !v.combinado.marcou_em && <button className="btn primario peq" onClick={() => marcou(v)}>Marcou</button>}
              <button className="btn peq" style={{ marginLeft: 4 }} onClick={() => acao('combinado', v)}>{v.combinado ? 'Alterar' : 'Combinado'}</button></>}</td></tr>
        ); }
        if (k === 'emissao') { const ini = [...v.historico].reverse().find((h) => h.acao.includes('→ Carregada'))?.em ?? null; return (
          <tr key={v.id}>{via}<td>{cli?.nome}</td><td><Rota v={v} /></td><td>{tempo(min(ini))}</td>
            <td>{cli?.exige_po ? (v.po ?? <span className="ind-falta">exigido</span>) : <span className="suave">não exige</span>}</td>
            <td>{pode('ind.emissao') && <button className="btn primario peq" onClick={() => acao('emissao', v)}>Informar documentos</button>}</td></tr>
        ); }
        if (k === 'transito') { const a = alertaDescarga(v); const p = v.paradas.filter((x) => x.tipo === 'entrega' && x.situacao === 'pendente').sort((x, y) => x.ordem - y.ordem)[0]; return (
          <tr key={v.id}>{via}<td>{cli?.nome}</td>{mot}<td>{p ? `${p.local} (${p.cidade}/${p.uf})` : '—'}{p?.protocolo && <div className="suave pequeno">protocolo {p.protocolo}</div>}</td>
            <td>{a.quando ? fmtDataHora(a.quando) : '—'}</td><td><ChipNivel nivel={a.nivel}>{a.texto}</ChipNivel></td>
            <td>{v.combinado && <ChipCombinado v={v} />}</td></tr>
        ); }
        if (k === 'marcados') { const p = v.paradas.find((x) => x.tipo === 'entrega' && (x.situacao === 'chegou' || x.situacao === 'em_operacao')); return (
          <tr key={v.id}>{via}<td>{cli?.nome}</td><td>{p ? `${p.local} (${p.cidade}/${p.uf})` : '—'}<div className="suave pequeno">{p?.situacao === 'em_operacao' ? 'Descarregando' : 'Aguardando descarga'}</div></td>
            <td>{p?.chegada_em ? fmtDataHora(p.chegada_em) : '—'}</td><td>{tempo(min(p?.chegada_em ?? null))}</td>
            <td>{pode('ind.ocorrencias') && <button className="btn secundario peq" onClick={() => acao('ocorrencia', v)}>Ocorrência</button>}</td></tr>
        ); }
        const pend = ocorrencias.filter((o) => o.viagem_id === v.id && (o.situacao === 'aberta' || o.situacao === 'aprovada'));
        return (
          <tr key={v.id}>{via}<td>{cli?.nome}</td><td><ChipEtapa etapa={v.etapa} /></td>
            <td>{pend.map((o) => <div key={o.id}><span className="mono">{o.codigo}</span> {ROTULO_OCORRENCIA[o.tipo]} · {ROTULO_SIT_OCORRENCIA[o.situacao]} <ChipNivel nivel={o.carga === 'carregado' ? 'aviso' : 'ok'}>{o.carga === 'carregado' ? 'Carregado' : 'Descarregado'}</ChipNivel></div>)}</td><td /></tr>
        );
      })}</tbody>
    </table>
  );
}

function MetaDia({ viagens, metas, podeEditar, definir }: { viagens: ViagemInd[]; metas: Record<string, number>; podeEditar: boolean; definir: (d: string, n: number) => void }) {
  const [data, setData] = useState(hojeSP());
  const meta = metas[data] ?? null;
  const [edit, setEdit] = useState<string | null>(null);
  const r = retiradasDoDia(viagens, data);
  const pct = meta ? (r.retiradas / meta) * 100 : null;
  const cor = pct === null ? 'neutro' : pct <= 60 ? 'atraso' : pct <= 80 ? 'aviso' : 'ok';
  const max = Math.max(meta ?? 0, r.previstas, r.retiradas, 1);
  const barra = (rot: string, n: number, cls: string) => (
    <div className="ind-barra"><span className="ind-barra-rot">{rot}</span><span className="ind-barra-trilho"><span className={`ind-barra-valor ${cls}`} style={{ width: `${(n / max) * 100}%` }} /></span><strong className="num">{n}</strong></div>
  );
  return (
    <section className="cartao" style={{ marginTop: 16 }}>
      <div className="cartao-cab">
        <div><h2>Cargas a retirar no dia × meta</h2><div className="suave pequeno">Pela retirada prevista de cada viagem. Retirada = passou de Carregando.</div></div>
        <input className="entrada" type="date" value={data} onChange={(e) => setData(e.target.value || hojeSP())} style={{ width: 'auto' }} aria-label="Data" />
      </div>
      <div className="cartao-corpo ind-meta">
        <div className="ind-meta-num">
          <div><span className="rot">Meta do dia</span>
            {edit !== null ? (
              <span style={{ display: 'flex', gap: 6 }}><input className="entrada num" type="number" min={0} value={edit} onChange={(e) => setEdit(e.target.value)} style={{ width: 90 }} autoFocus />
                <button className="btn primario peq" onClick={() => { definir(data, Number(edit)); setEdit(null); }}>Salvar</button></span>
            ) : <strong className="ind-kpi-val num">{meta ?? '—'}{podeEditar && <button className="btn sutil peq" onClick={() => setEdit(String(meta ?? ''))}>Alterar</button>}</strong>}
          </div>
          <div><span className="rot">Programadas</span><strong className="ind-kpi-val num">{r.previstas}</strong></div>
          <div><span className="rot">Retiradas</span><strong className="ind-kpi-val num">{r.retiradas}</strong></div>
          <div><span className="rot">Atingido</span><strong className={`ind-kpi-val num ind-txt-${cor}`}>{fmtPct(pct, 0)}</strong>
            <span className="suave pequeno">{meta !== null ? (meta - r.retiradas > 0 ? `faltam ${meta - r.retiradas}` : 'meta batida') : 'sem meta'}</span></div>
        </div>
        <div className="ind-barras">
          {barra('Meta', meta ?? 0, 'meta')}
          {barra('Programadas', r.previstas, 'prog')}
          {barra('Retiradas', r.retiradas, cor)}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Viagens (lista agrupada por cliente)
// ===========================================================================
export function ViagensInd() {
  const { viagens, ocorrencias, clientes, clientePorId, pode } = useInd();
  const [busca, setBusca] = useState('');
  const [etapa, setEtapa] = useState<'' | EtapaInd>('');
  const [vista, setVista] = useState<'andamento' | 'todas'>('andamento');
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const q = normalizar(busca.trim());
  const lista = viagens
    .filter((v) => (vista === 'andamento' ? ativa(v) : true))
    .filter((v) => !etapa || v.etapa === etapa)
    .filter((v) => !q || normalizar([codigoViagem(v.codigo), clientePorId[v.cliente_id]?.nome, v.pedido, v.po, v.motorista, v.placa_cavalo, v.cte, v.nfs, ...v.paradas.map((p) => `${p.local} ${p.cidade}`)].join(' ')).includes(q))
    .sort((a, b) => b.codigo - a.codigo);
  const grupos = clientes.map((c) => ({ c, vs: lista.filter((v) => v.cliente_id === c.id) })).filter((g) => g.vs.length);
  const verValor = pode('ind.financeiro');

  return (
    <Pagina titulo="Viagens" acoes={pode('ind.lancar') ? <button className="btn primario" onClick={() => setNova(true)}>+ Lançar viagem</button> : undefined}>
      <div className="ind-filtros">
        <input className="entrada" placeholder="Buscar viagem, pedido, PO, motorista, placa, NF, cidade…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="entrada" value={etapa} onChange={(e) => setEtapa(e.target.value as EtapaInd | '')} aria-label="Etapa">
          <option value="">Todas as etapas</option>
          {[...ETAPAS_FLUXO, 'cancelada' as const].map((e) => <option key={e} value={e}>{ROTULO_ETAPA[e]}</option>)}
        </select>
        <Segmentado rotulo="Mostrar" valor={vista} aoMudar={setVista} opcoes={[{ valor: 'andamento', rotulo: 'Em andamento' }, { valor: 'todas', rotulo: 'Todas' }]} />
      </div>
      {grupos.length === 0 ? <EstadoVazio titulo="Nenhuma viagem encontrada" /> : (
        <div className="cartao" style={{ overflowX: 'auto' }}>
          <table className="tabela ind-tabela">
            <thead><tr><th>Viagem</th><th>Etapa</th><th>Rota</th><th>Próximo agendamento</th><th>Motorista / placa</th><th>Docs</th><th>Tracking</th>{verValor && <th className="n">Margem</th>}</tr></thead>
            <tbody>
              {grupos.map(({ c, vs }) => [
                <tr key={c.id} className="ind-grupo"><td colSpan={verValor ? 8 : 7}>{c.nome} <span className="suave pequeno">· {vs.length} {vs.length === 1 ? 'viagem' : 'viagens'}</span></td></tr>,
                ...vs.map((v) => {
                  const ag = proximoAgendamento(v);
                  const m = calcularMargem(v, ocorrencias);
                  return (
                    <tr key={v.id} className="clicavel" onClick={() => setAberta(v.id)}>
                      <td><strong>{codigoViagem(v.codigo)}</strong><div className="suave pequeno">{ROTULO_TIPO_CARGA[v.tipo_carga]}{v.pedido ? ` · ${v.pedido}` : ''}{v.reversa_de ? ' · reversa' : ''}</div></td>
                      <td><ChipEtapa etapa={v.etapa} /></td>
                      <td><Rota v={v} /></td>
                      <td>{ag ? <>{fmtDataHora(ag.agendado_para)}<div className="suave pequeno">{ag.local}{ag.protocolo ? ` · ${ag.protocolo}` : ''}</div></> : <span className="suave">—</span>}</td>
                      <td>{v.motorista ?? <span className="ind-falta">a contratar</span>}<div className="suave pequeno">{v.placa_cavalo ?? ''}</div></td>
                      <td className="pequeno">{v.cte ? `CT-e ${v.cte}` : '—'}{clientePorId[v.cliente_id]?.exige_po && <div>{v.po ? `PO ${v.po}` : ETAPAS_FLUXO.indexOf(v.etapa) >= ETAPAS_FLUXO.indexOf('carregada') ? <span className="ind-falta">PO pendente</span> : <span className="suave">PO após carregar</span>}</div>}</td>
                      <td><ChipCombinado v={v} /></td>
                      {verValor && <td className="n"><span className={m.abaixoMeta ? 'ind-ruim' : ''}>{fmtPct(m.pct)}</span><div className="suave pequeno">{fmtReais(m.margem, 0)}</div></td>}
                    </tr>
                  );
                }),
              ])}
            </tbody>
          </table>
        </div>
      )}
      {nova && <FormViagem aoFechar={() => setNova(false)} aoSalvar={(v) => setAberta(v.id)} />}
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

// ===========================================================================
// Controle diário + tracking (mesma tela)
// ===========================================================================
const COLUNAS: EtapaInd[] = ['lancada', 'contratado', 'coleta_agendada', 'carregando', 'carregada', 'documentada', 'transito', 'entregas'];

export function ControleInd() {
  const { viagens, clientePorId, acoes, ocorrencias, pode } = useInd();
  const exec = useExecutar();
  const [aberta, setAberta] = useState<string | null>(null);
  const [modal, setModal] = useState<{ tipo: 'combinado' | 'ocorrencia'; v: ViagemInd } | null>(null);
  const [soAlerta, setSoAlerta] = useState(false);
  const abertas = viagens.filter((v) => COLUNAS.includes(v.etapa))
    .filter((v) => !soAlerta || ['aviso', 'atraso'].includes(alertaCombinado(v).nivel));
  const alertas = viagens.filter((v) => COLUNAS.includes(v.etapa) && ['aviso', 'atraso'].includes(alertaCombinado(v).nivel)).length;

  return (
    <Pagina titulo="Controle diário e tracking">
      <div className="ind-filtros">
        <Segmentado rotulo="Mostrar" valor={soAlerta ? 'alerta' : 'todas'} aoMudar={(x) => setSoAlerta(x === 'alerta')}
          opcoes={[{ valor: 'todas', rotulo: 'Todas' }, { valor: 'alerta', rotulo: `Em alerta (${alertas})` }]} />
        <span className="suave pequeno">Combinado com o motorista: <ChipNivel nivel="aviso">1 h antes sem marcar</ChipNivel> <ChipNivel nivel="atraso">passou do horário</ChipNivel> <ChipNivel nivel="ok">marcou</ChipNivel></span>
      </div>
      <div className="ind-kanban">
        {COLUNAS.map((col) => {
          const vs = abertas.filter((v) => v.etapa === col);
          return (
            <section key={col} className="ind-coluna">
              <h2>{ROTULO_ETAPA[col]} <span className="num">{vs.length}</span></h2>
              {vs.map((v) => {
                const prox = proximaEtapa(v.etapa);
                const pend = pendenciasAvanco(v, clientePorId[v.cliente_id], ocorrencias);
                const a = alertaCombinado(v);
                return (
                  <article key={v.id} className={`ind-card ${a.nivel}`}>
                    <button className="ind-card-cab" onClick={() => setAberta(v.id)}>
                      <strong>{codigoViagem(v.codigo)}</strong><span className="suave">{clientePorId[v.cliente_id]?.nome}</span>
                    </button>
                    <div className="pequeno"><Rota v={v} /></div>
                    <div className="pequeno">{v.motorista ?? <span className="ind-falta">sem motorista</span>}{v.placa_cavalo ? ` · ${v.placa_cavalo}` : ''}</div>
                    {v.combinado && <div><ChipCombinado v={v} /></div>}
                    {(col === 'carregando' || col === 'transito' || col === 'entregas' || col === 'coleta_agendada') && <ParadasTracking v={v} compacto />}
                    {col === 'carregada' && <div className="pequeno suave">Aguardando a Emissão{v.emissao_assumida_por ? ` · com ${v.emissao_assumida_por}` : ''}</div>}
                    <div className="ind-card-botoes">
                      {pode('ind.avancar') && prox && col !== 'carregada' && (
                        <button className="btn primario peq" disabled={pend.length > 0} title={pend.length ? pend.join('\n') : `Avançar para ${ROTULO_ETAPA[prox]}`}
                          onClick={() => exec(() => acoes.avancar(v.id), `${codigoViagem(v.codigo)} em ${ROTULO_ETAPA[prox]}.`)}>Avançar</button>
                      )}
                      {pode('ind.avancar') && <button className="btn peq" onClick={() => setModal({ tipo: 'combinado', v })}>Combinado</button>}
                      {pode('ind.avancar') && v.combinado && !v.combinado.marcou_em && <button className="btn peq" onClick={() => exec(() => acoes.registrarMarcou(v.id), 'Marcação registrada.')}>Marcou</button>}
                      {col === 'entregas' && pode('ind.ocorrencias') && <button className="btn peq secundario" onClick={() => setModal({ tipo: 'ocorrencia', v })}>Ocorrência</button>}
                    </div>
                    {pend.length > 0 && col !== 'carregada' && <div className="ind-pend pequeno">{pend[0]}</div>}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      {modal?.tipo === 'combinado' && <ModalCombinado v={modal.v} aoFechar={() => setModal(null)} />}
      {modal?.tipo === 'ocorrencia' && <ModalOcorrencia v={modal.v} aoFechar={() => setModal(null)} />}
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

// ===========================================================================
// Emissão do Industrializado (fila própria, fora do Apoio Operacional)
// ===========================================================================
export function EmissaoInd() {
  const { viagens, clientePorId, acoes } = useInd();
  const exec = useExecutar();
  const [atender, setAtender] = useState<ViagemInd | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const fila = viagens.filter((v) => v.etapa === 'carregada').sort((a, b) => Date.parse(lastAt(a)) - Date.parse(lastAt(b)));
  const liberadas = viagens.filter((v) => v.cte && v.historico.some((h) => h.acao.startsWith('Documentos liberados'))).slice(-8).reverse();

  return (
    <Pagina titulo="Emissão Industrializado" permissao="ind.emissao">
      <Alerta tipo="info">Fila exclusiva do Industrializado: entra toda viagem carregada. Não passa pelo Apoio Operacional.</Alerta>
      <div className="cartao" style={{ marginTop: 12, overflowX: 'auto' }}>
        <div className="cartao-cab"><h2>Aguardando emissão ({fila.length})</h2></div>
        {fila.length === 0 ? <div className="cartao-corpo suave">Nenhuma viagem aguardando.</div> : (
          <table className="tabela">
            <thead><tr><th>Viagem</th><th>Cliente</th><th>Rota</th><th>Carregada há</th><th>PO</th><th>Responsável</th><th /></tr></thead>
            <tbody>{fila.map((v) => {
              const cli = clientePorId[v.cliente_id];
              const min = Math.round((Date.now() - Date.parse(lastAt(v))) / 60000);
              return (
                <tr key={v.id}>
                  <td><button className="btn sutil peq" onClick={() => setAberta(v.id)}><strong>{codigoViagem(v.codigo)}</strong></button></td>
                  <td>{cli?.nome}</td><td><Rota v={v} /></td>
                  <td><ChipNivel nivel={min > 40 ? 'atraso' : min > 20 ? 'aviso' : 'ok'}>{min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`}</ChipNivel></td>
                  <td>{cli?.exige_po ? (v.po ?? <span className="ind-falta">exigido</span>) : <span className="suave">—</span>}</td>
                  <td>{v.emissao_assumida_por ?? <span className="suave">livre</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!v.emissao_assumida_por && <button className="btn peq" onClick={() => exec(() => acoes.assumirEmissao(v.id), 'Emissão assumida.')}>Assumir</button>}
                    <button className="btn primario peq" style={{ marginLeft: 6 }} onClick={() => setAtender(v)}>Informar documentos</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      <div className="cartao" style={{ marginTop: 12, overflowX: 'auto' }}>
        <div className="cartao-cab"><h2>Liberadas recentemente</h2></div>
        <table className="tabela">
          <thead><tr><th>Viagem</th><th>Cliente</th><th>CT-e</th><th>MDF-e</th><th>NF</th><th>Emitido por</th></tr></thead>
          <tbody>{liberadas.map((v) => (
            <tr key={v.id}><td>{codigoViagem(v.codigo)}</td><td>{clientePorId[v.cliente_id]?.nome}</td><td>{v.cte}</td><td>{v.mdfe ?? '—'}</td><td>{v.nfs}</td><td>{v.emissao_assumida_por ?? '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {atender && <ModalEmissao v={atender} aoFechar={() => setAtender(null)} />}
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}
const lastAt = (v: ViagemInd) => [...v.historico].reverse().find((h) => h.acao.includes('→ Carregada'))?.em ?? v.criado_em;

function ModalEmissao({ v, aoFechar }: { v: ViagemInd; aoFechar: () => void }) {
  const { acoes, clientePorId } = useInd();
  const exec = useExecutar();
  const cli = clientePorId[v.cliente_id];
  const nfsParadas = v.paradas.map((p) => p.nfs).filter(Boolean).join(', ');
  const [d, setD] = useState({ cte: v.cte ?? '', mdfe: v.mdfe ?? '', nfs: v.nfs ?? nfsParadas, po: v.po ?? '' });
  const pend = pendenciasEmissao(v, cli, d);
  return (
    <Modal titulo={`Documentos · ${codigoViagem(v.codigo)}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" disabled={pend.length > 0} title={pend.join('\n')} onClick={() => exec(() => acoes.liberarEmissao(v.id, d), 'Documentos liberados. Viagem documentada.') && aoFechar()}>Liberar documentos</button>
    </>}>
      <p style={{ marginTop: 0 }}>{cli?.nome} · <Rota v={v} /></p>
      <div className="grade-campos">
        <label className="campo"><span>CT-e</span><input className="entrada" value={d.cte} onChange={(e) => setD({ ...d, cte: e.target.value })} /></label>
        <label className="campo"><span>MDF-e (opcional)</span><input className="entrada" value={d.mdfe} onChange={(e) => setD({ ...d, mdfe: e.target.value })} /></label>
        <label className="campo"><span>NFs</span><input className="entrada" value={d.nfs} onChange={(e) => setD({ ...d, nfs: e.target.value })} /></label>
        {cli?.exige_po && <label className="campo"><span>PO (obrigatório para {cli.nome})</span><input className="entrada" value={d.po} onChange={(e) => setD({ ...d, po: e.target.value })} /></label>}
      </div>
      {pend.length > 0 && <p className="ind-pend pequeno">{pend.join(' · ')}</p>}
    </Modal>
  );
}

// ===========================================================================
// Ocorrências (separadas por nível de atenção)
// ===========================================================================
export function OcorrenciasInd() {
  const { ocorrencias, viagens, clientePorId, acoes, pode } = useInd();
  const exec = useExecutar();
  const [vista, setVista] = useState<'abertas' | 'todas'>('abertas');
  const [aprovar, setAprovar] = useState<OcorrenciaInd | null>(null);
  const [cancelar, setCancelar] = useState<OcorrenciaInd | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const lista = ocorrencias.filter((o) => (vista === 'abertas' ? o.situacao === 'aberta' || o.situacao === 'aprovada' : true)).sort((a, b) => b.codigo.localeCompare(a.codigo));
  const verValor = pode('ind.financeiro') || pode('ind.ocorrencias_aprovar');
  const tabela = (os: OcorrenciaInd[]) => os.length === 0 ? <div className="cartao-corpo suave">Nenhuma.</div> : (
    <table className="tabela">
      <thead><tr><th>ID</th><th>Tipo</th><th>Viagem</th><th>Entrega</th><th>Descrição</th><th>Aberta</th>{verValor && <><th className="n">Motorista</th><th className="n">Cliente</th></>}<th>Situação</th><th /></tr></thead>
      <tbody>{os.map((o) => {
        const v = viagens.find((x) => x.id === o.viagem_id);
        const p = v?.paradas.find((x) => x.id === o.parada_id);
        return (
          <tr key={o.id}>
            <td className="mono"><strong>{o.codigo}</strong></td>
            <td>{ROTULO_OCORRENCIA[o.tipo]}{o.avaria && <div><span className="badge suspenso">Avaria</span></div>}</td>
            <td>{v && <button className="btn sutil peq" onClick={() => setAberta(v.id)}>{codigoViagem(v.codigo)}</button>}<div className="suave pequeno">{v ? clientePorId[v.cliente_id]?.nome : ''}</div></td>
            <td className="pequeno">{p ? `${p.local} (${p.cidade}/${p.uf})` : '—'}</td>
            <td className="pequeno" style={{ maxWidth: 260 }}>{o.descricao}</td>
            <td className="pequeno">{fmtDataHora(o.aberta_em)}<div className="suave">{o.aberta_por}</div></td>
            {verValor && <><td className="n">{fmtReais(o.valor_motorista)}</td><td className="n">{fmtReais(o.valor_cliente)}</td></>}
            <td>{ROTULO_SIT_OCORRENCIA[o.situacao]}{o.aprovada_por && <div className="suave pequeno">por {o.aprovada_por}</div>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {pode('ind.ocorrencias_aprovar') && o.situacao === 'aberta' && <button className="btn primario peq" onClick={() => setAprovar(o)}>Aprovar</button>}
              {pode('ind.ocorrencias_aprovar') && o.situacao === 'aprovada' && <button className="btn peq" onClick={() => exec(() => acoes.pagarOcorrencia(o.id), 'Pagamento registrado.')}>Paga ao motorista</button>}
              {pode('ind.ocorrencias_aprovar') && (o.situacao === 'aberta' || o.situacao === 'aprovada') && <button className="btn sutil peq" onClick={() => setCancelar(o)}>Cancelar</button>}
            </td>
          </tr>
        );
      })}</tbody>
    </table>
  );
  const carregado = lista.filter((o) => o.carga === 'carregado');
  const descarregado = lista.filter((o) => o.carga === 'descarregado');
  return (
    <Pagina titulo="Ocorrências de descarga">
      <div className="ind-filtros">
        <Segmentado rotulo="Mostrar" valor={vista} aoMudar={setVista} opcoes={[{ valor: 'abertas', rotulo: 'Pendentes' }, { valor: 'todas', rotulo: 'Todas' }]} />
        <span className="suave pequeno">Para abrir: botão Ocorrência na carga em Em entregas (Controle diário) ou no detalhe da viagem.</span>
      </div>
      <section className="cartao ind-nivel aviso" style={{ overflowX: 'auto' }}>
        <div className="cartao-cab"><h2>Carregado · atenção maior ({carregado.length})</h2><span className="suave pequeno">Mercadoria ainda no veículo</span></div>
        {tabela(carregado)}
      </section>
      <section className="cartao ind-nivel ok" style={{ marginTop: 12, overflowX: 'auto' }}>
        <div className="cartao-cab"><h2>Descarregado ({descarregado.length})</h2><span className="suave pequeno">Mercadoria já entregue</span></div>
        {tabela(descarregado)}
      </section>
      {aprovar && <ModalAprovar o={aprovar} aoFechar={() => setAprovar(null)} />}
      {cancelar && <ModalMotivo titulo={`Cancelar ${cancelar.codigo}`} texto="A ocorrência sai da margem e da fila." botao="Cancelar ocorrência"
        aoConfirmar={(m) => exec(() => acoes.cancelarOcorrencia(cancelar.id, m), 'Ocorrência cancelada.')} aoFechar={() => setCancelar(null)} />}
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

function ModalAprovar({ o, aoFechar }: { o: OcorrenciaInd; aoFechar: () => void }) {
  const { acoes } = useInd();
  const exec = useExecutar();
  const [vm, setVm] = useState(o.valor_motorista);
  const [vc, setVc] = useState(o.valor_cliente);
  return (
    <Modal titulo={`Aprovar ${o.codigo}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" onClick={() => exec(() => acoes.aprovarOcorrencia(o.id, { valor_motorista: vm, valor_cliente: vc }), 'Ocorrência aprovada.') && aoFechar()}>Aprovar</button>
    </>}>
      <p style={{ marginTop: 0 }}>{ROTULO_OCORRENCIA[o.tipo]} · {o.descricao}</p>
      <div className="grade-campos">
        <label className="campo"><span>A pagar ao motorista (R$)</span><input className="entrada num" type="number" min={0} step="0.01" value={vm} onChange={(e) => setVm(Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="campo"><span>A cobrar do cliente (R$)</span><input className="entrada num" type="number" min={0} step="0.01" value={vc} onChange={(e) => setVc(Math.max(0, Number(e.target.value) || 0))} /></label>
      </div>
      <p className="suave pequeno">Aprovada, entra na margem final da carga.</p>
    </Modal>
  );
}

// ===========================================================================
// Pós-entrega (canhoto, comprovante, encerramento, reversa)
// ===========================================================================
export function PosEntregaInd() {
  const { viagens, ocorrencias, clientePorId, acoes, pode } = useInd();
  const exec = useExecutar();
  const [aberta, setAberta] = useState<string | null>(null);
  const lista = useMemo(() => viagens.filter((v) => v.etapa === 'entregue')
    .sort((a, b) => (alertaCanhoto(b).dias ?? 0) - (alertaCanhoto(a).dias ?? 0)), [viagens]);
  const vencidos = lista.filter((v) => alertaCanhoto(v).nivel === 'atraso').length;
  return (
    <Pagina titulo="Pós-entrega">
      {vencidos > 0 && <Alerta tipo="erro"><strong>{vencidos} {vencidos === 1 ? 'canhoto passou' : 'canhotos passaram'} de {PRAZO_CANHOTO_DIAS} dias.</strong> Cobrar do motorista ou do cliente.</Alerta>}
      <div className="cartao" style={{ marginTop: 12, overflowX: 'auto' }}>
        <div className="cartao-cab"><h2>Entregues aguardando encerramento ({lista.length})</h2><span className="suave pequeno">Encerra com canhoto físico, comprovante conferido e nenhuma ocorrência aberta</span></div>
        {lista.length === 0 ? <div className="cartao-corpo suave">Nada pendente.</div> : (
          <table className="tabela">
            <thead><tr><th>Viagem</th><th>Entregue</th><th>Canhoto digital</th><th>Canhoto físico</th><th>Comprovante</th><th>Ocorrências</th>{pode('ind.financeiro') && <th className="n">Margem</th>}<th /></tr></thead>
            <tbody>{lista.map((v) => {
              const pend = pendenciasEncerrar(v, ocorrencias);
              const ocs = ocorrencias.filter((o) => o.viagem_id === v.id && o.situacao === 'aberta').length;
              const m = calcularMargem(v, ocorrencias);
              const pp = pode('ind.pos_entrega');
              return (
                <tr key={v.id}>
                  <td><button className="btn sutil peq" onClick={() => setAberta(v.id)}><strong>{codigoViagem(v.codigo)}</strong></button><div className="suave pequeno">{clientePorId[v.cliente_id]?.nome}</div></td>
                  <td className="pequeno">{fmtDataHora(v.entregue_em)}</td>
                  <td>{v.canhoto_digital_em ? <ChipNivel nivel="ok">Recebido</ChipNivel> : pp ? <button className="btn peq" onClick={() => exec(() => acoes.registrarCanhoto(v.id, 'digital'))}>Recebi</button> : '—'}</td>
                  <td>{v.canhoto_fisico_em ? <ChipNivel nivel="ok">Recebido</ChipNivel> : <><ChipCanhoto v={v} />{pp && <div><button className="btn peq" style={{ marginTop: 4 }} onClick={() => exec(() => acoes.registrarCanhoto(v.id, 'fisico'))}>Recebi</button></div>}</>}</td>
                  <td>{v.comprovante_ok_em ? <ChipNivel nivel="ok">Conferido</ChipNivel> : pp ? <button className="btn peq" onClick={() => exec(() => acoes.conferirComprovante(v.id))}>Conferir</button> : '—'}</td>
                  <td>{ocs ? <ChipNivel nivel="aviso">{ocs} aberta{ocs > 1 ? 's' : ''}</ChipNivel> : <span className="suave">—</span>}</td>
                  {pode('ind.financeiro') && <td className="n"><span className={m.abaixoMeta ? 'ind-ruim' : ''}>{fmtPct(m.pct)}</span><div className="suave pequeno">{fmtReais(m.margem, 0)}</div></td>}
                  <td>{pp && <button className="btn primario peq" disabled={pend.length > 0} title={pend.join('\n')} onClick={() => exec(() => acoes.encerrar(v.id), 'Viagem encerrada.')}>Encerrar</button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

// ===========================================================================
// Clientes do Industrializado (lista independente)
// ===========================================================================
export function ClientesInd() {
  const { clientes, viagens, pode } = useInd();
  const [editar, setEditar] = useState<ClienteInd | 'novo' | null>(null);
  return (
    <Pagina titulo="Clientes Industrializado" acoes={pode('ind.clientes') ? <button className="btn primario" onClick={() => setEditar('novo')}>+ Cliente</button> : undefined}>
      <Alerta tipo="info">Lista própria do Industrializado, separada dos clientes dos outros centros de custo.</Alerta>
      <div className="cartao" style={{ marginTop: 12, overflowX: 'auto' }}>
        <table className="tabela">
          <thead><tr><th>Cliente</th><th>CNPJ</th><th>Contato</th><th>Exige agendamento</th><th>Exige PO após carregar</th><th className="n">Viagens</th><th /></tr></thead>
          <tbody>{clientes.map((c) => (
            <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.55 }}>
              <td><strong>{c.nome}</strong>{!c.ativo && <span className="suave pequeno"> · inativo</span>}</td><td className="mono">{c.cnpj ?? '—'}</td>
              <td>{c.contato ?? '—'}{c.telefone ? <div className="suave pequeno">{c.telefone}</div> : null}</td>
              <td>{c.exige_agendamento ? 'Sim' : 'Não'}</td><td>{c.exige_po ? 'Sim' : 'Não'}</td>
              <td className="n">{viagens.filter((v) => v.cliente_id === c.id).length}</td>
              <td>{pode('ind.clientes') && <button className="btn peq" onClick={() => setEditar(c)}>Editar</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {editar && <FormCliente c={editar === 'novo' ? undefined : editar} aoFechar={() => setEditar(null)} />}
    </Pagina>
  );
}

function FormCliente({ c, aoFechar }: { c?: ClienteInd; aoFechar: () => void }) {
  const { acoes } = useInd();
  const exec = useExecutar();
  const [d, setD] = useState<Omit<ClienteInd, 'id'>>(c ?? { nome: '', cnpj: null, contato: null, telefone: null, exige_agendamento: false, exige_po: false, ativo: true });
  return (
    <Modal titulo={c ? `Editar ${c.nome}` : 'Novo cliente'} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" onClick={() => exec(() => acoes.salvarCliente({ ...d, id: c?.id }), 'Cliente salvo.') && aoFechar()}>Salvar</button>
    </>}>
      <div className="grade-campos">
        <label className="campo"><span>Nome</span><input className="entrada" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} /></label>
        <label className="campo"><span>CNPJ</span><input className="entrada" value={d.cnpj ?? ''} onChange={(e) => setD({ ...d, cnpj: e.target.value || null })} /></label>
        <label className="campo"><span>Contato</span><input className="entrada" value={d.contato ?? ''} onChange={(e) => setD({ ...d, contato: e.target.value || null })} /></label>
        <label className="campo"><span>Telefone</span><input className="entrada" value={d.telefone ?? ''} onChange={(e) => setD({ ...d, telefone: e.target.value || null })} /></label>
      </div>
      <label className="ind-check"><input type="checkbox" checked={d.exige_agendamento} onChange={(e) => setD({ ...d, exige_agendamento: e.target.checked })} /> Exige agendamento (padrão das paradas novas)</label>
      <label className="ind-check"><input type="checkbox" checked={d.exige_po} onChange={(e) => setD({ ...d, exige_po: e.target.checked })} /> Exige PO depois que o veículo carrega</label>
      <label className="ind-check"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>
    </Modal>
  );
}
