// Detalhes do embarque → Documentação (visão do comercial): lote, ação de solicitação, lista de solicitações,
// pendências com resposta, histórico e documentos emitidos liberados pelo apoio.

import { useEffect, useMemo, useState } from 'react';
import { mensagemErro } from '../../data/api';
import { useDetalheDoc, useDoc } from '../../data/documentacao';
import { useApp } from '../../data/store';
import {
  ABERTOS, CATEGORIA, CATEGORIAS_SAIDA, OPERACAO, textoPagamento, PEDAGIO, TIPO_DOC, acaoDocumentacao, fmtFrete, fmtPlaca, rotaDoc, tempoDoc, vezDe,
} from '../../lib/documentacao';
import { fmtDataAsHora } from '../../lib/formato';
import type { Embarque, SolicitacaoDoc } from '../../types';
import { Alerta, Carregando, EstadoVazio, Modal, useAviso } from '../ui';
import { type ArquivoLocal, Historico, JanelaAnexos, LinhaInfo, SeletorArquivos, StatusDocPill, TipoNumero, enviarArquivos, useAgora, useArquivo } from './Comum';
import { FormSolicitacaoDoc } from './FormSolicitacaoDoc';

/** Solicitações e lote do embarque, buscados ao abrir (a fila sincronizada pode não ter as antigas). */
function useDocEmbarque(embarqueId: string) {
  const { estado, carregarEmbarque } = useDoc();
  const avisar = useAviso();
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    setCarregando(true);
    carregarEmbarque(embarqueId).catch((e) => avisar('erro', mensagemErro(e))).finally(() => setCarregando(false));
  }, [embarqueId, carregarEmbarque, avisar]);
  const doEmbarque = useMemo(() => Object.values(estado.solicitacoes).filter((s) => s.embarque_id === embarqueId)
    .sort((a, b) => b.numero - a.numero), [estado.solicitacoes, embarqueId]);
  const lote = estado.lotes[embarqueId];
  return { carregando, doEmbarque, lote, acao: acaoDocumentacao(lote, doEmbarque) };
}

/** Botão de documentação para atalhos fora da ficha (Detalhes rápidos da Lista de Fretes). */
export function BotaoDocumentacao({ embarque, aoSolicitar, aoAcompanhar }: {
  embarque: Embarque; aoSolicitar: () => void; aoAcompanhar: (solicitacaoId: string) => void;
}) {
  const { pode } = useApp();
  const { carregando, acao } = useDocEmbarque(embarque.id);
  if (!pode('documentacao.solicitar') || embarque.situacao !== 'ativo' || embarque.encerrado_em) return null;
  if (carregando) return <button className="btn" disabled>Documentação…</button>;
  return acao.tipo === 'gerar' ? <button className="btn primario" onClick={aoSolicitar}>Gerar lote e emissão</button>
    : acao.tipo === 'acompanhar' ? <button className="btn" onClick={() => aoAcompanhar(acao.solicitacao.id)}>Acompanhar solicitação</button>
    : <button className="btn primario" onClick={aoSolicitar}>Emitir documentação</button>;
}

/** Formulário de solicitação aberto direto da Lista de Fretes. */
export function SolicitarDocumentacao({ embarque, aoFechar, aoEnviada }: { embarque: Embarque; aoFechar: () => void; aoEnviada: (s: SolicitacaoDoc) => void }) {
  const avisar = useAviso();
  const { carregando, doEmbarque, lote } = useDocEmbarque(embarque.id);
  if (carregando) return null;
  return (
    <FormSolicitacaoDoc embarque={embarque} lote={lote ?? null} doEmbarque={doEmbarque} aoFechar={aoFechar}
      aoEnviada={(s, aviso) => { avisar(aviso ? 'info' : 'ok', aviso ?? `${TIPO_DOC[s.tipo]} nº ${s.numero} enviada ao apoio.`); aoEnviada(s); }} />
  );
}

