// Atendimento de uma demanda: dois quadros na mesma tela. À esquerda (≈35%) os dados copiáveis e as ações do apoio;
// à direita (≈65%) o visualizador do anexo selecionado. O separador ajusta a divisão (arrastar, teclado ou botões).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type ArquivoLocal, Copiar, Historico, LinhaInfo, SeletorArquivos, StatusDocPill, TipoNumero, enviarArquivos, useAgora } from '../components/doc/Comum';
import { CancelarDoc } from '../components/doc/DocumentacaoEmbarque';
import { VisualizadorAnexo } from '../components/doc/VisualizadorAnexo';
import { MesaAmpla } from '../components/doc/MesaAmpla';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, Carregando, useAviso } from '../components/ui';
import { mensagemErro, type ResultadoDoc } from '../data/api';
import { useDetalheDoc, useDoc } from '../data/documentacao';
import { useApp } from '../data/store';
import { cidadeAnuncio } from '../lib/anuncio';
import {
  ABERTOS, CATEGORIA, CATEGORIAS_SAIDA, MOTIVOS_ESCOLHA, MOTIVO_DEVOLUCAO, OPERACAO, PAGAMENTO, PEDAGIO, REF_CADASTRO, TIPO_DOC, fmtFrete, fmtPlaca, fmtReais2, resumoDoc, tempoDoc, vezDe,
} from '../lib/documentacao';
import { fmtDataAsHora } from '../lib/formato';
import type { CategoriaAnexo, MotivoDevolucao, SolicitacaoDoc } from '../types';

const CHAVE_DIVISAO = 'travion-atendimento-divisao';
const REFERENCIAS: Array<[string, string]> = [
  ['', 'Geral'], ['nf', 'NF'], ['evidencia_frete', 'Evidência do frete'], ['placa', 'Placa'], ['frete', 'Fretes'],
  ['pagamento', 'Pagamento/pedágio'], ['obs_cte', 'Observação do CT-e'],
];
const REFERENCIAS_CADASTRO = Object.entries(REF_CADASTRO);

export function useRascunho(chave: string) {
  const [v, setV] = useState(() => { try { return sessionStorage.getItem(chave) ?? ''; } catch { return ''; } });
  useEffect(() => { try { if (v) sessionStorage.setItem(chave, v); else sessionStorage.removeItem(chave); } catch { /* só em memória */ } }, [chave, v]);
  return [v, setV] as const;
}

export function AtendimentoDoc() {
  const { id = '' } = useParams();
  const { pode } = useApp();
  const { estado, sincronizar } = useDoc();
  const s = estado.solicitacoes[id];
  useEffect(() => { if (estado.carregado && !s) void sincronizar(); }, [estado.carregado, s, sincronizar]);
  if (!pode('apoio.pagina')) return <Layout titulo="Apoio Operacional"><AcessoNegado /></Layout>;
  if (!s) {
    return (
      <Layout titulo="Apoio Operacional">
        {estado.carregado ? <Alerta tipo="aviso">Demanda não encontrada ou fora do seu escopo.</Alerta> : <Carregando texto="Carregando a demanda…" />}
      </Layout>
    );
  }
  return s.tipo === 'estadia' ? <MesaAmpla s={s} /> : <Atendimento s={s} />;
}

