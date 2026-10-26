-- Testes da importação e dos dados demonstrativos
\set QUIET on
set client_min_messages = warning;
\o /dev/null

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- Duas linhas com a mesma rota (embarques distintos), uma com contador ausente, frete em texto já normalizado.
select set_config('t.payload', $json$
{
  "arquivo_nome": "Lista fretes teste.xlsx", "arquivo_hash": "abc123", "aba": "Lista de Fretes",
  "data_operacional": "2026-10-20", "is_demo": false,
  "clientes": [
    {"nome": "CARAMURU ALIMENTOS S/A", "carteira": "LEANDRO"},
    {"nome": "CLIENTE BLOQUEADO", "carteira": null, "restricao": "NÃO CARREGAR"}
  ],
  "linhas": [
    {"linha": 2, "chave": "k1#1", "carteira": "LEANDRO", "filial": "Itumbiara", "cliente": "CARAMURU ALIMENTOS S/A",
     "origem_cidade": "BELA VISTA", "coleta": "COAPIL", "destino_cidade": "IPAMERI", "destino_uf": "GO", "entrega": "CARAMURU",
     "produto": "SOJA EM GRÃOS", "status": "nao_informado", "frete_empresa": 61, "frete_motorista": 56,
     "frete_motorista_original": "=ROUNDDOWN(J2*0.93,0)", "porta": 7, "transito": 0, "carregados": 2,
     "extras": {"PONTO": 1}},
    {"linha": 3, "chave": "k1#2", "carteira": "LEANDRO", "filial": "Itumbiara", "cliente": "CARAMURU ALIMENTOS S/A",
     "origem_cidade": "BELA VISTA", "coleta": "COAPIL", "destino_cidade": "IPAMERI", "destino_uf": "GO", "entrega": "CARAMURU",
     "produto": "SOJA EM GRÃOS", "status": "nao_informado", "frete_empresa": 67.5, "frete_motorista": null,
     "porta": null, "transito": 1, "carregados": 0, "obs_operacional": "LOTE SUSPENSO"}
  ]
}
$json$, false);

select importar_planilha(current_setting('t.payload')::jsonb) as rel1 \gset
select set_config('t.rel1', :'rel1', false);
do $$ declare r jsonb := current_setting('t.rel1')::jsonb; begin
  assert (r ->> 'embarques_criados')::int = 2, 'mesma rota gera dois embarques distintos';
  assert (r ->> 'posicoes_criadas')::int = 2, 'duas posições';
  assert (select porta from posicoes_diarias p join embarques e on e.id = p.embarque_id where e.chave_importacao = 'k1#2') is null,
    'ausente continua ausente (não vira zero)';
  assert (select status_liberacao from embarques where chave_importacao = 'k1#2') = 'nao_informado',
    'observação "suspenso" não altera status sozinha';
  assert (select restricao_comercial from clientes where nome = 'CLIENTE BLOQUEADO') = 'NÃO CARREGAR', 'restrição preservada';
  assert (select comercial_id from clientes where nome = 'CLIENTE BLOQUEADO') is null, '"NÃO CARREGAR" não vira comercial';
  assert (select frete_motorista_original from embarque_financeiro f join embarques e on e.id = f.embarque_id
          where e.chave_importacao = 'k1#1') = '=ROUNDDOWN(J2*0.93,0)', 'fórmula original preservada como referência';
  assert (select dados ->> 'PONTO' from embarque_dados_origem) = '1', 'campos extras preservados';
end $$;

-- Reimportar o mesmo arquivo não duplica
select importar_planilha(current_setting('t.payload')::jsonb) as rel2 \gset
select set_config('t.rel2', :'rel2', false);
do $$ declare r jsonb := current_setting('t.rel2')::jsonb; begin
  assert (r ->> 'embarques_criados')::int = 0 and (r ->> 'embarques_vinculados')::int = 2, 'reimportação vincula';
  assert (r ->> 'posicoes_iguais')::int = 2, 'posições iguais';
  assert (r ->> 'arquivo_ja_importado')::boolean, 'detecta arquivo já importado';
  assert (select count(*) from embarques where chave_importacao like 'k1#%') = 2, 'sem duplicação de embarques';
  assert (select count(*) from posicoes_diarias where data_operacional = '2026-10-20') = 2, 'sem duplicação de posições';
  assert (select count(*) from clientes where nome_busca = 'CARAMURU ALIMENTOS S/A') = 1, 'sem duplicação de clientes';
end $$;

-- Posição alterada no app não é sobrescrita sem pedido explícito
select atualizar_posicao(p.id, '{"porta":9}', '{"porta":7}') from posicoes_diarias p
  join embarques e on e.id = p.embarque_id where e.chave_importacao = 'k1#1';
select importar_planilha(current_setting('t.payload')::jsonb) ->> 'posicoes_divergentes' as div \gset
select set_config('t.div', :'div', false);
do $$ begin
  assert current_setting('t.div')::int = 1, 'divergência reportada';
  assert (select porta from posicoes_diarias p join embarques e on e.id = p.embarque_id where e.chave_importacao = 'k1#1') = 9,
    'valor do app mantido';
end $$;

-- Operação não importa
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  begin perform importar_planilha(current_setting('t.payload')::jsonb);
    assert false, 'operação não importa'; exception when insufficient_privilege then null; end;
end $$;

-- Dados demonstrativos separados
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select carregar_dados_demo();
do $$ begin
  assert (select count(*) from embarques where is_demo) = 6, 'seis embarques demo';
  assert (select count(*) from embarques e join clientes c on c.id = e.cliente_id where e.is_demo and c.is_demo) = 6,
    'demo só referencia cadastros demo';
  assert not exists (select 1 from clientes where is_demo and nome not like '[DEMO]%'), 'demo identificado no nome';
end $$;
select limpar_dados_demo();
do $$ begin
  assert (select count(*) from embarques where is_demo) = 0, 'demo removido';
  assert (select count(*) from embarques where not is_demo) = 5, 'produção intacta';
end $$;
reset role;
\o
\echo '20_importacao: ok'
