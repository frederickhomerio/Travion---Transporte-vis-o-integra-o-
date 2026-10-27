import { describe, expect, it } from 'vitest';
import type { Cadastros } from './cadastros';
import { indexar } from './cadastros';
import {
  ajustarFiltros, blocosDestinos, confirmadaNaJanela, FILTROS_SUPERVISOR_VAZIOS, filtrarSupervisor, infoMesa, lerContador,
  montarQuadro, opcoesSupervisor, recorteCliente, relatorioFiliais, SEM_CENTRO,
} from './posicoes';
import type { Embarque, LinhaFrete, Posicao } from '../types';

const cad: Cadastros = {
  centros_custo: [{ id: 'cc1', nome: 'Vegetal', ativo: true, is_demo: false }, { id: 'cc2', nome: 'Sul', ativo: true, is_demo: false }],
  filiais: [
    { id: 'f1', nome: 'Jataí', codigo: null, centro_custo_id: 'cc1', ativo: true, is_demo: false },
    { id: 'f2', nome: 'Itumbiara', codigo: null, centro_custo_id: 'cc2', ativo: true, is_demo: false },
    { id: 'f3', nome: 'Mineiros', codigo: null, centro_custo_id: null, ativo: true, is_demo: false },
  ],
  clientes: [{ id: 'c1', nome: 'Cliente Um', documento: null, comercial_id: null, restricao_comercial: null, ativo: true, is_demo: false, logo_url: 'data:image/png;base64,AA' }],
  comerciais: [], produtos: [], cidades: [],
  locais: [{ id: 'l1', nome: 'Fazenda Boa Vista', cidade: 'Jataí', uf: 'GO', tipo: 'coleta', ativo: true, is_demo: false }],
};
const idx = indexar(cad);
const HOJE = '2026-10-27';
const AGORA = Date.parse('2026-10-27T17:00:00Z'); // 14:00 em Brasília

let seq = 0;
function linha(filial: string, origem: string, destino: string, uf: string, p: Partial<Posicao> | null, e: Partial<Embarque> = {}): LinhaFrete {
  seq++;
  const embarque = {
    id: `e${seq}`, codigo: seq, cliente_id: 'c1', comercial_id: null, filial_id: filial, produto_id: null,
    origem_cidade: origem, origem_uf: 'GO', local_coleta_id: 'l1', destino_cidade: destino, destino_uf: uf, local_entrega_id: null,
    status_liberacao: 'liberado', situacao: 'ativo', ...e,
  } as Embarque;
  const posicao = p && ({ id: `p${seq}`, embarque_id: embarque.id, data_operacional: HOJE, porta: 0, transito: 0, carregados: 0,
    obs_cliente: null, confirmado_em: null, confirmado_por_nome: null, ...p } as Posicao);
  return { embarque, posicao, financeiro: null };
}

describe('contadores', () => {
  it('aceita só inteiros ≥ 0 e não transforma vazio em zero', () => {
    expect(lerContador('0')).toEqual({ ok: true, valor: 0 });
    expect(lerContador(' 12 ')).toEqual({ ok: true, valor: 12 });
    for (const t of ['', '-1', '1,5', '1.5', 'abc', '2e3']) expect(lerContador(t).ok).toBe(false);
  });
});

describe('filtros dos supervisores', () => {
  const ls = [
    linha('f1', 'Jataí', 'Uberaba', 'MG', {}), linha('f1', 'Mineiros', 'Santos', 'SP', {}),
    linha('f2', 'Itumbiara', 'Santos', 'SP', {}), linha('f3', 'Mineiros', 'Catalão', 'GO', {}),
  ];
  it('centro de custo vem da filial e é distinto dela', () => {
    const o = opcoesSupervisor(ls, FILTROS_SUPERVISOR_VAZIOS, idx);
    expect(o.centros.map((x) => x.rotulo)).toEqual(['Sem centro de custo', 'Sul', 'Vegetal']);
    expect(o.filiais).toHaveLength(3);
  });
  it('filial e cidade (origem) dependem das seleções anteriores', () => {
    const o = opcoesSupervisor(ls, { centro: 'cc1', filial: '', cidade: '' }, idx);
    expect(o.filiais.map((x) => x.valor)).toEqual(['f1']);
    expect(o.cidades.map((x) => x.rotulo)).toEqual(['Jataí/GO', 'Mineiros/GO']);
  });
  it('combina por interseção e cidade filtra a origem', () => {
    const r = filtrarSupervisor(ls, { centro: '', filial: '', cidade: 'MINEIROS|GO' }, idx);
    expect(r.map((l) => l.embarque.filial_id)).toEqual(['f1', 'f3']);
    expect(filtrarSupervisor(ls, { centro: 'cc1', filial: '', cidade: 'MINEIROS|GO' }, idx)).toHaveLength(1);
    expect(filtrarSupervisor(ls, { centro: SEM_CENTRO, filial: '', cidade: '' }, idx)).toHaveLength(1);
  });
  it('seleção inválida volta para todos', () => {
    expect(ajustarFiltros(ls, { centro: 'cc2', filial: 'f1', cidade: 'JATAI|GO' }, idx)).toEqual({ centro: 'cc2', filial: '', cidade: '' });
  });
});

