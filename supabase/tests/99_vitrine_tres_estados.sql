-- Testes de 02/11/2026: vitrine da Lista de Fretes (todos os centros, sem dados financeiros internos), ações só no
-- centro de custo autorizado, reativação de encerrado e posições de nova data sempre zeradas (migrações 3350 e 3400).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

insert into centros_custo (id, nome) values
  ('00000000-0000-0000-0000-00000000a0c1', 'CENTRO VX'), ('00000000-0000-0000-0000-00000000a0c2', 'CENTRO VY');
insert into filiais (id, nome, centro_custo_id) values
  ('00000000-0000-0000-0000-00000000a0f1', 'FILIAL VX', '00000000-0000-0000-0000-00000000a0c1'),
  ('00000000-0000-0000-0000-00000000a0f2', 'FILIAL VY', '00000000-0000-0000-0000-00000000a0c2');
insert into clientes (id, nome) values ('00000000-0000-0000-0000-00000000a0e1', 'CLIENTE VITRINE');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000a0a1', 'supx@teste.local', '{"nome":"Supervisor X"}'),
  ('00000000-0000-0000-0000-00000000a0a2', 'multi@teste.local', '{"nome":"Supervisor XY"}'),
  ('00000000-0000-0000-0000-00000000a0a3', 'consy@teste.local', '{"nome":"Consulta Y"}'),
  ('00000000-0000-0000-0000-00000000a0a4', 'bloq@teste.local', '{"nome":"Bloqueado"}');
update perfis set papel = 'supervisor', status = 'ativo' where id in ('00000000-0000-0000-0000-00000000a0a1', '00000000-0000-0000-0000-00000000a0a2');
update perfis set papel = 'consulta', status = 'ativo' where id = '00000000-0000-0000-0000-00000000a0a3';
update perfis set papel = 'supervisor', status = 'bloqueado' where id = '00000000-0000-0000-0000-00000000a0a4';
insert into perfil_centros (perfil_id, centro_custo_id) values
  ('00000000-0000-0000-0000-00000000a0a1', '00000000-0000-0000-0000-00000000a0c1'),
  ('00000000-0000-0000-0000-00000000a0a2', '00000000-0000-0000-0000-00000000a0c1'),
  ('00000000-0000-0000-0000-00000000a0a2', '00000000-0000-0000-0000-00000000a0c2'),
  ('00000000-0000-0000-0000-00000000a0a3', '00000000-0000-0000-0000-00000000a0c2'),
  ('00000000-0000-0000-0000-00000000a0a4', '00000000-0000-0000-0000-00000000a0c1');
-- Supervisores com as permissões de ação (em produção vêm da função; aqui ficam explícitas).
insert into perfil_permissoes (perfil_id, chave, permitido)
select p, c, true from unnest(array['00000000-0000-0000-0000-00000000a0a1', '00000000-0000-0000-0000-00000000a0a2']::uuid[]) p,
  unnest(array['embarques.ver', 'embarques.liberar', 'embarques.encerrar', 'posicoes.abrir', 'posicoes.editar_contadores']) c;
select private.sincronizar_escopo(id) from perfis where id::text like '00000000-0000-0000-0000-00000000a0a%';

