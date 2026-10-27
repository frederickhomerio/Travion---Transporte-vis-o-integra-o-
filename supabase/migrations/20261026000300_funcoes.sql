-- Travion — funções do servidor (gravações, auditoria, concorrência, compartilhamento, importação)
--
-- Todas as gravações passam por estas funções. Cada uma:
--   1. confere se o usuário está ativo, tem a permissão do campo e o registro está no seu escopo;
--   2. trava o registro (FOR UPDATE) e compara o valor que o usuário viu com o valor atual;
--   3. grava apenas os campos alterados, incrementa a versão e registra o histórico.

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.rotulo_campo(p_campo text)
returns text
language sql
immutable
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
    'situacao', 'Situação cadastral', 'frete_empresa', 'Frete empresa', 'frete_motorista', 'Frete motorista',
    'unidade_frete', 'Unidade do frete', 'meta_valor', 'Meta da posição', 'meta_unidade', 'Unidade da meta'
  ) ->> p_campo, p_campo)
$$;

create or replace function private.exigir_ativo()
returns void
language plpgsql
stable
as $$
begin
  if not private.usuario_ativo() then
    raise exception using errcode = '42501', message = 'Seu acesso ainda não foi aprovado ou está bloqueado.';
  end if;
end $$;

create or replace function private.exigir(p_chave text)
returns void
language plpgsql
stable
as $$
begin
  perform private.exigir_ativo();
  if not private.tem_permissao(p_chave) then
    raise exception using errcode = '42501',
      message = format('Você não tem permissão para esta ação (%s).',
                       (select descricao from public.permissoes where chave = p_chave));
  end if;
end $$;

create or replace function private.registrar(
  p_entidade text, p_registro_id uuid, p_embarque_id uuid, p_posicao_id uuid, p_cliente_id uuid,
  p_data date, p_campo text, p_anterior text, p_novo text, p_sensivel boolean default false, p_origem text default 'app')
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.historico_alteracoes
    (entidade, registro_id, embarque_id, posicao_id, cliente_id, data_operacional, campo,
     valor_anterior, valor_novo, sensivel, origem, usuario_id, usuario_nome)
  values
    (p_entidade, p_registro_id, p_embarque_id, p_posicao_id, p_cliente_id, p_data, p_campo,
     p_anterior, p_novo, p_sensivel, p_origem, auth.uid(), coalesce(private.nome_usuario(), 'Sistema'))
$$;

create or replace function private.json_texto(p jsonb)
returns text
language sql
immutable
as $$ select case when p is null or jsonb_typeof(p) = 'null' then null else p #>> '{}' end $$;

-- Valida e normaliza um valor conforme o tipo declarado. Lança erro amigável.
create or replace function private.validar_valor(p_campo text, p_tipo text, p_valor jsonb, p_valores jsonb default null)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_num numeric;
  v_txt text;
  v_rot text := private.rotulo_campo(p_campo);