function Atendimento({ s }: { s: SolicitacaoDoc }) {
  const { pode, estado: app } = useApp();
  const { aplicar, carregarDetalhe } = useDoc();
  const { detalhe, carregando } = useDetalheDoc(s.id);
  const nav = useNavigate();
  const avisar = useAviso();
  const agora = useAgora();
  const eu = app.sessao?.perfil.id;
  const editavel = pode('apoio.atender') && s.responsavel_id === eu && (s.status === 'em_atendimento' || s.status === 'aguardando_informacao' || s.status === 'correcao_recebida');
  // Correção recebida: as ações voltam depois de retomar o atendimento.
  const retomar = editavel && s.status === 'correcao_recebida';
  const [divisao, setDivisao] = useState(() => { const n = Number(localStorage.getItem(CHAVE_DIVISAO)); return n >= 22 && n <= 60 ? n : 35; });
  const [ampliado, setAmpliado] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(CHAVE_DIVISAO, String(divisao)); } catch { /* preferência local */ } }, [divisao]);

  const anexos = detalhe?.anexos ?? [];
  const saida = anexos.filter((a) => CATEGORIAS_SAIDA.includes(a.categoria));
  const r = s.retrato;
  const t = tempoDoc(s, agora);
  const ajustar = (d: number) => setDivisao((x) => Math.min(60, Math.max(22, x + d)));
  const arrastar = (ev: React.PointerEvent) => {
    const el = caixa.current;
    if (!el) return;
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    const mover = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      setDivisao(Math.min(60, Math.max(22, ((e.clientX - b.left) / b.width) * 100)));
    };
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  const executar = async (f: () => Promise<ResultadoDoc>, ok: string) => {
    try {
      const res = await f();
      aplicar(res);
      await carregarDetalhe(s.id).catch(() => undefined);
      avisar('ok', ok);
      return true;
    } catch (e) { avisar('erro', mensagemErro(e)); return false; }
  };

  const cad = s.tipo === 'cadastro';
  const conta = (c: CategoriaAnexo) => anexos.filter((a) => a.categoria === c).length;
  const placaTxt = `${fmtPlaca(s.placa)}${s.placas_reboque.length ? ` + ${s.placas_reboque.map(fmtPlaca).join(', ')}` : ''}`;
  return (
    <Layout titulo={`${TIPO_DOC[s.tipo]} nº ${s.numero}`} aoLadoTitulo={<StatusDocPill status={s.status} />}>
      <div className="at-topo">
        <button className="btn sutil peq" onClick={() => nav('/apoio')}>← Fila de demandas</button>
        <span className="at-status-cel"><StatusDocPill status={s.status} /></span>
        <span className="pequeno">{editavel ? 'Você é o responsável por este atendimento.' : s.responsavel_nome ? `Responsável: ${s.responsavel_nome} · somente consulta` : 'Ainda não assumida · somente consulta'}</span>
      </div>
      <div className={`at${ampliado ? ' at-ampliado' : ''}`} ref={caixa} style={{ ['--at-esq' as string]: `${divisao}%` }}>
        {!ampliado && (
          <section className="at-esq" aria-label="Dados e ações">
            <div className="cartao cartao-corpo at-bloco">
              <div className="at-cab">
                <TipoNumero s={s} />
                <Copiar texto={resumoDoc(s)} rotulo="Copiar resumo" />
              </div>
              {cad ? (
                <div className="at-info">
                  <LinhaInfo rot="Cliente" valor={r.cliente} copiar />
                  <LinhaInfo rot="Placa do cavalo" valor={fmtPlaca(s.placa)} copiar />
                  <LinhaInfo rot="Telefone do motorista" valor={s.telefone_motorista} copiar />
                  <LinhaInfo rot="Mercadoria" valor={s.mercadoria} copiar />
                  <LinhaInfo rot="Valor da carga" valor={s.valor_carga != null ? fmtReais2(s.valor_carga) : null} copiar />
                  <LinhaInfo rot="Origem" valor={cidadeAnuncio(r.origem_cidade, r.origem_uf)} copiar />
                  <LinhaInfo rot="Destino" valor={cidadeAnuncio(r.destino_cidade, r.destino_uf)} copiar />
                  <LinhaInfo rot="Primeiro embarque" valor={s.primeiro_embarque ? 'Sim, motorista de primeiro embarque' : 'Não'} />
                  <LinhaInfo rot="Filial / CC" valor={`${r.filial ?? 'Sem filial'}${r.centro_custo ? ` · ${r.centro_custo}` : ''}`} />
                  <LinhaInfo rot="Carteira" valor={r.carteira} />
                  <LinhaInfo rot="Documentos" valor={detalhe ? `Motorista: ${conta('motorista')} · Veículos: ${conta('veiculo')}${conta('correcao') ? ` · Correções: ${conta('correcao')}` : ''}` : '…'} />
                  {s.observacoes && <LinhaInfo rot="Observações" valor={s.observacoes} copiar />}
                  <LinhaInfo rot="Cadastro no ERP" valor={s.erp_referencia ?? (s.status === 'cadastro_concluido' ? 'Concluído (sem referência)' : 'A fazer manualmente no ERP')} copiar={!!s.erp_referencia} />
                  <LinhaInfo rot="Solicitante" valor={`${s.solicitante_nome} · ${fmtDataAsHora(s.enviado_em)}`} />
                  <LinhaInfo rot="Responsável" valor={s.responsavel_nome ?? '—'} />
                  <LinhaInfo rot={t.rotulo} valor={t.texto} />
                  {vezDe(s) && <LinhaInfo rot="Vez de" valor={vezDe(s)} />}
                </div>
              ) : (
              <div className="at-info">
                <LinhaInfo rot="Cliente" valor={r.cliente} copiar />
                <LinhaInfo rot="Lote" valor={r.lote_numero ?? 'Lote a gerar'} copiar={!!r.lote_numero} />
                <LinhaInfo rot="Placa" valor={placaTxt} copiar />
                <LinhaInfo rot="Origem" valor={`${cidadeAnuncio(r.origem_cidade, r.origem_uf)}${r.coleta ? ` · ${r.coleta}` : ''}`} copiar />
                <LinhaInfo rot="Destino" valor={`${cidadeAnuncio(r.destino_cidade, r.destino_uf)}${r.entrega ? ` · ${r.entrega}` : ''}`} copiar />
                <LinhaInfo rot="Produto" valor={r.produto} copiar />
                <LinhaInfo rot="Filial / CC" valor={`${r.filial ?? '—'}${r.centro_custo ? ` · ${r.centro_custo}` : ''}`} />
                <LinhaInfo rot="Frete empresa" valor={fmtFrete(s.frete_empresa, s.frete_empresa_unidade)} copiar />
                <LinhaInfo rot="Frete motorista" valor={fmtFrete(s.frete_motorista, s.frete_motorista_unidade)} copiar />
                {s.tipo_operacao && <LinhaInfo rot="Tipo de operação" valor={OPERACAO[s.tipo_operacao]} copiar />}
                <LinhaInfo rot="Pagamento" valor={PAGAMENTO[s.forma_pagamento]} copiar />
                <LinhaInfo rot="Pedágio" valor={PEDAGIO[s.pedagio]} copiar />
                <LinhaInfo rot="Obs. no CT-e" valor={s.exige_obs_cte ? s.obs_cte : 'Não exigida'} copiar={s.exige_obs_cte} />
                <LinhaInfo rot="CT-e por NF" valor={s.cte_por_nf ? 'Sim, um CT-e por NF' : 'Não'} />
                {s.observacoes && <LinhaInfo rot="Observações" valor={s.observacoes} copiar />}
                <LinhaInfo rot="Solicitante" valor={`${s.solicitante_nome} · ${fmtDataAsHora(s.enviado_em)}`} />
                <LinhaInfo rot="Responsável" valor={s.responsavel_nome ?? '—'} />
                <LinhaInfo rot={t.rotulo} valor={t.texto} />
                {vezDe(s) && <LinhaInfo rot="Vez de" valor={vezDe(s)} />}
              </div>
              )}
            </div>

            {s.status === 'aguardando_informacao' && (
              <Alerta tipo="aviso"><span><strong>Aguardando informação de {s.solicitante_nome}.</strong> A resposta volta a demanda para a sua fila; retome o atendimento para continuar.</span></Alerta>
            )}
            {s.status === 'documentacao_disponivel' && <Alerta tipo="ok">Documentação disponível desde {fmtDataAsHora(s.concluido_em)} ({s.concluido_por_nome}). Tempo total: {t.texto}.</Alerta>}
            {s.status === 'cadastro_concluido' && (
              <Alerta tipo="ok"><span>Cadastro concluído em {fmtDataAsHora(s.concluido_em)} ({s.concluido_por_nome}). Tempo total: {t.texto}.
                {s.retorno_solicitante ? <> Retorno ao solicitante: {s.retorno_solicitante}</> : null}</span></Alerta>
            )}
            {s.status === 'cancelado' && <Alerta tipo="aviso">Cancelada por {s.cancelado_por_nome}: {s.cancelado_motivo}</Alerta>}

            {s.status === 'correcao_recebida' && !retomar && (
              <Alerta tipo="info">Correção recebida de {s.solicitante_nome}. Aguardando {s.responsavel_nome ?? 'o responsável'} retomar o atendimento.</Alerta>
            )}
            {retomar && <Retomar s={s} executar={executar} />}
            {editavel && !retomar && s.tipo === 'lote_emissao' && <RegistrarLote s={s} executar={executar} />}
            {editavel && !retomar && !cad && <AnexarEmitidos s={s} executar={executar} emitidos={saida.length} />}
            {editavel && s.status === 'em_atendimento' && <PedirAjuste s={s} executar={executar} referencias={cad ? REFERENCIAS_CADASTRO : REFERENCIAS} />}
            {editavel && !retomar && !cad && <Concluir s={s} executar={executar} emitidos={saida.length} />}
            {editavel && !retomar && cad && <ConcluirCadastro s={s} executar={executar} />}
            {saida.length > 0 && (
              <div className="cartao cartao-corpo at-bloco">
                <strong>Documentos emitidos {s.status === 'documentacao_disponivel' ? '(liberados)' : '(em conferência)'}</strong>
                <ul className="de-arqs">{saida.map((a) => <li key={a.id}><button className="btn sutil peq" onClick={() => setSel(a.id)}>{CATEGORIA[a.categoria]} · {a.nome}</button></li>)}</ul>
              </div>
            )}
            <div className="cartao cartao-corpo at-bloco">
              <strong>Histórico</strong>
              {detalhe ? <Historico mensagens={detalhe.mensagens} anexos={anexos} /> : <Carregando />}
            </div>
            {ABERTOS.includes(s.status) && pode('documentacao.cancelar') && <CancelarBotao s={s} />}
          </section>
        )}
        {!ampliado && (
          <div className="at-sep" role="separator" aria-orientation="vertical" aria-label="Ajustar a divisão dos quadros" aria-valuemin={22} aria-valuemax={60}
            aria-valuenow={Math.round(divisao)} tabIndex={0} onPointerDown={arrastar}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); ajustar(-2); } if (e.key === 'ArrowRight') { e.preventDefault(); ajustar(2); } }}>
            <button className="at-sep-btn" onClick={() => ajustar(-5)} aria-label="Diminuir o quadro de dados">‹</button>
            <span className="at-sep-pega" aria-hidden="true" />
            <button className="at-sep-btn" onClick={() => ajustar(5)} aria-label="Aumentar o quadro de dados">›</button>
          </div>
        )}
        <section className="at-dir" aria-label="Visualizador de anexos">
          {carregando && !detalhe ? <Carregando texto="Carregando anexos…" /> : (
            <VisualizadorAnexo anexos={anexos} selecionado={sel} aoSelecionar={setSel} ampliado={ampliado} aoAmpliar={setAmpliado} />
          )}
        </section>
      </div>
    </Layout>
  );
}