insert into embarques (id, cliente_id, filial_id, origem_cidade, origem_uf, destino_cidade, destino_uf, status_liberacao, observacao_interna) values
  ('00000000-0000-0000-0000-00000000a0b1', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0f1', 'RIO VERDE', 'GO', 'SANTOS', 'SP', 'liberado', 'OBS INTERNA X'),
  ('00000000-0000-0000-0000-00000000a0b2', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0f2', 'JATAI', 'GO', 'PARANAGUA', 'PR', 'liberado', 'OBS INTERNA Y'),
  ('00000000-0000-0000-0000-00000000a0b3', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0f2', 'JATAI', 'GO', 'UBERABA', 'MG', 'suspenso', null);
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade, status_liberacao, situacao, encerrado_em, encerrado_por_nome, encerrado_motivo) values
  ('00000000-0000-0000-0000-00000000a0b4', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0f1', 'RIO VERDE', 'CATALAO', 'suspenso', 'arquivado', now(), 'Gestor', 'Volume concluído'),
  ('00000000-0000-0000-0000-00000000a0b5', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0f2', 'JATAI', 'CATALAO', 'liberado', 'arquivado', now(), 'Gestor', 'Contrato finalizado');
-- Legado: "não informado" na criação direta vira Liberado (gatilho); alteração para ele continua bloqueada.
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade, status_liberacao) values
  ('00000000-0000-0000-0000-00000000a0b6', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0f1', 'RIO VERDE', 'ITUMBIARA', 'nao_informado');
insert into embarque_financeiro (embarque_id, frete_empresa, frete_motorista, unidade_frete) values
  ('00000000-0000-0000-0000-00000000a0b1', 187.5, 171.25, 'rs_tonelada'),
  ('00000000-0000-0000-0000-00000000a0b2', 333.33, 299.99, 'rs_tonelada');

do $$ begin
  assert (select status_liberacao from embarques where id = '00000000-0000-0000-0000-00000000a0b6') = 'liberado', 'legado normalizado na criação';
  begin update embarques set status_liberacao = 'nao_informado' where id = '00000000-0000-0000-0000-00000000a0b6';
    assert false, 'não informado bloqueado'; exception when check_violation then null; end;
  begin delete from embarques where id = '00000000-0000-0000-0000-00000000a0b6';
    assert false, 'embarque real não se exclui'; exception when sqlstate '55000' then null; end;
end $$;

set role authenticated;

-- Supervisor do centro X: vê a vitrine dos dois centros, sem dados financeiros internos.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a1', false);
do $$ declare t text; begin
  assert (select count(*) from lista_fretes_vitrine(false) where id::text like '00000000-0000-0000-0000-00000000a0b%') = 3, 'só liberados ativos (X, Y e o legado)';
  assert (select no_escopo from lista_fretes_vitrine(false) where id = '00000000-0000-0000-0000-00000000a0b1'), 'X no escopo';
  assert not (select no_escopo from lista_fretes_vitrine(false) where id = '00000000-0000-0000-0000-00000000a0b2'), 'Y fora do escopo';
  assert (select frete_motorista from lista_fretes_vitrine(false) where id = '00000000-0000-0000-0000-00000000a0b2') = 299.99, 'frete do motorista na divulgação';
  assert (select centro_custo_id from lista_fretes_vitrine(false) where id = '00000000-0000-0000-0000-00000000a0b2') = '00000000-0000-0000-0000-00000000a0c2', 'centro pelo vínculo da filial';
  select string_agg(to_jsonb(v)::text, ' ') into t from lista_fretes_vitrine(false) v;
  assert t not like '%333.33%' and t not like '%frete_empresa%' and t not like '%margem%', 'sem frete empresa nem margem';
  assert t not like '%OBS INTERNA%' and t not like '%CLIENTE VITRINE%' and t not like '%cliente_id%', 'sem cliente nem observação interna';
  -- A tabela e o financeiro continuam restritos ao escopo
  assert not exists (select 1 from embarques where id = '00000000-0000-0000-0000-00000000a0b2'), 'RLS: não lê o embarque de Y';
  assert not exists (select 1 from embarque_financeiro where embarque_id = '00000000-0000-0000-0000-00000000a0b2'), 'RLS: não lê o financeiro de Y';
  assert exists (select 1 from embarques where id = '00000000-0000-0000-0000-00000000a0b1'), 'RLS: lê o de X';
  -- Ações fora do centro autorizado: negadas no servidor
  begin perform atualizar_embarque('00000000-0000-0000-0000-00000000a0b2', '{"status_liberacao":"suspenso"}', '{"status_liberacao":"liberado"}');
    assert false, 'não suspende fora do centro'; exception when sqlstate 'P0002' then null; end;
  begin perform encerrar_embarque('00000000-0000-0000-0000-00000000a0b2', 'teste');
    assert false, 'não encerra fora do centro'; exception when sqlstate 'P0002' then null; end;
  -- No próprio centro: suspende
  assert atualizar_embarque('00000000-0000-0000-0000-00000000a0b1', '{"status_liberacao":"suspenso"}', '{"status_liberacao":"liberado"}') ->> 'status' = 'ok', 'suspende no centro';
  assert not exists (select 1 from lista_fretes_vitrine(false) where id = '00000000-0000-0000-0000-00000000a0b1'), 'suspenso sai da vitrine';
  perform atualizar_embarque('00000000-0000-0000-0000-00000000a0b1', '{"status_liberacao":"liberado"}', '{"status_liberacao":"suspenso"}');
  -- Sem a permissão nova, não reativa encerrado (nem do próprio centro)
  begin perform reativar_embarque_encerrado('00000000-0000-0000-0000-00000000a0b4', 'retomada', 1);
    assert false, 'reativar exige permissão'; exception when sqlstate '42501' then null; end;
end $$;

-- Centro autorizado sem a permissão da ação não basta (perfil Consulta no centro Y).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a3', false);
do $$ begin
  assert exists (select 1 from embarques where id = '00000000-0000-0000-0000-00000000a0b2'), 'consulta vê o de Y';
  begin perform atualizar_embarque('00000000-0000-0000-0000-00000000a0b2', '{"status_liberacao":"suspenso"}', '{"status_liberacao":"liberado"}');
    assert false, 'sem embarques.liberar'; exception when sqlstate '42501' then null; end;
  begin perform encerrar_embarque('00000000-0000-0000-0000-00000000a0b2', null);
    assert false, 'sem embarques.encerrar'; exception when sqlstate '42501' then null; end;
end $$;

-- Usuário com dois centros atua nos dois.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a2', false);
do $$ begin
  assert (select bool_and(no_escopo) from lista_fretes_vitrine(false) where id in ('00000000-0000-0000-0000-00000000a0b1', '00000000-0000-0000-0000-00000000a0b2')), 'X e Y no escopo';
  assert atualizar_embarque('00000000-0000-0000-0000-00000000a0b2', '{"status_liberacao":"suspenso"}', '{"status_liberacao":"liberado"}') ->> 'status' = 'ok', 'suspende em Y';
  assert atualizar_embarque('00000000-0000-0000-0000-00000000a0b2', '{"status_liberacao":"liberado"}', '{"status_liberacao":"suspenso"}') ->> 'status' = 'ok', 'reativa suspenso em Y';
end $$;

-- Bloqueado não ganha acesso pela consulta geral.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a4', false);
do $$ begin
  begin perform 1 from lista_fretes_vitrine(false); assert false, 'bloqueado sem vitrine'; exception when sqlstate '42501' then null; end;
end $$;
reset role;

set role anon;
do $$ begin
  begin perform 1 from lista_fretes_vitrine(false); assert false, 'anon sem vitrine'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Reativação de encerrado: permissão + escopo + motivo + versão; histórico preserva o encerramento anterior.
insert into perfil_permissoes (perfil_id, chave, permitido) values ('00000000-0000-0000-0000-00000000a0a1', 'embarques.reativar_encerrado', true);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a1', false);
do $$ declare r jsonb; v int; begin
  begin perform reativar_embarque_encerrado('00000000-0000-0000-0000-00000000a0b5', 'retomada', 1);
    assert false, 'fora do escopo'; exception when sqlstate 'P0002' then null; end;
  begin perform reativar_embarque_encerrado('00000000-0000-0000-0000-00000000a0b4', '   ', 1);
    assert false, 'motivo obrigatório'; exception when sqlstate '22023' then null; end;
  select versao into v from embarques where id = '00000000-0000-0000-0000-00000000a0b4';
  r := reativar_embarque_encerrado('00000000-0000-0000-0000-00000000a0b4', 'Cliente retomou', v - 1);
  assert r ->> 'status' = 'conflito', 'versão antiga: conflito';
  r := reativar_embarque_encerrado('00000000-0000-0000-0000-00000000a0b4', 'Cliente retomou', v);
  assert r ->> 'status' = 'ok', 'reativado';
  assert r -> 'registro' ->> 'situacao' = 'ativo' and r -> 'registro' ->> 'status_liberacao' = 'liberado'
     and r -> 'registro' ->> 'encerrado_em' is null, 'volta como Liberado';
  assert exists (select 1 from lista_fretes_vitrine(false) where id = '00000000-0000-0000-0000-00000000a0b4'), 'volta para a vitrine';
  assert exists (select 1 from historico_alteracoes where embarque_id = '00000000-0000-0000-0000-00000000a0b4' and campo = 'reativacao_encerrado'
     and valor_anterior like '%Volume concluído%' and valor_novo like '%Cliente retomou%'), 'histórico com encerramento anterior e motivo';
end $$;
reset role;

-- Posições de uma nova data: sempre zeradas, sem perguntar; a data anterior e o que já existe ficam como estão.
insert into posicoes_diarias (embarque_id, data_operacional, porta, transito, carregados, toneladas_por_veiculo, origem, obs_operacional, obs_cliente)
values ('00000000-0000-0000-0000-00000000a0b1', private.hoje_sp() - 1, 5, 4, 3, 40, 'app', 'OBS ONTEM', 'OBS CLIENTE ONTEM');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a1', false);
do $$ declare r jsonb; p posicoes_diarias; begin
  r := abrir_posicoes(private.hoje_sp(), true, array['00000000-0000-0000-0000-00000000a0b1']::uuid[], false);
  assert (r ->> 'criadas')::int = 1, 'abre a posição';
  select * into p from posicoes_diarias where embarque_id = '00000000-0000-0000-0000-00000000a0b1' and data_operacional = private.hoje_sp();
  assert p.porta = 0 and p.transito = 0 and p.carregados = 0, 'transporte legado ignorado: tudo zero';
  assert p.confirmado_em is null and p.obs_operacional is null and p.obs_cliente is null, 'sem confirmação nem observação copiada';
  perform confirmar_posicao(p.id, '{"porta":2,"transito":1,"carregados":1}', '{"porta":0,"transito":0,"carregados":0}');
  r := abrir_posicoes(private.hoje_sp(), false, array['00000000-0000-0000-0000-00000000a0b1']::uuid[], false);
  assert (r ->> 'criadas')::int = 0 and (r ->> 'ja_existiam')::int = 1, 'reabrir é idempotente';
  assert (select porta from posicoes_diarias where id = p.id) = 2, 'não sobrescreve o que foi preenchido';
  assert (select porta from posicoes_diarias where embarque_id = '00000000-0000-0000-0000-00000000a0b1' and data_operacional = private.hoje_sp() - 1) = 5, 'dia anterior preservado';
  assert (select count(*) from posicoes_diarias where embarque_id = '00000000-0000-0000-0000-00000000a0b1' and data_operacional = private.hoje_sp()) = 1, 'uma posição por embarque e data';
end $$;
reset role;

\o
\echo 99_vitrine_tres_estados: ok
