// Regras das telas Posições de Embarque (supervisores) e Posição do Cliente (mesa comercial).
// Funções puras: a autorização real está no banco; aqui só se organiza o que o servidor já liberou.

import type { Configuracoes, LinhaFrete, Posicao, StatusLiberacao } from '../types';
import { metaDaPosicao, volumes } from './calculos';
import { type Indices, cidadeUF, nome } from './cadastros';
import { type FaixaBarra, faixaBarra } from './dashboard';
import { hojeSP } from './formato';
import { normalizar } from './texto';

export const CAMPOS_CONTADOR = ['porta', 'transito', 'carregados'] as const;
export type CampoContador = (typeof CAMPOS_CONTADOR)[number];
export const ROTULO_CONTADOR: Record<CampoContador, string> = { porta: 'Na porta', transito: 'Em trânsito', carregados: 'Carregados hoje' };

/** Lê um contador digitado: só inteiro ≥ 0. Vazio não vira zero. */
export function lerContador(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const t = texto.trim();
  if (t === '') return { ok: false, erro: 'Informe um número (zero é válido).' };
  if (!/^\d+$/.test(t) || Number(t) > 100000) return { ok: false, erro: 'Use só números inteiros maiores ou iguais a zero.' };
  return { ok: true, valor: Number(t) };
}

/** Cidade/UF comparável (sem acento, espaço extra ou diferença de caixa). */
export const chaveCidade = (cidade: string | null | undefined, uf: string | null | undefined) =>
  `${normalizar(cidade ?? '')}|${(uf ?? '').trim().toUpperCase()}`;

// ---------------------------------------------------------------------------
// Filtros dos supervisores: Centro de Custo → Filial → Cidade (de origem)
// ---------------------------------------------------------------------------
export const SEM_CENTRO = '__sem';
export interface FiltrosSupervisor { centro: string; filial: string; cidade: string }
export const FILTROS_SUPERVISOR_VAZIOS: FiltrosSupervisor = { centro: '', filial: '', cidade: '' };
export interface Opcao { valor: string; rotulo: string }

/** O centro de custo do embarque é o da filial dele (cadastro Filial → Centro de custo). */
export const centroDaLinha = (l: LinhaFrete, idx: Indices): string => idx.filial.get(l.embarque.filial_id)?.centro_custo_id ?? SEM_CENTRO;

const passaCentro = (l: LinhaFrete, f: FiltrosSupervisor, idx: Indices) => !f.centro || centroDaLinha(l, idx) === f.centro;
const passaFilial = (l: LinhaFrete, f: FiltrosSupervisor) => !f.filial || l.embarque.filial_id === f.filial;
const passaCidade = (l: LinhaFrete, f: FiltrosSupervisor) => !f.cidade || chaveCidade(l.embarque.origem_cidade, l.embarque.origem_uf) === f.cidade;

const ordenar = (m: Map<string, string>): Opcao[] =>
  [...m.entries()].map(([valor, rotulo]) => ({ valor, rotulo })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));

/** Opções de cada filtro, só com os vínculos reais das posições autorizadas e das seleções anteriores. */
export function opcoesSupervisor(linhas: LinhaFrete[], f: FiltrosSupervisor, idx: Indices) {
  const centros = new Map<string, string>();
  const filiais = new Map<string, string>();
  const cidades = new Map<string, string>();
  for (const l of linhas) {
    const cc = centroDaLinha(l, idx);
    centros.set(cc, cc === SEM_CENTRO ? 'Sem centro de custo' : nome(idx.centroCusto, cc));
    if (!passaCentro(l, f, idx)) continue;
    filiais.set(l.embarque.filial_id, nome(idx.filial, l.embarque.filial_id));
    if (!passaFilial(l, f)) continue;
    const k = chaveCidade(l.embarque.origem_cidade, l.embarque.origem_uf);
    if (!cidades.has(k)) cidades.set(k, cidadeUF(l.embarque.origem_cidade, l.embarque.origem_uf));
  }
  return { centros: ordenar(centros), filiais: ordenar(filiais), cidades: ordenar(cidades) };
}

