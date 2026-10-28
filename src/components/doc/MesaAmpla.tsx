// Atendimento de Estadia no modelo "Mesa ampla": quatro blocos de largura total, um abaixo do outro, nesta ordem:
// 1) informações da solicitação (faixa vinho + grade horizontal), 2) documentos em área grande,
// 3) memória de cálculo em faixa horizontal, 4) retorno do cliente e encaminhamento.
// O cálculo exibido enquanto se digita é só prévia: vale o que o servidor grava ao Salvar (nova versão da conferência).

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Executar, PedirAjuste, Retomar, useRascunho } from '../../pages/AtendimentoDoc';
import { Reabrir, ResultadoPill } from '../../pages/Estadia';
import { mensagemErro, type ResultadoDoc } from '../../data/api';
import { useDetalheDoc, useDoc } from '../../data/documentacao';
import { useApp } from '../../data/store';
import { fmtPlaca, resumoDoc, tempoDoc, vezDe } from '../../lib/documentacao';
import {
  FINAIS_ESTADIA, LIMITES_ESTADIA, MODALIDADE_ESTADIA, MOTIVO_ESTADIA, REF_ESTADIA, RESULTADO_ESTADIA, TIPO_DOC_CURTO, calcularEstadia,
  fmtHoras, fmtHorasDec, fmtNumeroH, fmtReais, fmtTarifa, fmtToneladas, isoParaLocal, lerDecimal, localParaIso,
} from '../../lib/estadia';
import { fmtDataAsHora, fmtDataHora, hojeSP } from '../../lib/formato';
import type { ResultadoEstadia, SolicitacaoDoc } from '../../types';
import { Layout } from '../Layout';
import { Alerta, Carregando, useAviso } from '../ui';
import { type ArquivoLocal, Copiar, Historico, SeletorArquivos, StatusDocPill, enviarArquivos, useAgora } from './Comum';
import { CancelarDoc } from './DocumentacaoEmbarque';
import { RotuloVoltarAmpliado, VisualizadorAnexo } from './VisualizadorAnexo';

const REFERENCIAS = Object.entries(REF_ESTADIA);
const num = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: 6 }));

function Campo({ rot, valor, largo, copiar }: { rot: string; valor: React.ReactNode; largo?: boolean; copiar?: string | null }) {
  return (
    <div className={`ma-campo${largo ? ' largo' : ''}`}>
      <span className="ma-rot">{rot}</span>
      <span className="ma-val">{valor || '—'}{copiar ? <Copiar texto={copiar} /> : null}</span>
    </div>
  );
}

