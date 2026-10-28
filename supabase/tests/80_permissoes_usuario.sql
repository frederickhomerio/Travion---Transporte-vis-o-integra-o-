-- Testes das permissões por usuário (migração 1800).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a1', 'ge8@teste.local', '{"nome":"Gestor Oito"}'),
  ('00000000-0000-0000-0000-0000000008a2', 'cf8b@teste.local', '{"nome":"Comercial Oito"}'),
  ('00000000-0000-0000-0000-0000000008a3', 'ad8@teste.local', '{"nome":"Admin Oito"}');
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000008a1';
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000008a2';
update perfis set papel = 'administrador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000008a3';

set role authenticated;
-- Comercial não acessa
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000008a2', false);
do $$ begin
  begin perform listar_permissoes_usuarios(); raise exception 'comercial listou'; exception when sqlstate '42501' then null; end;
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"historico.ver":true}'); raise exception 'comercial gravou'; exception when sqlstate '42501' then null; end;
end $$;

-- Gestor: lista, concede o que tem, nega, volta ao padrão; limites
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000008a1', false);
do $$ declare r jsonb; begin
  r := listar_permissoes_usuarios();
  assert jsonb_array_length(r) >= 3, 'gestor lista usuários';
  r := salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"historico.ver":true,"documentacao.solicitar":false}');
  assert (r ->> 'historico.ver')::boolean and not (r ->> 'documentacao.solicitar')::boolean, 'exceções gravadas';
  r := salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"documentacao.solicitar":null}');
  assert not r ? 'documentacao.solicitar', 'voltou ao padrão';
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"usuarios.gerenciar":true}'); raise exception 'gestor deu usuarios'; exception when sqlstate '42501' then null; end;
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"permissoes.gerenciar":true}'); raise exception 'gestor deu permissoes'; exception when sqlstate '42501' then null; end;
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"importacao.executar":true}'); raise exception 'gestor deu o que não tem'; exception when sqlstate '42501' then null; end;
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a1', '{"historico.ver":false}'); raise exception 'gestor mudou a si'; exception when sqlstate '42501' then null; end;
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a3', '{"historico.ver":false}'); raise exception 'mexeu em admin'; exception when sqlstate '22023' then null; end;
  begin perform salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"nao.existe":true}'); raise exception 'chave inválida passou'; exception when sqlstate '22023' then null; end;
  -- Retirar o que ele não tem é permitido (negar não amplia acesso)
  r := salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"importacao.executar":false}');
end $$;
-- A exceção vale de verdade para o comercial
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000008a2', false);
do $$ begin assert private.tem_permissao('historico.ver'), 'exceção aplicada'; end $$;

-- Administrador concede o acesso às permissões
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000008a3', false);
do $$ declare r jsonb; begin
  r := salvar_permissoes_usuario('00000000-0000-0000-0000-0000000008a2', '{"permissoes.gerenciar":true}');
  assert (r ->> 'permissoes.gerenciar')::boolean, 'admin concede';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from papel_permissoes where papel = 'gestor' and chave = 'permissoes.gerenciar'), 'gestor tem por padrão';
  assert exists (select 1 from historico_alteracoes where campo = 'permissao:historico.ver'), 'histórico registrado';
end $$;
\o
\echo 80_permissoes_usuario: ok
