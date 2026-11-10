import { describe, expect, it } from 'vitest';
import type { SolicitacaoDoc } from '../types';
import { faixaCliente, relogiosEstadia, tempoDoc } from './documentacao';
import { type LinhaChamado, aplicarRelogioCliente, retornoCliente } from './painelOperacional';

const H = 3600e3;
const D = 24 * H;
const agora = Date.parse('2026-11-10T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const est = (o: Partial<SolicitacaoDoc>): SolicitacaoDoc => ({
  id: 'e1', numero: 1, tipo: 'estadia', status: 'em_atendimento', placa: 'ABC1D23', enviado_em: iso(agora - 10 * D),
  concluido_em: null, cancelado_em: null, est_cliente_desde: null, est_cliente_seg: 0, est_rodadas_cliente: 0,
  retrato: { cliente: 'Cliente A', carteira: 'Leandro' }, est_valor_calculado: 1000, solicitante_nome: 'Ana',
  ...o,
} as SolicitacaoDoc);
const linha = (s: SolicitacaoDoc, o: Partial<LinhaChamado> = {}): LinhaChamado => ({
  s: { id: s.id, numero: s.numero, tipo: s.tipo, status: s.status, filial_id: null, centro_custo_id: null, solicitante_id: 'u1', solicitante_nome: 'Ana',
    responsavel_id: null, responsavel_nome: null, enviado_em: s.enviado_em },
  completo: true, fila_ms: 0, atendimento_ms: 0, pendencia_ms: 0, cliente_ms: 0, total_ms: null, devolucoes: 0, motivos: [], assumiram: new Map(),
  concluido_por: null, inicio_fila_atual: null, intervalos: [], ...o,
});

describe('relógio do cliente na estadia', () => {
  it('pausa a TP enquanto o cliente não responde', () => {
    const s = est({ status: 'aguardando_cliente', est_cliente_desde: iso(agora - 3 * D), est_rodadas_cliente: 1 });
    const r = relogiosEstadia(s, agora);
    expect(r.aberto_ms).toBe(3 * D);
    expect(r.tp_ms).toBe(7 * D);
    expect(r.faixa).toBe('no_prazo');
    expect(tempoDoc(s, agora)).toEqual({ rotulo: 'TP (pausado)', texto: '7 d 0 h', cliente: { texto: 'Cliente há 3 d 0 h', faixa: 'no_prazo' } });
    // Uma hora depois a TP continua igual: só o cliente corre.
    expect(relogiosEstadia(s, agora + H).tp_ms).toBe(7 * D);
  });

  it('soma as rodadas fechadas e para no fim', () => {
    const s = est({ status: 'aprovada', concluido_em: iso(agora - D), est_cliente_seg: 4 * 86400, est_rodadas_cliente: 2 });
    const r = relogiosEstadia(s, agora);
    expect(r.cliente_ms).toBe(4 * D);
    expect(r.tp_ms).toBe(5 * D);
    expect(tempoDoc(s, agora)).toEqual({ rotulo: 'Total na TP', texto: '5 d 0 h', cliente: { texto: 'Cliente levou 4 d 0 h', faixa: null } });
  });

  it('não muda o tempo de quem nunca foi ao cliente', () => {
    expect(tempoDoc(est({}), agora)).toEqual({ rotulo: 'Aberta há', texto: '10 d 0 h' });
  });

  it('faixas de 7 e 15 dias', () => {
    expect(faixaCliente(7 * D)).toBe('no_prazo');
    expect(faixaCliente(7 * D + 1)).toBe('atencao');
    expect(faixaCliente(15 * D)).toBe('atencao');
    expect(faixaCliente(15 * D + 1)).toBe('atrasado');
  });

  it('painel: a demora para registrar volta ao atendimento e o total fica só com a TP', () => {
    const s = est({ status: 'aprovada', concluido_em: iso(agora), est_cliente_seg: 2 * 86400, est_rodadas_cliente: 1 });
    // Pelos eventos: 3 dias com o cliente (até o registro); o cliente respondeu em 2.
    const [l] = aplicarRelogioCliente([linha(s, { atendimento_ms: 5 * H, cliente_ms: 3 * D, total_ms: 10 * D })], { e1: s }, agora);
    expect(l.cliente_ms).toBe(2 * D);
    expect(l.atendimento_ms).toBe(5 * H + D);
    expect(l.total_ms).toBe(8 * D);
  });

  it('painel: faixas, valores parados e agrupamento por cliente e comercial', () => {
    const a = est({ id: 'a', status: 'aguardando_cliente', est_cliente_desde: iso(agora - 3 * D), est_rodadas_cliente: 1, est_valor_calculado: 100 });
    const b = est({ id: 'b', status: 'pago_pendencia', est_cliente_desde: iso(agora - 9 * D), est_rodadas_cliente: 2, est_valor_calculado: 200, est_valor_pago: 150,
      retrato: { cliente: 'Cliente B', carteira: 'Frederick' } as SolicitacaoDoc['retrato'] });
    const c = est({ id: 'c', status: 'aguardando_cliente', est_cliente_desde: iso(agora - 20 * D), est_rodadas_cliente: 1, est_valor_calculado: 300 });
    const d = est({ id: 'd', status: 'aprovada_parcial', concluido_em: iso(agora), est_cliente_seg: 4 * 86400, est_rodadas_cliente: 1, est_resultado: 'aprovada_parcial',
      est_valor_calculado: 400, est_valor_aprovado: 300 });
    const docs = { a, b, c, d };
    const ls = [a, b, c, d].map((s) => linha(s));
    const r = retornoCliente(ls, ls, docs, agora);
    expect(r.abertas.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(r.faixas).toEqual({ no_prazo: { n: 1, valor: 100 }, atencao: { n: 1, valor: 200 }, atrasado: { n: 1, valor: 300 } });
    expect(r.valor_aguardando).toBe(600);
    expect(r.pago_sem_receita).toBe(150);
    expect(r.maior_espera_ms).toBe(20 * D);
    expect(r.mediana_resposta_ms).toBe(4 * D);
    expect(r.reenviadas).toBe(1);
    expect(r.aprovacao).toBe(0.75);
    expect(r.porCliente.map((x) => [x.nome, x.abertas, x.valor_aguardando])).toEqual([['Cliente A', 2, 400], ['Cliente B', 1, 200]]);
    expect(r.porComercial.find((x) => x.nome === 'Leandro')?.aprovacao).toBe(0.75);
  });
});
