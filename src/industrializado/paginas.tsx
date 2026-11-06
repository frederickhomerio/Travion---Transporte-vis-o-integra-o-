// Telas do módulo Industrializado (exclusivo do centro de custo Industrializado, filial Goiânia).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, EstadoVazio, Modal, Segmentado } from '../components/ui';
import { fmtDataHora, fmtPct, fmtReais } from '../lib/formato';
import { normalizar } from '../lib/texto';
import type { Permissao } from '../types';
import {
  ChipCanhoto, ChipCombinado, ChipEtapa, ChipNivel, DetalhesViagem, FILIAL_IND, FormViagem, ModalCombinado, ModalMotivo, ModalOcorrencia,
  ParadasTracking, Rota, useExecutar,
} from './componentes';
import { restaurarPrevia, useInd } from './dados';
import {
  alertaCanhoto, alertaCombinado, calcularMargem, codigoViagem, META_MARGEM_PCT, pendenciasAvanco, pendenciasEmissao, pendenciasEncerrar,
  PRAZO_CANHOTO_DIAS, proximaEtapa, proximoAgendamento,
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
  const { viagens, ocorrencias, clientePorId, pode } = useInd();
  const [aberta, setAberta] = useState<string | null>(null);
  const abertas = viagens.filter(ativa);
  const combinados = abertas.filter((v) => ['aviso', 'atraso'].includes(alertaCombinado(v).nivel))
    .sort((a, b) => (alertaCombinado(a).minutos ?? 0) - (alertaCombinado(b).minutos ?? 0));
  const ocAbertas = ocorrencias.filter((o) => o.situacao === 'aberta');
  const ocCarregado = ocAbertas.filter((o) => o.carga === 'carregado');
  const canhotos = viagens.filter((v) => v.etapa === 'entregue' && alertaCanhoto(v).nivel === 'atraso');
  const hoje = new Date().toDateString();
  const agendaHoje = abertas.flatMap((v) => v.paradas.filter((p) => p.agendado_para && new Date(p.agendado_para).toDateString() === hoje && p.situacao !== 'concluida').map((p) => ({ v, p })))
    .sort((a, b) => Date.parse(a.p.agendado_para!) - Date.parse(b.p.agendado_para!));
  const emissao = viagens.filter((v) => v.etapa === 'carregada');
  const comMargem = viagens.filter((v) => v.etapa === 'entregue' || v.etapa === 'encerrada');
  const tot = comMargem.reduce((a, v) => { const m = calcularMargem(v, ocorrencias); return { r: a.r + m.receita, d: a.d + m.despesa }; }, { r: 0, d: 0 });
  const pct = tot.r > 0 ? ((tot.r - tot.d) / tot.r) * 100 : null;
  const abaixo = comMargem.filter((v) => calcularMargem(v, ocorrencias).abaixoMeta);

  return (
    <Pagina titulo="Painel Industrializado">
      <div className="kpis">
        <Kpi rot="Viagens em andamento" val={abertas.length} />
        <Kpi rot="Combinados em alerta" val={combinados.length} nivel={combinados.some((v) => alertaCombinado(v).nivel === 'atraso') ? 'atraso' : combinados.length ? 'aviso' : 'ok'} />
        <Kpi rot="Aguardando emissão" val={emissao.length} nivel={emissao.length ? 'aviso' : 'ok'} />
        <Kpi rot="Ocorrências com carga no veículo" val={ocCarregado.length} nivel={ocCarregado.length ? 'aviso' : 'ok'} />
        <Kpi rot={`Canhotos com mais de ${PRAZO_CANHOTO_DIAS} dias`} val={canhotos.length} nivel={canhotos.length ? 'atraso' : 'ok'} />
        {pode('ind.financeiro') && <Kpi rot="Margem das entregues" val={fmtPct(pct)} sub={`meta ${META_MARGEM_PCT}% · ${fmtReais(tot.r - tot.d, 0)}`} nivel={pct !== null && pct < META_MARGEM_PCT ? 'atraso' : 'ok'} />}
      </div>

      <div className="ind-grade2">
        <Quadro titulo="Combinados com motorista em alerta" vazio="Nenhum combinado em alerta.">
          {combinados.map((v) => (
            <button key={v.id} className="ind-item" onClick={() => setAberta(v.id)}>
              <span><strong>{codigoViagem(v.codigo)}</strong> {clientePorId[v.cliente_id]?.nome} · {v.motorista}</span>
              <ChipCombinado v={v} />
            </button>
          ))}
        </Quadro>
        <Quadro titulo="Agendamentos de hoje" vazio="Nenhum agendamento para hoje.">
          {agendaHoje.map(({ v, p }) => (
            <button key={p.id} className="ind-item" onClick={() => setAberta(v.id)}>
              <span><strong>{new Date(p.agendado_para!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong> {p.tipo === 'coleta' ? 'Coleta' : 'Entrega'} · {p.local} ({p.cidade}/{p.uf})</span>
              <span className="suave pequeno">{codigoViagem(v.codigo)}{p.protocolo ? ` · ${p.protocolo}` : ''}</span>
            </button>
          ))}
        </Quadro>
        <Quadro titulo="Ocorrências abertas" vazio="Nenhuma ocorrência aberta.">
          {[...ocCarregado, ...ocAbertas.filter((o) => o.carga === 'descarregado')].map((o) => {
            const v = viagens.find((x) => x.id === o.viagem_id);
            return (
              <button key={o.id} className="ind-item" onClick={() => v && setAberta(v.id)}>
                <span><strong className="mono">{o.codigo}</strong> {ROTULO_OCORRENCIA[o.tipo]} · {v ? codigoViagem(v.codigo) : ''} {v ? clientePorId[v.cliente_id]?.nome : ''}</span>
                <ChipNivel nivel={o.carga === 'carregado' ? 'aviso' : 'ok'}>{o.carga === 'carregado' ? 'Carregado' : 'Descarregado'}</ChipNivel>
              </button>
            );
          })}
        </Quadro>
        <Quadro titulo={`Canhotos vencidos (mais de ${PRAZO_CANHOTO_DIAS} dias)`} vazio="Nenhum canhoto vencido.">
          {canhotos.map((v) => (
            <button key={v.id} className="ind-item" onClick={() => setAberta(v.id)}>
              <span><strong>{codigoViagem(v.codigo)}</strong> {clientePorId[v.cliente_id]?.nome}</span><ChipCanhoto v={v} />
            </button>
          ))}
        </Quadro>
        {pode('ind.financeiro') && (
          <Quadro titulo={`Viagens abaixo da meta de ${META_MARGEM_PCT}%`} vazio="Todas as viagens entregues estão na meta.">
            {abaixo.map((v) => {
              const m = calcularMargem(v, ocorrencias);
              return (
                <button key={v.id} className="ind-item" onClick={() => setAberta(v.id)}>
                  <span><strong>{codigoViagem(v.codigo)}</strong> {clientePorId[v.cliente_id]?.nome}</span>
                  <ChipNivel nivel="atraso">{fmtPct(m.pct)} · {fmtReais(m.margem, 0)}</ChipNivel>
                </button>
              );
            })}
          </Quadro>
        )}
        <Quadro titulo="Viagens por etapa" vazio="">
          <div className="ind-etapas">
            {ETAPAS_FLUXO.slice(0, -1).map((e) => {
              const n = abertas.filter((v) => v.etapa === e).length;
              return <div key={e} className={n ? '' : 'zero'}><span>{ROTULO_ETAPA[e]}</span><strong className="num">{n}</strong></div>;
            })}
          </div>
        </Quadro>
      </div>
      <p className="suave pequeno" style={{ marginTop: 16 }}>
        Prévia com dados fictícios. <button className="btn sutil peq" onClick={() => restaurarPrevia()}>Restaurar dados da prévia</button>
      </p>
      {aberta && <DetalhesViagem id={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

function Kpi({ rot, val, sub, nivel }: { rot: string; val: ReactNode; sub?: string; nivel?: 'ok' | 'aviso' | 'atraso' }) {
  return (
    <div className={`cartao kpi ind-kpi ${nivel ?? ''}`}>
      <div className="rot">{rot}</div>
      <div className="ind-kpi-val num">{val}</div>
      {sub && <div className="suave pequeno">{sub}</div>}
    </div>
  );
}

function Quadro({ titulo, vazio, children }: { titulo: string; vazio: string; children: ReactNode }) {
  const lista = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <section className="cartao">
      <div className="cartao-cab"><h2>{titulo}</h2></div>
      <div className="cartao-corpo ind-quadro">{lista.length ? children : <p className="suave" style={{ margin: 0 }}>{vazio}</p>}</div>
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