describe('janela de duas horas', () => {
  it('conta só confirmações entre agora − 2h e agora, no dia consultado', () => {
    expect(confirmadaNaJanela({ confirmado_em: '2026-10-27T16:30:00Z' }, HOJE, AGORA)).toBe(true);
    expect(confirmadaNaJanela({ confirmado_em: '2026-10-27T14:59:00Z' }, HOJE, AGORA)).toBe(false);
    expect(confirmadaNaJanela({ confirmado_em: '2026-10-27T18:00:00Z' }, HOJE, AGORA)).toBe(false); // futura
    expect(confirmadaNaJanela({ confirmado_em: null }, HOJE, AGORA)).toBe(false);
    // 00:30 em Brasília do dia 28 conta para o dia 28, não para o dia 27
    expect(confirmadaNaJanela({ confirmado_em: '2026-10-28T03:30:00Z' }, HOJE, Date.parse('2026-10-28T04:00:00Z'))).toBe(false);
  });
});

describe('quadro do cliente', () => {
  const ls = [
    linha('f1', 'Jataí', 'Uberaba', 'MG', { porta: 4, transito: 6, carregados: 1, obs_cliente: 'Fila na balança', confirmado_em: '2026-10-27T16:50:00Z', confirmado_por_nome: 'Carlos' }),
    linha('f1', 'Jataí', 'uberaba ', 'mg', { porta: 0, transito: 0, carregados: 0 }),
    linha('f2', 'Itumbiara', 'Santos', 'SP', { porta: 1, transito: null, carregados: 2, confirmado_em: '2026-10-27T13:00:00Z', confirmado_por_nome: 'Marta' }),
    linha('f2', 'Itumbiara', 'Santos', 'SP', null),
  ];
  const recorte = recorteCliente(ls, 'c1', '', idx);
  const q = montarQuadro(recorte, 'c1', HOJE, idx, null);

  it('cada embarque é uma linha e só entram posições da data', () => {
    expect(q.linhas).toHaveLength(3);
    expect(q.totais).toEqual({ embarques: 3, porta: 5, transito: 6, carregados: 3 });
  });
  it('volume = (porta + trânsito + carregados) × 40 t, agrupado por cidade/UF', () => {
    expect(q.destinos).toEqual([
      { chave: 'UBERABA|MG', rotulo: 'Uberaba/MG', toneladas: 440 },
      { chave: 'SANTOS|SP', rotulo: 'Santos/SP', toneladas: 120 },
    ]);
    expect(q.volumeTotal).toBe(560);
  });
  it('não leva código do embarque, status ou nomes de usuários', () => {
    const texto = JSON.stringify(q);
    expect(texto).not.toMatch(/EMB-|"e\d+"|liberado|Carlos|Marta/);
    expect(q.linhas[0]).toMatchObject({ origem: 'Itumbiara/GO', coleta: 'Fazenda Boa Vista', observacao: null });
  });
  it('filial específica restringe linhas, totais e volumes', () => {
    const r = recorteCliente(ls, 'c1', 'f2', idx);
    expect(montarQuadro(r, 'c1', HOJE, idx, null).totais.embarques).toBe(1);
  });
  it('mesa mostra status e desatualização acima de 2 horas', () => {
    const m = infoMesa(recorte, HOJE, AGORA);
    const porObs = Object.values(m);
    expect(porObs.filter((x) => x.desatualizada)).toHaveLength(2);
  });
  it('destinos em blocos de até quatro só quando a opção está ligada', () => {
    const d = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(blocosDestinos(d, false)).toEqual([d]);
    expect(blocosDestinos(d, true)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
    expect(blocosDestinos([1, 2, 3, 4], true)).toEqual([[1, 2, 3, 4]]);
  });
});

describe('relatório por filial', () => {
  it('conta embarques distintos, pendentes e nunca confirmados', () => {
    const ls = [
      linha('f1', 'Jataí', 'Uberaba', 'MG', { confirmado_em: '2026-10-27T16:50:00Z', confirmado_por_nome: 'Carlos' }),
      linha('f1', 'Jataí', 'Santos', 'SP', { confirmado_em: '2026-10-27T12:00:00Z', confirmado_por_nome: 'Marta' }),
      linha('f1', 'Jataí', 'Santos', 'SP', {}),
      linha('f2', 'Itumbiara', 'Santos', 'SP', {}),
    ];
    const r = relatorioFiliais(recorteCliente(ls, 'c1', '', idx), HOJE, AGORA, idx);
    expect(r.map((x) => x.filial)).toEqual(['Itumbiara', 'Jataí']);
    expect(r[1]).toMatchObject({ total: 3, atualizados: 1, pendentes: 2, nuncaConfirmadas: 1, responsaveis: ['Carlos', 'Marta'] });
    expect(r[1].cobertura).toBeCloseTo(33.33, 1);
    expect(r[0]).toMatchObject({ total: 1, atualizados: 0, pendentes: 1, nuncaConfirmadas: 1, cobertura: 0, ultima: null });
  });
});
