-- Testes da migração 2400: acesso por centro de custo e Centro de Custo Gerencial.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into centros_custo (id, nome) values
  ('00000000-0000-0000-0000-0000000099c1', 'CENTRO A 99'), ('00000000-0000-0000-0000-0000000099c2', 'CENTRO B 99');
insert into filiais (id, nome, centro_custo_id) values
  ('00000000-0000-0000-0000-0000000099f1', 'FILIAL A1 99', '00000000-0000-0000-0000-0000000099c1'),
  ('00000000-0000-0000-0000-0000000099f2', 'FILIAL A2 99', '00000000-0000-0000-0000-0000000099c1'),
  ('00000000-0000-0000-0000-0000000099f3', 'FILIAL B1 99', '00000000-0000-0000-0000-0000000099c2');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000099a1', 'adm99@teste.local', '{"nome":"Admin 99"}'),
  ('00000000-0000-0000-0000-0000000099a2', 'sup99@teste.local', '{"nome":"Supervisor 99"}'),
  ('00000000-0000-0000-0000-0000000099a3', 'apoio99@teste.local', '{"nome":"Apoio 99"}');
update perfis set papel = 'administrador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000099a1';

do $$ begin
  assert exists (select 1 from centros_custo where nome = 'Gerencial' and acesso_total), 'centro Gerencial criado';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000099a1', false);
do $$ begin
  perform admin_atualizar_usuario('00000000-0000-0000-0000-0000000099a2', jsonb_build_object('papel', 'supervisor', 'status', 'ativo',
    'centros', jsonb_build_array('00000000-0000-0000-0000-0000000099c1')));
  perform admin_atualizar_usuario('00000000-0000-0000-0000-0000000099a3', jsonb_build_object('papel', 'apoio', 'status', 'ativo',
    'centros', (select jsonb_agg(id) from centros_custo where acesso_total)));
  begin perform admin_atualizar_usuario('00000000-0000-0000-0000-0000000099a2', '{"comercial_id":null}'); assert false, 'carteira não é mais do usuário';
  exception when sqlstate '22023' then null; end;
  begin perform criar_convite('{"email":"novo99@teste.local","papel":"supervisor"}'); assert false, 'convite sem centro';
  exception when sqlstate '22023' then null; end;
  perform criar_convite('{"email":"novo99@teste.local","papel":"embarcador","centros":["00000000-0000-0000-0000-0000000099c2"]}');
end $$;
reset role;

do $$ begin
  assert (select array_agg(filial_id order by filial_id) from perfil_filiais where perfil_id = '00000000-0000-0000-0000-0000000099a2')
    = array['00000000-0000-0000-0000-0000000099f1', '00000000-0000-0000-0000-0000000099f2']::uuid[], 'supervisor vê as filiais do centro A';
  assert (select count(*) from perfil_filiais where perfil_id = '00000000-0000-0000-0000-0000000099a3') = (select count(*) from filiais), 'Gerencial vê todas';
  assert exists (select 1 from historico_alteracoes where campo = 'centros_custo' and valor_novo = 'CENTRO A 99'), 'histórico do centro';
end $$;

-- Filial nova no centro A e filial A2 indo para o B: o escopo acompanha sozinho.
insert into filiais (id, nome, centro_custo_id) values ('00000000-0000-0000-0000-0000000099f4', 'FILIAL A3 99', '00000000-0000-0000-0000-0000000099c1');
update filiais set centro_custo_id = '00000000-0000-0000-0000-0000000099c2' where id = '00000000-0000-0000-0000-0000000099f2';
do $$ begin
  assert (select array_agg(filial_id order by filial_id) from perfil_filiais where perfil_id = '00000000-0000-0000-0000-0000000099a2')
    = array['00000000-0000-0000-0000-0000000099f1', '00000000-0000-0000-0000-0000000099f4']::uuid[], 'escopo acompanha a filial';
  assert (select count(*) from perfil_filiais where perfil_id = '00000000-0000-0000-0000-0000000099a3') = (select count(*) from filiais), 'Gerencial ganha a filial nova';
end $$;

-- Convite por centro de custo: quem cria a conta já entra com o centro.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000099a4', 'novo99@teste.local', '{}');
do $$ begin
  assert (select papel from perfis where id = '00000000-0000-0000-0000-0000000099a4') = 'embarcador', 'papel do convite';
  assert exists (select 1 from perfil_centros where perfil_id = '00000000-0000-0000-0000-0000000099a4' and centro_custo_id = '00000000-0000-0000-0000-0000000099c2'), 'centro do convite';
  assert (select count(*) from perfil_filiais where perfil_id = '00000000-0000-0000-0000-0000000099a4') = 2, 'filiais do centro B (B1 e A2)';
end $$;

\o
select 'centro de custo: ok';
