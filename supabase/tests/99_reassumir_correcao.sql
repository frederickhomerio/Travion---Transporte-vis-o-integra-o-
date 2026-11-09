-- Testes da migração 3800: outra pessoa do apoio reassume o chamado com correção recebida.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f8a1', 'reas-com@teste.local', '{"nome":"Comercial Reassumir"}'),
  ('00000000-0000-0000-0000-00000000f8a2', 'reas-ana@teste.local', '{"nome":"Ana Apoio"}'),
  ('00000000-0000-0000-0000-00000000f8a3', 'reas-bia@teste.local', '{"nome":"Bia Apoio"}'),
  ('00000000-0000-0000-0000-00000000f8a4', 'reas-cai@teste.local', '{"nome":"Caio Apoio"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-00000000f8f1', 'FILIAL REAS');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-00000000f8e1', 'CLIENTE REAS');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade) values
  ('00000000-0000-0000-0000-00000000f8b1', '00000000-0000-0000-0000-00000000f8e1', '00000000-0000-0000-0000-00000000f8f1', 'RIO VERDE', 'SANTOS');
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-00000000f8a1';
update perfis set papel = 'apoio', status = 'ativo' where id in ('00000000-0000-0000-0000-00000000f8a2', '00000000-0000-0000-0000-00000000f8a3', '00000000-0000-0000-0000-00000000f8a4');
-- Caio tem a permissão retirada em Administração → Permissões
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-00000000f8a4', 'apoio.reassumir', false);
insert into perfil_filiais (perfil_id, filial_id)
select p, '00000000-0000-0000-0000-00000000f8f1'::uuid from unnest(array['00000000-0000-0000-0000-00000000f8a1', '00000000-0000-0000-0000-00000000f8a2',
  '00000000-0000-0000-0000-00000000f8a3', '00000000-0000-0000-0000-00000000f8a4']::uuid[]) p;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f8a1/nf.pdf', '00000000-0000-0000-0000-00000000f8a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000f8a1/evid.png', '00000000-0000-0000-0000-00000000f8a1', '{"size":900,"mimetype":"image/png"}');

do $$ begin
  assert (select count(*) from papel_permissoes where chave = 'apoio.reassumir' and papel = 'apoio') = 1, 'padrão: apoio reassume';
end $$;

create temporary table tr (k text primary key, v uuid);
grant all on tr to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a1', false);
do $$ declare r jsonb; begin
  r := criar_solicitacao_doc('00000000-0000-0000-0000-00000000f8b1', '{"placa":"REA1S23","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada",
    "frete_motorista":130,"frete_motorista_unidade":"rs_tonelada","tipo_operacao":"exportacao","forma_pagamento":"pagbem","pedagio":"sem_parar",
    "exige_obs_cte":false,"cte_por_nf":false,"chave_envio":"f8000000-0000-0000-0000-000000000001"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-00000000f8a1/nf.pdf","nome":"nf.pdf","categoria":"nf"},
      {"caminho":"envios/00000000-0000-0000-0000-00000000f8a1/evid.png","nome":"evid.png","categoria":"evidencia_frete"}]');
  insert into tr values ('s', (r -> 'registro' ->> 'id')::uuid);
end $$;

-- Ana assume e devolve com erro
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a2', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  perform assumir_solicitacao_doc(s);
  perform solicitar_ajuste_doc(s, 'NF ilegível', 'nf', 'documento_ilegivel');
end $$;

-- Antes da correção ninguém reassume
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a3', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  begin perform retomar_atendimento_doc(s); raise exception 'reassumiu sem correção';
  exception when sqlstate '55000' then assert sqlerrm like '%correção recebida%', sqlerrm; end;
end $$;

-- Comercial corrige
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a1', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  perform responder_ajuste_doc(s, 'Segue a NF legível', '[]');
end $$;

-- Caio sem a permissão não reassume
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a4', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  begin perform retomar_atendimento_doc(s); raise exception 'reassumiu sem permissão';
  exception when sqlstate '42501' then null; end;
end $$;

-- Bia reassume: vira responsável, histórico e aviso para a Ana
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a3', false);
do $$ declare r jsonb; s uuid := (select v from tr where k = 's'); begin
  r := retomar_atendimento_doc(s);
  assert r -> 'registro' ->> 'status' = 'em_atendimento', r::text;
  assert r -> 'registro' ->> 'responsavel_id' = '00000000-0000-0000-0000-00000000f8a3', 'Bia responsável';
  assert (r ->> 'reassumido')::boolean, 'marcado como reassumido';
  r := retomar_atendimento_doc(s);
  assert r ->> 'status' = 'ok', 'clique repetido';
end $$;
reset role;
do $$ declare s uuid := (select v from tr where k = 's'); begin
  assert exists (select 1 from doc_mensagens where solicitacao_id = s and texto = 'Atendimento reassumido por Bia Apoio (estava com Ana Apoio)'), 'histórico';
  assert exists (select 1 from notificacoes where solicitacao_id = s and destinatario_id = '00000000-0000-0000-0000-00000000f8a2'
    and titulo = 'Chamado reassumido por Bia Apoio'), 'aviso para a Ana';
  assert exists (select 1 from solicitacao_eventos where solicitacao_id = s and evento = 'retomado'
    and responsavel_id = '00000000-0000-0000-0000-00000000f8a3'), 'evento retomado com a Bia';
end $$;

-- Ana (antiga responsável) já não retoma: o chamado está com a Bia
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f8a2', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  begin perform retomar_atendimento_doc(s); raise exception 'retomou chamado da Bia';
  exception when sqlstate '55000' then assert sqlerrm like '%já foi retomado por Bia Apoio%', sqlerrm; end;
end $$;
reset role;
\o
select 'reassumir_correcao: ok';
