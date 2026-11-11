-- Testes da migração 4700: avisos da Fase 1 (sino + WhatsApp pelo n8n).
-- O banco local precisa dos esquemas net e vault de mentira (pg_net e Vault só existem no Supabase).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000a7a1', 'av-com@teste.local', '{"nome":"Carla Comercial"}'),
  ('00000000-0000-0000-0000-00000000a7a2', 'av-ana@teste.local', '{"nome":"Ana Apoio"}'),
  ('00000000-0000-0000-0000-00000000a7a3', 'av-sup@teste.local', '{"nome":"Saulo Supervisor"}'),
  ('00000000-0000-0000-0000-00000000a7a4', 'av-ges@teste.local', '{"nome":"Gil Gestor"}'),
  ('00000000-0000-0000-0000-00000000a7a5', 'av-out@teste.local', '{"nome":"Otto Outra Filial"}'),
  ('00000000-0000-0000-0000-00000000a7a6', 'av-pau@teste.local', '{"nome":"Paula Supervisora do Apoio"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-00000000a7f1', 'FILIAL AVISOS'), ('00000000-0000-0000-0000-00000000a7f2', 'FILIAL LONGE');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-00000000a7e1', 'CLIENTE AVISOS');
update perfis set papel = 'embarcador', status = 'ativo', telefone = '(64) 99999-1234', whatsapp_avisos = true where id = '00000000-0000-0000-0000-00000000a7a1';
update perfis set papel = 'apoio', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7a2';
update perfis set papel = 'supervisor', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7a3';
update perfis set papel = 'gestor', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7a4';
update perfis set papel = 'supervisor', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7a5';
update perfis set papel = 'operacao', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a7a6';
insert into perfil_filiais (perfil_id, filial_id)
select p, '00000000-0000-0000-0000-00000000a7f1'::uuid from unnest(array['00000000-0000-0000-0000-00000000a7a1', '00000000-0000-0000-0000-00000000a7a2',
  '00000000-0000-0000-0000-00000000a7a3', '00000000-0000-0000-0000-00000000a7a4', '00000000-0000-0000-0000-00000000a7a6']::uuid[]) p;