export type Executar = (f: () => Promise<ResultadoDoc>, ok: string) => Promise<boolean>;

function RegistrarLote({ s, executar }: { s: SolicitacaoDoc; executar: Executar }) {
  const { api } = useApp();
  const [numero, setNumero] = useRascunho(`travion-rascunho-lote-${s.id}`);
  const [gravando, setGravando] = useState(false);
  const registrado = s.retrato.lote_numero;
  return (
    <div className="cartao cartao-corpo at-bloco">
      <strong>{registrado ? `Lote registrado: ${registrado}` : 'Lote do ERP'}</strong>
      <span className="pequeno suave">{registrado ? 'A emissão desta primeira nota continua neste atendimento. Corrigir o número fica no histórico.' : 'Gere o lote no ERP e informe o número. Isso libera Emitir documentação para os próximos veículos.'}</span>
      <div className="at-linha">
        <input className="entrada" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Número do lote gerado no ERP" aria-label="Número do lote gerado no ERP" maxLength={60} />
        <button className="btn primario" disabled={gravando || !numero.trim()} onClick={async () => {
          setGravando(true);
          if (await executar(() => api.doc.registrarLote(s.id, numero), registrado ? 'Número do lote corrigido.' : 'Lote registrado. A emissão segue em atendimento.')) setNumero('');
          setGravando(false);
        }}>{registrado ? 'Corrigir número do lote' : 'Registrar lote do ERP'}</button>
      </div>
    </div>
  );
}

