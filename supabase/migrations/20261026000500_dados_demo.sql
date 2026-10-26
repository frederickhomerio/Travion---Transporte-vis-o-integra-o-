-- Frete IQ — dados demonstrativos
-- Ficam separados dos dados de produção pela coluna is_demo = true e têm o prefixo [DEMO] nos nomes.
-- O app só mostra esses dados quando o usuário liga o "Modo demonstração", com faixa de aviso na tela.

create or replace function public.carregar_dados_demo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := private.hoje_sp();
  f_rv uuid; f_jt uuid; f_it uuid;
  c_ana uuid; c_bru uuid;
  cl_alfa uuid; cl_beta uuid; cl_gama uuid; cl_delta uuid;
  p_milho uuid; p_soja uuid; p_farelo uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid;
  r record;
  v_emb uuid;
  v_dia integer;
begin
  if not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores carregam dados demonstrativos.';
  end if;
  if exists (select 1 from public.embarques where is_demo) then
    raise exception using errcode = '55000', message = 'Os dados demonstrativos já estão carregados. Remova-os antes de carregar de novo.';
  end if;

  insert into public.filiais (nome, is_demo) values ('[DEMO] Rio Verde', true) returning id into f_rv;
  insert into public.filiais (nome, is_demo) values ('[DEMO] Jataí', true) returning id into f_jt;
  insert into public.filiais (nome, is_demo) values ('[DEMO] Itumbiara', true) returning id into f_it;
  insert into public.comerciais (nome, is_demo) values ('[DEMO] Ana', true) returning id into c_ana;
  insert into public.comerciais (nome, is_demo) values ('[DEMO] Bruno', true) returning id into c_bru;
  insert into public.clientes (nome, comercial_id, is_demo) values ('[DEMO] Cerealista Alfa', c_ana, true) returning id into cl_alfa;
  insert into public.clientes (nome, comercial_id, is_demo) values ('[DEMO] Agroindústria Beta', c_ana, true) returning id into cl_beta;
  insert into public.clientes (nome, comercial_id, is_demo) values ('[DEMO] Trading Gama', c_bru, true) returning id into cl_gama;
  insert into public.clientes (nome, comercial_id, is_demo) values ('[DEMO] Cooperativa Delta', c_bru, true) returning id into cl_delta;
  insert into public.produtos (nome, is_demo) values ('[DEMO] Milho em grãos', true) returning id into p_milho;
  insert into public.produtos (nome, is_demo) values ('[DEMO] Soja em grãos', true) returning id into p_soja;
  insert into public.produtos (nome, is_demo) values ('[DEMO] Farelo de soja', true) returning id into p_farelo;
  insert into public.locais (nome, cidade, uf, tipo, is_demo) values ('[DEMO] Armazém Norte', 'Rio Verde', 'GO', 'coleta', true) returning id into l1;
  insert into public.locais (nome, cidade, uf, tipo, is_demo) values ('[DEMO] Fazenda Boa Vista', 'Jataí', 'GO', 'coleta', true) returning id into l2;
  insert into public.locais (nome, cidade, uf, tipo, is_demo) values ('[DEMO] Silo Central', 'Itumbiara', 'GO', 'coleta', true) returning id into l3;
  insert into public.locais (nome, cidade, uf, tipo, is_demo) values ('[DEMO] Terminal Porto', 'Santos', 'SP', 'entrega', true) returning id into l4;
  insert into public.locais (nome, cidade, uf, tipo, is_demo) values ('[DEMO] Indústria Sul', 'Uberaba', 'MG', 'entrega', true) returning id into l5;
  insert into public.locais (nome, cidade, uf, tipo, is_demo) values ('[DEMO] Ferrovia Leste', 'Araguari', 'MG', 'entrega', true) returning id into l6;

  for r in
    select * from (values
      (cl_alfa, c_ana, f_rv, p_milho, 'Rio Verde', l1, 'Santos', 'SP', l4, 'liberado', null::numeric, 155, 144, 3, 2, 4),
      (cl_alfa, c_ana, f_rv, p_milho, 'Rio Verde', l1, 'Santos', 'SP', l4, 'liberado', 3, 155, 144, 1, 1, 2),
      (cl_beta, c_ana, f_jt, p_farelo, 'Jataí', l2, 'Uberaba', 'MG', l5, 'liberado', null, 230, 180, 0, 3, 1),
      (cl_gama, c_bru, f_jt, p_soja, 'Jataí', l2, 'Araguari', 'MG', l6, 'suspenso', null, 140, 130, 2, 0, 0),
      (cl_gama, c_bru, f_it, p_milho, 'Itumbiara', l3, 'Santos', 'SP', l4, 'nao_informado', null, 260, 241, 0, 0, 0),
      (cl_delta, c_bru, f_it, p_soja, 'Itumbiara', l3, 'Uberaba', 'MG', l5, 'liberado', 4, 79, 73, 5, 4, 6)
    ) as t(cli, com, fil, prod, ori, col, dest, uf, ent, st, cad, fe, fm, porta, transito, carregados)
  loop
    insert into public.embarques
      (cliente_id, comercial_id, filial_id, produto_id, origem_cidade, origem_uf, local_coleta_id,
       destino_cidade, destino_uf, local_entrega_id, status_liberacao, cadencia_valor, is_demo, atualizado_por_nome)
    values
      (r.cli, r.com, r.fil, r.prod, r.ori, 'GO', r.col, r.dest, r.uf, r.ent, r.st::public.status_liberacao, r.cad, true, 'Demonstração')
    returning id into v_emb;
    insert into public.embarque_financeiro (embarque_id, frete_empresa, frete_motorista) values (v_emb, r.fe, r.fm);
    for v_dia in 0..1 loop
      insert into public.posicoes_diarias
        (embarque_id, data_operacional, porta, transito, carregados, toneladas_por_veiculo, meta_valor, is_demo, origem,
         obs_cliente, atualizado_por_nome)
      values
        (v_emb, v_hoje - v_dia, greatest(r.porta - v_dia, 0), r.transito, greatest(r.carregados - 2 * v_dia, 0), 40, r.cad, true,
         'abertura', case when r.st = 'suspenso' then 'Aguardando liberação de cota pelo cliente' end, 'Demonstração');
    end loop;
  end loop;

  insert into public.metas_diarias (data_operacional, is_demo, meta_faturamento, meta_margem, meta_volume_t, observacao)
  values (v_hoje, true, 80000, 9000, 600, 'Meta fictícia de demonstração');

  return jsonb_build_object('embarques', (select count(*) from public.embarques where is_demo));
end $$;

revoke all on function public.carregar_dados_demo() from public, anon;
grant execute on function public.carregar_dados_demo() to authenticated;
