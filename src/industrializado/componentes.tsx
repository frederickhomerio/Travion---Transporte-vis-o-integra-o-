// Peças comuns das telas do Industrializado: chips, formulário de viagem, detalhes, ocorrência e motivo.

import { useEffect, useState, type ReactNode } from 'react';
import { Alerta, Gaveta, Modal, useAviso } from '../components/ui';
import { fmtData, fmtDataHora, fmtPct, fmtReais, hojeSP } from '../lib/formato';
import { useApp } from '../data/store';
import { useInd, type NovaViagem } from './dados';
import {
  alertaCanhoto, alertaCombinado, faltaPoEntregas, numeroEntrega, posCarga, calcularMargem, combinadoAtual, pendenciasEncerrar, duracao, marcosCarga, combinadoTransito, ETAPAS_TRANSITO, pedidoCarga, META_MARGEM_PCT, pendenciasAvanco, proximaEtapa, rota, type NivelAlerta,
} from './regras';
import {
  ETAPAS_FLUXO, ROTULO_ETAPA, ROTULO_OCORRENCIA, ROTULO_SIT_OCORRENCIA, ROTULO_SIT_PARADA, ROTULO_TIPO_CARGA, ROTULO_CARROCERIA, VALORES_ZERO, CHECAGENS, ROTULO_CHECAGEM,
  type CargaOcorrencia, type ChecagemInd, type EtapaInd, type OcorrenciaInd, type ParadaInd, type TipoOcorrencia, type ValoresInd, type ViagemInd,
} from './tipos';

export const FILIAL_IND = 'Goiânia · Industrializado';

/** Executa uma ação e mostra o erro do servidor (na prévia, da regra local) num aviso. */
export function useExecutar() {
  const avisar = useAviso();
  return (f: () => void, ok?: string) => {
    try { f(); if (ok) avisar('ok', ok); return true; } catch (e) { avisar('erro', (e as Error).message); return false; }
  };
}

export function ChipEtapa({ etapa }: { etapa: EtapaInd }) {
  const cls = etapa === 'cancelada' ? 'suspenso' : etapa === 'encerrada' ? 'arquivado' : etapa === 'entregue' ? 'liberado' : 'info';
  return <span className={`badge ${cls}`}>{ROTULO_ETAPA[etapa]}</span>;
}

export function ChipNivel({ nivel, children, titulo }: { nivel: NivelAlerta; children: ReactNode; titulo?: string }) {
  return <span className={`ind-chip ${nivel}`} title={titulo}>{children}</span>;
}

export function ChipCombinado({ v }: { v: ViagemInd }) {
  const c = combinadoAtual(v);
  if (!c) return null;
  const a = alertaCombinado({ combinado: c });
  return <ChipNivel nivel={a.nivel} titulo={`${c.o_que} · ${fmtDataHora(c.para)}`}>{c.o_que}: {a.texto}</ChipNivel>;
}

export function ChipCanhoto({ v }: { v: ViagemInd }) {
  const a = alertaCanhoto(v);
  return <ChipNivel nivel={a.nivel}>{a.texto}</ChipNivel>;
}

