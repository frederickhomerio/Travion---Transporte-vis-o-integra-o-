// Peças comuns das telas do Industrializado: chips, formulário de viagem, detalhes, ocorrência e motivo.

import { useState, type ReactNode } from 'react';
import { Alerta, Gaveta, Modal, useAviso } from '../components/ui';
import { fmtData, fmtDataHora, fmtPct, fmtReais, hojeSP } from '../lib/formato';
import { useInd, type NovaViagem } from './dados';
import {
  alertaCanhoto, alertaCombinado, calcularMargem, combinadoAtual, combinadoTransito, ETAPAS_TRANSITO, pedidoCarga, META_MARGEM_PCT, pendenciasAvanco, proximaEtapa, rota, type NivelAlerta,
} from './regras';
import {
  ETAPAS_FLUXO, ROTULO_ETAPA, ROTULO_OCORRENCIA, ROTULO_SIT_OCORRENCIA, ROTULO_SIT_PARADA, ROTULO_TIPO_CARGA, VALORES_ZERO, CHECAGENS, ROTULO_CHECAGEM,
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
export function ModalOcorrencia({ v, aoFechar }: { v: ViagemInd; aoFechar: () => void }) {
  const { acoes, pode } = useInd();
  const exec = useExecutar();
  const entregas = v.paradas.filter((p) => p.tipo === 'entrega');
  const atual = entregas.find((p) => p.situacao === 'em_operacao' || p.situacao === 'chegou') ?? entregas.find((p) => p.situacao === 'pendente') ?? entregas[0];
  const [d, setD] = useState({
    parada_id: (atual?.id ?? null) as string | null, tipo: 'diaria' as TipoOcorrencia,
    carga: (atual && (atual.situacao === 'concluida') ? 'descarregado' : 'carregado') as CargaOcorrencia,
    avaria: false, descricao: '', valor_motorista: 0, valor_cliente: 0,
  });
  const [criada, setCriada] = useState<OcorrenciaInd | null>(null);
  if (criada) {
    return (
      <Modal titulo="Ocorrência aberta" aoFechar={aoFechar} rodape={<button className="btn primario" onClick={aoFechar}>Fechar</button>}>
        <p style={{ marginTop: 0 }}>Registrada com o ID <strong className="mono" style={{ fontSize: '1.1rem' }}>{criada.codigo}</strong>.</p>
        <p className="suave">Use esse ID como referência {criada.avaria ? 'da avaria ' : ''}com o cliente e o motorista.</p>
      </Modal>
    );
  }
  return (
    <Modal titulo={`Abrir ocorrência · Pedido ${pedidoCarga(v)}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Voltar</button>
      <button className="btn primario" onClick={() => exec(() => setCriada(acoes.abrirOcorrencia({ viagem_id: v.id, ...d })))}>Abrir ocorrência</button>
    </>}>
      <div className="grade-campos">
        <label className="campo"><span>Tipo</span>
          <select className="entrada" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoOcorrencia })}>
            {(Object.keys(ROTULO_OCORRENCIA) as TipoOcorrencia[]).map((k) => <option key={k} value={k}>{ROTULO_OCORRENCIA[k]}</option>)}
          </select>
        </label>
        <label className="campo"><span>Entrega</span>
          <select className="entrada" value={d.parada_id ?? ''} onChange={(e) => setD({ ...d, parada_id: e.target.value || null })}>
            {entregas.map((p) => <option key={p.id} value={p.id}>{p.ordem}. {p.local} ({p.cidade}/{p.uf})</option>)}
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
    cliente_id: v.cliente_id, tipo_carga: v.tipo_carga, pedido: v.pedido ?? '', po: v.po ?? '', coleta_prevista: v.coleta_prevista ?? '', frota: v.frota, tipo_veiculo: v.tipo_veiculo,
    placa_cavalo: v.placa_cavalo ?? '', placa_carreta: v.placa_carreta ?? '', motorista: v.motorista ?? '', motorista_cpf: v.motorista_cpf ?? '',
    motorista_telefone: v.motorista_telefone ?? '', paradas: v.paradas.map((p) => ({ ...p, agendado_para: p.agendado_para ? localInput(new Date(p.agendado_para)) : null })),
    valores: { ...v.valores }, observacao: v.observacao ?? '',
  } : {
    cliente_id: '', tipo_carga: 'paletizada', pedido: '', po: '', coleta_prevista: hojeSP(), frota: 'terceiro', tipo_veiculo: 'Carreta', placa_cavalo: '', placa_carreta: '',
    motorista: '', motorista_cpf: '', motorista_telefone: '', paradas: [paradaVazia('coleta', 1, false), paradaVazia('entrega', 2, false)],
    valores: { ...VALORES_ZERO }, observacao: '',
  });
  const [motivo, setMotivo] = useState('');
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
          {cli?.exige_po && (
            <label className="campo"><span>PO</span><input className="entrada" value={d.po} onChange={(e) => set('po', e.target.value)} maxLength={40} />
              <small>Obrigatório depois que o veículo carregar.</small></label>
          )}
          <label className="campo"><span>Retirada prevista</span><input className="entrada" type="date" value={d.coleta_prevista} onChange={(e) => set('coleta_prevista', e.target.value)} />
            <small>Conta na meta de cargas do dia.</small></label>
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
          <label className="campo"><span>Placa cavalo</span><input className="entrada" value={d.placa_cavalo} onChange={(e) => set('placa_cavalo', e.target.value.toUpperCase())} maxLength={8} /></label>
          <label className="campo"><span>Placa carreta</span><input className="entrada" value={d.placa_carreta} onChange={(e) => set('placa_carreta', e.target.value.toUpperCase())} maxLength={8} /></label>
          <label className="campo"><span>Motorista</span><input className="entrada" value={d.motorista} onChange={(e) => set('motorista', e.target.value)} /></label>
          <label className="campo"><span>CPF</span><input className="entrada" value={d.motorista_cpf} onChange={(e) => set('motorista_cpf', e.target.value)} maxLength={14} /></label>
          <label className="campo"><span>Telefone</span><input className="entrada" value={d.motorista_telefone} onChange={(e) => set('motorista_telefone', e.target.value)} maxLength={20} /></label>
        </div>
        <p className="suave pequeno">Motorista e placa do cavalo podem ficar para depois; são exigidos para passar a Veículo contratado.</p>

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
  const [po, setPo] = useState('');
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
        {aberta && pode('ind.avancar') && <button className="btn peq" onClick={() => setModal('combinado')}>Combinado com motorista</button>}
        {v.combinado && !v.combinado.marcou_em && pode('ind.avancar') && <button className="btn peq" onClick={() => exec(() => acoes.registrarMarcou(v.id), 'Marcação registrada.')}>Veículo marcou</button>}
        {aberta && pode('ind.ocorrencias') && ['transito', 'entregas', 'entregue'].includes(v.etapa) && <button className="btn peq" onClick={() => setModal('ocorrencia')}>Abrir ocorrência</button>}
        {aberta && pode('ind.lancar') && <button className="btn peq" onClick={() => setModal('editar')}>Editar</button>}
        {aberta && pode('ind.voltar') && v.etapa !== 'lancada' && <button className="btn peq" onClick={() => setModal('voltar')}>Voltar etapa</button>}
        {v.entregue_em && pode('ind.lancar') && <button className="btn peq" onClick={() => setModal('reversa')}>Criar reversa</button>}
        {aberta && pode('ind.cancelar') && <button className="btn peq perigo" onClick={() => setModal('cancelar')}>Cancelar</button>}
      </div>
      {aberta && pend.length > 0 && (
        <Alerta tipo="aviso"><div><strong>Para seguir:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pend.map((p) => <li key={p}>{p}</li>)}</ul></div></Alerta>
      )}
      {cli?.exige_po && !v.po && ['carregada', 'documentada', 'transito', 'entregas', 'entregue'].includes(v.etapa) && pode('ind.lancar') && (
        <div className="ind-po">
          <label className="campo" style={{ flex: 1 }}><span>PO ({cli.nome} exige depois de carregado)</span><input className="entrada" value={po} onChange={(e) => setPo(e.target.value)} /></label>
          <button className="btn primario peq" onClick={() => exec(() => { acoes.informarPo(v.id, po); setPo(''); }, 'PO registrado.')}>Salvar PO</button>
        </div>
      )}

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
          {cli?.exige_po && <><dt>PO</dt><dd>{v.po ?? <span className="ind-falta">pendente</span>}</dd></>}
          <dt>Rota</dt><dd><Rota v={v} /></dd>
          <dt>Veículo</dt><dd>{v.tipo_veiculo} · {v.frota === 'frota' ? 'Frota própria' : 'Terceiro'} · {[v.placa_cavalo, v.placa_carreta].filter(Boolean).join(' / ') || '—'}</dd>
          <dt>Motorista</dt><dd>{v.motorista ?? '—'}{v.motorista_cpf ? ` · CPF ${v.motorista_cpf}` : ''}{v.motorista_telefone ? ` · ${v.motorista_telefone}` : ''}</dd>
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
          <table className="tabela"><thead><tr><th>ID</th><th>Tipo</th><th>Carga</th><th>Situação</th>{pode('ind.financeiro') && <><th className="n">Motorista</th><th className="n">Cliente</th></>}</tr></thead>
            <tbody>{ocs.map((o) => (
              <tr key={o.id}><td className="mono">{o.codigo}</td><td>{ROTULO_OCORRENCIA[o.tipo]}{o.avaria ? ' · avaria' : ''}</td>
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

