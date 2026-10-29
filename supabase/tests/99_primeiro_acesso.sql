-- Testes da migração 2700: convite pendente até criar a senha e entrar.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data, encrypted_password, last_sign_in_at) values
  ('00000000-0000-0000-0000-00000000a7c1', 'adm97@teste.local', '{"nome":"Admin 97"}', 'x', now()),
  ('00000000-0000-0000-0000-00000000a7c2', 'conv97@teste.local', '{"nome":"Convidado 97"}', '', null);
update perfis set papel = 'administrador', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7c1';
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7c2';

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7c1', false);
do $$ begin
  assert (select senha_criada and primeiro_acesso_em is not null from usuarios_primeiro_acesso() where perfil_id = '00000000-0000-0000-0000-00000000a7c1'), 'admin já entrou';
  assert (select not senha_criada and primeiro_acesso_em is null from usuarios_primeiro_acesso() where perfil_id = '00000000-0000-0000-0000-00000000a7c2'), 'convidado pendente';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7c2', false);
do $$ begin
  begin perform usuarios_primeiro_acesso(); assert false, 'só quem gerencia usuários';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\o
