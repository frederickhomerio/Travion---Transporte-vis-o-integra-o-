// Imagem das posições por centro de custo: um quadro por centro, com origem, destino, volumes,
// executado × meta (vermelho até 60%, amarelo até 80%, verde acima) e quem atualizou por último.

import { useRef, useState } from 'react';
import { useDoc } from '../data/documentacao';
import type { Indices } from '../lib/cadastros';
import { fmtData, fmtDataAsHora, fmtHora } from '../lib/formato';
import { type PrintCentro, printPorCentro } from '../lib/posicoes';
import type { LinhaFrete } from '../types';
import { Alerta, Icone, Modal } from './ui';

const fmtT = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`;
const fmtPct = (v: number | null) => (v == null ? 'Sem meta' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

async function gerarPng(el: HTMLElement): Promise<Blob> {
  await document.fonts?.ready;
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true, windowWidth: 1280 });
  const blob = await new Promise<Blob | null>((r) => { try { canvas.toBlob(r, 'image/png'); } catch { r(null); } });
  if (!blob) throw new Error('Não foi possível gerar a imagem.');
  return blob;
}

export function PrintCentros({ linhas, idx, data, aoFechar }: {
  linhas: LinhaFrete[]; idx: Indices; data: string; aoFechar: () => void;
}) {
  const { estado: doc } = useDoc();
  const [grupos] = useState(() => printPorCentro(linhas, idx, doc.lotes));
  const [geradoEm] = useState(() => new Date().toISOString());
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; txt: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const nomeArquivo = (g: PrintCentro) => `posicoes-${g.centro.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}-${data}.png`;
  const baixar = (blob: Blob, nome: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const copiar = async (g: PrintCentro) => {
    const el = refs.current[g.chave];
    if (!el) return;
    setOcupado(g.chave); setMsg(null);
    const promessa = gerarPng(el);
    try {
      // A cópia é pedida dentro do clique, com a imagem chegando depois (exigência do Safari).
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('sem suporte');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': promessa })]);
      setMsg({ tipo: 'ok', txt: `Imagem de ${g.centro} copiada. Cole no WhatsApp ou no e-mail.` });
    } catch {
      try { baixar(await promessa, nomeArquivo(g)); setMsg({ tipo: 'aviso', txt: 'O navegador não deixou copiar a imagem; o PNG foi baixado.' }); }
      catch (e) { setMsg({ tipo: 'erro', txt: (e as Error).message }); }
    }
    setOcupado(null);
  };
  const baixarUm = async (g: PrintCentro) => {
    const el = refs.current[g.chave];
    if (!el) return;
    setOcupado(g.chave); setMsg(null);
    try { baixar(await gerarPng(el), nomeArquivo(g)); } catch (e) { setMsg({ tipo: 'erro', txt: (e as Error).message }); }
    setOcupado(null);
  };
  const baixarTodos = async () => {
    setOcupado('todos'); setMsg(null);
    try { for (const g of grupos) { const el = refs.current[g.chave]; if (el) baixar(await gerarPng(el), nomeArquivo(g)); } }
    catch (e) { setMsg({ tipo: 'erro', txt: (e as Error).message }); }
    setOcupado(null);
  };

  return (
    <Modal titulo="Imagem das posições por centro de custo" aoFechar={aoFechar}
      rodape={<>
        {grupos.length > 1 && <button className="btn" disabled={!!ocupado} onClick={() => void baixarTodos()}><Icone nome="baixar" tam={16} />{ocupado === 'todos' ? 'Gerando…' : `Baixar todas (${grupos.length})`}</button>}
        <button className="btn primario" onClick={aoFechar}>Fechar</button>
      </>}>
      <div className="pc">
        <p className="pequeno suave">Uma imagem por centro de custo, com as posições dos filtros atuais. Executado = volume carregado ÷ meta do dia.</p>
        {msg && <Alerta tipo={msg.tipo}>{msg.txt}</Alerta>}
        {!grupos.length && <Alerta tipo="info">Nenhuma posição nos filtros atuais.</Alerta>}
        {grupos.map((g) => (
          <section key={g.chave} className="pc-grupo">
            <div className="pc-acoes">
              <strong>{g.centro}</strong>
              <span className="pc-acoes-btn">
                <button className="btn peq" disabled={!!ocupado} onClick={() => void copiar(g)}>{ocupado === g.chave ? 'Gerando…' : 'Copiar imagem'}</button>
                <button className="btn peq" disabled={!!ocupado} onClick={() => void baixarUm(g)}><Icone nome="baixar" tam={14} />Baixar PNG</button>
              </span>
            </div>
            <div className="pc-rolagem">
              <div className="pc-quadro" ref={(el) => { refs.current[g.chave] = el; }}>
                <div className="pc-cab">
                  <div><span className="pc-sobre">Posições de embarque · Centro de custo</span><h3>{g.centro}</h3></div>
                  <span className="pc-data">{fmtData(data)} · gerado às {fmtHora(geradoEm)}</span>
                </div>
                <table className="pc-tabela">
                  <thead><tr>
                    <th>Origem e coleta</th><th>Destino e entrega</th><th className="n">Volume na porta</th><th className="n">Volume carregado</th>
                    <th className="n">Meta do dia</th><th className="n">Executado</th><th>Última atualização</th><th>Quem atualizou</th>
                  </tr></thead>
                  <tbody>
                    {g.linhas.map((l) => (
                      <tr key={l.chave}>
                        <td><span className="pc-cidade">{l.origem}</span>{l.coleta && <span className="pc-local">{l.coleta}</span>}<span className="pc-cliente">{l.cliente}{l.lote ? ` · Lote ERP ${l.lote}` : ''}</span></td>
                        <td><span className="pc-cidade">{l.destino}</span>{l.entrega && <span className="pc-local">{l.entrega}</span>}</td>
                        <td className="n">{fmtT(l.porta_t)}</td>
                        <td className="n">{fmtT(l.carregado_t)}</td>
                        <td className="n">{l.meta_t != null ? fmtT(l.meta_t) : '—'}</td>
                        <td className="n"><span className={`pc-exec ${l.faixa ? `faixa-${l.faixa}` : 'sem'}`}>{fmtPct(l.pct)}</span></td>
                        <td>{l.ultima ? fmtDataAsHora(l.ultima) : '—'}</td>
                        <td>{l.por ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <th colSpan={2}>Total do centro de custo ({g.linhas.length} {g.linhas.length === 1 ? 'posição' : 'posições'})</th>
                    <td className="n">{fmtT(g.totais.porta_t)}</td><td className="n">{fmtT(g.totais.carregado_t)}</td>
                    <td className="n">{g.totais.meta_t != null ? fmtT(g.totais.meta_t) : '—'}</td>
                    <td className="n"><span className={`pc-exec ${g.totais.faixa ? `faixa-${g.totais.faixa}` : 'sem'}`}>{fmtPct(g.totais.pct)}</span></td>
                    <td colSpan={2} />
                  </tr></tfoot>
                </table>
                <div className="pc-legenda"><span><i className="faixa-vermelho" />Até 60% da meta</span><span><i className="faixa-amarelo" />60,1% a 80%</span><span><i className="faixa-verde" />Acima de 80%</span></div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
