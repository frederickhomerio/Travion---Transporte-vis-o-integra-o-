-- Testes do Apoio Operacional (migrações 1600 e 1610): lote, emissão, fila, pendências, notificações e anexos.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a1', 'cf6@teste.local', '{"nome":"Comercial Fretes"}'),
  ('00000000-0000-0000-0000-0000000006a2', 'ap6@teste.local', '{"nome":"Apoio Um"}'),
  ('00000000-0000-0000-0000-0000000006a3', 'ap7@teste.local', '{"nome":"Apoio Dois"}'),
  ('00000000-0000-0000-0000-0000000006a4', 'fora@teste.local', '{"nome":"Apoio Outra Filial"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000006f1', 'FILIAL SEIS'), ('00000000-0000-0000-0000-0000000006f2', 'FILIAL SETE');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000006e1', 'CLIENTE SEIS');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade) values
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006f1', 'RIO VERDE', 'SANTOS');
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000006a1';
update perfis set papel = 'apoio', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-0000000006a3', '00000000-0000-0000-0000-0000000006a4');
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006f1'),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-0000000006f1'),
  ('00000000-0000-0000-0000-0000000006a3', '00000000-0000-0000-0000-0000000006f1'),
  ('00000000-0000-0000-0000-0000000006a4', '00000000-0000-0000-0000-0000000006f2');

-- Arquivos já enviados ao Storage (o app sobe antes de chamar a função)
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a1/nf1.pdf', '00000000-0000-0000-0000-0000000006a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a1/evid.png', '00000000-0000-0000-0000-0000000006a1', '{"size":900,"mimetype":"image/png"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a1/nf2.pdf', '00000000-0000-0000-0000-0000000006a1', '{"size":1300,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a1/vazio.pdf', '00000000-0000-0000-0000-0000000006a1', '{"size":0,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a1/correcao.pdf', '00000000-0000-0000-0000-0000000006a1', '{"size":700,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a2/cte.pdf', '00000000-0000-0000-0000-0000000006a2', '{"size":2000,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000006a2/cte2.pdf', '00000000-0000-0000-0000-0000000006a2', '{"size":2100,"mimetype":"application/pdf"}');

create temporary table t6 (k text primary key, v uuid);
grant all on t6 to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a1', false);
do $$
declare r jsonb; d jsonb := '{"placa":"abc-1d23","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada","frete_motorista":130,
  "frete_motorista_unidade":"rs_tonelada","tipo_operacao":"mi_tributado","forma_pagamento":"pagbem","pedagio":"sem_parar",
  "exige_obs_cte":true,"obs_cte":"Pedido 4500","cte_por_nf":false,"chave_envio":"10000000-0000-0000-0000-000000000001"}';
begin
  -- Observação exigida vazia
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d || '{"obs_cte":" "}', '[]');
    raise exception 'obs vazia passou'; exception when sqlstate '22023' then null; end;
  -- Sem evidência do frete
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d,
      '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a1/nf1.pdf","nome":"nf1.pdf","categoria":"nf"}]');
    raise exception 'sem evidência passou'; exception when sqlstate '22023' then null; end;
  -- Arquivo vazio não conta
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d,
      '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a1/vazio.pdf","nome":"vazio.pdf","categoria":"nf"}]');
    raise exception 'arquivo vazio passou'; exception when sqlstate '22023' then null; end;
  -- Arquivo de outro usuário
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d,
      '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a2/cte.pdf","nome":"x.pdf","categoria":"nf"}]');
    raise exception 'arquivo alheio passou'; exception when sqlstate '42501' then null; end;

  r := criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d,
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a1/nf1.pdf","nome":"nf1.pdf","categoria":"nf"},
      {"caminho":"envios/00000000-0000-0000-0000-0000000006a1/evid.png","nome":"evid.png","categoria":"evidencia_frete"}]');
  assert r ->> 'status' = 'ok', 'primeira nota gravada';
  assert r -> 'registro' ->> 'tipo' = 'lote_emissao' and r -> 'registro' ->> 'status' = 'enviado', 'Lote e Emissão, Enviado';
  assert r -> 'registro' ->> 'placa' = 'ABC1D23', 'placa normalizada';
  assert r -> 'registro' -> 'retrato' ->> 'cliente' = 'CLIENTE SEIS', 'retrato do embarque';
  insert into t6 values ('s1', (r -> 'registro' ->> 'id')::uuid);
  -- Reenvio do mesmo formulário devolve a mesma solicitação
  r := criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d, '[]');
  assert (r ->> 'repetido')::boolean and (r -> 'registro' ->> 'id')::uuid = (select v from t6 where k = 's1'), 'idempotente';
  -- Com a inicial aberta, o próximo envio vira emissão na fila (migração 3000) e continua exigindo NF
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1', d || '{"chave_envio":"10000000-0000-0000-0000-000000000002"}', '[]');
    raise exception 'emissão na fila sem NF passou'; exception when sqlstate '22023' then null; end;
