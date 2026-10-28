-- Testes da migração 2500: fila do Apoio no Dashboard Embarques (permissão analise.fila, sem nomes).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000098b1', 'emb98@teste.local', '{"nome":"Embarcador 98"}'),
  ('00000000-0000-0000-0000-0000000098b2', 'cons98@teste.local', '{"nome":"Consulta 98"}');
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000098b1';
update perfis set papel = 'consulta', status = 'ativo' where id = '00000000-0000-0000-0000-0000000098b2';

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000098b1', false);
do $$
declare v jsonb;
begin
  v := fila_apoio();
  assert v ? 'agora' and jsonb_typeof(v -> 'solicitacoes') = 'array' and jsonb_typeof(v -> 'eventos') = 'array', 'formato da fila';
  assert not exists (select 1 from jsonb_array_elements(v -> 'solicitacoes') x
                      where x ->> 'status' not in ('enviado', 'correcao_recebida') or coalesce(x ->> 'solicitante_nome', '') <> ''), 'só a fila, sem nomes';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000098b2', false);
do $$ begin
  begin perform fila_apoio(); assert false, 'consulta não vê a fila por padrão';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\o
select 'fila no dashboard: ok';