/** Seleção que deixou de existir depois de mudar o filtro anterior volta para "Todos/Todas". */
export function ajustarFiltros(linhas: LinhaFrete[], f: FiltrosSupervisor, idx: Indices): FiltrosSupervisor {
  let r = { ...f };
  if (r.centro && !opcoesSupervisor(linhas, FILTROS_SUPERVISOR_VAZIOS, idx).centros.some((o) => o.valor === r.centro)) r = { ...r, centro: '' };
  if (r.filial && !opcoesSupervisor(linhas, r, idx).filiais.some((o) => o.valor === r.filial)) r = { ...r, filial: '' };
  if (r.cidade && !opcoesSupervisor(linhas, r, idx).cidades.some((o) => o.valor === r.cidade)) r = { ...r, cidade: '' };
  return r;
}

/** Interseção dos três filtros. */
export const filtrarSupervisor = (linhas: LinhaFrete[], f: FiltrosSupervisor, idx: Indices) =>
  linhas.filter((l) => passaCentro(l, f, idx) && passaFilial(l, f) && passaCidade(l, f));

// ---------------------------------------------------------------------------
// Confirmação na janela de duas horas
// ---------------------------------------------------------------------------
export const JANELA_MS = 2 * 3600e3;
/** Folga para diferença de relógio entre a resposta do servidor e a tela. */
const FOLGA_MS = 5e3;

/** Última confirmação entre agora − 2h e agora, e no dia da data operacional consultada. */
export function confirmadaNaJanela(p: Pick<Posicao, 'confirmado_em'> | null, dataConsulta: string, agoraMs: number): boolean {
  if (!p?.confirmado_em) return false;
  const t = Date.parse(p.confirmado_em);
  if (!Number.isFinite(t) || t > agoraMs + FOLGA_MS || t < agoraMs - JANELA_MS) return false;
  return hojeSP(new Date(t)) === dataConsulta;
}

// ---------------------------------------------------------------------------
// Quadro do cliente
// ---------------------------------------------------------------------------
/** Média aprovada para a previsão de volume desta apresentação (não é pesagem). */
export const TONELADAS_VEICULO_QUADRO = 40;

/** Linha da tabela destinada ao cliente: sem código do embarque, status, nomes ou valores financeiros. */
export interface LinhaQuadro {
  chave: string;
  origem: string; coleta: string | null;
  destino: string; entrega: string | null;
  porta: number | null; transito: number | null; carregados: number | null;
  observacao: string | null;
}

export interface QuadroCliente {
  cliente: string; logoCliente: string | null; logoEmpresa: string | null; data: string;
  linhas: LinhaQuadro[];
  totais: { embarques: number; porta: number; transito: number; carregados: number };
  destinos: Array<{ chave: string; rotulo: string; toneladas: number }>;
  volumeTotal: number;
}

/** Status e atualização de cada linha, só para a mesa comercial (nunca entram no quadro do cliente). */
export interface InfoMesa { status: StatusLiberacao; confirmado_em: string | null; confirmado_por: string | null; desatualizada: boolean }

/** Recorte do quadro: um cliente, a data, todas as filiais autorizadas ou uma. Só embarques com posição na data. */
export function recorteCliente(linhas: LinhaFrete[], clienteId: string, filialId: string, idx: Indices): LinhaFrete[] {
  const n = (id: string | null) => nome(idx.local, id, '');
  return linhas
    .filter((l) => l.posicao && l.embarque.cliente_id === clienteId && (!filialId || l.embarque.filial_id === filialId))
    .sort((a, b) =>
      a.embarque.origem_cidade.localeCompare(b.embarque.origem_cidade, 'pt-BR')
      || n(a.embarque.local_coleta_id).localeCompare(n(b.embarque.local_coleta_id), 'pt-BR')
      || a.embarque.destino_cidade.localeCompare(b.embarque.destino_cidade, 'pt-BR')
      || a.embarque.codigo - b.embarque.codigo);
}

const veiculos = (p: Posicao) => (p.porta ?? 0) + (p.transito ?? 0) + (p.carregados ?? 0);

