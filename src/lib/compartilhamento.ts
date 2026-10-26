// Posição de embarque por cliente: agrupamento compatível e texto para WhatsApp/e-mail.
// Usa as mesmas linhas da Lista de Fretes (não existe segunda digitação dos números).

import type { LinhaFrete } from '../types';
import { type Indices, cidadeUF, nome } from './cadastros';
import { volumes } from './calculos';
import { fmtData, fmtHora, fmtT } from './formato';
import { normalizar } from './texto';

export interface ItemPosicaoCliente {
  chave: string;
  origem: string;
  coleta: string | null;
  destino: string;
  entrega: string | null;
  produto: string | null;
  porta: number;
  transito: number;
  carregados: number;
  porta_t: number;
  transito_t: number;
  carregado_t: number;
  observacoes: string[];
  embarques: number;
  suspensos: number;
  atualizado_em: string | null;
  linhas: LinhaFrete[];
}

export interface PosicaoCliente {
  cliente: string;
  data: string;
  atualizado_em: string | null;
  itens: ItemPosicaoCliente[];
  totais: { porta: number; transito: number; carregados: number; porta_t: number; transito_t: number; carregado_t: number };
}

export interface OpcoesExibicao {
  carregados: boolean;
  volumes: boolean;
}

/** Agrupa apenas registros compatíveis: mesma origem, coleta, destino, entrega e produto. */
export function montarPosicaoCliente(clienteNome: string, data: string, linhas: LinhaFrete[], idx: Indices): PosicaoCliente {
  const grupos = new Map<string, ItemPosicaoCliente>();
  let atualizado: string | null = null;
  for (const l of linhas) {
    if (!l.posicao || l.embarque.situacao !== 'ativo') continue;
    const e = l.embarque;
    const coleta = e.local_coleta_id ? nome(idx.local, e.local_coleta_id) : null;
    const entrega = e.local_entrega_id ? nome(idx.local, e.local_entrega_id) : null;
    const produto = e.produto_id ? nome(idx.produto, e.produto_id) : null;
    const origem = cidadeUF(e.origem_cidade, e.origem_uf);
    const destino = cidadeUF(e.destino_cidade, e.destino_uf);
    const chave = [origem, coleta, destino, entrega, produto].map(normalizar).join('|');
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave, origem, coleta, destino, entrega, produto,
        porta: 0, transito: 0, carregados: 0, porta_t: 0, transito_t: 0, carregado_t: 0,
        observacoes: [], embarques: 0, suspensos: 0, atualizado_em: null, linhas: [],
      });
    }
    const g = grupos.get(chave)!;
    const v = volumes(l.posicao);
    g.porta += v.porta;
    g.transito += v.transito;
    g.carregados += v.carregados;
    g.porta_t += v.porta_t;
    g.transito_t += v.transito_t;
    g.carregado_t += v.carregado_t;
    g.embarques++;
    if (e.status_liberacao === 'suspenso') g.suspensos++;
    g.linhas.push(l);
    const obs = l.posicao.obs_cliente?.trim();
    if (obs && !g.observacoes.includes(obs)) g.observacoes.push(obs);
    if (!g.atualizado_em || l.posicao.atualizado_em > g.atualizado_em) g.atualizado_em = l.posicao.atualizado_em;
    if (!atualizado || l.posicao.atualizado_em > atualizado) atualizado = l.posicao.atualizado_em;
  }
  const itens = [...grupos.values()].sort((a, b) =>
    a.origem.localeCompare(b.origem, 'pt-BR') || a.destino.localeCompare(b.destino, 'pt-BR'));
  const totais = itens.reduce(
    (t, i) => ({
      porta: t.porta + i.porta, transito: t.transito + i.transito, carregados: t.carregados + i.carregados,
      porta_t: t.porta_t + i.porta_t, transito_t: t.transito_t + i.transito_t, carregado_t: t.carregado_t + i.carregado_t,
    }),
    { porta: 0, transito: 0, carregados: 0, porta_t: 0, transito_t: 0, carregado_t: 0 },
  );
  return { cliente: clienteNome, data, atualizado_em: atualizado, itens, totais };
}

/** Texto no formato combinado para WhatsApp. */
export function textoWhatsApp(p: PosicaoCliente, op: OpcoesExibicao): string {
  const linhas: string[] = [];
  linhas.push(`Posição de embarque — ${p.cliente}`);
  linhas.push(`Data: ${fmtData(p.data)} | Atualizado às ${fmtHora(p.atualizado_em)}`);
  for (const i of p.itens) {
    linhas.push('');
    linhas.push(`Origem: ${i.origem}${i.coleta ? ` — Coleta: ${i.coleta}` : ''}`);
    linhas.push(`Destino: ${i.destino}${i.entrega ? ` — Entrega: ${i.entrega}` : ''}`);
    if (i.produto) linhas.push(`Produto: ${i.produto}`);
    linhas.push(`Porta: ${i.porta}`);
    linhas.push(`Trânsito para coleta: ${i.transito}`);
    if (op.carregados) linhas.push(`Carregados: ${i.carregados}`);
    if (op.volumes) {
      const partes = [`Volume na porta: ${fmtT(i.porta_t)}`, `Em trânsito: ${fmtT(i.transito_t)}`];
      if (op.carregados) partes.push(`Carregado: ${fmtT(i.carregado_t)}`);
      linhas.push(partes.join(' | '));
    }
    if (i.observacoes.length) linhas.push(`Observação: ${i.observacoes.join(' | ')}`);
  }
  if (p.itens.length > 1) {
    linhas.push('');
    const t = [`Total — Porta: ${p.totais.porta}`, `Trânsito: ${p.totais.transito}`];
    if (op.carregados) t.push(`Carregados: ${p.totais.carregados}`);
    linhas.push(t.join(' | '));
  }
  return linhas.join('\n');
}

export function assuntoEmail(p: PosicaoCliente): string {
  return `Posição de embarque — ${p.cliente} — ${fmtData(p.data)}`;
}

export function corpoEmail(p: PosicaoCliente, op: OpcoesExibicao, link?: string): string {
  const partes = ['Prezados,', '', 'Segue a posição de embarque atualizada:', '', textoWhatsApp(p, op)];
  if (link) partes.push('', `Consulta atualizada (somente leitura): ${link}`);
  partes.push('', 'Atenciosamente,', 'Transpanorama');
  return partes.join('\n');
}
