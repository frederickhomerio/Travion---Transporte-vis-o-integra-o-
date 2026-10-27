-- Testes dos critérios de aceite no banco (executar via tests/run.sh, nunca em produção).
\set QUIET on
set client_min_messages = warning;
\o /dev/null

-- ---------------------------------------------------------------------------
-- Preparação (como superusuário)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste.local', '{"nome":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'gestor@teste.local', '{"nome":"Gestor"}'),
  ('00000000-0000-0000-0000-00000000000c', 'operacao@teste.local', '{"nome":"Operação A"}'),
  ('00000000-0000-0000-0000-00000000000d', 'comercial@teste.local', '{"nome":"Comercial"}'),
  ('00000000-0000-0000-0000-00000000000e', 'operacaob@teste.local', '{"nome":"Operação B"}'),
  ('00000000-0000-0000-0000-00000000000f', 'pendente@teste.local', '{"nome":"Pendente"}');

select private.promover_administrador('admin@teste.local');

do $$ begin
  assert (select status from perfis where email = 'pendente@teste.local') = 'pendente', 'novo usuário deve nascer pendente';
end $$;

-- A partir daqui, ações como administrador via API
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

select salvar_cadastro('filial', null, '{"nome":"Rio Verde"}') ->> 'id' as filial_a \gset
select set_config('t.filial_a', :'filial_a', false);
select salvar_cadastro('filial', null, '{"nome":"Jataí"}') ->> 'id' as filial_b \gset
select set_config('t.filial_b', :'filial_b', false);
select salvar_cadastro('comercial', null, '{"nome":"LEANDRO"}') ->> 'id' as com_leandro \gset
select set_config('t.com_leandro', :'com_leandro', false);
select salvar_cadastro('comercial', null, '{"nome":"FREDERICK"}') ->> 'id' as com_frederick \gset
select set_config('t.com_frederick', :'com_frederick', false);
select salvar_cadastro('cliente', null, jsonb_build_object('nome', 'CLIENTE ALFA', 'comercial_id', :'com_leandro', 'documento', '11.222.333/0001-81', 'telefone_comercial', '(64) 99999-0001')) ->> 'id' as cli_alfa \gset
select set_config('t.cli_alfa', :'cli_alfa', false);
select salvar_cadastro('cliente', null, jsonb_build_object('nome', 'CLIENTE BETA', 'comercial_id', :'com_frederick', 'documento', '11444777000161', 'telefone_comercial', '(64) 99999-0002')) ->> 'id' as cli_beta \gset
select set_config('t.cli_beta', :'cli_beta', false);
select salvar_cadastro('produto', null, '{"nome":"MILHO EM GRÃOS"}') ->> 'id' as prod \gset
select set_config('t.prod', :'prod', false);
select salvar_cadastro('local', null, '{"nome":"COMIGO","cidade":"RIO VERDE","uf":"GO","tipo":"coleta"}') ->> 'id' as loc_coleta \gset
select set_config('t.loc_coleta', :'loc_coleta', false);
select salvar_cadastro('local', null, '{"nome":"TES","cidade":"SANTOS","uf":"SP","tipo":"entrega"}') ->> 'id' as loc_entrega \gset
select set_config('t.loc_entrega', :'loc_entrega', false);

-- Mesmo nome de local em outra cidade é outro local
select salvar_cadastro('local', null, '{"nome":"COMIGO","cidade":"IPORA","uf":"GO","tipo":"coleta"}') ->> 'id' as loc_coleta2 \gset
select set_config('t.loc_coleta2', :'loc_coleta2', false);

-- Usuários: aprovação e escopo
select admin_atualizar_usuario('00000000-0000-0000-0000-00000000000b',
  jsonb_build_object('papel', 'gestor', 'status', 'ativo', 'filiais', jsonb_build_array(:'filial_a'))) is not null;
select admin_atualizar_usuario('00000000-0000-0000-0000-00000000000c',
  jsonb_build_object('papel', 'operacao', 'status', 'ativo', 'filiais', jsonb_build_array(:'filial_a'))) is not null;
select admin_atualizar_usuario('00000000-0000-0000-0000-00000000000d',
  jsonb_build_object('papel', 'comercial', 'status', 'ativo', 'comercial_id', :'com_frederick')) is not null;
