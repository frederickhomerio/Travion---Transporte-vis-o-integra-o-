-- Testes da migração 3500 (03/11/2026): PC e Tabela na criação e na edição do embarque.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into centros_custo (id, nome) values ('00000000-0000-0000-0000-00000000b0c1', 'CENTRO PC');
insert into filiais (id, nome, centro_custo_id) values ('00000000-0000-0000-0000-00000000b0f1', 'FILIAL PC', '00000000-0000-0000-0000-00000000b0c1');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-00000000b0e1', 'CLIENTE PC');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000b0a1', 'pc@teste.local', '{"nome":"Supervisor PC"}'),
  ('00000000-0000-0000-0000-00000000b0a2', 'pcconsulta@teste.local', '{"nome":"Consulta PC"}');
update perfis set papel = 'supervisor', status = 'ativo' where id = '00000000-0000-0000-0000-00000000b0a1';
update perfis set papel = 'consulta', status = 'ativo' where id = '00000000-0000-0000-0000-00000000b0a2';
insert into perfil_centros (perfil_id, centro_custo_id) values
  ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0c1'),
  ('00000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-00000000b0c1');
insert into perfil_permissoes (perfil_id, chave, permitido)
select '00000000-0000-0000-0000-00000000b0a1', c, true from unnest(array['embarques.ver', 'embarques.criar', 'embarques.editar_cadastro', 'embarques.editar_cadencia']) c;
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-00000000b0a2', 'embarques.ver', true);
select private.sincronizar_escopo(id) from perfis where id::text like '00000000-0000-0000-0000-00000000b0a%';

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0a1', false);
do $$ declare r jsonb; v_id uuid; v_versao int; begin
  r := criar_embarque(jsonb_build_object('cliente_id', '00000000-0000-0000-0000-00000000b0e1', 'filial_id', '00000000-0000-0000-0000-00000000b0f1',
    'origem_cidade', 'SERRANOPOLIS', 'destino_cidade', 'MORADA NOVA', 'cadencia_valor', 3, 'cadencia_unidade', 'veiculos_dia',
    'lote_erp', '4725', 'pc', ' 45871 ', 'tabela', 'TAB-11'), false);
  v_id := (r -> 'registro' ->> 'id')::uuid;
  assert r -> 'registro' ->> 'pc' = '45871', 'PC gravado sem espaços';
  assert r -> 'registro' ->> 'tabela' = 'TAB-11', 'tabela gravada';
  assert (r -> 'registro' ->> 'toneladas_por_veiculo')::numeric > 0, 'capacidade padrão sem o campo no formulário';
  -- Sem PC/tabela continua valendo.
  r := criar_embarque(jsonb_build_object('cliente_id', '00000000-0000-0000-0000-00000000b0e1', 'filial_id', '00000000-0000-0000-0000-00000000b0f1',
    'origem_cidade', 'SERRANOPOLIS', 'destino_cidade', 'FORTALEZA', 'cadencia_valor', 2), false);
  assert r -> 'registro' ->> 'pc' is null and r -> 'registro' ->> 'tabela' is null, 'PC e tabela opcionais';
  begin perform criar_embarque(jsonb_build_object('cliente_id', '00000000-0000-0000-0000-00000000b0e1', 'filial_id', '00000000-0000-0000-0000-00000000b0f1',
    'origem_cidade', 'A', 'destino_cidade', 'B', 'cadencia_valor', 2, 'pc', repeat('9', 61)), false);
    assert false, 'PC acima de 60 caracteres'; exception when sqlstate '22023' then null; end;
  assert r -> 'registro' ->> 'pc_por_nome' is null, 'sem PC, sem autor';
end $$;

do $$ declare v_id uuid := (select id from embarques where pc = '45871'); v_id2 uuid := (select id from embarques where destino_cidade = 'FORTALEZA'); r jsonb; begin
  assert (select pc_por_nome from embarques where id = v_id) = 'Supervisor PC', 'autor do PC na criação';
  assert exists (select 1 from historico_alteracoes where embarque_id = v_id and campo = 'pc'), 'histórico do PC na criação';
  -- Campo vazio: quem cadastra embarques preenche.
  r := definir_lote_pc_tabela(v_id2, 'pc', '5555');
  assert r ->> 'status' = 'ok' and (select pc_por_nome from embarques where id = v_id2) = 'Supervisor PC', 'preenche PC vazio';
  r := definir_lote_pc_tabela(v_id2, 'lote_erp', '1234');
  assert (select registrado_por_nome from lotes_erp where embarque_id = v_id2) = 'Supervisor PC', 'preenche lote vazio';
  -- Já preenchido: sem a permissão de correção, bloqueado (PC, tabela e lote).
  begin perform definir_lote_pc_tabela(v_id, 'pc', '1'); assert false, 'PC preenchido não muda'; exception when sqlstate '42501' then null; end;
  begin perform definir_lote_pc_tabela(v_id, 'lote_erp', '9999'); assert false, 'lote preenchido não muda'; exception when sqlstate '42501' then null; end;
  -- Mesmo valor: sem alteração (não é correção).
  assert definir_lote_pc_tabela(v_id, 'tabela', 'TAB-11') ->> 'status' = 'sem_alteracao', 'mesmo valor';
  -- PC não passa mais pela edição genérica.
  begin perform atualizar_embarque(v_id, '{"pc":"1"}', '{}', true); assert false, 'pc fora da edição genérica';
  exception when others then null; end;
  assert (select pc from embarques where id = v_id) = '45871', 'PC intacto';
end $$;

-- Com a permissão de correção: corrige e passa a mostrar quem corrigiu.
reset role;
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-00000000b0a1', 'embarques.corrigir_lote_pc_tabela', true);
set role authenticated;
do $$ declare v_id uuid := (select id from embarques where pc = '45871'); begin
  perform definir_lote_pc_tabela(v_id, 'pc', '45999');
  perform definir_lote_pc_tabela(v_id, 'lote_erp', '4726');
  assert (select pc from embarques where id = v_id) = '45999', 'PC corrigido';
  assert (select numero from lotes_erp where embarque_id = v_id) = '4726', 'lote corrigido';
  assert (select count(*) from historico_alteracoes where embarque_id = v_id and campo in ('pc', 'lote_erp') and valor_anterior is not null) = 2, 'histórico das correções';
end $$;

-- Consulta (sem permissão de cadastrar) não preenche nem corrige.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0a2', false);
do $$ begin
  perform definir_lote_pc_tabela((select id from embarques where destino_cidade = 'FORTALEZA'), 'tabela', 'X');
  assert false, 'consulta sem permissão';
exception when sqlstate '42501' then null; end $$;
reset role;
\o
select '99_pc_tabela: ok';