function AnexarEmitidos({ s, executar, emitidos }: { s: SolicitacaoDoc; executar: Executar; emitidos: number }) {
  const { api } = useApp();
  const [arqs, setArqs] = useState<ArquivoLocal[]>([]);
  const [gravando, setGravando] = useState(false);
  const cats: CategoriaAnexo[] = ['cte', 'mdfe', 'outro_emitido'];
  return (
    <div className="cartao cartao-corpo at-bloco">
      <strong>Documentos emitidos no ERP</strong>
      <span className="pequeno suave">{emitidos ? `${emitidos} anexado(s), em conferência.` : 'Anexe CT-e, MDF-e ou outro documento emitido. Anexar não conclui a solicitação.'}</span>
      <SeletorArquivos rotulo="Arquivos" categoria="cte" categorias={cats} itens={arqs} aoMudar={setArqs} />
      <div><button className="btn" disabled={gravando || !arqs.length} onClick={async () => {
        setGravando(true);
        try {
          const enviados = await enviarArquivos(arqs, (f) => api.doc.enviarArquivo(f), setArqs);
          if (await executar(() => api.doc.anexarEmitidos(s.id, enviados), 'Documentos anexados (em conferência).')) setArqs([]);
        } catch (e) { /* upload falhou: arquivos ficam na lista para tentar de novo */ void e; }
        setGravando(false);
      }}>{gravando ? 'Enviando…' : 'Anexar documentos emitidos'}</button></div>
    </div>
  );
}

