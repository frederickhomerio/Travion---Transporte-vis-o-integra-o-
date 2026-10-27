// Cartão de um embarque na página Posições de Embarque (supervisores).
// Só os três contadores são editáveis. A gravação é única para o cartão e só aparece como salva
// depois de o servidor confirmar; conflito e falha mantêm o que foi digitado.

import { useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp } from '../data/store';
import { type Indices, cidadeUF, codigoEmbarque, nome } from '../lib/cadastros';
import { fmtDataAsHora, fmtHora, ROTULO_STATUS } from '../lib/formato';
import { CAMPOS_CONTADOR, type CampoContador, lerContador, ROTULO_CONTADOR, SEM_CENTRO, centroDaLinha } from '../lib/posicoes';
import type { LinhaFrete, Posicao } from '../types';

export interface Rascunho {
  valores: Record<CampoContador, string>;
  /** Valores do servidor quando a edição começou (referência do conflito). */
  base: Record<CampoContador, number | null>;
}

const textoDe = (v: number | null) => (v === null ? '' : String(v));
const baseDe = (p: Posicao): Rascunho['base'] => ({ porta: p.porta, transito: p.transito, carregados: p.carregados });

/** O rascunho só existe enquanto algum valor difere do que estava no servidor ao começar. */
export const rascunhoAlterado = (r: Rascunho | undefined) => !!r && CAMPOS_CONTADOR.some((k) => r.valores[k].trim() !== textoDe(r.base[k]));

type Gravacao = { estado: 'ocioso' } | { estado: 'salvando' } | { estado: 'salvo' } | { estado: 'erro'; msg: string } | { estado: 'conflito'; atual: Posicao };

