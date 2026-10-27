-- Link do Google Maps no local de coleta/entrega, usado no anúncio de frete liberado (pedido do Frederick, 27/10/2026).
alter table public.locais add column if not exists link_mapa text
  check (link_mapa is null or link_mapa ~* '^https://[^\s]+$');

-- salvar_cadastro passa a aceitar link_mapa nos locais (resto igual à migração 0900).
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
    when 'filial' then v_tabela := 'filiais'; v_cols := array['nome', 'codigo', 'supervisor', 'centro_custo_id', 'ativo'];
    when 'centro_custo' then v_tabela := 'centros_custo'; v_cols := array['nome', 'ativo'];
    when 'comercial' then v_tabela := 'comerciais'; v_cols := array['nome', 'email', 'telefone', 'ativo'];
    when 'produto' then v_tabela := 'produtos'; v_cols := array['nome', 'valor_pauta_kg', 'valor_pauta_data', 'ativo'];
    when 'local' then v_tabela := 'locais'; v_cols := array['nome', 'cidade', 'uf', 'tipo', 'link_mapa', 'ativo'];
    when 'cidade' then v_tabela := 'cidades'; v_cols := array['nome', 'uf', 'uso', 'ativo'];
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
  if p_dados ? 'link_mapa' then
    p_dados := jsonb_set(p_dados, '{link_mapa}', coalesce(to_jsonb(nullif(trim(p_dados ->> 'link_mapa'), '')), 'null'::jsonb));
    if (p_dados ->> 'link_mapa') !~* '^https://[^\s]+$' then
      raise exception using errcode = '22023', message = 'O link do mapa deve começar com https:// (copie o link de compartilhar do Google Maps).';
    end if;
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

  -- Regras obrigatórias do cliente. Na criação valem todas; na edição, só para os campos alterados, porque os
  -- clientes trazidos da planilha antiga ainda não têm CNPJ e telefone (aparecem como "Pendente" para completar).
  -- Cliente marcado como NÃO CARREGAR não precisa de comercial.
  if p_tipo = 'cliente' then
    if (p_id is null or p_dados ? 'documento') and not private.cnpj_valido(v_res ->> 'documento') then
      raise exception using errcode = '22023', message = 'Informe um CNPJ válido.';
    end if;
    if (p_id is null or p_dados ? 'telefone_comercial') and coalesce(trim(v_res ->> 'telefone_comercial'), '') = '' then
      raise exception using errcode = '22023', message = 'Telefone de contato comercial é obrigatório.';
    end if;
    if (p_id is null or p_dados ? 'comercial_id' or p_dados ? 'restricao_comercial')
       and nullif(v_res ->> 'comercial_id', '') is null
       and coalesce(private.normalizar(v_res ->> 'restricao_comercial'), '') <> 'NAO CARREGAR' then
      raise exception using errcode = '22023', message = 'Informe o comercial responsável pelo cliente.';
    end if;
  end if;
  return v_res;
end $$;
