// Tipos espelhando as tabelas do banco (supabase/migrations).

export type Papel = 'administrador' | 'gestor' | 'supervisor' | 'embarcador' | 'apoio' | 'operacao' | 'comercial' | 'consulta';
export type StatusUsuario = 'pendente' | 'ativo' | 'bloqueado';
export type StatusLiberacao = 'liberado' | 'suspenso' | 'nao_informado';
export type Situacao = 'ativo' | 'arquivado';
export type UnidadeFrete = 'nao_confirmada' | 'rs_tonelada' | 'rs_viagem' | 'outra';
export type UnidadeCadencia = 'veiculos_dia' | 'toneladas_dia';
export type TipoLocal = 'coleta' | 'entrega' | 'ambos';

export type Permissao =
  | 'embarques.ver' | 'embarques.criar' | 'embarques.editar_cadastro' | 'embarques.liberar'
  | 'embarques.editar_cadencia' | 'embarques.editar_cadencia_proprio' | 'embarques.editar_capacidade' | 'embarques.editar_lote' | 'embarques.arquivar' | 'embarques.encerrar'
  | 'carteira.editar' | 'posicoes.pagina' | 'posicoes.abrir' | 'posicoes.editar_contadores'
  | 'posicoes.editar_obs_operacional' | 'posicoes.editar_obs_cliente'
  | 'financeiro.ver' | 'financeiro.editar' | 'historico.ver'
  | 'compartilhamento.preparar' | 'compartilhamento.links'
  | 'importacao.executar' | 'cadastros.gerenciar' | 'usuarios.gerenciar' | 'configuracoes.gerenciar'
  | 'documentacao.ver' | 'documentacao.solicitar' | 'documentacao.cancelar' | 'apoio.pagina' | 'apoio.atender'
  | 'cadastro.solicitar' | 'cadastro.ver' | 'permissoes.gerenciar' | 'analise.operacional' | 'analise.fila'
  | 'estadia.solicitar' | 'estadia.ver' | 'estadia.reabrir' | 'usuarios.inativar' | 'usuarios.excluir';

export interface Filial { id: string; nome: string; codigo: string | null; supervisor?: string | null; centro_custo_id?: string | null; ativo: boolean; is_demo: boolean }
export interface CentroCusto { id: string; nome: string; ativo: boolean; is_demo: boolean; acesso_total?: boolean }
export interface Comercial { id: string; nome: string; email: string | null; telefone?: string | null; ativo: boolean; is_demo: boolean }
export interface Cliente {
  id: string; nome: string; documento: string | null; comercial_id: string | null;
  restricao_comercial: string | null; ativo: boolean; is_demo: boolean;
  razao_social?: string | null; inscricao_estadual?: string | null; situacao_cadastral?: string | null;
  atividade_principal?: string | null; logradouro?: string | null; numero?: string | null; complemento?: string | null;
  bairro?: string | null; municipio?: string | null; uf?: string | null; cep?: string | null; email?: string | null;
  telefone_cadastro?: string | null; telefone_comercial?: string | null; telefone_financeiro?: string | null;
  logo_url?: string | null; dados_consultados_em?: string | null;
}
export interface Produto {
  id: string; nome: string; valor_pauta_kg?: number | null; valor_pauta_data?: string | null; ativo: boolean; is_demo: boolean;
  /** Nome do produto na tabela da CNA (atualizado todo dia às 15h) e de onde veio o preço. */
  cna_produto?: string | null; preco_fonte?: string | null;
}
export type UsoCidade = 'origem' | 'destino' | 'ambos';
export interface Cidade { id: string; nome: string; uf: string | null; uso?: UsoCidade; ativo: boolean; is_demo: boolean }

