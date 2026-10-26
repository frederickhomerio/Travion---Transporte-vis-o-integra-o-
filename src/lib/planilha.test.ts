import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_PADRAO, type LinhaFrete } from '../types';
import { resumir } from './calculos';
import { indexar } from './cadastros';
import { montarPosicaoCliente, textoWhatsApp } from './compartilhamento';
import { lerPlanilha } from './leitorExcel';
import { analisarClientes, analisarListaFretes, detectarCabecalho, mapearAutomatico, textoCelula, type Aba } from './planilha';

const aba = (linhas: unknown[][]): Aba => ({ nome: 'Lista de Fretes', linhas: linhas.map((r) => r.map((v) => ({ v }))) });

describe('análise da Lista de Fretes', () => {
  const cab = ['CARTEIRA', 'FILIAL', 'CLIENTE', 'ORIGEM', 'CARREGAMENTO', 'DESTINO', 'UF', 'DESCARGA', 'PRODUTO',
    'FRETE EMP', 'FRETE MOT', 'STATUS', 'PORTA', 'TRANSITO', 'CARREGADOS', 'OBSERVAÇÃO', 'VOL PORTA', 'PONTO'];
  it('mapeia colunas, ignora derivadas e guarda extras', () => {
    const m = mapearAutomatico(cab);
    expect(m[6]).toBe('destino_uf');
    expect(m[15]).toBe('obs_operacional');
    expect(m[16]).toBe('ignorar');
    expect(m[17]).toBe('extra');
  });
  it('mesma rota em duas linhas gera chaves distintas; reimportação gera as mesmas chaves', async () => {
    const linhas = [
      cab,
      ['LEANDRO', 'Itumbiara', 'CARAMURU', 'BELA VISTA', 'COAPIL', 'IPAMERI', 'GO', 'CARAMURU', 'SOJA', 61, 56, null, 7, 0, 2, null, 280, 1],
      ['LEANDRO', 'Itumbiara', 'CARAMURU ', 'BELA VISTA', 'COAPIL', 'IPAMERI', 'GO ', 'CARAMURU', 'SOJA', 'R$ 67,50', null, '', null, 1, 0, 'LOTE SUSPENSO', 0, 1],
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['', '', 'TOTAL', '', '', '', '', '', '', '', '', '', 7, 1, 2, '', '', ''],
      ['LEANDRO', '', 'SEM FILIAL', 'X', '', 'Y', '', '', '', '', '', '', 1, 0, 0, '', '', ''],
    ];
    const a = aba(linhas);
    const h = detectarCabecalho(a);
    const r1 = await analisarListaFretes(a, h, mapearAutomatico(cab));
    const r2 = await analisarListaFretes(a, h, mapearAutomatico(cab));
    const validas = r1.filter((l) => l.situacao === 'valida');
    expect(validas).toHaveLength(2);
    expect(validas[0].dados!.chave).not.toBe(validas[1].dados!.chave);
    expect(r2.filter((l) => l.situacao === 'valida').map((l) => l.dados!.chave)).toEqual(validas.map((l) => l.dados!.chave));
    expect(validas[1].dados!.frete_empresa).toBe(67.5);
    expect(validas[1].dados!.porta).toBeNull(); // ausente não vira zero
    expect(validas[1].dados!.status).toBe('nao_informado');
    expect(validas[1].sugestaoSuspenso).toBe(true);
    expect(validas[0].dados!.extras).toEqual({ PONTO: 1 });
    expect(r1.find((l) => l.motivo === 'Linha de total')).toBeTruthy();
    expect(r1.find((l) => l.situacao === 'erro')?.motivo).toMatch(/Filial/);
  });
  it('aba Clientes: "NÃO CARREGAR" é restrição, não carteira', () => {
    const r = analisarClientes(aba([['CLIENTE', 'CARTEIRA', 'Filiais'], ['A', 'FREDERICK', 'Rio Verde'], ['B', 'NÃO CARREGAR', 'Jataí'], ['A', 'X', '']]));
    expect(r.clientes).toEqual([
      { nome: 'A', carteira: 'FREDERICK', restricao: null },
      { nome: 'B', carteira: null, restricao: 'NÃO CARREGAR' },
    ]);
    expect(r.filiais).toEqual(['Rio Verde', 'Jataí']);
    expect(r.avisos).toHaveLength(1);
  });
});

