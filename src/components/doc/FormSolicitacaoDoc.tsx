// Formulário do comercial: "Gerar lote e emissão" (primeira nota: lote + CT-e num só envio) ou
// "Emitir documentação" (próximos veículos do lote já registrado). Os dados do embarque vão sozinhos.

import { useMemo, useState } from 'react';
import { mensagemErro, type ResultadoDoc } from '../../data/api';
import { useDoc } from '../../data/documentacao';
import { useApp } from '../../data/store';
import {
  OPERACAO, PAGAMENTO, PEDAGIO, PLACA_RE, UNIDADE_DOC, avisosDuplicidade, normalizarPlaca,
} from '../../lib/documentacao';
import { cidadeAnuncio } from '../../lib/anuncio';
import type { Embarque, FormaPagamento, LoteErp, Pedagio, SolicitacaoDoc, TipoOperacao, UnidadeFreteDoc } from '../../types';
import { Alerta, Modal } from '../ui';
import { type ArquivoLocal, SeletorArquivos, enviarArquivos } from './Comum';

type SimNao = 'sim' | 'nao' | '';

function SimNaoCampo({ rotulo, valor, aoMudar }: { rotulo: string; valor: SimNao; aoMudar: (v: SimNao) => void }) {
  return (
    <fieldset className="campo sn">
      <legend>{rotulo} *</legend>
      <div className="sn-opcoes">
        {(['sim', 'nao'] as const).map((v) => (
          <label key={v} className={`sn-op${valor === v ? ' ativo' : ''}`}>
            <input type="radio" checked={valor === v} onChange={() => aoMudar(v)} />{v === 'sim' ? 'Sim' : 'Não'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Opcoes<T extends string>({ rotulo, valor, opcoes, aoMudar }: { rotulo: string; valor: T | ''; opcoes: Record<T, string>; aoMudar: (v: T) => void }) {
  return (
    <fieldset className="campo sn">
      <legend>{rotulo} *</legend>
      <div className="sn-opcoes">
        {(Object.keys(opcoes) as T[]).map((k) => (
          <label key={k} className={`sn-op${valor === k ? ' ativo' : ''}`}>
            <input type="radio" checked={valor === k} onChange={() => aoMudar(k)} />{opcoes[k]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function lerValor(t: string): number | null {
  const s = t.trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 && Math.round(n * 100) === n * 100 ? n : NaN;
}

export function FormSolicitacaoDoc({ embarque, lote, doEmbarque, aoFechar, aoEnviada }: {
  embarque: Embarque; lote: LoteErp | null; doEmbarque: SolicitacaoDoc[]; aoFechar: () => void; aoEnviada: (s: SolicitacaoDoc, aviso?: string) => void;
}) {
  const { api, estado } = useApp();
  const { aplicar } = useDoc();
  const fin = estado.financeiro[embarque.id];
  const unidadeFin = (u: string | undefined): UnidadeFreteDoc => (u === 'rs_viagem' ? 'rs_viagem' : 'rs_tonelada');
  const fmtIni = (v: number | null | undefined) => (v ? v.toFixed(2).replace('.', ',') : '');
  const inicial = !lote;
  const loteInicial = lote ? doEmbarque.find((s) => s.id === lote.solicitacao_id) : undefined;

  const [placa, setPlaca] = useState('');
  const [reboques, setReboques] = useState('');
  const [arquivos, setArquivos] = useState<ArquivoLocal[]>([]);
  const [fEmp, setFEmp] = useState(fmtIni(fin?.frete_empresa));
  const [uEmp, setUEmp] = useState<UnidadeFreteDoc>(unidadeFin(fin?.unidade_frete));
  const [fMot, setFMot] = useState(fmtIni(fin?.frete_motorista));
  const [uMot, setUMot] = useState<UnidadeFreteDoc>(unidadeFin(fin?.unidade_frete));
  const [operacao, setOperacao] = useState<TipoOperacao | ''>('');
  const [pagamento, setPagamento] = useState<FormaPagamento | ''>('');
  const [pedagio, setPedagio] = useState<Pedagio | ''>('');
  const [exigeObs, setExigeObs] = useState<SimNao>('');
  const [obsCte, setObsCte] = useState('');
  const [ctePorNf, setCtePorNf] = useState<SimNao>('');
  const [obs, setObs] = useState('');
  const [chave] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [confirmouAvisos, setConfirmouAvisos] = useState(false);

  const pl = normalizarPlaca(placa);
  const rbs = reboques.split(/[,;\s]+/).map(normalizarPlaca).filter(Boolean);
  const vEmp = lerValor(fEmp);
  const vMot = lerValor(fMot);
  const nfs = arquivos.filter((a) => a.categoria === 'nf');
  const evid = arquivos.filter((a) => a.categoria === 'evidencia_frete');
  const problemas: Record<string, string | null> = {
    placa: !PLACA_RE.test(pl) ? 'Placa no formato ABC1D23 ou ABC1234.' : null,
    reboques: rbs.some((x) => !PLACA_RE.test(x)) ? 'Confira as placas das carretas.' : null,
    nf: !nfs.length ? 'Anexe a(s) NF(s) deste veículo.' : null,
    fEmp: vEmp === null || Number.isNaN(vEmp) ? 'Valor em reais maior que zero (ex.: 150,00).' : null,
    fMot: vMot === null || Number.isNaN(vMot) ? 'Valor em reais maior que zero (ex.: 130,00).' : null,
    operacao: inicial && !operacao ? 'Escolha o tipo de operação.' : null,
    evid: inicial && !evid.length ? 'Anexe a evidência do frete.' : null,
    pagamento: !pagamento ? 'Escolha a forma de pagamento.' : null,
    pedagio: !pedagio ? 'Escolha o pedágio.' : null,
    exigeObs: !exigeObs ? 'Responda Sim ou Não.' : null,
    obsCte: exigeObs === 'sim' && !obsCte.trim() ? 'Escreva a observação que o cliente exige.' : null,
    ctePorNf: !ctePorNf ? 'Responda Sim ou Não.' : null,
  };
  const valido = Object.values(problemas).every((p) => !p);
  const avisos = useMemo(() => avisosDuplicidade(pl, nfs.map((n) => n.arquivo.name), doEmbarque), [pl, nfs, doEmbarque]);
  const msg = (k: string) => (tentou && problemas[k] ? <small className="erro-campo">{problemas[k]}</small> : null);

  const enviar = async () => {
    setTentou(true);
    setErro(null);
    if (!valido) return;
    if (avisos.length && !confirmouAvisos) { setConfirmouAvisos(true); return; }
    try {
      setEnviando('Enviando anexos…');
      const anexos = await enviarArquivos(arquivos, (f) => api.doc.enviarArquivo(f), setArquivos);
      setEnviando('Gravando a solicitação…');
      const r: ResultadoDoc = await api.doc.criar(embarque.id, {
        placa: pl, placas_reboque: rbs, frete_empresa: vEmp!, frete_empresa_unidade: uEmp, frete_motorista: vMot!, frete_motorista_unidade: uMot,
        tipo_operacao: inicial ? (operacao as TipoOperacao) : null, forma_pagamento: pagamento as FormaPagamento, pedagio: pedagio as Pedagio,
        exige_obs_cte: exigeObs === 'sim', obs_cte: exigeObs === 'sim' ? obsCte.trim() : null, cte_por_nf: ctePorNf === 'sim',
        observacoes: obs.trim() || null, chave_envio: chave,
      }, anexos);
      aplicar(r);
      if (r.status === 'inicial_aberta') {
        aoEnviada(r.registro, `Já existe a solicitação inicial nº ${r.registro.numero} para este embarque. Acompanhe por ela; nada novo foi criado.`);
      } else aoEnviada(r.registro);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(null);
    }
  };

  const r = embarque;
  return (
    <Modal titulo={inicial ? 'Gerar lote e emissão' : 'Emitir documentação'} aoFechar={() => { if (!enviando) aoFechar(); }} rodape={<>
      <button className="btn" onClick={aoFechar} disabled={!!enviando}>Cancelar</button>
      <button className="btn primario" onClick={() => void enviar()} disabled={!!enviando}>
        {enviando ?? (avisos.length && confirmouAvisos ? 'Enviar mesmo assim' : 'Enviar ao apoio')}
      </button>
    </>}>
      <div className="fsd">
        <div className="fsd-auto">
          <strong>{cidadeAnuncio(r.origem_cidade, r.origem_uf)} ➜ {cidadeAnuncio(r.destino_cidade, r.destino_uf)}</strong>
          <span className="pequeno suave">
            Cliente, carteira, filial, centro de custo, origem, destino, locais e produto vão automaticamente do embarque.
            {lote ? <> Lote <strong>{lote.numero}</strong>{loteInicial?.tipo_operacao ? ` · ${OPERACAO[loteInicial.tipo_operacao]}` : ''}.</> : ' Primeira nota: o apoio gera o lote no ERP e emite o CT-e nesta mesma solicitação.'}
          </span>
        </div>

        <div className="fsd-grade">
          <label className="campo"><span>Placa do cavalo *</span>
            <input className="entrada" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" maxLength={8} autoCapitalize="characters" />
            {msg('placa')}
          </label>
          <label className="campo"><span>Placas das carretas (opcional)</span>
            <input className="entrada" value={reboques} onChange={(e) => setReboques(e.target.value.toUpperCase())} placeholder="ABC1D24, ABC1D25" />
            {msg('reboques')}
          </label>
        </div>

        <SeletorArquivos rotulo="NF(s) deste veículo" categoria="nf" itens={arquivos} aoMudar={setArquivos} obrigatorio ajuda="PDF ou imagem; pode anexar várias." />
        {msg('nf')}

        <div className="fsd-grade">
          <div className="campo"><span>Frete empresa *</span>
            <div className="fsd-valor">
              <input className="entrada" inputMode="decimal" value={fEmp} onChange={(e) => setFEmp(e.target.value)} placeholder="0,00" aria-label="Frete empresa em reais" />
              <select className="entrada" value={uEmp} onChange={(e) => setUEmp(e.target.value as UnidadeFreteDoc)} aria-label="Unidade do frete empresa">
                {(Object.keys(UNIDADE_DOC) as UnidadeFreteDoc[]).map((u) => <option key={u} value={u}>{UNIDADE_DOC[u]}</option>)}
              </select>
            </div>
            {msg('fEmp')}
          </div>
          <div className="campo"><span>Frete motorista *</span>
            <div className="fsd-valor">
              <input className="entrada" inputMode="decimal" value={fMot} onChange={(e) => setFMot(e.target.value)} placeholder="0,00" aria-label="Frete motorista em reais" />
              <select className="entrada" value={uMot} onChange={(e) => setUMot(e.target.value as UnidadeFreteDoc)} aria-label="Unidade do frete motorista">
                {(Object.keys(UNIDADE_DOC) as UnidadeFreteDoc[]).map((u) => <option key={u} value={u}>{UNIDADE_DOC[u]}</option>)}
              </select>
            </div>
            {msg('fMot')}
          </div>
        </div>
        {fin && <small className="suave">Valores trazidos do financeiro do embarque para conferência; alterar aqui vale só para esta solicitação.</small>}

        {inicial && <><Opcoes rotulo="Tipo de operação" valor={operacao} opcoes={OPERACAO} aoMudar={setOperacao} />{msg('operacao')}</>}
        {inicial && <><SeletorArquivos rotulo="Evidência do frete" categoria="evidencia_frete" itens={arquivos} aoMudar={setArquivos} obrigatorio ajuda="Print ou PDF com o valor combinado; pode anexar vários." />{msg('evid')}</>}

        <Opcoes rotulo="Forma de pagamento" valor={pagamento} opcoes={PAGAMENTO} aoMudar={setPagamento} />{msg('pagamento')}
        <Opcoes rotulo="Pedágio" valor={pedagio} opcoes={PEDAGIO} aoMudar={setPedagio} />{msg('pedagio')}
        <SimNaoCampo rotulo="Cliente exige observação no CT-e?" valor={exigeObs} aoMudar={setExigeObs} />{msg('exigeObs')}
        {exigeObs === 'sim' && (
          <label className="campo"><span>Qual observação? *</span>
            <textarea className="entrada" rows={2} maxLength={1000} value={obsCte} onChange={(e) => setObsCte(e.target.value)} />
            {msg('obsCte')}
          </label>
        )}
        <SimNaoCampo rotulo="Um CT-e por NF?" valor={ctePorNf} aoMudar={setCtePorNf} />{msg('ctePorNf')}
        <label className="campo"><span>Observações</span>
          <textarea className="entrada" rows={2} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>

        {avisos.length > 0 && (
          <Alerta tipo="aviso"><span><strong>Possível duplicidade.</strong> {avisos.join(' ')} {confirmouAvisos ? 'Se for outra viagem, clique em "Enviar mesmo assim".' : ''}</span></Alerta>
        )}
        {tentou && !valido && <Alerta tipo="erro">Confira os campos destacados.</Alerta>}
        {erro && <Alerta tipo="erro"><span><strong>Não enviado.</strong> {erro} Os dados e anexos continuam aqui.</span></Alerta>}
        <small className="suave">A solicitação só aparece para o apoio depois que o servidor confirmar a gravação.</small>
      </div>
    </Modal>
  );
}
