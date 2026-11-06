import { describe, expect, it } from 'vitest';
import { alertaCanhoto, alertaCombinado, alertaDescarga, calcularMargem, faltaConferencia, marcadoSemConferencia, pendenciasAvanco, pendenciasEmissao, pendenciasEncerrar, quadrosPainel, retiradasDoDia } from './regras';
import { VALORES_ZERO, type ClienteInd, type OcorrenciaInd, type ViagemInd } from './tipos';

const base: ViagemInd = {
  id: 'v1', codigo: 1, cliente_id: 'c1', tipo_carga: 'paletizada', pedido: 'P1', coleta_prevista: null, po: null, etapa: 'lancada', frota: 'terceiro',
  tipo_veiculo: 'Carreta', placa_cavalo: null, placa_carreta: null, motorista: null, motorista_cpf: null, motorista_telefone: null,
  paradas: [], valores: { ...VALORES_ZERO }, combinado: null, emissao_assumida_por: null, emissao_assumida_em: null,
  cte: null, mdfe: null, nfs: null, entregue_em: null, canhoto_digital_em: null, canhoto_fisico_em: null, comprovante_ok_em: null,
  reversa_de: null, observacao: null, criado_em: '2026-11-01T10:00:00Z', criado_por: 'Teste', historico: [],
};
const oc = (p: Partial<OcorrenciaInd>): OcorrenciaInd => ({
  id: 'o', codigo: 'OC-0001', viagem_id: 'v1', parada_id: null, tipo: 'diaria', carga: 'carregado', avaria: false, descricao: '',
  valor_motorista: 0, valor_cliente: 0, situacao: 'aprovada', aberta_em: '', aberta_por: '', aprovada_por: null, aprovada_em: null,
  paga_em: null, paga_por: null, ...p,
});

describe('margem final', () => {
  it('receita e despesa com as linhas definidas', () => {
    const v = { ...base, valores: { frete_empresa: 10000, custo_extra: 300, pedagio: 450, cte_complementar: 250, frete_motorista: 8000, descarga: 400, diaria: 200 } };
    const m = calcularMargem(v);
    expect(m.receita).toBe(11000);
    expect(m.despesa).toBe(8600);
    expect(m.margem).toBe(2400);
    expect(m.pct).toBeCloseTo(21.82, 2);
    expect(m.abaixoMeta).toBe(false);
  });
  it('ocorrências aprovadas entram; abertas não', () => {
    const v = { ...base, valores: { ...VALORES_ZERO, frete_empresa: 10000, frete_motorista: 8500 } };
    const m = calcularMargem(v, [
      oc({ tipo: 'diaria', valor_motorista: 300, valor_cliente: 500 }),
      oc({ tipo: 'reentrega', valor_motorista: 700, valor_cliente: 900, situacao: 'paga' }),
      oc({ tipo: 'diaria', valor_motorista: 999, situacao: 'aberta' }),
    ]);
    expect(m.linhas.diaria).toBe(300);
    expect(m.linhas.frete_motorista).toBe(9200);
    expect(m.linhas.cte_complementar).toBe(1400);
    expect(m.receita).toBe(11400);
    expect(m.despesa).toBe(9500);
    expect(m.abaixoMeta).toBe(false);
  });
  it('abaixo de 12% acende o alerta', () => {
    const m = calcularMargem({ ...base, valores: { ...VALORES_ZERO, frete_empresa: 10000, frete_motorista: 9000 } });
    expect(m.pct).toBe(10);
    expect(m.abaixoMeta).toBe(true);
  });
});

describe('combinado com o motorista', () => {
  const agora = new Date('2026-11-06T12:00:00Z');
  const com = (para: string, marcou: string | null = null) => ({ combinado: { o_que: 'Chegada na coleta', para, marcou_em: marcou, registrado_por: 'x' } });
  it('vermelho, laranja (até 2 h), amarelo (mais de 2 h) e verde', () => {
    expect(alertaCombinado(com('2026-11-06T14:30:00Z'), agora).nivel).toBe('aviso');
    expect(alertaCombinado(com('2026-11-06T13:59:00Z'), agora).nivel).toBe('laranja');
    expect(alertaCombinado({ combinado: null }, agora).nivel).toBe('neutro');
    expect(alertaCombinado(com('2026-11-06T11:50:00Z'), agora).nivel).toBe('atraso');
    expect(alertaCombinado(com('2026-11-06T11:50:00Z', '2026-11-06T11:45:00Z'), agora).nivel).toBe('ok');
  });
});

