-- Cadastros v2 (27/10/2026): novos campos e regras pedidos pela coordenação comercial.
-- Clientes: CNPJ, dados da Receita/IE, logo, telefones e comercial obrigatórios.
-- Filiais: supervisor. Comerciais: telefone. Produtos: valor de pauta por kg.
-- Cidades (origem/destino) em tabela própria; locais de coleta/entrega criados ao digitar no embarque.

-- ---------------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column razao_social text,
  add column inscricao_estadual text,
  add column situacao_cadastral text,
  add column atividade_principal text,
  add column logradouro text,
  add column numero text,
  add column complemento text,
  add column bairro text,
  add column municipio text,
  add column uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column cep text,
  add column email text,
  add column telefone_cadastro text,
  add column telefone_comercial text,
  add column telefone_financeiro text,
  add column logo_url text check (logo_url is null or length(logo_url) <= 300000),
  add column dados_receita jsonb,
  add column dados_consultados_em timestamptz;

create unique index clientes_documento on public.clientes (documento, is_demo) where documento is not null;

alter table public.filiais add column supervisor text;
alter table public.comerciais add column telefone text;
alter table public.produtos
  add column valor_pauta_kg numeric(14, 4) check (valor_pauta_kg is null or valor_pauta_kg >= 0),
  add column valor_pauta_data date;

-- Cidades usadas como origem e destino dos embarques.
create table public.cidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  nome_busca text generated always as (private.normalizar(nome)) stored,
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  ativo boolean not null default true,
  is_demo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (nome_busca, uf, is_demo)
);
alter table public.cidades enable row level security;
create policy leitura on public.cidades for select to authenticated using (private.usuario_ativo());
revoke all on public.cidades from public, anon;
grant select on public.cidades to authenticated;

-- ---------------------------------------------------------------------------
-- CNPJ: só dígitos e dígitos verificadores corretos
-- ---------------------------------------------------------------------------
create or replace function private.cnpj_valido(p text)
returns boolean
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then
    return false;
  end if;
  s := 0;
  for i in 1..12 loop s := s + substr(d, i, 1)::int * pesos1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(d, 13, 1)::int then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + substr(d, i, 1)::int * pesos2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(d, 14, 1)::int;
end $$;