export function PedirAjuste({ s, executar, referencias }: { s: SolicitacaoDoc; executar: Executar; referencias: Array<[string, string]> }) {
  const { api } = useApp();
  const [texto, setTexto] = useRascunho(`travion-rascunho-ajuste-${s.id}`);
  const [ref, setRef] = useState('');
  const [motivo, setMotivo] = useState<MotivoDevolucao | ''>('');
  const [outro, setOutro] = useState('');
  const [gravando, setGravando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const faltaOutro = motivo === 'outro' && !outro.trim();
  return (
    <div className="cartao cartao-corpo at-bloco">
      <strong>Solicitar ajuste ao {s.tipo === 'cadastro' ? 'solicitante' : 'comercial'}</strong>
      <div className="at-linha">
        <label className="campo"><span>Motivo</span>
          <select className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDevolucao)} aria-label="Motivo da devolução">
            <option value="">Escolha o motivo</option>
            {MOTIVOS_ESCOLHA.map((m) => <option key={m} value={m}>{MOTIVO_DEVOLUCAO[m]}</option>)}
          </select>
        </label>
        <label className="campo"><span>Referente a</span>
          <select className="entrada" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Referente a">
            {referencias.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </label>
      </div>
      {tentou && !motivo && <small className="erro-campo">Escolha o motivo da devolução.</small>}
      {motivo === 'outro' && (
        <input className="entrada" value={outro} onChange={(e) => setOutro(e.target.value)} maxLength={200}
          placeholder="Qual é o motivo?" aria-label="Descrição do motivo Outro" />
      )}
      {tentou && faltaOutro && <small className="erro-campo">Descreva o motivo "Outro".</small>}
      <textarea className="entrada" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000}
        placeholder="Mensagem ao solicitante: escreva exatamente o que falta ou precisa ser corrigido" aria-label="Descrição do ajuste" />
      {tentou && !texto.trim() && <small className="erro-campo">Descreva o ajuste antes de enviar.</small>}
      <div><button className="btn" disabled={gravando} onClick={async () => {
        setTentou(true);
        if (!texto.trim() || !motivo || faltaOutro) return;
        setGravando(true);
        if (await executar(() => api.doc.solicitarAjuste(s.id, texto.trim(), ref || null, motivo, motivo === 'outro' ? outro.trim() : null), `Ajuste enviado a ${s.solicitante_nome}.`)) {
          setTexto(''); setMotivo(''); setOutro(''); setTentou(false);
        }
        setGravando(false);
      }}>{gravando ? 'Enviando…' : 'Solicitar ajuste'}</button></div>
    </div>
  );
}

