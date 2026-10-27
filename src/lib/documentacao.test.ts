import { describe, expect, it } from 'vitest';
import type { SolicitacaoDoc } from '../types';
import { acaoDocumentacao, avisosDuplicidade, duracao, FILTROS_FILA, filtrarFila, normalizarPlaca, tempoDoc } from './documentacao';

const base = Date.parse('2026-10-27T12:00:00Z');
const sol = (o: Partial<SolicitacaoDoc>): SolicitacaoDoc => ({
  id: 's1', numero: 1, embarque_id: 'e1', tipo: 'emissao', status: 'enviado', placa: 'ABC1D23', placas_reboque: [],
  enviado_em: new Date(base - 30 * 60000).toISOString(), atualizado_em: new Date(base).toISOString(),
  retrato: { cliente: 'Cargill', filial_id: 'f1', lote_numero: null }, solicitante_nome: 'Ana', nomes_nf: [],
  ...o,
} as SolicitacaoDoc);

describe('documentação', () => {
  it('formata a duração', () => {
    expect(duracao(-5)).toBe('0 min');
    expect(duracao(59 * 60000)).toBe('59 min');
    expect(duracao(125 * 60000)).toBe('2 h 05 min');
    expect(duracao(26 * 3600e3)).toBe('1 d 2 h');
  });

  it('mostra o tempo conforme o status', () => {
    expect(tempoDoc(sol({}), base)).toEqual({ rotulo: 'Aguardando há', texto: '30 min' });
    expect(tempoDoc(sol({ status: 'em_atendimento' }), base).rotulo).toBe('Aberta há');
    expect(tempoDoc(sol({ status: 'documentacao_disponivel', concluido_em: new Date(base).toISOString() }), base + 9e6))
      .toEqual({ rotulo: 'Total', texto: '30 min' });
  });

  it('escolhe o botão da documentação', () => {
    expect(acaoDocumentacao(undefined, []).tipo).toBe('gerar');
    expect(acaoDocumentacao(undefined, [sol({ tipo: 'lote_emissao', status: 'cancelado' })]).tipo).toBe('gerar');
    expect(acaoDocumentacao(undefined, [sol({ tipo: 'lote_emissao' })]).tipo).toBe('acompanhar');
    expect(acaoDocumentacao({ numero: 'L-1' } as never, [sol({ tipo: 'lote_emissao' })]).tipo).toBe('emitir');
  });

  it('avisa placa e NF repetidas', () => {
    const outra = sol({ numero: 7, nomes_nf: ['NF 123.pdf'] });
    const avisos = avisosDuplicidade('abc-1d23', ['nf 123.PDF'], [outra], base);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain('ABC-1D23');
    expect(avisosDuplicidade('XYZ9A99', ['outra.pdf'], [outra], base)).toEqual([]);
    expect(avisosDuplicidade('ABC1D23', [], [outra], base + 49 * 3600e3)).toEqual([]);
  });

  it('filtra a fila por atalho, responsável e busca', () => {
    const ss = [
      sol({ id: 'a', numero: 1 }),
      sol({ id: 'b', numero: 2, status: 'em_atendimento', responsavel_id: 'eu', placa: 'QWE4R56' }),
      sol({ id: 'c', numero: 3, status: 'aguardando_informacao', responsavel_id: 'outro', retrato: { cliente: 'Amaggi', filial_id: 'f2', lote_numero: 'L-24817' } as never }),
      sol({ id: 'd', numero: 4, status: 'documentacao_disponivel', concluido_em: new Date(base).toISOString() }),
    ];
    const ids = (f: Partial<typeof FILTROS_FILA>) => filtrarFila(ss, { ...FILTROS_FILA, ...f }, 'eu').map((s) => s.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ atalho: 'minhas' })).toEqual(['b']);
    expect(ids({ atalho: 'concluidas' })).toEqual(['d']);
    expect(ids({ responsavel: '-' })).toEqual(['a']);
    expect(ids({ filial: 'f2' })).toEqual(['c']);
    expect(ids({ busca: 'qwe-4r' })).toEqual(['b']);
    expect(ids({ busca: '24817' })).toEqual(['c']);
    expect(ids({ busca: 'amaggi' })).toEqual(['c']);
    expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
  });
});
