-- Testes do Painel Operacional (migração 1900): eventos do fluxo, motivo da devolução, retomada, imutabilidade,
-- permissão e escopo da consulta do painel.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'cf9@teste.local', '{"nome":"Comercial Nove"}'),
  ('00000000-0000-0000-0000-0000000009a2', 'ap9@teste.local', '{"nome":"Apoio Nove"}'),
  ('00000000-0000-0000-0000-0000000009a3', 'ap9b@teste.local', '{"nome":"Apoio Outra Filial"}'),
  ('00000000-0000-0000-0000-0000000009a4', 'ge9@teste.local', '{"nome":"Gestor Nove"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000009f1', 'FILIAL NOVE'), ('00000000-0000-0000-0000-0000000009f2', 'FILIAL DEZ');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000009e1', 'CLIENTE NOVE');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009f1', 'JATAI', 'SANTOS');
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000009a1';
update perfis set papel = 'apoio', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000009a2', '00000000-0000-0000-0000-0000000009a3');
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000009a4';
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009f1'),
  ('00000000-0000-0000-0000-0000000009a2', '00000000-0000-0000-0000-0000000009f1'),
  ('00000000-0000-0000-0000-0000000009a3', '00000000-0000-0000-0000-0000000009f2'),
  ('00000000-0000-0000-0000-0000000009a4', '00000000-0000-0000-0000-0000000009f1');
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000009a1/nf.pdf', '00000000-0000-0000-0000-0000000009a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000009a1/evid.png', '00000000-0000-0000-0000-0000000009a1', '{"size":900,"mimetype":"image/png"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000009a2/cte.pdf', '00000000-0000-0000-0000-0000000009a2', '{"size":2000,"mimetype":"application/pdf"}');

create temporary table t9 (k text primary key, v uuid);
grant all on t9 to authenticated;

set role authenticated;
-- Envio grava o evento "enviado" com o horário do envio
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a1', false);
do $$ declare r jsonb; begin
  r := criar_solicitacao_doc('00000000-0000-0000-0000-0000000009b1',
    '{"placa":"JTA9A99","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada","frete_motorista":130,"frete_motorista_unidade":"rs_tonelada",
      "tipo_operacao":"mi_tributado","forma_pagamento":"pagbem","pedagio":"sem_parar","exige_obs_cte":false,"cte_por_nf":false,
      "chave_envio":"90000000-0000-0000-0000-000000000001"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000009a1/nf.pdf","nome":"nf.pdf","categoria":"nf"},
      {"caminho":"envios/00000000-0000-0000-0000-0000000009a1/evid.png","nome":"evid.png","categoria":"evidencia_frete"}]');
  insert into t9 values ('s', (r -> 'registro' ->> 'id')::uuid);
  -- Reenvio do mesmo formulário não cria outro chamado nem outro evento
  r := criar_solicitacao_doc('00000000-0000-0000-0000-0000000009b1', '{"chave_envio":"90000000-0000-0000-0000-000000000001"}', '[]');
  assert (select count(*) from solicitacao_eventos where solicitacao_id = (select v from t9 where k = 's')) = 1, 'um evento de envio';
  assert (select evento from solicitacao_eventos where solicitacao_id = (select v from t9 where k = 's')) = 'enviado', 'evento enviado';
  -- Comercial não tem o painel por padrão
  begin perform painel_operacional(now() - interval '1 day', now() + interval '1 day'); raise exception 'comercial viu o painel';
  exception when sqlstate '42501' then null; end;
  -- Histórico imutável para usuários
  begin insert into solicitacao_eventos (solicitacao_id, evento, status_novo, ator_nome) values ((select v from t9 where k = 's'), 'enviado', 'enviado', 'x');
    raise exception 'usuário inseriu evento'; exception when insufficient_privilege then null; end;
  begin update solicitacao_eventos set ator_nome = 'x'; raise exception 'usuário alterou evento'; exception when insufficient_privilege then null; end;
  begin delete from solicitacao_eventos; raise exception 'usuário apagou evento'; exception when insufficient_privilege then null; end;
end $$;

-- Apoio: assume, devolve duas vezes (motivo obrigatório), retoma após cada correção e conclui
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a2', false);
do $$ declare r jsonb; s uuid := (select v from t9 where k = 's'); begin
  r := assumir_solicitacao_doc(s);
  r := assumir_solicitacao_doc(s); -- clique repetido
  assert (select count(*) from solicitacao_eventos where solicitacao_id = s and evento = 'assumido') = 1, 'assumir não duplica';
  begin perform solicitar_ajuste_doc(s, 'NF sem chave', 'nf'); raise exception 'ajuste sem motivo'; exception when sqlstate '22023' then null; end;
  begin perform solicitar_ajuste_doc(s, 'NF sem chave', 'nf', 'xyz'); raise exception 'motivo inválido'; exception when sqlstate '22023' then null; end;
  begin perform solicitar_ajuste_doc(s, 'NF sem chave', 'nf', 'outro'); raise exception 'outro sem descrição'; exception when sqlstate '22023' then null; end;
  assert (select count(*) from solicitacao_eventos where solicitacao_id = s and evento = 'devolvido') = 0, 'falha não grava evento';
  r := solicitar_ajuste_doc(s, 'NF sem chave de acesso', 'nf', 'documento_ilegivel');
  assert r -> 'registro' ->> 'status' = 'aguardando_informacao', 'devolvido';
  assert (select motivo from solicitacao_eventos where solicitacao_id = s and evento = 'devolvido') = 'documento_ilegivel', 'motivo no evento';
  assert (select motivo from doc_mensagens where solicitacao_id = s and tipo = 'pendencia') = 'documento_ilegivel', 'motivo na pendência';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a1', false);
do $$ declare r jsonb; begin
  r := responder_ajuste_doc((select v from t9 where k = 's'), 'Segue NF', '[]');
  assert r -> 'registro' ->> 'status' = 'correcao_recebida', 'correção volta para a fila';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a3', false);
do $$ begin
  begin perform retomar_atendimento_doc((select v from t9 where k = 's')); raise exception 'outra filial retomou';
  exception when sqlstate 'P0002' then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a2', false);
do $$ declare r jsonb; s uuid := (select v from t9 where k = 's'); begin
  begin perform solicitar_ajuste_doc(s, 'x', null, 'documento_ausente'); raise exception 'devolveu sem retomar'; exception when sqlstate '55000' then null; end;
  r := retomar_atendimento_doc(s);
  assert r -> 'registro' ->> 'status' = 'em_atendimento', 'retomado';
  r := retomar_atendimento_doc(s); -- clique repetido
  assert (select count(*) from solicitacao_eventos where solicitacao_id = s and evento = 'retomado') = 1, 'retomar não duplica';
  r := solicitar_ajuste_doc(s, 'Placa da carreta diverge', 'placa', 'outro', 'Placa da carreta');
  assert (select motivo_outro from solicitacao_eventos where solicitacao_id = s and evento = 'devolvido' and motivo = 'outro') = 'Placa da carreta', 'descrição do outro';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a1', false);
do $$ declare r jsonb; begin r := responder_ajuste_doc((select v from t9 where k = 's'), 'Corrigido', '[]'); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a2', false);
do $$ declare r jsonb; s uuid := (select v from t9 where k = 's'); begin
  r := retomar_atendimento_doc(s);
  r := registrar_lote_doc(s, 'L-9');
  r := anexar_documentos_doc(s, '[{"caminho":"envios/00000000-0000-0000-0000-0000000009a2/cte.pdf","nome":"cte.pdf","categoria":"cte"}]');
  r := concluir_solicitacao_doc(s);
  -- Sequência completa, sem eventos de ações que não mudam a etapa (lote, anexos)
  assert (select string_agg(evento, ',' order by criado_em, id) from solicitacao_eventos where solicitacao_id = s)
    = 'enviado,assumido,devolvido,corrigido,retomado,devolvido,corrigido,retomado,concluido', 'ciclos preservados';
  assert (select count(*) from solicitacao_eventos where solicitacao_id = s and origem = 'registro') = 9, 'origem registro';
  assert (select responsavel_nome from solicitacao_eventos where solicitacao_id = s and evento = 'concluido') = 'Apoio Nove', 'responsável no encerramento';
  -- Painel: o apoio da filial vê o chamado e os eventos
  r := painel_operacional(now() - interval '1 day', now() + interval '1 day');
  assert jsonb_array_length(r -> 'solicitacoes') = 1 and jsonb_array_length(r -> 'eventos') = 9, 'painel com eventos';
  assert not (r -> 'solicitacoes' -> 0) ? 'placa' and not (r -> 'solicitacoes' -> 0) ? 'frete_empresa', 'sem placa e sem valores';
  assert r ->> 'inicio_registro' is not null, 'início da medição';
  -- Incremental: nada mudou desde agora + 1 min
  r := painel_operacional(now() - interval '1 day', now() + interval '1 day', now() + interval '1 minute');
  assert jsonb_array_length(r -> 'solicitacoes') = 0, 'incremental vazio';
  begin perform painel_operacional(now(), now() - interval '1 day'); raise exception 'período invertido'; exception when sqlstate '22023' then null; end;
  begin perform painel_operacional(now() - interval '500 days', now()); raise exception 'período longo'; exception when sqlstate '22023' then null; end;
end $$;
-- Apoio de outra filial: painel vazio (escopo aplicado no servidor)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a3', false);
do $$ declare r jsonb; begin
  r := painel_operacional(now() - interval '1 day', now() + interval '1 day');
  assert jsonb_array_length(r -> 'solicitacoes') = 0 and jsonb_array_length(r -> 'eventos') = 0, 'fora do escopo não vê';
  assert (select count(*) from solicitacao_eventos) = 0, 'eventos fora do escopo invisíveis';
end $$;
-- Gestor da filial vê
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a4', false);
do $$ declare r jsonb; begin
  r := painel_operacional(now() - interval '1 day', now() + interval '1 day');
  assert jsonb_array_length(r -> 'solicitacoes') = 1, 'gestor vê';
end $$;
reset role;
-- anon não executa
do $$ begin
  assert not has_function_privilege('anon', 'public.painel_operacional(timestamptz, timestamptz, timestamptz)', 'execute'), 'anon sem painel';
  assert not has_function_privilege('anon', 'public.retomar_atendimento_doc(uuid)', 'execute'), 'anon sem retomar';
  assert exists (select 1 from papel_permissoes where papel = 'apoio' and chave = 'analise.operacional'), 'apoio tem por padrão';
end $$;
\o
\echo 90_painel_operacional: ok
