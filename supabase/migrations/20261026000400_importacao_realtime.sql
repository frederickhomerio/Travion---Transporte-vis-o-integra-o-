-- Frete IQ — importação da planilha e publicação em tempo real

-- ---------------------------------------------------------------------------
-- Importação
-- ---------------------------------------------------------------------------
-- O navegador lê o arquivo (sem executar fórmulas ou macros), normaliza os valores e mostra a prévia.
-- Esta função grava o que foi confirmado. Regras:
--   * embarque é localizado pela chave de importação (estável após o primeiro vínculo);
--   * depois de vinculado, o cadastro do embarque é mantido pelo app: diferenças vão para o relatório;
--   * posição da data: criada se não existir; se existir e for diferente, só é sobrescrita com
--     p_payload.sobrescrever_posicoes = true (cada campo alterado vai para o histórico);
--   * informação ausente continua ausente (null), nunca vira zero.

create or replace function private.obter_cadastro(p_tabela text, p_nome text, p_is_demo boolean, p_cidade text default null,
                                                  p_uf text default null, p_tipo public.tipo_local default 'ambos')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if private.normalizar(p_nome) is null then
    return null;
  end if;
  if p_tabela = 'locais' then
    select id into v_id from public.locais
    where nome_busca = private.normalizar(p_nome) and cidade_busca = coalesce(private.normalizar(p_cidade), '') and is_demo = p_is_demo;
    if v_id is null then
      insert into public.locais (nome, cidade, uf, tipo, is_demo)
      values (trim(regexp_replace(p_nome, '\s+', ' ', 'g')), nullif(trim(p_cidade), ''), p_uf, p_tipo, p_is_demo)
      returning id into v_id;
    elsif p_tipo <> 'ambos' then
      update public.locais set tipo = 'ambos' where id = v_id and tipo <> p_tipo and tipo <> 'ambos';
    end if;
    return v_id;
  end if;
  execute format('select id from public.%I where nome_busca = private.normalizar($1) and is_demo = $2', p_tabela)
    using p_nome, p_is_demo into v_id;
  if v_id is null then
    execute format('insert into public.%I (nome, is_demo) values ($1, $2) returning id', p_tabela)
      using trim(regexp_replace(p_nome, '\s+', ' ', 'g')), p_is_demo into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.importar_planilha(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_demo boolean := coalesce((p_payload ->> 'is_demo')::boolean, false);
  v_data date := (p_payload ->> 'data_operacional')::date;
  v_sobrescrever boolean := coalesce((p_payload ->> 'sobrescrever_posicoes')::boolean, false);
  v_fin_ok boolean := private.tem_permissao('financeiro.editar');
  v_imp_id uuid := gen_random_uuid();
  v_ja_importado boolean;
  c jsonb;
  l jsonb;
  v_cli uuid;
  v_com uuid;
  v_fil uuid;
  v_prod uuid;
  v_col uuid;
  v_ent uuid;
  e public.embarques;
  ef public.embarque_financeiro;
  p public.posicoes_diarias;
  v_pid uuid;
  k text;
  v_dif jsonb;
  v_cont jsonb;
  v_rel jsonb := jsonb_build_object(
    'clientes_criados', 0, 'comerciais_criados', 0, 'embarques_criados', 0, 'embarques_vinculados', 0,
    'posicoes_criadas', 0, 'posicoes_atualizadas', 0, 'posicoes_iguais', 0, 'posicoes_divergentes', 0,
    'avisos', '[]'::jsonb);
  v_avisos jsonb := '[]';
  v_qtd_com_antes integer;
  v_qtd_cli_antes integer;
begin
  perform private.exigir('importacao.executar');
  if v_data is null then
    raise exception using errcode = '22023', message = 'Informe a data operacional dos dados importados.';
  end if;
  if v_data > private.hoje_sp() + 1 then
    raise exception using errcode = '22023', message = 'A data operacional não pode estar no futuro.';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_payload -> 'linhas', '[]')) x)
     <> (select count(distinct x ->> 'chave') from jsonb_array_elements(coalesce(p_payload -> 'linhas', '[]')) x) then
    raise exception using errcode = '22023', message = 'Há linhas com a mesma chave de importação. Refaça a prévia.';
  end if;

  select exists (select 1 from public.importacoes where arquivo_hash = p_payload ->> 'arquivo_hash'
                 and data_operacional = v_data and is_demo = v_demo) into v_ja_importado;

  select count(*) into v_qtd_com_antes from public.comerciais where is_demo = v_demo;
  select count(*) into v_qtd_cli_antes from public.clientes where is_demo = v_demo;

  -- Filiais listadas na aba Clientes (entram nos agrupamentos mesmo sem embarques)
  for c in select * from jsonb_array_elements(coalesce(p_payload -> 'filiais', '[]')) loop
    perform private.obter_cadastro('filiais', c #>> '{}', v_demo);
  end loop;

  -- Aba Clientes: cadastro de clientes e carteira comercial
  for c in select * from jsonb_array_elements(coalesce(p_payload -> 'clientes', '[]')) loop
    v_com := case when private.normalizar(c ->> 'carteira') is not null
                  then private.obter_cadastro('comerciais', c ->> 'carteira', v_demo) end;
    select id into v_cli from public.clientes where nome_busca = private.normalizar(c ->> 'nome') and is_demo = v_demo;
    if v_cli is null then
      insert into public.clientes (nome, comercial_id, restricao_comercial, is_demo)
      values (trim(regexp_replace(c ->> 'nome', '\s+', ' ', 'g')), v_com, nullif(trim(c ->> 'restricao'), ''), v_demo);
    elsif exists (select 1 from public.clientes where id = v_cli and comercial_id is distinct from v_com and v_com is not null) then
      -- Alteração de carteira é restrita: não aplicamos automaticamente
      v_avisos := v_avisos || jsonb_build_array(format('Cliente %s: carteira na planilha (%s) difere do cadastro. Não alterado.',
                                                       c ->> 'nome', c ->> 'carteira'));
    end if;
  end loop;

  -- Lista de Fretes
  for l in select * from jsonb_array_elements(coalesce(p_payload -> 'linhas', '[]')) loop
    select id into v_cli from public.clientes where nome_busca = private.normalizar(l ->> 'cliente') and is_demo = v_demo;
    v_com := case when private.normalizar(l ->> 'carteira') is not null
                  then private.obter_cadastro('comerciais', l ->> 'carteira', v_demo) end;
    if v_cli is null then
      insert into public.clientes (nome, comercial_id, is_demo)
      values (trim(regexp_replace(l ->> 'cliente', '\s+', ' ', 'g')), v_com, v_demo) returning id into v_cli;
    end if;
    v_fil := private.obter_cadastro('filiais', l ->> 'filial', v_demo);
    v_prod := private.obter_cadastro('produtos', l ->> 'produto', v_demo);
    v_col := private.obter_cadastro('locais', l ->> 'coleta', v_demo, l ->> 'origem_cidade', nullif(l ->> 'origem_uf', ''), 'coleta');
    v_ent := private.obter_cadastro('locais', l ->> 'entrega', v_demo, l ->> 'destino_cidade', nullif(l ->> 'destino_uf', ''), 'entrega');

    select * into e from public.embarques where chave_importacao = l ->> 'chave' and is_demo = v_demo for update;
    if e.id is null then
      insert into public.embarques
        (cliente_id, comercial_id, filial_id, produto_id, origem_cidade, origem_uf, local_coleta_id,
         destino_cidade, destino_uf, local_entrega_id, status_liberacao, cadencia_valor, toneladas_por_veiculo, is_demo,
         chave_importacao, criado_por, atualizado_por, atualizado_por_nome)
      values
        (v_cli, coalesce(v_com, (select comercial_id from public.clientes where id = v_cli)), v_fil, v_prod,
         trim(l ->> 'origem_cidade'), nullif(l ->> 'origem_uf', ''), v_col,
         trim(l ->> 'destino_cidade'), nullif(l ->> 'destino_uf', ''), v_ent,
         coalesce(nullif(l ->> 'status', ''), 'nao_informado')::public.status_liberacao,
         case when (l ->> 'cadencia_valor')::numeric > 0 then (l ->> 'cadencia_valor')::numeric end,
         coalesce((select (valor #>> '{}')::numeric from public.configuracoes where chave = 'capacidade_padrao_t'), 40),
         v_demo, l ->> 'chave', auth.uid(), auth.uid(), private.nome_usuario())
      returning * into e;
      insert into public.embarque_financeiro (embarque_id, frete_empresa, frete_motorista, frete_empresa_original, frete_motorista_original)
      values (e.id,
              case when v_fin_ok then (l ->> 'frete_empresa')::numeric end,
              case when v_fin_ok then (l ->> 'frete_motorista')::numeric end,
              case when v_fin_ok then l ->> 'frete_empresa_original' end,
              case when v_fin_ok then l ->> 'frete_motorista_original' end);
      perform private.registrar('embarque', e.id, e.id, null, e.cliente_id, v_data, 'criacao', null,
        format('Criado pela importação de %s (linha %s)', p_payload ->> 'arquivo_nome', l ->> 'linha'), false, 'importacao');
      v_rel := jsonb_set(v_rel, '{embarques_criados}', to_jsonb((v_rel ->> 'embarques_criados')::int + 1));
    else
      v_rel := jsonb_set(v_rel, '{embarques_vinculados}', to_jsonb((v_rel ->> 'embarques_vinculados')::int + 1));
      if v_fin_ok then
        select * into ef from public.embarque_financeiro where embarque_id = e.id;
        if ef.frete_empresa is distinct from (l ->> 'frete_empresa')::numeric
           or ef.frete_motorista is distinct from (l ->> 'frete_motorista')::numeric then
          v_avisos := v_avisos || jsonb_build_array(format('Linha %s (EMB-%s): frete na planilha difere do cadastro. Mantido o valor do app.',
                                                           l ->> 'linha', lpad(e.codigo::text, 6, '0')));
        end if;
      end if;
    end if;

    if l ? 'extras' and jsonb_typeof(l -> 'extras') = 'object' and l -> 'extras' <> '{}'::jsonb then
      insert into public.embarque_dados_origem (embarque_id, dados, importacao_id)
      values (e.id, l -> 'extras', v_imp_id)
      on conflict (embarque_id) do update set dados = public.embarque_dados_origem.dados || excluded.dados,
        importacao_id = excluded.importacao_id, atualizado_em = now();
    end if;

    -- Posição da data operacional
    v_cont := jsonb_build_object(
      'porta', l -> 'porta', 'transito', l -> 'transito', 'carregados', l -> 'carregados',
      'obs_operacional', coalesce(l -> 'obs_operacional', 'null'::jsonb), 'obs_cliente', coalesce(l -> 'obs_cliente', 'null'::jsonb));
    for k in select jsonb_object_keys(v_cont) loop
      v_cont := jsonb_set(v_cont, array[k], private.validar_valor(k, case when k like 'obs_%' then 'texto' else 'contador' end,
                                                                  coalesce(v_cont -> k, 'null'::jsonb)));
    end loop;

    select * into p from public.posicoes_diarias where embarque_id = e.id and data_operacional = v_data for update;
    if p.id is null then
      insert into public.posicoes_diarias
        (embarque_id, data_operacional, porta, transito, carregados, obs_operacional, obs_cliente,
         toneladas_por_veiculo, meta_valor, meta_unidade, is_demo, origem, criado_por, atualizado_por, atualizado_por_nome)
      values
        (e.id, v_data, (v_cont ->> 'porta')::int, (v_cont ->> 'transito')::int, (v_cont ->> 'carregados')::int,
         v_cont ->> 'obs_operacional', v_cont ->> 'obs_cliente',
         e.toneladas_por_veiculo, e.cadencia_valor, e.cadencia_unidade, v_demo, 'importacao', auth.uid(), auth.uid(), private.nome_usuario())
      returning id into v_pid;
      perform private.registrar('posicao', v_pid, e.id, v_pid, e.cliente_id, v_data, 'importacao', null,
        format('Porta %s, trânsito %s, carregados %s (planilha %s, linha %s)',
               coalesce(v_cont ->> 'porta', 'não informado'), coalesce(v_cont ->> 'transito', 'não informado'),
               coalesce(v_cont ->> 'carregados', 'não informado'), p_payload ->> 'arquivo_nome', l ->> 'linha'),
        false, 'importacao');
      v_rel := jsonb_set(v_rel, '{posicoes_criadas}', to_jsonb((v_rel ->> 'posicoes_criadas')::int + 1));
    else
      v_dif := '{}';
      for k in select jsonb_object_keys(v_cont) loop
        if (to_jsonb(p) -> k) is distinct from (v_cont -> k) then
          v_dif := v_dif || jsonb_build_object(k, v_cont -> k);
        end if;
      end loop;
      if v_dif = '{}'::jsonb then
        v_rel := jsonb_set(v_rel, '{posicoes_iguais}', to_jsonb((v_rel ->> 'posicoes_iguais')::int + 1));
      elsif not v_sobrescrever then
        v_rel := jsonb_set(v_rel, '{posicoes_divergentes}', to_jsonb((v_rel ->> 'posicoes_divergentes')::int + 1));
        v_avisos := v_avisos || jsonb_build_array(format('Linha %s (EMB-%s): posição de %s já existe com valores diferentes. Mantida a do app.',
                                                         l ->> 'linha', lpad(e.codigo::text, 6, '0'), to_char(v_data, 'DD/MM/YYYY')));
      else
        update public.posicoes_diarias set
          porta = (jsonb_populate_record(p, v_dif)).porta, transito = (jsonb_populate_record(p, v_dif)).transito,
          carregados = (jsonb_populate_record(p, v_dif)).carregados,
          obs_operacional = (jsonb_populate_record(p, v_dif)).obs_operacional,
          obs_cliente = (jsonb_populate_record(p, v_dif)).obs_cliente,
          versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = private.nome_usuario()
        where id = p.id;
        for k in select jsonb_object_keys(v_dif) loop
          perform private.registrar('posicao', p.id, e.id, p.id, e.cliente_id, v_data, k,
            private.json_texto(to_jsonb(p) -> k), private.json_texto(v_dif -> k), false, 'importacao');
        end loop;
        v_rel := jsonb_set(v_rel, '{posicoes_atualizadas}', to_jsonb((v_rel ->> 'posicoes_atualizadas')::int + 1));
      end if;
    end if;
    e := null;
    p := null;
  end loop;

  v_rel := v_rel
    || jsonb_build_object('comerciais_criados', (select count(*) from public.comerciais where is_demo = v_demo) - v_qtd_com_antes)
    || jsonb_build_object('clientes_criados', (select count(*) from public.clientes where is_demo = v_demo) - v_qtd_cli_antes)
    || jsonb_build_object('avisos', v_avisos, 'arquivo_ja_importado', v_ja_importado, 'importacao_id', v_imp_id,
                          'financeiro_importado', v_fin_ok);

  insert into public.importacoes (id, arquivo_nome, arquivo_hash, aba, data_operacional, is_demo, mapeamento, relatorio, criado_por)
  values (v_imp_id, coalesce(p_payload ->> 'arquivo_nome', 'planilha'), coalesce(p_payload ->> 'arquivo_hash', ''),
          coalesce(p_payload ->> 'aba', ''), v_data, v_demo, coalesce(p_payload -> 'mapeamento', '{}'),
          v_rel || jsonb_build_object('inconsistencias_previa', coalesce(p_payload -> 'inconsistencias', '[]'::jsonb)), auth.uid());
  perform private.registrar('importacao', v_imp_id, null, null, null, v_data, 'importacao', null,
    format('%s: %s embarques novos, %s vinculados, %s posições criadas', p_payload ->> 'arquivo_nome',
           v_rel ->> 'embarques_criados', v_rel ->> 'embarques_vinculados', v_rel ->> 'posicoes_criadas'), false, 'importacao');
  return v_rel;
end $$;

-- ---------------------------------------------------------------------------
-- Tempo real (Supabase Realtime respeita o RLS de leitura de cada assinante)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.embarques, public.posicoes_diarias, public.embarque_financeiro,
      public.configuracoes, public.metas_diarias, public.clientes;
  end if;
end $$;

revoke all on function public.importar_planilha(jsonb) from public, anon;
grant execute on function public.importar_planilha(jsonb) to authenticated;
revoke all on function private.obter_cadastro(text, text, boolean, text, text, public.tipo_local) from public, anon;
grant execute on function private.obter_cadastro(text, text, boolean, text, text, public.tipo_local) to authenticated;