export function montarQuadro(recorte: LinhaFrete[], clienteId: string, data: string, idx: Indices, logoEmpresa: string | null): QuadroCliente {
  const cliente = idx.cliente.get(clienteId);
  const linhas: LinhaQuadro[] = [];
  const destinos = new Map<string, { chave: string; rotulo: string; toneladas: number }>();
  const totais = { embarques: 0, porta: 0, transito: 0, carregados: 0 };
  recorte.forEach((l, i) => {
    const e = l.embarque;
    const p = l.posicao!;
    linhas.push({
      chave: String(i),
      origem: cidadeUF(e.origem_cidade, e.origem_uf), coleta: nome(idx.local, e.local_coleta_id, '') || null,
      destino: cidadeUF(e.destino_cidade, e.destino_uf), entrega: nome(idx.local, e.local_entrega_id, '') || null,
      porta: p.porta, transito: p.transito, carregados: p.carregados,
      observacao: p.obs_cliente?.trim() || null,
    });
    totais.embarques++;
    totais.porta += p.porta ?? 0;
    totais.transito += p.transito ?? 0;
    totais.carregados += p.carregados ?? 0;
    const k = chaveCidade(e.destino_cidade, e.destino_uf);
    const d = destinos.get(k) ?? { chave: k, rotulo: cidadeUF(e.destino_cidade, e.destino_uf), toneladas: 0 };
    d.toneladas += veiculos(p) * TONELADAS_VEICULO_QUADRO;
    destinos.set(k, d);
  });
  const lista = [...destinos.values()].sort((a, b) => b.toneladas - a.toneladas || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  return {
    cliente: cliente?.nome ?? '—', logoCliente: cliente?.logo_url || null, logoEmpresa, data, linhas, totais,
    destinos: lista, volumeTotal: lista.reduce((s, d) => s + d.toneladas, 0),
  };
}

export function infoMesa(recorte: LinhaFrete[], data: string, agoraMs: number): Record<string, InfoMesa> {
  return Object.fromEntries(recorte.map((l, i) => [String(i), {
    status: l.embarque.status_liberacao,
    confirmado_em: l.posicao?.confirmado_em ?? null,
    confirmado_por: l.posicao?.confirmado_por_nome ?? null,
    desatualizada: !confirmadaNaJanela(l.posicao, data, agoraMs),
  }]));
}

/** Blocos de até quatro destinos (opção de distribuir lado a lado quando houver mais de quatro). */
export function blocosDestinos<T>(destinos: T[], distribuir: boolean): T[][] {
  if (!distribuir || destinos.length <= 4) return [destinos];
  const blocos: T[][] = [];
  for (let i = 0; i < destinos.length; i += 4) blocos.push(destinos.slice(i, i + 4));
  return blocos;
}

// ---------------------------------------------------------------------------
// Relatório interno: atualização das posições por filial
// ---------------------------------------------------------------------------
export interface LinhaRelatorio {
  filialId: string; filial: string;
  responsaveis: string[]; ultima: string | null;
  total: number; atualizados: number; pendentes: number; nuncaConfirmadas: number;
  cobertura: number | null;
}

export function relatorioFiliais(recorte: LinhaFrete[], data: string, agoraMs: number, idx: Indices): LinhaRelatorio[] {
  const m = new Map<string, { linhas: LinhaFrete[] }>();
  for (const l of recorte) {
    const g = m.get(l.embarque.filial_id) ?? { linhas: [] };
    g.linhas.push(l);
    m.set(l.embarque.filial_id, g);
  }
  return [...m.entries()].map(([filialId, g]) => {
    // Embarques distintos: uma posição por embarque e data, então cada linha conta uma vez.
    const confirmadas = g.linhas
      .filter((l) => l.posicao?.confirmado_em && hojeSP(new Date(l.posicao.confirmado_em)) === data && Date.parse(l.posicao.confirmado_em) <= agoraMs + FOLGA_MS)
      .sort((a, b) => b.posicao!.confirmado_em!.localeCompare(a.posicao!.confirmado_em!));
    const responsaveis = [...new Set(confirmadas.map((l) => l.posicao!.confirmado_por_nome).filter((x): x is string => !!x))];
    const total = g.linhas.length;
    const atualizados = g.linhas.filter((l) => confirmadaNaJanela(l.posicao, data, agoraMs)).length;
    return {
      filialId, filial: nome(idx.filial, filialId),
      responsaveis, ultima: confirmadas[0]?.posicao?.confirmado_em ?? null,
      total, atualizados, pendentes: total - atualizados,
      nuncaConfirmadas: g.linhas.filter((l) => !l.posicao?.confirmado_em).length,
      cobertura: total ? (atualizados / total) * 100 : null,
    };
  }).sort((a, b) => a.filial.localeCompare(b.filial, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Imagem por centro de custo (uso interno: supervisores e gestão)
// ---------------------------------------------------------------------------
export interface LinhaPrintCentro {
  chave: string; cliente: string; lote: string | null;
  origem: string; coleta: string | null; destino: string; entrega: string | null;
  porta_t: number; carregado_t: number; meta_t: number | null;
  /** Executado = volume carregado ÷ meta do dia × 100 (mesmas faixas do Dashboard). */
  pct: number | null; faixa: FaixaBarra | null;
  ultima: string | null; por: string | null;
}
export interface PrintCentro {
  chave: string; centro: string; linhas: LinhaPrintCentro[];
  totais: { porta_t: number; carregado_t: number; meta_t: number | null; pct: number | null; faixa: FaixaBarra | null };
}

/** Agrupa as posições (já filtradas) por centro de custo, na ordem de origem, coleta e destino. */
export function printPorCentro(linhas: LinhaFrete[], idx: Indices, cfg: Pick<Configuracoes, 'meta_veiculos_lote_padrao'>, lotes: Record<string, { numero: string }> = {}): PrintCentro[] {
  const grupos = new Map<string, LinhaFrete[]>();
  for (const l of linhas) {
    if (!l.posicao) continue;
    const cc = centroDaLinha(l, idx);
    grupos.set(cc, [...(grupos.get(cc) ?? []), l]);
  }
  const n = (id: string | null) => nome(idx.local, id, '');
  return [...grupos.entries()].map(([cc, ls]) => {
    const linhasCc = ls
      .sort((a, b) => a.embarque.origem_cidade.localeCompare(b.embarque.origem_cidade, 'pt-BR')
        || n(a.embarque.local_coleta_id).localeCompare(n(b.embarque.local_coleta_id), 'pt-BR')
        || a.embarque.destino_cidade.localeCompare(b.embarque.destino_cidade, 'pt-BR') || a.embarque.codigo - b.embarque.codigo)
      .map((l): LinhaPrintCentro => {
        const e = l.embarque;
        const p = l.posicao!;
        const v = volumes(p);
        const meta = metaDaPosicao(p, cfg).volume_t;
        const pct = meta && meta > 0 ? (v.carregado_t / meta) * 100 : null;
        return {
          chave: p.id, cliente: nome(idx.cliente, e.cliente_id), lote: lotes[e.id]?.numero ?? null,
          origem: cidadeUF(e.origem_cidade, e.origem_uf), coleta: n(e.local_coleta_id) || null,
          destino: cidadeUF(e.destino_cidade, e.destino_uf), entrega: n(e.local_entrega_id) || null,
          porta_t: v.porta_t, carregado_t: v.carregado_t, meta_t: meta, pct, faixa: faixaBarra(pct),
          ultima: p.confirmado_em ?? p.atualizado_em ?? null, por: (p.confirmado_em ? p.confirmado_por_nome : p.atualizado_por_nome) ?? null,
        };
      });
    const soma = (k: 'porta_t' | 'carregado_t') => linhasCc.reduce((t, x) => t + x[k], 0);
    const comMeta = linhasCc.filter((x) => x.meta_t != null);
    const meta_t = comMeta.length ? comMeta.reduce((t, x) => t + (x.meta_t ?? 0), 0) : null;
    const carregMeta = comMeta.reduce((t, x) => t + x.carregado_t, 0);
    const pct = meta_t ? (carregMeta / meta_t) * 100 : null;
    return {
      chave: cc, centro: cc === SEM_CENTRO ? 'Sem centro de custo' : nome(idx.centroCusto, cc), linhas: linhasCc,
      totais: { porta_t: soma('porta_t'), carregado_t: soma('carregado_t'), meta_t, pct, faixa: faixaBarra(pct) },
    };
  }).sort((a, b) => a.centro.localeCompare(b.centro, 'pt-BR'));
}