end $$;

-- Dois atendentes: só um assume
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a2', false);
do $$ declare r jsonb; begin
  assert (select count(*) from solicitacoes_doc) = 1, 'apoio vê a demanda da filial';
  r := assumir_solicitacao_doc((select v from t6 where k = 's1'));
  assert r ->> 'status' = 'ok' and r -> 'registro' ->> 'status' = 'em_atendimento', 'assumida';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a3', false);
do $$ declare r jsonb; begin
  r := assumir_solicitacao_doc((select v from t6 where k = 's1'));
  assert r ->> 'status' = 'ja_assumida' and r -> 'registro' ->> 'responsavel_nome' = 'Apoio Um', 'segundo atendente recebe ja_assumida';
  begin perform registrar_lote_doc((select v from t6 where k = 's1'), '999');
    raise exception 'não responsável registrou lote'; exception when sqlstate '42501' then null; end;
end $$;
-- Apoio de outra filial não vê
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a4', false);
do $$ begin
  assert (select count(*) from solicitacoes_doc) = 0 and (select count(*) from doc_anexos) = 0, 'fora do escopo não vê';
  assert (select count(*) from storage.objects where bucket_id = 'documentacao') = 0, 'arquivos fora do escopo invisíveis';
  begin perform assumir_solicitacao_doc((select v from t6 where k = 's1'));
    raise exception 'fora do escopo assumiu'; exception when sqlstate 'P0002' then null; end;
end $$;

-- Responsável: conclusão exige documento emitido e lote; NF não conta
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a2', false);
do $$ declare r jsonb; s uuid := (select v from t6 where k = 's1'); begin
  assert (select count(*) from storage.objects where bucket_id = 'documentacao') = 4, 'apoio lê os anexos vinculados e os próprios envios';
  begin perform concluir_solicitacao_doc(s); raise exception 'concluiu sem emitido'; exception when sqlstate '55000' then null; end;
  -- Sem lote vinculado não anexa os emitidos (migração 3100)
  begin perform anexar_documentos_doc(s, '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a2/cte.pdf","nome":"cte.pdf","categoria":"cte"}]');
    raise exception 'anexou sem lote'; exception when sqlstate '55000' then null; end;
  r := registrar_lote_doc(s, ' L-2026-77 ');
  assert r -> 'lote' ->> 'numero' = 'L-2026-77' and r -> 'registro' ->> 'status' = 'em_atendimento', 'lote registrado, emissão segue em atendimento';
  begin perform anexar_documentos_doc(s, '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a2/cte.pdf","nome":"cte.pdf","categoria":"nf"}]');
    raise exception 'apoio anexou NF como emitido'; exception when sqlstate '22023' then null; end;
  r := anexar_documentos_doc(s, '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a2/cte.pdf","nome":"cte.pdf","categoria":"cte"}]');
  assert r -> 'registro' ->> 'status' = 'em_atendimento', 'anexar não conclui';
  r := registrar_lote_doc(s, 'L-2026-78');
  assert exists (select 1 from doc_mensagens where solicitacao_id = s and texto like 'Número do lote corrigido de L-2026-77 para L-2026-78%'), 'correção auditada';
  -- Pendência vazia não; com texto notifica o solicitante
  begin perform solicitar_ajuste_doc(s, '  ', null, 'documento_ilegivel'); raise exception 'pendência vazia'; exception when sqlstate '22023' then null; end;
  r := solicitar_ajuste_doc(s, 'NF ilegível, enviar de novo', 'nf', 'documento_ilegivel');
  assert r -> 'registro' ->> 'status' = 'aguardando_informacao', 'aguardando informação';
  begin perform concluir_solicitacao_doc(s); raise exception 'concluiu com pendência'; exception when sqlstate '55000' then null; end;
