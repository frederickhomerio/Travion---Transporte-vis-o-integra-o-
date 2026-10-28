-- Meta diária obrigatória por embarque e número do lote do ERP na criação.
--   * Todo embarque novo exige meta diária (veículos ou toneladas por dia); a meta não pode ser apagada depois.
--   * Permissão nova embarques.editar_cadencia_proprio: alterar a meta dos embarques que a pessoa criou.
--     A permissão embarques.editar_cadencia continua valendo para qualquer embarque. Ambas ajustáveis em Administração → Permissões.
--   * Campo opcional lote_erp na criação: grava em lotes_erp (um por embarque, com histórico). Se ficar vazio,
--     o apoio informa no atendimento de Lote e Emissão, como antes.
-- Só acrescenta e redefine funções; não apaga dados.

insert into public.permissoes (chave, grupo, descricao) values
  ('embarques.editar_cadencia_proprio', 'Embarques', 'Alterar a meta diária dos embarques que a própria pessoa criou')
on conflict do nothing;

-- Vem marcada para as funções que já criam embarques.
insert into public.papel_permissoes (papel, chave)
select papel, 'embarques.editar_cadencia_proprio' from public.papel_permissoes where chave = 'embarques.criar'
on conflict do nothing;

create or replace function private.regras_embarque()
returns jsonb
language sql
immutable
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
    'status_liberacao',  jsonb_build_object('perm', 'embarques.liberar', 'tipo', 'enum',
                                            'valores', '["liberado","suspenso","nao_informado"]'::jsonb),
    'data_liberacao',    jsonb_build_object('perm', 'embarques.liberar', 'tipo', 'data'),
    'cadencia_valor',    jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'positivo_obrigatorio'),
    'cadencia_unidade',  jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'enum',
                                            'valores', '["veiculos_dia","toneladas_dia"]'::jsonb),
    'toneladas_por_veiculo', jsonb_build_object('perm', 'embarques.editar_capacidade', 'tipo', 'positivo_obrigatorio'),
    'situacao',          jsonb_build_object('perm', 'embarques.arquivar', 'tipo', 'enum',
                                            'valores', '["ativo","arquivado"]'::jsonb),
    'comercial_id',      jsonb_build_object('perm', 'carteira.editar', 'tipo', 'uuid'))
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
  if n.status_liberacao is null then n.status_liberacao := 'nao_informado'; end if;
  if n.status_liberacao <> 'nao_informado' or n.data_liberacao is not null then perform private.exigir('embarques.liberar'); end if;
  n.situacao := 'ativo';
  n.is_demo := coalesce(p_is_demo, false);
  perform private.validar_referencias_embarque(n);

  insert into public.embarques
    (cliente_id, comercial_id, filial_id, produto_id, origem_cidade, origem_uf, local_coleta_id,
     destino_cidade, destino_uf, local_entrega_id, status_liberacao, data_liberacao, cadencia_valor, cadencia_unidade,
     toneladas_por_veiculo, observacao_interna, situacao, is_demo, criado_por, atualizado_por, atualizado_por_nome)
  values
    (n.cliente_id, n.comercial_id, n.filial_id, n.produto_id, n.origem_cidade, n.origem_uf, n.local_coleta_id,
     n.destino_cidade, n.destino_uf, n.local_entrega_id, n.status_liberacao, n.data_liberacao, n.cadencia_valor, n.cadencia_unidade,
     n.toneladas_por_veiculo, n.observacao_interna, n.situacao, n.is_demo, auth.uid(), auth.uid(), private.nome_usuario())
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

create or replace function public.atualizar_embarque(
  p_embarque_id uuid, p_alteracoes jsonb, p_base jsonb, p_forcar boolean default false)
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
  perform private.validar_referencias_embarque(n);

  update public.embarques set
    cliente_id = n.cliente_id, comercial_id = n.comercial_id, filial_id = n.filial_id, produto_id = n.produto_id,
    origem_cidade = n.origem_cidade, origem_uf = n.origem_uf, local_coleta_id = n.local_coleta_id,
    destino_cidade = n.destino_cidade, destino_uf = n.destino_uf, local_entrega_id = n.local_entrega_id,
    status_liberacao = n.status_liberacao, data_liberacao = n.data_liberacao,
    cadencia_valor = n.cadencia_valor, cadencia_unidade = n.cadencia_unidade,
    toneladas_por_veiculo = n.toneladas_por_veiculo, observacao_interna = n.observacao_interna,
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

create or replace function public.registrar_lote_doc(p_id uuid, p_numero text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  l public.lotes_erp;
  v_num text := trim(coalesce(p_numero, ''));
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_informacao']);
  if s.tipo <> 'lote_emissao' then perform private.doc_erro('55000', 'Só a solicitação de lote e emissão registra o lote.'); end if;
  if length(v_num) = 0 or length(v_num) > 60 then perform private.doc_erro('22023', 'Informe o número do lote gerado no ERP.'); end if;
  select * into l from public.lotes_erp where embarque_id = s.embarque_id for update;
  if found then
    if l.solicitacao_id is not null and l.solicitacao_id is distinct from s.id then
      perform private.doc_erro('55000', 'Este embarque já tem lote registrado (' || l.numero || ').');
    end if;
    -- Lote informado na criação do embarque: o apoio confirma (ou corrige) e ele passa a ser desta solicitação.
    if l.solicitacao_id is null then
      update public.lotes_erp set solicitacao_id = s.id where id = l.id returning * into l;
    end if;
    if l.numero = v_num then return jsonb_build_object('status', 'sem_alteracao', 'lote', to_jsonb(l), 'registro', to_jsonb(s)); end if;
    perform private.doc_evento(s.id, 'evento', 'Número do lote corrigido de ' || l.numero || ' para ' || v_num, 'lote');
    perform private.registrar('embarque', s.embarque_id, s.embarque_id, null, (s.retrato ->> 'cliente_id')::uuid, null, 'lote_erp', l.numero, v_num);
    update public.lotes_erp set numero = v_num, versao = versao + 1, atualizado_em = now() where id = l.id returning * into l;
  else
    insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
    values (s.embarque_id, v_num, s.id, auth.uid(), coalesce(private.nome_usuario(), 'Usuário')) returning * into l;
    perform private.doc_evento(s.id, 'evento', 'Lote ' || v_num || ' registrado (gerado no ERP). Emissão desta nota segue em atendimento.', 'lote');
    perform private.registrar('embarque', s.embarque_id, s.embarque_id, null, (s.retrato ->> 'cliente_id')::uuid, null, 'lote_erp', null, v_num);
  end if;
  update public.solicitacoes_doc set lote_id = l.id, retrato = retrato || jsonb_build_object('lote_numero', l.numero),
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  return jsonb_build_object('status', 'ok', 'lote', to_jsonb(l), 'registro', to_jsonb(s));
end $$;

alter function private.regras_embarque() set search_path = public, extensions, pg_temp;
