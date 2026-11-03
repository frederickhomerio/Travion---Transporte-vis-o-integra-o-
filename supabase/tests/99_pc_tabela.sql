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
  -- Edição com histórico.
  select versao into v_versao from embarques where id = v_id;
  r := atualizar_embarque(v_id, '{"pc":"45999","tabela":"TAB-12"}', jsonb_build_object('pc', '45871', 'tabela', 'TAB-11'), false);
  assert r ->> 'status' = 'ok', 'edição ok: ' || (r ->> 'status');
  assert (select pc from embarques where id = v_id) = '45999', 'PC alterado';
  assert exists (select 1 from historico_alteracoes where embarque_id = v_id and campo = 'tabela'), 'histórico da tabela';
end $$;

-- Consulta não altera PC.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0a2', false);
do $$ begin
  perform atualizar_embarque((select id from embarques where pc = '45999'), '{"pc":"1"}', '{"pc":"45999"}', false);
  assert false, 'consulta sem permissão';
exception when sqlstate '42501' then null; end $$;
reset role;
\o
select '99_pc_tabela: ok';
