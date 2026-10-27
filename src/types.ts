// Tipos espelhando as tabelas do banco (supabase/migrations).

export type Papel = 'administrador' | 'gestor' | 'supervisor' | 'embarcador' | 'operacao' | 'comercial' | 'consulta';
export type StatusUsuario = 'pendente' | 'ativo' | 'bloqueado';
export type StatusLiberacao = 'liberado' | 'suspenso' | 'nao_informado';
export type Situacao = 'ativo' | 'arquivado';
export type UnidadeFrete = 'nao_confirmada' | 'rs_tonelada' | 'rs_viagem' | 'outra';
export type UnidadeCadencia = 'veiculos_dia' | 'toneladas_dia';
export type TipoLocal = 'coleta' | 'entrega' | 'ambos';

export type Permissao =
  | 'embarques.ver' | 'embarques.criar' | 'embarques.editar_cadastro' | 'embarques.liberar'
  | 'embarques.editar_cadencia' | 'embarques.editar_capacidade' | 'embarques.arquivar' | 'embarques.encerrar'
  | 'carteira.editar' | 'posicoes.pagina' | 'posicoes.abrir' | 'posicoes.editar_contadores'
  | 'posicoes.editar_obs_operacional' | 'posicoes.editar_obs_cliente'
  | 'financeiro.ver' | 'financeiro.editar' | 'historico.ver'
  | 'compartilhamento.preparar' | 'compartilhamento.links'
  | 'importacao.executar' | 'cadastros.gerenciar' | 'usuarios.gerenciar' | 'configuracoes.gerenciar';

export interface Filial { id: string; nome: string; codigo: string | null; supervisor?: string | null; centro_custo_id?: string | null; ativo: boolean; is_demo: boolean }
export interface CentroCusto { id: string; nome: string; ativo: boolean; is_demo: boolean }
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
  id: string; nome: string; email: string | null; papel: Papel; status: StatusUsuario;
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
