-- Preço de pauta automático (27/10/2026): todos os produtos da tabela diária da CNA
-- (https://cnabrasil.org.br/servicos/precos-commodities), com o preço de Goiás em R$/kg,
-- atualizados todo dia às 15:00 de Brasília. Tudo dentro do banco: o pg_cron pede a tabela pelo pg_net
-- às 15:00 e grava o resultado às 15:05 (o pg_net responde de forma assíncrona). Sem segredos nem chaves.

alter table public.produtos
  add column cna_produto text,
  add column preco_fonte text;
create unique index produtos_cna_produto on public.produtos (cna_produto, is_demo) where cna_produto is not null;

-- Pedidos feitos à CNA e o que foi gravado em cada um.
create table private.cna_coleta (
  pedido bigint primary key,
  pedido_em timestamptz not null default now(),
  processado_em timestamptz,
  resultado jsonb
);

/** "1571.95", "1.571,95" → número. */
create or replace function private.cna_numero(p text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p is null or trim(p) = '' then null
    when p like '%,%' then nullif(regexp_replace(replace(trim(p), '.', ''), ',', '.'), '')::numeric
    else trim(p)::numeric
  end;
$$;

/** Quilos da unidade da cotação ("R$ / SACA 60 KG", "R$ / TON", "R$ / @"). Nulo para litro, centavos/libra etc. */
create or replace function private.cna_kg(p text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when upper(p) ~ '\d+([.,]\d+)?\s*KG' then replace((regexp_match(upper(p), '(\d+(?:[.,]\d+)?)\s*KG'))[1], ',', '.')::numeric
    when upper(p) ~ '\mTON' then 1000
    when upper(p) ~ 'ARROBA|@' then 15
    when upper(p) ~ '\mKG\M|QUILO' then 1
  end;
$$;

/** Valor em reais no formato brasileiro (1.234,56). */
create or replace function private.cna_reais(p numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'R$ ' || translate(to_char(p, 'FM999,999,990.00'), ',.', '.,');
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

    v_kg := private.cna_kg(v_unidade);
    v_valor_kg := case when v_kg is not null and v_media is not null then round(v_media / v_kg, 4) end;
    v_fonte := concat_ws(' · ',
      'CNA ' || v_data,
      v_uf || case when v_uf = 'GO' then '' else ' (sem cotação em GO)' end || ': '
        || case when v_n > 1 then format('média de %s praças (%s)', v_n, v_pracas) else v_pracas end,
      private.cna_reais(round(v_media, 2)) || ' ' || regexp_replace(coalesce(v_unidade, ''), '^R\$\s*/?\s*', 'por ', 'i'),
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

revoke all on function private.cna_numero(text) from public, anon, authenticated;
revoke all on function private.cna_kg(text) from public, anon, authenticated;
revoke all on function private.cna_reais(numeric) from public, anon, authenticated;
revoke all on function private.cna_aplicar(jsonb) from public, anon, authenticated;
revoke all on table private.cna_coleta from public, anon, authenticated;

-- Agendamento só onde existem pg_cron e pg_net (Supabase); o banco local de testes não tem.
-- 18:00 UTC = 15:00 em Brasília (sem horário de verão).
do $agenda$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;

  -- Pede a tabela à CNA.
  create or replace function private.cna_solicitar()
  returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
  as $f$
  declare v bigint;
  begin
    v := net.http_get(
      url := 'https://cnabrasil.org.br/apicna/precos',
      headers := jsonb_build_object('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                                    'Accept', 'application/json', 'X-Requested-With', 'XMLHttpRequest'),
      timeout_milliseconds := 30000);
    insert into private.cna_coleta (pedido) values (v);
    return v;
  end $f$;

  -- Grava as respostas que já chegaram.
  create or replace function private.cna_processar()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
  as $f$
  declare c record; v_res jsonb := '[]'; v_r jsonb;
  begin
    for c in
      select k.pedido, r.status_code, r.content, r.error_msg, r.timed_out
      from private.cna_coleta k join net._http_response r on r.id = k.pedido
      where k.processado_em is null
    loop
      if c.status_code = 200 and left(ltrim(c.content), 1) = '[' then
        v_r := private.cna_aplicar(c.content::jsonb);
      else
        v_r := jsonb_build_object('erro', coalesce(c.error_msg, case when c.timed_out then 'tempo esgotado' end, 'HTTP ' || c.status_code));
      end if;
      update private.cna_coleta set processado_em = now(), resultado = v_r where pedido = c.pedido;
      v_res := v_res || jsonb_build_object('pedido', c.pedido, 'resultado', v_r);
    end loop;
    return v_res;
  end $f$;

  revoke all on function private.cna_solicitar() from public, anon, authenticated;
  revoke all on function private.cna_processar() from public, anon, authenticated;

  perform cron.schedule('travion-cna-pedir', '0 18 * * *', 'select private.cna_solicitar()');
  perform cron.schedule('travion-cna-gravar', '5 18 * * *', 'select private.cna_processar()');
end $agenda$;