insert into perfil_filiais (perfil_id, filial_id) values ('00000000-0000-0000-0000-00000000a7a5', '00000000-0000-0000-0000-00000000a7f2');
insert into vault.secrets (name, secret) values ('travion_n8n_auditoria_token', 'tok-teste') on conflict (name) do nothing;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000a7a1/nf.pdf', '00000000-0000-0000-0000-00000000a7a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000a7a1/evid.png', '00000000-0000-0000-0000-00000000a7a1', '{"size":900,"mimetype":"image/png"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000a7a1/nf2.pdf', '00000000-0000-0000-0000-00000000a7a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-00000000a7a1/evid2.png', '00000000-0000-0000-0000-00000000a7a1', '{"size":900,"mimetype":"image/png"}');

create temporary table tr (k text primary key, v uuid);
grant all on tr to authenticated;

-- 5. Novo embarque liberado (criado pela Carla): Saulo (supervisor da filial) recebe; Otto (outra filial) não; Carla não (foi ela).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a1', false);
insert into embarques (id, cliente_id, filial_id, origem_cidade, origem_uf, destino_cidade, destino_uf, criado_por) values
  ('00000000-0000-0000-0000-00000000a7b1', '00000000-0000-0000-0000-00000000a7e1', '00000000-0000-0000-0000-00000000a7f1', 'RIO VERDE', 'GO', 'SANTOS', 'SP',
   '00000000-0000-0000-0000-00000000a7a1');
do $$ begin
  assert (select count(*) from notificacoes where tipo = 'embarque_novo' and destinatario_id = '00000000-0000-0000-0000-00000000a7a3') = 1, 'supervisor avisado do novo embarque';
  assert (select count(*) from notificacoes where tipo = 'embarque_novo' and destinatario_id = '00000000-0000-0000-0000-00000000a7a5') = 0, 'outra filial não';
  assert (select count(*) from notificacoes where tipo = 'embarque_novo' and destinatario_id = '00000000-0000-0000-0000-00000000a7a1') = 0, 'quem criou não';
  assert (select texto from notificacoes where tipo = 'embarque_novo' limit 1) like '%CLIENTE AVISOS · RIO VERDE-GO → SANTOS-SP%', 'texto do embarque';
  assert (select count(*) from net.pedidos) = 0, 'novo embarque não vai para o WhatsApp';
end $$;

-- 1. Solicitação nova: Ana (apoio) recebe; quem enviou não.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a1', false);
do $$ declare r jsonb; begin
  r := criar_solicitacao_doc('00000000-0000-0000-0000-00000000a7b1', '{"placa":"AVI1S23","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada",
    "frete_motorista":130,"frete_motorista_unidade":"rs_tonelada","tipo_operacao":"exportacao","forma_pagamento":"pagbem","pedagio":"sem_parar",
    "exige_obs_cte":false,"cte_por_nf":false,"chave_envio":"a7000000-0000-0000-0000-000000000001"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-00000000a7a1/nf.pdf","nome":"nf.pdf","categoria":"nf"},
      {"caminho":"envios/00000000-0000-0000-0000-00000000a7a1/evid.png","nome":"evid.png","categoria":"evidencia_frete"}]');
  insert into tr values ('s', (r -> 'registro' ->> 'id')::uuid);
end $$;
reset role;
do $$ begin
  assert (select count(*) from notificacoes where tipo = 'fila_nova' and destinatario_id = '00000000-0000-0000-0000-00000000a7a2') = 1, 'apoio avisado da fila';
  assert (select count(*) from notificacoes where tipo = 'fila_nova' and destinatario_id = '00000000-0000-0000-0000-00000000a7a6') = 1, 'supervisora do apoio também';
  assert (select count(*) from notificacoes where tipo = 'fila_nova') = 2, 'só o apoio (gestor e supervisor de embarque não)';
  assert (select titulo from notificacoes where tipo = 'fila_nova' limit 1) = 'Nova na fila: Lote e Emissão', 'título fila';
end $$;

-- 2. Ana assume → Carla avisada. 7. Ana pede ajuste → Carla recebe no sino e no WhatsApp.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a2', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  perform assumir_solicitacao_doc(s);
  perform solicitar_ajuste_doc(s, 'NF ilegível', 'nf', 'documento_ilegivel');
end $$;
-- A Carla enxerga o aviso de embarque (sem solicitação) pelo RLS? (ela não recebeu nenhum; checa o do Saulo)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a3', false);
do $$ begin
  assert (select count(*) from notificacoes where tipo = 'embarque_novo') = 1, 'RLS: supervisor vê o aviso do embarque';
end $$;
reset role;
do $$ declare p jsonb; begin
  assert (select count(*) from notificacoes where tipo = 'solicitacao_assumida' and destinatario_id = '00000000-0000-0000-0000-00000000a7a1') = 1, 'assumida';
  assert (select destino from notificacoes where tipo = 'solicitacao_assumida') = 'embarque', 'destino do solicitante';
  assert (select count(*) from net.pedidos) = 1, 'só o ajuste vai para o WhatsApp';
  select body into p from net.pedidos;
  assert p ->> 'telefone' = '5564999991234', p::text;
  assert p ->> 'nome' = 'Carla', p::text;
  assert p ->> 'link' like 'https://travion-transporte-vis-o-integra-o-ten.vercel.app/#/?emb=00000000-0000-0000-0000-00000000a7b1&doc=%', p::text;
  assert (select headers ->> 'x-travion-token' from net.pedidos) = 'tok-teste', 'token';
  assert (select whatsapp_pedido_em from notificacoes where tipo = 'ajuste_solicitado') is not null, 'marcado como enviado';
end $$;

-- 3. Gestor cancela → Carla e Ana avisadas (Carla também no WhatsApp).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a4', false);
do $$ declare s uuid := (select v from tr where k = 's'); begin
  perform cancelar_solicitacao_doc(s, 'Motorista desistiu da carga');
end $$;
reset role;
do $$ begin
  assert (select count(*) from notificacoes where tipo = 'solicitacao_cancelada') = 2, 'solicitante e atendente';
  assert (select texto from notificacoes where tipo = 'solicitacao_cancelada' limit 1) like '%Motorista desistiu da carga%', 'motivo';
  assert (select count(*) from net.pedidos) = 2, 'cancelamento no WhatsApp da Carla (Ana não ligou)';
end $$;

-- 4. Prazo (ajuste 5000): Emissão sem ninguém assumir há 26 min → só Gil (gestor) e Paula (supervisora do Apoio); Ana (apoio) não.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a1', false);
do $$ declare r jsonb; begin
  r := criar_solicitacao_doc('00000000-0000-0000-0000-00000000a7b1', '{"placa":"AVI2S34","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada",
    "frete_motorista":130,"frete_motorista_unidade":"rs_tonelada","tipo_operacao":"exportacao","forma_pagamento":"pagbem","pedagio":"sem_parar",
    "exige_obs_cte":false,"cte_por_nf":false,"chave_envio":"a7000000-0000-0000-0000-000000000002"}',
    '[{"caminho":"envios/00000000-0000-0000-0000-00000000a7a1/nf2.pdf","nome":"nf2.pdf","categoria":"nf"},
      {"caminho":"envios/00000000-0000-0000-0000-00000000a7a1/evid2.png","nome":"evid2.png","categoria":"evidencia_frete"}]');
  insert into tr values ('s2', (r -> 'registro' ->> 'id')::uuid);
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
update solicitacao_eventos set criado_em = now() - interval '26 minutes' where solicitacao_id = (select v from tr where k = 's2');
update solicitacoes_doc set enviado_em = now() - interval '26 minutes' where id = (select v from tr where k = 's2');
do $$ begin
  assert private.avisar_prazos_fila() = 1, 'uma solicitação estourada';
  perform private.avisar_prazos_fila();
  assert (select count(*) from notificacoes where tipo = 'prazo_estourado' and destinatario_id = '00000000-0000-0000-0000-00000000a7a2') = 0, 'apoio não recebe prazo';
  assert (select count(*) from notificacoes where tipo = 'prazo_estourado' and destinatario_id = '00000000-0000-0000-0000-00000000a7a4') = 1, 'gestor, sem repetir';
  assert (select count(*) from notificacoes where tipo = 'prazo_estourado' and destinatario_id = '00000000-0000-0000-0000-00000000a7a6') = 1, 'supervisora do apoio';
  assert (select count(*) from notificacoes where tipo = 'prazo_estourado') = 2, 'só os dois';
