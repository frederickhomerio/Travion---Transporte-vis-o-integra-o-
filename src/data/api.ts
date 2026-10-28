// Contrato da camada de dados. Duas implementações:
//  - supabaseApi: produção (PostgreSQL + RLS + Realtime no Supabase);
//  - localApi: prévia local sem servidor, só com dados fictícios, para conhecer as telas.

import type { Cadastros } from '../lib/cadastros';
import type { DadosPainel } from '../lib/painelOperacional';
import type {
  AnexoDoc, CategoriaAnexo, ConferenciaEstadia, DadosCadastroDoc, DadosEstadia, DuplicadaEstadia, PagamentoEstadia, ParametrosConferencia,
  ResultadoEstadia, RetornoEstadia, DadosSolicitacaoDoc, LoteErp, MotivoDevolucao, StatusDoc, MensagemDoc, NotificacaoApp, SolicitacaoDoc,
  Configuracoes, DadosCnpj, Embarque, Financeiro, Historico, LinkCliente, MetaDiaria, Papel, Perfil, Permissao,
  Posicao, PosicaoPublica, ResultadoGravacao, Sessao, StatusUsuario,
} from '../types';

export interface ContadoresPosicao { porta: number; transito: number; carregados: number }

export type EstadoConexao = 'conectando' | 'conectado' | 'reconectando' | 'offline';

export type EventoTempoReal =
  | { tabela: 'posicoes_diarias'; tipo: 'INSERT' | 'UPDATE'; registro: Posicao }
  | { tabela: 'embarques'; tipo: 'INSERT' | 'UPDATE'; registro: Embarque }
  | { tabela: 'embarque_financeiro'; tipo: 'INSERT' | 'UPDATE'; registro: Financeiro }
  | { tabela: 'recarregar'; tipo: 'TUDO' };

/** Usuário na tela Permissões: só o necessário para escolher e as exceções ao padrão da função. */
export type UsuarioPermissoes = Pick<Perfil, 'id' | 'nome' | 'email' | 'papel' | 'status'> & { permissoes: Partial<Record<Permissao, boolean>> };

export interface UsuarioAdmin extends Perfil {
  filiais: string[];
  permissoes: Partial<Record<Permissao, boolean>>;
}

export interface Convite {
  id: string; email: string; nome: string | null; papel: Papel; comercial_id: string | null;
  filiais: string[]; permissoes: Record<string, boolean>; expira_em: string; usado_em: string | null; criado_em: string;
}

export interface MatrizPermissoes {
  catalogo: Array<{ chave: Permissao; grupo: string; descricao: string }>;
  papeis: Array<{ papel: Papel; chave: Permissao }>;
}

export interface RelatorioImportacao {
  clientes_criados: number; comerciais_criados: number; embarques_criados: number; embarques_vinculados: number;
  posicoes_criadas: number; posicoes_atualizadas: number; posicoes_iguais: number; posicoes_divergentes: number;
  avisos: string[]; arquivo_ja_importado: boolean; importacao_id: string; financeiro_importado: boolean;
}

export interface ResultadoAbertura { criadas: number; ja_existiam: number; sem_posicao_anterior: number }

export interface LogoCandidata { url: string; origem: string; dataUrl: string }
/** Cotação diária da CNA (Preços das Commodities), já convertida para R$/kg quando a unidade permite. */
export interface CotacaoCna {
  produto: string; unidade: string; uf: string; praca: string; data: string;
  valor: number; valor_kg: number | null; variacao_mensal: number | null;
}

export type TipoCadastro = 'filial' | 'centro_custo' | 'comercial' | 'produto' | 'local' | 'cidade' | 'cliente';