-- ---------------------------------------------------------------------------
-- Gravação de cadastros (substitui a versão anterior)
-- ---------------------------------------------------------------------------
create or replace function public.salvar_cadastro(p_tipo text, p_id uuid, p_dados jsonb, p_is_demo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabela text;
  v_cols text[];
  v_res jsonb;
  v_ant jsonb;
  v_restricao text;
  k text;
begin
  perform private.exigir('cadastros.gerenciar');
  case p_tipo
    when 'filial' then v_tabela := 'filiais'; v_cols := array['nome', 'codigo', 'supervisor', 'ativo'];
    when 'comercial' then v_tabela := 'comerciais'; v_cols := array['nome', 'email', 'telefone', 'ativo'];
    when 'produto' then v_tabela := 'produtos'; v_cols := array['nome', 'valor_pauta_kg', 'valor_pauta_data', 'ativo'];
    when 'local' then v_tabela := 'locais'; v_cols := array['nome', 'cidade', 'uf', 'tipo', 'ativo'];
    when 'cidade' then v_tabela := 'cidades'; v_cols := array['nome', 'uf', 'ativo'];
    when 'cliente' then v_tabela := 'clientes'; v_cols := array['nome', 'documento', 'comercial_id', 'restricao_comercial', 'ativo',
      'razao_social', 'inscricao_estadual', 'situacao_cadastral', 'atividade_principal', 'logradouro', 'numero', 'complemento',
      'bairro', 'municipio', 'uf', 'cep', 'email', 'telefone_cadastro', 'telefone_comercial', 'telefone_financeiro',
      'logo_url', 'dados_receita', 'dados_consultados_em'];
    else raise exception using errcode = '22023', message = 'Tipo de cadastro inválido.';
  end case;

  for k in select jsonb_object_keys(p_dados) loop
    if not (k = any (v_cols)) then
      raise exception using errcode = '22023', message = format('Campo "%s" não pode ser alterado neste cadastro.', k);
    end if;
  end loop;
  if p_dados ? 'nome' then
    p_dados := jsonb_set(p_dados, '{nome}', private.validar_valor('nome', 'texto_obrigatorio', p_dados -> 'nome'));
  end if;
  if p_dados ? 'uf' and jsonb_typeof(p_dados -> 'uf') = 'string' then
    p_dados := jsonb_set(p_dados, '{uf}', private.validar_valor('uf', 'uf', p_dados -> 'uf'));
  end if;
  if p_tipo = 'cliente' and p_dados ? 'documento' and jsonb_typeof(p_dados -> 'documento') = 'string' then
    p_dados := jsonb_set(p_dados, '{documento}', to_jsonb(regexp_replace(p_dados ->> 'documento', '\D', '', 'g')));
  end if;

  begin
    if p_id is null then
      if p_tipo = 'cliente' and nullif(p_dados ->> 'comercial_id', '') is not null then
        perform private.exigir('carteira.editar');
      end if;
      execute format(
        'insert into public.%I (%s, is_demo) select %s, $2 from jsonb_populate_record(null::public.%I, $1) r returning to_jsonb(%I.*)',
        v_tabela,
        (select string_agg(quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c),
        (select string_agg('r.' || quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c),
        v_tabela, v_tabela)
      using p_dados, coalesce(p_is_demo, false)
      into v_res;
    else
      execute format('select to_jsonb(t.*) from public.%I t where id = $1 for update', v_tabela) using p_id into v_ant;
      if v_ant is null then
        raise exception using errcode = 'P0002', message = 'Cadastro não encontrado.';
      end if;
      if p_tipo = 'cliente' and p_dados ? 'comercial_id'
         and (v_ant -> 'comercial_id') is distinct from (p_dados -> 'comercial_id') then
        perform private.exigir('carteira.editar');
      end if;
      execute format(
        'update public.%I t set (%s) = (select %s from jsonb_populate_record(t, $1) r) where id = $2 returning to_jsonb(t.*)',
        v_tabela,
        (select string_agg(quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c),
        (select string_agg('r.' || quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c))
      using p_dados, p_id
      into v_res;
      if p_tipo = 'cliente' then
        for k in select unnest(v_cols) loop
          if k not in ('dados_receita', 'logo_url', 'dados_consultados_em') and (v_ant -> k) is distinct from (v_res -> k) then
            perform private.registrar('cliente', p_id, null, null, p_id, null, k,
              private.json_texto(v_ant -> k), private.json_texto(v_res -> k));
          end if;
        end loop;
      end if;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'clientes_documento' then
      raise exception using errcode = '23505', message = 'Já existe um cliente com este CNPJ.';
    end if;
    raise exception using errcode = '23505', message = 'Já existe um cadastro com este nome.';
  end;

  -- Regras obrigatórias do cliente (valem para criar e para editar).
  if p_tipo = 'cliente' then
    if not private.cnpj_valido(v_res ->> 'documento') then
      raise exception using errcode = '22023', message = 'Informe um CNPJ válido.';
    end if;
    if coalesce(trim(v_res ->> 'telefone_comercial'), '') = '' then
      raise exception using errcode = '22023', message = 'Telefone de contato comercial é obrigatório.';
    end if;
    if nullif(v_res ->> 'comercial_id', '') is null then
      raise exception using errcode = '22023', message = 'Informe o comercial responsável pelo cliente.';
    end if;
  end if;
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Locais e cidades digitados no embarque: reaproveita se já existir, senão cria.
-- ---------------------------------------------------------------------------
create or replace function public.obter_local(p_nome text, p_cidade text, p_uf text, p_tipo public.tipo_local, p_is_demo boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_tipo public.tipo_local;
  v_uf text := nullif(upper(trim(coalesce(p_uf, ''))), '');
begin
  if not (private.tem_permissao('embarques.criar') or private.tem_permissao('embarques.editar_cadastro')
          or private.tem_permissao('cadastros.gerenciar')) then
    perform private.exigir('embarques.criar');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return null;
  end if;
  if v_uf is not null and v_uf !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'UF deve ter 2 letras.';
  end if;
  select id, tipo into v_id, v_tipo from public.locais
  where nome_busca = private.normalizar(p_nome) and cidade_busca = coalesce(private.normalizar(p_cidade), '')
    and is_demo = coalesce(p_is_demo, false);
  if v_id is not null then
    if v_tipo <> p_tipo and v_tipo <> 'ambos' then
      update public.locais set tipo = 'ambos' where id = v_id;
    end if;
    return v_id;
  end if;
  insert into public.locais (nome, cidade, uf, tipo, is_demo)
  values (trim(p_nome), nullif(trim(coalesce(p_cidade, '')), ''), v_uf, p_tipo, coalesce(p_is_demo, false))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.obter_cidade(p_nome text, p_uf text, p_is_demo boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uf text := nullif(upper(trim(coalesce(p_uf, ''))), '');
begin
  if not (private.tem_permissao('embarques.criar') or private.tem_permissao('embarques.editar_cadastro')
          or private.tem_permissao('cadastros.gerenciar')) then
    perform private.exigir('embarques.criar');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return null;
  end if;
  if v_uf is not null and v_uf !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'UF deve ter 2 letras.';
  end if;
  select id into v_id from public.cidades
  where nome_busca = private.normalizar(p_nome) and uf is not distinct from v_uf and is_demo = coalesce(p_is_demo, false);
  if v_id is null then
    insert into public.cidades (nome, uf, is_demo) values (trim(p_nome), v_uf, coalesce(p_is_demo, false))
    returning id into v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.obter_local(text, text, text, public.tipo_local, boolean) from public, anon;
revoke all on function public.obter_cidade(text, text, boolean) from public, anon;
revoke all on function private.cnpj_valido(text) from public, anon;
grant execute on function public.obter_local(text, text, text, public.tipo_local, boolean) to authenticated;
grant execute on function public.obter_cidade(text, text, boolean) to authenticated;
grant execute on function private.cnpj_valido(text) to authenticated;
