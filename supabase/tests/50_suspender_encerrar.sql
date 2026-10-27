-- Testes de suspender, reativar e encerrar embarques (migração 1500).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'ges5@teste.local', '{"nome":"Gestor Cinco"}'),
  ('00000000-0000-0000-0000-0000000005a2', 'com5@teste.local', '{"nome":"Coordenador Cinco"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000005f1', 'FILIAL CINCO');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000005e1', 'CLIENTE CINCO');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade, status_liberacao) values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005f1', 'JATAI', 'SANTOS', 'liberado'),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005f1', 'JATAI', 'UBERABA', 'liberado'),
  ('00000000-0000-0000-0000-0000000005b3', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005f1', 'JATAI', 'CATALAO', 'liberado');
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000005a1';
update perfis set papel = 'comercial', status = 'ativo' where id = '00000000-0000-0000-0000-0000000005a2';
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005f1'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005f1');

set role authenticated;
-- Coordenador comercial suspende: grava a data da suspensão; reativar limpa
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000005a2', false);
do $$ declare r jsonb; begin
  r := public.atualizar_embarque('00000000-0000-0000-0000-0000000005b1', '{"status_liberacao":"suspenso"}', '{"status_liberacao":"liberado"}');
  assert r ->> 'status' = 'ok', 'suspensão gravada';
  assert r -> 'registro' ->> 'suspenso_em' is not null, 'data da suspensão marcada';
  r := public.atualizar_embarque('00000000-0000-0000-0000-0000000005b1', '{"status_liberacao":"liberado"}', '{"status_liberacao":"suspenso"}');
  assert r -> 'registro' ->> 'suspenso_em' is null, 'reativação limpa a data';
  -- Coordenador comercial não encerra
  begin perform public.encerrar_embarque('00000000-0000-0000-0000-0000000005b1', null);
    raise exception 'comercial não deveria encerrar'; exception when sqlstate '42501' then null; end;
  perform public.atualizar_embarque('00000000-0000-0000-0000-0000000005b2', '{"status_liberacao":"suspenso"}', '{"status_liberacao":"liberado"}');
end $$;

-- Gestor encerra: arquivado com autor e motivo, sem volta
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000005a1', false);
do $$ declare r jsonb; begin
  r := public.encerrar_embarque('00000000-0000-0000-0000-0000000005b1', '  Contrato finalizado ');
  assert r -> 'registro' ->> 'situacao' = 'arquivado', 'encerrado vira arquivado';
  assert r -> 'registro' ->> 'encerrado_por_nome' = 'Gestor Cinco' and r -> 'registro' ->> 'encerrado_motivo' = 'Contrato finalizado', 'autor e motivo';
  begin perform public.atualizar_embarque('00000000-0000-0000-0000-0000000005b1', '{"situacao":"ativo"}', '{"situacao":"arquivado"}');
    raise exception 'encerrado não deveria ser reativado'; exception when sqlstate '55000' then null; end;
  begin perform public.encerrar_embarque('00000000-0000-0000-0000-0000000005b1', null);
    raise exception 'encerrar duas vezes'; exception when sqlstate '55000' then null; end;
  assert exists (select 1 from historico_alteracoes where embarque_id = '00000000-0000-0000-0000-0000000005b1' and campo = 'encerramento'), 'histórico do encerramento';
end $$;
reset role;

do $$ begin
  begin update embarques set situacao = 'ativo' where id = '00000000-0000-0000-0000-0000000005b1';
    raise exception 'nem gravação direta reativa'; exception when sqlstate '55000' then null; end;
end $$;

-- Encerramento automático (pg_cron roda sem usuário): só suspensos há mais de 7 dias
select set_config('request.jwt.claim.sub', '', false);
update embarques set suspenso_em = now() - interval '7 days 1 minute' where id = '00000000-0000-0000-0000-0000000005b2';
do $$ begin
  assert private.encerrar_suspensos_vencidos() = 1, 'um vencido encerrado';
  assert (select encerrado_motivo from embarques where id = '00000000-0000-0000-0000-0000000005b2') = 'Suspenso há mais de 7 dias sem reativação', 'motivo automático';
  assert (select encerrado_por_nome from embarques where id = '00000000-0000-0000-0000-0000000005b2') = 'Sistema', 'autor Sistema';
  assert (select encerrado_em from embarques where id = '00000000-0000-0000-0000-0000000005b3') is null, 'liberado não é tocado';
  assert private.encerrar_suspensos_vencidos() = 0, 'segunda rodada não repete';
end $$;