export interface ArquivoDoc { caminho: string; nome: string; categoria: CategoriaAnexo }
export interface ResultadoDoc {
  status: 'ok' | 'inicial_aberta' | 'ja_assumida' | 'indisponivel' | 'sem_alteracao' | 'cadastro_aberto' | 'possivel_duplicidade';
  registro: SolicitacaoDoc; lote?: LoteErp; repetido?: boolean;
  /** Em 'possivel_duplicidade' (Estadia): o que parece repetido; nada foi gravado. */
  duplicadas?: DuplicadaEstadia[];
  conferencia?: ConferenciaEstadia;
  /** Em 'cadastro_aberto': número e situação do cadastro já aberto para a placa (o registro vem nulo se estiver fora do seu alcance). */
  numero?: number; situacao?: StatusDoc;
}
export interface DadosDetalheDoc {
  mensagens: MensagemDoc[]; anexos: AnexoDoc[];
  /** Só no tipo Estadia: versões do cálculo, retornos do cliente e pagamentos informados. */
  estadia?: { conferencias: ConferenciaEstadia[]; retornos: RetornoEstadia[]; pagamentos: PagamentoEstadia[] };
}
export interface DadosRetornoEstadia { resultado: ResultadoEstadia; valor_aprovado: number | null; justificativa: string; data_retorno: string }
export interface DadosPagamentoEstadia { valor_pago: number; data_pagamento: string; observacao: string | null }
export type EventoDoc = { tabela: 'solicitacoes' | 'lotes' | 'notificacoes' | 'detalhe'; id?: string };

/** Documentação / Apoio Operacional. Toda regra é conferida no servidor (migração 1610). */
export interface ApiDoc {
  /** Solicitações e lotes visíveis. `desde`: só o que mudou a partir desse instante (ISO). */
  listar(desde: string | null): Promise<{ solicitacoes: SolicitacaoDoc[]; lotes: LoteErp[] }>;
  listarDoEmbarque(embarqueId: string): Promise<{ solicitacoes: SolicitacaoDoc[]; lotes: LoteErp[] }>;
  /** Mensagens e anexos da solicitação (Emissão traz também as evidências da solicitação que abriu o lote). */
  detalhe(id: string): Promise<DadosDetalheDoc>;
  /** `cadastro`: aceita os formatos do Cadastro (até 10 MB) em vez de PDF/imagem até 15 MB. */
  enviarArquivo(arquivo: File, cadastro?: boolean): Promise<{ caminho: string; nome: string }>;
  baixar(caminho: string): Promise<Blob>;
  criar(embarqueId: string, dados: DadosSolicitacaoDoc, anexos: ArquivoDoc[]): Promise<ResultadoDoc>;
  assumir(id: string): Promise<ResultadoDoc>;
  registrarLote(id: string, numero: string): Promise<ResultadoDoc>;
  /** Motivo obrigatório; `motivoOutro` é a descrição quando o motivo é 'outro'. */
  solicitarAjuste(id: string, texto: string, referencia: string | null, motivo: MotivoDevolucao, motivoOutro: string | null): Promise<ResultadoDoc>;
  /** Responsável retoma o atendimento depois que a correção chegou (Correção recebida → Em atendimento). */
  retomar(id: string): Promise<ResultadoDoc>;
  /** Painel Operacional (migração 1900): chamados enviados em [desde, ate) ou ainda abertos, e seus eventos. */
  painel(desde: string, ate: string, alteradosDesde: string | null): Promise<DadosPainel>;
  responder(id: string, texto: string, anexos: ArquivoDoc[]): Promise<ResultadoDoc>;
  anexarEmitidos(id: string, anexos: ArquivoDoc[]): Promise<ResultadoDoc>;
  concluir(id: string): Promise<ResultadoDoc>;
  cancelar(id: string, motivo: string): Promise<ResultadoDoc>;
  /** Aba Cadastro (migração 1700). */
  criarCadastro(dados: DadosCadastroDoc, anexos: ArquivoDoc[]): Promise<ResultadoDoc>;
  concluirCadastro(id: string, referencia: string | null, retorno: string | null): Promise<ResultadoDoc>;
  /** Aba Estadia (migração 2000). `versao`: a que a tela mostrava (conflito se outra pessoa alterou antes). */
  criarEstadia(dados: DadosEstadia, anexos: ArquivoDoc[]): Promise<ResultadoDoc>;
  conferirEstadia(id: string, parametros: ParametrosConferencia, versao: number | null): Promise<ResultadoDoc>;
  encaminharClienteEstadia(id: string, observacao: string | null, versao: number | null): Promise<ResultadoDoc>;
  registrarRetornoEstadia(id: string, dados: DadosRetornoEstadia, anexos: ArquivoDoc[], versao: number | null): Promise<ResultadoDoc>;
  registrarPagamentoEstadia(id: string, dados: DadosPagamentoEstadia, anexos: ArquivoDoc[], versao: number | null): Promise<ResultadoDoc>;
  encerrarEstadia(id: string, motivo: string, versao: number | null): Promise<ResultadoDoc>;
  reabrirEstadia(id: string, motivo: string): Promise<ResultadoDoc>;
  /** Consultar Estadia: por placa ou número do CT-e (dentro do que a pessoa pode ver). */
  buscarEstadias(campo: 'placa' | 'cte', valor: string): Promise<SolicitacaoDoc[]>;
  notificacoes(): Promise<NotificacaoApp[]>;
  marcarLidas(ids: string[] | null): Promise<void>;
  /** Tempo real; `aoEstado(true)` só depois da confirmação da assinatura. */
  assinar(aoEvento: (e: EventoDoc) => void, aoEstado: (ativo: boolean) => void): () => void;
}

