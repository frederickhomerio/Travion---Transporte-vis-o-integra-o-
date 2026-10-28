-- Testes da aba Estadia (migração 2000): envio, cálculo, conferência, retorno do cliente, pagamento, encerramento e reabertura.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000095a1', 'est-com@teste.local', '{"nome":"Comercial Estadia"}'),
  ('00000000-0000-0000-0000-0000000095a2', 'est-ap1@teste.local', '{"nome":"Apoio Estadia"}'),
  ('00000000-0000-0000-0000-0000000095a3', 'est-ap2@teste.local', '{"nome":"Apoio Dois"}'),
  ('00000000-0000-0000-0000-0000000095a4', 'est-out@teste.local', '{"nome":"Comercial Outra"}'),
  ('00000000-0000-0000-0000-0000000095a5', 'est-ges@teste.local', '{"nome":"Gestor Estadia"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000095f1', 'FILIAL EST'), ('00000000-0000-0000-0000-0000000095f2', 'FILIAL EST OUTRA');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000095e1', 'CLIENTE EST');
update perfis set papel = 'embarcador', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000095a1', '00000000-0000-0000-0000-0000000095a4');
update perfis set papel = 'apoio', status = 'ativo' where id in ('00000000-0000-0000-0000-0000000095a2', '00000000-0000-0000-0000-0000000095a3');
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-0000000095a5';
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000095a1', '00000000-0000-0000-0000-0000000095f1'),
  ('00000000-0000-0000-0000-0000000095a2', '00000000-0000-0000-0000-0000000095f1'),
  ('00000000-0000-0000-0000-0000000095a3', '00000000-0000-0000-0000-0000000095f1'),
  ('00000000-0000-0000-0000-0000000095a4', '00000000-0000-0000-0000-0000000095f2'),
  ('00000000-0000-0000-0000-0000000095a5', '00000000-0000-0000-0000-0000000095f1');

insert into storage.objects (bucket_id, name, owner, metadata)
select 'documentacao', 'envios/00000000-0000-0000-0000-0000000095a1/' || n, '00000000-0000-0000-0000-0000000095a1', '{"size":1200,"mimetype":"application/pdf"}'
  from unnest(array['cte1.pdf', 'nf1.pdf', 'comp1.pdf', 'comp2.pdf', 'trat1.pdf', 'cte2.pdf', 'nf2.pdf', 'comp3.pdf', 'cte3.pdf', 'nf3.pdf', 'comp4.pdf', 'resp.pdf']) n;
insert into storage.objects (bucket_id, name, owner, metadata)
select 'documentacao', 'envios/00000000-0000-0000-0000-0000000095a2/' || n, '00000000-0000-0000-0000-0000000095a2', '{"size":900,"mimetype":"image/png"}'
  from unnest(array['ret1.png', 'pag1.png', 'ret2.png', 'ret3.png', 'ret4.png']) n;

create temporary table t9 (k text primary key, v uuid);
grant all on t9 to authenticated;

-- Regra de cálculo isolada: exemplo da especificação, limite exato e retroagir aplicado uma única vez
do $$ declare c record; begin
  select * into c from private.estadia_calcular('2026-10-02 13:09-03', '2026-10-03 16:37-03', 0.45, 37.6, 24, 12);
  assert round(c.permanencia_h, 4) = 27.4667, 'permanência 27h28';
  assert round(c.horas_validas, 4) = 15.4667, 'horas válidas 15h28';
  assert c.valor = 261.70, 'R$ 261,70 (veio ' || c.valor || ')';
  select * into c from private.estadia_calcular('2026-10-02 10:00-03', '2026-10-03 10:00-03', 0.45, 37.6, 24, 12);
  assert c.horas_validas = 0 and c.valor = 0, 'no limite exato não cobra';
  select * into c from private.estadia_calcular('2026-10-02 10:00-03', '2026-10-03 10:01-03', 0.45, 37.6, 24, 12);
  assert round(c.horas_validas, 4) = 12.0167 and c.valor = 203.32, 'um minuto acima do limite cobra 12h01 (retroage 12 h uma vez)';
  select * into c from private.estadia_calcular('2026-10-02 10:00-03', '2026-10-02 15:00-03', 0.45, 37.6, 2, 12);
  assert c.horas_validas = 0 and c.valor = 0, 'retroagir maior que a permanência dá zero, nunca negativo';
  select * into c from private.estadia_calcular('2026-10-02 10:00-03', '2026-10-02 15:30-03', 1, 10, 0, 0);
  assert c.horas_validas = 5.5 and c.valor = 55, 'sem limite nem retroagir: 5h30 inteiras';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a1', false);
