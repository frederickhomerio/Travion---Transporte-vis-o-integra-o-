// Dados do módulo Industrializado.
// Prévia: guardados só neste navegador, com dados fictícios. Produção: no banco (tabelas ind_*), gravados pelas
// funções ind_salvar_*, que conferem de novo a permissão de cada mudança e não deixam apagar o histórico.

import { useMemo, useSyncExternalStore } from 'react';
import type { Api, ApiInd } from '../data/api';
import { useApp } from '../data/store';
import { hojeSP, somarDias } from '../lib/formato';
import type { Permissao } from '../types';
import { avisoConferencia, codigoOcorrencia, ETAPAS_TRANSITO, valoresConfirmados, type ValoresEmissao, etapaAnterior, pendenciasAvanco, pendenciasEmissao, pendenciasEncerrar, proximaEtapa } from './regras';
import {
  ROTULO_CHECAGEM, ROTULO_ETAPA, ROTULO_OCORRENCIA, ROTULO_SIT_PARADA, VALORES_ZERO, separarOcVinculo,
  type CargaOcorrencia, type ChecagemInd, type ClienteInd, type OcorrenciaInd, type ParadaInd, type SituacaoParada, type Carroceria, type TipoCarga, type TipoOcorrencia, type ValoresInd, type ViagemInd,
} from './tipos';

export interface EstadoInd {
  versao: 1; seq: number; seqOc: number; clientes: ClienteInd[]; viagens: ViagemInd[]; ocorrencias: OcorrenciaInd[];
  /** Produção: false até a primeira leitura do servidor terminar. */
  carregado?: boolean;
  /** Meta diária de cargas a retirar, por data (AAAA-MM-DD). */
  metas: Record<string, number>;
}

const CHAVE = 'travion-industrializado-previa-v2';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const iso = (d: Date) => d.toISOString();
const emMin = (m: number) => iso(new Date(Date.now() + m * 60e3));
const emDias = (d: number, h = 0) => iso(new Date(Date.now() + d * 86400e3 + h * 3600e3));

