// Módulo Industrializado: cargas paletizadas, batidas e a granel, cobradas por viagem (lotação).
// Exclusivo do centro de custo Industrializado (filial Goiânia). Decisões de 06/11/2026.

export type EtapaInd =
  | 'lancada' | 'contratado' | 'coleta_agendada' | 'carregando' | 'carregada' | 'documentada'
  | 'transito' | 'entregas' | 'entregue' | 'encerrada' | 'cancelada';

export type TipoCarga = 'paletizada' | 'batida' | 'granel';
export type TipoParada = 'coleta' | 'entrega';
export type SituacaoParada = 'pendente' | 'chegou' | 'em_operacao' | 'concluida' | 'recusada';
export type TipoOcorrencia = 'diaria' | 'deslocamento' | 'retrabalho' | 'reentrega' | 'devolucao' | 'reagendamento';
/** Estado da carga quando a ocorrência foi aberta: carregado = atenção maior (amarelo), descarregado = verde. */
export type CargaOcorrencia = 'carregado' | 'descarregado';
export type SituacaoOcorrencia = 'aberta' | 'aprovada' | 'paga' | 'cancelada';

export interface ClienteInd {
  id: string; nome: string; cnpj: string | null; contato: string | null; telefone: string | null;
  /** Padrão para as paradas novas desse cliente (cada parada pode mudar). */
  exige_agendamento: boolean;
  /** Ex.: Cargill. Depois que o veículo carrega, o PO passa a ser obrigatório para seguir. */
  exige_po: boolean;
  ativo: boolean;
}

export interface ParadaInd {
  id: string; ordem: number; tipo: TipoParada;
  local: string; cidade: string; uf: string;
  exige_agendamento: boolean;
  /** Data e hora agendadas (obrigatória só quando a parada exige agendamento). */
  agendado_para: string | null;
  protocolo: string | null;
  situacao: SituacaoParada;
  chegada_em: string | null; inicio_em: string | null; fim_em: string | null;
  nfs: string | null;
}

export interface ValoresInd {
  // Receita
  /** pedagio = pedágio empresa (cobrado do cliente). */
  frete_empresa: number; custo_extra: number; pedagio: number; cte_complementar: number;
  adicional_frete?: number;
  // Despesa
  frete_motorista: number; descarga: number; diaria: number;
  pedagio_motorista?: number;
}

/** Combinado entre o funcionário e o motorista (tracking). Alerta 1 hora antes se o veículo não marcou. */
export interface CombinadoInd {
  o_que: string; para: string; marcou_em: string | null; registrado_por: string;
  /** coleta = até carregar; transito = registrado depois de carregado (tracking até a descarga). Ausente = coleta. */
  fase?: 'coleta' | 'transito';
}

/** Conferências do veículo contratado antes da coleta (vermelho até marcar, verde depois). */
export type ChecagemInd = 'cadastro' | 'monitoramento' | 'oc_vinculo';
export const CHECAGENS: ChecagemInd[] = ['cadastro', 'monitoramento', 'oc_vinculo'];
export const ROTULO_CHECAGEM: Record<ChecagemInd, string> = { cadastro: 'Cadastro', monitoramento: 'Monitoramento', oc_vinculo: 'OC/Vínculo' };
export type ChecagensInd = Partial<Record<ChecagemInd, { em: string; por: string }>>;

export interface AcaoInd { em: string; usuario: string; acao: string; detalhe: string | null; motivo: string | null }

