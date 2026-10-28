-- Testes da aba Cadastro (migração 1700) e da unificação Operação → Apoio Operacional (1710).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'cf7@teste.local', '{"nome":"Comercial Sete"}'),
  ('00000000-0000-0000-0000-0000000007a2', 'ap7a@teste.local', '{"nome":"Apoio Sete"}'),
  ('00000000-0000-0000-0000-0000000007a3', 'ap7b@teste.local', '{"nome":"Apoio Oito"}'),
  ('00000000-0000-0000-0000-0000000007a4', 'cf8@teste.local', '{"nome":"Comercial Outra Filial"}'),
  ('00000000-0000-0000-0000-0000000007a5', 'op7@teste.local', '{"nome":"Operação Antiga"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000007f1', 'FILIAL CAD'), ('00000000-0000-0000-0000-0000000007f2', 'FILIAL OUTRA');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000007e1', 'CLIENTE CAD');
update perfis set papel = 'embarcador', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007a4');
update perfis set papel = 'apoio', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-0000000007a3');
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007f1'),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-0000000007f1'),
  ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-0000000007f1'),
  ('00000000-0000-0000-0000-0000000007a4', '00000000-0000-0000-0000-0000000007f2');

insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000007a1/cnh.pdf', '00000000-0000-0000-0000-0000000007a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000007a1/crlv.jpg', '00000000-0000-0000-0000-0000000007a1', '{"size":900,"mimetype":"image/jpeg"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000007a1/audio.ogg', '00000000-0000-0000-0000-0000000007a1', '{"size":500,"mimetype":"audio/ogg"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000007a1/grande.pdf', '00000000-0000-0000-0000-0000000007a1', '{"size":11000000,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000007a1/script.exe', '00000000-0000-0000-0000-0000000007a1', '{"size":800,"mimetype":"application/x-msdownload"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000007a1/cnh2.docx', '00000000-0000-0000-0000-0000000007a1', '{"size":700,"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}');

create temporary table t7 (k text primary key, v uuid);
grant all on t7 to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a1', false);
do $$
declare r jsonb;
  d jsonb := '{"placa":"rvd 2e45","telefone_motorista":"(64) 99999-0001","mercadoria":"Soja em grãos","cliente_id":"00000000-0000-0000-0000-0000000007e1",
    "valor_carga":"85000.00","origem_cidade":"Rio Verde","origem_uf":"go","destino_cidade":"Santos","destino_uf":"SP","primeiro_embarque":true,
    "filial_id":"00000000-0000-0000-0000-0000000007f1","chave_envio":"20000000-0000-0000-0000-000000000001"}';
  ok jsonb := '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/cnh.pdf","nome":"cnh.pdf","categoria":"motorista"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000007a1/crlv.jpg","nome":"crlv.jpg","categoria":"veiculo"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000007a1/audio.ogg","nome":"audio.ogg","categoria":"veiculo"}]';
begin
  begin perform criar_solicitacao_cadastro(d || '{"telefone_motorista":"9999"}', ok); raise exception 'telefone curto passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_cadastro(d || '{"valor_carga":"-5"}', ok); raise exception 'valor negativo passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_cadastro(d || '{"valor_carga":"85.000,00"}', ok); raise exception 'valor texto passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_cadastro(d - 'primeiro_embarque', ok); raise exception 'sem primeiro embarque passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_cadastro(d || '{"filial_id":"00000000-0000-0000-0000-0000000007f2"}', ok); raise exception 'filial alheia passou'; exception when sqlstate '42501' then null; end;
  begin perform criar_solicitacao_cadastro(d - 'filial_id', ok); raise exception 'sem filial passou'; exception when sqlstate '22023' then null; end;
  -- Sem documento dos veículos
  begin perform criar_solicitacao_cadastro(d, '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/cnh.pdf","nome":"cnh.pdf","categoria":"motorista"}]');
    raise exception 'sem veículo passou'; exception when sqlstate '22023' then null; end;
  -- Acima de 10 MB
  begin perform criar_solicitacao_cadastro(d, ok || '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/grande.pdf","nome":"grande.pdf","categoria":"motorista"}]');
    raise exception '11 MB passou'; exception when sqlstate '22023' then null; end;
  -- Tipo não aceito
  begin perform criar_solicitacao_cadastro(d, ok || '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/script.exe","nome":"script.exe","categoria":"motorista"}]');
    raise exception 'exe passou'; exception when sqlstate '22023' then null; end;
  -- Categoria de emissão não vale no cadastro
  begin perform criar_solicitacao_cadastro(d, ok || '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/cnh2.docx","nome":"cnh2.docx","categoria":"nf"}]');
    raise exception 'categoria nf passou'; exception when sqlstate '22023' then null; end;

  r := criar_solicitacao_cadastro(d, ok);
  assert r ->> 'status' = 'ok', 'cadastro gravado';
  assert r -> 'registro' ->> 'tipo' = 'cadastro' and r -> 'registro' ->> 'status' = 'enviado', 'tipo Cadastro, Enviado';
  assert r -> 'registro' ->> 'placa' = 'RVD2E45', 'placa normalizada';
  assert r -> 'registro' ->> 'telefone_motorista' = '(64) 99999-0001', 'telefone guardado como texto';
  assert (r -> 'registro' ->> 'valor_carga')::numeric = 85000, 'valor 85.000,00';
  assert r -> 'registro' ->> 'embarque_id' is null and r -> 'registro' ->> 'responsavel_id' is null, 'sem embarque e sem responsável';
  assert r -> 'registro' -> 'retrato' ->> 'filial' = 'FILIAL CAD' and r -> 'registro' ->> 'origem_uf' = 'GO', 'retrato e UF';
  insert into t7 values ('c1', (r -> 'registro' ->> 'id')::uuid);
  assert (select count(*) from doc_anexos where solicitacao_id = (select v from t7 where k = 'c1')) = 3, 'anexos gravados (inclui áudio)';
  -- Mesma placa com cadastro aberto: orienta a acompanhar
  r := criar_solicitacao_cadastro(d || '{"chave_envio":"20000000-0000-0000-0000-000000000002"}', ok);
  assert r ->> 'status' = 'cadastro_aberto' and (r -> 'registro' ->> 'id')::uuid = (select v from t7 where k = 'c1'), 'duplicado sinalizado';
  -- Emissão não aceita concluir como cadastro
  begin perform concluir_cadastro_doc((select v from t7 where k = 'c1'), null, null); raise exception 'comercial concluiu'; exception when sqlstate '42501' then null; end;
end $$;

-- Comercial de outra filial não vê o cadastro
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a4', false);
do $$ begin
  assert (select count(*) from solicitacoes_doc where tipo = 'cadastro') = 0, 'fora do escopo não vê';
  assert (select count(*) from doc_anexos a join solicitacoes_doc s on s.id = a.solicitacao_id where s.tipo = 'cadastro') = 0, 'nem os anexos';
  assert (select count(*) from storage.objects where name like 'envios/00000000-0000-0000-0000-0000000007a1/%') = 0, 'nem os arquivos';
end $$;

-- Apoio assume (atômico), pede ajuste; não há lote nem documento emitido no cadastro
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a2', false);
do $$ declare r jsonb; s uuid := (select v from t7 where k = 'c1'); begin
  assert (select count(*) from solicitacoes_doc where tipo = 'cadastro') = 1, 'apoio vê o cadastro na fila';
  assert (select count(*) from storage.objects where name = 'envios/00000000-0000-0000-0000-0000000007a1/cnh.pdf') = 1, 'apoio lê o anexo';
  r := assumir_solicitacao_doc(s);
  assert r ->> 'status' = 'ok' and r -> 'registro' ->> 'status' = 'em_atendimento', 'assumido';
  begin perform registrar_lote_doc(s, 'L1'); raise exception 'lote no cadastro'; exception when sqlstate '55000' then null; end;
  begin perform anexar_documentos_doc(s, '[]'); raise exception 'emitido no cadastro'; exception when sqlstate '55000' then null; end;
  begin perform concluir_solicitacao_doc(s); raise exception 'documentação disponível no cadastro'; exception when sqlstate '55000' then null; end;
  begin perform solicitar_ajuste_doc(s, '  ', null, 'documento_ausente'); raise exception 'ajuste vazio'; exception when sqlstate '22023' then null; end;
  r := solicitar_ajuste_doc(s, 'CNH vencida: envie a nova.', 'motorista', 'divergencia_dados');
  assert r -> 'registro' ->> 'status' = 'aguardando_informacao', 'aguardando informação';
  begin perform concluir_cadastro_doc(s, null, null); raise exception 'concluiu com pendência'; exception when sqlstate '55000' then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a3', false);
do $$ declare r jsonb; begin
  r := assumir_solicitacao_doc((select v from t7 where k = 'c1'));
  assert r ->> 'status' = 'ja_assumida', 'segundo atendente não assume';
end $$;

-- Comercial responde com correção (versão nova, anteriores mantidos)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a1', false);
do $$ declare r jsonb; s uuid := (select v from t7 where k = 'c1'); begin
  assert (select destino from notificacoes where tipo = 'ajuste_solicitado' and solicitacao_id = s) = 'cadastro', 'notificação abre a aba Cadastro';
  r := responder_ajuste_doc(s, 'Segue CNH nova',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/cnh2.docx","nome":"cnh2.docx","categoria":"motorista"}]');
  assert r -> 'registro' ->> 'status' = 'correcao_recebida', 'volta para a fila do responsável';
  assert (select count(*) from doc_anexos where solicitacao_id = s and categoria = 'motorista') = 2, 'anexo anterior preservado';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a2', false);
do $$ declare r jsonb; s uuid := (select v from t7 where k = 'c1'); begin
  assert (select count(*) from notificacoes where tipo = 'resposta_enviada' and solicitacao_id = s) = 1, 'responsável avisado';
  begin perform concluir_cadastro_doc(s, null, null); raise exception 'concluiu sem retomar'; exception when sqlstate '55000' then null; end;
  r := retomar_atendimento_doc(s);
  r := concluir_cadastro_doc(s, 'MOT-8812', 'Motorista e cavalo cadastrados. Pode carregar.');
  assert r -> 'registro' ->> 'status' = 'cadastro_concluido' and r -> 'registro' ->> 'erp_referencia' = 'MOT-8812', 'cadastro concluído';
  begin perform cancelar_solicitacao_doc(s, 'x'); raise exception 'cancelou concluído'; exception when sqlstate '55000' then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a1', false);
do $$ declare r jsonb; begin
  assert (select titulo from notificacoes where tipo = 'cadastro_concluido') = 'Cadastro da placa RVD-2E45 concluído', 'aviso de conclusão';
  -- Depois de concluído, a mesma placa pode ter novo cadastro (atualização legítima)
  r := criar_solicitacao_cadastro('{"placa":"RVD2E45","telefone_motorista":"+55 64 99999-0001","mercadoria":"Milho","cliente_id":"00000000-0000-0000-0000-0000000007e1",
    "valor_carga":12.5,"origem_cidade":"Jataí","origem_uf":"GO","destino_cidade":"Uberaba","destino_uf":"MG","primeiro_embarque":false,
    "filial_id":"00000000-0000-0000-0000-0000000007f1","chave_envio":"20000000-0000-0000-0000-000000000003"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000007a1/audio.ogg","nome":"audio.ogg","categoria":"motorista"},
      {"caminho":"envios/00000000-0000-0000-0000-0000000007a1/crlv.jpg","nome":"crlv.jpg","categoria":"veiculo"}]');
  -- Os caminhos já estão vinculados ao primeiro cadastro (on conflict do nothing): então o servidor exige anexos novos.
  raise exception 'reuso de arquivo passou';
exception when sqlstate '22023' then null;
end $$;
reset role;

-- Unificação: Operação vira Apoio Operacional com as permissões da Operação
do $$ begin
  assert exists (select 1 from papel_permissoes where papel = 'apoio' and chave = 'posicoes.editar_contadores'), 'apoio herda contadores';
  assert exists (select 1 from papel_permissoes where papel = 'apoio' and chave = 'cadastro.ver'), 'apoio vê cadastros';
  assert not exists (select 1 from papel_permissoes where papel = 'apoio' and chave = 'cadastro.solicitar'), 'apoio não pede cadastro';
end $$;
\o
\echo 70_cadastro: ok
