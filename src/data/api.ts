// Contrato da camada de dados. Duas implementações:
//  - supabaseApi: produção (PostgreSQL + RLS + Realtime no Supabase);
//  - localApi: prévia local sem servidor, só com dados fictícios, para conhecer as telas.

import type { Cadastros } from '../lib/cadastros';
import type {
  Configuracoes, Embarque, Financeiro, Historico, LinkCliente, MetaDiaria, Papel, Perfil, Permissao,
  Posicao, PosicaoPublica, ResultadoGravacao, Sessao, StatusUsuario,
} from '../types';

export type EstadoConexao = 'conectando' | 'conectado' | 'reconectando' | 'offline';

export type EventoTempoReal =
  | { tabela: 'posicoes_diarias'; tipo: 'INSERT' | 'UPDATE'; registro: Posicao }
  | { tabela: 'embarques'; tipo: 'INSERT' | 'UPDATE'; registro: Embarque }
  | { tabela: 'embarque_financeiro'; tipo: 'INSERT' | 'UPDATE'; registro: Financeiro }
  | { tabela: 'recarregar'; tipo: 'TUDO' };

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

export type TipoCadastro = 'filial' | 'comercial' | 'produto' | 'local' | 'cliente';

export interface Api {
  readonly modo: 'supabase' | 'local';

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
  atualizarEmbarque(id: string, alteracoes: Partial<Embarque>, base: Partial<Embarque>, forcar?: boolean): Promise<ResultadoGravacao<Embarque> & { posicoes_atualizadas?: number }>;
  atualizarFinanceiro(embarqueId: string, alteracoes: Partial<Financeiro>, base: Partial<Financeiro>, forcar?: boolean): Promise<ResultadoGravacao<Financeiro>>;
  criarEmbarque(dados: Record<string, unknown>, demo: boolean): Promise<Embarque>;
  abrirPosicoes(data: string, transportar: boolean, embarqueIds: string[] | null, demo: boolean): Promise<ResultadoAbertura>;
  salvarCadastro(tipo: TipoCadastro, id: string | null, dados: Record<string, unknown>, demo: boolean): Promise<unknown>;
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
  matrizPermissoes(): Promise<MatrizPermissoes>;
  salvarPermissaoPapel(papel: Papel, chave: Permissao, permitido: boolean): Promise<void>;
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
