// Cartões "Tempo de fila por operação" (Cadastro, Emissão, Estadia): usados no Painel Operacional e no Dashboard Embarques.

import { useEffect, useMemo, useState } from 'react';
import { mensagemErro } from '../../data/api';
import { useApp } from '../../data/store';
import { duracao } from '../../lib/documentacao';
import { type DadosPainel, type LinhaChamado, OPERACOES, type SituacaoPrazo, filaAtual, linhasDoPainel, situacaoPrazo } from '../../lib/painelOperacional';
import type { TipoSolicitacaoDoc } from '../../types';

const ROTULO_SITUACAO: Record<SituacaoPrazo, string> = {
  no_prazo: '● Dentro do prazo', atencao: '▲ Atraso de até 5 min', atrasado: '■ Atraso acima de 5 min',
};
const fmtPrazo = (min: number) => (min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`);
const fmtDur = (ms: number | null) => (ms === null ? '—' : duracao(ms));

export function FilasOperacao({ linhas, tipos, agora }: { linhas: LinhaChamado[]; tipos: TipoSolicitacaoDoc[]; agora: number }) {
  return (
    <div className="po-filas">
      {OPERACOES.filter((op) => op.tipos.some((t) => tipos.includes(t))).map((op) => {
        const f = filaAtual(linhas, op.tipos.filter((t) => tipos.includes(t)), agora);
        const sit = situacaoPrazo(f.media_ms, op.prazo_min);
        const sitAntigo = situacaoPrazo(f.mais_antigo_ms, op.prazo_min);
        return (
          <div key={op.id} className={`po-fila${sit ? ` prazo-${sit}` : ''}`}>
            <div className="po-fila-cab">{op.rotulo}{op.prazo_min && <span className="po-prazo">Prazo {fmtPrazo(op.prazo_min)}</span>}</div>
            <div className="po-fila-corpo">
              <span className="po-fila-rot">Espera média atual</span>
              <span className="po-fila-val">{fmtDur(f.media_ms)}</span>
              <span className={`po-sit${sit ? ` prazo-${sit}` : ''}`}>{sit ? ROTULO_SITUACAO[sit] : f.quantidade ? 'Sem horário de entrada' : 'Fila vazia'}</span>
              <div className="po-fila-linha"><span>Chamados na fila</span><strong>{f.quantidade}</strong></div>
              <div className="po-fila-linha"><span>Mais antigo aguardando</span><strong className={sitAntigo ? `txt-prazo-${sitAntigo}` : undefined}>{fmtDur(f.mais_antigo_ms)}</strong></div>
              {op.composicao && <span className="po-fila-nota">{op.composicao}</span>}
              {f.retorno > 0 && <span className="po-fila-nota">{f.retorno} na fila de retorno (correção recebida)</span>}
              {f.sem_registro > 0 && <span className="po-fila-nota">{f.sem_registro} sem registro do horário de entrada</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TODOS: TipoSolicitacaoDoc[] = ['cadastro', 'emissao', 'lote_emissao', 'estadia'];

/** Dashboard Embarques: fila do Apoio inteiro (sem nomes), atualizada a cada 15 s enquanto a tela está aberta. */
export function FilaApoioDashboard() {
  const { api } = useApp();
  const [dados, setDados] = useState<Pick<DadosPainel, 'agora' | 'solicitacoes' | 'eventos'> | null>(null);
  const [desvio, setDesvio] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [tique, setTique] = useState(Date.now());
  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      if (document.hidden) return;
      const pedido = Date.now();
      try {
        const r = await api.doc.filaApoio();
        if (!vivo) return;
        setDesvio(Date.parse(r.agora) - (pedido + Date.now()) / 2);
        setDados(r); setErro(null);
      } catch (e) { if (vivo) setErro(mensagemErro(e)); }
    };
    void buscar();
    const t = setInterval(() => { setTique(Date.now()); void buscar(); }, 15000);
    return () => { vivo = false; clearInterval(t); };
  }, [api]);
  const agora = tique + desvio;
  const linhas = useMemo(() => (dados ? linhasDoPainel(dados, agora) : []), [dados, agora]);
  return (
    <section className="cartao po-q po-q-filas po-normal" aria-label="Tempo de fila por operação">
      <div className="po-q-cab">
        <div>
          <h3>Tempo de fila por operação</h3>
          <span className="po-q-sub">Situação agora: chamados aguardando o apoio assumir ou retomar, em todas as filiais</span>
        </div>
      </div>
      {erro && !dados ? <p className="po-vazio">Não foi possível carregar a fila: {erro}</p>
        : !dados ? <p className="po-vazio">Carregando a fila…</p>
        : <FilasOperacao linhas={linhas} tipos={TODOS} agora={agora} />}
    </section>
  );
}
