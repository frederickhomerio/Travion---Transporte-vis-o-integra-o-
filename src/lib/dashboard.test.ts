import { describe, expect, it } from 'vitest';
import { CONFIG_PADRAO, type Embarque, type Financeiro, type LinhaFrete, type Posicao } from '../types';
import { diasDoIntervalo, indicadores, indicadoresPorGrupo, intervaloPeriodo } from './dashboard';

const emb = (id: string, filial: string): Embarque => ({
  id, codigo: 1, cliente_id: 'c1', comercial_id: null, filial_id: filial, produto_id: null,
  origem_cidade: 'RIO VERDE', origem_uf: 'GO', local_coleta_id: null, destino_cidade: 'SANTOS', destino_uf: 'SP',
  local_entrega_id: null, status_liberacao: 'liberado', data_liberacao: null, cadencia_valor: null,
  cadencia_unidade: 'veiculos_dia', toneladas_por_veiculo: 40, observacao_interna: null, situacao: 'ativo',
  is_demo: false, chave_importacao: null, versao: 1, atualizado_em: '', atualizado_por_nome: null,
});
const pos = (eid: string, data: string, porta: number, carregados: number): Posicao => ({
  id: `${eid}-${data}`, embarque_id: eid, data_operacional: data, porta, transito: 1, carregados,
  toneladas_por_veiculo: 40, meta_valor: null, meta_unidade: 'veiculos_dia', obs_operacional: null, obs_cliente: null,
  is_demo: false, origem: 'app', versao: 1, atualizado_em: '', atualizado_por_nome: null,
});
const fin = (eid: string, fe: number, fm: number): Financeiro => ({
  embarque_id: eid, frete_empresa: fe, frete_motorista: fm, unidade_frete: 'rs_tonelada',
  frete_empresa_original: null, frete_motorista_original: null, versao: 1, atualizado_em: '',
});
const linha = (eid: string, filial: string, data: string, porta: number, carr: number, fe = 200, fm = 180): LinhaFrete =>
  ({ embarque: emb(eid, filial), posicao: pos(eid, data, porta, carr), financeiro: fin(eid, fe, fm) });

describe('período do dashboard', () => {
  it('semana vai de segunda a domingo e mês começa no dia 1', () => {
    expect(intervaloPeriodo('2026-10-27', 'dia')).toEqual({ inicio: '2026-10-27', fim: '2026-10-27' });
    expect(intervaloPeriodo('2026-10-27', 'semana')).toEqual({ inicio: '2026-10-26', fim: '2026-11-01' });
    expect(intervaloPeriodo('2026-11-01', 'semana')).toEqual({ inicio: '2026-10-26', fim: '2026-11-01' });
    expect(intervaloPeriodo('2026-10-26', 'semana').inicio).toBe('2026-10-26');
    expect(intervaloPeriodo('2026-02-10', 'mes')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
  });
  it('não conta dias depois de hoje', () => {
    expect(diasDoIntervalo('2026-10-26', '2026-11-01', '2026-10-27')).toEqual(['2026-10-26', '2026-10-27']);
  });
});

describe('indicadores do dashboard', () => {
  it('margem líquida = margem bruta − 1,8% do faturamento', () => {
    // 2 na porta + 3 carregados = 5 × 40 t = 200 t; faturamento 200 × 200 = 40.000; margem bruta 10% = 4.000
    const r = indicadores([[linha('e1', 'f1', '2026-10-27', 2, 3)]], CONFIG_PADRAO, true);
    expect(r.projetado_t).toBe(200);
    expect(r.faturamento).toBeCloseTo(40000);
    expect(r.margem_bruta).toBeCloseTo(4000);
    expect(r.margem_liquida).toBeCloseTo(4000 - 720);
    expect(r.margem_liquida_pct).toBeCloseTo(8.2);
    // meta padrão 2 veículos × 40 t = 80 t disponibilizado → R$ 16.000
    expect(r.faturamento_disponibilizado).toBeCloseTo(16000);
  });
  it('soma os dias: carregados acumulam, porta é o saldo do último dia', () => {
    const r = indicadores([[linha('e1', 'f1', '2026-10-26', 4, 1)], [linha('e1', 'f1', '2026-10-27', 2, 3)]], CONFIG_PADRAO, true);
    expect(r.porta).toBe(2);
    expect(r.carregados).toBe(4);
    expect(r.projetado_t).toBe(400);
    expect(r.disponibilizado_t).toBe(160);
  });
  it('sem permissão financeira não calcula valores em R$', () => {
    const r = indicadores([[linha('e1', 'f1', '2026-10-27', 2, 3)]], CONFIG_PADRAO, false);
    expect(r.faturamento).toBeNull();
    expect(r.margem_liquida).toBeNull();
  });
  it('agrupa por filial', () => {
    const dia = [linha('e1', 'f1', '2026-10-27', 1, 0), linha('e2', 'f2', '2026-10-27', 0, 2)];
    const g = indicadoresPorGrupo([dia], (l) => l.embarque.filial_id, CONFIG_PADRAO, true, ['f3']);
    expect(g.get('f1')!.projetado_t).toBe(40);
    expect(g.get('f2')!.projetado_t).toBe(80);
    expect(g.get('f3')!.lotes).toBe(0);
  });
});