export function CartaoSupervisor({ linha, idx, rascunho, aoRascunho, podeEditar, aoPerderAcesso }: {
  linha: LinhaFrete; idx: Indices; rascunho: Rascunho | undefined;
  aoRascunho: (r: Rascunho | null) => void; podeEditar: boolean; aoPerderAcesso: () => void;
}) {
  const { api, aplicarPosicao } = useApp();
  const e = linha.embarque;
  const p = linha.posicao!;
  const [g, setG] = useState<Gravacao>({ estado: 'ocioso' });

  const alterado = rascunhoAlterado(rascunho);
  const valores = rascunho?.valores ?? { porta: textoDe(p.porta), transito: textoDe(p.transito), carregados: textoDe(p.carregados) };
  const leituras = Object.fromEntries(CAMPOS_CONTADOR.map((k) => [k, lerContador(valores[k])])) as Record<CampoContador, ReturnType<typeof lerContador>>;
  const validos = CAMPOS_CONTADOR.every((k) => leituras[k].ok);
  // Outra pessoa confirmou depois que este rascunho começou: avisa antes de salvar.
  const mudouNoServidor = alterado && CAMPOS_CONTADOR.some((k) => rascunho!.base[k] !== p[k]);

  function mudar(campo: CampoContador, texto: string) {
    const r: Rascunho = rascunho ? { ...rascunho, valores: { ...rascunho.valores, [campo]: texto } } : { valores: { ...valores, [campo]: texto }, base: baseDe(p) };
    aoRascunho(rascunhoAlterado(r) ? r : null);
    if (g.estado === 'salvo' || g.estado === 'erro') setG({ estado: 'ocioso' });
  }

  function passo(campo: CampoContador, delta: number) {
    const l = leituras[campo];
    const atual = l.ok ? l.valor : 0;
    mudar(campo, String(Math.max(0, atual + delta)));
  }

  async function gravar(base: Rascunho['base']) {
    if (!validos || g.estado === 'salvando') return;
    setG({ estado: 'salvando' });
    const v = Object.fromEntries(CAMPOS_CONTADOR.map((k) => [k, (leituras[k] as { valor: number }).valor])) as Record<CampoContador, number>;
    try {
      const r = await api.confirmarPosicao(p.id, v, base);
      aplicarPosicao(r.registro);
      if (r.status === 'conflito') { setG({ estado: 'conflito', atual: r.registro }); return; }
      aoRascunho(null);
      setG({ estado: 'salvo' });
    } catch (err) {
      const msg = mensagemErro(err);
      setG({ estado: 'erro', msg });
      if (/fora do seu escopo|permissão/i.test(msg)) aoPerderAcesso();
    }
  }

  const salvar = () => gravar(rascunho?.base ?? baseDe(p));
  // Revisou o conflito e mantém os próprios números: a referência passa a ser o valor atual.
  const reenviar = (atual: Posicao) => {
    aoRascunho({ valores, base: baseDe(atual) });
    void gravar(baseDe(atual));
  };
  const descartar = () => { aoRascunho(null); setG({ estado: 'ocioso' }); };

  const cc = centroDaLinha(linha, idx);
  const coleta = nome(idx.local, e.local_coleta_id, '');
  const entrega = nome(idx.local, e.local_entrega_id, '');
  const simbolo = e.status_liberacao === 'liberado' ? '●' : e.status_liberacao === 'suspenso' ? '■' : '○';

  return (
    <article className="cs" aria-label={`Embarque ${codigoEmbarque(e.codigo)}, ${nome(idx.cliente, e.cliente_id)}`}>
      <header className="cs-cab">
        <div className="cs-sobre">
          <span>Posição operacional</span>
          <span className={`cs-status ${e.status_liberacao}`}><span aria-hidden="true">{simbolo}</span>{ROTULO_STATUS[e.status_liberacao]}</span>
        </div>
        <h2 className="cs-cliente">{nome(idx.cliente, e.cliente_id)}</h2>
        <div className="cs-vinculos">
          <span>{cc === SEM_CENTRO ? 'Sem centro de custo' : nome(idx.centroCusto, cc)}</span>
          <span aria-hidden="true">·</span>
          <span>{nome(idx.filial, e.filial_id)}</span>
          <span aria-hidden="true">·</span>
          <span className="mono">{codigoEmbarque(e.codigo)}</span>
        </div>
      </header>

      <div className="cs-corpo">
        <div className="cs-rota">
          <div className="cs-ponto">
            <span className="cs-rot">Origem / Coleta</span>
            <strong>{cidadeUF(e.origem_cidade, e.origem_uf)}</strong>
            {coleta && <span className="cs-local">{coleta}</span>}
          </div>
          <div className="cs-ponto">
            <span className="cs-rot">Destino / Entrega</span>
            <strong>{cidadeUF(e.destino_cidade, e.destino_uf)}</strong>
            {entrega && <span className="cs-local">{entrega}</span>}
          </div>
        </div>
        <div className="cs-produto"><span className="suave">Produto:</span> {nome(idx.produto, e.produto_id, 'Não informado')}</div>
        {e.status_liberacao === 'suspenso' && <div className="alerta aviso">Embarque suspenso. A posição continua editável.</div>}

        <div className="cs-contadores">
          {CAMPOS_CONTADOR.map((k) => {
            const l = leituras[k];
            const id = `c-${p.id}-${k}`;
            return (
              <div key={k} className={`cs-contador${!l.ok && podeEditar ? ' invalido' : ''}`}>
                <label htmlFor={id}>{ROTULO_CONTADOR[k]}</label>
                {podeEditar ? (
                  <>
                    <input id={id} value={valores[k]} inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="—"
                      aria-invalid={!l.ok} aria-describedby={!l.ok ? `${id}-erro` : undefined}
                      onChange={(ev) => mudar(k, ev.target.value.replace(/\s/g, ''))} />
                    <div className="cs-passos">
                      <button type="button" aria-label={`Diminuir ${ROTULO_CONTADOR[k]}`} disabled={!l.ok || l.valor <= 0} onClick={() => passo(k, -1)}>−</button>
                      <button type="button" aria-label={`Aumentar ${ROTULO_CONTADOR[k]}`} onClick={() => passo(k, 1)}>+</button>
                    </div>
                    {!l.ok && <small id={`${id}-erro`} className="cs-erro">{l.erro}</small>}
                  </>
                ) : (
                  <output id={id} className="cs-valor">{p[k] ?? '—'}</output>
                )}
              </div>
            );
          })}
        </div>

        {podeEditar && (
          <div className="cs-acoes">
            {mudouNoServidor && g.estado !== 'conflito' && (
              <div className="alerta aviso">
                {p.confirmado_por_nome ?? 'Outra pessoa'} atualizou esta posição às {fmtHora(p.confirmado_em ?? p.atualizado_em)} depois que você começou a editar.
                Ao salvar, você poderá revisar os valores atuais.
              </div>
            )}
            {g.estado === 'conflito' ? (
              <div className="alerta aviso cs-conflito" role="alert">
                <div>
                  <strong>A posição mudou enquanto você editava. Nada foi gravado.</strong>
                  <div>{g.atual.confirmado_por_nome ?? g.atual.atualizado_por_nome ?? 'Outra pessoa'} salvou às {fmtHora(g.atual.confirmado_em ?? g.atual.atualizado_em)}.</div>
                  <table className="cs-comparar">
                    <thead><tr><th /><th>Atual</th><th>Seu valor</th></tr></thead>
                    <tbody>
                      {CAMPOS_CONTADOR.map((k) => (
                        <tr key={k} className={String(g.atual[k] ?? '') !== valores[k] ? 'difere' : ''}>
                          <th scope="row">{ROTULO_CONTADOR[k]}</th><td>{g.atual[k] ?? '—'}</td><td>{valores[k] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="grupo-btn">
                    <button type="button" className="btn primario peq" onClick={() => reenviar(g.atual)}>Salvar meus valores</button>
                    <button type="button" className="btn peq" onClick={descartar}>Usar os valores atuais</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="btn primario cs-salvar" disabled={!alterado || !validos || g.estado === 'salvando'} onClick={salvar}>
                  {g.estado === 'salvando' ? 'Salvando…' : 'Salvar posição'}
                </button>
                {!alterado && g.estado !== 'salvando' && (
                  <button type="button" className="btn sutil peq" disabled={!validos} onClick={salvar}
                    title="Registra que os números continuam os mesmos (conta no relatório de atualização)">
                    Confirmar sem alteração
                  </button>
                )}
              </>
            )}
            <div className="cs-msg" aria-live="polite">
              {g.estado === 'salvo' && !alterado && <span className="ok">✓ Posição salva</span>}
              {alterado && g.estado !== 'salvando' && g.estado !== 'conflito' && <span className="pendente">Alterações ainda não salvas</span>}
              {g.estado === 'erro' && <span className="erro" role="alert">{g.msg} Seus valores foram mantidos; tente novamente.</span>}
            </div>
          </div>
        )}

        <footer className="cs-rodape">
          {p.confirmado_em ? (
            <>Atualizado por <strong>{p.confirmado_por_nome ?? '—'}</strong><br />{fmtDataAsHora(p.confirmado_em)}</>
          ) : (
            <span className="suave">Ainda não confirmada nesta data.</span>
          )}
        </footer>
      </div>
    </article>
  );
}