export interface ViagemInd {
  id: string; codigo: number; cliente_id: string; tipo_carga: TipoCarga;
  /** Pedido do cliente (todo cliente tem). */
  pedido: string | null;
  /** Dia previsto para retirar a carga (AAAA-MM-DD), base da meta diária. */
  coleta_prevista: string | null;
  /** PO (clientes que exigem, como a Cargill): obrigatório depois de carregado. */
  po: string | null;
  etapa: EtapaInd;
  frota: 'frota' | 'terceiro';
  tipo_veiculo: string; placa_cavalo: string | null; placa_carreta: string | null;
  /** Carroceria pedida para a carga e peso total em toneladas (vão na divulgação do frete). */
  carroceria?: Carroceria | null; peso_t?: number | null;
  motorista: string | null; motorista_cpf: string | null; motorista_telefone: string | null;
  /** Colaborador que contratou o veículo (aparece em dourado em toda a ficha). */
  contratado_por?: string | null;
  paradas: ParadaInd[];
  valores: ValoresInd;
  combinado: CombinadoInd | null;
  /** Cadastro, Monitoramento e OC/Vínculo (ausente = nada marcado). */
  checagens?: ChecagensInd;
  // Emissão própria do Industrializado (fora do Apoio Operacional)
  emissao_assumida_por: string | null; emissao_assumida_em: string | null;
  cte: string | null; mdfe: string | null; nfs: string | null;
  // Pós-entrega
  entregue_em: string | null;
  canhoto_digital_em: string | null; canhoto_fisico_em: string | null; comprovante_ok_em: string | null;
  reversa_de: string | null;
  /** Tirada do quadro Finalizados com Ocorrência (as ocorrências seguem em Ocorrências). */
  painel_finalizado_em?: string | null; painel_finalizado_por?: string | null;
  /** Valores do CT-e e do contrato conferidos na Emissão. */
  valores_conferidos_em?: string | null; valores_conferidos_por?: string | null;
  observacao: string | null;
  criado_em: string; criado_por: string;
  historico: AcaoInd[];
}

export interface OcorrenciaInd {
  id: string; codigo: string; viagem_id: string; parada_id: string | null;
  tipo: TipoOcorrencia; carga: CargaOcorrencia; avaria: boolean;
  descricao: string;
  valor_motorista: number; valor_cliente: number;
  situacao: SituacaoOcorrencia;
  aberta_em: string; aberta_por: string;
  aprovada_por: string | null; aprovada_em: string | null;
  paga_em: string | null; paga_por: string | null;
}

export const ETAPAS_FLUXO: EtapaInd[] = ['lancada', 'contratado', 'coleta_agendada', 'carregando', 'carregada', 'documentada', 'transito', 'entregas', 'entregue', 'encerrada'];

export const ROTULO_ETAPA: Record<EtapaInd, string> = {
  lancada: 'Lançada', contratado: 'Veículo contratado', coleta_agendada: 'Coleta agendada', carregando: 'Carregando',
  carregada: 'Carregada', documentada: 'Documentada', transito: 'Em trânsito', entregas: 'Em entregas',
  entregue: 'Entregue', encerrada: 'Encerrada', cancelada: 'Cancelada',
};

export type Carroceria = 'bau' | 'sider' | 'graneleiro';
export const ROTULO_CARROCERIA: Record<Carroceria, string> = { bau: 'Baú', sider: 'Sider', graneleiro: 'Graneleiro' };
export const ROTULO_TIPO_CARGA: Record<TipoCarga, string> = { paletizada: 'Carga paletizada', batida: 'Carga batida', granel: 'Carga granel' };

export const ROTULO_OCORRENCIA: Record<TipoOcorrencia, string> = {
  diaria: 'Diária', deslocamento: 'Deslocamento', retrabalho: 'Retrabalho', reentrega: 'Reentrega',
  devolucao: 'Devolução', reagendamento: 'Reagendamento',
};

export const ROTULO_SIT_OCORRENCIA: Record<SituacaoOcorrencia, string> = {
  aberta: 'Aberta', aprovada: 'Aprovada', paga: 'Paga ao motorista', cancelada: 'Cancelada',
};

export const ROTULO_SIT_PARADA: Record<SituacaoParada, string> = {
  pendente: 'Pendente', chegou: 'Chegou', em_operacao: 'Em operação', concluida: 'Concluída', recusada: 'Recusada',
};

export const VALORES_ZERO: ValoresInd = { frete_empresa: 0, custo_extra: 0, pedagio: 0, cte_complementar: 0, adicional_frete: 0, frete_motorista: 0, descarga: 0, diaria: 0, pedagio_motorista: 0 };