do $$
declare r jsonb;
  d jsonb := '{"tipo_documento":"cte","documentos":[" 000123 ","000124","000123"],"placa":"rvd-2e45","cliente_id":"00000000-0000-0000-0000-0000000095e1",
    "nfs_carga":["0045871"],"sindicato":false,"inicio":"2026-10-02T13:09:00-03:00","saida":"2026-10-03T16:37:00-03:00",
    "tarifa":"0.45","peso":"37.6","peso_unidade":"t","motivo":"demora_descarga","modalidade":"padrao",
    "filial_id":"00000000-0000-0000-0000-0000000095f1","chave_envio":"30000000-0000-0000-0000-000000000001"}';
  ok jsonb := '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a1/cte1.pdf","nome":"cte1.pdf","categoria":"est_documento"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/nf1.pdf","nome":"nf1.pdf","categoria":"est_nf_carga"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/comp1.pdf","nome":"comp1.pdf","categoria":"est_comprovante"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/comp2.pdf","nome":"comp2.pdf","categoria":"est_comprovante"}]';
begin
  begin perform criar_solicitacao_estadia(d - 'tipo_documento', ok); raise exception 'sem tipo de documento passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"documentos":[]}', ok); raise exception 'sem número do CT-e passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"documentos":["12#34"]}', ok); raise exception 'número com caractere inválido passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"sindicato":true}', ok); raise exception 'sindicato sem nome passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"saida":"2026-10-02T12:00:00-03:00"}', ok); raise exception 'saída antes do início passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || jsonb_build_object('saida', now() + interval '2 days'), ok); raise exception 'saída no futuro passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"tarifa":"0"}', ok); raise exception 'tarifa zero passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d - 'peso', ok); raise exception 'sem peso passou (nunca assumir 40 t)'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d - 'peso_unidade', ok); raise exception 'sem unidade passou (nunca inferir)'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"peso":"37600"}', ok); raise exception '37600 t passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"motivo":"outro"}', ok); raise exception 'outro sem descrição passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"modalidade":"acordo","acordo_valor":"300"}', ok); raise exception 'acordo incompleto passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d || '{"filial_id":"00000000-0000-0000-0000-0000000095f2"}', ok); raise exception 'filial alheia passou'; exception when sqlstate '42501' then null; end;
  begin perform criar_solicitacao_estadia(d, '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a1/cte1.pdf","nome":"cte1.pdf","categoria":"est_documento"},
      {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/nf1.pdf","nome":"nf1.pdf","categoria":"est_nf_carga"}]');
    raise exception 'sem comprovantes passou'; exception when sqlstate '22023' then null; end;
  begin perform criar_solicitacao_estadia(d, ok || '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a1/trat1.pdf","nome":"trat1.pdf","categoria":"cte"}]');
    raise exception 'categoria de emissão passou'; exception when sqlstate '22023' then null; end;

  r := criar_solicitacao_estadia(d, ok);
  assert r ->> 'status' = 'ok', 'estadia gravada';
  assert r -> 'registro' ->> 'tipo' = 'estadia' and r -> 'registro' ->> 'status' = 'enviado', 'tipo Estadia, Enviado';
  assert r -> 'registro' ->> 'est_codigo' ~ '^EST-[0-9]{3,}$', 'código EST-001';
  assert r -> 'registro' ->> 'placa' = 'RVD2E45', 'placa normalizada';
  assert r -> 'registro' -> 'est_documentos' = '["000123","000124"]'::jsonb, 'números como texto, zeros preservados, sem repetidos';
  assert (r -> 'registro' ->> 'est_peso_t')::numeric = 37.6 and r -> 'registro' ->> 'est_peso_unidade' = 't', 'peso em t';
  assert r -> 'registro' ->> 'est_valor_calculado' is null, 'sem conferência, sem valor calculado';
  insert into t9 values ('e1', (r -> 'registro' ->> 'id')::uuid);
  assert (select count(*) from doc_anexos where solicitacao_id = (select v from t9 where k = 'e1')) = 4, 'anexos gravados';

  -- Idempotente pela chave de envio
  r := criar_solicitacao_estadia(d, ok);
  assert (r -> 'registro' ->> 'id')::uuid = (select v from t9 where k = 'e1'), 'reenvio da mesma chave devolve a mesma estadia';

  -- Possível duplicidade: mesma placa com período sobreposto. Avisa, não bloqueia.
  d := d || '{"chave_envio":"30000000-0000-0000-0000-000000000002","documentos":["999"],"inicio":"2026-10-03T10:00:00-03:00","saida":"2026-10-03T20:00:00-03:00"}';
  ok := '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a1/cte2.pdf","nome":"cte2.pdf","categoria":"est_documento"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/nf2.pdf","nome":"nf2.pdf","categoria":"est_nf_carga"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/comp3.pdf","nome":"comp3.pdf","categoria":"est_comprovante"}]';
  r := criar_solicitacao_estadia(d, ok);
  assert r ->> 'status' = 'possivel_duplicidade' and r -> 'duplicadas' -> 0 ->> 'motivo' = 'periodo', 'aviso por período';
  assert (select count(*) from solicitacoes_doc where tipo = 'estadia') = 1, 'aviso não grava';
  -- Mesmo CT-e do mesmo cliente, outra placa e outro período
  r := criar_solicitacao_estadia(d || '{"placa":"ABC1234","documentos":["000124"],"inicio":"2026-09-01T10:00:00-03:00","saida":"2026-09-02T20:00:00-03:00"}', ok);
  assert r ->> 'status' = 'possivel_duplicidade' and r -> 'duplicadas' -> 0 ->> 'motivo' = 'documento', 'aviso por documento';
  -- Confirmado pelo usuário: grava. Peso em kg convertido explicitamente.
  r := criar_solicitacao_estadia(d || '{"confirmar_duplicidade":true,"peso":"37600","peso_unidade":"kg"}', ok);
  assert r ->> 'status' = 'ok', 'duplicidade confirmada grava';
  assert (r -> 'registro' ->> 'est_peso_t')::numeric = 37.6 and (r -> 'registro' ->> 'est_peso_informado')::numeric = 37600
    and r -> 'registro' ->> 'est_peso_unidade' = 'kg', '37.600 kg = 37,6 t, unidade guardada';
  insert into t9 values ('e2', (r -> 'registro' ->> 'id')::uuid);

  -- Acordo com o cliente: exige evidência e guarda o acordo junto do cálculo
  d := d || '{"chave_envio":"30000000-0000-0000-0000-000000000003","placa":"QWE9A87","documentos":["555"],"modalidade":"acordo",
    "acordo_valor":"350","acordo_confirmado_por":"Mesa comercial (Ana)","acordo_data":"2026-10-04","acordo_descricao":"Fechado em R$ 350 por WhatsApp",
    "inicio":"2026-10-01T08:00:00-03:00","saida":"2026-10-02T12:00:00-03:00","sindicato":true,"sindicato_nome":"Sindicato X"}';
  ok := '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a1/cte3.pdf","nome":"cte3.pdf","categoria":"est_documento"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/nf3.pdf","nome":"nf3.pdf","categoria":"est_nf_carga"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000095a1/comp4.pdf","nome":"comp4.pdf","categoria":"est_comprovante"}]';
  begin perform criar_solicitacao_estadia(d, ok); raise exception 'acordo sem evidência passou'; exception when sqlstate '22023' then null; end;
  r := criar_solicitacao_estadia(d, ok || '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a1/trat1.pdf","nome":"trat1.pdf","categoria":"est_tratativa"}]');
  assert r ->> 'status' = 'ok' and (r -> 'registro' ->> 'est_acordo_valor')::numeric = 350 and r -> 'registro' ->> 'est_sindicato_nome' = 'Sindicato X', 'acordo gravado';
  insert into t9 values ('e3', (r -> 'registro' ->> 'id')::uuid);

  -- Solicitante não confere nem assume
  begin perform conferir_estadia((select v from t9 where k = 'e1'), '{"limite_h":24,"retroagir_h":12}'); raise exception 'comercial conferiu'; exception when sqlstate '42501' then null; end;
end $$;

-- Outra filial não vê
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a4', false);
do $$ begin
  assert (select count(*) from solicitacoes_doc where tipo = 'estadia') = 0, 'fora do escopo não vê';
  assert (select count(*) from estadia_conferencias) = 0, 'nem conferências';
end $$;

-- Apoio: assume (atômico), confere, encaminha, registra pagamento e retorno
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a2', false);
do $$ declare r jsonb; s uuid := (select v from t9 where k = 'e1'); ver integer; begin
  assert (select count(*) from solicitacoes_doc where tipo = 'estadia') = 3, 'apoio vê as estadias na fila';
  begin perform conferir_estadia(s, '{"limite_h":24,"retroagir_h":12}'); raise exception 'conferiu sem assumir'; exception when sqlstate '42501' then null; end;
  r := assumir_solicitacao_doc(s);
  assert r ->> 'status' = 'ok' and r -> 'registro' ->> 'status' = 'em_atendimento', 'assumida';
  ver := (r -> 'registro' ->> 'versao')::int;
  -- Parâmetros ausentes: aguardando conferência, nada salvo
  begin perform conferir_estadia(s, '{"limite_h":24}', ver); raise exception 'sem retroagir passou'; exception when sqlstate '22023' then null; end;
  begin perform conferir_estadia(s, '{"retroagir_h":""}', ver); raise exception 'vazio passou'; exception when sqlstate '22023' then null; end;
  begin perform encaminhar_cliente_estadia(s, null, ver); raise exception 'encaminhou sem cálculo'; exception when sqlstate '55000' then null; end;
  -- Versão antiga: conflito
  begin perform conferir_estadia(s, '{"limite_h":24,"retroagir_h":12}', ver - 1); raise exception 'versão antiga passou'; exception when sqlstate '40001' then null; end;
  -- Ajuste de dados exige observação
  begin perform conferir_estadia(s, '{"limite_h":24,"retroagir_h":12,"peso_t":"38"}', ver); raise exception 'ajuste sem observação'; exception when sqlstate '22023' then null; end;

  r := conferir_estadia(s, '{"limite_h":24,"retroagir_h":12}', ver);
  assert r ->> 'status' = 'ok' and (r -> 'conferencia' ->> 'valor')::numeric = 261.70 and (r -> 'conferencia' ->> 'versao')::int = 1, 'conferência v1 = R$ 261,70';
  assert (r -> 'registro' ->> 'est_valor_calculado')::numeric = 261.70, 'valor vigente na solicitação';
  ver := (r -> 'registro' ->> 'versao')::int;
  r := conferir_estadia(s, '{"limite_h":24,"retroagir_h":12}', ver);
  assert r ->> 'status' = 'sem_alteracao', 'mesma conferência não cria versão';
  r := conferir_estadia(s, '{"limite_h":36,"retroagir_h":12}', ver);
  assert (r -> 'conferencia' ->> 'valor')::numeric = 0 and (r -> 'conferencia' ->> 'versao')::int = 2, 'v2: abaixo do limite, zero';
  ver := (r -> 'registro' ->> 'versao')::int;
  r := conferir_estadia(s, '{"limite_h":24,"retroagir_h":12,"tarifa":"0.50","observacao":"Tarifa conferida na tabela do cliente"}', ver);
  assert (r -> 'conferencia' ->> 'versao')::int = 3 and r -> 'conferencia' -> 'alteracoes' ? 'tarifa', 'v3 registra a tarifa ajustada';
  assert (r -> 'conferencia' ->> 'valor')::numeric = 290.77, '0,50 × 37,6 × 15,4667 = R$ 290,77';
  ver := (r -> 'registro' ->> 'versao')::int;
  r := conferir_estadia(s, '{"limite_h":24,"retroagir_h":12,"observacao":"Volta à tarifa enviada"}', ver);
  assert (r -> 'conferencia' ->> 'valor')::numeric = 261.70 and (select count(*) from estadia_conferencias where solicitacao_id = s) = 4, 'versões preservadas';
  ver := (r -> 'registro' ->> 'versao')::int;

  r := encaminhar_cliente_estadia(s, 'Enviado por e-mail ao cliente', ver);
  assert r -> 'registro' ->> 'status' = 'aguardando_cliente', 'aguardando retorno do cliente';
  ver := (r -> 'registro' ->> 'versao')::int;
  begin perform conferir_estadia(s, '{"limite_h":24,"retroagir_h":10}', ver); raise exception 'conferiu aguardando cliente'; exception when sqlstate '55000' then null; end;

  begin perform registrar_pagamento_estadia(s, '{"valor_pago":"261.70","data_pagamento":"2026-10-20"}', '[]', ver); raise exception 'pagamento sem comprovante'; exception when sqlstate '22023' then null; end;
  begin perform registrar_pagamento_estadia(s, '{"valor_pago":"261.70"}', '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/pag1.png","nome":"pag1.png","categoria":"est_pagamento"}]', ver);
    raise exception 'pagamento sem data'; exception when sqlstate '22023' then null; end;
  r := registrar_pagamento_estadia(s, '{"valor_pago":"261.70","data_pagamento":"2026-10-20","observacao":"Pago ao motorista"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/pag1.png","nome":"pag1.png","categoria":"est_pagamento"}]', ver);
  assert r -> 'registro' ->> 'status' = 'pago_pendencia' and (r -> 'registro' ->> 'est_valor_pago')::numeric = 261.70, 'pago em pendência';
  ver := (r -> 'registro' ->> 'versao')::int;

  begin perform registrar_retorno_estadia(s, '{"resultado":"aprovada","justificativa":"ok"}', '[]', ver); raise exception 'retorno sem evidência'; exception when sqlstate '22023' then null; end;
  begin perform registrar_retorno_estadia(s, '{"resultado":"aprovada_parcial","justificativa":"ok"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/ret1.png","nome":"ret1.png","categoria":"est_retorno"}]', ver); raise exception 'parcial sem valor'; exception when sqlstate '22023' then null; end;
  r := registrar_retorno_estadia(s, '{"resultado":"aprovada","justificativa":"Cliente aprovou por e-mail","data_retorno":"2026-10-21"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/ret1.png","nome":"ret1.png","categoria":"est_retorno"}]', ver);
  assert r -> 'registro' ->> 'status' = 'aprovada' and (r -> 'registro' ->> 'est_valor_aprovado')::numeric = 261.70, 'pago em pendência → aprovada';
  assert r -> 'retorno' ->> 'status_anterior' = 'pago_pendencia', 'retorno guarda a situação anterior';
  assert (r -> 'registro' ->> 'est_valor_pago')::numeric = 261.70 and (select count(*) from estadia_pagamentos where solicitacao_id = s) = 1, 'pagamento preservado';
  assert r -> 'registro' ->> 'concluido_em' is not null, 'aprovada fecha o ciclo';
  begin perform cancelar_solicitacao_doc(s, 'x'); raise exception 'cancelou aprovada'; exception when sqlstate '55000' then null; end;
  begin perform reabrir_estadia(s, 'teste'); raise exception 'apoio reabriu sem permissão'; exception when sqlstate '42501' then null; end;

  -- Estadia 2: retorno Rejeitada volta ao atendimento e só então pode encerrar
  s := (select v from t9 where k = 'e2');
  r := assumir_solicitacao_doc(s);
  r := conferir_estadia(s, '{"limite_h":0,"retroagir_h":0}');
  assert (r -> 'conferencia' ->> 'valor')::numeric = 169.20, '0,45 × 37,6 × 10 h = R$ 169,20';
  begin perform encerrar_estadia(s, 'sem cobrança'); raise exception 'encerrou sem retorno rejeitado'; exception when sqlstate '55000' then null; end;
  r := encaminhar_cliente_estadia(s, null);
  r := registrar_retorno_estadia(s, '{"resultado":"rejeitada","justificativa":"Fora do contrato","valor_aprovado":"100"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/ret2.png","nome":"ret2.png","categoria":"est_retorno"}]');
  assert r -> 'registro' ->> 'status' = 'em_atendimento' and r -> 'registro' ->> 'est_valor_aprovado' is null, 'rejeitada volta ao atendimento, sem valor';
  begin perform encerrar_estadia(s, '  '); raise exception 'encerrou sem motivo'; exception when sqlstate '22023' then null; end;
  r := encerrar_estadia(s, 'Cliente não reconhece a estadia: sem cobrança');
  assert r -> 'registro' ->> 'status' = 'encerrado', 'encerrada';

  -- Estadia 3 (acordo): parcial
  s := (select v from t9 where k = 'e3');
  r := assumir_solicitacao_doc(s);
  r := conferir_estadia(s, '{"limite_h":24,"retroagir_h":0}');
  assert (r -> 'registro' ->> 'est_acordo_valor')::numeric = 350, 'acordo mantido ao lado do cálculo';
  r := registrar_retorno_estadia(s, '{"resultado":"aprovada_parcial","valor_aprovado":"300","justificativa":"Aprovou R$ 300"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-0000000095a2/ret3.png","nome":"ret3.png","categoria":"est_retorno"}]');
  assert r -> 'registro' ->> 'status' = 'aprovada_parcial' and (r -> 'registro' ->> 'est_valor_aprovado')::numeric = 300, 'aprovada parcialmente';
end $$;

-- Segundo atendente não assume a mesma estadia
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a3', false);
do $$ declare r jsonb; begin
  r := assumir_solicitacao_doc((select v from t9 where k = 'e1'));
  assert r ->> 'status' = 'ja_assumida', 'assumir é atômico';
  begin perform conferir_estadia((select v from t9 where k = 'e3'), '{"limite_h":1,"retroagir_h":0}'); raise exception 'outro apoio conferiu'; exception when sqlstate '42501' then null; end;
end $$;

-- Solicitante: avisos e tabelas imutáveis
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a1', false);
do $$ begin
  assert (select count(*) from notificacoes where tipo = 'estadia_atualizada' and destino = 'estadia'
           and solicitacao_id = (select v from t9 where k = 'e1')) = 3, 'avisos: aguardando cliente, pagamento, aprovada';
  assert exists (select 1 from notificacoes where titulo = 'Estadia encerrada'), 'aviso de encerramento';
  assert (select count(*) from estadia_conferencias where solicitacao_id = (select v from t9 where k = 'e1')) = 4, 'solicitante vê as versões';
  begin update estadia_conferencias set valor = 1; raise exception 'alterou conferência'; exception when insufficient_privilege then null; end;
  begin insert into estadia_retornos (solicitacao_id, resultado, justificativa, data_retorno, conferencia_id, valor_calculado, status_anterior, status_novo, autor_nome)
    values ((select v from t9 where k = 'e1'), 'rejeitada', 'x', current_date, (select id from estadia_conferencias limit 1), 0, 'a', 'b', 'x');
    raise exception 'inseriu retorno'; exception when insufficient_privilege then null; end;
  begin perform reabrir_estadia((select v from t9 where k = 'e2'), 'x'); raise exception 'comercial reabriu'; exception when sqlstate '42501' then null; end;
end $$;

-- Gestor reabre com motivo (auditado)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000095a5', false);
do $$ declare r jsonb; s uuid := (select v from t9 where k = 'e2'); begin
  begin perform reabrir_estadia(s, ''); raise exception 'reabriu sem motivo'; exception when sqlstate '22023' then null; end;
  r := reabrir_estadia(s, 'Cliente reviu a posição');
  assert r -> 'registro' ->> 'status' = 'em_atendimento' and r -> 'registro' ->> 'concluido_em' is null, 'reaberta volta ao responsável';
  assert exists (select 1 from doc_mensagens where solicitacao_id = s and texto like 'Estadia reaberta por Gestor Estadia (estava Encerrada)%'), 'reabertura no histórico';
end $$;

reset role;
set role anon;
do $$ begin
  begin perform criar_solicitacao_estadia('{}', '[]'); raise exception 'anon chamou'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Painel: espera do cliente separada do atendimento
do $$ declare s uuid := (select v from t9 where k = 'e1'); begin
  assert (select array_agg(evento order by criado_em, evento) from solicitacao_eventos where solicitacao_id = s)
    @> array['enviado', 'assumido', 'enviado_cliente', 'pago_pendencia', 'concluido'], 'eventos do ciclo';
  assert exists (select 1 from solicitacao_eventos where solicitacao_id = (select v from t9 where k = 'e2') and evento = 'retorno_cliente'), 'retorno do cliente';
  assert exists (select 1 from solicitacao_eventos where solicitacao_id = (select v from t9 where k = 'e2') and evento = 'reaberto'), 'reaberto';
  assert exists (select 1 from papel_permissoes where papel = 'apoio' and chave = 'estadia.ver')
     and not exists (select 1 from papel_permissoes where papel = 'apoio' and chave = 'estadia.solicitar'), 'apoio vê, não solicita';
end $$;
\o
\echo 95_estadia: ok
