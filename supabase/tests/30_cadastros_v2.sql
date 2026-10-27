-- Testes dos cadastros v2: CNPJ, campos obrigatórios do cliente, cidades e locais digitados.
\set QUIET on
set client_min_messages = warning;
\o /dev/null

-- Cliente vindo da planilha antiga, gravado direto (sem CNPJ nem telefone).
insert into clientes (nome) values ('LEGADO PLANILHA');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

do $$
declare
  v_com uuid := (select id from comerciais where not is_demo order by nome limit 1);
  v_cli jsonb;
  l1 uuid; l2 uuid; l3 uuid; c1 uuid; c2 uuid;
begin
  assert private.cnpj_valido('11.222.333/0001-81'), 'CNPJ válido aceito';
  assert not private.cnpj_valido('11.222.333/0001-82'), 'dígito errado recusado';
  assert not private.cnpj_valido('11111111111111'), 'repetido recusado';

  begin perform salvar_cadastro('cliente', null, jsonb_build_object('nome', 'SEM CNPJ', 'comercial_id', v_com, 'telefone_comercial', '1'));
    assert false, 'cliente sem CNPJ deveria falhar'; exception when sqlstate '22023' then null; end;
  begin perform salvar_cadastro('cliente', null, jsonb_build_object('nome', 'SEM FONE', 'comercial_id', v_com, 'documento', '45.723.174/0001-10'));
    assert false, 'cliente sem telefone comercial deveria falhar'; exception when sqlstate '22023' then null; end;
  begin perform salvar_cadastro('cliente', null, jsonb_build_object('nome', 'SEM COMERCIAL', 'documento', '45.723.174/0001-10', 'telefone_comercial', '1'));
    assert false, 'cliente sem comercial deveria falhar'; exception when sqlstate '22023' then null; end;
  perform salvar_cadastro('cliente', null, jsonb_build_object('nome', 'BLOQUEADO', 'documento', '12345678000195', 'telefone_comercial', '1', 'restricao_comercial', 'NÃO CARREGAR'));
  -- Cliente da planilha antiga (sem CNPJ/telefone): pode ser editado sem completar tudo de uma vez.
  perform salvar_cadastro('cliente', (select id from clientes where nome = 'LEGADO PLANILHA'), '{"ativo": false}');
  begin perform salvar_cadastro('cliente', (select id from clientes where nome = 'LEGADO PLANILHA'), '{"documento": "123"}');
    assert false, 'CNPJ inválido na edição deveria falhar'; exception when sqlstate '22023' then null; end;
  begin perform salvar_cadastro('cliente', null, jsonb_build_object('nome', 'CNPJ REPETIDO', 'comercial_id', v_com, 'documento', '11222333000181', 'telefone_comercial', '1'));
    assert false, 'CNPJ repetido deveria falhar'; exception when unique_violation then null; end;

  v_cli := salvar_cadastro('cliente', null, jsonb_build_object('nome', 'GAMA', 'comercial_id', v_com, 'documento', '45.723.174/0001-10',
    'telefone_comercial', '(64) 3600-0000', 'razao_social', 'GAMA LTDA', 'uf', 'go', 'dados_receita', '{"fonte":"teste"}'::jsonb));
  assert v_cli ->> 'documento' = '45723174000110', 'CNPJ gravado só com dígitos';
  assert v_cli ->> 'uf' = 'GO', 'UF em maiúsculas';
  begin perform salvar_cadastro('cliente', (v_cli ->> 'id')::uuid, '{"telefone_comercial": ""}');
    assert false, 'apagar telefone comercial deveria falhar'; exception when sqlstate '22023' then null; end;

  perform salvar_cadastro('filial', null, '{"nome":"Montividiu","codigo":"MTV","supervisor":"Carlos"}');
  perform salvar_cadastro('comercial', null, '{"nome":"ANA","telefone":"(64) 9 9999-0000"}');
  perform salvar_cadastro('produto', null, '{"nome":"SORGO","valor_pauta_kg":1.35,"valor_pauta_data":"2026-10-27"}');
  assert (select valor_pauta_kg from produtos where nome = 'SORGO') = 1.35, 'valor de pauta gravado';

  l1 := obter_local('Armazém Norte', 'Rio Verde', 'go', 'coleta');
  l2 := obter_local('armazem norte', 'RIO VERDE', 'GO', 'entrega');
  l3 := obter_local('Armazém Norte', 'Jataí', 'GO', 'coleta');
  assert l1 = l2, 'mesmo local reaproveitado ignorando acento e caixa';
  assert l1 <> l3, 'mesmo nome em outra cidade é outro local';
  assert (select tipo from locais where id = l1) = 'ambos', 'local usado nos dois papéis vira ambos';
  assert obter_local('  ', 'Rio Verde', 'GO', 'coleta') is null, 'nome vazio não cria local';

  c1 := obter_cidade('Rio Verde', 'GO');
  c2 := obter_cidade('RIO VERDE', 'go');
  assert c1 = c2, 'cidade reaproveitada';
  assert (select count(*) from cidades where nome_busca = private.normalizar('rio verde')) = 1, 'sem cidade duplicada';
  assert (select uso from cidades where id = c1) = 'ambos', 'cidade criada no embarque vale para origem e destino';
  perform salvar_cadastro('cidade', c1, '{"uso":"origem"}');
  assert (select uso from cidades where id = c1) = 'origem', 'uso da cidade editável';
  begin perform salvar_cadastro('cidade', c1, '{"uso":"qualquer"}');
    assert false, 'uso inválido deveria falhar'; exception when check_violation then null; end;

  -- Centro de custo e vínculo da filial
  v_cli := salvar_cadastro('centro_custo', null, '{"nome":"Sudoeste"}');
  perform salvar_cadastro('filial', (select id from filiais where nome = 'Montividiu'), jsonb_build_object('centro_custo_id', v_cli ->> 'id'));
  assert (select centro_custo_id from filiais where nome = 'Montividiu') = (v_cli ->> 'id')::uuid, 'filial vinculada ao centro de custo';
  begin perform salvar_cadastro('centro_custo', null, '{"nome":"SUDOESTE"}');
    assert false, 'centro de custo duplicado deveria falhar'; exception when unique_violation then null; end;