describe('canhoto', () => {
  const agora = new Date('2026-11-06T12:00:00Z');
  it('vermelho depois de 30 dias sem canhoto físico', () => {
    expect(alertaCanhoto({ entregue_em: '2026-10-01T12:00:00Z', canhoto_fisico_em: null }, agora).nivel).toBe('atraso');
    expect(alertaCanhoto({ entregue_em: '2026-10-10T12:00:00Z', canhoto_fisico_em: null }, agora).nivel).toBe('aviso');
    expect(alertaCanhoto({ entregue_em: '2026-11-01T12:00:00Z', canhoto_fisico_em: null }, agora).nivel).toBe('neutro');
    expect(alertaCanhoto({ entregue_em: '2026-10-01T12:00:00Z', canhoto_fisico_em: '2026-10-20T12:00:00Z' }, agora).nivel).toBe('ok');
  });
});

describe('avanço', () => {
  const cargill: ClienteInd = { id: 'c1', nome: 'Cargill', cnpj: null, contato: null, telefone: null, exige_agendamento: true, exige_po: true, ativo: true };
  it('lançada precisa de motorista e placa', () => {
    expect(pendenciasAvanco(base, cargill)).toHaveLength(2);
    expect(pendenciasAvanco({ ...base, motorista: 'João', placa_cavalo: 'ABC1D23' }, cargill)).toHaveLength(0);
  });
  it('coleta que exige agendamento precisa do horário; protocolo é opcional', () => {
    const p = { id: 'p', ordem: 1, tipo: 'coleta' as const, local: 'Fábrica', cidade: 'Goiânia', uf: 'GO', exige_agendamento: true, agendado_para: null, protocolo: null, situacao: 'pendente' as const, chegada_em: null, inicio_em: null, fim_em: null, nfs: null };
    expect(pendenciasAvanco({ ...base, etapa: 'contratado', paradas: [p] }, cargill)).toHaveLength(1);
    expect(pendenciasAvanco({ ...base, etapa: 'contratado', paradas: [{ ...p, agendado_para: '2026-11-07T08:00:00Z' }] }, cargill)).toHaveLength(0);
    expect(pendenciasAvanco({ ...base, etapa: 'contratado', paradas: [{ ...p, exige_agendamento: false }] }, cargill)).toHaveLength(0);
  });
  it('Cargill exige PO depois de carregado', () => {
    expect(pendenciasAvanco({ ...base, etapa: 'carregada' }, cargill).some((x) => x.includes('PO'))).toBe(true);
    expect(pendenciasAvanco({ ...base, etapa: 'carregada', po: '4500123' }, cargill).some((x) => x.includes('PO'))).toBe(false);
  });
  it('encerrar exige canhoto, comprovante e nenhuma ocorrência aberta', () => {
    const v = { ...base, etapa: 'entregue' as const, entregue_em: '2026-11-01T00:00:00Z' };
    expect(pendenciasEncerrar(v, [oc({ situacao: 'aberta' })])).toHaveLength(3);
    expect(pendenciasEncerrar({ ...v, canhoto_fisico_em: 'x', comprovante_ok_em: 'x' }, [oc({ situacao: 'paga' })])).toHaveLength(0);
  });
});