export function DocumentacaoEmbarque({ embarque, solicitacaoInicial }: { embarque: Embarque; solicitacaoInicial?: string | null }) {
  const { pode } = useApp();
  const { estado } = useDoc();
  const avisar = useAviso();
  const agora = useAgora();
  const [aberta, setAberta] = useState<string | null>(solicitacaoInicial ?? null);
  const [form, setForm] = useState(false);
  const { carregando, doEmbarque, lote, acao } = useDocEmbarque(embarque.id);

  useEffect(() => { setAberta(solicitacaoInicial ?? null); }, [solicitacaoInicial]);
  const podeSolicitar = pode('documentacao.solicitar') && embarque.situacao === 'ativo' && !embarque.encerrado_em;

  if (aberta && estado.solicitacoes[aberta]) {
    return <SolicitacaoComercial s={estado.solicitacoes[aberta]} aoVoltar={() => setAberta(null)} />;
  }

  return (
    <div className="de">
      <div className="cartao cartao-corpo de-topo">
        <div>
          <span className="rot">Lote</span>
          <strong className="de-lote">{lote ? lote.numero : 'Ainda não registrado'}</strong>
          {lote && <span className="pequeno suave">Registrado por {lote.registrado_por_nome} em {fmtDataAsHora(lote.registrado_em)}</span>}
        </div>
        {podeSolicitar && (
          acao.tipo === 'gerar' ? <button className="btn primario" onClick={() => setForm(true)}>Gerar lote e emissão</button>
          : acao.tipo === 'acompanhar' ? <button className="btn" onClick={() => setAberta(acao.solicitacao.id)}>Acompanhar solicitação</button>
          : <button className="btn primario" onClick={() => setForm(true)}>Emitir documentação</button>
        )}
      </div>
      {acao.tipo === 'acompanhar' && (
        <Alerta tipo="info">A primeira nota (lote e emissão) já foi enviada. Quando o apoio registrar o lote, o botão Emitir documentação libera os próximos veículos.</Alerta>
      )}

      {carregando && !doEmbarque.length ? <Carregando texto="Carregando solicitações…" /> : !doEmbarque.length ? (
        <div className="cartao"><EstadoVazio titulo="Nenhuma solicitação de documentação"><p>Use “Gerar lote e emissão” quando a primeira nota estiver pronta.</p></EstadoVazio></div>
      ) : (
        <ul className="de-lista">
          {doEmbarque.map((s) => {
            const t = tempoDoc(s, agora);
            return (
              <li key={s.id}>
                <button className="cartao de-item" onClick={() => setAberta(s.id)}>
                  <div className="de-item-l1"><TipoNumero s={s} /><StatusDocPill status={s.status} /></div>
                  <div className="de-item-l2">
                    <span><strong>{fmtPlaca(s.placa)}</strong> · {rotaDoc(s)}</span>
                    <span>{s.retrato.cliente} · Lote {s.retrato.lote_numero ?? 'a gerar'}</span>
                  </div>
                  <div className="de-item-l3 pequeno">
                    <span>Apoio: {s.responsavel_nome ?? 'ainda não assumida'}</span>
                    <span>{t.rotulo}: {t.texto}</span>
                    {s.status === 'aguardando_informacao' && <span className="de-pend">Pendência: sua resposta</span>}
                    {s.status === 'documentacao_disponivel' && <span className="de-ok">Documentos disponíveis</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {form && (
        <FormSolicitacaoDoc embarque={embarque} lote={lote ?? null} doEmbarque={doEmbarque} aoFechar={() => setForm(false)}
          aoEnviada={(s, aviso) => { setForm(false); setAberta(s.id); avisar(aviso ? 'info' : 'ok', aviso ?? `${TIPO_DOC[s.tipo]} nº ${s.numero} enviada ao apoio.`); }} />
      )}
    </div>
  );
}

function SolicitacaoComercial({ s, aoVoltar }: { s: SolicitacaoDoc; aoVoltar: () => void }) {
  const { api, pode, estado: app } = useApp();
  const { aplicar, carregarDetalhe } = useDoc();
  const { detalhe, carregando } = useDetalheDoc(s.id);
  const avisar = useAviso();
  const arquivo = useArquivo();
  const agora = useAgora();
  const [ver, setVer] = useState<string | null>(null);
  const [resposta, setResposta] = useState('');
  const [arqs, setArqs] = useState<ArquivoLocal[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const t = tempoDoc(s, agora);
  const anexos = detalhe?.anexos ?? [];
  const entrada = anexos.filter((a) => !CATEGORIAS_SAIDA.includes(a.categoria));
  // Documentos de saída só aparecem ao comercial depois da confirmação do apoio.
  const emitidos = s.status === 'documentacao_disponivel' ? anexos.filter((a) => CATEGORIAS_SAIDA.includes(a.categoria)) : [];
  const pendencia = [...(detalhe?.mensagens ?? [])].reverse().find((m) => m.tipo === 'pendencia');
  const eu = app.sessao?.perfil.id;
  const podeCancelar = ABERTOS.includes(s.status) && (pode('documentacao.cancelar') || (s.solicitante_id === eu && s.status === 'enviado'));

  const responder = async () => {
    setErro(null);
    if (!resposta.trim()) { setErro('Escreva a resposta para o apoio.'); return; }
    setEnviando(true);
    try {
      const enviados = await enviarArquivos(arqs, (f) => api.doc.enviarArquivo(f), setArqs);
      const r = await api.doc.responder(s.id, resposta.trim(), enviados);
      aplicar(r);
      await carregarDetalhe(s.id);
      setResposta(''); setArqs([]);
      avisar('ok', 'Resposta enviada ao apoio.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setEnviando(false); }
  };

  return (
    <div className="de">
      <button className="btn sutil peq de-voltar" onClick={aoVoltar}>← Todas as solicitações</button>
      <div className="cartao cartao-corpo">
        <div className="de-item-l1"><TipoNumero s={s} /><StatusDocPill status={s.status} /></div>
        <p className="de-rota"><strong>{fmtPlaca(s.placa)}</strong>{s.placas_reboque.length ? ` + ${s.placas_reboque.map(fmtPlaca).join(', ')}` : ''} · {rotaDoc(s)}</p>
        <div className="de-grade pequeno">
          <LinhaInfo rot="Cliente" valor={s.retrato.cliente} />
          <LinhaInfo rot="Lote" valor={s.retrato.lote_numero ?? 'a gerar'} />
          <LinhaInfo rot="Responsável do apoio" valor={s.responsavel_nome ?? 'ainda não assumida'} />
          <LinhaInfo rot={t.rotulo} valor={t.texto} />
          <LinhaInfo rot="Enviada por" valor={`${s.solicitante_nome} em ${fmtDataAsHora(s.enviado_em)}`} />
          {s.status === 'documentacao_disponivel' && <LinhaInfo rot="Liberada por" valor={`${s.concluido_por_nome} em ${fmtDataAsHora(s.concluido_em)}`} />}
          {s.status === 'cancelado' && <LinhaInfo rot="Cancelada" valor={`${s.cancelado_por_nome}: ${s.cancelado_motivo}`} />}
          {vezDe(s) && <LinhaInfo rot="Aguardando" valor={vezDe(s)} />}
        </div>
      </div>

      {s.status === 'correcao_recebida' && <Alerta tipo="info">Sua correção foi enviada. {s.responsavel_nome} vai retomar o atendimento.</Alerta>}
      {s.status === 'aguardando_informacao' && (
        <div className="cartao cartao-corpo de-pendencia">
          <strong>O apoio precisa de uma informação</strong>
          <p>{pendencia?.texto ?? '…'}</p>
          {pendencia?.referencia && <span className="pequeno suave">Referente a: {CATEGORIA[pendencia.referencia as keyof typeof CATEGORIA] ?? pendencia.referencia}</span>}
          {pode('documentacao.solicitar') && (
            <>
              <label className="campo"><span>Sua resposta *</span>
                <textarea className="entrada" rows={3} value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={4000} />
              </label>
              <SeletorArquivos rotulo="Anexar correção (opcional)" categoria="correcao" categorias={['correcao', 'nf', 'evidencia_frete']} itens={arqs} aoMudar={setArqs}
                ajuda="Os arquivos anteriores continuam guardados; o novo entra como outra versão." />
              {erro && <Alerta tipo="erro">{erro}</Alerta>}
              <div><button className="btn primario" disabled={enviando} onClick={() => void responder()}>{enviando ? 'Enviando…' : 'Responder ao apoio'}</button></div>
            </>
          )}
        </div>
      )}

      {s.status === 'documentacao_disponivel' && (
        <div className="cartao cartao-corpo">
          <strong>Documentos emitidos</strong>
          <ul className="de-arqs">
            {emitidos.map((a) => (
              <li key={a.id}>
                <span><span className="badge info">{CATEGORIA[a.categoria]}</span> {a.nome}</span>
                <span className="grupo-btn"><button className="btn peq" onClick={() => setVer(a.id)}>Ver</button><button className="btn peq" onClick={() => void arquivo(a, 'baixar')}>Baixar</button></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cartao cartao-corpo">
        <strong>Dados enviados</strong>
        <div className="de-grade pequeno">
          <LinhaInfo rot="Frete empresa" valor={fmtFrete(s.frete_empresa, s.frete_empresa_unidade)} />
          <LinhaInfo rot="Frete motorista" valor={fmtFrete(s.frete_motorista, s.frete_motorista_unidade)} />
          {s.tipo_operacao && <LinhaInfo rot="Tipo de operação" valor={OPERACAO[s.tipo_operacao]} />}
          <LinhaInfo rot="Pagamento" valor={textoPagamento(s)} />
          <LinhaInfo rot="Pedágio" valor={PEDAGIO[s.pedagio]} />
          <LinhaInfo rot="Observação no CT-e" valor={s.exige_obs_cte ? s.obs_cte : 'Não exigida'} />
          <LinhaInfo rot="Um CT-e por NF" valor={s.cte_por_nf ? 'Sim' : 'Não'} />
          {s.observacoes && <LinhaInfo rot="Observações" valor={s.observacoes} />}
        </div>
        <strong style={{ marginTop: 10 }}>Anexos enviados</strong>
        {carregando ? <Carregando /> : (
          <ul className="de-arqs">
            {entrada.map((a) => (
              <li key={a.id}>
                <span><span className="badge">{CATEGORIA[a.categoria]}</span> {a.nome}{a.solicitacao_id !== s.id ? ' (da solicitação do lote)' : ''}</span>
                <span className="grupo-btn"><button className="btn peq" onClick={() => setVer(a.id)}>Ver</button><button className="btn peq" onClick={() => void arquivo(a, 'baixar')}>Baixar</button></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cartao cartao-corpo">
        <strong>Histórico</strong>
        {detalhe ? <Historico mensagens={detalhe.mensagens} anexos={anexos} /> : <Carregando />}
      </div>
      {podeCancelar && <div><button className="btn perigo peq" onClick={() => setCancelar(true)}>Cancelar solicitação</button></div>}

      {ver && <JanelaAnexos titulo={`${TIPO_DOC[s.tipo]} nº ${s.numero}`} anexos={[...entrada, ...emitidos]} inicial={ver} aoFechar={() => setVer(null)} />}
      {cancelar && <CancelarDoc s={s} aoFechar={() => setCancelar(false)} />}
    </div>
  );
}

export function CancelarDoc({ s, aoFechar }: { s: SolicitacaoDoc; aoFechar: () => void }) {
  const { api } = useApp();
  const { aplicar } = useDoc();
  const avisar = useAviso();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo={s.tipo === 'estadia' ? `Cancelar estadia ${s.est_codigo ?? ''}` : `Cancelar ${TIPO_DOC[s.tipo]} nº ${s.numero}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar} disabled={enviando}>Voltar</button>
      <button className="btn perigo" disabled={enviando} onClick={async () => {
        setErro(null);
        if (!motivo.trim()) { setErro('Informe o motivo do cancelamento.'); return; }
        setEnviando(true);
        try { aplicar(await api.doc.cancelar(s.id, motivo.trim())); avisar('ok', 'Solicitação cancelada.'); aoFechar(); }
        catch (e) { setErro(mensagemErro(e)); } finally { setEnviando(false); }
      }}>{enviando ? 'Cancelando…' : 'Cancelar solicitação'}</button>
    </>}>
      <p>O histórico e os anexos ficam guardados.</p>
      <label className="campo"><span>Motivo *</span><textarea className="entrada" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} /></label>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