/** Dados de CNPJ devolvidos pela consulta às bases públicas da Receita. */
export interface DadosCnpj {
  fonte: string; cnpj: string; razao_social: string | null; nome_fantasia: string | null; situacao_cadastral: string | null;
  atividade_principal: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; municipio: string | null; uf: string | null; cep: string | null; telefone: string | null;
  email: string | null; inscricao_estadual: string | null; inscricoes_estaduais: Array<{ ie: string; uf: string | null; ativa: boolean }>;
}
export interface Local {
  id: string; nome: string; cidade: string | null; uf: string | null; tipo: TipoLocal; ativo: boolean; is_demo: boolean;
  /** Link do Google Maps do local (vai no anúncio de frete). */
  link_mapa?: string | null;
}

export interface Perfil {
  id: string; nome: string; email: string | null; telefone?: string | null; papel: Papel; status: StatusUsuario;
  comercial_id: string | null; criado_em: string;
}

export interface Embarque {
  id: string; codigo: number;
  cliente_id: string; comercial_id: string | null; filial_id: string; produto_id: string | null;
  origem_cidade: string; origem_uf: string | null; local_coleta_id: string | null;
  destino_cidade: string; destino_uf: string | null; local_entrega_id: string | null;
  status_liberacao: StatusLiberacao; data_liberacao: string | null;
  cadencia_valor: number | null; cadencia_unidade: UnidadeCadencia;
  toneladas_por_veiculo: number; observacao_interna: string | null; situacao: Situacao;
  is_demo: boolean; chave_importacao: string | null; versao: number;
  atualizado_em: string; atualizado_por_nome: string | null;
  /** Quem cadastrou (pode alterar a meta com a permissão "dos embarques que criei"). */
  criado_por?: string | null;
  /** Quando foi suspenso (o banco encerra sozinho após 7 dias sem reativação). */
  suspenso_em?: string | null;
  /** Encerrado: arquivado de vez, sem reativação. */
  encerrado_em?: string | null; encerrado_por_nome?: string | null; encerrado_motivo?: string | null;
}

export interface Financeiro {
  embarque_id: string; frete_empresa: number | null; frete_motorista: number | null;
  unidade_frete: UnidadeFrete; frete_empresa_original: string | null; frete_motorista_original: string | null;
  versao: number; atualizado_em: string;
}

export interface Posicao {
  id: string; embarque_id: string; data_operacional: string;
  porta: number | null; transito: number | null; carregados: number | null;
  toneladas_por_veiculo: number; meta_valor: number | null; meta_unidade: UnidadeCadencia;
  obs_operacional: string | null; obs_cliente: string | null; is_demo: boolean;
  origem: 'app' | 'abertura' | 'importacao'; versao: number;
  atualizado_em: string; atualizado_por_nome: string | null;
  /** Última conferência explícita dos contadores (salvar ou confirmar sem alteração). Abertura e importação não contam. */
  confirmado_em?: string | null; confirmado_por_nome?: string | null;
}

export interface Historico {
  id: number; entidade: string; registro_id: string | null; embarque_id: string | null; posicao_id: string | null;
  cliente_id: string | null; data_operacional: string | null; campo: string;
  valor_anterior: string | null; valor_novo: string | null; sensivel: boolean; origem: string;
  usuario_nome: string | null; alterado_em: string;
}

export interface LinkCliente {
  id: string; cliente_id: string; token_prefixo: string; descricao: string | null;
  mostrar_carregados: boolean; mostrar_volumes: boolean; expira_em: string; revogado_em: string | null;
  ultimo_acesso_em: string | null; acessos: number; criado_em: string;
}

export interface MetaDiaria {
  data_operacional: string; is_demo: boolean; meta_faturamento: number | null; meta_margem: number | null;
  meta_volume_t: number | null; observacao: string | null;
}

export interface Configuracoes {
  capacidade_padrao_t: number;
  meta_veiculos_lote_padrao: number;
  cadencia_unidade_padrao: UnidadeCadencia;
  ticket_inclui_frete_zero: boolean;
  link_validade_padrao_horas: number;
  /** Logo da Transpanorama (data:image/...) no quadro enviado ao cliente. */
  logo_empresa: string | null;
}

export const CONFIG_PADRAO: Configuracoes = {
  capacidade_padrao_t: 40,
  meta_veiculos_lote_padrao: 2,
  cadencia_unidade_padrao: 'veiculos_dia',
  ticket_inclui_frete_zero: true,
  link_validade_padrao_horas: 72,
  logo_empresa: null,
};

