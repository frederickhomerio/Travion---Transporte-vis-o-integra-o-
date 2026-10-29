-- Testes da migração 3000: emissão na fila enquanto o lote é gerado.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f3a1', 'fila-com@teste.local', '{"nome":"Comercial Fila"}'),
  ('00000000-0000-0000-0000-00000000f3a2', 'fila-apoio@teste.local', '{"nome":"Apoio Fila"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-00000000f3f1', 'FILIAL FILA');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-00000000f3e1', 'CLIENTE FILA');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade) values
  ('00000000-0000-0000-0000-00000000f3b1', '00000000-0000-0000-0000-00000000f3e1', '00000000-0000-0000-0000-00000000f3f1', 'MONTIVIDIU', 'QUIRINOPOLIS');
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-00000000f3a1';
update perfis set papel = 'apoio', status = 'ativo' where id = '00000000-0000-0000-0000-00000000f3a2';
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-00000000f3a1', '00000000-0000-0000-0000-00000000f3f1'),
  ('00000000-0000-0000-0000-00000000f3a2', '00000000-0000-0000-0000-00000000f3f1');
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f3a1/nf1.pdf', '00000000-0000-0000-0000-00000000f3a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f3a1/evid.png', '00000000-0000-0000-0000-00000000f3a1', '{"size":900,"mimetype":"image/png"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f3a1/nf2.pdf', '00000000-0000-0000-0000-00000000f3a1', '{"size":1300,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f3a1/nf3.pdf', '00000000-0000-0000-0000-00000000f3a1', '{"size":1300,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f3a2/cte.pdf', '00000000-0000-0000-0000-00000000f3a2', '{"size":2000,"mimetype":"application/pdf"}');

create temporary table tf (k text primary key, v uuid);
grant all on tf to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f3a1', false);
do $$
declare r jsonb; d jsonb := '{"placa":"ABC1D23","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada","frete_motorista":130,
  "frete_motorista_unidade":"rs_tonelada","tipo_operacao":"exportacao","forma_pagamento":"pagbem","pedagio":"sem_parar",
  "exige_obs_cte":false,"cte_por_nf":false}';
begin
  r := criar_solicitacao_doc('00000000-0000-0000-0000-00000000f3b1', d || '{"chave_envio":"f3000000-0000-0000-0000-000000000001"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-00000000f3a1/nf1.pdf","nome":"nf1.pdf","categoria":"nf"},
      {"caminho":"envios/00000000-0000-0000-0000-00000000f3a1/evid.png","nome":"evid.png","categoria":"evidencia_frete"}]');
  assert r -> 'registro' ->> 'tipo' = 'lote_emissao', 'primeira nota';
  insert into tf values ('ini', (r -> 'registro' ->> 'id')::uuid);
  -- Lote ainda não registrado: os próximos veículos entram na fila como emissão, sem evidência do frete nem tipo de operação
  r := criar_solicitacao_doc('00000000-0000-0000-0000-00000000f3b1',
    d - 'tipo_operacao' || '{"placa":"DEF2G34","chave_envio":"f3000000-0000-0000-0000-000000000002"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-00000000f3a1/nf2.pdf","nome":"nf2.pdf","categoria":"nf"}]');
  assert r ->> 'status' = 'ok' and r -> 'registro' ->> 'tipo' = 'emissao', 'emissão na fila: ' || r::text;
  assert r -> 'registro' ->> 'lote_id' is null and r -> 'registro' ->> 'tipo_operacao' = 'exportacao', 'sem lote, herda a operação';
  insert into tf values ('e1', (r -> 'registro' ->> 'id')::uuid);
  r := criar_solicitacao_doc('00000000-0000-0000-0000-00000000f3b1',
    d || '{"placa":"GHI3J45","chave_envio":"f3000000-0000-0000-0000-000000000003"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-00000000f3a1/nf3.pdf","nome":"nf3.pdf","categoria":"nf"}]');
  assert r -> 'registro' ->> 'tipo' = 'emissao', 'várias na fila';
  insert into tf values ('e2', (r -> 'registro' ->> 'id')::uuid);
  assert (select count(*) from solicitacoes_doc where embarque_id = '00000000-0000-0000-0000-00000000f3b1') = 3, 'três solicitações';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f3a2', false);
do $$ declare r jsonb; e1 uuid := (select v from tf where k = 'e1'); ini uuid := (select v from tf where k = 'ini'); begin
  perform assumir_solicitacao_doc(e1);
  perform anexar_documentos_doc(e1, '[{"caminho":"envios/00000000-0000-0000-0000-00000000f3a2/cte.pdf","nome":"cte.pdf","categoria":"cte"}]');
  begin perform concluir_solicitacao_doc(e1); raise exception 'emissão sem lote liberada';
  exception when sqlstate '55000' then assert sqlerrm like '%fila do lote%', sqlerrm; end;
  perform assumir_solicitacao_doc(ini);
  r := registrar_lote_doc(ini, 'L-FILA-1');
  assert (select count(*) from solicitacoes_doc where tipo = 'emissao' and embarque_id = '00000000-0000-0000-0000-00000000f3b1'
    and lote_id = (r -> 'lote' ->> 'id')::uuid and retrato ->> 'lote_numero' = 'L-FILA-1') = 2, 'fila vinculada ao lote';
  r := concluir_solicitacao_doc(e1);
  assert r -> 'registro' ->> 'status' = 'documentacao_disponivel', 'liberada depois do lote';
end $$;
reset role;
\o
select 'emissao_fila: ok';