describe('painel', () => {
  const ent = (ag: string | null, situacao: 'pendente' | 'chegou' = 'pendente') => ({ id: 'e', ordem: 2, tipo: 'entrega' as const, local: 'L', cidade: 'C', uf: 'GO', exige_agendamento: !!ag, agendado_para: ag, protocolo: null, situacao, chegada_em: null, inicio_em: null, fim_em: null, nfs: null });
  it('descarga: vermelho hoje, amarelo amanhã, verde D+2', () => {
    const agora = new Date(2026, 10, 6, 10, 0);
    expect(alertaDescarga({ paradas: [ent(new Date(2026, 10, 6, 18).toISOString())] }, agora).nivel).toBe('atraso');
    expect(alertaDescarga({ paradas: [ent(new Date(2026, 10, 7, 8).toISOString())] }, agora).nivel).toBe('aviso');
    expect(alertaDescarga({ paradas: [ent(new Date(2026, 10, 9, 8).toISOString())] }, agora).nivel).toBe('ok');
    expect(alertaDescarga({ paradas: [ent(null)] }, agora).nivel).toBe('neutro');
  });
  it('cada viagem em um quadro; finalizada sem ocorrência sai', () => {
    const vs: ViagemInd[] = [
      { ...base, id: 'a' }, { ...base, id: 'b', placa_cavalo: 'X' }, { ...base, id: 'c', etapa: 'carregada' },
      { ...base, id: 'd', etapa: 'transito', paradas: [ent(null)] }, { ...base, id: 'e', etapa: 'entregas', paradas: [ent(null, 'chegou')] },
      { ...base, id: 'f', etapa: 'entregue' }, { ...base, id: 'g', etapa: 'encerrada' },
    ];
    const q = quadrosPainel(vs, [oc({ viagem_id: 'f', situacao: 'aberta' }), oc({ viagem_id: 'g', situacao: 'paga' })]);
    expect(q.disponiveis.map((v) => v.id)).toEqual(['a']);
    expect(q.contratados.map((v) => v.id)).toEqual(['b']);
    expect(q.emissao.map((v) => v.id)).toEqual(['c']);
    expect(q.transito.map((v) => v.id)).toEqual(['d']);
    expect(q.marcados.map((v) => v.id)).toEqual(['e']);
    expect(q.comOcorrencia.map((v) => v.id)).toEqual(['f']);
  });
  it('retiradas do dia contam quem passou de Carregando', () => {
    const vs: ViagemInd[] = [{ ...base, coleta_prevista: '2026-11-06' }, { ...base, coleta_prevista: '2026-11-06', etapa: 'documentada' }, { ...base, coleta_prevista: '2026-11-07' }];
    expect(retiradasDoDia(vs, '2026-11-06')).toEqual({ previstas: 2, retiradas: 1 });
  });
});

describe('conferências', () => {
  const ok = { em: 'x', por: 'y' };
  const marcado = { ...base, etapa: 'contratado' as const, combinado: { o_que: 'Chegada', para: '2026-11-06T12:00:00Z', marcou_em: '2026-11-06T11:50:00Z', registrado_por: 'x' } };
  it('marcado sem as 3 conferências gera alerta; com as 3, não', () => {
    expect(faltaConferencia(base)).toEqual(['cadastro', 'monitoramento', 'oc_vinculo']);
    expect(marcadoSemConferencia(marcado)).toBe(true);
    expect(marcadoSemConferencia({ ...marcado, checagens: { cadastro: ok, monitoramento: ok } })).toBe(true);
    expect(marcadoSemConferencia({ ...marcado, checagens: { cadastro: ok, monitoramento: ok, oc_vinculo: ok } })).toBe(false);
  });
  it('sem marcar o combinado ou já em trânsito, não alerta', () => {
    expect(marcadoSemConferencia({ ...marcado, combinado: { ...marcado.combinado, marcou_em: null } })).toBe(false);
    expect(marcadoSemConferencia({ ...marcado, etapa: 'transito' })).toBe(false);
  });
});

describe('conferências travam emissão e trânsito', () => {
  const ok = { em: 'x', por: 'y' };
  const tudo = { cadastro: ok, monitoramento: ok, oc_vinculo: ok };
  it('documentada sem as 3 não segue para trânsito', () => {
    expect(pendenciasAvanco({ ...base, etapa: 'documentada' }, undefined)).toHaveLength(1);
    expect(pendenciasAvanco({ ...base, etapa: 'documentada', checagens: tudo }, undefined)).toHaveLength(0);
  });
  it('emissão exige as 3', () => {
    const d = { cte: '1', nfs: '2', po: '' };
    expect(pendenciasEmissao({ ...base, etapa: 'carregada', checagens: { cadastro: ok } }, undefined, d)).toHaveLength(1);
    expect(pendenciasEmissao({ ...base, etapa: 'carregada', checagens: tudo }, undefined, d)).toHaveLength(0);
  });
});
