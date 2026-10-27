// Contador editável (porta, trânsito, carregados).
// Mostra "não salvo" → "salvando…" → "salvo" somente depois da confirmação do servidor.
// Se outra pessoa alterou o mesmo campo, abre a revisão de conflito (nada é sobrescrito sem escolha).

import { useEffect, useRef, useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp } from '../data/store';
import type { Posicao } from '../types';
import { Modal } from './ui';

type Campo = 'porta' | 'transito' | 'carregados';
type EstadoGravacao = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro' | 'invalido';

const ROTULO: Record<Campo, string> = { porta: 'Porta', transito: 'Trânsito', carregados: 'Carregados' };

export function Contador({ posicao, campo, podeEditar, rotuloVisivel = false }: {
  posicao: Posicao; campo: Campo; podeEditar: boolean; rotuloVisivel?: boolean;
}) {
  const { api, aplicarPosicao } = useApp();
  const valorServidor = posicao[campo];
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoGravacao>('ocioso');
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState<{ atual: number | null; meu: number; por: string | null; em: string } | null>(null);
  const base = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const emVoo = useRef(false);
  const rascunhoRef = useRef<string | null>(null);
  rascunhoRef.current = rascunho;

  useEffect(() => () => clearTimeout(timer.current), []);

  const exibido = rascunho ?? (valorServidor === null ? '' : String(valorServidor));

  async function salvar(valor: number, forcar = false) {
    emVoo.current = true;
    setEstado('salvando');
    setErro(null);
    try {
      const r = await api.atualizarPosicao(posicao.id, { [campo]: valor }, { [campo]: base.current }, forcar);
      if (r.status === 'conflito') {
        setConflito({ atual: r.registro[campo], meu: valor, por: r.registro.atualizado_por_nome, em: r.registro.atualizado_em });
        aplicarPosicao(r.registro);
        setEstado('pendente');
      } else {
        aplicarPosicao(r.registro);
        base.current = r.registro[campo];
        // Se o usuário continuou mexendo enquanto salvava, grava o novo valor em seguida.
        const atual = rascunhoRef.current;
        if (atual !== null && atual !== String(valor) && /^\d+$/.test(atual)) {
          emVoo.current = false;
          void salvar(Number(atual));
          return;
        }
        setRascunho(null);
        setEstado('salvo');
        setTimeout(() => setEstado((e) => (e === 'salvo' ? 'ocioso' : e)), 2500);
      }
    } catch (e) {
      setEstado('erro');
      setErro(mensagemErro(e));
    } finally {
      emVoo.current = false;
    }
  }

  function mudar(texto: string) {
    if (!podeEditar) return;
    if (rascunho === null) base.current = valorServidor;
    setRascunho(texto);
    clearTimeout(timer.current);
    if (!/^\d+$/.test(texto) || Number(texto) > 100000) {
      setEstado('invalido');
      return;
    }
    setEstado('pendente');
    timer.current = setTimeout(() => { if (!emVoo.current) void salvar(Number(texto)); }, 700);
  }

  const n = rascunho !== null && /^\d+$/.test(rascunho) ? Number(rascunho) : valorServidor ?? 0;
  const rotulo = ROTULO[campo];

  if (!podeEditar) {
    return (
      <div>
        <div className="contador"><span className="valor" aria-label={rotulo}>{valorServidor ?? '—'}</span></div>
        {valorServidor === null && <div className="contador-estado suave">não informado</div>}
      </div>
    );
  }

  return (
    <div>
      {rotuloVisivel && <span className="sr">{rotulo}</span>}
      <div className={`contador ${estado === 'pendente' || estado === 'salvando' ? 'pendente' : estado === 'erro' || estado === 'invalido' ? 'erro' : estado === 'salvo' ? 'salvo' : ''}`}>
        <button type="button" aria-label={`Diminuir ${rotulo}`} disabled={n <= 0} onClick={() => mudar(String(Math.max(0, n - 1)))}>−</button>
        <input
          value={exibido}
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={rotulo}
          placeholder="—"
          onChange={(e) => mudar(e.target.value.trim())}
          onBlur={() => {
            if (rascunho !== null && estado === 'pendente' && !emVoo.current) {
              clearTimeout(timer.current);
              void salvar(Number(rascunho));
            }
          }}
        />
        <button type="button" aria-label={`Aumentar ${rotulo}`} onClick={() => mudar(String(n + 1))}>+</button>
      </div>
      <div className={`contador-estado ${estado === 'invalido' ? 'erro' : estado}`} aria-live="polite">
        {estado === 'pendente' && 'não salvo'}
        {estado === 'salvando' && 'salvando…'}
        {estado === 'salvo' && '✓ salvo'}
        {estado === 'invalido' && 'só inteiro ≥ 0'}
        {estado === 'erro' && (
          <span title={erro ?? ''}>
            erro ao salvar · <button type="button" onClick={() => rascunho !== null && /^\d+$/.test(rascunho) && salvar(Number(rascunho))}>tentar de novo</button>
          </span>
        )}
        {estado === 'ocioso' && valorServidor === null && <span className="suave">não informado</span>}
      </div>
      {estado === 'erro' && erro && <div className="sr" role="alert">{erro}</div>}
      {conflito && (
        <Modal
          titulo={`Conflito em ${rotulo}`}
          aoFechar={() => setConflito(null)}
          rodape={
            <>
              <button className="btn" onClick={() => { setConflito(null); setRascunho(null); setEstado('ocioso'); }}>
                Manter {conflito.atual ?? 'não informado'} (valor atual)
              </button>
              <button className="btn primario" onClick={() => { base.current = conflito.atual; setConflito(null); void salvar(conflito.meu); }}>
                Gravar {conflito.meu} (meu valor)
              </button>
            </>
          }
        >
          <p>
            Enquanto você editava, <strong>{conflito.por ?? 'outro usuário'}</strong> alterou {rotulo.toLowerCase()} de{' '}
            <strong>{base.current ?? 'não informado'}</strong> para <strong>{conflito.atual ?? 'não informado'}</strong>.
          </p>
          <p>Você tentou gravar <strong>{conflito.meu}</strong>. Nada foi sobrescrito. Escolha qual valor deve ficar.</p>
        </Modal>
      )}
    </div>
  );
}