end $$;
-- Antigo demais (mais de 1 h depois do prazo) não avisa.
update solicitacao_eventos set criado_em = now() - interval '3 hours' where solicitacao_id = (select v from tr where k = 's2');
delete from notificacoes where tipo = 'prazo_estourado';
do $$ begin assert private.avisar_prazos_fila() = 0, 'antigo não avisa'; end $$;

-- 6. Saulo suspende o embarque → Carla (criou) avisada no sino e no WhatsApp; Saulo não (foi ele); Otto não.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a3', false);
update embarques set status_liberacao = 'suspenso', suspenso_em = now() where id = '00000000-0000-0000-0000-00000000a7b1';
do $$ begin
  assert (select count(*) from notificacoes where tipo = 'embarque_estado' and destinatario_id = '00000000-0000-0000-0000-00000000a7a1') = 1, 'criador avisado';
  assert (select titulo from notificacoes where tipo = 'embarque_estado' limit 1) = 'Embarque suspenso', 'título';
  assert (select count(*) from notificacoes where tipo = 'embarque_estado') = 1, 'só o criador (supervisor foi quem suspendeu)';
  assert (select body ->> 'link' from net.pedidos order by id desc limit 1) like '%/#/?emb=00000000-0000-0000-0000-00000000a7b1', 'link da lista';