export interface Conflito {
  campo: string; rotulo: string; valor_base: unknown; valor_atual: unknown; valor_proposto: unknown;
}

export type ResultadoGravacao<T> =
  | { status: 'ok'; registro: T }
  | { status: 'sem_alteracao'; registro: T }
  | { status: 'conflito'; conflitos: Conflito[]; registro: T };

/** Linha da Lista de Fretes: embarque + posição da data (se existir) + financeiro (se autorizado). */
export interface LinhaFrete {
  embarque: Embarque;
  posicao: Posicao | null;
  financeiro: Financeiro | null;
}

export interface Sessao {
  perfil: Perfil;
  permissoes: Set<Permissao>;
  filiais: string[];
}

export interface PosicaoPublica {
  status: 'ok' | 'invalido' | 'revogado' | 'expirado';
  cliente?: string;
  demonstrativo?: boolean;
  data_operacional?: string | null;
  atualizado_em?: string | null;
  consultado_em?: string;
  link_expira_em?: string;
  mostrar_carregados?: boolean;
  mostrar_volumes?: boolean;
  itens?: Array<{
    origem: string; coleta?: string; destino: string; entrega?: string; produto?: string;
    porta?: number; transito?: number; carregados?: number;
    volume_porta_t?: number; volume_transito_t?: number; volume_carregado_t?: number;
    observacao?: string; embarques: number;
  }>;
}

// ---------------------------------------------------------------------------
// Documentação / Apoio Operacional (migração 1610)
// ---------------------------------------------------------------------------
export type TipoSolicitacaoDoc = 'lote_emissao' | 'emissao' | 'cadastro' | 'estadia';
export type StatusDoc = 'enviado' | 'em_atendimento' | 'aguardando_informacao' | 'correcao_recebida' | 'documentacao_disponivel' | 'cadastro_concluido'
  // Estadia (migração 2000)
  | 'aguardando_cliente' | 'pago_pendencia' | 'aprovada' | 'aprovada_parcial' | 'encerrado'
  | 'cancelado';
/** Motivo da devolução (pedir ajuste); 'sem_registro' só em pendências anteriores à migração 1900. */
export type MotivoDevolucao = 'documento_ausente' | 'documento_ilegivel' | 'divergencia_dados' | 'informacao_incompleta' | 'outro' | 'sem_registro';
export type UnidadeFreteDoc = 'rs_tonelada' | 'rs_viagem';
export type TipoOperacao = 'exportacao' | 'mi_tributado' | 'mi_isento';
export type FormaPagamento = 'cheque' | 'pagbem' | 'pix';
export type TitularPix = 'proprietario' | 'motorista';
export type Pedagio = 'sem_parar' | 'move_mais' | 'conect_car' | 'veloe' | 'nao_ha';
export type CategoriaAnexo = 'nf' | 'evidencia_frete' | 'correcao' | 'cte' | 'mdfe' | 'outro_emitido' | 'motorista' | 'veiculo'
  | 'est_documento' | 'est_nf_carga' | 'est_comprovante' | 'est_agendamento' | 'est_tratativa' | 'est_retorno' | 'est_pagamento';

/** Retrato do embarque (ou, no Cadastro, do cliente/filial/rota informados) no momento do envio. */
export interface RetratoDoc {
  codigo: number | null; cliente: string | null; carteira: string | null; filial: string | null; centro_custo: string | null;
  origem_cidade: string; origem_uf: string | null; coleta: string | null;
  destino_cidade: string; destino_uf: string | null; entrega: string | null; produto: string | null;
  lote_numero: string | null; filial_id: string | null; centro_custo_id: string | null; cliente_id: string;
}

