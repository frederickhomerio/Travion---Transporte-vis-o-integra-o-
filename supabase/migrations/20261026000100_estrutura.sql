-- Travion — estrutura de dados
-- Cadastro do embarque (lote), posição operacional diária e histórico ficam em tabelas separadas.
-- Valores financeiros ficam em tabela própria para que o RLS controle quem pode vê-los.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.papel_usuario as enum ('administrador', 'gestor', 'operacao', 'comercial', 'consulta');
create type public.status_usuario as enum ('pendente', 'ativo', 'bloqueado');
create type public.status_liberacao as enum ('liberado', 'suspenso', 'nao_informado');
create type public.situacao_cadastral as enum ('ativo', 'arquivado');
create type public.unidade_frete as enum ('nao_confirmada', 'rs_tonelada', 'rs_viagem', 'outra');
create type public.unidade_cadencia as enum ('veiculos_dia', 'toneladas_dia');
create type public.tipo_local as enum ('coleta', 'entrega', 'ambos');

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------

-- Normaliza texto para comparação: sem acentos, maiúsculas, espaços simples.
create or replace function private.normalizar(p text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      upper(translate(trim(coalesce(p, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
      '\s+', ' ', 'g'),
    '')
$$;

-- Data operacional de hoje no fuso America/Sao_Paulo.
create or replace function private.hoje_sp()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- ---------------------------------------------------------------------------
-- Cadastros auxiliares
-- ---------------------------------------------------------------------------
create table public.filiais (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  nome_busca text generated always as (private.normalizar(nome)) stored,
  codigo text,
  ativo boolean not null default true,
  is_demo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (nome_busca, is_demo)
);

create table public.comerciais (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  nome_busca text generated always as (private.normalizar(nome)) stored,
  email text,
  ativo boolean not null default true,
  is_demo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (nome_busca, is_demo)
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  nome_busca text generated always as (private.normalizar(nome)) stored,
  documento text,
  comercial_id uuid references public.comerciais (id),
  -- Ex.: "NÃO CARREGAR" vindo da aba Clientes. Informativo; não bloqueia nada nesta versão.
  restricao_comercial text,
  ativo boolean not null default true,
  is_demo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (nome_busca, is_demo)
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  nome_busca text generated always as (private.normalizar(nome)) stored,
  ativo boolean not null default true,
  is_demo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (nome_busca, is_demo)
);

-- Locais de coleta (carregamento) e entrega (descarga).
-- O mesmo nome pode existir em cidades diferentes (ex.: "COMIGO"), por isso a cidade faz parte da chave.
create table public.locais (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  nome_busca text generated always as (private.normalizar(nome)) stored,
  cidade text,
  cidade_busca text generated always as (coalesce(private.normalizar(cidade), '')) stored,
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  tipo public.tipo_local not null default 'ambos',
  ativo boolean not null default true,
  is_demo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (nome_busca, cidade_busca, is_demo)
);

-- ---------------------------------------------------------------------------
-- Usuários e permissões
-- ---------------------------------------------------------------------------
create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text,
  papel public.papel_usuario not null default 'consulta',
  status public.status_usuario not null default 'pendente',
  comercial_id uuid references public.comerciais (id),
  aprovado_por uuid references public.perfis (id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index perfis_comercial_unico on public.perfis (comercial_id) where comercial_id is not null;

create table public.perfil_filiais (
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  filial_id uuid not null references public.filiais (id) on delete cascade,
  primary key (perfil_id, filial_id)
);

-- Catálogo de permissões.
create table public.permissoes (
  chave text primary key,
  grupo text not null,
  descricao text not null
);

-- Matriz padrão por papel (presença = permitido). Ajustável pelo administrador.
create table public.papel_permissoes (
  papel public.papel_usuario not null,
  chave text not null references public.permissoes (chave) on delete cascade,
  primary key (papel, chave)
);

-- Exceções por usuário: permitido=true concede, permitido=false retira.
create table public.perfil_permissoes (
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  chave text not null references public.permissoes (chave) on delete cascade,
  permitido boolean not null,
  primary key (perfil_id, chave)
);

-- Convites: quando alguém se cadastra com este e-mail, recebe o acesso definido aqui.
create table public.convites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nome text,
  papel public.papel_usuario not null,
  comercial_id uuid references public.comerciais (id),
  filiais uuid[] not null default '{}',
  permissoes jsonb not null default '{}',
  expira_em timestamptz not null default now() + interval '14 days',
  usado_em timestamptz,
  usado_por uuid,
  criado_por uuid references public.perfis (id),
  criado_em timestamptz not null default now()
);

create unique index convites_email_aberto on public.convites (lower(email)) where usado_em is null;

-- ---------------------------------------------------------------------------
-- Configurações
-- ---------------------------------------------------------------------------
create table public.configuracoes (
  chave text primary key,
  valor jsonb not null,
  descricao text not null,
  atualizado_por uuid references public.perfis (id),
  atualizado_em timestamptz not null default now()
);

-- Metas financeiras e de volume por data operacional (sem herança automática entre datas).
create table public.metas_diarias (
  data_operacional date not null,
  is_demo boolean not null default false,
  meta_faturamento numeric(14, 2) check (meta_faturamento is null or meta_faturamento >= 0),
  meta_margem numeric(14, 2),
  meta_volume_t numeric(14, 3) check (meta_volume_t is null or meta_volume_t >= 0),
  observacao text,
  atualizado_por uuid references public.perfis (id),
  atualizado_em timestamptz not null default now(),
  primary key (data_operacional, is_demo)
);

-- ---------------------------------------------------------------------------
-- Embarques (lotes)
-- ---------------------------------------------------------------------------
create table public.embarques (
  id uuid primary key default gen_random_uuid(),
  codigo bigint generated always as identity unique,
  cliente_id uuid not null references public.clientes (id),
  comercial_id uuid references public.comerciais (id),
  filial_id uuid not null references public.filiais (id),
  produto_id uuid references public.produtos (id),
  origem_cidade text not null check (length(trim(origem_cidade)) > 0),
  origem_uf text check (origem_uf is null or origem_uf ~ '^[A-Z]{2}$'),
  local_coleta_id uuid references public.locais (id),
  destino_cidade text not null check (length(trim(destino_cidade)) > 0),
  destino_uf text check (destino_uf is null or destino_uf ~ '^[A-Z]{2}$'),
  local_entrega_id uuid references public.locais (id),
  status_liberacao public.status_liberacao not null default 'nao_informado',
  data_liberacao date,
  cadencia_valor numeric(12, 3) check (cadencia_valor is null or cadencia_valor > 0),
  cadencia_unidade public.unidade_cadencia not null default 'veiculos_dia',
  toneladas_por_veiculo numeric(10, 3) not null default 40 check (toneladas_por_veiculo > 0),
  observacao_interna text,
  situacao public.situacao_cadastral not null default 'ativo',
  is_demo boolean not null default false,
  chave_importacao text,
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.perfis (id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis (id),
  atualizado_por_nome text
);

create unique index embarques_chave_importacao on public.embarques (chave_importacao, is_demo) where chave_importacao is not null;
create index embarques_cliente on public.embarques (cliente_id);
create index embarques_filial on public.embarques (filial_id);

-- Condições comerciais (financeiro). Separada para restringir leitura por RLS.
create table public.embarque_financeiro (
  embarque_id uuid primary key references public.embarques (id) on delete cascade,
  frete_empresa numeric(12, 2) check (frete_empresa is null or frete_empresa >= 0),
  frete_motorista numeric(12, 2) check (frete_motorista is null or frete_motorista >= 0),
  unidade_frete public.unidade_frete not null default 'rs_tonelada',
  frete_empresa_original text,
  frete_motorista_original text,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis (id)
);

-- Campos da planilha de origem ainda sem uso definido (área restrita de referência).
create table public.embarque_dados_origem (
  embarque_id uuid primary key references public.embarques (id) on delete cascade,
  dados jsonb not null default '{}',
  importacao_id uuid,
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Posição operacional diária
-- ---------------------------------------------------------------------------
create table public.posicoes_diarias (
  id uuid primary key default gen_random_uuid(),
  embarque_id uuid not null references public.embarques (id) on delete cascade,
  data_operacional date not null,
  -- null = não informado (diferente de zero)
  porta integer check (porta is null or porta >= 0),
  transito integer check (transito is null or transito >= 0),
  carregados integer check (carregados is null or carregados >= 0),
  -- Capacidade e meta usadas nesta data (preservadas para o histórico)
  toneladas_por_veiculo numeric(10, 3) not null check (toneladas_por_veiculo > 0),
  meta_valor numeric(12, 3) check (meta_valor is null or meta_valor > 0),
  meta_unidade public.unidade_cadencia not null default 'veiculos_dia',
  obs_operacional text,
  obs_cliente text,
  is_demo boolean not null default false,
  origem text not null default 'app' check (origem in ('app', 'abertura', 'importacao')),
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.perfis (id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis (id),
  atualizado_por_nome text,
  unique (embarque_id, data_operacional)
);

create index posicoes_data on public.posicoes_diarias (data_operacional, is_demo);

-- ---------------------------------------------------------------------------
-- Histórico de alterações (somente inserção via funções do servidor)
-- ---------------------------------------------------------------------------
create table public.historico_alteracoes (
  id bigint generated always as identity primary key,
  entidade text not null check (entidade in ('embarque', 'posicao', 'financeiro', 'cliente', 'usuario', 'configuracao', 'compartilhamento', 'importacao')),
  registro_id uuid,
  embarque_id uuid references public.embarques (id) on delete set null,
  posicao_id uuid references public.posicoes_diarias (id) on delete set null,
  cliente_id uuid references public.clientes (id) on delete set null,
  data_operacional date,
  campo text not null,
  valor_anterior text,
  valor_novo text,
  sensivel boolean not null default false,
  origem text not null default 'app',
  usuario_id uuid,
  usuario_nome text,
  alterado_em timestamptz not null default now()
);

create index historico_embarque on public.historico_alteracoes (embarque_id, alterado_em desc);
create index historico_posicao on public.historico_alteracoes (posicao_id);

-- ---------------------------------------------------------------------------
-- Compartilhamento externo (links de consulta por cliente)
-- ---------------------------------------------------------------------------
create table public.links_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  token_hash text not null unique,
  token_prefixo text not null,
  descricao text,
  mostrar_carregados boolean not null default false,
  mostrar_volumes boolean not null default false,
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid references public.perfis (id),
  ultimo_acesso_em timestamptz,
  acessos integer not null default 0,
  is_demo boolean not null default false,
  criado_por uuid references public.perfis (id),
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Importações
-- ---------------------------------------------------------------------------
create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo_nome text not null,
  arquivo_hash text not null,
  aba text not null,
  data_operacional date not null,
  is_demo boolean not null default false,
  mapeamento jsonb not null default '{}',
  relatorio jsonb not null default '{}',
  criado_por uuid references public.perfis (id),
  criado_em timestamptz not null default now()
);

create index importacoes_hash on public.importacoes (arquivo_hash, data_operacional);
