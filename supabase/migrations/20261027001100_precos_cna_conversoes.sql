-- Conversões pedidas pelo Frederick (27/10/2026) para os produtos da CNA que não vêm em peso:
-- etanol em R$/litro → R$/kg pela densidade a 20 °C (anidro 0,791 kg/L; hidratado 0,809 kg/L, faixa da ANP)
-- e algodão em R$ por libra-peso → R$/kg (1 libra = 0,45359237 kg).

/** Quilos por unidade para cotações que não vêm em peso. Nulo quando não há conversão segura. */
create or replace function private.cna_kg_especial(p_unidade text, p_produto text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when upper(p_unidade) ~ 'LIBRA' then 0.45359237
    when upper(p_unidade) ~ '/\s*L\s*$|LITRO' and upper(p_produto) ~ 'ETANOL' then
      case when upper(p_produto) ~ 'ANIDRO' then 0.791 else 0.809 end
  end;
$$;

-- Aplica uma tabela da CNA (array JSON) aos produtos: Goiás primeiro; sem GO, o estado vizinho mais próximo.
create or replace function private.cna_aplicar(p_tabela jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text;
  v_uf text;
  v_unidade text;
  v_data text;
  v_media numeric;
  v_kg numeric;
  v_valor_kg numeric;
  v_n int;
  v_pracas text;
  v_fonte text;
  v_id uuid;
  v_res jsonb := '[]';
begin
  create temp table if not exists cna_linhas (nome text, titulo text, uf text, praca text, data text, valor numeric) on commit drop;
  truncate cna_linhas;
  insert into cna_linhas
  select trim(x ->> 'NOME_PRODUTO'), trim(x ->> 'TITULO'), trim(x ->> 'UF'), trim(x ->> 'PRACA'), trim(x ->> 'DATA'),
         private.cna_numero(x ->> 'VALOR')
  from jsonb_array_elements(p_tabela) x
  where coalesce(trim(x ->> 'NOME_PRODUTO'), '') <> '';

  for v_nome in select distinct nome from cna_linhas order by 1 loop
    select u into v_uf
    from unnest(array['GO', 'DF', 'MG', 'MT', 'MS', 'TO', 'BA', 'SP', 'PR']) with ordinality t(u, o)
    where exists (select 1 from cna_linhas l where l.nome = v_nome and l.uf = t.u and l.valor is not null)
    order by o limit 1;
    if v_uf is null then
      select uf into v_uf from cna_linhas where nome = v_nome and valor is not null order by uf limit 1;
    end if;

    select min(titulo), min(data), avg(valor), count(*), string_agg(praca, ', ' order by praca)
      into v_unidade, v_data, v_media, v_n, v_pracas
    from cna_linhas where nome = v_nome and uf = v_uf and valor is not null;

    v_kg := coalesce(private.cna_kg(v_unidade), private.cna_kg_especial(v_unidade, v_nome));
    v_valor_kg := case when v_kg is not null and v_media is not null then round(v_media / v_kg, 4) end;
    v_fonte := concat_ws(' · ',
      'CNA ' || v_data,
      v_uf || case when v_uf = 'GO' then '' else ' (sem cotação em GO)' end || ': '
        || case when v_n > 1 then format('média de %s praças (%s)', v_n, v_pracas) else v_pracas end,
      private.cna_reais(round(v_media, 2)) || ' ' || regexp_replace(coalesce(v_unidade, ''), '^R\$\s*/?\s*', 'por ', 'i'),
      case when private.cna_kg(v_unidade) is null and v_kg is not null
        then format('convertido com %s kg por %s', translate(v_kg::text, '.', ','),
                    case when upper(v_unidade) ~ 'LIBRA' then 'libra-peso' else 'litro' end) end,
      case when v_valor_kg is null then 'unidade sem conversão para kg' end);

    select id into v_id from public.produtos where cna_produto = v_nome and not is_demo;
    if v_id is null then
      select id into v_id from public.produtos where cna_produto is null and nome_busca = private.normalizar(v_nome) and not is_demo;
    end if;

    if v_id is null then
      insert into public.produtos (nome, cna_produto, preco_fonte, valor_pauta_kg, valor_pauta_data, is_demo)
      values (upper(left(regexp_replace(v_nome, '\s*-\s*', ' ', 'g'), 1)) || lower(substr(regexp_replace(v_nome, '\s*-\s*', ' ', 'g'), 2)),
              v_nome, v_fonte, v_valor_kg, to_date(v_data, 'DD/MM/YYYY'), false)
      returning id into v_id;
      v_res := v_res || jsonb_build_object('produto', v_nome, 'uf', v_uf, 'valor_kg', v_valor_kg, 'acao', 'cadastrado');
    else
      update public.produtos set
        cna_produto = v_nome,
        preco_fonte = v_fonte,
        valor_pauta_kg = coalesce(v_valor_kg, valor_pauta_kg),
        valor_pauta_data = case when v_valor_kg is not null then to_date(v_data, 'DD/MM/YYYY') else valor_pauta_data end
      where id = v_id;
      v_res := v_res || jsonb_build_object('produto', v_nome, 'uf', v_uf, 'valor_kg', v_valor_kg, 'acao', 'atualizado');
    end if;
  end loop;
  return v_res;
end $$;