export function Rota({ v }: { v: ViagemInd }) {
  const r = rota(v);
  return (
    <span>
      {r.origem} → {r.destino}
      <span className="suave pequeno"> · {r.coletas} {r.coletas === 1 ? 'coleta' : 'coletas'}, {r.entregas} {r.entregas === 1 ? 'entrega' : 'entregas'}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Margem final
// ---------------------------------------------------------------------------
export function QuadroMargem({ v, ocorrencias }: { v: ViagemInd; ocorrencias: OcorrenciaInd[] }) {
  const m = calcularMargem(v, ocorrencias);
  const l = m.linhas;
  const linha = (rot: string, val: number, base?: number) => (
    <tr><td>{rot}</td><td className="n">{fmtReais(val)}</td><td className="n suave pequeno">{base !== undefined && base !== val ? `lançado ${fmtReais(base)}` : ''}</td></tr>
  );
  return (
    <div className="ind-margem">
      <table className="tabela">
        <tbody>
          <tr className="ind-sub"><td colSpan={3}>Receita</td></tr>
          {linha('Frete empresa', l.frete_empresa)}
          {linha('Custo extra', l.custo_extra)}
          {linha('Pedágio empresa', l.pedagio)}
          {linha('Adicional de frete', l.adicional_frete ?? 0)}
          {linha('CT-e complementar', l.cte_complementar, v.valores.cte_complementar)}
          <tr className="ind-total"><td>Total receita</td><td className="n">{fmtReais(m.receita)}</td><td /></tr>
          <tr className="ind-sub"><td colSpan={3}>Despesa</td></tr>
          {linha('Frete motorista', l.frete_motorista, v.valores.frete_motorista)}
          {linha('Pedágio motorista', l.pedagio_motorista ?? 0)}
          {linha('Descarga', l.descarga)}
          {linha('Diária', l.diaria, v.valores.diaria)}
          <tr className="ind-total"><td>Total despesa</td><td className="n">{fmtReais(m.despesa)}</td><td /></tr>
          <tr className={`ind-resultado ${m.abaixoMeta ? 'ruim' : 'bom'}`}>
            <td>Margem</td><td className="n">{fmtReais(m.margem)}</td><td className="n">{fmtPct(m.pct)} <span className="pequeno">(meta {META_MARGEM_PCT}%)</span></td>
          </tr>
        </tbody>
      </table>
      {m.abaixoAlerta && <p className="ind-falta pequeno" style={{ margin: '6px 0 0' }}>Margem abaixo de 10% (só aviso, não trava a carga).</p>}
      {v.valores_conferidos_em && <p className="pequeno" style={{ margin: '6px 0 0' }}>Valores conferidos na Emissão por {v.valores_conferidos_por} em {fmtDataHora(v.valores_conferidos_em)}.</p>}
      <p className="suave pequeno" style={{ margin: '6px 0 0' }}>
        Ocorrências aprovadas ou pagas entram sozinhas: valor ao cliente no CT-e complementar; valor ao motorista na diária (ocorrência de diária) ou no frete motorista (demais).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motivo (voltar, cancelar, reversa)
// ---------------------------------------------------------------------------
export function ModalMotivo({ titulo, texto, botao, aoConfirmar, aoFechar }: { titulo: string; texto: string; botao: string; aoConfirmar: (m: string) => boolean; aoFechar: () => void }) {
  const [m, setM] = useState('');
  return (
    <Modal titulo={titulo} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" disabled={!m.trim()} onClick={() => { if (aoConfirmar(m)) aoFechar(); }}>{botao}</button>
    </>}>
      <p style={{ marginTop: 0 }}>{texto}</p>
      <label className="campo"><span>Motivo (fica na auditoria da carga)</span><textarea className="entrada" value={m} onChange={(e) => setM(e.target.value)} maxLength={500} autoFocus /></label>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Combinado com o motorista
// ---------------------------------------------------------------------------
const OPCOES_COMBINADO = ['Chegada na coleta', 'Início do carregamento', 'Fim do carregamento', 'Saída para viagem', 'Chegada no cliente', 'Início da descarga'];
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);

export function ModalCombinado({ v, aoFechar }: { v: ViagemInd; aoFechar: () => void }) {
  const { acoes } = useInd();
  const exec = useExecutar();
  // Depois de carregado, o combinado é de trânsito: não reaproveita o da coleta.
  const emTransito = ETAPAS_TRANSITO.includes(v.etapa);
  const base = emTransito ? combinadoTransito(v) : v.combinado;
  const [o, setO] = useState(base?.o_que ?? (emTransito ? 'Chegada no cliente' : OPCOES_COMBINADO[0]));
  const [para, setPara] = useState(base ? localInput(new Date(base.para)) : localInput(new Date(Date.now() + 2 * 3600e3)));
  return (
    <Modal titulo={`Combinado com o motorista · Pedido ${pedidoCarga(v)}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" onClick={() => exec(() => acoes.definirCombinado(v.id, o, para), 'Combinado registrado.') && aoFechar()}>Registrar</button>
    </>}>
      <p style={{ marginTop: 0 }} className="suave">O que foi combinado com {v.motorista ?? 'o motorista'}. Uma hora antes do horário, a carga fica amarela se o veículo não marcou; depois do horário, vermelha.</p>
      <div className="grade-campos">
        <label className="campo"><span>Combinado</span>
          <input className="entrada" list="ind-combinados" value={o} onChange={(e) => setO(e.target.value)} />
          <datalist id="ind-combinados">{OPCOES_COMBINADO.map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <label className="campo"><span>Horário</span><input className="entrada" type="datetime-local" value={para} onChange={(e) => setPara(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ocorrência
// ---------------------------------------------------------------------------
export function ModalOcorrencia({ v, aoFechar, aoCriar, cargaPadrao, titulo }: { v: ViagemInd; aoFechar: () => void; aoCriar?: (o: OcorrenciaInd) => void; cargaPadrao?: CargaOcorrencia; titulo?: string }) {
  const { acoes, pode, ocorrencias } = useInd();
  const exec = useExecutar();
  const entregas = v.paradas.filter((p) => p.tipo === 'entrega');
  const atual = entregas.find((p) => p.situacao === 'em_operacao' || p.situacao === 'chegou') ?? entregas.find((p) => p.situacao === 'pendente') ?? entregas[0];
  const [d, setD] = useState({
    parada_id: (atual?.id ?? null) as string | null, tipo: 'diaria' as TipoOcorrencia,
    carga: (cargaPadrao ?? (atual && (atual.situacao === 'concluida') ? 'descarregado' : 'carregado')) as CargaOcorrencia,
    avaria: false, descricao: '', valor_motorista: 0, valor_cliente: 0,
  });
  const [criadaLocal, setCriada] = useState<OcorrenciaInd | null>(null);
  // Lê do estado para mostrar o código definitivo dado pelo servidor.
  const criada = criadaLocal && (ocorrencias.find((o) => o.id === criadaLocal.id) ?? criadaLocal);
  if (criada) {
    return (
      <Modal titulo="Ocorrência aberta" aoFechar={aoFechar} rodape={<button className="btn primario" onClick={aoFechar}>Fechar</button>}>
        <p style={{ marginTop: 0 }}>Registrada com o ID <strong className="mono" style={{ fontSize: '1.1rem' }}>{criada.codigo}</strong>.</p>
        <p className="suave">Use esse ID como referência {criada.avaria ? 'da avaria ' : ''}com o cliente e o motorista.</p>
      </Modal>
    );
  }
  return (
    <Modal titulo={titulo ?? `Abrir ocorrência · Pedido ${pedidoCarga(v)}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" onClick={() => exec(() => { const o = acoes.abrirOcorrencia({ viagem_id: v.id, ...d }); setCriada(o); aoCriar?.(o); })}>{aoCriar ? 'Abrir ocorrência e finalizar' : 'Abrir ocorrência'}</button>
    </>}>
      <div className="grade-campos">
        <label className="campo"><span>Tipo</span>
          <select className="entrada" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoOcorrencia })}>
            {(Object.keys(ROTULO_OCORRENCIA) as TipoOcorrencia[]).map((k) => <option key={k} value={k}>{ROTULO_OCORRENCIA[k]}</option>)}
          </select>
        </label>
        <label className="campo"><span>Entrega{entregas.some((p) => p.po) ? ' / PO' : ''}</span>
          <select className="entrada" value={d.parada_id ?? ''} onChange={(e) => setD({ ...d, parada_id: e.target.value || null })}>
            {entregas.map((p) => <option key={p.id} value={p.id}>{p.ordem}. {p.local} ({p.cidade}/{p.uf}){p.po ? ` · PO ${p.po}` : ''}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="ind-escolha">
        <legend>Situação da carga</legend>
        <label className={`ind-opcao aviso${d.carga === 'carregado' ? ' marcada' : ''}`}>
          <input type="radio" name="carga" checked={d.carga === 'carregado'} onChange={() => setD({ ...d, carga: 'carregado' })} />
          <span><strong>Carregado</strong><small>Mercadoria ainda no veículo · atenção maior</small></span>
        </label>
        <label className={`ind-opcao ok${d.carga === 'descarregado' ? ' marcada' : ''}`}>
          <input type="radio" name="carga" checked={d.carga === 'descarregado'} onChange={() => setD({ ...d, carga: 'descarregado' })} />
          <span><strong>Descarregado</strong><small>Mercadoria já entregue</small></span>
        </label>
      </fieldset>
      <label className="ind-check"><input type="checkbox" checked={d.avaria} onChange={(e) => setD({ ...d, avaria: e.target.checked })} /> Houve avaria (o ID da ocorrência é a referência)</label>
      <label className="campo" style={{ marginTop: 10 }}><span>Descrição</span>
        <textarea className="entrada" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} maxLength={500} placeholder="O que aconteceu, com quem foi falado" />
      </label>
      {pode('ind.financeiro') && (
        <div className="grade-campos" style={{ marginTop: 10 }}>
          <Dinheiro rotulo="A pagar ao motorista" valor={d.valor_motorista} aoMudar={(x) => setD({ ...d, valor_motorista: x })} />
          <Dinheiro rotulo="A cobrar do cliente" valor={d.valor_cliente} aoMudar={(x) => setD({ ...d, valor_cliente: x })} />
        </div>
      )}
      <p className="suave pequeno">Os valores só entram na margem depois de aprovados.</p>
    </Modal>
  );
}

export function Dinheiro({ rotulo, valor, aoMudar, desab }: { rotulo: string; valor: number; aoMudar: (v: number) => void; desab?: boolean }) {
  return (
    <label className="campo"><span>{rotulo} (R$)</span>
      <input className="entrada num" type="number" min={0} step="0.01" value={Number.isFinite(valor) ? valor : 0} disabled={desab}
        onChange={(e) => aoMudar(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Formulário de viagem (lançar e editar)
// ---------------------------------------------------------------------------
type ParadaForm = NovaViagem['paradas'][number];
const paradaVazia = (tipo: ParadaInd['tipo'], ordem: number, exige: boolean): ParadaForm =>
  ({ ordem, tipo, local: '', cidade: tipo === 'coleta' ? 'Goiânia' : '', uf: tipo === 'coleta' ? 'GO' : '', exige_agendamento: exige, agendado_para: null, protocolo: null, nfs: null });

export function FormViagem({ v, aoFechar, aoSalvar }: { v?: ViagemInd; aoFechar: () => void; aoSalvar?: (v: ViagemInd) => void }) {
  const { clientes, clientePorId, acoes, pode } = useInd();
  const exec = useExecutar();
  const ativos = clientes.filter((c) => c.ativo);
  const [d, setD] = useState<NovaViagem>(() => v ? {
    cliente_id: v.cliente_id, tipo_carga: v.tipo_carga, pedido: v.pedido ?? '', po: v.po ?? '', coleta_prevista: v.coleta_prevista ?? '', frota: v.frota, tipo_veiculo: v.tipo_veiculo, carroceria: v.carroceria ?? '', peso_t: v.peso_t ? String(v.peso_t).replace('.', ',') : '',
    placa_cavalo: v.placa_cavalo ?? '', placa_carreta: v.placa_carreta ?? '', motorista: v.motorista ?? '', motorista_cpf: v.motorista_cpf ?? '',
    motorista_telefone: v.motorista_telefone ?? '', contratado_por: v.contratado_por ?? '', paradas: v.paradas.map((p) => ({ ...p, agendado_para: p.agendado_para ? localInput(new Date(p.agendado_para)) : null })),
    valores: { ...v.valores }, observacao: v.observacao ?? '',
  } : {
    cliente_id: '', tipo_carga: 'paletizada', pedido: '', po: '', coleta_prevista: hojeSP(), frota: 'terceiro', tipo_veiculo: 'Carreta', carroceria: '', peso_t: '', placa_cavalo: '', placa_carreta: '',
    motorista: '', motorista_cpf: '', motorista_telefone: '', contratado_por: '', paradas: [paradaVazia('coleta', 1, false), paradaVazia('entrega', 2, false)],
    valores: { ...VALORES_ZERO }, observacao: '',
  });
  const [motivo, setMotivo] = useState('');
  const { estado: app, api } = useApp();
  const eu = app.sessao?.perfil.nome || app.sessao?.perfil.email || '';
  const [colaboradores, setColaboradores] = useState<string[]>([]);
  useEffect(() => { api.colaboradoresInd().then(setColaboradores).catch(() => setColaboradores([])); }, [api]);
  const cli = clientePorId[d.cliente_id];
  const set = <K extends keyof NovaViagem>(k: K, x: NovaViagem[K]) => setD((a) => ({ ...a, [k]: x }));
  const setP = (i: number, p: Partial<ParadaForm>) => setD((a) => ({ ...a, paradas: a.paradas.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
  const setV = (k: keyof ValoresInd, x: number) => setD((a) => ({ ...a, valores: { ...a.valores, [k]: x } }));
  const mover = (i: number, dir: -1 | 1) => setD((a) => {
    const ps = [...a.paradas]; const j = i + dir; if (j < 0 || j >= ps.length) return a;
    [ps[i], ps[j]] = [ps[j], ps[i]]; return { ...a, paradas: ps };
  });
  const salvar = () => {
    const dados = { ...d, paradas: d.paradas.map((p) => ({ ...p, agendado_para: p.agendado_para ? new Date(p.agendado_para).toISOString() : null })) };
    exec(() => {
      if (v) acoes.editarViagem(v.id, dados, motivo);
      else { const nova = acoes.criarViagem(dados); aoSalvar?.(nova); }
      aoFechar();
    }, v ? 'Viagem atualizada.' : 'Viagem lançada.');
  };
  const verValores = pode('ind.financeiro');

  return (
    <Modal titulo={v ? `Editar pedido ${pedidoCarga(v)}` : 'Lançar viagem'} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" onClick={salvar}>{v ? 'Salvar' : 'Lançar viagem'}</button>
    </>}>
      <div className="ind-form">
        <h3>Carga</h3>
        <div className="grade-campos">
          <label className="campo"><span>Cliente</span>
            <select className="entrada" value={d.cliente_id} onChange={(e) => {
              const c = clientePorId[e.target.value];
              setD((a) => ({ ...a, cliente_id: e.target.value, paradas: v ? a.paradas : a.paradas.map((p) => ({ ...p, exige_agendamento: !!c?.exige_agendamento })) }));
            }}>
              <option value="">Escolha…</option>
              {ativos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label className="campo"><span>Tipo de carga</span>
            <select className="entrada" value={d.tipo_carga} onChange={(e) => set('tipo_carga', e.target.value as NovaViagem['tipo_carga'])}>
              {Object.entries(ROTULO_TIPO_CARGA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
          </label>
          <label className="campo"><span>Pedido do cliente</span><input className="entrada" value={d.pedido} onChange={(e) => set('pedido', e.target.value)} maxLength={40} /></label>
          <label className="campo"><span>Retirada prevista</span><input className="entrada" type="date" value={d.coleta_prevista} onChange={(e) => set('coleta_prevista', e.target.value)} /></label>
          <label className="campo"><span>Peso total (t)</span><input className="entrada" inputMode="decimal" value={d.peso_t} onChange={(e) => set('peso_t', e.target.value)} placeholder="Ex.: 28,5" maxLength={8} /></label>
          <label className="campo"><span>Filial</span><input className="entrada" value={FILIAL_IND} disabled /></label>
        </div>

        <h3>Veículo e motorista</h3>
        <div className="grade-campos">
          <label className="campo"><span>Frota</span>
            <select className="entrada" value={d.frota} onChange={(e) => set('frota', e.target.value as NovaViagem['frota'])}>
              <option value="terceiro">Terceiro</option><option value="frota">Frota própria</option>
            </select>
          </label>
          <label className="campo"><span>Tipo de veículo</span>
            <select className="entrada" value={d.tipo_veiculo} onChange={(e) => set('tipo_veiculo', e.target.value)}>
              {['Carreta', 'Carreta LS', 'Bitrem', 'Truck', 'Toco', '3/4', 'VUC'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="campo"><span>Carroceria</span>
            <select className="entrada" value={d.carroceria} onChange={(e) => set('carroceria', e.target.value as NovaViagem['carroceria'])}>
              <option value="">Escolha…</option>
              {Object.entries(ROTULO_CARROCERIA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
          </label>
          <label className="campo"><span>Placa cavalo</span><input className="entrada" value={d.placa_cavalo} onChange={(e) => { const x = e.target.value.toUpperCase(); setD((p) => ({ ...p, placa_cavalo: x, contratado_por: p.contratado_por || (x.trim() && colaboradores.includes(eu) ? eu : '') })); }} maxLength={8} /></label>
          <label className="campo"><span>Placa carreta</span><input className="entrada" value={d.placa_carreta} onChange={(e) => set('placa_carreta', e.target.value.toUpperCase())} maxLength={8} /></label>
          <label className="campo"><span>Motorista</span><input className="entrada" value={d.motorista} onChange={(e) => set('motorista', e.target.value)} /></label>
          <label className="campo"><span>CPF</span><input className="entrada" value={d.motorista_cpf} onChange={(e) => set('motorista_cpf', e.target.value)} maxLength={14} /></label>
          <label className="campo"><span>Telefone</span><input className="entrada" value={d.motorista_telefone} onChange={(e) => set('motorista_telefone', e.target.value)} maxLength={20} /></label>
          <label className="campo ind-campo-dourado"><span>Contratado por (colaborador do Industrializado)</span>
            <select className="entrada" value={d.contratado_por} onChange={(e) => set('contratado_por', e.target.value)}>
              <option value="">Escolha…</option>
              {[...new Set([...colaboradores, ...(d.contratado_por && !colaboradores.includes(d.contratado_por) ? [d.contratado_por] : [])])].map((x) => <option key={x} value={x}>{x}{colaboradores.includes(x) ? '' : ' (fora da equipe)'}</option>)}
            </select></label>
        </div>
        <p className="suave pequeno">Motorista, placa do cavalo e quem contratou podem ficar para depois; são exigidos para passar a Veículo contratado. "Contratado por" lista só os colaboradores do Industrializado; se você é da equipe, vem com o seu nome ao informar a placa.</p>

        <h3>Coletas e entregas</h3>
        {d.paradas.map((p, i) => (
          <div key={i} className={`ind-parada-form ${p.tipo}`}>
            <div className="ind-parada-cab">
              <strong>{i + 1}. {p.tipo === 'coleta' ? 'Coleta' : 'Entrega'}</strong>
              <select className="entrada peq" value={p.tipo} onChange={(e) => setP(i, { tipo: e.target.value as ParadaInd['tipo'] })} aria-label="Tipo da parada">
                <option value="coleta">Coleta</option><option value="entrega">Entrega</option>
              </select>
              <span style={{ flex: 1 }} />
              <button className="btn sutil peq" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
              <button className="btn sutil peq" onClick={() => mover(i, 1)} disabled={i === d.paradas.length - 1} aria-label="Descer">↓</button>
              <button className="btn sutil peq" onClick={() => setD((a) => ({ ...a, paradas: a.paradas.filter((_, j) => j !== i) }))} disabled={d.paradas.length <= 2}>Remover</button>
            </div>
            <div className="grade-campos">
              <label className="campo"><span>Local</span><input className="entrada" value={p.local} onChange={(e) => setP(i, { local: e.target.value })} placeholder="Fábrica, CD, loja…" /></label>
              <label className="campo"><span>Cidade</span><input className="entrada" value={p.cidade} onChange={(e) => setP(i, { cidade: e.target.value })} /></label>
              <label className="campo" style={{ maxWidth: 90 }}><span>UF</span><input className="entrada" value={p.uf} onChange={(e) => setP(i, { uf: e.target.value.toUpperCase() })} maxLength={2} /></label>
              <label className="campo"><span>NFs desta parada</span><input className="entrada" value={p.nfs ?? ''} onChange={(e) => setP(i, { nfs: e.target.value })} placeholder="Opcional" /></label>
              {cli?.exige_po && p.tipo === 'entrega' && (
                <label className="campo"><span>PO desta entrega</span><input className="entrada" value={p.po ?? ''} onChange={(e) => setP(i, { po: e.target.value })} maxLength={40} />
                  <small>{cli.nome}: uma PO por entrega, obrigatória depois de carregado.</small></label>
              )}
            </div>
            <label className="ind-check"><input type="checkbox" checked={p.exige_agendamento} onChange={(e) => setP(i, { exige_agendamento: e.target.checked })} /> Cliente exige agendamento</label>
            {p.exige_agendamento && (
              <div className="grade-campos">
                <label className="campo"><span>Horário agendado</span><input className="entrada" type="datetime-local" value={p.agendado_para ?? ''} onChange={(e) => setP(i, { agendado_para: e.target.value || null })} /></label>
                <label className="campo"><span>Protocolo (opcional)</span><input className="entrada" value={p.protocolo ?? ''} onChange={(e) => setP(i, { protocolo: e.target.value })} maxLength={40} /></label>
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn peq" onClick={() => setD((a) => ({ ...a, paradas: [...a.paradas, paradaVazia('coleta', a.paradas.length + 1, !!cli?.exige_agendamento)] }))}>+ Coleta</button>
          <button className="btn peq" onClick={() => setD((a) => ({ ...a, paradas: [...a.paradas, paradaVazia('entrega', a.paradas.length + 1, !!cli?.exige_agendamento)] }))}>+ Entrega</button>
        </div>

        {verValores && (<>
          <h3>Valores da viagem (frete lotação)</h3>
          <div className="ind-valores">
            <div><strong className="pequeno">Receita</strong>
              <div className="grade-campos">
                <Dinheiro rotulo="Frete empresa" valor={d.valores.frete_empresa} aoMudar={(x) => setV('frete_empresa', x)} />
                <Dinheiro rotulo="Custo extra" valor={d.valores.custo_extra} aoMudar={(x) => setV('custo_extra', x)} />
                <Dinheiro rotulo="Pedágio empresa" valor={d.valores.pedagio} aoMudar={(x) => setV('pedagio', x)} />
                <Dinheiro rotulo="Adicional de frete" valor={d.valores.adicional_frete ?? 0} aoMudar={(x) => setV('adicional_frete', x)} />
                <Dinheiro rotulo="CT-e complementar" valor={d.valores.cte_complementar} aoMudar={(x) => setV('cte_complementar', x)} />
              </div>
            </div>
            <div><strong className="pequeno">Despesa</strong>
              <div className="grade-campos">
                <Dinheiro rotulo="Frete motorista" valor={d.valores.frete_motorista} aoMudar={(x) => setV('frete_motorista', x)} />
                <Dinheiro rotulo="Pedágio motorista" valor={d.valores.pedagio_motorista ?? 0} aoMudar={(x) => setV('pedagio_motorista', x)} />
                <Dinheiro rotulo="Descarga" valor={d.valores.descarga} aoMudar={(x) => setV('descarga', x)} />
                <Dinheiro rotulo="Diária" valor={d.valores.diaria} aoMudar={(x) => setV('diaria', x)} />
              </div>
            </div>
          </div>
        </>)}

        <label className="campo" style={{ marginTop: 12 }}><span>Observação</span><textarea className="entrada" value={d.observacao} onChange={(e) => set('observacao', e.target.value)} maxLength={500} /></label>
        {v && v.etapa !== 'lancada' && (
          <label className="campo" style={{ marginTop: 12 }}><span>Motivo da alteração (obrigatório se mudar valores)</span>
            <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} /></label>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detalhes da viagem (gaveta) com auditoria carga a carga
// ---------------------------------------------------------------------------
export function DetalhesViagem({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const { viagens, ocorrencias, clientePorId, acoes, pode } = useInd();
  const exec = useExecutar();
  const v = viagens.find((x) => x.id === id);
  const [modal, setModal] = useState<null | 'editar' | 'voltar' | 'cancelar' | 'combinado' | 'ocorrencia' | 'reversa' | 'po'>(null);
  const [po, setPo] = useState<Record<string, string>>({});
  if (!v) return null;
  const cli = clientePorId[v.cliente_id];
  const ocs = ocorrencias.filter((o) => o.viagem_id === v.id);
  const pend = pendenciasAvanco(v, cli, ocorrencias);
  const prox = proximaEtapa(v.etapa);
  const aberta = v.etapa !== 'encerrada' && v.etapa !== 'cancelada';
  const origem = v.reversa_de ? viagens.find((x) => x.id === v.reversa_de) : null;

  return (
    <Gaveta titulo={<>Pedido {pedidoCarga(v)} · {cli?.nome ?? '—'}</>} subtitulo={<><ChipEtapa etapa={v.etapa} /> <span style={{ marginLeft: 6 }}>{v.tipo_veiculo} · {ROTULO_TIPO_CARGA[v.tipo_carga]} · {FILIAL_IND}</span></>} aoFechar={aoFechar}>
      <Linha etapa={v.etapa} />
      {origem && <Alerta tipo="info">Reversa do pedido <strong>{pedidoCarga(origem)}</strong>.</Alerta>}

      <div className="ind-acoes">
        {aberta && prox && v.etapa !== 'carregada' && v.etapa !== 'entregue' && pode('ind.avancar') && (
          <button className="btn primario peq" disabled={pend.length > 0} title={pend.join('\n')} onClick={() => exec(() => acoes.avancar(v.id), `Viagem em ${ROTULO_ETAPA[prox]}.`)}>
            Avançar para {ROTULO_ETAPA[prox]}
          </button>
        )}
        {v.etapa === 'entregue' && pode('ind.pos_entrega') && (<>
          {!v.canhoto_digital_em && <button className="btn primario peq" onClick={() => exec(() => acoes.registrarCanhoto(v.id, 'digital'), 'Canhoto digital registrado.')}>Canhoto digital recebido</button>}
          {!v.canhoto_fisico_em && <button className="btn primario peq" onClick={() => exec(() => acoes.registrarCanhoto(v.id, 'fisico'), 'Canhoto físico registrado.')}>Canhoto físico recebido</button>}
          {!v.comprovante_ok_em && <button className="btn primario peq" onClick={() => exec(() => acoes.conferirComprovante(v.id), 'Comprovante de entrega conferido.')}>Comprovante de entrega conferido</button>}
          <button className="btn primario peq" disabled={pendenciasEncerrar(v, ocorrencias).length > 0} title={pendenciasEncerrar(v, ocorrencias).join('\n')}
            onClick={() => exec(() => acoes.encerrar(v.id), `Pedido ${pedidoCarga(v)} finalizado e encerrado.`)}>Finalizar carga (encerrar)</button>
        </>)}
        {/* Combinado só enquanto há algo a combinar: some depois que o veículo marcou e depois da entrega. */}
        {aberta && pode('ind.avancar') && !['entregue', 'encerrada', 'cancelada'].includes(v.etapa) && !combinadoAtual(v)?.marcou_em && <button className="btn peq" onClick={() => setModal('combinado')}>{combinadoAtual(v) ? 'Alterar combinado' : 'Combinado com motorista'}</button>}
        {combinadoAtual(v) && !combinadoAtual(v)!.marcou_em && pode('ind.avancar') && <button className="btn peq" onClick={() => exec(() => acoes.registrarMarcou(v.id), 'Marcação registrada.')}>Veículo marcou</button>}
        {aberta && pode('ind.ocorrencias') && ['transito', 'entregas', 'entregue'].includes(v.etapa) && <button className="btn peq" onClick={() => setModal('ocorrencia')}>Abrir ocorrência</button>}
        {aberta && pode('ind.lancar') && <button className="btn peq" onClick={() => setModal('editar')}>Editar</button>}
        {aberta && pode('ind.voltar') && v.etapa !== 'lancada' && <button className="btn peq" onClick={() => setModal('voltar')}>Voltar etapa</button>}
        {v.entregue_em && pode('ind.lancar') && <button className="btn peq" onClick={() => setModal('reversa')}>Criar reversa</button>}
        {aberta && pode('ind.cancelar') && <button className="btn peq perigo" onClick={() => setModal('cancelar')}>Cancelar</button>}
      </div>
      {aberta && pend.length > 0 && (
        <Alerta tipo="aviso"><div><strong>Para seguir:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pend.map((p) => <li key={p}>{p}</li>)}</ul></div></Alerta>
      )}
      {cli?.exige_po && aberta && pode('ind.lancar') && ['carregada', 'documentada', 'transito', 'entregas', 'entregue'].includes(v.etapa) && faltaPoEntregas(v).map((p) => (
        <div key={p.id} className="ind-po">
          <label className="campo" style={{ flex: 1 }}><span>PO da entrega {numeroEntrega(v, p)} · {p.local} ({p.cidade}/{p.uf}) · {cli.nome} exige</span>
            <input className="entrada" value={po[p.id] ?? ''} onChange={(e) => setPo({ ...po, [p.id]: e.target.value })} /></label>
          <button className="btn primario peq" onClick={() => exec(() => { acoes.informarPo(v.id, p.id, po[p.id] ?? ''); setPo({ ...po, [p.id]: '' }); }, 'PO registrada.')}>Salvar PO</button>
        </div>
      ))}

      {['lancada', 'contratado', 'coleta_agendada', 'carregando', 'carregada', 'documentada'].includes(v.etapa) && v.placa_cavalo && (
        <Secao titulo="Conferências">
          <Checagens v={v} podeMarcar={aberta && pode('ind.avancar')} horizontal
            checar={(x, item, m) => exec(() => acoes.marcarChecagem(x.id, item, m), m ? `${ROTULO_CHECAGEM[item]} conferido.` : `${ROTULO_CHECAGEM[item]} desmarcado.`)} />
        </Secao>
      )}
      <Secao titulo="Carga">
        <dl className="ind-dl">
          <dt>Pedido</dt><dd>{v.pedido ?? '—'}</dd>
          <dt>Retirada prevista</dt><dd>{v.coleta_prevista ? fmtData(v.coleta_prevista) : '—'}</dd>
          {cli?.exige_po && <><dt>PO</dt><dd>{posCarga(v) ?? <span className="ind-falta">pendente</span>}{faltaPoEntregas(v).length > 0 && posCarga(v) && <span className="ind-falta"> · falta na entrega {faltaPoEntregas(v).map((x) => numeroEntrega(v, x)).join(', ')}</span>}</dd></>}
          <dt>Rota</dt><dd><Rota v={v} /></dd>
          <dt>Veículo</dt><dd>{v.tipo_veiculo}{v.carroceria ? ` ${ROTULO_CARROCERIA[v.carroceria]}` : ''}{v.peso_t ? ` · ${String(v.peso_t).replace('.', ',')} t` : ''} · {v.frota === 'frota' ? 'Frota própria' : 'Terceiro'} · {[v.placa_cavalo, v.placa_carreta].filter(Boolean).join(' / ') || '—'}</dd>
          <dt>Motorista</dt><dd>{v.motorista ?? '—'}{v.motorista_cpf ? ` · CPF ${v.motorista_cpf}` : ''}{v.motorista_telefone ? ` · ${v.motorista_telefone}` : ''}</dd>
          <dt>Contratado por</dt><dd>{v.contratado_por ? <span className="ind-contratou">{v.contratado_por}</span> : '—'}</dd>
          <dt>Documentos</dt><dd>{v.cte ? `CT-e ${v.cte}` : 'CT-e —'}{v.mdfe ? ` · MDF-e ${v.mdfe}` : ''}{v.nfs ? ` · NF ${v.nfs}` : ''}</dd>
          <dt>Combinado</dt><dd>{combinadoAtual(v) ? <><ChipCombinado v={v} /> <span className="suave pequeno">{fmtDataHora(combinadoAtual(v)!.para)} · por {combinadoAtual(v)!.registrado_por}</span></> : '—'}</dd>
          {v.observacao && <><dt>Observação</dt><dd>{v.observacao}</dd></>}
        </dl>
      </Secao>

      <Secao titulo="Coletas e entregas">
        <ParadasTracking v={v} />
      </Secao>

      {v.entregue_em && (
        <Secao titulo="Pós-entrega">
          <dl className="ind-dl">
            <dt>Entregue em</dt><dd>{fmtDataHora(v.entregue_em)}</dd>
            <dt>Canhoto digital</dt><dd>{v.canhoto_digital_em ? fmtDataHora(v.canhoto_digital_em) : <span className="ind-falta">pendente</span>}</dd>
            <dt>Canhoto físico</dt><dd><ChipCanhoto v={v} /></dd>
            <dt>Comprovante</dt><dd>{v.comprovante_ok_em ? `Conferido em ${fmtDataHora(v.comprovante_ok_em)}` : <span className="ind-falta">a conferir</span>}</dd>
          </dl>
        </Secao>
      )}

      <Secao titulo={`Ocorrências (${ocs.length})`}>
        {ocs.length === 0 ? <p className="suave" style={{ margin: 0 }}>Nenhuma ocorrência.</p> : (
          <table className="tabela"><thead><tr><th>ID</th><th>Tipo</th><th>Entrega / PO</th><th>Carga</th><th>Situação</th>{pode('ind.financeiro') && <><th className="n">Motorista</th><th className="n">Cliente</th></>}</tr></thead>
            <tbody>{ocs.map((o) => (
              <tr key={o.id}><td className="mono">{o.codigo}</td><td>{ROTULO_OCORRENCIA[o.tipo]}{o.avaria ? ' · avaria' : ''}</td>
                <td className="pequeno">{(() => { const p = v.paradas.find((x) => x.id === o.parada_id); return p ? <>{p.ordem}. {p.local}{p.po && <div><strong>PO {p.po}</strong></div>}</> : '—'; })()}</td>
                <td><ChipNivel nivel={o.carga === 'carregado' ? 'aviso' : 'ok'}>{o.carga === 'carregado' ? 'Carregado' : 'Descarregado'}</ChipNivel></td>
                <td>{ROTULO_SIT_OCORRENCIA[o.situacao]}</td>
                {pode('ind.financeiro') && <><td className="n">{fmtReais(o.valor_motorista)}</td><td className="n">{fmtReais(o.valor_cliente)}</td></>}</tr>
            ))}</tbody></table>
        )}
      </Secao>

      {pode('ind.financeiro') && <Secao titulo="Margem final da carga"><QuadroMargem v={v} ocorrencias={ocorrencias} /></Secao>}

      <Secao titulo="Auditoria da carga">
        <ol className="ind-auditoria">
          {[...v.historico].reverse().map((h, i) => (
            <li key={i}>
              <div><strong>{h.acao}</strong>{h.detalhe && <span className="suave"> · {h.detalhe}</span>}</div>
              {h.motivo && <div className="pequeno">Motivo: {h.motivo}</div>}
              <div className="suave pequeno">{h.usuario} · {fmtDataHora(h.em)}</div>
            </li>
          ))}
        </ol>
      </Secao>

      {modal === 'editar' && <FormViagem v={v} aoFechar={() => setModal(null)} />}
      {modal === 'combinado' && <ModalCombinado v={v} aoFechar={() => setModal(null)} />}
      {modal === 'ocorrencia' && <ModalOcorrencia v={v} aoFechar={() => setModal(null)} />}
      {modal === 'voltar' && <ModalMotivo titulo="Voltar etapa" texto={`A viagem volta de ${ROTULO_ETAPA[v.etapa]} para a etapa anterior.`} botao="Voltar etapa"
        aoConfirmar={(m) => exec(() => acoes.voltar(v.id, m), 'Etapa anterior.')} aoFechar={() => setModal(null)} />}
      {modal === 'cancelar' && <ModalMotivo titulo="Cancelar viagem" texto="A viagem sai do controle diário e não pode ser reaberta." botao="Cancelar viagem"
        aoConfirmar={(m) => exec(() => acoes.cancelar(v.id, m), 'Viagem cancelada.')} aoFechar={() => setModal(null)} />}
      {modal === 'reversa' && <ModalMotivo titulo="Criar entrega reversa" texto="Uma viagem nova é lançada com as paradas invertidas e ligada a esta." botao="Criar reversa"
        aoConfirmar={(m) => exec(() => acoes.criarReversa(v.id, m), 'Reversa lançada.')} aoFechar={() => setModal(null)} />}
    </Gaveta>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section className="ind-secao"><h3>{titulo}</h3>{children}</section>;
}

/** Linha do tempo das 10 etapas. */
export function Linha({ etapa }: { etapa: EtapaInd }) {
  const i = ETAPAS_FLUXO.indexOf(etapa);
  return (
    <ol className={`ind-linha${etapa === 'cancelada' ? ' cancelada' : ''}`} aria-label="Etapas da viagem">
      {ETAPAS_FLUXO.map((e, j) => <li key={e} className={j < i ? 'feita' : j === i ? 'atual' : ''} title={ROTULO_ETAPA[e]}><span>{ROTULO_ETAPA[e]}</span></li>)}
    </ol>
  );
}

/** Paradas com os botões de tracking (chegou, em operação, concluída, recusada). */
export function ParadasTracking({ v, compacto }: { v: ViagemInd; compacto?: boolean }) {
  const { acoes, pode } = useInd();
  const exec = useExecutar();
  const podeMexer = pode('ind.avancar') && v.etapa !== 'encerrada' && v.etapa !== 'cancelada';
  const proximos = (p: ParadaInd): Array<[ParadaInd['situacao'], string]> => {
    const fase = p.tipo === 'coleta' ? ['carregando', 'coleta_agendada', 'contratado'] : ['entregas', 'transito'];
    if (!fase.includes(v.etapa)) return [];
    if (p.situacao === 'pendente') return [['chegou', 'Chegou']];
    if (p.situacao === 'chegou') return [['em_operacao', p.tipo === 'coleta' ? 'Carregando' : 'Descarregando'], ...(p.tipo === 'entrega' ? [['recusada', 'Recusada'] as [ParadaInd['situacao'], string]] : [])];
    if (p.situacao === 'em_operacao') return [['concluida', 'Concluída'], ...(p.tipo === 'entrega' ? [['recusada', 'Recusada'] as [ParadaInd['situacao'], string]] : [])];
    return [];
  };
  return (
    <ul className={`ind-paradas${compacto ? ' compacto' : ''}`}>
      {[...v.paradas].sort((a, b) => a.ordem - b.ordem).map((p) => (
        <li key={p.id} className={`${p.tipo} ${p.situacao}`}>
          <div className="ind-parada-linha">
            <span className="ind-parada-tipo">{p.tipo === 'coleta' ? 'C' : 'E'}{p.ordem}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{p.local}</strong> <span className="suave">{p.cidade}/{p.uf}</span>
              {!compacto && <div className="suave pequeno">
                {p.exige_agendamento ? <>Agendado {p.agendado_para ? fmtDataHora(p.agendado_para) : <span className="ind-falta">sem horário</span>}{p.protocolo ? ` · protocolo ${p.protocolo}` : ''}</> : 'Sem agendamento'}
                {p.chegada_em && ` · chegou ${fmtDataHora(p.chegada_em)}`}{p.fim_em && ` · fim ${fmtDataHora(p.fim_em)}`}
              </div>}
            </span>
            <span className={`ind-sit ${p.situacao}`}>{ROTULO_SIT_PARADA[p.situacao]}</span>
          </div>
          {podeMexer && proximos(p).length > 0 && (
            <div className="ind-parada-botoes">
              {proximos(p).map(([s, r]) => <button key={s} className={`btn peq${s === 'recusada' ? ' perigo' : ''}`} onClick={() => exec(() => acoes.situacaoParada(v.id, p.id, s))}>{r}</button>)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Cadastro, Monitoramento e OC/Vínculo: vermelho até conferir, verde depois. Clicar marca ou desmarca (fica no histórico). */
export function Checagens({ v, podeMarcar, checar, horizontal }: { v: ViagemInd; podeMarcar: boolean; horizontal?: boolean; checar: (v: ViagemInd, item: ChecagemInd, marcado: boolean) => void }) {
  return (
    <div className={`ind-checagens${horizontal ? ' horizontal' : ''}`}>
      {CHECAGENS.map((item) => {
        const c = v.checagens?.[item];
        return (
          <label key={item} className={`ind-checagem ${c ? 'ok' : 'pendente'}`} title={c ? `Conferido por ${c.por} em ${fmtDataHora(c.em)}` : 'Pendente'}>
            <input type="checkbox" checked={!!c} disabled={!podeMarcar} onChange={(e) => checar(v, item, e.target.checked)} />
            {ROTULO_CHECAGEM[item]}
          </label>
        );
      })}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Ficha completa da carga (botão "i" nas linhas): da carga disponível à finalização
// ---------------------------------------------------------------------------
export function BotaoInfo({ v }: { v: ViagemInd }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" className="ind-info" title="Informações da carga (do lançamento à finalização)" aria-label={`Informações do pedido ${pedidoCarga(v)}`}
        onClick={(e) => { e.stopPropagation(); setAberta(true); }}>i</button>
      {aberta && <FichaCarga id={v.id} aoFechar={() => setAberta(false)} />}
    </>
  );
}

export function FichaCarga({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const { viagens, ocorrencias, clientePorId, pode } = useInd();
  const v = viagens.find((x) => x.id === id);
  if (!v) return null;
  const cli = clientePorId[v.cliente_id];
  const ocs = ocorrencias.filter((o) => o.viagem_id === v.id).sort((a, b) => a.aberta_em.localeCompare(b.aberta_em));
  const marcos = marcosCarga(v);
  let anterior: string | null = null;
  const fases = [...new Set(marcos.map((m) => m.fase))];
  const valor = pode('ind.financeiro');
  return (
    <div className="fundo-modal centro" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="modal ind-ficha" role="dialog" aria-modal="true" aria-label={`Ficha do pedido ${pedidoCarga(v)}`}>
        <div className="modal-cab"><h2>Pedido {pedidoCarga(v)} · {cli?.nome ?? '—'}</h2>
          <div className="pequeno"><ChipEtapa etapa={v.etapa} /> <span className="suave">{v.tipo_veiculo} · {ROTULO_TIPO_CARGA[v.tipo_carga]} · {FILIAL_IND}</span></div></div>
        <div className="modal-corpo">
          <dl className="ind-dl ind-ficha-dados">
            <dt>Rota</dt><dd><Rota v={v} /></dd>
            <dt>Retirada prevista</dt><dd>{v.coleta_prevista ? fmtData(v.coleta_prevista) : '—'}</dd>
            {(cli?.exige_po || posCarga(v)) && <><dt>PO</dt><dd>{posCarga(v) ?? <span className="ind-falta">pendente</span>}</dd></>}
            <dt>Motorista</dt><dd>{v.motorista ?? '—'}{v.motorista_cpf ? ` · CPF ${v.motorista_cpf}` : ''}{v.motorista_telefone ? ` · ${v.motorista_telefone}` : ''}</dd>
          <dt>Contratado por</dt><dd>{v.contratado_por ? <span className="ind-contratou">{v.contratado_por}</span> : '—'}</dd>
            <dt>Veículo</dt><dd>{v.tipo_veiculo}{v.carroceria ? ` ${ROTULO_CARROCERIA[v.carroceria]}` : ''}{v.peso_t ? ` · ${String(v.peso_t).replace('.', ',')} t` : ''} · {v.frota === 'frota' ? 'Frota própria' : 'Terceiro'} · {[v.placa_cavalo, v.placa_carreta].filter(Boolean).join(' / ') || '—'}</dd>
            <dt>Documentos</dt><dd>{[v.cte && `CT-e ${v.cte}`, v.mdfe && `MDF-e ${v.mdfe}`, v.nfs && `NF ${v.nfs}`].filter(Boolean).join(' · ') || '—'}</dd>
            {v.observacao && <><dt>Observação</dt><dd>{v.observacao}</dd></>}
          </dl>

          <h3 className="ind-h3">Linha do tempo</h3>
          {fases.map((f) => (
            <div key={f} className="ind-ficha-fase">
              <div className="ind-ficha-fase-nome">{f}</div>
              <ol className="ind-marcos">
                {marcos.filter((m) => m.fase === f).map((m, i) => {
                  const desde = m.em && anterior ? Math.round((Date.parse(m.em) - Date.parse(anterior)) / 60000) : null;
                  if (m.em) anterior = m.em;
                  return (
                    <li key={i} className={m.em ? 'feito' : m.semRegistro ? 'sem-registro' : 'pendente'}>
                      <div className="ind-marco-lin"><strong>{m.rotulo}</strong>
                        <span className="pequeno">{m.em ? fmtDataHora(m.em) : m.semRegistro ? 'feito, sem registro de data' : 'pendente'}{desde !== null && desde > 0 ? <span className="suave"> · +{duracao(desde)}</span> : null}</span></div>
                      {(m.por || m.detalhe) && <div className="suave pequeno">{[m.por && `por ${m.por}`, m.detalhe].filter(Boolean).join(' · ')}</div>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

          <h3 className="ind-h3">Coletas e entregas</h3>
          <table className="tabela"><thead><tr><th>#</th><th>Local</th><th>Agendado</th><th>Chegou</th><th>Fim</th><th>Situação</th></tr></thead>
            <tbody>{[...v.paradas].sort((a, b) => a.ordem - b.ordem).map((p) => (
              <tr key={p.id}><td>{p.tipo === 'coleta' ? 'C' : 'E'}{p.ordem}</td><td>{p.local}<div className="suave pequeno">{p.cidade}/{p.uf}{p.protocolo ? ` · protocolo ${p.protocolo}` : ''}</div></td>
                <td>{p.agendado_para ? fmtDataHora(p.agendado_para) : '—'}</td><td>{p.chegada_em ? fmtDataHora(p.chegada_em) : '—'}</td><td>{p.fim_em ? fmtDataHora(p.fim_em) : '—'}</td><td>{ROTULO_SIT_PARADA[p.situacao]}</td></tr>
            ))}</tbody></table>

          <h3 className="ind-h3">Ocorrências ({ocs.length})</h3>
          {ocs.length === 0 ? <p className="suave" style={{ margin: 0 }}>Nenhuma ocorrência.</p> : (
            <table className="tabela"><thead><tr><th>ID</th><th>Tipo</th><th>Descrição</th><th>Aberta</th><th>Aprovada</th><th>Paga</th>{valor && <><th className="n">Motorista</th><th className="n">Cliente</th></>}</tr></thead>
              <tbody>{ocs.map((o) => (
                <tr key={o.id}><td className="mono">{o.codigo}</td>
                  <td>{ROTULO_OCORRENCIA[o.tipo]}{o.avaria ? ' · avaria' : ''}<div><ChipNivel nivel={o.carga === 'carregado' ? 'aviso' : 'ok'}>{o.carga === 'carregado' ? 'Carregado' : 'Descarregado'}</ChipNivel></div></td>
                  <td>{o.descricao}<div className="suave pequeno">{ROTULO_SIT_OCORRENCIA[o.situacao]}</div></td>
                  <td className="pequeno">{fmtDataHora(o.aberta_em)}<div className="suave">{o.aberta_por}</div></td>
                  <td className="pequeno">{o.aprovada_em ? <>{fmtDataHora(o.aprovada_em)}<div className="suave">{o.aprovada_por}</div></> : '—'}</td>
                  <td className="pequeno">{o.paga_em ? <>{fmtDataHora(o.paga_em)}<div className="suave">{o.paga_por}</div></> : '—'}</td>
                  {valor && <><td className="n">{fmtReais(o.valor_motorista)}</td><td className="n">{fmtReais(o.valor_cliente)}</td></>}</tr>
              ))}</tbody></table>
          )}

          {valor && <><h3 className="ind-h3">Valores e margem</h3><QuadroMargem v={v} ocorrencias={ocorrencias} /></>}

          <details className="ind-ficha-hist">
            <summary>Histórico completo ({v.historico.length} ações)</summary>
            <ol className="ind-auditoria" style={{ marginTop: 8 }}>
              {[...v.historico].reverse().map((h, i) => (
                <li key={i}><div><strong>{h.acao}</strong>{h.detalhe && <span className="suave"> · {h.detalhe}</span>}</div>
                  {h.motivo && <div className="pequeno">Motivo: {h.motivo}</div>}
                  <div className="suave pequeno">{h.usuario} · {fmtDataHora(h.em)}</div></li>
              ))}
            </ol>
          </details>
        </div>
        <div className="modal-rodape nao-imprimir">
          <button className="btn" onClick={() => window.print()}>Imprimir / PDF</button>
          <button className="btn primario" onClick={aoFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
