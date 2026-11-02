import { describe, expect, it } from 'vitest';
import type { Embarque, Financeiro, ItemVitrine } from '../types';
import { abaDoEmbarque, linhasVitrine, motivoValido } from './vitrine';

const base = { situacao: 'ativo', encerrado_em: null, status_liberacao: 'liberado' } as const;

describe('abaDoEmbarque', () => {
  it('liberado, suspenso e encerrado', () => {
    expect(abaDoEmbarque(base)).toBe('liberados');
    expect(abaDoEmbarque({ ...base, status_liberacao: 'suspenso' })).toBe('suspensos');
    expect(abaDoEmbarque({ situacao: 'arquivado', encerrado_em: '2026-11-01T10:00:00Z', status_liberacao: 'liberado' })).toBe('encerrados');
  });
  it('encerrado não volta para Suspensos pelo status anterior', () => {
    expect(abaDoEmbarque({ situacao: 'arquivado', encerrado_em: '2026-11-01T10:00:00Z', status_liberacao: 'suspenso' })).toBe('encerrados');
  });
  it('combinações inválidas ficam fora das abas', () => {
    expect(abaDoEmbarque({ situacao: 'arquivado', encerrado_em: null, status_liberacao: 'liberado' })).toBeNull();
    expect(abaDoEmbarque({ situacao: 'ativo', encerrado_em: '2026-11-01T10:00:00Z', status_liberacao: 'liberado' })).toBeNull();
  });
});

const item = (id: string, noEscopo: boolean): ItemVitrine => ({
  id, codigo: 7, filial_id: 'f1', centro_custo_id: 'c1', produto_id: 'p1', origem_cidade: 'Jataí', origem_uf: 'GO', local_coleta_id: null,
  destino_cidade: 'Santos', destino_uf: 'SP', local_entrega_id: null, frete_motorista: 150, unidade_frete: 'rs_tonelada',
  atualizado_em: '2026-11-02T10:00:00Z', no_escopo: noEscopo,
});

describe('linhasVitrine', () => {
  const completo = { id: 'a', codigo: 7, cliente_id: 'cli', comercial_id: null, filial_id: 'f1', situacao: 'ativo', status_liberacao: 'liberado' } as Embarque;
  const fin = { embarque_id: 'a', frete_empresa: 200, frete_motorista: 150, unidade_frete: 'rs_tonelada' } as Financeiro;

  it('fora do escopo: sem cliente, sem frete empresa e sem ações', () => {
    const [l] = linhasVitrine([item('b', false)], {}, {});
    expect(l.noEscopo).toBe(false);
    expect(l.embarque.cliente_id).toBe('');
    expect(l.financeiro?.frete_empresa).toBeNull();
    expect(l.financeiro?.frete_motorista).toBe(150);
    expect(l.centroCustoId).toBe('c1');
  });
  it('no escopo: usa o embarque completo e o financeiro com margem', () => {
    const [l] = linhasVitrine([item('a', true)], { a: completo }, { a: fin });
    expect(l.noEscopo).toBe(true);
    expect(l.embarque.cliente_id).toBe('cli');
    expect(l.financeiro?.frete_empresa).toBe(200);
  });
  it('no escopo sem o registro completo ainda: não libera ações', () => {
    const [l] = linhasVitrine([item('a', true)], {}, {});
    expect(l.noEscopo).toBe(false);
  });
  it('nunca usa o financeiro completo de um item fora do escopo', () => {
    const [l] = linhasVitrine([item('a', false)], { a: completo }, { a: fin });
    expect(l.financeiro?.frete_empresa).toBeNull();
    expect(l.noEscopo).toBe(false);
  });
});

describe('motivoValido', () => {
  it('obrigatório e até 500 caracteres', () => {
    expect(motivoValido('  ')).toBe(false);
    expect(motivoValido('Cliente retomou')).toBe(true);
    expect(motivoValido('x'.repeat(500))).toBe(true);
    expect(motivoValido('x'.repeat(501))).toBe(false);
  });
});