select admin_atualizar_usuario('00000000-0000-0000-0000-00000000000e',
  jsonb_build_object('papel', 'operacao', 'status', 'ativo', 'filiais', jsonb_build_array(:'filial_b'))) is not null;

-- Embarques: duas rotas iguais = dois embarques distintos
select criar_embarque(jsonb_build_object(
  'cliente_id', :'cli_alfa', 'filial_id', :'filial_a', 'produto_id', :'prod',
  'origem_cidade', 'RIO VERDE', 'origem_uf', 'go', 'local_coleta_id', :'loc_coleta',
  'destino_cidade', 'SANTOS', 'destino_uf', 'SP', 'local_entrega_id', :'loc_entrega',
  'financeiro', jsonb_build_object('frete_empresa', 155, 'frete_motorista', 144),
  'abrir_posicao_em', private.hoje_sp() - 1)) -> 'registro' ->> 'id' as emb1 \gset
select set_config('t.emb1', :'emb1', false);
select criar_embarque(jsonb_build_object(
  'cliente_id', :'cli_alfa', 'filial_id', :'filial_a', 'produto_id', :'prod',
  'origem_cidade', 'RIO VERDE', 'origem_uf', 'GO', 'local_coleta_id', :'loc_coleta',
  'destino_cidade', 'SANTOS', 'destino_uf', 'SP', 'local_entrega_id', :'loc_entrega',
  'cadencia_valor', 3)) -> 'registro' ->> 'id' as emb2 \gset
select set_config('t.emb2', :'emb2', false);
select criar_embarque(jsonb_build_object(
  'cliente_id', :'cli_beta', 'filial_id', :'filial_b',
  'origem_cidade', 'JATAI', 'destino_cidade', 'ARAGUARI', 'destino_uf', 'MG',
  'financeiro', jsonb_build_object('frete_empresa', 155, 'frete_motorista', 139))) -> 'registro' ->> 'id' as emb3 \gset
select set_config('t.emb3', :'emb3', false);

do $$ begin
  assert (select count(*) from embarques) = 3, 'três embarques';
  assert (select comercial_id from embarques where cliente_id = (select id from clientes where nome = 'CLIENTE ALFA') limit 1)
       = (select id from comerciais where nome = 'LEANDRO'), 'carteira sugerida pelo cliente';
  assert (select origem_uf from embarques order by codigo limit 1) = 'GO', 'UF normalizada em maiúsculas';
  assert (select toneladas_por_veiculo from embarques order by codigo limit 1) = 40, 'capacidade padrão 40 t';
end $$;

-- ---------------------------------------------------------------------------
-- Posição de ontem e abertura de hoje com transporte explícito
-- ---------------------------------------------------------------------------
select id as pos_ontem from posicoes_diarias where embarque_id = :'emb1' \gset
select set_config('t.pos_ontem', :'pos_ontem', false);
select atualizar_posicao(:'pos_ontem', '{"porta":3,"transito":2,"carregados":4}', '{"porta":0,"transito":0,"carregados":0}') ->> 'status' as st \gset
select set_config('t.st', :'st', false);
do $$ begin assert current_setting('t.st') = 'ok', 'gravação da posição de ontem'; end $$;

select abrir_posicoes(private.hoje_sp(), true) as abertura \gset
select set_config('t.abertura', :'abertura', false);
do $$ begin
  assert (current_setting('t.abertura')::jsonb ->> 'criadas')::int = 3, 'abre 3 posições hoje';
  assert (current_setting('t.abertura')::jsonb ->> 'sem_posicao_anterior')::int = 2, 'dois sem posição anterior';
end $$;
select id as pos_hoje from posicoes_diarias where embarque_id = :'emb1' and data_operacional = private.hoje_sp() \gset
select set_config('t.pos_hoje', :'pos_hoje', false);
do $$ declare p posicoes_diarias; begin
  select * into p from posicoes_diarias where id = current_setting('t.pos_hoje')::uuid;
  assert p.porta = 3 and p.transito = 2, 'porta e trânsito transportados';
  assert p.carregados = 0, 'carregados começa em zero';
  assert (select carregados from posicoes_diarias where id = current_setting('t.pos_ontem')::uuid) = 4, 'posição anterior preservada';
end $$;