export interface SolicitacaoDoc {
  /** Sem embarque no tipo Cadastro. */
  id: string; numero: number; embarque_id: string | null; lote_id: string | null;
  tipo: TipoSolicitacaoDoc; status: StatusDoc;
  placa: string; placas_reboque: string[];
  // Campos de emissão: vazios no tipo Cadastro (as telas de Cadastro não os leem).
  frete_empresa: number; frete_empresa_unidade: UnidadeFreteDoc; frete_motorista: number; frete_motorista_unidade: UnidadeFreteDoc;
  tipo_operacao: TipoOperacao | null; forma_pagamento: FormaPagamento; pedagio: Pedagio;
  /** Só com PIX: de quem é a chave e a chave informada. */
  pix_titular?: TitularPix | null; pix_chave?: string | null;
  exige_obs_cte: boolean; obs_cte: string | null; cte_por_nf: boolean; observacoes: string | null;
  retrato: RetratoDoc;
  // Campos do Cadastro (migração 1700); nulos nos tipos de emissão.
  filial_id?: string | null; comercial_id?: string | null; cliente_id?: string | null; telefone_motorista?: string | null;
  mercadoria?: string | null; valor_carga?: number | null; origem_cidade?: string | null; origem_uf?: string | null;
  destino_cidade?: string | null; destino_uf?: string | null; primeiro_embarque?: boolean | null;
  erp_referencia?: string | null; retorno_solicitante?: string | null;
  // Campos da Estadia (migração 2000); nulos nos demais tipos.
  est_codigo?: string | null; est_tipo_documento?: TipoDocEstadia | null; est_documentos?: string[] | null; est_nfs_carga?: string[] | null;
  est_sindicato?: boolean | null; est_sindicato_nome?: string | null; est_inicio?: string | null; est_saida?: string | null;
  est_tarifa?: number | null; est_peso_t?: number | null; est_peso_informado?: number | null; est_peso_unidade?: 't' | 'kg' | null;
  est_motivo?: MotivoEstadia | null; est_motivo_outro?: string | null; est_modalidade?: ModalidadeEstadia | null;
  est_acordo_valor?: number | null; est_acordo_confirmado_por?: string | null; est_acordo_data?: string | null; est_acordo_descricao?: string | null;
  est_conferencia_id?: string | null; est_conferencia_versao?: number | null; est_limite_h?: number | null; est_retroagir_h?: number | null;
  est_horas_validas?: number | null; est_valor_calculado?: number | null; est_conferido_em?: string | null; est_conferido_por_nome?: string | null;
  est_encaminhado_em?: string | null; est_resultado?: ResultadoEstadia | null; est_valor_aprovado?: number | null; est_retorno_em?: string | null;
  est_valor_pago?: number | null; est_pago_em?: string | null; est_encerrado_motivo?: string | null;
  solicitante_id: string; solicitante_nome: string; responsavel_id: string | null; responsavel_nome: string | null;
  enviado_em: string; assumido_em: string | null; concluido_em: string | null; concluido_por_nome: string | null;
  cancelado_em: string | null; cancelado_por_nome: string | null; cancelado_motivo: string | null;
  versao: number; atualizado_em: string;
  /** Nomes dos arquivos de NF (para a busca da fila); preenchido na listagem. */
  nomes_nf?: string[];
}

export interface LoteErp {
  id: string; embarque_id: string; numero: string; solicitacao_id: string | null;
  registrado_por_nome: string; registrado_em: string; versao: number; atualizado_em: string;
}

export interface MensagemDoc {
  id: string; solicitacao_id: string; tipo: 'pendencia' | 'resposta' | 'evento'; texto: string; referencia: string | null;
  autor_id: string | null; autor_nome: string; criado_em: string;
  motivo?: MotivoDevolucao | null; motivo_outro?: string | null;
}

export interface AnexoDoc {
  id: string; solicitacao_id: string; categoria: CategoriaAnexo; caminho: string; nome: string; tipo_mime: string; tamanho: number;
  mensagem_id: string | null; enviado_por_nome: string; enviado_em: string;
}

export interface NotificacaoApp {
  id: string; tipo: 'ajuste_solicitado' | 'documentacao_disponivel' | 'resposta_enviada' | 'cadastro_concluido' | 'estadia_atualizada'; titulo: string; texto: string;
  solicitacao_id: string; embarque_id: string | null; destino: 'embarque' | 'apoio' | 'cadastro' | 'estadia'; criada_em: string; lida_em: string | null;
}