export function MesaAmpla({ s }: { s: SolicitacaoDoc }) {
  const { pode, estado: app } = useApp();
  const { aplicar, carregarDetalhe } = useDoc();
  const { detalhe, carregando } = useDetalheDoc(s.id);
  const nav = useNavigate();
  const avisar = useAviso();
  const agora = useAgora();
  const [sel, setSel] = useState<string | null>(null);
  const [ampliado, setAmpliado] = useState(false);
  const eu = app.sessao?.perfil.id;
  const meu = pode('apoio.atender') && s.responsavel_id === eu;
  const r = s.retrato;
  const t = tempoDoc(s, agora);
  const anexos = detalhe?.anexos ?? [];
  const perm = s.est_inicio && s.est_saida ? (Date.parse(s.est_saida) - Date.parse(s.est_inicio)) / 3600e3 : null;

  const executar: Executar = async (f: () => Promise<ResultadoDoc>, ok: string) => {
    try {
      const res = await f();
      aplicar(res);
      await carregarDetalhe(s.id).catch(() => undefined);
      avisar(res.status === 'sem_alteracao' ? 'info' : 'ok', res.status === 'sem_alteracao' ? 'Nada mudou desde a última versão salva.' : ok);
      return true;
    } catch (e) { avisar('erro', mensagemErro(e)); return false; }
  };

  return (
    <Layout titulo={`Estadia ${s.est_codigo ?? ''}`} aoLadoTitulo={<StatusDocPill status={s.status} />}>
      <div className="at-topo">
        <button className="btn sutil peq" onClick={() => nav('/apoio')}>← Fila de demandas</button>
        <span className="pequeno">{meu ? 'Você é o responsável por este atendimento.' : s.responsavel_nome ? `Responsável: ${s.responsavel_nome} · somente consulta` : 'Ainda não assumida · somente consulta'}</span>
      </div>
      <div className="ma">
        {/* 1. Informações da solicitação */}
        <section className="ma-bloco ma-info" aria-label="Informações da solicitação">
          <div className="ma-faixa">
            <h2>{s.est_codigo} · {fmtPlaca(s.placa)}</h2>
            <span className="ma-faixa-dir"><StatusDocPill status={s.status} /><Copiar texto={resumoDoc(s)} rotulo="Copiar resumo" /></span>
          </div>
          <div className="ma-grade">
            <Campo rot="Cliente" valor={r.cliente} copiar={r.cliente} />
            <Campo rot={s.est_tipo_documento ? TIPO_DOC_CURTO[s.est_tipo_documento] : 'Documento'} valor={(s.est_documentos ?? []).join(', ')} copiar={(s.est_documentos ?? []).join(', ')} />
            <Campo rot="NF da carga" valor={(s.est_nfs_carga ?? []).join(', ')} copiar={(s.est_nfs_carga ?? []).join(', ')} />
            <Campo rot="Início" valor={fmtDataHora(s.est_inicio)} />
            <Campo rot="Saída" valor={fmtDataHora(s.est_saida)} />
            <Campo rot="Permanência" valor={perm !== null ? fmtHoras(perm) : null} />
            <Campo rot="Motivo" valor={s.est_motivo ? `${MOTIVO_ESTADIA[s.est_motivo]}${s.est_motivo_outro ? `: ${s.est_motivo_outro}` : ''}` : null} />
            <Campo rot="Tipo de estadia" valor={s.est_modalidade ? MODALIDADE_ESTADIA[s.est_modalidade] : null} />
            <Campo rot="Tarifa informada" valor={s.est_tarifa != null ? fmtTarifa(s.est_tarifa) : null} />
            <Campo rot="Peso informado" valor={s.est_peso_t != null ? `${fmtToneladas(s.est_peso_t)}${s.est_peso_unidade === 'kg' ? ` (${s.est_peso_informado?.toLocaleString('pt-BR')} kg)` : ''}` : null} />
            <Campo rot="Solicitante" valor={`${s.solicitante_nome} · ${fmtDataAsHora(s.enviado_em)}`} />
            <Campo rot="Responsável do apoio" valor={s.responsavel_nome ?? 'Ninguém assumiu'} />
            <Campo rot="Sindicato" valor={s.est_sindicato ? s.est_sindicato_nome : 'Não'} />
            <Campo rot="Filial / CC" valor={`${r.filial ?? 'Sem filial'}${r.centro_custo ? ` · ${r.centro_custo}` : ''}`} />
            <Campo rot={t.rotulo} valor={t.texto} />
            {vezDe(s) && <Campo rot="Vez de" valor={vezDe(s)} />}
            {s.est_modalidade === 'acordo' && (
              <Campo largo rot="Acordo com cliente ou mesa" valor={`${fmtReais(s.est_acordo_valor ?? 0)} · confirmado por ${s.est_acordo_confirmado_por ?? '—'} em ${s.est_acordo_data?.split('-').reverse().join('/') ?? '—'} · ${s.est_acordo_descricao ?? ''}`} />
            )}
            {s.observacoes && <Campo largo rot="Observações" valor={s.observacoes} />}
          </div>
        </section>

        {/* 2. Documentos da solicitação */}
        <section className={`ma-bloco ma-docs${ampliado ? ' ma-ampliado' : ''}`} aria-label="Documentos da solicitação">
          <div className="ma-cab"><h3>Documentos da solicitação</h3><span className="pequeno suave">{anexos.length} arquivo(s) · escolha por categoria e nome</span></div>
          {carregando && !detalhe ? <Carregando texto="Carregando documentos…" /> : (
            <RotuloVoltarAmpliado.Provider value="Voltar à mesa">
              <VisualizadorAnexo anexos={anexos} selecionado={sel} aoSelecionar={setSel} ampliado={ampliado} aoAmpliar={setAmpliado} />
            </RotuloVoltarAmpliado.Provider>
          )}
        </section>

        {/* 3. Memória de cálculo */}
        <Calculo s={s} meu={meu} executar={executar} conferencias={detalhe?.estadia?.conferencias ?? []} />

        {/* 4. Retorno do cliente e encaminhamento */}
        <RetornoCliente s={s} meu={meu} executar={executar} detalhe={detalhe} />
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// 3. Memória de cálculo
// ---------------------------------------------------------------------------
function Calculo({ s, meu, executar, conferencias }: {
  s: SolicitacaoDoc; meu: boolean; executar: Executar; conferencias: NonNullable<ReturnType<typeof useDetalheDoc>['detalhe']>['estadia'] extends infer E ? E extends { conferencias: infer C } ? C : never : never;
}) {
  const { api } = useApp();
  const editavel = meu && s.status === 'em_atendimento';
  const ultima = conferencias[conferencias.length - 1];
  const [tarifa, setTarifa] = useState(() => num(ultima?.tarifa ?? s.est_tarifa));
  const [peso, setPeso] = useState(() => num(ultima?.peso_t ?? s.est_peso_t));
  const [limite, setLimite] = useState(() => num(s.est_limite_h));
  const [retro, setRetro] = useState(() => num(s.est_retroagir_h));
  const [ajustarDatas, setAjustarDatas] = useState(false);
  const [inicio, setInicio] = useState(() => isoParaLocal(ultima?.inicio ?? s.est_inicio));
  const [saida, setSaida] = useState(() => isoParaLocal(ultima?.saida ?? s.est_saida));
  const [obs, setObs] = useRascunho(`travion-rascunho-conf-${s.id}`);
  const [gravando, setGravando] = useState(false);
  const [acao, setAcao] = useState<'info' | 'cancelar' | null>(null);
  const [verVersoes, setVerVersoes] = useState(false);
  const [obsCliente, setObsCliente] = useState('');

  const v = {
    tarifa: lerDecimal(tarifa), peso: lerDecimal(peso), limite: lerDecimal(limite), retro: lerDecimal(retro),
    inicio: ajustarDatas ? localParaIso(inicio) : s.est_inicio, saida: ajustarDatas ? localParaIso(saida) : s.est_saida,
  };
  const ok = (x: number | null) => x !== null && !Number.isNaN(x);
  const previa = editavel ? calcularEstadia({ inicio: v.inicio, saida: v.saida, tarifa: ok(v.tarifa) ? v.tarifa : null, peso_t: ok(v.peso) ? v.peso : null,
    limite_h: ok(v.limite) ? v.limite : null, retroagir_h: ok(v.retro) ? v.retro : null }) : null;
  // Fora da edição, mostra a conferência vigente (gravada).
  const vig = ultima ? { permanencia_h: ultima.permanencia_h, horas_validas: ultima.horas_validas, valor: ultima.valor } : null;
  const mostra = editavel ? previa : vig;
  const p = editavel ? { tarifa: v.tarifa, peso: v.peso, limite: v.limite, retro: v.retro } : { tarifa: ultima?.tarifa ?? s.est_tarifa, peso: ultima?.peso_t ?? s.est_peso_t, limite: ultima?.limite_h, retro: ultima?.retroagir_h };
  const alterado = editavel && ((ok(v.tarifa) && v.tarifa !== s.est_tarifa) || (ok(v.peso) && Math.round(v.peso! * 1000) / 1000 !== s.est_peso_t)
    || (ajustarDatas && (v.inicio !== s.est_inicio || v.saida !== s.est_saida)));
  const naoSalvo = editavel && !!previa && (!ultima || previa.valor !== ultima.valor || v.limite !== ultima.limite_h || v.retro !== ultima.retroagir_h
    || v.tarifa !== ultima.tarifa || v.peso !== ultima.peso_t);
  const faltam = [!ok(v.limite) && '"Cobrar após quantas horas?"', !ok(v.retro) && '"Horas a retroagir"', !ok(v.tarifa) && 'tarifa', !ok(v.peso) && 'peso'].filter(Boolean) as string[];

  const salvar = async () => {
    if (faltam.length) return;
    setGravando(true);
    await executar(() => api.doc.conferirEstadia(s.id, {
      limite_h: v.limite!, retroagir_h: v.retro!, tarifa: v.tarifa!, peso_t: v.peso!,
      ...(ajustarDatas ? { inicio: v.inicio ?? undefined, saida: v.saida ?? undefined } : {}), observacao: obs.trim() || null,
    }, s.versao), 'Memória de cálculo salva (nova versão). Nada foi enviado ao cliente.');
    setGravando(false);
  };

  return (
    <section className="ma-bloco ma-calc" aria-label="Memória de cálculo">
      <div className="ma-cab"><h3>Memória de cálculo</h3>
        <span className="pequeno suave">{ultima ? `Conferência v${ultima.versao} · ${ultima.autor_nome}, ${fmtDataAsHora(ultima.criado_em)}` : 'Ainda não conferida'}</span>
      </div>
      <div className="ma-faixa-calc">
        <label className="ma-par"><span>Tarifa (R$/t/h)</span>
          {editavel ? <input className="entrada" inputMode="decimal" value={tarifa} onChange={(e) => setTarifa(e.target.value)} /> : <strong>{p.tarifa != null ? num(p.tarifa) : '—'}</strong>}
        </label>
        <label className="ma-par"><span>Peso (t)</span>
          {editavel ? <input className="entrada" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} /> : <strong>{p.peso != null ? fmtToneladas(p.peso) : '—'}</strong>}
        </label>
        <label className="ma-par"><span>Cobrar após quantas horas?</span>
          {editavel ? <input className="entrada" inputMode="decimal" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder="Diretriz do cliente" /> : <strong>{p.limite != null ? fmtNumeroH(p.limite) : '—'}</strong>}
        </label>
        <label className="ma-par"><span>Horas a retroagir</span>
          {editavel ? <input className="entrada" inputMode="decimal" value={retro} onChange={(e) => setRetro(e.target.value)} placeholder="Diretriz do cliente" /> : <strong>{p.retro != null ? fmtNumeroH(p.retro) : '—'}</strong>}
        </label>
        <div className={`ma-valor${mostra ? '' : ' aguardando'}`}>
          <span>Valor calculado</span>
          <strong>{mostra ? fmtReais(mostra.valor) : 'Aguardando conferência'}</strong>
          {naoSalvo && <small>Prévia: salve para valer</small>}
        </div>
      </div>
      <div className="ma-detalhe-calc">
        <span><b>Permanência</b> {mostra ? fmtHoras(mostra.permanencia_h) : s.est_inicio && s.est_saida ? fmtHoras((Date.parse(s.est_saida) - Date.parse(s.est_inicio)) / 3600e3) : '—'}</span>
        <span><b>Horas válidas</b> {mostra ? fmtHoras(mostra.horas_validas) : '—'}</span>
        <span><b>Fórmula</b> {mostra && p.tarifa != null && p.peso != null
          ? `${num(p.tarifa)} × ${fmtToneladas(p.peso)} × ${fmtHorasDec(mostra.horas_validas, 4)} = ${fmtReais(mostra.valor)}`
          : 'tarifa × toneladas × horas válidas'}</span>
        <span className="suave">{mostra && p.limite != null ? (mostra.permanencia_h > p.limite ? `Passou do limite de ${fmtNumeroH(p.limite)}: retroage ${fmtNumeroH(p.retro ?? 0)} uma vez.` : `Não passou do limite de ${fmtNumeroH(p.limite)} (no limite exato não cobra): valor zero, válido.`) : 'Informe as horas pelas diretrizes do cliente. Vazio não vale como zero.'}</span>
      </div>
      {s.est_modalidade === 'acordo' && <p className="pequeno ma-nota">Acordo registrado de {fmtReais(s.est_acordo_valor ?? 0)} fica ao lado como referência; o cálculo continua sendo tarifa × toneladas × horas válidas.</p>}

      {editavel && (
        <div className="ma-edicao">
          <label className="at-check"><input type="checkbox" checked={ajustarDatas} onChange={(e) => setAjustarDatas(e.target.checked)} /> Ajustar início e saída conferidos nos comprovantes</label>
          {ajustarDatas && (
            <div className="ma-linha">
              <label className="campo"><span>Início conferido</span><input className="entrada" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
              <label className="campo"><span>Saída conferida</span><input className="entrada" type="datetime-local" value={saida} onChange={(e) => setSaida(e.target.value)} /></label>
            </div>
          )}
          <label className="campo"><span>Observação da conferência{alterado ? ' * (obrigatória: você mudou dados enviados)' : ''}</span>
            <input className="entrada" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} placeholder="Ex.: limite e retroação conforme diretriz do cliente" />
          </label>
          {faltam.length > 0 && <small className="erro-campo">Para salvar, informe {faltam.join(', ')}. Zero é válido; vazio não.</small>}
          <div className="ma-acoes ma-salvar">
            <button className="btn primario" disabled={gravando || faltam.length > 0 || (alterado && !obs.trim())} onClick={() => void salvar()}>{gravando ? 'Salvando…' : 'Salvar'}</button>
          </div>
          <div className="ma-acoes">
            <button className="btn" disabled={gravando || !ultima || naoSalvo} title={!ultima ? 'Salve a memória de cálculo antes' : naoSalvo ? 'Salve a alteração antes' : undefined}
              onClick={async () => { setGravando(true); await executar(() => api.doc.encaminharClienteEstadia(s.id, obsCliente.trim() || null, s.versao), 'Situação: aguardando retorno do cliente. Nenhuma mensagem foi enviada pelo app.'); setGravando(false); }}>
              Aguardando retorno do cliente
            </button>
            <button className={`btn${acao === 'info' ? ' ativo' : ''}`} onClick={() => setAcao(acao === 'info' ? null : 'info')}>Aguardando informação</button>
            <button className="btn perigo" onClick={() => setAcao('cancelar')}>Cancelado</button>
          </div>
          <input className="entrada" value={obsCliente} onChange={(e) => setObsCliente(e.target.value)} maxLength={1000}
            placeholder="Como foi encaminhado ao cliente (opcional, ex.: e-mail ao financeiro)" aria-label="Observação do encaminhamento ao cliente" />
          <small className="suave">Salvar só grava a conferência. "Aguardando retorno do cliente" registra que você encaminhou por fora do app; nada é enviado automaticamente.</small>
          {acao === 'info' && <PedirAjuste s={s} executar={executar} referencias={REFERENCIAS} />}
          {acao === 'cancelar' && <CancelarDoc s={s} aoFechar={() => setAcao(null)} />}
        </div>
      )}
      {((meu && s.status === 'correcao_recebida') || s.status === 'aguardando_informacao') && (
        <div className="ma-edicao">
          {meu && s.status === 'correcao_recebida' && <Retomar s={s} executar={executar} />}
          {s.status === 'aguardando_informacao' && <Alerta tipo="aviso"><span><strong>Aguardando informação de {s.solicitante_nome}.</strong> A resposta volta a estadia para a sua fila; retome para continuar.</span></Alerta>}
        </div>
      )}
      {conferencias.length > 0 && (
        <div className="ma-versoes">
          <button className="btn sutil peq" onClick={() => setVerVersoes(!verVersoes)} aria-expanded={verVersoes}>{verVersoes ? 'Ocultar versões' : `Versões da conferência (${conferencias.length})`}</button>
          {verVersoes && (
            <div className="ao-tabela-wrap">
              <table className="ao-tabela ma-tab">
                <thead><tr><th>Versão</th><th>Tarifa</th><th>Peso</th><th>Limite</th><th>Retroagir</th><th>Horas válidas</th><th>Valor</th><th>Por</th><th>Ajustes</th></tr></thead>
                <tbody>
                  {[...conferencias].reverse().map((c) => (
                    <tr key={c.id}>
                      <td data-rot="Versão">v{c.versao}</td><td data-rot="Tarifa">{num(c.tarifa)}</td><td data-rot="Peso">{fmtToneladas(c.peso_t)}</td>
                      <td data-rot="Limite">{fmtNumeroH(c.limite_h)}</td><td data-rot="Retroagir">{fmtNumeroH(c.retroagir_h)}</td>
                      <td data-rot="Horas válidas">{fmtHoras(c.horas_validas)}</td><td data-rot="Valor"><strong>{fmtReais(c.valor)}</strong></td>
                      <td data-rot="Por">{c.autor_nome}<br /><span className="pequeno suave">{fmtDataAsHora(c.criado_em)}</span></td>
                      <td data-rot="Ajustes">{Object.keys(c.alteracoes).length ? `${Object.keys(c.alteracoes).join(', ')}: ${c.observacao ?? ''}` : c.observacao ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Retorno do cliente e encaminhamento
// ---------------------------------------------------------------------------
function RetornoCliente({ s, meu, executar, detalhe }: { s: SolicitacaoDoc; meu: boolean; executar: Executar; detalhe: ReturnType<typeof useDetalheDoc>['detalhe'] }) {
  const { api, pode } = useApp();
  const anexos = detalhe?.anexos ?? [];
  const retornos = detalhe?.estadia?.retornos ?? [];
  const pagamentos = detalhe?.estadia?.pagamentos ?? [];
  const pode_ = meu && ['em_atendimento', 'aguardando_cliente', 'pago_pendencia'].includes(s.status);
  const conferido = !!s.est_conferencia_id;
  const [resultado, setResultado] = useState<ResultadoEstadia | ''>('');
  const [valorAprovado, setValorAprovado] = useState('');
  const [dataRetorno, setDataRetorno] = useState(hojeSP());
  const [just, setJust] = useRascunho(`travion-rascunho-retorno-est-${s.id}`);
  const [evid, setEvid] = useState<ArquivoLocal[]>([]);
  const [valorPago, setValorPago] = useState('');
  const [dataPag, setDataPag] = useState('');
  const [obsPag, setObsPag] = useState('');
  const [comp, setComp] = useState<ArquivoLocal[]>([]);
  const [motivoEnc, setMotivoEnc] = useState('');
  const [gravando, setGravando] = useState<string | null>(null);
  const [tentouR, setTentouR] = useState(false);
  const [tentouP, setTentouP] = useState(false);
  const vAprov = lerDecimal(valorAprovado);
  const vPago = lerDecimal(valorPago);
  const errosR = [
    !resultado && 'escolha o resultado',
    resultado === 'aprovada_parcial' && (vAprov === null || Number.isNaN(vAprov) || vAprov <= 0) && 'informe o valor aprovado',
    resultado === 'aprovada' && vAprov !== null && (Number.isNaN(vAprov) || vAprov <= 0) && 'valor aprovado inválido',
    !just.trim() && 'descreva o retorno',
    !evid.length && 'anexe a evidência',
  ].filter(Boolean) as string[];
  const errosP = [
    (vPago === null || Number.isNaN(vPago) || vPago <= 0) && 'informe o valor pago',
    !dataPag && 'informe a data do pagamento',
    !comp.length && 'anexe o comprovante',
  ].filter(Boolean) as string[];
  const historicoFin = useMemo(() => [
    ...retornos.map((x) => ({ em: x.criado_em, txt: <>Retorno <ResultadoPill r={x.resultado} />{x.valor_aprovado != null ? ` · aprovado ${fmtReais(x.valor_aprovado)}` : ''} · calculado {fmtReais(x.valor_calculado)} · retorno de {x.data_retorno.split('-').reverse().join('/')} · {x.justificativa}</>, por: x.autor_nome })),
    ...pagamentos.map((x) => ({ em: x.criado_em, txt: <>Pago em pendência · {fmtReais(x.valor_pago)} em {x.data_pagamento.split('-').reverse().join('/')}{x.observacao ? ` · ${x.observacao}` : ''}</>, por: x.autor_nome })),
  ].sort((a, b) => b.em.localeCompare(a.em)), [retornos, pagamentos]);

  const registrarRetorno = async () => {
    setTentouR(true);
    if (errosR.length || !resultado) return;
    setGravando('retorno');
    try {
      const enviados = await enviarArquivos(evid, (f) => api.doc.enviarArquivo(f, true), setEvid);
      if (await executar(() => api.doc.registrarRetornoEstadia(s.id, { resultado, valor_aprovado: resultado === 'rejeitada' ? null : vAprov, justificativa: just.trim(), data_retorno: dataRetorno }, enviados, s.versao),
        resultado === 'aprovada' ? `Retorno registrado: Aprovada${s.status === 'pago_pendencia' ? ' (Pago em pendência → Aprovada; o pagamento continua registrado)' : ''}.`
          : resultado === 'aprovada_parcial' ? 'Retorno registrado: Aprovada parcialmente.' : 'Retorno registrado: Rejeitada. Confira e encerre com o motivo.')) {
        setResultado(''); setValorAprovado(''); setJust(''); setEvid([]); setTentouR(false);
      }
    } catch { /* upload falhou: arquivos ficam na lista */ }
    setGravando(null);
  };
  const registrarPagamento = async () => {
    setTentouP(true);
    if (errosP.length) return;
    setGravando('pagamento');
    try {
      const enviados = await enviarArquivos(comp, (f) => api.doc.enviarArquivo(f, true), setComp);
      if (await executar(() => api.doc.registrarPagamentoEstadia(s.id, { valor_pago: vPago!, data_pagamento: dataPag, observacao: obsPag.trim() || null }, enviados, s.versao),
        'Pago em pendência registrado. A receita continua pendente até o retorno do cliente.')) {
        setValorPago(''); setDataPag(''); setObsPag(''); setComp([]); setTentouP(false);
      }
    } catch { /* idem */ }
    setGravando(null);
  };

  return (
    <section className="ma-bloco ma-retorno" aria-label="Retorno do cliente e encaminhamento">
      <div className="ma-cab"><h3>Retorno do cliente e encaminhamento</h3>
        <span className="pequeno suave">{s.est_encaminhado_em ? `Encaminhada ao cliente em ${fmtDataAsHora(s.est_encaminhado_em)} (fora do app)` : 'Ainda não encaminhada ao cliente'}</span>
      </div>
      <div className="ma-resumo-ret">
        <div><span>Resultado do cliente</span><strong>{s.est_resultado ? <ResultadoPill r={s.est_resultado} /> : 'Sem retorno registrado'}</strong></div>
        <div><span>Valor calculado</span><strong>{s.est_valor_calculado != null ? fmtReais(s.est_valor_calculado) : 'Aguardando conferência'}</strong></div>
        <div><span>Valor aprovado</span><strong>{s.est_valor_aprovado != null ? fmtReais(s.est_valor_aprovado) : '—'}</strong></div>
        <div><span>Pago com receita pendente</span><strong>{s.est_valor_pago != null ? fmtReais(s.est_valor_pago) : '—'}</strong></div>
      </div>

      {pode_ && !conferido && <Alerta tipo="info">Salve a memória de cálculo antes de registrar retorno ou pagamento.</Alerta>}
      {pode_ && conferido && (
        <div className="ma-forms">
          <div className="ma-form">
            <strong>Registrar retorno do cliente</strong>
            <div className="sn-opcoes" role="radiogroup" aria-label="Resultado do cliente">
              {(Object.keys(RESULTADO_ESTADIA) as ResultadoEstadia[]).map((x) => (
                <label key={x} className={`sn-op${resultado === x ? ' ativo' : ''}`}>
                  <input type="radio" name={`ret-${s.id}`} checked={resultado === x} onChange={() => { setResultado(x); if (x === 'aprovada' && s.est_valor_calculado != null) setValorAprovado(num(s.est_valor_calculado)); }} />{RESULTADO_ESTADIA[x]}
                </label>
              ))}
            </div>
            <div className="ma-linha">
              {resultado && resultado !== 'rejeitada' && (
                <label className="campo"><span>Valor aprovado (R$){resultado === 'aprovada_parcial' ? ' *' : ''}</span>
                  <input className="entrada" inputMode="decimal" value={valorAprovado} onChange={(e) => setValorAprovado(e.target.value)} />
                </label>
              )}
              <label className="campo"><span>Data do retorno recebido</span>
                <input className="entrada" type="date" max={hojeSP()} value={dataRetorno} onChange={(e) => setDataRetorno(e.target.value)} />
              </label>
            </div>
            <label className="campo"><span>Justificativa / descrição do retorno *</span>
              <textarea className="entrada" rows={2} maxLength={2000} value={just} onChange={(e) => setJust(e.target.value)} />
            </label>
            <SeletorArquivos rotulo="Evidência do retorno" categoria="est_retorno" itens={evid} aoMudar={setEvid} obrigatorio cadastro max={LIMITES_ESTADIA.max.est_retorno} desabilitado={!!gravando} />
            {tentouR && errosR.length > 0 && <small className="erro-campo">Falta: {errosR.join('; ')}.</small>}
            {s.status === 'pago_pendencia' && resultado === 'aprovada' && <small className="suave">Ao salvar, a situação passa de Pago em pendência para Aprovada. O pagamento continua registrado; o app não marca receita como recebida.</small>}
            <div><button className="btn primario" disabled={!!gravando} onClick={() => void registrarRetorno()}>{gravando === 'retorno' ? 'Registrando…' : 'Registrar retorno do cliente'}</button></div>
          </div>
          <div className="ma-form">
            <strong>Pago em pendência</strong>
            <span className="pequeno suave">Pagamento feito fora do app com receita ainda pendente. Informar não executa pagamento.</span>
            <div className="ma-linha">
              <label className="campo"><span>Valor efetivamente pago (R$) *</span><input className="entrada" inputMode="decimal" value={valorPago} onChange={(e) => setValorPago(e.target.value)} /></label>
              <label className="campo"><span>Data do pagamento *</span><input className="entrada" type="date" max={hojeSP()} value={dataPag} onChange={(e) => setDataPag(e.target.value)} /></label>
            </div>
            <label className="campo"><span>Observação da pendência de receita</span><input className="entrada" value={obsPag} onChange={(e) => setObsPag(e.target.value)} maxLength={1000} /></label>
            <SeletorArquivos rotulo="Comprovante" categoria="est_pagamento" itens={comp} aoMudar={setComp} obrigatorio cadastro max={LIMITES_ESTADIA.max.est_pagamento} desabilitado={!!gravando} />
            {tentouP && errosP.length > 0 && <small className="erro-campo">Falta: {errosP.join('; ')}.</small>}
            <div><button className="btn" disabled={!!gravando} onClick={() => void registrarPagamento()}>{gravando === 'pagamento' ? 'Registrando…' : 'Registrar pago em pendência'}</button></div>
          </div>
        </div>
      )}
      {meu && s.status === 'em_atendimento' && s.est_resultado === 'rejeitada' && (
        <div className="ma-form">
          <strong>Encerrar: não gerou estadia</strong>
          <span className="pequeno suave">Cliente rejeitou. Confirme que não houve geração conforme acordo ou padrão do cliente. Pagamentos anteriores continuam registrados.</span>
          <label className="campo"><span>Motivo do encerramento *</span><textarea className="entrada" rows={2} maxLength={1000} value={motivoEnc} onChange={(e) => setMotivoEnc(e.target.value)} /></label>
          <div><button className="btn perigo" disabled={!!gravando || !motivoEnc.trim()} onClick={async () => {
            setGravando('encerrar');
            if (await executar(() => api.doc.encerrarEstadia(s.id, motivoEnc.trim(), s.versao), 'Estadia encerrada.')) setMotivoEnc('');
            setGravando(null);
          }}>{gravando === 'encerrar' ? 'Encerrando…' : 'Encerrar estadia'}</button></div>
        </div>
      )}
      {s.status === 'cancelado' && <Alerta tipo="aviso">Cancelada por {s.cancelado_por_nome}: {s.cancelado_motivo}</Alerta>}
      {s.status === 'encerrado' && <Alerta tipo="aviso">Encerrada por {s.concluido_por_nome} em {fmtDataAsHora(s.concluido_em)}: {s.est_encerrado_motivo}</Alerta>}
      {(s.status === 'aprovada' || s.status === 'aprovada_parcial') && (
        <Alerta tipo="ok">{s.status === 'aprovada' ? 'Aprovada' : 'Aprovada parcialmente'} pelo cliente{s.est_valor_aprovado != null ? `: ${fmtReais(s.est_valor_aprovado)}` : ''}. Registro de {s.concluido_por_nome} em {fmtDataAsHora(s.concluido_em)}. Recebimento de receita não é controlado pelo app.</Alerta>
      )}
      {FINAIS_ESTADIA.includes(s.status) && pode('estadia.reabrir') && <Reabrir s={s} />}
      {historicoFin.length > 0 && (
        <ul className="ma-fin">{historicoFin.map((x, i) => <li key={i}>{x.txt} <span className="pequeno suave">· {x.por}, {fmtDataAsHora(x.em)}</span></li>)}</ul>
      )}
      <details className="ma-hist">
        <summary>Histórico completo ({detalhe?.mensagens.length ?? 0})</summary>
        {detalhe ? <Historico mensagens={detalhe.mensagens} anexos={anexos} /> : <Carregando />}
      </details>
    </section>
  );
}