-- Reabrir a mesma data não duplica
select abrir_posicoes(private.hoje_sp(), true) ->> 'criadas' as criadas2 \gset
select set_config('t.criadas2', :'criadas2', false);
do $$ begin assert current_setting('t.criadas2')::int = 0, 'reabertura não duplica'; end $$;

-- ---------------------------------------------------------------------------
-- Critério: cálculo com porta 3, trânsito 2, carregados 4 e 40 t
-- ---------------------------------------------------------------------------
select atualizar_posicao(:'pos_hoje', '{"carregados":4}', '{"carregados":0}') ->> 'status' as st \gset
select set_config('t.st', :'st', false);
do $$ declare p posicoes_diarias; begin
  select * into p from posicoes_diarias where id = current_setting('t.pos_hoje')::uuid;
  assert p.porta * p.toneladas_por_veiculo = 120, 'volume porta 120 t';
  assert p.transito * p.toneladas_por_veiculo = 80, 'volume trânsito 80 t';
  assert p.carregados * p.toneladas_por_veiculo = 160, 'volume carregado 160 t';
  assert (p.porta + p.carregados) * p.toneladas_por_veiculo = 280, 'projeção 280 t';
  assert p.porta + p.transito + p.carregados = 9, 'total operacional 9';
end $$;

-- Valores inválidos são recusados
do $$ begin
  begin perform atualizar_posicao((select id from posicoes_diarias where data_operacional = private.hoje_sp() limit 1), '{"porta":-1}', '{"porta":0}', true);
    assert false, 'negativo deveria falhar'; exception when sqlstate '22023' then null; end;
  begin perform atualizar_posicao((select id from posicoes_diarias where data_operacional = private.hoje_sp() limit 1), '{"porta":1.5}', '{"porta":0}', true);
    assert false, 'decimal deveria falhar'; exception when sqlstate '22023' then null; end;
  begin perform atualizar_posicao((select id from posicoes_diarias where data_operacional = private.hoje_sp() limit 1), '{"porta":"2"}', '{"porta":0}', true);
    assert false, 'texto deveria falhar'; exception when sqlstate '22023' then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Critério: alterar capacidade não modifica posições históricas
-- ---------------------------------------------------------------------------
select atualizar_embarque(:'emb1', '{"toneladas_por_veiculo":37}', '{"toneladas_por_veiculo":40}') ->> 'posicoes_atualizadas' as prop \gset
select set_config('t.prop', :'prop', false);
do $$ begin
  assert current_setting('t.prop')::int = 1, 'apenas a posição de hoje é atualizada';
  assert (select toneladas_por_veiculo from posicoes_diarias where id = current_setting('t.pos_ontem')::uuid) = 40, 'ontem continua 40 t';
  assert (select toneladas_por_veiculo from posicoes_diarias where id = current_setting('t.pos_hoje')::uuid) = 37, 'hoje passa a 37 t';
end $$;
select atualizar_embarque(:'emb1', '{"toneladas_por_veiculo":40}', '{"toneladas_por_veiculo":37}') ->> 'status' as st \gset
select set_config('t.st', :'st', false);

