import { describe, expect, it } from 'vitest';
import { CONFIG_PADRAO, type Embarque, type Financeiro, type LinhaFrete, type Posicao } from '../types';
import { aderencia, mediaSimples, metaLote, resumir, resumirPeriodo, resumoFinanceiro, volumes } from './calculos';

const emb = (over: Partial<Embarque> = {}): Embarque => ({
  id: 'e1', codigo: 1, cliente_id: 'c1', comercial_id: null, filial_id: 'f1', produto_id: null,
  origem_cidade: 'RIO VERDE', origem_uf: 'GO', local_coleta_id: null, destino_cidade: 'SANTOS', destino_uf: 'SP',
  local_entrega_id: null, status_liberacao: 'liberado', data_liberacao: null, cadencia_valor: 2,
  cadencia_unidade: 'veiculos_dia', toneladas_por_veiculo: 40, observacao_interna: null, situacao: 'ativo',
  is_demo: false, chave_importacao: null, versao: 1, atualizado_em: '2026-10-26T12:00:00Z', atualizado_por_nome: null,
  ...over,
});
const pos = (over: Partial<Posicao> = {}): Posicao => ({
  id: 'p1', embarque_id: 'e1', data_operacional: '2026-10-26', porta: 3, transito: 2, carregados: 4,
  toneladas_por_veiculo: 40, meta_valor: 2, meta_unidade: 'veiculos_dia', obs_operacional: null, obs_cliente: null,
  is_demo: false, origem: 'app', versao: 1, atualizado_em: '2026-10-26T12:00:00Z', atualizado_por_nome: null,
  ...over,
});
const fin = (fe: number | null, fm: number | null, unidade: Financeiro['unidade_frete'] = 'rs_tonelada'): Financeiro => ({
  embarque_id: 'e1', frete_empresa: fe, frete_motorista: fm, unidade_frete: unidade,
  frete_empresa_original: null, frete_motorista_original: null, versao: 1, atualizado_em: '',
});

describe('critério de aceite: volumes', () => {
  it('porta 3, trânsito 2, carregados 4 e 40 t', () => {
    const v = volumes({ porta: 3, transito: 2, carregados: 4, toneladas_por_veiculo: 40 });
    expect(v.porta_t).toBe(120);
    expect(v.transito_t).toBe(80);
    expect(v.carregado_t).toBe(160);
    expect(v.projetado_t).toBe(280); // projeção não inclui trânsito
    expect(v.potencial_t).toBe(360);
    expect(v.total_veiculos).toBe(9);
  });
  it('contador não informado conta como ausente, não como valor', () => {
    const v = volumes({ porta: null, transito: 1, carregados: null, toneladas_por_veiculo: 40 });
    expect(v.nao_informados).toBe(2);
    expect(v.total_veiculos).toBe(1);
  });
});

describe('critério de aceite: metas e aderência', () => {
  it('lote sem meta diária fica sem meta (não há meta padrão)', () => {
    expect(metaLote({ valor: null, unidade: 'veiculos_dia', capacidade: 40 }).volume_t).toBeNull();
  });
  it('cadência específica substitui a meta padrão', () => {
    const m = metaLote({ valor: 3, unidade: 'veiculos_dia', capacidade: 40 });
    expect(m).toMatchObject({ veiculos: 3, volume_t: 120, origem: 'cadencia' });
  });
  it('cadência em toneladas/dia', () => {
    const m = metaLote({ valor: 100, unidade: 'toneladas_dia', capacidade: 40 });
    expect(m).toMatchObject({ veiculos: 2.5, volume_t: 100 });
  });
  it('meta ausente não causa divisão por zero', () => {
    expect(aderencia(280, 0)).toBeNull();
    expect(aderencia(280, null)).toBeNull();
    const r = resumir([{ embarque: emb({ cadencia_valor: null }), posicao: pos({ meta_valor: null }), financeiro: null }], CONFIG_PADRAO, false);
    expect(r.disponibilizado_t).toBeNull();
    expect(r.aderencia_pct).toBeNull();
  });
  it('aderência não é limitada a 100%', () => {
    const r = resumir([{ embarque: emb(), posicao: pos(), financeiro: null }], CONFIG_PADRAO, false);
    expect(r.disponibilizado_t).toBe(80);
    expect(r.aderencia_pct).toBe(350);
  });
});

