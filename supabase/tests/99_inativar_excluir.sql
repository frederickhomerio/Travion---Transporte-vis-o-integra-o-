-- Testes da migração 2600: inativar e excluir usuário (só administrador por padrão).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000095e1', 'adm96@teste.local', '{"nome":"Admin 97"}'),
  ('00000000-0000-0000-0000-0000000095e2', 'ges96@teste.local', '{"nome":"Gestor 97"}'),
  ('00000000-0000-0000-0000-0000000095e3', 'novo96@teste.local', '{"nome":"Novo 97"}'),
  ('00000000-0000-0000-0000-0000000095e4', 'usado96@teste.local', '{"nome":"Usado 97"}');
update perfis set papel = 'administrador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000095e1';
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000095e2';
update perfis set papel = 'embarcador', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000095e3', '00000000-0000-0000-0000-0000000095e4');
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-0000000095e2', 'usuarios.gerenciar', true);
insert into historico_alteracoes (entidade, campo, usuario_id, usuario_nome) values ('cliente', 'nome', '00000000-0000-0000-0000-0000000095e4', 'Usado 97');

set role authenticated;
-- Gestor com usuarios.gerenciar não inativa nem exclui.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095e2', false);
do $$ begin
  begin perform admin_atualizar_usuario('00000000-0000-0000-0000-0000000095e3', '{"status":"bloqueado"}'); assert false, 'gestor não inativa';
  exception when insufficient_privilege then null; end;
  begin perform excluir_usuario('00000000-0000-0000-0000-0000000095e3'); assert false, 'gestor não exclui';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095e1', false);
do $$ begin
  perform admin_atualizar_usuario('00000000-0000-0000-0000-0000000095e3', '{"status":"bloqueado"}');
  assert (select status from perfis where id = '00000000-0000-0000-0000-0000000095e3') = 'bloqueado', 'admin inativa';
  perform admin_atualizar_usuario('00000000-0000-0000-0000-0000000095e3', '{"status":"ativo"}');
  assert (select status from perfis where id = '00000000-0000-0000-0000-0000000095e3') = 'ativo', 'admin reativa';
  begin perform excluir_usuario('00000000-0000-0000-0000-0000000095e4', true); assert false, 'com registros não exclui';
  exception when sqlstate '55000' then null; end;
  begin perform excluir_usuario('00000000-0000-0000-0000-0000000095e1', true); assert false, 'não exclui a si mesmo';
  exception when sqlstate '55000' then null; end;
  perform excluir_usuario('00000000-0000-0000-0000-0000000095e3', true);
  assert not exists (select 1 from perfis where id = '00000000-0000-0000-0000-0000000095e3'), 'excluído';
  assert exists (select 1 from historico_alteracoes where registro_id = '00000000-0000-0000-0000-0000000095e3' and campo = 'excluido'), 'exclusão no histórico';
end $$;
reset role;

\o
select 'inativar e excluir: ok';
