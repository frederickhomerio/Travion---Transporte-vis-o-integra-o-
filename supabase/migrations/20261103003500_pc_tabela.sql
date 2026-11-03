-- 03/11/2026 (migração 3500): PC e Tabela no embarque. Só acrescenta colunas e substitui funções; não altera dados.
--
-- Pedido do Frederick: na Lista de Fretes, a coluna "Lote-PC-Tabela" mostra o lote do ERP, a PC e a tabela, um abaixo
-- do outro. PC e Tabela são informados na criação do embarque (opcionais, texto até 60 caracteres) e editáveis com a
-- permissão embarques.editar_cadastro, com histórico. "Toneladas médias por veículo" saiu do formulário de criação:
-- o embarque nasce com o padrão da configuração (já era o comportamento quando o campo não vinha).
-- A vitrine (lista_fretes_vitrine) NÃO devolve PC nem tabela: fora do centro de custo esses dados não aparecem.

alter table public.embarques add column if not exists pc text;
alter table public.embarques add column if not exists tabela text;
alter table public.embarques drop constraint if exists embarques_pc_tamanho;
alter table public.embarques add constraint embarques_pc_tamanho check (pc is null or length(pc) <= 60);
alter table public.embarques drop constraint if exists embarques_tabela_tamanho;
alter table public.embarques add constraint embarques_tabela_tamanho check (tabela is null or length(tabela) <= 60);

create or replace function private.regras_embarque()
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'cliente_id',        jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'filial_id',         jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'produto_id',        jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'origem_cidade',     jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto_obrigatorio'),
    'origem_uf',         jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uf'),
    'local_coleta_id',   jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'destino_cidade',    jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto_obrigatorio'),
    'destino_uf',        jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uf'),
    'local_entrega_id',  jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'observacao_interna',jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto'),
    'pc',                jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto'),
    'tabela',            jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto'),
    'status_liberacao',  jsonb_build_object('perm', 'embarques.liberar', 'tipo', 'enum',
                                            'valores', '["liberado","suspenso"]'::jsonb),
    'data_liberacao',    jsonb_build_object('perm', 'embarques.liberar', 'tipo', 'data'),
    'cadencia_valor',    jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'positivo_obrigatorio'),
    'cadencia_unidade',  jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'enum',
                                            'valores', '["veiculos_dia","toneladas_dia"]'::jsonb),
    'toneladas_por_veiculo', jsonb_build_object('perm', 'embarques.editar_capacidade', 'tipo', 'positivo_obrigatorio'),
    'situacao',          jsonb_build_object('perm', 'embarques.arquivar', 'tipo', 'enum',
                                            'valores', '["ativo","arquivado"]'::jsonb),
    'comercial_id',      jsonb_build_object('perm', 'carteira.editar', 'tipo', 'uuid'))
$$;

create or replace function private.rotulo_campo(p_campo text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_build_object(
    'porta', 'Porta', 'transito', 'Trânsito', 'carregados', 'Carregados',
    'obs_operacional', 'Observação operacional', 'obs_cliente', 'Observação para o cliente',
    'cliente_id', 'Cliente', 'comercial_id', 'Carteira', 'filial_id', 'Filial', 'produto_id', 'Produto',
    'origem_cidade', 'Cidade de origem', 'origem_uf', 'UF de origem', 'local_coleta_id', 'Local de coleta',
    'destino_cidade', 'Cidade de destino', 'destino_uf', 'UF de destino', 'local_entrega_id', 'Local de entrega',
    'status_liberacao', 'Status de liberação', 'data_liberacao', 'Data de liberação',
    'cadencia_valor', 'Cadência', 'cadencia_unidade', 'Unidade da cadência',
    'toneladas_por_veiculo', 'Toneladas médias por veículo', 'observacao_interna', 'Observação interna',
    'pc', 'PC', 'tabela', 'Tabela',
    'situacao', 'Situação cadastral', 'frete_empresa', 'Frete empresa', 'frete_motorista', 'Frete motorista',
    'unidade_frete', 'Unidade do frete', 'meta_valor', 'Meta da posição', 'meta_unidade', 'Unidade da meta'
  ) ->> p_campo, p_campo)
$$;