begin
  if p_valor is null or jsonb_typeof(p_valor) = 'null' then
    if p_tipo in ('texto_obrigatorio', 'positivo_obrigatorio', 'enum') then
      raise exception using errcode = '22023', message = format('%s é obrigatório.', v_rot);
    end if;
    return 'null'::jsonb;
  end if;

  case p_tipo
    when 'contador' then
      if jsonb_typeof(p_valor) <> 'number' then
        raise exception using errcode = '22023', message = format('%s deve ser um número inteiro maior ou igual a zero.', v_rot);
      end if;
      v_num := (p_valor #>> '{}')::numeric;
      if v_num < 0 or v_num <> trunc(v_num) or v_num > 100000 then
        raise exception using errcode = '22023', message = format('%s deve ser um número inteiro maior ou igual a zero.', v_rot);
      end if;
      return to_jsonb(v_num::integer);
    when 'positivo', 'positivo_obrigatorio' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric <= 0 then
        raise exception using errcode = '22023', message = format('%s deve ser um número maior que zero.', v_rot);
      end if;
      return p_valor;
    when 'dinheiro' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric < 0 then
        raise exception using errcode = '22023', message = format('%s deve ser um valor maior ou igual a zero.', v_rot);
      end if;
      return to_jsonb(round((p_valor #>> '{}')::numeric, 2));
    when 'texto', 'texto_obrigatorio' then
      if jsonb_typeof(p_valor) <> 'string' then
        raise exception using errcode = '22023', message = format('%s deve ser um texto.', v_rot);
      end if;
      v_txt := nullif(trim(p_valor #>> '{}'), '');
      if v_txt is null and p_tipo = 'texto_obrigatorio' then
        raise exception using errcode = '22023', message = format('%s é obrigatório.', v_rot);
      end if;
      if length(v_txt) > 2000 then
        raise exception using errcode = '22023', message = format('%s excede 2.000 caracteres.', v_rot);
      end if;
      return coalesce(to_jsonb(v_txt), 'null'::jsonb);
    when 'uf' then
      v_txt := upper(nullif(trim(p_valor #>> '{}'), ''));
      if v_txt is not null and v_txt !~ '^[A-Z]{2}$' then
        raise exception using errcode = '22023', message = format('%s deve ter 2 letras.', v_rot);
      end if;
      return coalesce(to_jsonb(v_txt), 'null'::jsonb);
    when 'uuid' then
      v_txt := p_valor #>> '{}';
      if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = format('%s inválido.', v_rot);
      end if;
      return to_jsonb(lower(v_txt));
    when 'data' then
      begin
        return to_jsonb(((p_valor #>> '{}')::date)::text);
      exception when others then
        raise exception using errcode = '22023', message = format('%s deve ser uma data válida.', v_rot);
      end;
    when 'enum' then
      if not (p_valores ? (p_valor #>> '{}')) then
        raise exception using errcode = '22023', message = format('%s com valor inválido.', v_rot);
      end if;
      return p_valor;
    else
      raise exception 'Tipo de validação desconhecido: %', p_tipo;
  end case;
end $$;

-- Compara alterações propostas com o registro atual.
-- p_regras: { campo: { "perm": "...", "tipo": "...", "valores": [...] } }
-- Retorna { "novo": {campo: valor}, "conflitos": [...] }.
create or replace function private.preparar_alteracoes(
  p_atual jsonb, p_alteracoes jsonb, p_base jsonb, p_forcar boolean, p_regras jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  k text;
  v jsonb;
  regra jsonb;
  v_novo jsonb := '{}';
  v_conflitos jsonb := '[]';
begin
  if p_alteracoes is null or jsonb_typeof(p_alteracoes) <> 'object' then
    raise exception using errcode = '22023', message = 'Nenhuma alteração informada.';
  end if;
  for k, v in select * from jsonb_each(p_alteracoes) loop
    regra := p_regras -> k;
    if regra is null then
      raise exception using errcode = '42501', message = format('O campo "%s" não pode ser alterado por esta ação.', k);
    end if;
    if not private.tem_permissao(regra ->> 'perm') then
      raise exception using errcode = '42501', message = format('Você não tem permissão para alterar %s.', private.rotulo_campo(k));
    end if;
    v := private.validar_valor(k, regra ->> 'tipo', v, regra -> 'valores');
    if (p_atual -> k) is not distinct from v then
      continue; -- nada mudou neste campo
    end if;
    if not coalesce(p_forcar, false) then
      if p_base is null or not (p_base ? k) then
        raise exception using errcode = '22023', message = format('Valor de referência ausente para %s.', private.rotulo_campo(k));
      end if;
      -- Outra pessoa alterou este mesmo campo depois que o usuário carregou a tela
      if (p_base -> k) is distinct from (p_atual -> k)
         and not (jsonb_typeof(p_base -> k) = 'number' and jsonb_typeof(p_atual -> k) = 'number'
                  and (p_base ->> k)::numeric = (p_atual ->> k)::numeric) then
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'campo', k, 'rotulo', private.rotulo_campo(k),
          'valor_base', p_base -> k, 'valor_atual', p_atual -> k, 'valor_proposto', v));
        continue;
      end if;
    end if;
    v_novo := v_novo || jsonb_build_object(k, v);
  end loop;
  return jsonb_build_object('novo', v_novo, 'conflitos', v_conflitos);
end $$;

-- ---------------------------------------------------------------------------
-- Posição diária
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_posicao(
  p_posicao_id uuid, p_alteracoes jsonb, p_base jsonb, p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.posicoes_diarias;
  e public.embarques;
  n public.posicoes_diarias;
  v_prep jsonb;
  v_novo jsonb;
  k text;
  v jsonb;
begin
  perform private.exigir_ativo();
  select * into r from public.posicoes_diarias where id = p_posicao_id for update;
  if not found or not private.pode_ver_embarque(r.embarque_id) then
    raise exception using errcode = 'P0002', message = 'Posição não encontrada ou fora do seu escopo.';
  end if;
  select * into e from public.embarques where id = r.embarque_id;
  if e.situacao = 'arquivado' then
    raise exception using errcode = '55000', message = 'Embarque arquivado: reative o cadastro para atualizar a posição.';
  end if;

  v_prep := private.preparar_alteracoes(to_jsonb(r), p_alteracoes, p_base, p_forcar, jsonb_build_object(
    'porta',           jsonb_build_object('perm', 'posicoes.editar_contadores', 'tipo', 'contador'),
    'transito',        jsonb_build_object('perm', 'posicoes.editar_contadores', 'tipo', 'contador'),
    'carregados',      jsonb_build_object('perm', 'posicoes.editar_contadores', 'tipo', 'contador'),
    'obs_operacional', jsonb_build_object('perm', 'posicoes.editar_obs_operacional', 'tipo', 'texto'),
    'obs_cliente',     jsonb_build_object('perm', 'posicoes.editar_obs_cliente', 'tipo', 'texto')));

  if jsonb_array_length(v_prep -> 'conflitos') > 0 then
    return jsonb_build_object('status', 'conflito', 'conflitos', v_prep -> 'conflitos', 'registro', to_jsonb(r));
  end if;
  v_novo := v_prep -> 'novo';
  if v_novo = '{}'::jsonb then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(r));
  end if;

  n := jsonb_populate_record(r, v_novo);
  update public.posicoes_diarias set
    porta = n.porta, transito = n.transito, carregados = n.carregados,
    obs_operacional = n.obs_operacional, obs_cliente = n.obs_cliente,
    versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid(),
    atualizado_por_nome = private.nome_usuario()
  where id = r.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('posicao', r.id, r.embarque_id, r.id, e.cliente_id, r.data_operacional, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v));
  end loop;

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;

-- Abre posições para uma nova data. Não transporta nada sem pedido explícito.
create or replace function public.abrir_posicoes(
  p_data date, p_transportar_saldos boolean, p_embarque_ids uuid[] default null, p_is_demo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e record;
  ant public.posicoes_diarias;
  v_id uuid;
  v_criadas integer := 0;
  v_existentes integer := 0;
  v_sem_anterior integer := 0;
  v_porta integer;
  v_transito integer;
  v_desc text;
begin
  perform private.exigir('posicoes.abrir');
  if p_data is null then
    raise exception using errcode = '22023', message = 'Informe a data operacional.';
  end if;
  if p_data > private.hoje_sp() + 1 then
    raise exception using errcode = '22023', message = 'Só é possível abrir posições até o dia seguinte.';
  end if;

  for e in
    select x.* from public.embarques x
    where x.is_demo = p_is_demo and x.situacao = 'ativo'
      and (p_embarque_ids is null or x.id = any (p_embarque_ids))
      and private.pode_ver_embarque(x.id)
    order by x.codigo
  loop
    if exists (select 1 from public.posicoes_diarias p where p.embarque_id = e.id and p.data_operacional = p_data) then
      v_existentes := v_existentes + 1;
      continue;
    end if;

    select * into ant from public.posicoes_diarias p
    where p.embarque_id = e.id and p.data_operacional < p_data
    order by p.data_operacional desc limit 1;

    if p_transportar_saldos and ant.id is not null then
      v_porta := ant.porta;
      v_transito := ant.transito;
      v_desc := format('Porta %s e trânsito %s transportados de %s; carregados iniciado em 0',
                       coalesce(ant.porta::text, 'não informado'), coalesce(ant.transito::text, 'não informado'),
                       to_char(ant.data_operacional, 'DD/MM/YYYY'));
    else
      if p_transportar_saldos then v_sem_anterior := v_sem_anterior + 1; end if;
      v_porta := 0;
      v_transito := 0;
      v_desc := case when p_transportar_saldos then 'Sem posição anterior: porta, trânsito e carregados iniciados em 0'
                     else 'Porta, trânsito e carregados iniciados em 0' end;
    end if;

    insert into public.posicoes_diarias
      (embarque_id, data_operacional, porta, transito, carregados, toneladas_por_veiculo, meta_valor, meta_unidade,
       is_demo, origem, criado_por, atualizado_por, atualizado_por_nome)
    values
      (e.id, p_data, v_porta, v_transito, 0, e.toneladas_por_veiculo, e.cadencia_valor, e.cadencia_unidade,
       e.is_demo, 'abertura', auth.uid(), auth.uid(), private.nome_usuario())
    returning id into v_id;

    perform private.registrar('posicao', v_id, e.id, v_id, e.cliente_id, p_data, 'abertura', null, v_desc);
    v_criadas := v_criadas + 1;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ja_existiam', v_existentes, 'sem_posicao_anterior', v_sem_anterior);
end $$;

-- ---------------------------------------------------------------------------
-- Embarques
-- ---------------------------------------------------------------------------
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
    'cadencia_valor',    jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'positivo'),
    'cadencia_unidade',  jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'enum',
                                            'valores', '["veiculos_dia","toneladas_dia"]'::jsonb),
    'toneladas_por_veiculo', jsonb_build_object('perm', 'embarques.editar_capacidade', 'tipo', 'positivo_obrigatorio'),
    'situacao',          jsonb_build_object('perm', 'embarques.arquivar', 'tipo', 'enum',
                                            'valores', '["ativo","arquivado"]'::jsonb),
    'comercial_id',      jsonb_build_object('perm', 'carteira.editar', 'tipo', 'uuid'))
$$;

create or replace function private.validar_referencias_embarque(n public.embarques)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.clientes c where c.id = n.cliente_id and c.is_demo = n.is_demo) then
    raise exception using errcode = '22023', message = 'Cliente inválido.';
  end if;
  if not exists (select 1 from public.filiais f where f.id = n.filial_id and f.is_demo = n.is_demo) then
    raise exception using errcode = '22023', message = 'Filial inválida.';
  end if;
  if n.produto_id is not null and not exists (select 1 from public.produtos x where x.id = n.produto_id and x.is_demo = n.is_demo) then
    raise exception using errcode = '22023', message = 'Produto inválido.';
  end if;
  if n.comercial_id is not null and not exists (select 1 from public.comerciais x where x.id = n.comercial_id and x.is_demo = n.is_demo) then
    raise exception using errcode = '22023', message = 'Carteira inválida.';
  end if;
  if n.local_coleta_id is not null and not exists (select 1 from public.locais x where x.id = n.local_coleta_id and x.is_demo = n.is_demo) then
    raise exception using errcode = '22023', message = 'Local de coleta inválido.';
  end if;
  if n.local_entrega_id is not null and not exists (select 1 from public.locais x where x.id = n.local_entrega_id and x.is_demo = n.is_demo) then
    raise exception using errcode = '22023', message = 'Local de entrega inválido.';
  end if;
  if not private.no_escopo(n.filial_id, n.comercial_id) then
    raise exception using errcode = '42501', message = 'A filial ou carteira escolhida está fora do seu escopo.';
  end if;
end $$;

-- Propaga capacidade e meta para as posições de hoje em diante (datas passadas ficam preservadas).
create or replace function private.propagar_capacidade_meta(e public.embarques)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  v_qtd integer := 0;
begin
  for p in
    select * from public.posicoes_diarias
    where embarque_id = e.id and data_operacional >= private.hoje_sp()
      and (toneladas_por_veiculo is distinct from e.toneladas_por_veiculo
           or meta_valor is distinct from e.cadencia_valor
           or meta_unidade is distinct from e.cadencia_unidade)
    for update
  loop
    update public.posicoes_diarias set
      toneladas_por_veiculo = e.toneladas_por_veiculo, meta_valor = e.cadencia_valor, meta_unidade = e.cadencia_unidade,
      versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = private.nome_usuario()
    where id = p.id;
    if p.toneladas_por_veiculo is distinct from e.toneladas_por_veiculo then
      perform private.registrar('posicao', p.id, e.id, p.id, e.cliente_id, p.data_operacional, 'toneladas_por_veiculo',
        p.toneladas_por_veiculo::text, e.toneladas_por_veiculo::text, false, 'sistema');
    end if;
    if p.meta_valor is distinct from e.cadencia_valor or p.meta_unidade is distinct from e.cadencia_unidade then
      perform private.registrar('posicao', p.id, e.id, p.id, e.cliente_id, p.data_operacional, 'meta_valor',
        concat_ws(' ', p.meta_valor::text, p.meta_unidade::text), concat_ws(' ', e.cadencia_valor::text, e.cadencia_unidade::text),
        false, 'sistema');
    end if;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
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
begin
  perform private.exigir_ativo();
  select * into r from public.embarques where id = p_embarque_id for update;
  if not found or not private.pode_ver_embarque(r.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  if r.situacao = 'arquivado' and not (p_alteracoes ? 'situacao') then
    raise exception using errcode = '55000', message = 'Embarque arquivado: reative o cadastro antes de alterá-lo.';
  end if;

  v_prep := private.preparar_alteracoes(to_jsonb(r), p_alteracoes, p_base, p_forcar, private.regras_embarque());
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

create or replace function public.atualizar_financeiro(
  p_embarque_id uuid, p_alteracoes jsonb, p_base jsonb, p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.embarque_financeiro;
  n public.embarque_financeiro;
  e public.embarques;
  v_prep jsonb;
  v_novo jsonb;
  k text;
  v jsonb;
begin
  perform private.exigir('financeiro.ver');
  perform private.exigir('financeiro.editar');
  select * into e from public.embarques where id = p_embarque_id;
  if not found or not private.pode_ver_embarque(e.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  insert into public.embarque_financeiro (embarque_id) values (e.id) on conflict do nothing;
  select * into r from public.embarque_financeiro where embarque_id = e.id for update;

  v_prep := private.preparar_alteracoes(to_jsonb(r), p_alteracoes, p_base, p_forcar, jsonb_build_object(
    'frete_empresa',   jsonb_build_object('perm', 'financeiro.editar', 'tipo', 'dinheiro'),
    'frete_motorista', jsonb_build_object('perm', 'financeiro.editar', 'tipo', 'dinheiro'),
    'unidade_frete',   jsonb_build_object('perm', 'financeiro.editar', 'tipo', 'enum',
                                          'valores', '["nao_confirmada","rs_tonelada","rs_viagem","outra"]'::jsonb)));
  if jsonb_array_length(v_prep -> 'conflitos') > 0 then
    return jsonb_build_object('status', 'conflito', 'conflitos', v_prep -> 'conflitos', 'registro', to_jsonb(r));
  end if;
  v_novo := v_prep -> 'novo';
  if v_novo = '{}'::jsonb then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(r));
  end if;

  n := jsonb_populate_record(r, v_novo);
  update public.embarque_financeiro set
    frete_empresa = n.frete_empresa, frete_motorista = n.frete_motorista, unidade_frete = n.unidade_frete,
    versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid()
  where embarque_id = e.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('financeiro', e.id, e.id, null, e.cliente_id, null, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v), true);
  end loop;
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;

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
begin
  perform private.exigir('embarques.criar');
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'Dados do embarque não informados.';
  end if;

  -- Valida todos os campos com as mesmas regras da edição (exceto permissões, conferidas abaixo).
  for k in select jsonb_object_keys(p_dados - 'financeiro' - 'abrir_posicao_em') loop
    if not (private.regras_embarque() ? k) then
      raise exception using errcode = '22023', message = format('Campo "%s" não reconhecido.', k);
    end if;
    p_dados := jsonb_set(p_dados, array[k],
      private.validar_valor(k, private.regras_embarque() -> k ->> 'tipo', p_dados -> k, private.regras_embarque() -> k -> 'valores'));
  end loop;

  n := jsonb_populate_record(null::public.embarques, p_dados);
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
  if n.cadencia_valor is not null then perform private.exigir('embarques.editar_cadencia'); end if;
  if n.cadencia_unidade is null then n.cadencia_unidade := 'veiculos_dia'; end if;
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

-- ---------------------------------------------------------------------------
-- Cadastros auxiliares
-- ---------------------------------------------------------------------------
create or replace function public.salvar_cadastro(p_tipo text, p_id uuid, p_dados jsonb, p_is_demo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabela text;
  v_cols text[];
  v_res jsonb;
  v_ant jsonb;
  k text;
begin
  perform private.exigir('cadastros.gerenciar');
  case p_tipo
    when 'filial' then v_tabela := 'filiais'; v_cols := array['nome', 'codigo', 'ativo'];
    when 'comercial' then v_tabela := 'comerciais'; v_cols := array['nome', 'email', 'ativo'];
    when 'produto' then v_tabela := 'produtos'; v_cols := array['nome', 'ativo'];
    when 'local' then v_tabela := 'locais'; v_cols := array['nome', 'cidade', 'uf', 'tipo', 'ativo'];
    when 'cliente' then v_tabela := 'clientes'; v_cols := array['nome', 'documento', 'comercial_id', 'restricao_comercial', 'ativo'];
    else raise exception using errcode = '22023', message = 'Tipo de cadastro inválido.';
  end case;

  for k in select jsonb_object_keys(p_dados) loop
    if not (k = any (v_cols)) then
      raise exception using errcode = '22023', message = format('Campo "%s" não pode ser alterado neste cadastro.', k);
    end if;
  end loop;
  if p_dados ? 'nome' then
    p_dados := jsonb_set(p_dados, '{nome}', private.validar_valor('nome', 'texto_obrigatorio', p_dados -> 'nome'));
  end if;
  if p_dados ? 'uf' then
    p_dados := jsonb_set(p_dados, '{uf}', private.validar_valor('uf', 'uf', p_dados -> 'uf'));
  end if;

  begin
    if p_id is null then
      if p_tipo = 'cliente' and nullif(p_dados ->> 'comercial_id', '') is not null then
        perform private.exigir('carteira.editar');
      end if;
      execute format(
        'insert into public.%I (%s, is_demo) select %s, $2 from jsonb_populate_record(null::public.%I, $1) r returning to_jsonb(%I.*)',
        v_tabela,
        (select string_agg(quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c),
        (select string_agg('r.' || quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c),
        v_tabela, v_tabela)
      using p_dados, coalesce(p_is_demo, false)
      into v_res;
    else
      execute format('select to_jsonb(t.*) from public.%I t where id = $1 for update', v_tabela) using p_id into v_ant;
      if v_ant is null then
        raise exception using errcode = 'P0002', message = 'Cadastro não encontrado.';
      end if;
      if p_tipo = 'cliente' and p_dados ? 'comercial_id'
         and (v_ant -> 'comercial_id') is distinct from (p_dados -> 'comercial_id') then
        perform private.exigir('carteira.editar');
      end if;
      execute format(
        'update public.%I t set (%s) = (select %s from jsonb_populate_record(t, $1) r) where id = $2 returning to_jsonb(t.*)',
        v_tabela,
        (select string_agg(quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c),
        (select string_agg('r.' || quote_ident(c), ', ') from unnest(v_cols) c where p_dados ? c))
      using p_dados, p_id
      into v_res;
      if p_tipo = 'cliente' then
        for k in select unnest(v_cols) loop
          if (v_ant -> k) is distinct from (v_res -> k) then
            perform private.registrar('cliente', p_id, null, null, p_id, null, k,
              private.json_texto(v_ant -> k), private.json_texto(v_res -> k));
          end if;
        end loop;
      end if;
    end if;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'Já existe um cadastro com este nome.';
  end;
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Usuários, convites e permissões
-- ---------------------------------------------------------------------------
create or replace function private.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cv public.convites;
  f uuid;
  k text;
  v jsonb;
begin
  select * into cv from public.convites
  where lower(email) = lower(new.email) and usado_em is null and expira_em > now()
  order by criado_em desc limit 1;

  insert into public.perfis (id, email, nome, papel, status, comercial_id, aprovado_por, aprovado_em)
  values (new.id, new.email,
          coalesce(cv.nome, new.raw_user_meta_data ->> 'nome', new.raw_user_meta_data ->> 'full_name', ''),
          coalesce(cv.papel, 'consulta'),
          case when cv.id is not null then 'ativo'::public.status_usuario else 'pendente'::public.status_usuario end,
          cv.comercial_id, cv.criado_por, case when cv.id is not null then now() end)
  on conflict (id) do nothing;

  if cv.id is not null then
    foreach f in array cv.filiais loop
      insert into public.perfil_filiais (perfil_id, filial_id) values (new.id, f) on conflict do nothing;
    end loop;
    for k, v in select * from jsonb_each(cv.permissoes) loop
      if jsonb_typeof(v) = 'boolean' then
        insert into public.perfil_permissoes (perfil_id, chave, permitido) values (new.id, k, v::text::boolean)
        on conflict do nothing;
      end if;
    end loop;
    update public.convites set usado_em = now(), usado_por = new.id where id = cv.id;
  end if;
  return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
  for each row execute function private.ao_criar_usuario();

-- Para o primeiro acesso: executar no SQL Editor do Supabase (como postgres/service_role).
create or replace function private.promover_administrador(p_email text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.perfis set papel = 'administrador', status = 'ativo', aprovado_em = now()
  where lower(email) = lower(p_email) returning id into v_id;
  if v_id is null then
    return 'Nenhum usuário com este e-mail. Peça para a pessoa criar a conta primeiro.';
  end if;
  return 'Usuário promovido a administrador.';
end $$;
revoke execute on function private.promover_administrador(text) from authenticated;

create or replace function public.admin_atualizar_usuario(p_perfil_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.perfis;
  n public.perfis;
  k text;
  v jsonb;
  v_ant text;
  v_filiais uuid[];
begin
  perform private.exigir('usuarios.gerenciar');
  select * into r from public.perfis where id = p_perfil_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Usuário não encontrado.';
  end if;
  for k in select jsonb_object_keys(p_dados) loop
    if not (k = any (array['nome', 'papel', 'status', 'comercial_id', 'filiais', 'permissoes'])) then
      raise exception using errcode = '22023', message = format('Campo "%s" não reconhecido.', k);
    end if;
  end loop;
  if (p_dados ? 'papel' and p_dados ->> 'papel' = 'administrador' or r.papel = 'administrador') and not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores podem conceder ou alterar acesso de administrador.';
  end if;

  n := jsonb_populate_record(r, p_dados - 'filiais' - 'permissoes');
  if r.papel = 'administrador' and r.status = 'ativo' and (n.papel <> 'administrador' or n.status <> 'ativo')
     and (select count(*) from public.perfis where papel = 'administrador' and status = 'ativo') <= 1 then
    raise exception using errcode = '55000', message = 'Não é possível remover o último administrador ativo.';
  end if;
  if r.id = auth.uid() and n.status <> 'ativo' then
    raise exception using errcode = '55000', message = 'Você não pode bloquear o seu próprio acesso.';
  end if;

  update public.perfis set
    nome = n.nome, papel = n.papel, status = n.status, comercial_id = n.comercial_id, atualizado_em = now(),
    aprovado_por = case when r.status = 'pendente' and n.status = 'ativo' then auth.uid() else aprovado_por end,
    aprovado_em = case when r.status = 'pendente' and n.status = 'ativo' then now() else aprovado_em end
  where id = r.id returning * into n;

  for k in select unnest(array['nome', 'papel', 'status', 'comercial_id']) loop
    if (to_jsonb(r) -> k) is distinct from (to_jsonb(n) -> k) then
      perform private.registrar('usuario', r.id, null, null, null, null, k,
        private.json_texto(to_jsonb(r) -> k), private.json_texto(to_jsonb(n) -> k));
    end if;
  end loop;

  if p_dados ? 'filiais' then
    select array_agg(x::uuid order by x) into v_filiais from jsonb_array_elements_text(p_dados -> 'filiais') x;
    select string_agg(f.nome, ', ' order by f.nome) into v_ant
      from public.perfil_filiais pf join public.filiais f on f.id = pf.filial_id where pf.perfil_id = r.id;
    delete from public.perfil_filiais where perfil_id = r.id;
    insert into public.perfil_filiais (perfil_id, filial_id) select r.id, unnest(coalesce(v_filiais, '{}'));
    perform private.registrar('usuario', r.id, null, null, null, null, 'filiais', v_ant,
      (select string_agg(f.nome, ', ' order by f.nome) from public.filiais f where f.id = any (coalesce(v_filiais, '{}'))));
  end if;

  if p_dados ? 'permissoes' then
    for k, v in select * from jsonb_each(p_dados -> 'permissoes') loop
      select permitido::text into v_ant from public.perfil_permissoes where perfil_id = r.id and chave = k;
      if jsonb_typeof(v) = 'boolean' then
        insert into public.perfil_permissoes (perfil_id, chave, permitido) values (r.id, k, v::text::boolean)
        on conflict (perfil_id, chave) do update set permitido = excluded.permitido;
      else
        delete from public.perfil_permissoes where perfil_id = r.id and chave = k;
      end if;
      if v_ant is distinct from (case when jsonb_typeof(v) = 'boolean' then v::text end) then
        perform private.registrar('usuario', r.id, null, null, null, null, 'permissao:' || k,
          coalesce(v_ant, 'padrão do papel'), coalesce(case when jsonb_typeof(v) = 'boolean' then v::text end, 'padrão do papel'));
      end if;
    end loop;
  end if;

  return to_jsonb(n);
end $$;

create or replace function public.criar_convite(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.convites;
begin
  perform private.exigir('usuarios.gerenciar');
  if coalesce(p_dados ->> 'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = '22023', message = 'Informe um e-mail válido.';
  end if;
  if p_dados ->> 'papel' = 'administrador' and not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores podem convidar administradores.';
  end if;
  if exists (select 1 from public.perfis where lower(email) = lower(p_dados ->> 'email')) then
    raise exception using errcode = '23505', message = 'Já existe um usuário com este e-mail. Ajuste o acesso na lista de usuários.';
  end if;
  delete from public.convites where lower(email) = lower(p_dados ->> 'email') and usado_em is null;
  insert into public.convites (email, nome, papel, comercial_id, filiais, permissoes, criado_por)
  values (lower(trim(p_dados ->> 'email')), p_dados ->> 'nome', (p_dados ->> 'papel')::public.papel_usuario,
          nullif(p_dados ->> 'comercial_id', '')::uuid,
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_dados -> 'filiais') x), '{}'),
          coalesce(p_dados -> 'permissoes', '{}'), auth.uid())
  returning * into n;
  perform private.registrar('usuario', n.id, null, null, null, null, 'convite', null,
    format('%s convidado como %s', n.email, n.papel));
  return to_jsonb(n);
end $$;

create or replace function public.excluir_convite(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('usuarios.gerenciar');
  delete from public.convites where id = p_id and usado_em is null;
end $$;

create or replace function public.salvar_permissao_papel(p_papel public.papel_usuario, p_chave text, p_permitido boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('usuarios.gerenciar');
  if not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores alteram a matriz de permissões.';
  end if;
  if p_papel = 'administrador' then
    raise exception using errcode = '22023', message = 'O papel Administrador tem acesso completo e não é editável.';
  end if;
  if p_permitido then
    insert into public.papel_permissoes (papel, chave) values (p_papel, p_chave) on conflict do nothing;
  else
    delete from public.papel_permissoes where papel = p_papel and chave = p_chave;
  end if;
  perform private.registrar('usuario', null, null, null, null, null, 'matriz:' || p_papel || ':' || p_chave,
    null, case when p_permitido then 'permitido' else 'negado' end);
end $$;

-- ---------------------------------------------------------------------------
-- Configurações e metas
-- ---------------------------------------------------------------------------
create or replace function public.salvar_configuracao(p_chave text, p_valor jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ant jsonb;
begin
  perform private.exigir('configuracoes.gerenciar');
  select valor into v_ant from public.configuracoes where chave = p_chave for update;
  if not found then
    raise exception using errcode = '22023', message = 'Configuração desconhecida.';
  end if;
  if p_chave in ('capacidade_padrao_t', 'meta_veiculos_lote_padrao', 'link_validade_padrao_horas')
     and (jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric <= 0) then
    raise exception using errcode = '22023', message = 'Informe um número maior que zero.';
  end if;
  if p_chave = 'cadencia_unidade_padrao' and not (p_valor #>> '{}') in ('veiculos_dia', 'toneladas_dia') then
    raise exception using errcode = '22023', message = 'Unidade de cadência inválida.';
  end if;
  if p_chave = 'ticket_inclui_frete_zero' and jsonb_typeof(p_valor) <> 'boolean' then
    raise exception using errcode = '22023', message = 'Informe verdadeiro ou falso.';
  end if;
  update public.configuracoes set valor = p_valor, atualizado_por = auth.uid(), atualizado_em = now() where chave = p_chave;
  perform private.registrar('configuracao', null, null, null, null, null, p_chave, v_ant::text, p_valor::text);
end $$;

create or replace function public.salvar_meta_diaria(
  p_data date, p_is_demo boolean, p_meta_faturamento numeric, p_meta_margem numeric, p_meta_volume_t numeric,
  p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ant public.metas_diarias;
begin
  perform private.exigir('financeiro.editar');
  select * into v_ant from public.metas_diarias where data_operacional = p_data and is_demo = coalesce(p_is_demo, false);
  insert into public.metas_diarias (data_operacional, is_demo, meta_faturamento, meta_margem, meta_volume_t, observacao, atualizado_por)
  values (p_data, coalesce(p_is_demo, false), p_meta_faturamento, p_meta_margem, p_meta_volume_t, p_observacao, auth.uid())
  on conflict (data_operacional, is_demo) do update set
    meta_faturamento = excluded.meta_faturamento, meta_margem = excluded.meta_margem,
    meta_volume_t = excluded.meta_volume_t, observacao = excluded.observacao,
    atualizado_por = excluded.atualizado_por, atualizado_em = now();
  perform private.registrar('configuracao', null, null, null, null, p_data, 'metas_diarias',
    case when v_ant.data_operacional is not null then
      format('faturamento %s; margem %s; volume %s', v_ant.meta_faturamento, v_ant.meta_margem, v_ant.meta_volume_t) end,
    format('faturamento %s; margem %s; volume %s', p_meta_faturamento, p_meta_margem, p_meta_volume_t), true);
end $$;

-- ---------------------------------------------------------------------------
-- Compartilhamento externo
-- ---------------------------------------------------------------------------
create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
as $$ select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public.criar_link_cliente(
  p_cliente_id uuid, p_validade_horas integer default null, p_mostrar_carregados boolean default false,
  p_mostrar_volumes boolean default false, p_descricao text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_horas integer;
  n public.links_cliente;
  c public.clientes;
begin
  perform private.exigir('compartilhamento.links');
  select * into c from public.clientes where id = p_cliente_id;
  if not found or not private.pode_ver_cliente(c.id) then
    raise exception using errcode = 'P0002', message = 'Cliente não encontrado ou fora do seu escopo.';
  end if;
  v_horas := coalesce(p_validade_horas,
    (select (valor #>> '{}')::integer from public.configuracoes where chave = 'link_validade_padrao_horas'), 72);
  if v_horas < 1 or v_horas > 720 then
    raise exception using errcode = '22023', message = 'A validade deve estar entre 1 hora e 30 dias.';
  end if;
  -- 32 bytes aleatórios (256 bits), em base64 adequado para URL. Guardamos só o hash.
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into public.links_cliente
    (cliente_id, token_hash, token_prefixo, descricao, mostrar_carregados, mostrar_volumes, expira_em, is_demo, criado_por)
  values
    (c.id, private.hash_token(v_token), left(v_token, 6), p_descricao, coalesce(p_mostrar_carregados, false),
     coalesce(p_mostrar_volumes, false), now() + make_interval(hours => v_horas), c.is_demo, auth.uid())
  returning * into n;
  perform private.registrar('compartilhamento', n.id, null, null, c.id, null, 'link_criado', null,
    format('Link %s… válido até %s', n.token_prefixo, to_char(n.expira_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
  return jsonb_build_object('id', n.id, 'token', v_token, 'expira_em', n.expira_em);
end $$;

create or replace function public.revogar_link_cliente(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.links_cliente;
begin
  perform private.exigir('compartilhamento.links');
  select * into n from public.links_cliente where id = p_link_id for update;
  if not found or not private.pode_ver_cliente(n.cliente_id) then
    raise exception using errcode = 'P0002', message = 'Link não encontrado.';
  end if;
  if n.revogado_em is null then
    update public.links_cliente set revogado_em = now(), revogado_por = auth.uid() where id = n.id;
    perform private.registrar('compartilhamento', n.id, null, null, n.cliente_id, null, 'link_revogado', n.token_prefixo || '…', 'revogado');
  end if;
end $$;

-- Consulta pública (sem login) por token. Retorna somente informações destinadas ao cliente:
-- nada financeiro, nenhuma observação interna, nenhum nome de usuário, nenhum outro cliente.
create or replace function public.posicao_publica(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l public.links_cliente;
  c public.clientes;
  v_data date;
  v_itens jsonb;
  v_atualizado timestamptz;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    return jsonb_build_object('status', 'invalido');
  end if;
  select * into l from public.links_cliente where token_hash = private.hash_token(p_token);
  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;
  if l.revogado_em is not null then
    return jsonb_build_object('status', 'revogado');
  end if;
  if l.expira_em <= now() then
    return jsonb_build_object('status', 'expirado');
  end if;
  update public.links_cliente set acessos = acessos + 1, ultimo_acesso_em = now() where id = l.id;
  select * into c from public.clientes where id = l.cliente_id;

  -- Data mais recente com posição deste cliente, até hoje (America/Sao_Paulo)
  select max(p.data_operacional) into v_data
  from public.posicoes_diarias p join public.embarques e on e.id = p.embarque_id
  where e.cliente_id = c.id and e.situacao = 'ativo' and p.data_operacional <= private.hoje_sp();

  -- Agrupa apenas registros compatíveis: mesma origem, coleta, destino, entrega e produto.
  select coalesce(jsonb_agg(item order by item ->> 'origem', item ->> 'destino', item ->> 'produto'), '[]'), max(atualizado)
  into v_itens, v_atualizado
  from (
    select jsonb_strip_nulls(jsonb_build_object(
             'origem', e.origem_cidade || coalesce('/' || e.origem_uf, ''),
             'coleta', lc.nome,
             'destino', e.destino_cidade || coalesce('/' || e.destino_uf, ''),
             'entrega', le.nome,
             'produto', pr.nome,
             'porta', sum(p.porta),
             'transito', sum(p.transito),
             'carregados', case when l.mostrar_carregados then sum(p.carregados) end,
             'volume_porta_t', case when l.mostrar_volumes then sum(p.porta * p.toneladas_por_veiculo) end,
             'volume_transito_t', case when l.mostrar_volumes then sum(p.transito * p.toneladas_por_veiculo) end,
             'volume_carregado_t', case when l.mostrar_volumes and l.mostrar_carregados then sum(p.carregados * p.toneladas_por_veiculo) end,
             'observacao', nullif(string_agg(distinct nullif(trim(p.obs_cliente), ''), ' | '), ''),
             'embarques', count(*))) as item,
           max(p.atualizado_em) as atualizado
    from public.posicoes_diarias p
    join public.embarques e on e.id = p.embarque_id
    left join public.locais lc on lc.id = e.local_coleta_id
    left join public.locais le on le.id = e.local_entrega_id
    left join public.produtos pr on pr.id = e.produto_id
    where e.cliente_id = c.id and e.situacao = 'ativo' and p.data_operacional = v_data
    group by e.origem_cidade, e.origem_uf, lc.nome, e.destino_cidade, e.destino_uf, le.nome, pr.nome
  ) g;

  return jsonb_build_object(
    'status', 'ok',
    'cliente', c.nome,
    'demonstrativo', c.is_demo,
    'data_operacional', v_data,
    'atualizado_em', v_atualizado,
    'consultado_em', now(),
    'link_expira_em', l.expira_em,
    'mostrar_carregados', l.mostrar_carregados,
    'mostrar_volumes', l.mostrar_volumes,
    'itens', v_itens);
end $$;

-- ---------------------------------------------------------------------------
-- Dados demonstrativos (marcados com is_demo = true e prefixo [DEMO])
-- ---------------------------------------------------------------------------
create or replace function public.limpar_dados_demo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emb integer;
begin
  perform private.exigir('configuracoes.gerenciar');
  if not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores removem dados demonstrativos.';
  end if;
  delete from public.historico_alteracoes h using public.embarques e where h.embarque_id = e.id and e.is_demo;
  delete from public.links_cliente where is_demo;
  delete from public.importacoes where is_demo;
  delete from public.metas_diarias where is_demo;
  with d as (delete from public.embarques where is_demo returning 1) select count(*) into v_emb from d;
  delete from public.clientes where is_demo;
  delete from public.locais where is_demo;
  delete from public.produtos where is_demo;
  delete from public.filiais where is_demo;
  delete from public.comerciais where is_demo;
  return jsonb_build_object('embarques_removidos', v_emb);
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios das funções
-- ---------------------------------------------------------------------------
-- Só as funções deste app: o projeto pode conter funções de outros sistemas.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'abrir_posicoes', 'admin_atualizar_usuario', 'atualizar_embarque', 'atualizar_financeiro', 'atualizar_posicao',
      'criar_convite', 'criar_embarque', 'criar_link_cliente', 'excluir_convite', 'limpar_dados_demo', 'posicao_publica',
      'revogar_link_cliente', 'salvar_cadastro', 'salvar_configuracao', 'salvar_meta_diaria', 'salvar_permissao_papel')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.posicao_publica(text) to anon;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function private.promover_administrador(text) from authenticated;
-- O serviço de login do Supabase dispara o gatilho de novos usuários.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.ao_criar_usuario() to supabase_auth_admin;
  end if;
end $$;