end $$;

-- Comercial: notificação, próximo veículo (Emissão com o lote), resposta
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a1', false);
do $$ declare r jsonb; s uuid := (select v from t6 where k = 's1'); begin
  assert (select count(*) from notificacoes where tipo = 'ajuste_solicitado') = 1, 'solicitante notificado do ajuste';
  r := criar_solicitacao_doc('00000000-0000-0000-0000-0000000006b1',
    '{"placa":"ABC1D23","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada","frete_motorista":128,"frete_motorista_unidade":"rs_tonelada",
      "forma_pagamento":"cheque","pedagio":"nao_ha","exige_obs_cte":false,"cte_por_nf":true,"chave_envio":"10000000-0000-0000-0000-000000000003"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a1/nf2.pdf","nome":"nf2.pdf","categoria":"nf"}]');
  assert r -> 'registro' ->> 'tipo' = 'emissao' and r -> 'registro' ->> 'tipo_operacao' = 'mi_tributado', 'Emissão herda o tipo de operação do lote';
  assert r -> 'registro' -> 'retrato' ->> 'lote_numero' = 'L-2026-78', 'Emissão vinculada ao lote';
  begin perform responder_ajuste_doc(s, '', '[]'); raise exception 'resposta vazia'; exception when sqlstate '22023' then null; end;
  r := responder_ajuste_doc(s, 'Segue NF nova', '[{"caminho":"envios/00000000-0000-0000-0000-0000000006a1/correcao.pdf","nome":"nf1-v2.pdf","categoria":"nf"}]');
  assert r -> 'registro' ->> 'status' = 'correcao_recebida', 'volta para a fila do responsável';
  assert (select count(*) from doc_anexos where solicitacao_id = s and categoria = 'nf') = 2, 'NF anterior preservada';
  assert exists (select 1 from doc_mensagens where solicitacao_id = s and tipo = 'pendencia' and texto = 'NF ilegível, enviar de novo'), 'pendência fica no histórico';
  assert marcar_notificacoes_lidas(null) = 1, 'marca lidas';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a2', false);
do $$ declare r jsonb; s uuid := (select v from t6 where k = 's1'); begin
  assert (select count(*) from notificacoes where tipo = 'resposta_enviada') = 1, 'responsável notificado da resposta';
  begin perform concluir_solicitacao_doc(s); raise exception 'concluiu sem retomar'; exception when sqlstate '55000' then null; end;
  r := retomar_atendimento_doc(s);
  assert r -> 'registro' ->> 'status' = 'em_atendimento', 'retomado';
  r := concluir_solicitacao_doc(s);
  assert r -> 'registro' ->> 'status' = 'documentacao_disponivel', 'documentação disponível';
  assert (select count(*) from solicitacoes_doc where tipo = 'emissao' and status = 'enviado') = 1, 'próximo veículo na fila';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a1', false);
do $$ declare r jsonb; begin
  assert (select count(*) from notificacoes where tipo = 'documentacao_disponivel' and lida_em is null) = 1, 'comercial avisado';
  -- Cancelamento: solicitante só enquanto ninguém assumiu, com motivo
  begin perform cancelar_solicitacao_doc((select id from solicitacoes_doc where tipo = 'emissao'), ''); raise exception 'sem motivo'; exception when sqlstate '22023' then null; end;
  r := cancelar_solicitacao_doc((select id from solicitacoes_doc where tipo = 'emissao'), 'Placa errada');
  assert r -> 'registro' ->> 'status' = 'cancelado', 'cancelada';
  begin perform cancelar_solicitacao_doc((select v from t6 where k = 's1'), 'x'); raise exception 'cancelou concluída'; exception when sqlstate '55000' then null; end;
end $$;
reset role;