end $$;

-- Usuário sem permissão não cria locais
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
do $$ begin
  begin perform obter_local('X', 'Y', 'GO', 'coleta');
    assert false, 'consulta não cria local'; exception when insufficient_privilege then null; end;
end $$;

-- Preços da CNA: Goiás primeiro, conversão de unidade, produto novo cadastrado e existente atualizado.
reset role;
do $$
declare r jsonb;
begin
  r := private.cna_aplicar('[
    {"NOME_PRODUTO":"SORGO","TITULO":"R$ / SACA 60 KG","UF":"MT","PRACA":"SORRISO","DATA":"26/10/2026","VALOR":"40.00"},
    {"NOME_PRODUTO":"SORGO","TITULO":"R$ / SACA 60 KG","UF":"GO","PRACA":"RIO VERDE","DATA":"26/10/2026","VALOR":"48.00"},
    {"NOME_PRODUTO":"SORGO","TITULO":"R$ / SACA 60 KG","UF":"GO","PRACA":"JATAI","DATA":"26/10/2026","VALOR":"60.00"},
    {"NOME_PRODUTO":"BOI GORDO","TITULO":"R$ / @","UF":"MG","PRACA":"TRIANGULO","DATA":"26/10/2026","VALOR":"1.500,00"},
    {"NOME_PRODUTO":"ETANOL ANIDRO","TITULO":"R$ / L","UF":"GO","PRACA":"GOIAS","DATA":"26/10/2026","VALOR":"2.94"},
    {"NOME_PRODUTO":"TRIGO - TIPO PÃO","TITULO":"R$ / TON","UF":"PR","PRACA":"NORTE","DATA":"26/10/2026","VALOR":"1571.95"}
  ]'::jsonb);
  assert (select valor_pauta_kg from produtos where cna_produto = 'SORGO' and not is_demo) = 0.9, 'média de GO (54/60) e não MT';
  assert (select valor_pauta_data from produtos where cna_produto = 'SORGO' and not is_demo) = '2026-10-26', 'data da cotação';
  assert (select count(*) from produtos where nome_busca = private.normalizar('sorgo') and not is_demo) = 1, 'produto existente reaproveitado';
  assert (select valor_pauta_kg from produtos where cna_produto = 'BOI GORDO') = 100, 'arroba = 15 kg e valor com vírgula';
  assert (select preco_fonte from produtos where cna_produto = 'BOI GORDO') like '%sem cotação em GO%', 'fonte avisa estado de fora';
  assert (select valor_pauta_kg from produtos where cna_produto = 'ETANOL ANIDRO') is null, 'litro sem conversão';
  assert (select nome from produtos where cna_produto = 'TRIGO - TIPO PÃO') = 'Trigo tipo pão', 'nome amigável';
  assert (select valor_pauta_kg from produtos where cna_produto = 'TRIGO - TIPO PÃO') = 1.5720, 'tonelada';
  perform private.cna_aplicar('[{"NOME_PRODUTO":"SORGO","TITULO":"R$ / SACA 60 KG","UF":"GO","PRACA":"RIO VERDE","DATA":"27/10/2026","VALOR":"66.00"}]'::jsonb);
  assert (select valor_pauta_kg from produtos where cna_produto = 'SORGO' and not is_demo) = 1.1, 'atualização do dia seguinte';
end $$;
