// Dados do módulo Industrializado.
// PRÉVIA: guardados só neste navegador, com dados fictícios. Em produção, cada ação vira uma função no banco
// (com a mesma checagem de permissão e o histórico gravado pelo servidor).

import { useMemo, useSyncExternalStore } from 'react';
import { useApp } from '../data/store';
import { hojeSP, somarDias } from '../lib/formato';
import type { Permissao } from '../types';
import { codigoOcorrencia, etapaAnterior, pendenciasAvanco, pendenciasEmissao, pendenciasEncerrar, proximaEtapa } from './regras';
import {
  ROTULO_ETAPA, ROTULO_OCORRENCIA, ROTULO_SIT_PARADA, VALORES_ZERO,
  type CargaOcorrencia, type ClienteInd, type OcorrenciaInd, type ParadaInd, type SituacaoParada, type TipoOcorrencia, type ValoresInd, type ViagemInd,
} from './tipos';

export interface EstadoInd {
  versao: 1; seq: number; seqOc: number; clientes: ClienteInd[]; viagens: ViagemInd[]; ocorrencias: OcorrenciaInd[];
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
  const val = (fe: number, fm: number, extra: Partial<ValoresInd> = {}): ValoresInd => ({ ...VALORES_ZERO, frete_empresa: fe, frete_motorista: fm, ...extra });
  let n = 0;
  const v = (cliente: number, etapa: ViagemInd['etapa'], p: Partial<ViagemInd>): ViagemInd => ({
    id: uid(), codigo: ++n, cliente_id: clientes[cliente].id, tipo_carga: 'paletizada', pedido: `PED-${5100 + n}`, po: null, etapa,
    coleta_prevista: ['entregue', 'encerrada', 'transito', 'entregas'].includes(etapa) ? somarDias(hoje, -2) : hoje,
    frota: 'terceiro', tipo_veiculo: 'Carreta', placa_cavalo: null, placa_carreta: null, motorista: null, motorista_cpf: null, motorista_telefone: null,
    paradas: [], valores: val(0, 0), combinado: null, emissao_assumida_por: null, emissao_assumida_em: null, cte: null, mdfe: null, nfs: null,
    entregue_em: null, canhoto_digital_em: null, canhoto_fisico_em: null, comprovante_ok_em: null, reversa_de: null, observacao: null,
    criado_em: emDias(-3), criado_por: '[DEMO] Equipe de embarque',
    historico: [{ em: emDias(-3), usuario: '[DEMO] Equipe de embarque', acao: 'Viagem lançada', detalhe: null, motivo: null }],
    ...p,
  });
  const mot = (i: number) => ({
    motorista: ['João Batista Lima', 'Carlos Henrique Souza', 'Marcos Vinícius Rocha', 'Edson Pereira', 'Rogério Alves', 'Antônio Carlos Dias', 'Wellington Santos', 'Luiz Fernando Melo'][i],
    motorista_cpf: `${100 + i}.${200 + i}.${300 + i}-${10 + i}`, motorista_telefone: `(62) 9 9${100 + i}-${4000 + i}`,
    placa_cavalo: `RTA${i}B${10 + i}`, placa_carreta: `QWE${i}C${20 + i}`,
  });
  const viagens: ViagemInd[] = [
    v(1, 'lancada', { tipo_carga: 'fracionada', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null), par(2, 'entrega', 'Loja Centro', 'Anápolis', 'GO', emDias(1, 2)), par(3, 'entrega', 'Loja Norte', 'Brasília', 'DF', emDias(1, 6))], valores: val(6800, 5600, { pedagio: 180 }) }),
    v(0, 'contratado', { ...mot(0), paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', null), par(2, 'entrega', 'CD Uberlândia', 'Uberlândia', 'MG', emDias(2))], valores: val(9200, 7900, { pedagio: 320 }),
      combinado: { o_que: 'Chegada na fábrica para agendar', para: emMin(45), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(3, 'coleta_agendada', { ...mot(1), tipo_carga: 'carga_geral', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', emMin(30), 'pendente', 'AG-88123'), par(2, 'entrega', 'Atacado Sul', 'Goiânia', 'GO', emDias(1))], valores: val(4200, 3900),
      combinado: { o_que: 'Chegada na coleta', para: emMin(-20), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(2, 'carregando', { ...mot(2), paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null, 'em_operacao'), par(2, 'entrega', 'Distribuidora Leste', 'Goiânia', 'GO', null), par(3, 'entrega', 'Mercado Bom Preço', 'Trindade', 'GO', null)], valores: val(5100, 4300),
      combinado: { o_que: 'Fim do carregamento', para: emMin(80), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(0, 'carregada', { ...mot(3), historico: [{ em: emDias(-1), usuario: '[DEMO] Equipe de embarque', acao: 'Viagem lançada', detalhe: null, motivo: null }, { em: emMin(-25), usuario: '[DEMO] Equipe de embarque', acao: 'Etapa: Carregando → Carregada', detalhe: null, motivo: null }], paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', emMin(-240), 'concluida', 'CG-5521'), par(2, 'entrega', 'Porto Seco', 'Anápolis', 'GO', emDias(1, 3))], valores: val(7400, 6300, { pedagio: 140 }) }),
    v(4, 'documentada', { ...mot(4), cte: '35201', mdfe: '9921', nfs: '118220, 118221', paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Rio Verde', 'GO', null)], valores: val(3900, 3500),
      combinado: { o_que: 'Saída para viagem', para: emMin(-40), marcou_em: emMin(-55), registrado_por: '[DEMO] Equipe de embarque' } }),
    v(1, 'transito', { ...mot(5), cte: '35188', nfs: '77410', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Cuiabá', 'Cuiabá', 'MT', emMin(300), 'pendente', 'AUR-2231')], valores: val(12800, 10900, { pedagio: 610 }),
      combinado: { o_que: 'Chegada no cliente', para: emMin(240), marcou_em: null, registrado_por: '[DEMO] Equipe de pós-embarque' } }),
    v(3, 'entregas', { ...mot(6), tipo_carga: 'fracionada', cte: '35170', nfs: '55120, 55121, 55122', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Loja 1', 'Itumbiara', 'GO', emMin(-300), 'concluida'), par(3, 'entrega', 'Loja 2', 'Uberlândia', 'MG', emMin(-30), 'em_operacao', 'PL-7781'), par(4, 'entrega', 'Loja 3', 'Uberaba', 'MG', emDias(1))], valores: val(8600, 7200, { descarga: 250 }) }),
    v(0, 'entregue', { ...mot(7), po: '4500231987', cte: '35102', nfs: '99001', entregue_em: emDias(-33), canhoto_digital_em: emDias(-32), paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Sorriso', 'Sorriso', 'MT', emDias(-33), 'concluida', 'CG-4410')], valores: val(15200, 13300, { pedagio: 720, descarga: 400 }) }),
    v(2, 'entregue', { ...mot(1), cte: '35140', nfs: '30221', entregue_em: emDias(-6), canhoto_digital_em: emDias(-6), canhoto_fisico_em: emDias(-1), paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', null, 'concluida'), par(2, 'entrega', 'Distribuidora Oeste', 'Jataí', 'GO', null, 'concluida')], valores: val(4800, 4400) }),
    v(4, 'encerrada', { ...mot(2), cte: '35090', nfs: '20110', entregue_em: emDias(-20), canhoto_digital_em: emDias(-20), canhoto_fisico_em: emDias(-12), comprovante_ok_em: emDias(-12), paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Catalão', 'GO', null, 'concluida')], valores: val(3600, 3050, { pedagio: 90 }) }),
  ];
  // Mais cargas para os quadros do Painel (disponíveis, contratados em cada cor, trânsito e marcados).
  viagens.push(
    v(3, 'lancada', { tipo_carga: 'fracionada', paradas: [par(1, 'coleta', 'Indústria Planalto', 'Aparecida de Goiânia', 'GO', null), par(2, 'entrega', 'Atacado Norte', 'Palmas', 'TO', emDias(2))], valores: val(9800, 8300) }),
    v(4, 'lancada', { paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null), par(2, 'entrega', 'Cliente final', 'Goianésia', 'GO', null)], valores: val(2900, 2450) }),
    v(1, 'contratado', { ...mot(3), placa_cavalo: 'SDF4G55', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null), par(2, 'entrega', 'Loja Sul', 'Caldas Novas', 'GO', emDias(1))], valores: val(3800, 3200),
      combinado: { o_que: 'Chegada no CD para carregar', para: emMin(200), marcou_em: null, registrado_por: '[DEMO] Equipe de embarque' } }),
    v(2, 'coleta_agendada', { ...mot(6), placa_cavalo: 'HJK7L88', paradas: [par(1, 'coleta', 'Fábrica Serra Azul', 'Senador Canedo', 'GO', emMin(30), 'chegou'), par(2, 'entrega', 'Distribuidora Sul', 'Itumbiara', 'GO', null)], valores: val(4100, 3600),
      combinado: { o_que: 'Chegada na fábrica', para: emMin(-10), marcou_em: emMin(-15), registrado_por: '[DEMO] Equipe de embarque' } }),
    v(0, 'transito', { ...mot(4), placa_cavalo: 'PLM2N44', po: '4500233001', cte: '35210', nfs: '99102', paradas: [par(1, 'coleta', 'Fábrica Cargill', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Terminal Rondonópolis', 'Rondonópolis', 'MT', emDias(1, 1), 'pendente', 'CG-5600')], valores: val(11200, 9600, { pedagio: 480 }) }),
    v(1, 'transito', { ...mot(0), placa_cavalo: 'QAZ5W66', cte: '35211', nfs: '77455', paradas: [par(1, 'coleta', 'CD Aurora', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'CD Belém', 'Belém', 'PA', emDias(3), 'pendente', 'AUR-2290')], valores: val(18900, 16100, { pedagio: 900 }) }),
    v(4, 'entregas', { ...mot(5), placa_cavalo: 'WSX8E99', cte: '35199', nfs: '20155', paradas: [par(1, 'coleta', 'Embalagens Cerrado', 'Goiânia', 'GO', null, 'concluida'), par(2, 'entrega', 'Cliente final', 'Anápolis', 'GO', emMin(-60), 'chegou')], valores: val(2600, 2200) }),
  );
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
  ];
  return { versao: 1, seq: n, seqOc: ocorrencias.length, clientes, viagens, ocorrencias, metas: { [hoje]: 8 } };
}

// ---------------------------------------------------------------------------
// Armazenamento
// ---------------------------------------------------------------------------
let estado: EstadoInd = (() => {
  try { const s = localStorage.getItem(CHAVE); if (s) return JSON.parse(s) as EstadoInd; } catch { /* sem armazenamento */ }
  return semear();
})();
const ouvintes = new Set<() => void>();
function gravar(novo: EstadoInd) {
  estado = novo;
  try { localStorage.setItem(CHAVE, JSON.stringify(novo)); } catch { /* fica só em memória */ }
  for (const o of ouvintes) o();
}
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
const ler = () => estado;

export function restaurarPrevia() { gravar(semear()); }

// ---------------------------------------------------------------------------
// Ações (cada uma confere a permissão e grava o histórico da carga)
// ---------------------------------------------------------------------------
export interface NovaViagem {
  cliente_id: string; tipo_carga: ViagemInd['tipo_carga']; pedido: string; po: string; frota: ViagemInd['frota']; coleta_prevista: string;
  tipo_veiculo: string; placa_cavalo: string; placa_carreta: string; motorista: string; motorista_cpf: string; motorista_telefone: string;
  paradas: Array<Omit<ParadaInd, 'id' | 'situacao' | 'chegada_em' | 'inicio_em' | 'fim_em'> & { id?: string }>;
  valores: ValoresInd; observacao: string;
}

const t = (s: string) => (s.trim() ? s.trim() : null);
function falha(msg: string): never { throw new Error(msg); }

export function useInd() {
  const { estado: app, pode } = useApp();
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
        nfs: p.nfs?.trim() || null, situacao: a?.situacao ?? 'pendente', chegada_em: a?.chegada_em ?? null, inicio_em: a?.inicio_em ?? null, fim_em: a?.fim_em ?? null,
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
          motorista: t(d.motorista), motorista_cpf: t(d.motorista_cpf), motorista_telefone: t(d.motorista_telefone),
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
          motorista: t(d.motorista), motorista_cpf: t(d.motorista_cpf), motorista_telefone: t(d.motorista_telefone),
          paradas: paradasNovas(d.paradas, v.paradas), valores, observacao: t(d.observacao),
        }), mudouValor.length ? `Valores alterados: ${mudouValor.join(', ')}` : null, t(motivo));
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
        mudar(id, 'Combinado com o motorista', () => ({ combinado: { o_que: o_que.trim(), para: new Date(para).toISOString(), marcou_em: null, registrado_por: usuario } }),
          `${o_que.trim()} às ${new Date(para).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);
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

      informarPo(id: string, po: string) {
        exigir('ind.lancar');
        if (!po.trim()) falha('Informe o PO.');
        mudar(id, 'PO informado', () => ({ po: po.trim() }), po.trim());
      },

      assumirEmissao(id: string) {
        exigir('ind.emissao');
        const v = viagem(id);
        if (v.etapa !== 'carregada') falha('Só viagens carregadas entram na Emissão.');
        if (v.emissao_assumida_por && v.emissao_assumida_por !== usuario) falha(`Já assumida por ${v.emissao_assumida_por}.`);
        mudar(id, 'Emissão assumida', () => ({ emissao_assumida_por: usuario, emissao_assumida_em: agora() }));
      },

      liberarEmissao(id: string, d: { cte: string; mdfe: string; nfs: string; po: string }) {
        exigir('ind.emissao');
        const v = viagem(id);
        if (v.etapa !== 'carregada') falha('A viagem não está aguardando emissão.');
        const pend = pendenciasEmissao(v, cliente(v.cliente_id), d);
        if (pend.length) falha(pend.join('. ') + '.');
        mudar(id, 'Documentos liberados: Carregada → Documentada', () => ({
          etapa: 'documentada', cte: d.cte.trim(), mdfe: t(d.mdfe), nfs: d.nfs.trim(), po: t(d.po) ?? v.po,
          emissao_assumida_por: v.emissao_assumida_por ?? usuario, emissao_assumida_em: v.emissao_assumida_em ?? agora(),
        }), `CT-e ${d.cte.trim()}${d.mdfe.trim() ? `, MDF-e ${d.mdfe.trim()}` : ''}, NF ${d.nfs.trim()}`);
      },

      abrirOcorrencia(d: { viagem_id: string; parada_id: string | null; tipo: TipoOcorrencia; carga: CargaOcorrencia; avaria: boolean; descricao: string; valor_motorista: number; valor_cliente: number }): OcorrenciaInd {
        exigir('ind.ocorrencias');
        const v = viagem(d.viagem_id);
        if (v.etapa === 'encerrada' || v.etapa === 'cancelada') falha('Viagem encerrada ou cancelada.');
        if (!d.descricao.trim()) falha('Descreva a ocorrência.');
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
          entregue_em: null, canhoto_digital_em: null, canhoto_fisico_em: null, comprovante_ok_em: null, observacao: `Reversa da viagem IND-${String(v.codigo).padStart(4, '0')}: ${motivo.trim()}`,
          criado_em: agora(), criado_por: usuario, historico: [{ em: agora(), usuario, acao: 'Reversa lançada', detalhe: `Origem: IND-${String(v.codigo).padStart(4, '0')}`, motivo: motivo.trim() }],
        };
        gravar({ ...estado, seq: r.codigo, viagens: [...estado.viagens, r] });
        mudar(v.id, 'Reversa criada', () => ({}), `IND-${String(r.codigo).padStart(4, '0')}`, motivo.trim());
        return r;
      },
    };
  }, [pode, usuario]);

  const clientePorId = useMemo(() => Object.fromEntries(st.clientes.map((c) => [c.id, c])), [st.clientes]);
  return { ...st, clientePorId, acoes, pode };
}
