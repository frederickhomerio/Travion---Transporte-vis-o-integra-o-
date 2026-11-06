import { describe, expect, it } from 'vitest';
import { alertaCanhoto, alertaCombinado, calcularMargem, pendenciasAvanco, pendenciasEncerrar } from './regras';
import { VALORES_ZERO, type ClienteInd, type OcorrenciaInd, type ViagemInd } from './tipos';

const base: ViagemInd = {
  id: 'v1', codigo: 1, cliente_id: 'c1', tipo_carga: 'paletizada', pedido: 'P1', po: null, etapa: 'lancada', frota: 'terceiro',
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
  it('alerta 1 hora antes', () => {
    expect(alertaCombinado(com('2026-11-06T13:30:00Z'), agora).nivel).toBe('neutro');
    expect(alertaCombinado(com('2026-11-06T13:00:00Z'), agora).nivel).toBe('aviso');
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