// Teste com a planilha real (não versionada no repositório por conter dados comerciais).
const ARQ = process.env.PLANILHA_REFERENCIA ?? '';
describe.skipIf(!ARQ || !existsSync(ARQ))('planilha de referência', () => {
  it('reproduz os totais da aba Dashboard Operacional', async () => {
    const buf = readFileSync(ARQ);
    const abas = await lerPlanilha(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const lista = abas.find((a) => a.nome === 'Lista de Fretes')!;
    const h = detectarCabecalho(lista);
    const mapa = mapearAutomatico(lista.linhas[h].map(textoCelula));
    const res = await analisarListaFretes(lista, h, mapa);
    const validas = res.filter((l) => l.situacao === 'valida');
    expect(validas).toHaveLength(37);
    const linhas: LinhaFrete[] = validas.map((l, i) => ({
      embarque: {
        id: `e${i}`, codigo: i, cliente_id: l.dados!.cliente, comercial_id: null, filial_id: l.dados!.filial, produto_id: null,
        origem_cidade: l.dados!.origem_cidade, origem_uf: null, local_coleta_id: null, destino_cidade: l.dados!.destino_cidade,
        destino_uf: l.dados!.destino_uf, local_entrega_id: null, status_liberacao: l.dados!.status, data_liberacao: null,
        cadencia_valor: null, cadencia_unidade: 'veiculos_dia', toneladas_por_veiculo: 40, observacao_interna: null,
        situacao: 'ativo', is_demo: false, chave_importacao: l.dados!.chave, versao: 1, atualizado_em: '', atualizado_por_nome: null,
      },
      posicao: {
        id: `p${i}`, embarque_id: `e${i}`, data_operacional: '2026-10-26', porta: l.dados!.porta, transito: l.dados!.transito,
        carregados: l.dados!.carregados, toneladas_por_veiculo: 40, meta_valor: null, meta_unidade: 'veiculos_dia',
        obs_operacional: null, obs_cliente: null, is_demo: false, origem: 'importacao', versao: 1, atualizado_em: '2026-10-26T15:00:00Z',
        atualizado_por_nome: null,
      },
      financeiro: {
        embarque_id: `e${i}`, frete_empresa: l.dados!.frete_empresa, frete_motorista: l.dados!.frete_motorista,
        unidade_frete: 'rs_tonelada', frete_empresa_original: null, frete_motorista_original: null, versao: 1, atualizado_em: '',
      },
    }));
    const r = resumir(linhas, CONFIG_PADRAO, true);
    // Valores da aba Dashboard Operacional (B4, D4, F4, H4, J4, B8, D8, F8, H8)
    expect([r.porta, r.transito, r.carregados, r.total_veiculos, r.lotes]).toEqual([57, 42, 25, 124, 37]);
    expect([r.disponibilizado_t, r.projetado_t, r.transito_t]).toEqual([2960, 3280, 1680]);
    expect(r.aderencia_pct).toBeCloseTo(110.81, 2);
    // A planilha ignora fretes em texto ("R$ 142,00") no AVERAGE; o app os converte em número.
    // Por isso os tickets do app incluem mais lotes que os da planilha (ver docs/REGRAS_DE_NEGOCIO.md).
    expect(r.financeiro!.lotes_com_frete_empresa).toBe(37);

    const clientes = analisarClientes(abas.find((a) => a.nome === 'Clientes')!);
    expect(clientes.clientes.length).toBeGreaterThan(250);
    expect(clientes.clientes.some((c) => c.restricao)).toBe(true);

    const idx = indexar({ filiais: [], comerciais: [], clientes: [], produtos: [], locais: [] });
    const ldc = linhas.filter((l) => l.embarque.cliente_id === 'LOUIS DREYFUS COMPANY BRASIL S A');
    const txt = textoWhatsApp(montarPosicaoCliente('LOUIS DREYFUS COMPANY BRASIL S A', '2026-10-26', ldc, idx), { carregados: true, volumes: false });
    expect(txt).toContain('Posição de embarque — LOUIS DREYFUS COMPANY BRASIL S A');
    expect(txt).toContain('Trânsito para coleta:');
  });
});