function semear(): EstadoInd {
  const hoje = hojeSP();
  const cli = (nome: string, cnpj: string, exige_agendamento: boolean, exige_po: boolean): ClienteInd =>
    ({ id: uid(), nome, cnpj, contato: null, telefone: null, exige_agendamento, exige_po, ativo: true });
  const clientes = [
    cli('[DEMO] Cargill', '60.498.706/0001-57', true, true),
    cli('[DEMO] Alimentos Aurora', '11.222.333/0001-81', true, false),
    cli('[DEMO] Bebidas Serra Azul', '22.333.444/0001-05', false, false),
    cli('[DEMO] Atacadista Planalto', '33.444.555/0001-20', true, false),
    cli('[DEMO] Embalagens Cerrado', '44.555.666/0001-34', false, false),
  ];
  const par = (ordem: number, tipo: ParadaInd['tipo'], local: string, cidade: string, uf: string, ag: string | null, sit: SituacaoParada = 'pendente', protocolo: string | null = null): ParadaInd => ({
    id: uid(), ordem, tipo, local, cidade, uf, exige_agendamento: !!ag, agendado_para: ag, protocolo, situacao: sit,
    chegada_em: sit !== 'pendente' ? emMin(-180) : null, inicio_em: sit === 'em_operacao' || sit === 'concluida' ? emMin(-150) : null,
    fim_em: sit === 'concluida' ? emMin(-90) : null, nfs: null,
  });
  const val = (fe: number, fm: number, extra: Partial<ValoresInd> = {}): ValoresInd => ({ ...VALORES_ZERO, frete_empresa: fe, frete_motorista: fm, pedagio_motorista: extra.pedagio ?? 0, descarga: fm > 5000 ? 250 : 0, ...extra });
  let n = 0;
  const v = (cliente: number, etapa: ViagemInd['etapa'], p: Partial<ViagemInd>): ViagemInd => ({
    id: uid(), codigo: ++n, cliente_id: clientes[cliente].id, tipo_carga: 'paletizada', pedido: `PED-${5100 + n}`, po: null, etapa,
    coleta_prevista: ['entregue', 'encerrada', 'transito', 'entregas'].includes(etapa) ? somarDias(hoje, -2) : hoje,
    frota: 'terceiro', tipo_veiculo: 'Carreta', carroceria: (['sider', 'bau', 'graneleiro'] as const)[n % 3], peso_t: [28, 32, 14, 24.5, 30][n % 5], placa_cavalo: null, placa_carreta: null, motorista: null, motorista_cpf: null, motorista_telefone: null,
    paradas: [], valores: val(0, 0), combinado: null, emissao_assumida_por: null, emissao_assumida_em: null, cte: null, mdfe: null, nfs: null,
    entregue_em: null, canhoto_digital_em: null, canhoto_fisico_em: null, comprovante_ok_em: null, reversa_de: null, observacao: null,
    criado_em: emDias(-3), criado_por: '[DEMO] Equipe de embarque',
    historico: [{ em: emDias(-3), usuario: '[DEMO] Equipe de embarque', acao: 'Viagem lançada', detalhe: null, motivo: null }],
    ...p,
  });
  /** Cargill: a PO vai em cada entrega. */
  const comPo = (x: ViagemInd, ...pos: string[]): ViagemInd => { let i = 0; return { ...x, po: null, paradas: x.paradas.map((p) => (p.tipo === 'entrega' && pos[i] ? { ...p, po: pos[i++] } : p)) }; };
  const mot = (i: number) => ({
    motorista: ['João Batista Lima', 'Carlos Henrique Souza', 'Marcos Vinícius Rocha', 'Edson Pereira', 'Rogério Alves', 'Antônio Carlos Dias', 'Wellington Santos', 'Luiz Fernando Melo'][i],
    motorista_cpf: `${100 + i}.${200 + i}.${300 + i}-${10 + i}`, motorista_telefone: `(62) 9 9${100 + i}-${4000 + i}`,
    contratado_por: ['Vanessa Duarte', 'Paulo Henrique Reis'][i % 2],
    placa_cavalo: `RTA${i}B${10 + i}`, placa_carreta: `QWE${i}C${20 + i}`,
  });
  const viagens: ViagemInd[] = [
    v(1, 'lancada', { tipo_carga: 'batida', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null), par(2, 'entrega', 'Loja Centro', 'Anápolis', 'GO', emDias(1, 2)), par(3, 'entrega', 'Loja Norte', 'Brasília', 'DF', emDias(1, 6))], valores: val(6800, 5600, { pedagio: 180 }) }),
    v(0, 'contratado', { ...mot(0), paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', null), par(2, 'entrega', 'CD Uberlândia', 'Uberlândia', 'MG', emDias(2))], valores: val(9200, 7900, { pedagio: 320 }),
      checagens: { cadastro: { em: emMin(-90), por: '[DEMO] Equipe de embarque' } },
      combinado: { o_que: 'Chegada na fábrica para agendar', para: emMin(45), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(3, 'coleta_agendada', { ...mot(1), tipo_carga: 'granel', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', emMin(30), 'pendente', 'AG-88123'), par(2, 'entrega', 'Atacado Sul', 'Goiânia', 'GO', emDias(1))], valores: val(4200, 3900),
      combinado: { o_que: 'Chegada na coleta', para: emMin(-20), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(2, 'carregando', { ...mot(2), paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null, 'em_operacao'), par(2, 'entrega', 'Distribuidora Leste', 'Goiânia', 'GO', null), par(3, 'entrega', 'Mercado Bom Preço', 'Trindade', 'GO', null)], valores: val(5100, 4300),
      checagens: { cadastro: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, monitoramento: { em: emMin(-90), por: '[DEMO] Equipe de embarque' } },
      combinado: { o_que: 'Fim do carregamento', para: emMin(80), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(0, 'carregada', { ...mot(3), historico: [{ em: emDias(-1), usuario: '[DEMO] Equipe de embarque', acao: 'Viagem lançada', detalhe: null, motivo: null }, { em: emMin(-25), usuario: '[DEMO] Equipe de embarque', acao: 'Etapa: Carregando → Carregada', detalhe: null, motivo: null }], paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', emMin(-240), 'concluida', 'CG-5521'), par(2, 'entrega', 'Porto Seco', 'Anápolis', 'GO', emDias(1, 3))], valores: val(7400, 6300, { pedagio: 140 }) }),
    v(4, 'documentada', { ...mot(4), cte: '35201', mdfe: '9921', nfs: '118220, 118221', paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Rio Verde', 'GO', null)], valores: val(3900, 3500),
      checagens: { cadastro: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, monitoramento: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, oc: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, vinculo: { em: emMin(-90), por: '[DEMO] Equipe de embarque' } },
      combinado: { o_que: 'Saída para viagem', para: emMin(-40), marcou_em: emMin(-55), registrado_por: '[DEMO] Equipe de embarque' } }),
    v(1, 'transito', { ...mot(5), cte: '35188', nfs: '77410', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Cuiabá', 'Cuiabá', 'MT', emMin(300), 'pendente', 'AUR-2231')], valores: val(12800, 10900, { pedagio: 610 }),
      combinado: { o_que: 'Chegada no cliente', para: emMin(240), marcou_em: null, registrado_por: '[DEMO] Equipe de pós-embarque', fase: 'transito' } }),
    v(3, 'entregas', { ...mot(6), tipo_carga: 'batida', cte: '35170', nfs: '55120, 55121, 55122', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Loja 1', 'Itumbiara', 'GO', emMin(-300), 'concluida'), par(3, 'entrega', 'Loja 2', 'Uberlândia', 'MG', emMin(-30), 'em_operacao', 'PL-7781'), par(4, 'entrega', 'Loja 3', 'Uberaba', 'MG', emDias(1))], valores: val(8600, 7200, { descarga: 250 }) }),
    comPo(v(0, 'entregue', { ...mot(7), cte: '35102', nfs: '99001', entregue_em: emDias(-33), canhoto_digital_em: emDias(-32), paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Sorriso', 'Sorriso', 'MT', emDias(-33), 'concluida', 'CG-4410')], valores: val(15200, 13300, { pedagio: 720, descarga: 400 }) }), '4500231987'),
    v(2, 'entregue', { ...mot(1), cte: '35140', nfs: '30221', entregue_em: emDias(-6), canhoto_digital_em: emDias(-6), canhoto_fisico_em: emDias(-1), paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null, 'concluida'), par(2, 'entrega', 'Distribuidora Oeste', 'Jataí', 'GO', null, 'concluida')], valores: val(4800, 4400) }),
    v(4, 'encerrada', { ...mot(2), cte: '35090', nfs: '20110', entregue_em: emDias(-20), canhoto_digital_em: emDias(-20), canhoto_fisico_em: emDias(-12), comprovante_ok_em: emDias(-12), paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Catalão', 'GO', null, 'concluida')], valores: val(3600, 3050, { pedagio: 90 }) }),
  ];
  // Mais cargas para os quadros do Painel (disponíveis, contratados em cada cor, trânsito e marcados).
  viagens.push(
    v(3, 'lancada', { tipo_carga: 'batida', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', null), par(2, 'entrega', 'Atacado Norte', 'Palmas', 'TO', emDias(2))], valores: val(9800, 8300) }),
    v(4, 'lancada', { paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null), par(2, 'entrega', 'Cliente final', 'Goianésia', 'GO', null)], valores: val(2900, 2450) }),
    v(1, 'contratado', { ...mot(3), placa_cavalo: 'SDF4G55', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null), par(2, 'entrega', 'Loja Sul', 'Caldas Novas', 'GO', emDias(1))], valores: val(3800, 3200),
      combinado: { o_que: 'Chegada no CD para carregar', para: emMin(200), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(2, 'coleta_agendada', { ...mot(6), placa_cavalo: 'HJK7L88', paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', emMin(30), 'chegou'), par(2, 'entrega', 'Distribuidora Sul', 'Itumbiara', 'GO', null)], valores: val(4100, 3600),
      checagens: { cadastro: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, monitoramento: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, oc: { em: emMin(-90), por: '[DEMO] Equipe de embarque' }, vinculo: { em: emMin(-90), por: '[DEMO] Equipe de embarque' } },
      combinado: { o_que: 'Chegada na fábrica', para: emMin(-10), marcou_em: emMin(-15), registrado_por: '[DEMO] Equipe de embarque' } }),
    comPo(v(0, 'transito', { ...mot(4), placa_cavalo: 'PLM2N44', cte: '35210', nfs: '99102', paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Terminal Rondonópolis', 'Rondonópolis', 'MT', emDias(1, 1), 'pendente', 'CG-5600')], valores: val(11200, 9600, { pedagio: 480 }) }), '4500233001'),
    v(1, 'transito', { ...mot(0), placa_cavalo: 'QAZ5W66', cte: '35211', nfs: '77455', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Belém', 'Belém', 'PA', emDias(3), 'pendente', 'AUR-2290')], valores: val(18900, 16100, { pedagio: 900 }) }),
    v(4, 'entregas', { ...mot(5), placa_cavalo: 'WSX8E99', cte: '35199', nfs: '20155', paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Anápolis', 'GO', emMin(-60), 'chegou')], valores: val(2600, 2200) }),
  );
  // Demonstração: um exemplo de cada situação que o supervisor precisa conferir.
  const ok3 = { cadastro: { em: emMin(-120), por: 'Vanessa Duarte' }, monitoramento: { em: emMin(-110), por: 'Vanessa Duarte' }, oc: { em: emMin(-100), por: 'Vanessa Duarte' }, vinculo: { em: emMin(-100), por: 'Vanessa Duarte' } };
  const reg = (acao: string, em: string, detalhe: string | null = null) => ({ em, usuario: '[DEMO] Equipe de embarque', acao, detalhe, motivo: null });
  viagens.push(
    // 18 Disponível: Cargill exige PO e agendamento, sem veículo ainda.
    v(0, 'lancada', { tipo_carga: 'granel', tipo_veiculo: 'Bitrem', paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', emDias(1, 1)), par(2, 'entrega', 'Terminal Itaqui', 'São Luís', 'MA', emDias(4))], valores: val(21500, 18200, { pedagio: 1150 }), observacao: 'Exemplo: cliente exige PO (Cargill)' }),
    // 19 Contratado SEM combinado e sem conferências (tudo vermelho).
    v(2, 'contratado', { ...mot(7), placa_cavalo: 'OPA1Z23', tipo_veiculo: 'Truck', paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null), par(2, 'entrega', 'Mercado Bom Preço', 'Trindade', 'GO', null)], valores: val(1900, 1550) }),
    // 20 Marcou o combinado SEM as 3 conferências: gera alerta no sino e faixa no Painel.
    v(0, 'coleta_agendada', { ...mot(2), placa_cavalo: 'BRA2E19', po: null, checagens: { cadastro: { em: emMin(-70), por: '[DEMO] Equipe de embarque' } }, paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', emMin(-30), 'chegou', 'CG-5650'), { ...par(2, 'entrega', 'CD Uberlândia', 'Uberlândia', 'MG', emDias(1, 4)), po: '4500240011' }, { ...par(3, 'entrega', 'CD Uberaba', 'Uberaba', 'MG', emDias(1, 9)), po: '4500240012' }], valores: val(8900, 7700, { pedagio: 310 }),
      combinado: { o_que: 'Chegada na fábrica', para: emMin(-40), marcou_em: emMin(-35), registrado_por: '[DEMO] Equipe de embarque', fase: 'coleta' } }),
    // 21 Carregando com combinado atrasado (vermelho).
    v(3, 'carregando', { ...mot(4), placa_cavalo: 'GYN3K45', checagens: ok3, paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', emMin(-180), 'em_operacao', 'AG-88190'), par(2, 'entrega', 'Atacado Norte', 'Araguaína', 'TO', emDias(2))], valores: val(9700, 8150, { pedagio: 260 }),
      combinado: { o_que: 'Fim do carregamento', para: emMin(-25), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque', fase: 'coleta' } }),
    // 22 Carregada pronta para emitir (3 conferências ok).
    v(1, 'carregada', { ...mot(6), placa_cavalo: 'ANP4D67', checagens: ok3, paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', emMin(-200), 'concluida', 'AUR-2301'), par(2, 'entrega', 'Loja Centro', 'Anápolis', 'GO', emDias(1, 2), 'pendente', 'AUR-2302')], valores: val(2400, 1990, { pedagio: 60 }),
      historico: [reg('Viagem lançada', emDias(-1)), reg('Etapa: Carregando → Carregada', emMin(-15))] }),
    // 23 Cargill carregada SEM PO: a emissão fica travada até informar o PO.
    v(0, 'carregada', { ...mot(1), placa_cavalo: 'CGL5P89', checagens: ok3, po: null, paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', emMin(-260), 'concluida', 'CG-5661'), par(2, 'entrega', 'Porto Seco', 'Anápolis', 'GO', emDias(1))], valores: val(3100, 2600, { pedagio: 80 }),
      historico: [reg('Viagem lançada', emDias(-1)), reg('Etapa: Carregando → Carregada', emMin(-40))] }),
    // 24 Em trânsito com chegada no cliente amanhã.
    v(2, 'transito', { ...mot(3), placa_cavalo: 'TRS6H01', checagens: ok3, cte: '35230', mdfe: '9950', nfs: '30290', paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null, 'concluida'), par(2, 'entrega', 'Distribuidora Norte', 'Gurupi', 'TO', emDias(1, 5))], valores: val(6900, 5800, { pedagio: 210 }),
      combinado: { o_que: 'Chegada no cliente', para: emDias(1, 4), marcou_em: null, registrado_por: '[DEMO] Equipe de pós-embarque', fase: 'transito' } }),
    // 25 Em trânsito SEM combinado de chegada (falta combinar com o motorista).
    v(4, 'transito', { ...mot(7), placa_cavalo: 'SEM7C02', checagens: ok3, cte: '35231', nfs: '20190', paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Mineiros', 'GO', null)], valores: val(4300, 3700, { pedagio: 120 }) }),
    // 26 Em trânsito com chegada atrasada e ocorrência de deslocamento aberta.
    v(3, 'transito', { ...mot(0), placa_cavalo: 'ATR8S03', checagens: ok3, cte: '35232', nfs: '55190', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Atacado Leste', 'Barreiras', 'BA', emMin(-90), 'pendente', 'PL-7799')], valores: val(10400, 8900, { pedagio: 380 }),
      combinado: { o_que: 'Chegada no cliente', para: emMin(-60), marcou_em: null, registrado_por: '[DEMO] Equipe de pós-embarque', fase: 'transito' } }),
    // 27 Marcado na descarga, com mais uma entrega depois (fracionada).
    v(1, 'entregas', { ...mot(5), placa_cavalo: 'MLT9R04', tipo_carga: 'batida', checagens: ok3, cte: '35233', nfs: '77501, 77502', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Loja Norte', 'Brasília', 'DF', emMin(-50), 'em_operacao', 'AUR-2310'), par(3, 'entrega', 'Loja Sul', 'Taguatinga', 'DF', emMin(240), 'pendente', 'AUR-2311')], valores: val(5200, 4300, { pedagio: 150, descarga: 180 }) }),
    // 28 Entregue ontem, sem canhoto ainda.
    v(2, 'entregue', { ...mot(6), placa_cavalo: 'ENT1A05', cte: '35180', nfs: '30250', entregue_em: emDias(-1), paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null, 'concluida'), par(2, 'entrega', 'Distribuidora Oeste', 'Jataí', 'GO', null, 'concluida')], valores: val(4700, 4050) }),
    // 29 Entregue com canhoto digital, aguardando o físico (dia 25 de 30: amarelo).
    v(1, 'entregue', { ...mot(4), placa_cavalo: 'CNH2B06', cte: '35150', nfs: '77300', entregue_em: emDias(-25), canhoto_digital_em: emDias(-25), paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Palmas', 'Palmas', 'TO', null, 'concluida')], valores: val(9100, 7800, { pedagio: 330 }) }),
    // 30 Entregue com reentrega aberta: aparece em Finalizados com ocorrência.
    v(3, 'entregue', { ...mot(2), placa_cavalo: 'REE3C07', cte: '35160', nfs: '55160', entregue_em: emDias(-2), canhoto_digital_em: emDias(-2), paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Atacado Sul', 'Goiânia', 'GO', null, 'concluida')], valores: val(2300, 1900) }),
    // 31 Cancelada (cliente desistiu).
    v(4, 'cancelada', { paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null), par(2, 'entrega', 'Cliente final', 'Itaberaí', 'GO', null)], valores: val(1800, 1500),
      historico: [reg('Viagem lançada', emDias(-2)), { em: emDias(-1), usuario: '[DEMO] Gestor', acao: 'Viagem cancelada', detalhe: null, motivo: 'Cliente cancelou o pedido' }] }),
  );
  // 32 Entrega reversa da devolução da carga 8 (volta para o cliente de origem).
  viagens.push(v(0, 'lancada', { tipo_carga: 'paletizada', reversa_de: viagens[8].id, tipo_veiculo: 'Truck', paradas: [par(1, 'coleta', 'CD Sorriso', 'Sorriso', 'MT', null), par(2, 'entrega', 'Fábrica Cargill', 'Goiânia', 'GO', null)], valores: val(4200, 3500), observacao: 'Entrega reversa: retorno de 4 paletes devolvidos' }));
  const o = (k: number, vi: number, tipo: TipoOcorrencia, carga: CargaOcorrencia, desc: string, vm: number, vc: number, situacao: OcorrenciaInd['situacao'], avaria = false): OcorrenciaInd => ({
    id: uid(), codigo: codigoOcorrencia(k), viagem_id: viagens[vi].id, parada_id: (viagens[vi].paradas.find((x) => x.tipo === 'entrega' && x.situacao === 'em_operacao') ?? viagens[vi].paradas.find((x) => x.tipo === 'entrega'))?.id ?? null,
    tipo, carga, avaria, descricao: desc, valor_motorista: vm, valor_cliente: vc, situacao, aberta_em: emMin(-60 * k), aberta_por: '[DEMO] Equipe de pós-embarque',
    aprovada_por: situacao !== 'aberta' ? '[DEMO] Gestor' : null, aprovada_em: situacao !== 'aberta' ? emMin(-30 * k) : null,
    paga_em: situacao === 'paga' ? emMin(-10 * k) : null, paga_por: situacao === 'paga' ? '[DEMO] Gestor' : null,
  });
  const ocorrencias = [
    o(1, 7, 'diaria', 'carregado', 'Cliente sem doca, veículo aguardando desde ontem', 350, 450, 'aberta'),
    o(2, 7, 'reagendamento', 'carregado', 'Loja 3 pediu para descarregar amanhã', 0, 0, 'aberta'),
    o(3, 8, 'devolucao', 'descarregado', 'Devolução parcial de 4 paletes, avaria na embalagem', 600, 800, 'aprovada', true),
    o(4, 9, 'retrabalho', 'descarregado', 'Repaletização exigida pelo cliente', 200, 300, 'paga'),
    o(5, 26, 'deslocamento', 'carregado', 'Desvio por interdição na BR-020, chegada atrasada', 150, 0, 'aberta'),
    o(6, 30, 'reentrega', 'descarregado', 'Cliente recusou 2 paletes por divergência de NF, reentrega amanhã', 280, 350, 'aberta'),
    o(7, 27, 'diaria', 'carregado', 'Fila na doca da Loja Norte', 0, 0, 'cancelada'),
    o(8, 15, 'reagendamento', 'carregado', 'Terminal pediu nova janela de descarga para esta PO', 0, 0, 'aberta'),
  ];
  return { versao: 1, seq: n, seqOc: ocorrencias.length, clientes, viagens, ocorrencias, metas: { [hoje]: 8 }, carregado: true };
}

// ---------------------------------------------------------------------------
// Armazenamento
// Prévia (modo local): tudo no navegador. Produção: cada carga, ocorrência, cliente e meta vai para o banco
// (funções ind_salvar_*), que confere a permissão de novo; a tela atualiza na hora e se corrige com a resposta.
// ---------------------------------------------------------------------------
const VAZIO: EstadoInd = { versao: 1, seq: 0, seqOc: 0, clientes: [], viagens: [], ocorrencias: [], metas: {}, carregado: false };
let estado: EstadoInd = VAZIO;
let modo: 'nenhum' | 'local' | 'remoto' = 'nenhum';
let dono: string | null = null;
let remoto: ApiInd | null = null;
let desassinar: (() => void) | null = null;
/** Versão de cada registro no servidor (controle de "outra pessoa mexeu antes"). */
const versoes = new Map<string, number>();
/** Código provisório de ocorrência → código dado pelo servidor (acerta o texto do histórico da carga). */
const codigosOc = new Map<string, string>();
let fila: Promise<void> = Promise.resolve();
let pendentes = 0;
let recarregarDepois = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let avisoErro: ((m: string) => void) | null = null;

const ouvintes = new Set<() => void>();
const notificar = () => { for (const o of ouvintes) o(); };
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
const ler = () => estado;

/** A tela registra aqui como mostrar erros do servidor (ex.: sem permissão, outra pessoa alterou antes). */
export function aoErroInd(f: (m: string) => void) { avisoErro = f; return () => { if (avisoErro === f) avisoErro = null; }; }
const msgErro = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Não foi possível gravar no servidor.');

function lerLocal(): EstadoInd {
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) {
      const e = JSON.parse(s) as EstadoInd;
      // Tipos de carga antigos (10/11): fracionada vira batida, carga geral vira granel.
      const novo: Record<string, TipoCarga> = { fracionada: 'batida', carga_geral: 'granel' };
      // PO única antiga (10/11): passa para a(s) entrega(s) sem PO.
      const poNasEntregas = (v: ViagemInd): ViagemInd => (v.po && v.paradas.every((p) => !p.po)
        ? { ...v, po: null, paradas: v.paradas.map((p) => (p.tipo === 'entrega' ? { ...p, po: v.po } : p)) } : v);
      return { ...e, carregado: true, viagens: e.viagens.map((v) => separarOcVinculo(poNasEntregas(novo[v.tipo_carga] ? { ...v, tipo_carga: novo[v.tipo_carga] } : v))) };
    }
  } catch { /* sem armazenamento */ }
  return semear();
}

/** Liga o módulo à fonte de dados certa (uma vez por usuário logado). */
function iniciar(api: Api, podeVer: boolean, usuarioId: string | null) {
  if (dono !== usuarioId) {
    desassinar?.(); desassinar = null; remoto = null; versoes.clear();
    estado = VAZIO; modo = 'nenhum'; dono = usuarioId;
  }
  if (modo !== 'nenhum') return;
  if (api.modo === 'local' || !api.ind) { modo = 'local'; estado = lerLocal(); return; }
  if (!podeVer || !usuarioId) return;
  modo = 'remoto'; remoto = api.ind;
  desassinar = remoto.assinar(() => agendarRecarga());
  void recarregar();
}

function agendarRecarga() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void recarregar(); }, 400);
}

const semVersao = <T,>(x: Record<string, unknown>): T => {
  const { versao, ...resto } = x;
  if (typeof versao === 'number' && typeof resto.id === 'string') versoes.set(resto.id, versao);
  return resto as T;
};

async function recarregar() {
  const r = remoto;
  if (!r) return;
  if (pendentes > 0) { recarregarDepois = true; return; }
  try {
    const e = await r.estado();
    if (remoto !== r) return;
    if (pendentes > 0) { recarregarDepois = true; return; }
    const viagens = (e.viagens as Array<Record<string, unknown>>).map((x) => separarOcVinculo(semVersao<ViagemInd>(x)));
    const ocorrencias = (e.ocorrencias as Array<Record<string, unknown>>).map((x) => semVersao<OcorrenciaInd>(x));
    estado = {
      versao: 1, carregado: true, metas: e.metas ?? {},
      seq: viagens.reduce((m, v) => Math.max(m, v.codigo), 0), seqOc: ocorrencias.length,
      clientes: (e.clientes as Array<Record<string, unknown>>).map((x) => semVersao<ClienteInd>(x)), viagens, ocorrencias,
    };
    notificar();
  } catch (err) { avisoErro?.(msgErro(err)); }
}

/** Troca o registro gravado pela resposta do servidor (código, versão, quem criou); se a tela já mudou de novo, só acerta os campos do servidor. */
function aplicar<K extends 'viagens' | 'ocorrencias' | 'clientes'>(lista: K, enviado: EstadoInd[K][number], salvo: Record<string, unknown>) {
  const s = semVersao<EstadoInd[K][number]>(salvo);
  if (lista === 'ocorrencias') {
    const a = (enviado as OcorrenciaInd).codigo, b = (s as unknown as OcorrenciaInd).codigo;
    if (a && b && a !== b) codigosOc.set(a, b);
  }
  const campos = ['codigo', 'criado_em', 'criado_por', 'aberta_em', 'aberta_por'] as const;
  estado = {
    ...estado,
    [lista]: (estado[lista] as Array<{ id: string }>).map((x) => {
      if (x.id !== s.id) return x;
      if (x === enviado) return s;
      const patch: Record<string, unknown> = {};
      for (const c of campos) if (c in (s as object)) patch[c] = (s as unknown as Record<string, unknown>)[c];
      return { ...x, ...patch };
    }),
  };
  notificar();
}

/** Troca, nas entradas novas do histórico, o código provisório da ocorrência pelo código do servidor. */
function corrigirCodigos(v: ViagemInd, desde: number): ViagemInd {
  if (!codigosOc.size) return v;
  const troca = (x: string | null) => (x == null ? x : x.replace(/OC-\d+/g, (c) => codigosOc.get(c) ?? c));
  return { ...v, historico: v.historico.map((h, i) => (i < desde ? h : { ...h, acao: troca(h.acao) ?? h.acao, detalhe: troca(h.detalhe) })) };
}

function sincronizar(antigo: EstadoInd, novo: EstadoInd) {
  const r = remoto!;
  const tarefas: Array<() => Promise<void>> = [];
  const porId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const ac = porId(antigo.clientes), av = porId(antigo.viagens), ao = porId(antigo.ocorrencias);
  for (const c of novo.clientes) if (ac.get(c.id) !== c) tarefas.push(async () => aplicar('clientes', c, await r.salvarCliente(c, versoes.get(c.id) ?? null)));
  for (const v of novo.viagens) if (av.get(v.id) !== v) {
    const ja = av.get(v.id)?.historico.length ?? 0;
    tarefas.push(async () => aplicar('viagens', v, await r.salvarViagem(corrigirCodigos(v, ja), versoes.get(v.id) ?? null)));
  }
  for (const o of novo.ocorrencias) if (ao.get(o.id) !== o) tarefas.push(async () => aplicar('ocorrencias', o, await r.salvarOcorrencia(o, versoes.get(o.id) ?? null)));
  for (const [d, n] of Object.entries(novo.metas)) if (antigo.metas[d] !== n) tarefas.push(() => r.definirMeta(d, n));
  if (!tarefas.length) return;
  pendentes++;
  // Uma gravação de cada vez, na ordem das ações (a versão de cada registro vem da resposta anterior).
  fila = fila.then(async () => {
    try { for (const t of tarefas) await t(); }
    catch (e) { avisoErro?.(`${msgErro(e)} A tela foi atualizada com o que está no servidor.`); recarregarDepois = true; }
    finally {
      pendentes--;
      if (pendentes === 0 && recarregarDepois) { recarregarDepois = false; void recarregar(); }
    }
  });
}

function gravar(novo: EstadoInd) {
  const antigo = estado;
  estado = novo;
  notificar();
  if (modo === 'remoto') sincronizar(antigo, novo);
  else if (modo === 'local') { try { localStorage.setItem(CHAVE, JSON.stringify(novo)); } catch { /* fica só em memória */ } }
}

export function restaurarPrevia() { gravar(semear()); }

// ---------------------------------------------------------------------------
// Ações (cada uma confere a permissão e grava o histórico da carga)
// ---------------------------------------------------------------------------
export interface NovaViagem {
  cliente_id: string; tipo_carga: ViagemInd['tipo_carga']; pedido: string; po: string; frota: ViagemInd['frota']; coleta_prevista: string;
  tipo_veiculo: string; carroceria: Carroceria | ''; peso_t: string; placa_cavalo: string; placa_carreta: string; motorista: string; motorista_cpf: string; motorista_telefone: string; contratado_por: string;
  paradas: Array<Omit<ParadaInd, 'id' | 'situacao' | 'chegada_em' | 'inicio_em' | 'fim_em'> & { id?: string }>;
  valores: ValoresInd; observacao: string;
}

const t = (s: string) => (s.trim() ? s.trim() : null);
/** "28,5" → 28.5; vazio → null. */
const numPeso = (s: string) => { const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return s.trim() && Number.isFinite(n) && n > 0 ? n : null; };
function falha(msg: string): never { throw new Error(msg); }

export function useInd() {
  const { estado: app, pode, api } = useApp();
  iniciar(api, pode('ind.pagina'), app.sessao?.perfil.id ?? null);
  const st = useSyncExternalStore(assinar, ler, ler);
  const usuario = app.sessao?.perfil.nome || app.sessao?.perfil.email || 'Usuário';

  const acoes = useMemo(() => {
    const exigir = (p: Permissao, msg = 'Seu perfil não tem permissão para esta ação.') => { if (!pode(p)) falha(msg); };
    const viagem = (id: string) => estado.viagens.find((x) => x.id === id) ?? falha('Viagem não encontrada.');
    const cliente = (id: string) => estado.clientes.find((x) => x.id === id);
    const agora = () => new Date().toISOString();
    /** Altera uma viagem e registra a ação no histórico dela (quem, quando, o quê). */
    const mudar = (id: string, acao: string, f: (v: ViagemInd) => Partial<ViagemInd>, detalhe: string | null = null, motivo: string | null = null) => {
      gravar({
        ...estado,
        viagens: estado.viagens.map((v) => (v.id !== id ? v : {
          ...v, ...f(v), historico: [...v.historico, { em: agora(), usuario, acao, detalhe, motivo }],
        })),
      });
    };
    const mudarOc = (id: string, f: (o: OcorrenciaInd) => Partial<OcorrenciaInd>) => {
      const o = estado.ocorrencias.find((x) => x.id === id) ?? falha('Ocorrência não encontrada.');
      gravar({ ...estado, ocorrencias: estado.ocorrencias.map((x) => (x.id === id ? { ...x, ...f(x) } : x)) });
      return o;
    };
    const paradasNovas = (ps: NovaViagem['paradas'], antigas: ParadaInd[] = []): ParadaInd[] => ps.map((p, i) => {
      const a = antigas.find((x) => x.id === p.id);
      if (p.exige_agendamento === false) p = { ...p, agendado_para: null, protocolo: null };
      return {
        id: a?.id ?? uid(), ordem: i + 1, tipo: p.tipo, local: p.local.trim(), cidade: p.cidade.trim(), uf: p.uf.trim().toUpperCase(),
        exige_agendamento: p.exige_agendamento, agendado_para: p.agendado_para || null, protocolo: p.protocolo?.trim() || null,
        nfs: p.nfs?.trim() || null, po: p.tipo === 'entrega' ? p.po?.trim() || null : null, situacao: a?.situacao ?? 'pendente', chegada_em: a?.chegada_em ?? null, inicio_em: a?.inicio_em ?? null, fim_em: a?.fim_em ?? null,
      };
    });
    const validarNova = (d: NovaViagem) => {
      if (!d.cliente_id) falha('Escolha o cliente.');
      if (!d.paradas.some((p) => p.tipo === 'coleta')) falha('Inclua ao menos uma coleta.');
      if (!d.paradas.some((p) => p.tipo === 'entrega')) falha('Inclua ao menos uma entrega.');
      for (const p of d.paradas) {
        if (!p.local.trim() || !p.cidade.trim() || !p.uf.trim()) falha('Preencha local, cidade e UF de todas as paradas.');
        if (p.exige_agendamento && !p.agendado_para) falha(`A parada "${p.local}" exige agendamento: informe o horário (o protocolo é opcional).`);
      }
      if (d.placa_cavalo.trim() && !d.contratado_por.trim()) falha('Informe quem contratou o veículo.');
      if (d.peso_t.trim() && numPeso(d.peso_t) === null) falha('Peso inválido: informe em toneladas (ex.: 28 ou 28,5).');
    };

    return {
      definirMeta(data: string, n: number) {
        exigir('ind.meta');
        if (!Number.isInteger(n) || n < 0 || n > 999) falha('Informe a meta em número de cargas (0 a 999).');
        gravar({ ...estado, metas: { ...estado.metas, [data]: n } });
      },

      salvarCliente(c: Omit<ClienteInd, 'id'> & { id?: string }) {
        exigir('ind.clientes');
        if (!c.nome.trim()) falha('Informe o nome do cliente.');
        const novo: ClienteInd = { ...c, id: c.id ?? uid(), nome: c.nome.trim() };
        gravar({ ...estado, clientes: c.id ? estado.clientes.map((x) => (x.id === c.id ? novo : x)) : [...estado.clientes, novo] });
      },

      criarViagem(d: NovaViagem): ViagemInd {
        exigir('ind.lancar');
        validarNova(d);
        const v: ViagemInd = {
          id: uid(), codigo: estado.seq + 1, cliente_id: d.cliente_id, tipo_carga: d.tipo_carga, pedido: t(d.pedido), po: t(d.po), etapa: 'lancada', coleta_prevista: d.coleta_prevista || null,
          frota: d.frota, tipo_veiculo: d.tipo_veiculo, placa_cavalo: t(d.placa_cavalo)?.toUpperCase() ?? null, placa_carreta: t(d.placa_carreta)?.toUpperCase() ?? null,
          motorista: t(d.motorista), motorista_cpf: t(d.motorista_cpf), motorista_telefone: t(d.motorista_telefone), contratado_por: t(d.contratado_por), carroceria: d.carroceria || null, peso_t: numPeso(d.peso_t),
          paradas: paradasNovas(d.paradas), valores: pode('ind.financeiro') ? d.valores : { ...VALORES_ZERO }, combinado: null,
          emissao_assumida_por: null, emissao_assumida_em: null, cte: null, mdfe: null, nfs: null, entregue_em: null,
          canhoto_digital_em: null, canhoto_fisico_em: null, comprovante_ok_em: null, reversa_de: null, observacao: t(d.observacao),
          criado_em: agora(), criado_por: usuario, historico: [{ em: agora(), usuario, acao: 'Viagem lançada', detalhe: null, motivo: null }],
        };
        gravar({ ...estado, seq: v.codigo, viagens: [...estado.viagens, v] });
        return v;
      },

      editarViagem(id: string, d: NovaViagem, motivo: string) {
        exigir('ind.lancar');
        validarNova(d);
        const v = viagem(id);
        if (v.etapa === 'encerrada' || v.etapa === 'cancelada') falha('Viagem encerrada ou cancelada não pode ser editada.');
        const valores = pode('ind.financeiro') ? d.valores : v.valores;
        const mudouValor = (Object.keys(valores) as Array<keyof ValoresInd>).filter((k) => valores[k] !== v.valores[k]);
        if (mudouValor.length && v.etapa !== 'lancada' && !motivo.trim()) falha('Informe o motivo: valores alterados depois do lançamento ficam na auditoria.');
        mudar(id, 'Viagem editada', () => ({
          cliente_id: d.cliente_id, tipo_carga: d.tipo_carga, pedido: t(d.pedido), po: t(d.po), coleta_prevista: d.coleta_prevista || null, frota: d.frota, tipo_veiculo: d.tipo_veiculo,
          placa_cavalo: t(d.placa_cavalo)?.toUpperCase() ?? null, placa_carreta: t(d.placa_carreta)?.toUpperCase() ?? null,
          motorista: t(d.motorista), motorista_cpf: t(d.motorista_cpf), motorista_telefone: t(d.motorista_telefone), contratado_por: t(d.contratado_por), carroceria: d.carroceria || null, peso_t: numPeso(d.peso_t),
          paradas: paradasNovas(d.paradas, v.paradas), valores, observacao: t(d.observacao),
        }), [mudouValor.length ? `Valores alterados: ${mudouValor.join(', ')}` : null,
          (t(d.contratado_por) ?? null) !== (v.contratado_por ?? null) ? `Contratado por: ${v.contratado_por ?? '—'} → ${t(d.contratado_por) ?? '—'}` : null].filter(Boolean).join('. ') || null, t(motivo));
      },

      avancar(id: string) {
        exigir('ind.avancar');
        const v = viagem(id);
        if (v.etapa === 'carregada') falha('A documentação sai pela Emissão do Industrializado.');
        if (v.etapa === 'entregue') falha('Use "Encerrar" no Pós-entrega.');
        const pend = pendenciasAvanco(v, cliente(v.cliente_id), estado.ocorrencias);
        if (pend.length) falha(pend.join('. ') + '.');
        const prox = proximaEtapa(v.etapa) ?? falha('Viagem já está na última etapa.');
        mudar(id, `Etapa: ${ROTULO_ETAPA[v.etapa]} → ${ROTULO_ETAPA[prox]}`, () => ({ etapa: prox, ...(prox === 'entregue' ? { entregue_em: agora() } : {}) }));
      },

      /** Veículo marcado que terminou de carregar: vai direto para Carregada (fila da Emissão). Coletas abertas são concluídas. */
      veiculoCarregado(id: string) {
        exigir('ind.avancar');
        const v = viagem(id);
        if (!['lancada', 'contratado', 'coleta_agendada', 'carregando'].includes(v.etapa)) falha('A carga já passou do carregamento.');
        if (!v.motorista || !v.placa_cavalo) falha('Informe o motorista e a placa antes.');
        if (!v.combinado?.marcou_em) falha('O veículo ainda não marcou o combinado.');
        const h = agora();
        mudar(id, `Etapa: ${ROTULO_ETAPA[v.etapa]} → ${ROTULO_ETAPA.carregada}`, (x) => ({
          etapa: 'carregada',
          paradas: x.paradas.map((p) => (p.tipo === 'coleta' && p.situacao !== 'concluida' && p.situacao !== 'recusada'
            ? { ...p, situacao: 'concluida' as const, chegada_em: p.chegada_em ?? h, inicio_em: p.inicio_em ?? h, fim_em: h } : p)),
        }), 'Veículo carregado (pelo Painel)');
      },

      voltar(id: string, motivo: string) {
        exigir('ind.voltar');
        if (!motivo.trim()) falha('Informe o motivo para voltar a etapa.');
        const v = viagem(id);
        const ant = etapaAnterior(v.etapa) ?? falha('Viagem já está na primeira etapa.');
        if (v.etapa === 'encerrada' || v.etapa === 'cancelada') falha('Viagem encerrada ou cancelada não volta etapa.');
        mudar(id, `Etapa voltou: ${ROTULO_ETAPA[v.etapa]} → ${ROTULO_ETAPA[ant]}`, () => ({ etapa: ant, ...(v.etapa === 'entregue' ? { entregue_em: null } : {}) }), null, motivo.trim());
      },

      cancelar(id: string, motivo: string) {
        exigir('ind.cancelar');
        if (!motivo.trim()) falha('Informe o motivo do cancelamento.');
        const v = viagem(id);
        if (v.etapa === 'encerrada' || v.etapa === 'cancelada') falha('Viagem já encerrada ou cancelada.');
        mudar(id, 'Viagem cancelada', () => ({ etapa: 'cancelada' }), `Estava em ${ROTULO_ETAPA[v.etapa]}`, motivo.trim());
      },

      definirCombinado(id: string, o_que: string, para: string) {
        exigir('ind.avancar');
        if (!o_que.trim() || !para) falha('Informe o que foi combinado e o horário.');
        const fase = ETAPAS_TRANSITO.includes(viagem(id).etapa) ? 'transito' as const : 'coleta' as const;
        mudar(id, fase === 'transito' ? 'Combinado de trânsito com o motorista' : 'Combinado com o motorista', () => ({ combinado: { o_que: o_que.trim(), para: new Date(para).toISOString(), marcou_em: null, registrado_por: usuario, fase } }),
          `${o_que.trim()} às ${new Date(para).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);
      },

      marcarChecagem(id: string, item: ChecagemInd, marcado: boolean) {
        exigir('ind.avancar');
        const v = viagem(id);
        const atuais = { ...(v.checagens ?? {}) };
        if (marcado) atuais[item] = { em: agora(), por: usuario }; else delete atuais[item];
        mudar(id, marcado ? `${ROTULO_CHECAGEM[item]} conferido` : `${ROTULO_CHECAGEM[item]} desmarcado`, () => ({ checagens: atuais }));
      },

      registrarMarcou(id: string) {
        exigir('ind.avancar');
        const v = viagem(id);
        if (!v.combinado) falha('Não há combinado registrado.');
        mudar(id, 'Veículo marcou', (x) => ({ combinado: { ...x.combinado!, marcou_em: agora() } }), v.combinado.o_que);
      },

      situacaoParada(id: string, paradaId: string, s: SituacaoParada) {
        exigir('ind.avancar');
        const v = viagem(id);
        const p = v.paradas.find((x) => x.id === paradaId) ?? falha('Parada não encontrada.');
        const h = agora();
        mudar(id, `${p.tipo === 'coleta' ? 'Coleta' : 'Entrega'} ${p.ordem}: ${ROTULO_SIT_PARADA[s]}`, (x) => ({
          paradas: x.paradas.map((y) => (y.id !== paradaId ? y : {
            ...y, situacao: s,
            chegada_em: y.chegada_em ?? (s !== 'pendente' ? h : null),
            inicio_em: y.inicio_em ?? (s === 'em_operacao' || s === 'concluida' ? h : null),
            fim_em: s === 'concluida' || s === 'recusada' ? h : y.fim_em,
          })),
        }), p.local);
      },

      /** Veículo chegou ao cliente para descarregar: a próxima entrega pendente vira "Chegou" e a carga vai para Veículos Marcados. */
      marcadoDescarga(id: string) {
        exigir('ind.avancar');
        const v = viagem(id);
        if (!['documentada', 'transito', 'entregas'].includes(v.etapa)) falha('A carga não está em trânsito.');
        if (v.etapa === 'documentada') { const f = avisoConferencia(v, 'seguir para a descarga'); if (f.length) falha(f[0] + '.'); }
        const p = v.paradas.filter((x) => x.tipo === 'entrega' && x.situacao === 'pendente').sort((x, y) => x.ordem - y.ordem)[0] ?? falha('Não há entrega pendente.');
        const h = agora();
        mudar(id, `Marcado na descarga: Entrega ${p.ordem}${v.etapa !== 'entregas' ? ` (${ROTULO_ETAPA[v.etapa]} → ${ROTULO_ETAPA.entregas})` : ''}`, (x) => ({
          etapa: 'entregas',
          paradas: x.paradas.map((y) => (y.id !== p.id ? y : { ...y, situacao: 'chegou' as const, chegada_em: h })),
        }), `${p.local} (${p.cidade}/${p.uf})`);
      },

      /** Fim da descarga no cliente: a entrega atual é concluída. Sem outra entrega pendente, a carga fica Entregue; senão volta para o trânsito. */
      finalizarDescarga(id: string, comOcorrencia: boolean): 'entregue' | 'proxima' {
        exigir('ind.avancar');
        const v = viagem(id);
        const p = v.paradas.find((x) => x.tipo === 'entrega' && (x.situacao === 'chegou' || x.situacao === 'em_operacao')) ?? falha('Nenhum veículo marcado na descarga.');
        const restam = v.paradas.some((x) => x.tipo === 'entrega' && x.id !== p.id && x.situacao !== 'concluida' && x.situacao !== 'recusada');
        const h = agora();
        mudar(id, `Finalizado ${comOcorrencia ? 'com' : 'sem'} ocorrência: Entrega ${p.ordem}${restam ? '' : ` (${ROTULO_ETAPA[v.etapa]} → ${ROTULO_ETAPA.entregue})`}`, (x) => ({
          ...(restam ? {} : { etapa: 'entregue' as const, entregue_em: h }),
          paradas: x.paradas.map((y) => (y.id !== p.id ? y : { ...y, situacao: 'concluida' as const, inicio_em: y.inicio_em ?? h, fim_em: h })),
        }), `${p.local} (${p.cidade}/${p.uf})`);
        return restam ? 'proxima' : 'entregue';
      },

      /** Tira a carga do quadro Finalizados com Ocorrência; as ocorrências seguem em Ocorrências (aprovação e pagamento). */
      finalizarNoPainel(id: string) {
        exigir('ind.ocorrencias');
        mudar(id, 'Finalizado no Painel (sai de Finalizados com Ocorrência)', () => ({ painel_finalizado_em: agora(), painel_finalizado_por: usuario }));
      },

      informarPo(id: string, paradaId: string, po: string) {
        exigir('ind.lancar');
        if (!po.trim()) falha('Informe a PO.');
        const p = viagem(id).paradas.find((x) => x.id === paradaId && x.tipo === 'entrega') ?? falha('Entrega não encontrada.');
        mudar(id, `PO informada: entrega ${p.ordem}`, (v) => ({ paradas: v.paradas.map((x) => (x.id === paradaId ? { ...x, po: po.trim() } : x)) }), `${p.local}: PO ${po.trim()}${p.po ? ` (antes ${p.po})` : ''}`);
      },

      assumirEmissao(id: string) {
        exigir('ind.emissao');
        const v = viagem(id);
        if (v.etapa !== 'carregada') falha('Só viagens carregadas entram na Emissão.');
        if (v.emissao_assumida_por && v.emissao_assumida_por !== usuario) falha(`Já assumida por ${v.emissao_assumida_por}.`);
        mudar(id, 'Emissão assumida', () => ({ emissao_assumida_por: usuario, emissao_assumida_em: agora() }));
      },

      liberarEmissao(id: string, d: { cte: string; mdfe: string; nfs: string; pos: Record<string, string> }, valores: ValoresEmissao) {
        exigir('ind.emissao');
        const v = viagem(id);
        if (v.etapa !== 'carregada') falha('A viagem não está aguardando emissão.');
        const pend = pendenciasEmissao(v, cliente(v.cliente_id), d, valores);
        if (pend.length) falha(pend.join('. ') + '.');
        const novos = valoresConfirmados(v.valores, valores);
        const rot: Array<[keyof ValoresInd, string]> = [['frete_empresa', 'Frete empresa'], ['pedagio', 'Pedágio empresa'], ['custo_extra', 'Custo extra'], ['adicional_frete', 'Adicional de frete'], ['frete_motorista', 'Frete motorista'], ['pedagio_motorista', 'Pedágio motorista']];
        const brl = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const conf = rot.map(([k, r]) => `${r} ${brl(novos[k] ?? 0)}${(v.valores[k] ?? 0) !== (novos[k] ?? 0) ? ` (lançado ${brl(v.valores[k] ?? 0)})` : ''}`).join('; ');
        mudar(id, 'Documentos liberados: Carregada → Documentada', () => ({
          etapa: 'documentada', cte: d.cte.trim(), mdfe: t(d.mdfe), nfs: d.nfs.trim(),
          paradas: v.paradas.map((x) => (x.tipo === 'entrega' && d.pos[x.id]?.trim() ? { ...x, po: d.pos[x.id].trim() } : x)),
          emissao_assumida_por: v.emissao_assumida_por ?? usuario, emissao_assumida_em: v.emissao_assumida_em ?? agora(),
          valores: novos, valores_conferidos_em: agora(), valores_conferidos_por: usuario,
        }), `CT-e ${d.cte.trim()}${d.mdfe.trim() ? `, MDF-e ${d.mdfe.trim()}` : ''}, NF ${d.nfs.trim()}. Valores conferidos: ${conf}`);
      },

      abrirOcorrencia(d: { viagem_id: string; parada_id: string | null; tipo: TipoOcorrencia; carga: CargaOcorrencia; avaria: boolean; descricao: string; valor_motorista: number; valor_cliente: number }): OcorrenciaInd {
        exigir('ind.ocorrencias');
        const v = viagem(d.viagem_id);
        if (v.etapa === 'encerrada' || v.etapa === 'cancelada') falha('Viagem encerrada ou cancelada.');
        if (!d.descricao.trim()) falha('Descreva a ocorrência.');
        const ent = v.paradas.find((x) => x.id === d.parada_id);
        if (cliente(v.cliente_id)?.exige_po && v.paradas.some((x) => x.tipo === 'entrega') && !ent) falha('Escolha a entrega (PO) da ocorrência.');
        const o: OcorrenciaInd = {
          id: uid(), codigo: codigoOcorrencia(estado.seqOc + 1), ...d, descricao: d.descricao.trim(),
          valor_motorista: pode('ind.financeiro') ? d.valor_motorista : 0, valor_cliente: pode('ind.financeiro') ? d.valor_cliente : 0,
          situacao: 'aberta', aberta_em: agora(), aberta_por: usuario, aprovada_por: null, aprovada_em: null, paga_em: null, paga_por: null,
        };
        gravar({ ...estado, seqOc: estado.seqOc + 1, ocorrencias: [...estado.ocorrencias, o] });
        mudar(v.id, `Ocorrência ${o.codigo} aberta`, () => ({}), `${ROTULO_OCORRENCIA[o.tipo]}, carga ${o.carga}${o.avaria ? ', com avaria' : ''}`);
        return o;
      },

      aprovarOcorrencia(id: string, valores: { valor_motorista: number; valor_cliente: number }) {
        exigir('ind.ocorrencias_aprovar');
        const o = mudarOc(id, (x) => {
          if (x.situacao !== 'aberta') falha('Só ocorrências abertas podem ser aprovadas.');
          return { ...valores, situacao: 'aprovada', aprovada_por: usuario, aprovada_em: agora() };
        });
        mudar(o.viagem_id, `Ocorrência ${o.codigo} aprovada`, () => ({}), `Motorista R$ ${valores.valor_motorista.toFixed(2)}, cliente R$ ${valores.valor_cliente.toFixed(2)}`);
      },

      pagarOcorrencia(id: string) {
        exigir('ind.ocorrencias_aprovar');
        const o = mudarOc(id, (x) => {
          if (x.situacao !== 'aprovada') falha('Aprove a ocorrência antes de marcar o pagamento.');
          return { situacao: 'paga', paga_em: agora(), paga_por: usuario };
        });
        mudar(o.viagem_id, `Ocorrência ${o.codigo} paga ao motorista`, () => ({}));
      },

      cancelarOcorrencia(id: string, motivo: string) {
        exigir('ind.ocorrencias_aprovar');
        if (!motivo.trim()) falha('Informe o motivo.');
        const o = mudarOc(id, (x) => {
          if (x.situacao === 'paga') falha('Ocorrência já paga não pode ser cancelada.');
          return { situacao: 'cancelada' };
        });
        mudar(o.viagem_id, `Ocorrência ${o.codigo} cancelada`, () => ({}), null, motivo.trim());
      },

      registrarCanhoto(id: string, tipo: 'digital' | 'fisico') {
        exigir('ind.pos_entrega');
        const v = viagem(id);
        if (!v.entregue_em) falha('A viagem ainda não foi entregue.');
        mudar(id, tipo === 'digital' ? 'Canhoto digital recebido' : 'Canhoto físico recebido', () => (tipo === 'digital' ? { canhoto_digital_em: agora() } : { canhoto_fisico_em: agora() }));
      },

      conferirComprovante(id: string) {
        exigir('ind.pos_entrega');
        if (!viagem(id).entregue_em) falha('A viagem ainda não foi entregue.');
        mudar(id, 'Comprovante de entrega conferido', () => ({ comprovante_ok_em: agora() }));
      },

      encerrar(id: string) {
        exigir('ind.pos_entrega');
        const v = viagem(id);
        if (v.etapa !== 'entregue') falha('Só viagens entregues podem ser encerradas.');
        const pend = pendenciasEncerrar(v, estado.ocorrencias);
        if (pend.length) falha(pend.join('. ') + '.');
        mudar(id, 'Etapa: Entregue → Encerrada', () => ({ etapa: 'encerrada' }));
      },

      criarReversa(id: string, motivo: string): ViagemInd {
        exigir('ind.lancar');
        if (!motivo.trim()) falha('Informe o motivo da reversa.');
        const v = viagem(id);
        if (!v.entregue_em) falha('A reversa nasce de uma viagem entregue.');
        const inv = [...v.paradas].reverse();
        const r: ViagemInd = {
          ...v, id: uid(), codigo: estado.seq + 1, etapa: 'lancada', reversa_de: v.id, po: null, pedido: v.pedido,
          paradas: inv.map((p, i) => ({ ...p, id: uid(), ordem: i + 1, tipo: i === 0 ? 'coleta' : i === inv.length - 1 ? 'entrega' : p.tipo, situacao: 'pendente', chegada_em: null, inicio_em: null, fim_em: null, agendado_para: null, protocolo: null, exige_agendamento: false })),
          valores: { ...VALORES_ZERO }, combinado: null, emissao_assumida_por: null, emissao_assumida_em: null, cte: null, mdfe: null, nfs: null, coleta_prevista: null,
          entregue_em: null, canhoto_digital_em: null, canhoto_fisico_em: null, comprovante_ok_em: null, observacao: `Reversa do pedido ${v.pedido ?? 'sem pedido'}: ${motivo.trim()}`,
          criado_em: agora(), criado_por: usuario, historico: [{ em: agora(), usuario, acao: 'Reversa lançada', detalhe: `Origem: pedido ${v.pedido ?? 'sem pedido'}`, motivo: motivo.trim() }],
        };
        gravar({ ...estado, seq: r.codigo, viagens: [...estado.viagens, r] });
        mudar(v.id, 'Reversa criada', () => ({}), `Pedido ${r.pedido ?? 'sem pedido'}`, motivo.trim());
        return r;
      },
    };
  }, [pode, usuario]);

  const clientePorId = useMemo(() => Object.fromEntries(st.clientes.map((c) => [c.id, c])), [st.clientes]);
  return { ...st, clientePorId, acoes, pode, previa: api.modo === 'local' };
}
