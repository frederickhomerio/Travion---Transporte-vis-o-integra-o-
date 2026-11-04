// Conferência automática dos participantes: NF × CT-e (remetente, destinatário, coleta, entrega e cliente pagador).
// Quem lê os arquivos é o fluxo do n8n (PDF/imagem por IA hoje; XML direto quando houver integração com o ERP).
// O resultado só AVISA: não bloqueia a liberação ao comercial.
import { useState } from 'react';
import { useApp } from '../../data/store';
import { mensagemErro } from '../../data/api';
import { useAviso } from '../ui';
import { fmtDataAsHora } from '../../lib/formato';
import type { AnexoDoc, ConferenciaParticipantes as Conferencia, ResultadoLinhaConferencia, StatusConferencia } from '../../types';

const ROTULO_STATUS: Record<StatusConferencia, string> = {
  processando: 'Conferindo…', conferido: 'Confere', alerta: 'Atenção', divergente: 'Divergência', erro: 'Não conferido',
};
const ROTULO_LINHA: Record<ResultadoLinhaConferencia, string> = { ok: 'Confere', alerta: 'Atenção', divergente: 'Diverge', nao_lido: 'Não lido' };

export function ConferenciaParticipantes({ conferencias, anexos }: { conferencias: Conferencia[]; anexos: AnexoDoc[] }) {
  if (!conferencias.length) return null;
  return (
    <div className="cartao cartao-corpo at-bloco cp-bloco">
      <strong>Conferência automática NF × CT-e</strong>
      <span className="pequeno suave">Participantes lidos dos arquivos e comparados por CNPJ/CPF e município. É um aviso: a decisão de liberar continua com o apoio.</span>
      {conferencias.map((c) => <Cartao key={c.id} c={c} nome={anexos.find((a) => a.id === c.anexo_id)?.nome ?? 'CT-e'} />)}
    </div>
  );
}

function Cartao({ c, nome }: { c: Conferencia; nome: string }) {
  const { api, pode } = useApp();
  const avisar = useAviso();
  const [enviando, setEnviando] = useState(false);
  const reconferir = async () => {
    setEnviando(true);
    try { await api.doc.reconferirParticipantes(c.id); } catch (e) { avisar('erro', mensagemErro(e)); }
    setEnviando(false);
  };
  return (
    <div className={`cp-cartao cp-${c.status}`}>
      <div className="cp-topo">
        <span className="cp-nome">{nome}</span>
        <span className={`cp-selo cp-selo-${c.status}`}>{ROTULO_STATUS[c.status]}</span>
      </div>
      {c.status === 'processando' && <span className="pequeno suave">Lendo a nota e o CT-e. O resultado aparece aqui sozinho em alguns segundos.</span>}
      {c.status === 'erro' && <span className="pequeno">{c.mensagem ?? 'Não foi possível ler os arquivos.'} Confira manualmente ou tente de novo.</span>}
      {c.resultado.length > 0 && (
        <div className="cp-tabela" role="table" aria-label={`Conferência de ${nome}`}>
          <div className="cp-linha cp-cab" role="row">
            <span role="columnheader">Campo</span><span role="columnheader">Nota fiscal</span><span role="columnheader">CT-e</span><span role="columnheader">Resultado</span>
          </div>
          {c.resultado.map((l) => (
            <div key={l.campo} className={`cp-linha cp-l-${l.resultado}`} role="row">
              <span role="cell" className="cp-campo">{l.rotulo}</span>
              <span role="cell" data-rot="Nota fiscal">{l.nf || '—'}</span>
              <span role="cell" data-rot="CT-e">{l.cte || '—'}</span>
              <span role="cell" className="cp-res"><span className={`cp-marca cp-m-${l.resultado}`}>{ROTULO_LINHA[l.resultado]}</span>
                {l.observacao && <span className="cp-obs">{l.observacao}</span>}</span>
            </div>
          ))}
        </div>
      )}
      <div className="cp-rodape pequeno suave">
        <span>{c.origem === 'xml' ? 'Lido do XML' : c.origem === 'pdf_imagem' ? 'Lido do PDF/imagem por IA' : ''}
          {c.concluido_em ? `${c.origem ? ' · ' : ''}${fmtDataAsHora(c.concluido_em)}` : ''}{c.tentativas > 1 ? ` · ${c.tentativas}ª leitura` : ''}</span>
        {pode('apoio.atender') && c.status !== 'processando' && (
          <button className="btn sutil peq" disabled={enviando} onClick={reconferir}>{enviando ? 'Enviando…' : 'Conferir de novo'}</button>
        )}
      </div>
    </div>
  );
}

/** Aviso para o bloco "Liberar ao comercial": divergência ou conferência ainda rodando. */
export function avisoConferencia(conferencias: Conferencia[] | undefined): { tipo: 'erro' | 'aviso'; texto: string } | null {
  const cs = conferencias ?? [];
  if (cs.some((c) => c.status === 'divergente')) return { tipo: 'erro', texto: 'A conferência automática encontrou divergência entre a NF e o CT-e. Confira antes de liberar.' };
  if (cs.some((c) => c.status === 'processando')) return { tipo: 'aviso', texto: 'A conferência automática ainda está lendo os arquivos.' };
  if (cs.some((c) => c.status === 'alerta' || c.status === 'erro')) return { tipo: 'aviso', texto: 'A conferência automática deixou pontos de atenção. Confira antes de liberar.' };
  return null;
}
