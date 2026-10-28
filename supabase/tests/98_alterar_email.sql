-- Testes da migração 2300: alterar o e-mail de um usuário.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000098a1', 'adm98@teste.local', '{"nome":"Admin 98"}'),
  ('00000000-0000-0000-0000-0000000098a2', 'ges98@teste.local', '{"nome":"Gestor 98"}'),
  ('00000000-0000-0000-0000-0000000098a3', 'apoio98@gmail.com', '{"nome":"Apoio 98"}'),
  ('00000000-0000-0000-0000-0000000098a4', 'cons98@teste.local', '{"nome":"Consulta 98"}');
update perfis set papel = 'administrador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000098a1';
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000098a2';
update perfis set papel = 'apoio', status = 'ativo' where id = '00000000-0000-0000-0000-0000000098a3';
update perfis set papel = 'consulta', status = 'ativo' where id = '00000000-0000-0000-0000-0000000098a4';
insert into convites (email, papel) values ('aberto98@teste.local', 'apoio');
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-0000000098a2', 'usuarios.gerenciar', true) on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000098a2', false);
do $$ declare r jsonb; begin
  r := alterar_email_usuario('00000000-0000-0000-0000-0000000098a3', ' Apoio98.Novo@Transpanorama.com.br ');
  assert r ->> 'email' = 'apoio98.novo@transpanorama.com.br' and r ->> 'email_anterior' = 'apoio98@gmail.com', 'só confere';
  assert (select email from perfis where id = '00000000-0000-0000-0000-0000000098a3') = 'apoio98@gmail.com', 'conferir não grava';
  perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a3', 'apoio98.novo@transpanorama.com.br', true);
  assert (select email from perfis where id = '00000000-0000-0000-0000-0000000098a3') = 'apoio98.novo@transpanorama.com.br', 'grava ao aplicar';

  begin perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a3', 'cons98@teste.local'); assert false, 'e-mail de outro';
  exception when sqlstate '23505' then null; end;
  begin perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a3', 'aberto98@teste.local'); assert false, 'convite aberto';
  exception when sqlstate '23505' then null; end;
  begin perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a3', 'sem-arroba'); assert false, 'inválido';
  exception when sqlstate '22023' then null; end;
  begin perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a1', 'adm.novo@teste.local'); assert false, 'gestor não altera admin';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000098a4', false);
do $$ begin
  begin perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a3', 'x98@teste.local'); assert false, 'consulta não altera';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000098a1', false);
do $$ begin
  perform alterar_email_usuario('00000000-0000-0000-0000-0000000098a1', 'adm98.novo@teste.local', true);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from historico_alteracoes where campo = 'email' and valor_novo = 'apoio98.novo@transpanorama.com.br'), 'histórico';
  assert (select email from perfis where id = '00000000-0000-0000-0000-0000000098a1') = 'adm98.novo@teste.local', 'admin altera admin';
end $$;

\o
select 'alterar e-mail: ok';