end $$;
-- Reativar (pelo gestor): Carla e Saulo avisados.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a4', false);
update embarques set status_liberacao = 'liberado', suspenso_em = null where id = '00000000-0000-0000-0000-00000000a7b1';
do $$ begin
  assert (select count(*) from notificacoes where titulo = 'Embarque reativado') = 2, 'reativado: criador e supervisor';
end $$;

-- 8. Admin liga o WhatsApp: exige celular.
select set_config('request.jwt.claim.sub', '', false);
update perfis set papel = 'administrador' where id = '00000000-0000-0000-0000-00000000a7a4';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a4', false);
do $$ begin
  begin perform admin_atualizar_usuario('00000000-0000-0000-0000-00000000a7a2', '{"whatsapp_avisos":true}'); raise exception 'ligou sem celular';
  exception when sqlstate '22023' then null; end;
  perform admin_atualizar_usuario('00000000-0000-0000-0000-00000000a7a2', '{"whatsapp_avisos":true,"telefone":"(62) 98888-7777"}');
  assert (select whatsapp_avisos from perfis where id = '00000000-0000-0000-0000-00000000a7a2'), 'ligado';
end $$;

-- 9. Estadia (ajuste 5000): só a autorização do cliente avisa; valores em reais no formato brasileiro.
select set_config('request.jwt.claim.sub', '', false);
do $$ declare v_s uuid := (select v from tr where k = 's2'); begin
  delete from notificacoes where destinatario_id = '00000000-0000-0000-0000-00000000a7a1';
  insert into notificacoes (destinatario_id, tipo, titulo, texto, solicitacao_id, destino, chave) values
    ('00000000-0000-0000-0000-00000000a7a1', 'estadia_atualizada', 'Estadia aguardando retorno do cliente', 'x · valor calculado R$ 7,959.06', v_s, 'estadia', 't1'),
    ('00000000-0000-0000-0000-00000000a7a1', 'estadia_atualizada', 'Estadia encerrada', 'x', v_s, 'estadia', 't2'),
    ('00000000-0000-0000-0000-00000000a7a1', 'estadia_atualizada', 'Estadia rejeitada pelo cliente', 'x', v_s, 'estadia', 't3'),
    ('00000000-0000-0000-0000-00000000a7a1', 'estadia_atualizada', 'Estadia aprovada pelo cliente', 'EST-1 · CLIENTE · R$ 1,234,567.89', v_s, 'estadia', 't4'),
    ('00000000-0000-0000-0000-00000000a7a1', 'estadia_atualizada', 'Estadia aprovada parcialmente', 'EST-1 · CLIENTE · R$ 261.70', v_s, 'estadia', 't5'),
    ('00000000-0000-0000-0000-00000000a7a1', 'estadia_atualizada', 'Cliente sem retorno há mais de 7 dias', 'EST-1 · R$ 7,959.06 aguardando', v_s, 'estadia', 't6');
  assert (select count(*) from notificacoes where destinatario_id = '00000000-0000-0000-0000-00000000a7a1' and tipo = 'estadia_atualizada') = 3, 'só aprovadas e cliente sem retorno';
  assert (select texto from notificacoes where chave = 't4') = 'EST-1 · CLIENTE · R$ 1.234.567,89', 'milhar brasileiro';
  assert (select texto from notificacoes where chave = 't5') = 'EST-1 · CLIENTE · R$ 261,70', 'centavos com vírgula';
  assert (select texto from notificacoes where chave = 't6') = 'EST-1 · R$ 7.959,06 aguardando', 'alerta do cliente';
end $$;

\o
\echo 99_avisos_fase1: ok