export function Retomar({ s, executar }: { s: SolicitacaoDoc; executar: Executar }) {
  const { api } = useApp();
  const [gravando, setGravando] = useState(false);
  return (
    <div className="cartao cartao-corpo at-bloco at-retomar">
      <strong>Correção recebida de {s.solicitante_nome}</strong>
      <span className="pequeno suave">Confira a resposta no histórico e retome o atendimento para continuar. O tempo até retomar conta como espera na fila.</span>
      <div><button className="btn primario" disabled={gravando} onClick={async () => {
        setGravando(true);
        await executar(() => api.doc.retomar(s.id), 'Atendimento retomado.');
        setGravando(false);
      }}>{gravando ? 'Retomando…' : 'Retomar atendimento'}</button></div>
    </div>
  );
}

function Concluir({ s, executar, emitidos }: { s: SolicitacaoDoc; executar: Executar; emitidos: number }) {
  const { api } = useApp();
  const [conferi, setConferi] = useState(false);
  const [gravando, setGravando] = useState(false);
  const faltas = useMemo(() => [
    !emitidos && 'anexar ao menos um documento emitido',
    s.tipo === 'lote_emissao' && !s.lote_id && 'registrar o número do lote',
    s.status !== 'em_atendimento' && 'aguardar a resposta da pendência',
  ].filter(Boolean) as string[], [emitidos, s]);
  return (
    <div className="cartao cartao-corpo at-bloco at-concluir">
      <strong>Liberar ao comercial</strong>
      {faltas.length ? <span className="pequeno suave">Antes, falta: {faltas.join('; ')}.</span> : (
        <label className="at-check"><input type="checkbox" checked={conferi} onChange={(e) => setConferi(e.target.checked)} /> Conferi os documentos emitidos e estão corretos.</label>
      )}
      <div><button className="btn primario" disabled={!!faltas.length || !conferi || gravando} onClick={async () => {
        setGravando(true);
        await executar(() => api.doc.concluir(s.id), 'Documentação disponível ao comercial.');
        setGravando(false);
      }}>{gravando ? 'Liberando…' : 'Marcar documentação disponível'}</button></div>
    </div>
  );
}

// Cadastro: o apoio fez o cadastro à mão no ERP e confirma. Sem documento emitido; referência do ERP opcional.
function ConcluirCadastro({ s, executar }: { s: SolicitacaoDoc; executar: Executar }) {
  const { api } = useApp();
  const [ref, setRef] = useRascunho(`travion-rascunho-erp-${s.id}`);
  const [retorno, setRetorno] = useRascunho(`travion-rascunho-retorno-${s.id}`);
  const [gravando, setGravando] = useState(false);
  const pendente = s.status !== 'em_atendimento';
  return (
    <div className="cartao cartao-corpo at-bloco at-concluir">
      <strong>Concluir cadastro</strong>
      <span className="pequeno suave">Faça o cadastro do motorista e dos veículos no ERP e confirme aqui. O Travion não cadastra no ERP sozinho.</span>
      <label className="campo"><span>Referência do cadastro no ERP (opcional)</span>
        <input className="entrada" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} placeholder="Código ou número no ERP" />
      </label>
      <label className="campo"><span>Retorno ao solicitante</span>
        <textarea className="entrada" rows={2} value={retorno} onChange={(e) => setRetorno(e.target.value)} maxLength={2000}
          placeholder="Ex.: motorista e cavalo cadastrados; carreta já existia no ERP." />
      </label>
      {pendente && <span className="pequeno suave">Há pendência aguardando resposta de {s.solicitante_nome}: resolva antes de concluir.</span>}
      <div><button className="btn primario" disabled={pendente || gravando} onClick={async () => {
        setGravando(true);
        if (await executar(() => api.doc.concluirCadastro(s.id, ref.trim() || null, retorno.trim() || null), `Cadastro da placa ${fmtPlaca(s.placa)} concluído. ${s.solicitante_nome} foi avisado.`)) { setRef(''); setRetorno(''); }
        setGravando(false);
      }}>{gravando ? 'Confirmando…' : 'Confirmar cadastro concluído'}</button></div>
    </div>
  );
}

function CancelarBotao({ s }: { s: SolicitacaoDoc }) {
  const [aberto, setAberto] = useState(false);
  return <div>{aberto && <CancelarDoc s={s} aoFechar={() => setAberto(false)} />}<button className="btn perigo peq" onClick={() => setAberto(true)}>Cancelar solicitação</button></div>;
}
