-- Testes da migração 2100: meta diária obrigatória, permissão "dos embarques que criei" e lote do ERP na criação.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000096a1', 'meta-emb1@teste.local', '{"nome":"Embarcador Um"}'),
  ('00000000-0000-0000-0000-0000000096a2', 'meta-emb2@teste.local', '{"nome":"Embarcador Dois"}'),
  ('00000000-0000-0000-0000-0000000096a3', 'meta-ges@teste.local', '{"nome":"Gestor Meta"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000096f1', 'FILIAL META');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000096e1', 'CLIENTE META');
update perfis set papel = 'embarcador', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000096a1', '00000000-0000-0000-0000-0000000096a2');
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000096a3';
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000096a1', '00000000-0000-0000-0000-0000000096f1'),
  ('00000000-0000-0000-0000-0000000096a2', '00000000-0000-0000-0000-0000000096f1'),
  ('00000000-0000-0000-0000-0000000096a3', '00000000-0000-0000-0000-0000000096f1');

do $$ begin
  assert exists (select 1 from papel_permissoes where papel = 'embarcador' and chave = 'embarques.editar_cadencia_proprio'), 'quem cria embarque recebe a permissão nova';
  assert not exists (select 1 from papel_permissoes where papel = 'embarcador' and chave = 'embarques.editar_cadencia'), 'embarcador continua sem editar a meta de qualquer embarque';
end $$;

create temporary table t96 (k text primary key, v uuid);
grant all on t96 to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000096a1', false);
do $$
declare r jsonb; e embarques; l lotes_erp;
  d jsonb := '{"cliente_id":"00000000-0000-0000-0000-0000000096e1","filial_id":"00000000-0000-0000-0000-0000000096f1","origem_cidade":"RIO VERDE","destino_cidade":"SANTOS"}';
begin
  begin perform criar_embarque(d); assert false, 'sem meta não cria';
  exception when sqlstate '22023' then assert sqlerrm like 'Informe a meta diária%', sqlerrm; end;
  begin perform criar_embarque(d || '{"cadencia_valor":0}'); assert false, 'meta zero não cria';
  exception when sqlstate '22023' then null; end;
  begin perform criar_embarque(d || jsonb_build_object('cadencia_valor', 3, 'lote_erp', repeat('9', 61))); assert false, 'lote longo';
  exception when sqlstate '22023' then assert sqlerrm like '%60 caracteres%', sqlerrm; end;

  r := criar_embarque(d || '{"cadencia_valor":120,"cadencia_unidade":"toneladas_dia","lote_erp":"  L-2026-0456 "}');
  e := jsonb_populate_record(null::embarques, r -> 'registro');
  assert e.cadencia_valor = 120 and e.cadencia_unidade = 'toneladas_dia', 'meta em toneladas por dia';
  select * into l from lotes_erp where embarque_id = e.id;
  assert l.numero = 'L-2026-0456' and l.solicitacao_id is null and l.registrado_por_nome = 'Embarcador Um', 'lote do ERP gravado na criação';
  insert into t96 values ('e1', e.id);

  r := criar_embarque(d || '{"cadencia_valor":2}');
  e := jsonb_populate_record(null::embarques, r -> 'registro');
  assert e.cadencia_unidade = 'veiculos_dia', 'unidade padrão em veículos';
  assert not exists (select 1 from lotes_erp where embarque_id = e.id), 'sem lote quando não informado';

  -- Quem criou altera a própria meta, mas não pode apagá-la.
  e := jsonb_populate_record(null::embarques, atualizar_embarque((select v from t96 where k = 'e1'), '{"cadencia_valor":150}', null, true) -> 'registro');
  assert e.cadencia_valor = 150, 'criador altera a meta';
  begin perform atualizar_embarque(e.id, '{"cadencia_valor":null}', null, true); assert false, 'meta não pode ser apagada';
  exception when sqlstate '22023' then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000096a2', false);
do $$ begin
  begin perform atualizar_embarque((select v from t96 where k = 'e1'), '{"cadencia_valor":10}', null, true); assert false, 'outro embarcador não altera a meta';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000096a3', false);
do $$ declare e embarques; begin
  e := jsonb_populate_record(null::embarques, atualizar_embarque((select v from t96 where k = 'e1'), '{"cadencia_valor":4,"cadencia_unidade":"veiculos_dia"}', null, true) -> 'registro');
  assert e.cadencia_valor = 4 and e.cadencia_unidade = 'veiculos_dia', 'gestor (editar meta de qualquer embarque) altera';
end $$;

reset role;
-- Sem a permissão do criador, nem quem criou altera (a decisão fica em Administração → Permissões).
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-0000000096a1', 'embarques.editar_cadencia_proprio', false);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000096a1', false);
do $$ begin
  begin perform atualizar_embarque((select v from t96 where k = 'e1'), '{"cadencia_valor":9}', null, true); assert false, 'permissão retirada bloqueia';
  exception when sqlstate '42501' then null; end;
  begin perform criar_embarque('{"cliente_id":"00000000-0000-0000-0000-0000000096e1","filial_id":"00000000-0000-0000-0000-0000000096f1","origem_cidade":"A","destino_cidade":"B","cadencia_valor":2}');
    assert false, 'sem permissão de meta não cria embarque';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from historico_alteracoes where embarque_id = (select v from t96 where k = 'e1') and campo = 'lote_erp' and valor_novo = 'L-2026-0456'), 'lote no histórico';
end $$;

\o
select 'meta e lote: ok';