export interface Api {
  readonly modo: 'supabase' | 'local';
  readonly doc: ApiDoc;

  // Autenticação
  sessaoAtual(): Promise<Sessao | null>;
  entrar(email: string, senha: string): Promise<void>;
  cadastrar(nome: string, email: string, senha: string): Promise<{ confirmarEmail: boolean }>;
  recuperarSenha(email: string): Promise<void>;
  definirNovaSenha(senha: string): Promise<void>;
  sair(): Promise<void>;
  aoMudarAutenticacao(cb: (evento: string) => void): () => void;

  // Leitura (sempre filtrada pelo RLS no servidor)
  carregarCadastros(demo: boolean): Promise<Cadastros>;
  carregarConfiguracoes(): Promise<Configuracoes>;
  carregarEmbarques(demo: boolean): Promise<Embarque[]>;
  carregarPosicoes(demo: boolean, inicio: string, fim: string): Promise<Posicao[]>;
  carregarFinanceiro(demo: boolean): Promise<Financeiro[]>;
  carregarHistorico(embarqueId: string): Promise<Historico[]>;
  carregarMeta(demo: boolean, data: string): Promise<MetaDiaria | null>;
  ultimaDataComPosicao(demo: boolean, antesDe: string): Promise<string | null>;
  dadosOrigem(embarqueId: string): Promise<Record<string, unknown> | null>;

  // Gravação (funções do servidor; conferem permissão e versão)
  atualizarPosicao(id: string, alteracoes: Partial<Posicao>, base: Partial<Posicao>, forcar?: boolean): Promise<ResultadoGravacao<Posicao>>;
  /** Salva os três contadores de hoje numa só operação (ou confirma sem alteração). Conflito se algum mudou desde `base`. */
  confirmarPosicao(id: string, valores: ContadoresPosicao, base: Partial<Record<keyof ContadoresPosicao, number | null>>): Promise<ResultadoGravacao<Posicao>>;
  /** Horário do servidor (ISO), referência da janela de duas horas. */
  agoraServidor(): Promise<string>;
  atualizarEmbarque(id: string, alteracoes: Partial<Embarque>, base: Partial<Embarque>, forcar?: boolean): Promise<ResultadoGravacao<Embarque> & { posicoes_atualizadas?: number }>;
  /** Encerra de vez (arquivado sem reativação). Só gestor e administrador. */
  encerrarEmbarque(id: string, motivo: string | null): Promise<Embarque>;
  atualizarFinanceiro(embarqueId: string, alteracoes: Partial<Financeiro>, base: Partial<Financeiro>, forcar?: boolean): Promise<ResultadoGravacao<Financeiro>>;
  criarEmbarque(dados: Record<string, unknown>, demo: boolean): Promise<Embarque>;
  abrirPosicoes(data: string, transportar: boolean, embarqueIds: string[] | null, demo: boolean): Promise<ResultadoAbertura>;
  salvarCadastro(tipo: TipoCadastro, id: string | null, dados: Record<string, unknown>, demo: boolean): Promise<unknown>;
  /** Reaproveita o local (coleta/entrega) com o mesmo nome na mesma cidade ou cria um novo. */
  obterLocal(nome: string, cidade: string | null, uf: string | null, tipo: 'coleta' | 'entrega', demo: boolean): Promise<string | null>;
  /** Reaproveita a cidade com o mesmo nome e UF ou cria uma nova. */
  obterCidade(nome: string, uf: string | null, demo: boolean): Promise<string | null>;
  /** Consulta dados públicos do CNPJ (Receita Federal e inscrição estadual). */
  consultarCnpj(cnpj: string): Promise<DadosCnpj>;
  /** Procura a logo no site da empresa e devolve as imagens candidatas já baixadas. */
  buscarLogos(site: string, nome?: string): Promise<LogoCandidata[]>;
  precoCna(produto: string): Promise<{ produtos: string[]; cotacoes: CotacaoCna[] }>;
  salvarConfiguracao(chave: keyof Configuracoes, valor: unknown): Promise<void>;
  salvarMeta(meta: MetaDiaria): Promise<void>;

