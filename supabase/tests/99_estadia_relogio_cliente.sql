-- Relógio do cliente na Estadia (migração 4600). Usa as estadias criadas em 95_estadia.sql.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into storage.objects (bucket_id, name, owner, metadata)
select 'documentacao', 'envios/00000000-0000-0000-0000-0000000095a2/' || n, '00000000-0000-0000-0000-0000000095a2', '{"size":900,"mimetype":"image/png"}'
  from unnest(array['ret9.png', 'pag9.png']) n;

create temporary table t9 as
  select 'e2'::text k, id v from solicitacoes_doc where tipo = 'estadia' and to_jsonb(est_documentos) = '["999"]'::jsonb;
grant all on t9 to authenticated;

-- e2 foi reaberta pelo gestor (em atendimento com o Apoio Estadia); a rodada 1 já foi fechada em 95.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a2', false);
set role authenticated;
do $$ declare r jsonb; s uuid := (select v from t9 where k = 'e2'); begin
  assert (select est_rodadas_cliente from solicitacoes_doc where id = s) = 1 and (select est_cliente_desde from solicitacoes_doc where id = s) is null, 'rodada 1 fechada';
  r := encaminhar_cliente_estadia(s, 'Contestação reenviada');
  assert r -> 'registro' ->> 'status' = 'aguardando_cliente' and (r -> 'registro' ->> 'est_rodadas_cliente')::int = 2
     and r -> 'registro' ->> 'est_cliente_desde' is not null, 'rodada 2 aberta';
  begin perform encaminhar_cliente_estadia(s, null); raise exception 'encaminhou com rodada aberta'; exception when sqlstate '55000' then null; end;
end $$;

-- Simula 3 dias com o cliente
reset role;
update solicitacoes_doc set est_cliente_desde = now() - interval '3 days' where id = (select v from t9 where k = 'e2');
set role authenticated;

do $$ declare r jsonb; s uuid := (select v from t9 where k = 'e2');
  ev text := '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/ret9.png","nome":"ret9.png","categoria":"est_retorno"}]';
begin
  begin perform registrar_retorno_estadia(s, jsonb_build_object('resultado', 'rejeitada', 'justificativa', 'x', 'retorno_em', now() + interval '1 hour'), ev::jsonb);
    raise exception 'retorno no futuro passou'; exception when sqlstate '22023' then null; end;
  begin perform registrar_retorno_estadia(s, jsonb_build_object('resultado', 'rejeitada', 'justificativa', 'x', 'retorno_em', now() - interval '4 days'), ev::jsonb);
    raise exception 'retorno antes do encaminhamento passou'; exception when sqlstate '22023' then null; end;
  -- Cliente respondeu há 1 dia; o apoio registrou só agora: 2 dias do cliente, 1 dia volta para a TP.
  r := registrar_retorno_estadia(s, jsonb_build_object('resultado', 'rejeitada', 'justificativa', 'Mantém a recusa', 'retorno_em', now() - interval '1 day'), ev::jsonb);
  assert r -> 'registro' ->> 'status' = 'em_atendimento' and r -> 'registro' ->> 'est_cliente_desde' is null, 'rodada 2 fechada';
  assert (r -> 'registro' ->> 'est_cliente_seg')::int between 172800 and 172802, 'cliente: 2 dias (veio ' || (r -> 'registro' ->> 'est_cliente_seg') || ')';
  assert (r -> 'retorno' ->> 'tempo_cliente_seg')::int between 172800 and 172802 and (r -> 'retorno' ->> 'rodada')::int = 2, 'rodada guardada no retorno';
  assert (r -> 'retorno' ->> 'data_retorno')::date = ((now() - interval '1 day') at time zone 'America/Sao_Paulo')::date, 'data do retorno sai da data e hora';
  assert exists (select 1 from doc_mensagens where solicitacao_id = s and texto like '%cliente levou 2 d 0 h (rodada 2)%'), 'tempo do cliente no histórico';

  -- Pagamento antes de encaminhar: relógio do cliente continua parado
  r := registrar_pagamento_estadia(s, '{"valor_pago":"100","data_pagamento":"2026-10-20"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/pag9.png","nome":"pag9.png","categoria":"est_pagamento"}]');
  assert r -> 'registro' ->> 'status' = 'pago_pendencia' and r -> 'registro' ->> 'est_cliente_desde' is null, 'pago sem encaminhar: relógio do cliente parado';
  -- Encaminhar em Pago em pendência abre a rodada 3 sem mudar a situação
  r := encaminhar_cliente_estadia(s, null);
  assert r -> 'registro' ->> 'status' = 'pago_pendencia' and (r -> 'registro' ->> 'est_rodadas_cliente')::int = 3
     and r -> 'registro' ->> 'est_cliente_desde' is not null, 'rodada 3 aberta em pago em pendência';
end $$;

-- Avisos de prazo (rotina de hora em hora): 7 e 15 dias, sem repetir
reset role;
update solicitacoes_doc set est_cliente_desde = now() - interval '8 days' where id = (select v from t9 where k = 'e2');
select private.estadia_alertar_cliente();
select private.estadia_alertar_cliente();
do $$ begin
  assert (select count(*) from notificacoes where chave like 'estadia_prazo_cliente:%') = 1, 'um aviso de 7 dias';
  assert (select destinatario_id from notificacoes where chave like 'estadia_prazo_cliente:%') = '00000000-0000-0000-0000-0000000095a1', 'aviso ao solicitante';
end $$;
update solicitacoes_doc set est_cliente_desde = now() - interval '16 days' where id = (select v from t9 where k = 'e2');
select private.estadia_alertar_cliente();
do $$ begin
  assert (select count(*) from notificacoes where chave like 'estadia_prazo_cliente:%') = 2
     and exists (select 1 from notificacoes where titulo = 'Cliente sem retorno há mais de 15 dias'), 'aviso de 15 dias';
end $$;

-- Cancelamento com rodada aberta: fecha a rodada no cancelamento
update solicitacoes_doc set est_cliente_desde = now() - interval '1 hour' where id = (select v from t9 where k = 'e2');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a5', false);
set role authenticated;
do $$ declare r jsonb; s uuid := (select v from t9 where k = 'e2'); begin
  r := cancelar_solicitacao_doc(s, 'Teste do relógio');
  assert r -> 'registro' ->> 'status' = 'cancelado' and r -> 'registro' ->> 'est_cliente_desde' is null, 'cancelada fecha a rodada';
  assert (r -> 'registro' ->> 'est_cliente_seg')::int between 172800 + 3599 and 172802 + 3601, 'mais 1 h de cliente';
end $$;
reset role;
\o
\echo 99_estadia_relogio_cliente: ok
