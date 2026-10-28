-- Testes da migração 2200: PIX como forma de pagamento (chave do proprietário ou do motorista).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000097a1', 'pix@teste.local', '{"nome":"Comercial PIX"}');
insert into filiais (id, nome) values ('00000000-0000-0000-0000-0000000097f1', 'FILIAL PIX');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000097e1', 'CLIENTE PIX');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade) values
  ('00000000-0000-0000-0000-0000000097b1', '00000000-0000-0000-0000-0000000097e1', '00000000-0000-0000-0000-0000000097f1', 'RIO VERDE', 'SANTOS');
update perfis set papel = 'embarcador', status = 'ativo' where id = '00000000-0000-0000-0000-0000000097a1';
insert into perfil_filiais (perfil_id, filial_id) values ('00000000-0000-0000-0000-0000000097a1', '00000000-0000-0000-0000-0000000097f1');
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000097a1/nf.pdf', '00000000-0000-0000-0000-0000000097a1', '{"size":1200,"mimetype":"application/pdf"}'),
  ('documentacao', 'envios/00000000-0000-0000-0000-0000000097a1/evid.png', '00000000-0000-0000-0000-0000000097a1', '{"size":900,"mimetype":"image/png"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000097a1', false);
do $$
declare r jsonb; s solicitacoes_doc;
  d jsonb := '{"placa":"abc-1d23","frete_empresa":150,"frete_empresa_unidade":"rs_tonelada","frete_motorista":130,
    "frete_motorista_unidade":"rs_tonelada","tipo_operacao":"mi_tributado","forma_pagamento":"pix","pedagio":"sem_parar",
    "exige_obs_cte":false,"cte_por_nf":false,"chave_envio":"97000000-0000-0000-0000-000000000001"}';
  a jsonb := '[{"caminho":"envios/00000000-0000-0000-0000-0000000097a1/nf.pdf","nome":"nf.pdf","categoria":"nf"},
    {"caminho":"envios/00000000-0000-0000-0000-0000000097a1/evid.png","nome":"evid.png","categoria":"evidencia_frete"}]';
begin
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000097b1', d || '{"pix_chave":"123"}', a); assert false, 'sem titular';
  exception when sqlstate '22023' then assert sqlerrm like '%proprietário ou do motorista%', sqlerrm; end;
  begin perform criar_solicitacao_doc('00000000-0000-0000-0000-0000000097b1', d || '{"pix_titular":"motorista","pix_chave":"  "}', a); assert false, 'sem chave';
  exception when sqlstate '22023' then assert sqlerrm like '%chave PIX%', sqlerrm; end;
  r := criar_solicitacao_doc('00000000-0000-0000-0000-0000000097b1', d || '{"pix_titular":"motorista","pix_chave":" motorista@email.com "}', a);
  s := jsonb_populate_record(null::solicitacoes_doc, r -> 'registro');
  assert s.forma_pagamento = 'pix' and s.pix_titular = 'motorista' and s.pix_chave = 'motorista@email.com', 'PIX gravado: ' || r::text;
end $$;
reset role;
do $$ begin
  -- Fora do PIX não fica chave guardada
  begin
    update solicitacoes_doc set forma_pagamento = 'pagbem' where pix_chave = 'motorista@email.com';
    assert false, 'pagbem com chave PIX não pode';
  exception when check_violation then null; end;
end $$;
\o
select 'pix: ok';