describe('dashboard igual à planilha (aba Dashboard Operacional)', () => {
  // Totais da planilha: porta 57, trânsito 42, carregados 25, 37 lotes, meta 2, capacidade 40
  it('volume disponibilizado = lotes × meta × capacidade e projeção = (porta + carregados) × capacidade', () => {
    const linhas: LinhaFrete[] = [];
    const contadores = Array.from({ length: 37 }, (_, i) => ({ porta: 0, transito: 0, carregados: 0, i }));
    // distribui os totais da planilha
    contadores[0].porta = 57; contadores[1].transito = 42; contadores[2].carregados = 25;
    for (const c of contadores) {
      linhas.push({ embarque: emb({ id: `e${c.i}` }), posicao: pos({ id: `p${c.i}`, embarque_id: `e${c.i}`, porta: c.porta, transito: c.transito, carregados: c.carregados }), financeiro: null });
    }
    const r = resumir(linhas, CONFIG_PADRAO, false);
    expect(r.lotes).toBe(37);
    expect(r.total_veiculos).toBe(124);
    expect(r.disponibilizado_t).toBe(2960);
    expect(r.projetado_t).toBe(3280);
    expect(r.transito_t).toBe(1680);
    expect(r.aderencia_pct).toBeCloseTo(110.81, 2);
  });
});

describe('indicadores financeiros (metodologia da planilha)', () => {
  it('tickets por média simples, faturamento, margem % e margem R$', () => {
    const f = resumoFinanceiro([fin(100, 90), fin(200, 170), fin(null, null)], 1000, { ticket_inclui_frete_zero: true });
    expect(f.ticket_empresa).toBe(150);
    expect(f.ticket_motorista).toBe(130);
    expect(f.faturamento_projetado).toBe(150000);
    expect(f.margem_pct).toBeCloseTo(13.333, 2);
    expect(f.margem_projetada).toBeCloseTo(20000, 6);
  });
  it('projeção não é válida com unidade do frete não confirmada', () => {
    const f = resumoFinanceiro([fin(100, 90, 'nao_confirmada')], 1000, { ticket_inclui_frete_zero: true });
    expect(f.valido).toBe(false);
    expect(f.motivos.join(' ')).toMatch(/não confirmada/);
  });
  it('média simples ignora não numéricos e respeita configuração de zero', () => {
    expect(mediaSimples([0, 100, null], true)).toBe(50);
    expect(mediaSimples([0, 100, null], false)).toBe(100);
    expect(mediaSimples([null], true)).toBeNull();
  });
  it('margem sem ticket empresa não divide por zero', () => {
    const f = resumoFinanceiro([fin(0, 10)], 100, { ticket_inclui_frete_zero: true });
    expect(f.margem_pct).toBeNull();
  });
});

describe('capacidade preservada na posição', () => {
  it('cálculo usa a capacidade gravada na posição, não a atual do embarque', () => {
    const r = resumir([{ embarque: emb({ toneladas_por_veiculo: 30 }), posicao: pos({ toneladas_por_veiculo: 40 }), financeiro: null }], CONFIG_PADRAO, false);
    expect(r.porta_t).toBe(120);
  });
});

describe('período de vários dias', () => {
  it('saldos vêm da última posição; carregados são acumulados', () => {
    const e = emb();
    const ps = [
      pos({ id: 'a', data_operacional: '2026-10-24', porta: 5, transito: 1, carregados: 3 }),
      pos({ id: 'b', data_operacional: '2026-10-25', porta: 4, transito: 2, carregados: 2 }),
      pos({ id: 'c', data_operacional: '2026-10-26', porta: 3, transito: 2, carregados: 4 }),
    ];
    const r = resumirPeriodo([e], ps, '2026-10-24', '2026-10-26');
    expect(r.porta_saldo).toBe(3); // não soma 5 + 4 + 3
    expect(r.transito_saldo).toBe(2);
    expect(r.carregados_acumulados).toBe(9);
    expect(r.carregado_acumulado_t).toBe(360);
    expect(r.meta_periodo_t).toBe(240); // 3 dias × 80 t
    expect(r.dias).toBe(3);
    expect(r.lotes).toBe(1);
  });
});