/** Dados do formulário (os do embarque vêm sozinhos, pelo servidor). */
export interface DadosSolicitacaoDoc {
  placa: string; placas_reboque: string[];
  frete_empresa: number; frete_empresa_unidade: UnidadeFreteDoc; frete_motorista: number; frete_motorista_unidade: UnidadeFreteDoc;
  tipo_operacao: TipoOperacao | null; forma_pagamento: FormaPagamento; pedagio: Pedagio;
  /** Só com PIX: de quem é a chave e a chave informada. */
  pix_titular?: TitularPix | null; pix_chave?: string | null;
  exige_obs_cte: boolean; obs_cte: string | null; cte_por_nf: boolean; observacoes: string | null; chave_envio: string;
}

/** Formulário da aba Cadastro (solicitante vem da sessão). */
export interface DadosCadastroDoc {
  placa: string; telefone_motorista: string; mercadoria: string; cliente_id: string; valor_carga: number;
  origem_cidade: string; origem_uf: string; destino_cidade: string; destino_uf: string;
  observacoes: string | null; primeiro_embarque: boolean; filial_id: string | null; chave_envio: string;
}

// ---------------------------------------------------------------------------
// Estadia (migração 2000)
// ---------------------------------------------------------------------------
export type TipoDocEstadia = 'cte' | 'nfs';
export type MotivoEstadia = 'demora_descarga' | 'redirecionamento' | 'agendamento_alongado' | 'troca_nota' | 'falta_cota' | 'outro';
export type ModalidadeEstadia = 'padrao' | 'acordo';
export type ResultadoEstadia = 'aprovada' | 'aprovada_parcial' | 'rejeitada';

/** Formulário Envio de Estadia. Números como texto (zeros à esquerda valem); peso na unidade escolhida. */
export interface DadosEstadia {
  tipo_documento: TipoDocEstadia; documentos: string[]; placa: string; cliente_id: string; nfs_carga: string[];
  sindicato: boolean; sindicato_nome: string | null; inicio: string; saida: string;
  tarifa: number; peso: number; peso_unidade: 't' | 'kg'; motivo: MotivoEstadia; motivo_outro: string | null;
  modalidade: ModalidadeEstadia; acordo_valor: number | null; acordo_confirmado_por: string | null; acordo_data: string | null;
  acordo_descricao: string | null; observacoes: string | null; filial_id: string | null; chave_envio: string;
  confirmar_duplicidade?: boolean;
}

/** Cada vez que o apoio salva a memória de cálculo nasce uma versão. */
export interface ConferenciaEstadia {
  id: string; solicitacao_id: string; versao: number; inicio: string; saida: string; tarifa: number; peso_t: number;
  limite_h: number; retroagir_h: number; permanencia_h: number; horas_validas: number; valor: number;
  alteracoes: Record<string, { original: unknown; usado: unknown }>; observacao: string | null; autor_nome: string; criado_em: string;
}
export interface RetornoEstadia {
  id: string; solicitacao_id: string; resultado: ResultadoEstadia; valor_aprovado: number | null; justificativa: string; data_retorno: string;
  conferencia_id: string; valor_calculado: number; status_anterior: StatusDoc; status_novo: StatusDoc; mensagem_id: string | null;
  autor_nome: string; criado_em: string;
}
export interface PagamentoEstadia {
  id: string; solicitacao_id: string; valor_pago: number; data_pagamento: string; observacao: string | null;
  conferencia_id: string | null; mensagem_id: string | null; autor_nome: string; criado_em: string;
}
export interface DuplicadaEstadia {
  id: string | null; codigo: string; placa: string; inicio: string; saida: string; status: StatusDoc; motivo: 'periodo' | 'documento';
}
export interface ParametrosConferencia {
  limite_h: number; retroagir_h: number; tarifa?: number; peso_t?: number; inicio?: string; saida?: string; observacao?: string | null;
}