  // Compartilhamento
  listarLinks(clienteId: string): Promise<LinkCliente[]>;
  criarLink(clienteId: string, horas: number, carregados: boolean, volumes: boolean, descricao: string | null): Promise<{ id: string; token: string; expira_em: string }>;
  revogarLink(id: string): Promise<void>;
  posicaoPublica(token: string): Promise<PosicaoPublica>;

  // Importação
  importarPlanilha(payload: Record<string, unknown>): Promise<RelatorioImportacao>;
  embarquesPorChave(chaves: string[], demo: boolean): Promise<Array<Pick<Embarque, 'id' | 'codigo' | 'chave_importacao'>>>;

  // Administração
  listarUsuarios(): Promise<UsuarioAdmin[]>;
  atualizarUsuario(id: string, dados: { nome?: string; papel?: Papel; status?: StatusUsuario; comercial_id?: string | null; filiais?: string[]; permissoes?: Record<string, boolean | null> }): Promise<void>;
  listarConvites(): Promise<Convite[]>;
  criarConvite(dados: { email: string; nome?: string; papel: Papel; comercial_id?: string | null; filiais: string[] }): Promise<void>;
  excluirConvite(id: string): Promise<void>;
  /** Manda por e-mail o convite já registrado (o link leva à tela de criar a senha). */
  enviarConviteEmail(email: string): Promise<void>;
  /** Manda à pessoa o link de troca de senha (o mesmo do "Esqueci a senha"). */
  enviarLinkSenha(email: string): Promise<void>;
  /** Trata o link do e-mail de convite ao abrir o app; devolve 'convite' quando a pessoa precisa criar a senha. */
  confirmarLinkEmail(): Promise<'convite' | null>;
  matrizPermissoes(): Promise<MatrizPermissoes>;
  salvarPermissaoPapel(papel: Papel, chave: Permissao, permitido: boolean): Promise<void>;
  /** Permissões por usuário (Administrador e Gestor, via permissoes.gerenciar). */
  listarPermissoesUsuarios(): Promise<UsuarioPermissoes[]>;
  /** true permite, false nega, null volta ao padrão da função. Devolve as exceções que ficaram. */
  salvarPermissoesUsuario(id: string, permissoes: Partial<Record<Permissao, boolean | null>>): Promise<Partial<Record<Permissao, boolean>>>;
  carregarDadosDemo(): Promise<void>;
  limparDadosDemo(): Promise<void>;

  // Tempo real
  assinar(aoEvento: (e: EventoTempoReal) => void, aoEstado: (s: EstadoConexao) => void): () => void;
}

/** Mensagem amigável para erros de rede/servidor. */
export function mensagemErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
    return 'Sem conexão com o servidor. Nada foi salvo. Verifique a internet e tente novamente.';
  }
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link enviado antes de entrar.';
  if (/User already registered/i.test(msg)) return 'Já existe uma conta com este e-mail.';
  if (/Password should be at least/i.test(msg)) return 'A senha deve ter pelo menos 8 caracteres.';
  if (/permission denied/i.test(msg)) return 'Acesso negado pelo servidor.';
  return msg || 'Erro inesperado.';
}
