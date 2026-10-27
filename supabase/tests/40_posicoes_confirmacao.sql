-- Testes da confirmação de posição (Posições de Embarque) e da logo da empresa (migração 1400).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

-- ---------------------------------------------------------------------------
-- Preparação (superusuário): duas filiais, três supervisores e um comercial
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'sup1@teste.local', '{"nome":"Carlos Silva"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'sup2@teste.local', '{"nome":"Marta Lima"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'sup3@teste.local', '{"nome":"Outro Supervisor"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'com4@teste.local', '{"nome":"Comercial Sem Contador"}');

insert into centros_custo (id, nome) values ('00000000-0000-0000-0000-0000000000c1', 'CC TESTE');
insert into filiais (id, nome, centro_custo_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'FILIAL X', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000f2', 'FILIAL Y', null);
insert into clientes (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'CLIENTE CONFIRMA');
insert into embarques (id, cliente_id, filial_id, origem_cidade, destino_cidade) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'JATAI', 'UBERABA'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 'RIO VERDE', 'SANTOS');
insert into posicoes_diarias (id, embarque_id, data_operacional, porta, transito, carregados, toneladas_por_veiculo, origem) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', private.hoje_sp(), 0, 0, 0, 40, 'abertura'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000b1', private.hoje_sp() - 1, 4, 1, 7, 40, 'app'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', private.hoje_sp(), 2, 2, 2, 40, 'abertura');

update perfis set papel = 'supervisor', status = 'ativo' where id in (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3');
update perfis set papel = 'comercial', status = 'ativo' where id = '00000000-0000-0000-0000-0000000000a4';
-- Concessão explícita por filial (Administração → Usuários). O comercial também recebe a filial X.
insert into perfil_filiais (perfil_id, filial_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000f1');

do $$ begin
  assert (select confirmado_em from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') is null,
    'abertura não conta como confirmação';
end $$;

set role authenticated;

-- ---------------------------------------------------------------------------
-- Supervisor 1 salva os três contadores (zero é válido)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare r jsonb;
begin
  r := public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1',
    '{"porta":0,"transito":3,"carregados":2}', '{"porta":0,"transito":0,"carregados":0}');
  assert r ->> 'status' = 'ok', 'gravação confirmada';
  assert (r -> 'registro' ->> 'transito')::int = 3 and (r -> 'registro' ->> 'carregados')::int = 2
     and (r -> 'registro' ->> 'porta')::int = 0, 'três contadores salvos, porta zero mantida';
  assert r -> 'registro' ->> 'confirmado_por_nome' = 'Carlos Silva', 'autor da confirmação vem da sessão';
  assert r -> 'registro' ->> 'confirmado_em' is not null, 'horário do servidor gravado';
  assert (select count(*) from historico_alteracoes where posicao_id = '00000000-0000-0000-0000-0000000000d1'
          and campo in ('transito', 'carregados')) = 2, 'histórico por campo alterado';
  assert (select valor_anterior || '>' || valor_novo from historico_alteracoes
          where posicao_id = '00000000-0000-0000-0000-0000000000d1' and campo = 'transito') = '0>3', 'valor anterior e novo';
  assert (select count(*) from historico_alteracoes where posicao_id = '00000000-0000-0000-0000-0000000000d1'
          and campo = 'confirmacao' and usuario_nome = 'Carlos Silva') = 1, 'confirmação registrada com usuário';

  -- Entradas inválidas são recusadas no servidor
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":-1,"transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'negativo deveria ser recusado'; exception when sqlstate '22023' then null; end;
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":1.5,"transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'fração deveria ser recusada'; exception when sqlstate '22023' then null; end;
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":null,"transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'vazio deveria ser recusado'; exception when sqlstate '22023' then null; end;
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":"2","transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'texto deveria ser recusado'; exception when sqlstate '22023' then null; end;
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":1,"transito":3}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'campo ausente deveria ser recusado'; exception when sqlstate '22023' then null; end;

  -- Posição de ontem não é confirmada nesta página (e fica preservada)
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d0', '{"porta":0,"transito":0,"carregados":0}', '{"porta":4,"transito":1,"carregados":7}');
    raise exception 'data anterior deveria ser recusada'; exception when sqlstate '22023' then null; end;
  assert (select porta from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d0') = 4, 'ontem preservado';
end $$;

-- ---------------------------------------------------------------------------
-- Supervisor 2 começou a editar antes: conflito, nada é sobrescrito
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
do $$
declare r jsonb; v int;
begin
  v := (select versao from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1');
  r := public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1',
    '{"porta":1,"transito":0,"carregados":0}', '{"porta":0,"transito":0,"carregados":0}');
  assert r ->> 'status' = 'conflito', 'mudança desde o início da edição gera conflito';
  assert jsonb_array_length(r -> 'conflitos') = 2, 'trânsito e carregados mudaram';
  assert (r -> 'registro' ->> 'transito')::int = 3, 'conflito devolve os valores atuais';
  assert (select versao from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') = v, 'nada gravado no conflito';
  assert (select porta from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') = 0, 'porta não sobrescrita';

  -- Depois de revisar, confirma sem mudar os números: conta como confirmação dele
  r := public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1',
    '{"porta":0,"transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
  assert r ->> 'status' = 'ok', 'confirmação sem alteração aceita';
  assert r -> 'registro' ->> 'confirmado_por_nome' = 'Marta Lima', 'último autor é quem confirmou';
  assert (r -> 'registro' ->> 'versao')::int = v + 1, 'versão avança na confirmação';
  assert (select count(*) from historico_alteracoes where posicao_id = '00000000-0000-0000-0000-0000000000d1'
          and campo = 'confirmacao' and valor_novo like 'Confirmada sem alteração%' and usuario_nome = 'Marta Lima') = 1,
    'confirmação sem alteração no histórico';
end $$;

-- ---------------------------------------------------------------------------
-- Escopo: supervisor de outra filial não lê nem grava, nem por requisição direta
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
do $$ begin
  assert (select count(*) from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') = 0, 'posição fora do escopo invisível';
  assert (select count(*) from posicoes_diarias where data_operacional = private.hoje_sp()) = 1, 'só a posição da própria filial';
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":9,"transito":9,"carregados":9}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'fora do escopo deveria ser recusado'; exception when sqlstate 'P0002' then null; end;
  assert (select count(*) from historico_alteracoes where posicao_id = '00000000-0000-0000-0000-0000000000d1') = 0, 'histórico de outra filial invisível';
end $$;
reset role;
do $$ begin
  assert (select porta from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') = 0, 'tentativa fora do escopo não gravou';
end $$;

-- Permissão revogada com a página aberta: a próxima gravação é recusada
delete from perfil_filiais where perfil_id = '00000000-0000-0000-0000-0000000000a2';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
do $$ begin
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":0,"transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'acesso revogado deveria ser recusado'; exception when sqlstate 'P0002' then null; end;
  assert (select count(*) from posicoes_diarias) = 0, 'sem concessão, nenhuma posição visível';
end $$;

-- Comercial sem a permissão de contadores não confirma
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);
do $$ begin
  begin perform public.confirmar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":0,"transito":3,"carregados":2}', '{"porta":0,"transito":3,"carregados":2}');
    raise exception 'sem permissão deveria ser recusado'; exception when sqlstate '42501' then null; end;
  -- Observação para o cliente não é confirmação operacional
  perform public.atualizar_posicao('00000000-0000-0000-0000-0000000000d1', '{"obs_cliente":"Fila na balança"}', '{"obs_cliente":null}');
  assert (select confirmado_por_nome from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') = 'Marta Lima',
    'editar observação não muda a confirmação';
  assert public.agora_servidor() is not null, 'horário do servidor disponível';
end $$;

-- Contador alterado pela Lista de Fretes conta como confirmação
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  perform public.atualizar_posicao('00000000-0000-0000-0000-0000000000d1', '{"porta":5}', '{"porta":0}');
  assert (select confirmado_por_nome from posicoes_diarias where id = '00000000-0000-0000-0000-0000000000d1') = 'Carlos Silva',
    'contador pela Lista de Fretes confirma';
end $$;

-- ---------------------------------------------------------------------------
-- Logo da empresa
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  begin perform public.salvar_configuracao('logo_empresa', '"https://exemplo.com/logo.png"');
    raise exception 'logo externa deveria ser recusada'; exception when sqlstate '22023' then null; end;
  perform public.salvar_configuracao('logo_empresa', '"data:image/png;base64,iVBORw0KGgo="');
  assert (select valor #>> '{}' from configuracoes where chave = 'logo_empresa') like 'data:image/png;base64,%', 'logo salva';
  assert (select valor_novo from historico_alteracoes where campo = 'logo_empresa' order by id desc limit 1) = 'imagem nova',
    'histórico sem a imagem inteira';
  perform public.salvar_configuracao('logo_empresa', 'null');
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  begin perform public.salvar_configuracao('logo_empresa', 'null');
    raise exception 'supervisor não altera configurações'; exception when sqlstate '42501' then null; end;
end $$;
reset role;

\o
\echo 40_posicoes_confirmacao: ok