create or replace function public.criar_embarque(p_dados jsonb, p_is_demo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.embarques;
  c public.clientes;
  v_cap numeric := (select (valor #>> '{}')::numeric from public.configuracoes where chave = 'capacidade_padrao_t');
  v_fin jsonb := p_dados -> 'financeiro';
  v_data date;
  k text;
  v_lote text := nullif(trim(coalesce(p_dados ->> 'lote_erp', '')), '');
begin
  perform private.exigir('embarques.criar');
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'Dados do embarque não informados.';
  end if;

  if not (p_dados ? 'status_liberacao') or p_dados->>'status_liberacao' is null or p_dados->>'status_liberacao'='nao_informado' then
    p_dados:=jsonb_set(p_dados,'{status_liberacao}','"liberado"'::jsonb);
  end if;
  -- Valida todos os campos com as mesmas regras da edição (exceto permissões, conferidas abaixo).
  for k in select jsonb_object_keys(p_dados - 'financeiro' - 'abrir_posicao_em' - 'lote_erp') loop
    if not (private.regras_embarque() ? k) then
      raise exception using errcode = '22023', message = format('Campo "%s" não reconhecido.', k);
    end if;
    p_dados := jsonb_set(p_dados, array[k],
      private.validar_valor(k, private.regras_embarque() -> k ->> 'tipo', p_dados -> k, private.regras_embarque() -> k -> 'valores'));
  end loop;

  n := jsonb_populate_record(null::public.embarques, p_dados - 'lote_erp');
  if n.cliente_id is null or n.filial_id is null or n.origem_cidade is null or n.destino_cidade is null then
    raise exception using errcode = '22023', message = 'Cliente, filial, cidade de origem e cidade de destino são obrigatórios.';
  end if;
  select * into c from public.clientes where id = n.cliente_id;

  -- Carteira: sugerida pelo cadastro do cliente; escolher outra exige permissão específica.
  if not (p_dados ? 'comercial_id') then
    n.comercial_id := c.comercial_id;
  elsif n.comercial_id is distinct from c.comercial_id then
    perform private.exigir('carteira.editar');
  end if;
  if n.toneladas_por_veiculo is null then
    n.toneladas_por_veiculo := coalesce(v_cap, 40);
  elsif n.toneladas_por_veiculo <> coalesce(v_cap, 40) then
    perform private.exigir('embarques.editar_capacidade');
  end if;
  -- Meta diária obrigatória em todo embarque novo (veículos ou toneladas por dia).
  if n.cadencia_valor is null or n.cadencia_valor <= 0 then
    raise exception using errcode = '22023', message = 'Informe a meta diária do embarque (veículos ou toneladas por dia).';
  end if;
  if n.cadencia_unidade is null then n.cadencia_unidade := 'veiculos_dia'; end if;
  if not private.tem_permissao('embarques.editar_cadencia') and not private.tem_permissao('embarques.editar_cadencia_proprio') then
    raise exception using errcode = '42501', message = 'Você não tem permissão para definir a meta diária do embarque.';
  end if;
  if v_lote is not null and length(v_lote) > 60 then
    raise exception using errcode = '22023', message = 'O número do lote do ERP tem no máximo 60 caracteres.';
  end if;
  n.pc := nullif(trim(n.pc), '');
  n.tabela := nullif(trim(n.tabela), '');
  if length(n.pc) > 60 or length(n.tabela) > 60 then
    raise exception using errcode = '22023', message = 'PC e tabela têm no máximo 60 caracteres.';
  end if;
  if n.status_liberacao='suspenso' or n.data_liberacao is not null then perform private.exigir('embarques.liberar'); end if;
  n.situacao := 'ativo';
  n.is_demo := coalesce(p_is_demo, false);
  perform private.validar_referencias_embarque(n);

  insert into public.embarques
    (cliente_id, comercial_id, filial_id, produto_id, origem_cidade, origem_uf, local_coleta_id,
     destino_cidade, destino_uf, local_entrega_id, status_liberacao, data_liberacao, cadencia_valor, cadencia_unidade,
     toneladas_por_veiculo, observacao_interna, pc, tabela, situacao, is_demo, criado_por, atualizado_por, atualizado_por_nome)
  values
    (n.cliente_id, n.comercial_id, n.filial_id, n.produto_id, n.origem_cidade, n.origem_uf, n.local_coleta_id,
     n.destino_cidade, n.destino_uf, n.local_entrega_id, n.status_liberacao, n.data_liberacao, n.cadencia_valor, n.cadencia_unidade,
     n.toneladas_por_veiculo, n.observacao_interna, n.pc, n.tabela, n.situacao, n.is_demo, auth.uid(), auth.uid(), private.nome_usuario())
  returning * into n;

  insert into public.embarque_financeiro (embarque_id) values (n.id);
  if v_lote is not null then
    insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
    values (n.id, v_lote, null, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'));
    perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'lote_erp', null, v_lote);
  end if;
  perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'criacao', null,
    format('Embarque EMB-%s criado', lpad(n.codigo::text, 6, '0')));

  if v_fin is not null and jsonb_typeof(v_fin) = 'object' and v_fin <> '{}'::jsonb then
    perform public.atualizar_financeiro(n.id, v_fin, null, true);
  end if;

  if p_dados ? 'abrir_posicao_em' and nullif(p_dados ->> 'abrir_posicao_em', '') is not null then
    v_data := (p_dados ->> 'abrir_posicao_em')::date;
    perform public.abrir_posicoes(v_data, false, array[n.id], n.is_demo);
  end if;

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;

create or replace function public.atualizar_embarque(p_embarque_id uuid, p_alteracoes jsonb, p_base jsonb, p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.embarques;
  n public.embarques;
  v_prep jsonb;
  v_novo jsonb;
  k text;
  v jsonb;
  v_propagadas integer := 0;
  v_regras jsonb := private.regras_embarque();
begin
  perform private.exigir_ativo();
  select * into r from public.embarques where id = p_embarque_id for update;
  if not found or not private.pode_ver_embarque(r.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  if r.situacao = 'arquivado' and not (p_alteracoes ? 'situacao') then
    raise exception using errcode = '55000', message = 'Embarque arquivado: reative o cadastro antes de alterá-lo.';
  end if;

  if p_alteracoes ? 'situacao' and p_alteracoes->>'situacao' is distinct from r.situacao::text then
    raise exception using errcode='55000',message='Use Encerrar ou Reativar encerrado para preservar o histórico.';
  end if;
  -- Quem criou o embarque pode alterar a meta com a permissão "dos embarques que criei".
  if r.criado_por = auth.uid() and not private.tem_permissao('embarques.editar_cadencia')
     and private.tem_permissao('embarques.editar_cadencia_proprio') then
    v_regras := jsonb_set(jsonb_set(v_regras, '{cadencia_valor,perm}', '"embarques.editar_cadencia_proprio"'),
      '{cadencia_unidade,perm}', '"embarques.editar_cadencia_proprio"');
  end if;
  v_prep := private.preparar_alteracoes(to_jsonb(r), p_alteracoes, p_base, p_forcar, v_regras);
  if jsonb_array_length(v_prep -> 'conflitos') > 0 then
    return jsonb_build_object('status', 'conflito', 'conflitos', v_prep -> 'conflitos', 'registro', to_jsonb(r));
  end if;
  v_novo := v_prep -> 'novo';
  if v_novo = '{}'::jsonb then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(r));
  end if;

  n := jsonb_populate_record(r, v_novo);
  if length(n.pc) > 60 or length(n.tabela) > 60 then
    raise exception using errcode = '22023', message = 'PC e tabela têm no máximo 60 caracteres.';
  end if;
  perform private.validar_referencias_embarque(n);

  update public.embarques set
    cliente_id = n.cliente_id, comercial_id = n.comercial_id, filial_id = n.filial_id, produto_id = n.produto_id,
    origem_cidade = n.origem_cidade, origem_uf = n.origem_uf, local_coleta_id = n.local_coleta_id,
    destino_cidade = n.destino_cidade, destino_uf = n.destino_uf, local_entrega_id = n.local_entrega_id,
    status_liberacao = n.status_liberacao, data_liberacao = n.data_liberacao,
    cadencia_valor = n.cadencia_valor, cadencia_unidade = n.cadencia_unidade,
    toneladas_por_veiculo = n.toneladas_por_veiculo, observacao_interna = n.observacao_interna,
    pc = n.pc, tabela = n.tabela,
    situacao = n.situacao, versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid(),
    atualizado_por_nome = private.nome_usuario()
  where id = r.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('embarque', r.id, r.id, null, n.cliente_id, null, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v));
  end loop;

  if v_novo ?| array['toneladas_por_veiculo', 'cadencia_valor', 'cadencia_unidade'] then
    v_propagadas := private.propagar_capacidade_meta(n);
  end if;

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n), 'posicoes_atualizadas', v_propagadas);
end $$;

notify pgrst, 'reload schema';
