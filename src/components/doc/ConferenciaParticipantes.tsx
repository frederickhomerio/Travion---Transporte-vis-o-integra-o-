// Conferência automática dos participantes: NF × CT-e (remetente, destinatário, coleta, entrega e cliente pagador).
// Quem lê os arquivos é o fluxo do n8n (PDF/imagem por IA hoje; XML direto quando houver integração com o ERP).
// Faixa enxuta no topo do Atendimento: verde = confere; amarelo = atenção e vermelho = diverge, com "i" explicando.
// O resultado só AVISA: não bloqueia a liberação ao comercial.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../data/store';
import { mensagemErro } from '../../data/api';
import { useAviso } from '../ui';
import type { AnexoDoc, ConferenciaParticipantes as Conferencia, LinhaConferencia } from '../../types';

const CURTO: Record<LinhaConferencia['campo'], string> = {
  nf_no_cte: 'NF no CT-e', remetente: 'Remetente', destinatario: 'Destinatário', local_coleta: 'Coleta', local_entrega: 'Entrega', pagador: 'Pagador',
};
const TITULO: Record<LinhaConferencia['resultado'], string> = { ok: 'Confere', alerta: 'Atenção', divergente: 'Diverge', nao_lido: 'Não foi possível ler' };

export function FaixaConferencia({ conferencias, anexos }: { conferencias: Conferencia[]; anexos: AnexoDoc[] }) {
  if (!conferencias.length) return null;
  const varios = conferencias.length > 1;
  return (
    <div className="cf" aria-label="Conferência automática NF × CT-e">
      {conferencias.map((c) => (
        <Grupo key={c.id} c={c} nome={varios ? (anexos.find((a) => a.id === c.anexo_id)?.nome ?? 'CT-e') : null} />
      ))}
    </div>
  );
}

function Grupo({ c, nome }: { c: Conferencia; nome: string | null }) {
  const { api, pode } = useApp();
  const avisar = useAviso();
  const [enviando, setEnviando] = useState(false);
  const reconferir = async () => {
    setEnviando(true);
    try { await api.doc.reconferirParticipantes(c.id); } catch (e) { avisar('erro', mensagemErro(e)); }
    setEnviando(false);
  };
  return (
    <div className="cf-grupo">
      <span className="cf-tit">{nome ? `${nome.replace(/\.[a-z0-9]+$/i, '')}` : 'NF × CT-e'}</span>
      {c.status === 'processando' && <span className="cf-chip cf-proc">Conferindo…</span>}
      {c.status === 'erro' && (
        <Chip rotulo="Não conferido" tipo="alerta" titulo="Conferência não concluída"
          texto={`${c.mensagem ?? 'Não foi possível ler os arquivos.'} Confira manualmente ou tente de novo.`} />
      )}
      {c.status !== 'processando' && c.resultado.map((l, i) => (
        l.resultado === 'ok'
          ? <span key={i} className="cf-chip cf-ok" title={`${l.rotulo}: confere`}>{CURTO[l.campo]}</span>
          : <Chip key={i} rotulo={CURTO[l.campo]} tipo={l.resultado === 'divergente' ? 'divergente' : 'alerta'} titulo={`${l.rotulo}: ${TITULO[l.resultado]}`}
              texto={l.observacao || TITULO[l.resultado]} nf={l.nf} cte={l.cte} />
      ))}
      {pode('apoio.atender') && c.status !== 'processando' && (
        <button className="cf-refazer" onClick={reconferir} disabled={enviando} title="Conferir de novo" aria-label="Conferir de novo">↻</button>
      )}
    </div>
  );
}

function Chip({ rotulo, tipo, titulo, texto, nf, cte }: { rotulo: string; tipo: 'alerta' | 'divergente'; titulo: string; texto: string; nf?: string; cte?: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return (
    <span className="cf-ancora" ref={ref}>
      <button className={`cf-chip cf-${tipo}`} onClick={() => setAberto((x) => !x)} aria-expanded={aberto}>
        {rotulo} <span className="cf-i" aria-hidden="true">i</span>
      </button>
      {aberto && (
        <span className={`cf-pop cf-pop-${tipo}`} role="dialog" aria-label={titulo}>
          <strong>{titulo}</strong>
          <span className="cf-pop-txt">{texto}</span>
          {nf && <span className="cf-pop-lin"><b>NF:</b> {nf}</span>}
          {cte && <span className="cf-pop-lin"><b>CT-e:</b> {cte}</span>}
        </span>
      )}
    </span>
  );
}

/** Aviso para o bloco "Liberar ao comercial": divergência ou conferência ainda rodando. */
export function avisoConferencia(conferencias: Conferencia[] | undefined): { tipo: 'erro' | 'aviso'; texto: string } | null {
  if (!conferencias) return null;
  const cs = conferencias;
  if (!cs.length) return { tipo: 'aviso', texto: 'O CT-e não passou pela conferência automática.' };
  if (cs.some((c) => c.status === 'divergente')) return { tipo: 'erro', texto: 'A conferência automática encontrou divergência entre a NF e o CT-e (quadros em vermelho no topo). Confira antes de liberar.' };
  if (cs.some((c) => c.status === 'processando')) return { tipo: 'aviso', texto: 'A conferência automática ainda está lendo os arquivos.' };
  if (cs.some((c) => c.status === 'alerta' || c.status === 'erro')) return { tipo: 'aviso', texto: 'A conferência automática deixou pontos de atenção (quadros em amarelo no topo). Confira antes de liberar.' };
  return null;
}