-- ---------------------------------------------------------------------------
-- Critério: dois usuários não perdem alterações silenciosamente
-- ---------------------------------------------------------------------------
-- Gestor e operação carregaram a tela com porta = 3
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select atualizar_posicao(:'pos_hoje', '{"porta":5}', '{"porta":3}') ->> 'status' as st_gestor \gset
select set_config('t.st_gestor', :'st_gestor', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select atualizar_posicao(:'pos_hoje', '{"porta":4}', '{"porta":3}') as res_op \gset
select set_config('t.res_op', :'res_op', false);
do $$ begin
  assert current_setting('t.st_gestor') = 'ok', 'primeira gravação ok';
  assert (current_setting('t.res_op')::jsonb ->> 'status') = 'conflito', 'segunda gravação sobre versão antiga gera conflito';
  assert (current_setting('t.res_op')::jsonb -> 'conflitos' -> 0 ->> 'valor_atual')::int = 5, 'conflito mostra o valor atual';
  assert (select porta from posicoes_diarias where id = current_setting('t.pos_hoje')::uuid) = 5, 'valor do gestor preservado';
end $$;
-- Campos diferentes sobre a mesma versão antiga: sem conflito, os dois ficam
select atualizar_posicao(:'pos_hoje', '{"transito":1}', '{"transito":2}') ->> 'status' as st \gset
select set_config('t.st', :'st', false);
do $$ declare p posicoes_diarias; begin
  select * into p from posicoes_diarias where id = current_setting('t.pos_hoje')::uuid;
  assert current_setting('t.st') = 'ok' and p.porta = 5 and p.transito = 1, 'alterações em campos diferentes não se perdem';
end $$;
-- Após revisar o conflito, a operação confirma explicitamente o seu valor
select atualizar_posicao(:'pos_hoje', '{"porta":4}', '{"porta":5}') ->> 'status' as st \gset
select set_config('t.st', :'st', false);
do $$ begin assert current_setting('t.st') = 'ok' and (select porta from posicoes_diarias where id = current_setting('t.pos_hoje')::uuid) = 4, 'gravação após revisão'; end $$;

-- ---------------------------------------------------------------------------
-- Critério: operação não altera campos financeiros nem por requisição direta
-- ---------------------------------------------------------------------------
do $$ begin
  begin update embarque_financeiro set frete_empresa = 1;
    assert false, 'update direto deveria falhar'; exception when insufficient_privilege then null; end;
  begin update posicoes_diarias set porta = 99;
    assert false, 'update direto em posição deveria falhar'; exception when insufficient_privilege then null; end;
  begin insert into historico_alteracoes (entidade, campo) values ('posicao', 'x');
    assert false, 'insert direto no histórico deveria falhar'; exception when insufficient_privilege then null; end;
  begin perform atualizar_financeiro((select id from embarques order by codigo limit 1), '{"frete_empresa":1}', '{"frete_empresa":155}');
    assert false, 'RPC financeira deveria falhar'; exception when insufficient_privilege then null; end;
  begin perform atualizar_embarque((select id from embarques order by codigo limit 1), '{"toneladas_por_veiculo":30}', '{"toneladas_por_veiculo":40}');
    assert false, 'capacidade deveria falhar'; exception when insufficient_privilege then null; end;
  begin perform atualizar_embarque((select id from embarques order by codigo limit 1), '{"comercial_id":null}', '{}', true);
    assert false, 'carteira deveria falhar'; exception when insufficient_privilege then null; end;
  assert (select count(*) from embarque_financeiro) = 0, 'operação não lê financeiro';
  assert (select count(*) from metas_diarias) = 0, 'operação não lê metas';
  assert (select count(*) from historico_alteracoes where sensivel) = 0, 'operação não lê histórico financeiro';
end $$;

-- Operação da filial B não vê nem altera embarques da filial A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
do $$ begin
  assert (select count(*) from embarques) = 1, 'operação B vê só a filial B';
  assert (select count(*) from posicoes_diarias) = 1, 'operação B vê só posições da filial B';
  begin perform atualizar_posicao(current_setting('t.pos_hoje')::uuid, '{"porta":0}', '{"porta":4}');
    assert false, 'fora do escopo deveria falhar'; exception when sqlstate 'P0002' then null; end;
end $$;

-- Comercial vê apenas a própria carteira e o financeiro dela
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  assert (select count(*) from embarques) = 1, 'comercial vê só a carteira FREDERICK';
  assert (select count(*) from embarque_financeiro) = 1, 'comercial vê financeiro da carteira';
  assert (select count(*) from clientes) = 1, 'comercial vê só clientes da carteira';
  begin perform atualizar_posicao((select id from posicoes_diarias limit 1), '{"porta":1}', '{"porta":0}');
    assert false, 'comercial sem permissão de contador'; exception when insufficient_privilege then null; end;
end $$;

-- Usuário pendente não vê nada
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin
  assert (select count(*) from embarques) = 0 and (select count(*) from filiais) = 0, 'pendente não vê dados';
  begin perform abrir_posicoes(private.hoje_sp(), false);
    assert false, 'pendente não grava'; exception when insufficient_privilege then null; end;
end $$;

-- Exceção individual: gestor recebe acesso financeiro específico
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin assert (select count(*) from embarque_financeiro) = 0, 'gestor sem financeiro por padrão'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select admin_atualizar_usuario('00000000-0000-0000-0000-00000000000b', '{"permissoes":{"financeiro.ver":true}}') is not null;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert (select count(*) from embarque_financeiro) = 2, 'gestor com exceção vê financeiro das filiais dele';
  begin perform atualizar_financeiro((select id from embarques order by codigo limit 1), '{"frete_empresa":1}', '{"frete_empresa":155}');
    assert false, 'ver não implica editar'; exception when insufficient_privilege then null; end;
end $$;

-- Histórico protegido e completo
do $$ begin
  begin update historico_alteracoes set valor_novo = 'x';
    assert false, 'histórico não pode ser editado'; exception when insufficient_privilege then null; end;
  begin delete from historico_alteracoes;
    assert false, 'histórico não pode ser apagado'; exception when insufficient_privilege then null; end;
  assert exists (select 1 from historico_alteracoes where posicao_id = current_setting('t.pos_hoje')::uuid and campo = 'porta'
                 and valor_anterior = '3' and valor_novo = '5' and usuario_nome = 'Gestor'), 'histórico com antes/depois e usuário';
end $$;

-- ---------------------------------------------------------------------------
-- Critério: cliente externo não consulta outro cliente
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select atualizar_posicao(:'pos_hoje', '{"obs_operacional":"motorista sem EPI","obs_cliente":"Previsão de 2 cargas à tarde"}',
  '{"obs_operacional":null,"obs_cliente":null}') ->> 'status' as st \gset
select set_config('t.st', :'st', false);
select criar_link_cliente(:'cli_alfa', 24, true, true) as link_alfa \gset
select set_config('t.link_alfa', :'link_alfa', false);
select :'link_alfa'::jsonb ->> 'token' as token_alfa \gset
select set_config('t.token_alfa', :'token_alfa', false);
select criar_link_cliente(:'cli_beta', 24) ->> 'token' as token_beta \gset
select set_config('t.token_beta', :'token_beta', false);

reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select posicao_publica(:'token_alfa') as pub_alfa \gset
select set_config('t.pub_alfa', :'pub_alfa', false);
do $$ declare j jsonb := current_setting('t.pub_alfa')::jsonb; t text := current_setting('t.pub_alfa'); begin
  assert j ->> 'status' = 'ok', 'link válido';
  assert j ->> 'cliente' = 'CLIENTE ALFA', 'mostra só o próprio cliente';
  assert t not like '%CLIENTE BETA%', 'não mostra outro cliente';
  assert t not like '%sem EPI%', 'não expõe observação interna';
  assert t not like '%155%' and t not like '%frete%', 'não expõe financeiro';
  assert t not like '%Gestor%' and t not like '%Admin%', 'não expõe usuários';
  assert t like '%Previsão de 2 cargas%', 'mostra observação pública';
  -- emb1 e emb2 têm a mesma rota, locais e produto: agrupados num item
  assert jsonb_array_length(j -> 'itens') = 1 and (j -> 'itens' -> 0 ->> 'embarques')::int = 2, 'agrupa rotas compatíveis';
end $$;
do $$ begin
  begin perform 1 from embarques; assert false, 'anon não lê tabelas'; exception when insufficient_privilege then null; end;
  begin perform abrir_posicoes(current_date, false); assert false, 'anon não chama RPC interna'; exception when insufficient_privilege then null; end;
  assert posicao_publica('token-inventado-com-mais-de-vinte-caracteres') ->> 'status' = 'invalido', 'token inválido';
end $$;
reset role;

-- Revogação e expiração
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select revogar_link_cliente((:'link_alfa'::jsonb ->> 'id')::uuid);
reset role;
update links_cliente set expira_em = now() - interval '1 minute' where cliente_id = :'cli_beta';
set role anon;
do $$ begin
  assert posicao_publica(current_setting('t.token_alfa')) ->> 'status' = 'revogado', 'link revogado';
  assert posicao_publica(current_setting('t.token_beta')) ->> 'status' = 'expirado', 'link expirado';
end $$;
reset role;

-- Último administrador não pode ser removido
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  begin perform admin_atualizar_usuario('00000000-0000-0000-0000-00000000000a', '{"papel":"gestor"}');
    assert false, 'último admin'; exception when sqlstate '55000' then null; end;
end $$;
reset role;

\echo '10_aceite: ok'
