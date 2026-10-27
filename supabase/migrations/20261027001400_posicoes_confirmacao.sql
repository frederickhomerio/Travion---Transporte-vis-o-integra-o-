-- Posições de Embarque (supervisores) e Posição do Cliente (mesa comercial), pedidas em 27/10/2026.
--
-- 1. Confirmação da posição: o supervisor salva os três contadores de uma vez ou confirma que os números
--    continuam iguais. A confirmação fica separada de "atualizado_em", porque a abertura do dia, a importação
--    e a edição de observações também mudam o registro e não são uma conferência operacional.
-- 2. Logo da empresa (TP) nas configurações, para o quadro enviado ao cliente.
-- 3. Horário do servidor, para a janela móvel de duas horas do relatório por filial.
--
-- Só acrescenta colunas e funções. Nenhum dado existente é alterado ou apagado.

alter table public.posicoes_diarias
  add column if not exists confirmado_em timestamptz,
  add column if not exists confirmado_por uuid references public.perfis (id),
  add column if not exists confirmado_por_nome text;

create index if not exists posicoes_confirmacao on public.posicoes_diarias (data_operacional, confirmado_em);

-- ---------------------------------------------------------------------------
-- Salvar ou confirmar a posição do dia (página Posições de Embarque)
-- ---------------------------------------------------------------------------
-- p_valores e p_base trazem sempre porta, trânsito e carregados.
-- p_base é o que o supervisor viu ao começar a editar. Se qualquer um dos três mudou desde então,
-- nada é gravado e a resposta traz os valores atuais para revisão (sem "última gravação vence").
create or replace function public.confirmar_posicao(p_posicao_id uuid, p_valores jsonb, p_base jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.posicoes_diarias;
  e public.embarques;
  n public.posicoes_diarias;
  k text;
  v jsonb;
  v_novo jsonb := '{}';
  v_conflitos jsonb := '[]';
  v_campos text[] := array['porta', 'transito', 'carregados'];
begin
  perform private.exigir('posicoes.editar_contadores');
  select * into r from public.posicoes_diarias where id = p_posicao_id for update;
  if not found or not private.pode_ver_embarque(r.embarque_id) then
    raise exception using errcode = 'P0002', message = 'Posição não encontrada ou fora do seu escopo.';
  end if;
  select * into e from public.embarques where id = r.embarque_id;
  if e.situacao = 'arquivado' then
    raise exception using errcode = '55000', message = 'Embarque arquivado: reative o cadastro para atualizar a posição.';
  end if;
  if r.data_operacional <> private.hoje_sp() then
    raise exception using errcode = '22023', message = 'Só é possível confirmar a posição da data operacional de hoje.';
  end if;
  if p_valores is null or jsonb_typeof(p_valores) <> 'object' or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception using errcode = '22023', message = 'Informe na porta, em trânsito e carregados hoje.';
  end if;

  foreach k in array v_campos loop
    v := p_valores -> k;
    -- Campo vazio não vira zero: os três números são obrigatórios para confirmar.
    if v is null or jsonb_typeof(v) = 'null' then
      raise exception using errcode = '22023', message = format('Informe o número de %s (zero é válido).',
        '{"porta": "na porta", "transito": "em trânsito", "carregados": "carregados hoje"}'::jsonb ->> k);
    end if;
    v := private.validar_valor(k, 'contador', v);
    if not (p_base ? k) then
      raise exception using errcode = '22023', message = format('Valor de referência ausente para %s.', private.rotulo_campo(k));
    end if;
    if (p_base -> k) is distinct from (to_jsonb(r) -> k)
       and not (jsonb_typeof(p_base -> k) = 'number' and jsonb_typeof(to_jsonb(r) -> k) = 'number'
                and (p_base ->> k)::numeric = (to_jsonb(r) ->> k)::numeric) then
      v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
        'campo', k, 'rotulo', private.rotulo_campo(k),
        'valor_base', p_base -> k, 'valor_atual', to_jsonb(r) -> k, 'valor_proposto', v));
    end if;
    if (to_jsonb(r) -> k) is distinct from v then
      v_novo := v_novo || jsonb_build_object(k, v);
    end if;
  end loop;

  if jsonb_array_length(v_conflitos) > 0 then
    return jsonb_build_object('status', 'conflito', 'conflitos', v_conflitos, 'registro', to_jsonb(r));
  end if;

  n := jsonb_populate_record(r, v_novo);
  update public.posicoes_diarias set
    porta = n.porta, transito = n.transito, carregados = n.carregados,
    versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid(),
    atualizado_por_nome = private.nome_usuario(),
    confirmado_em = now(), confirmado_por = auth.uid(), confirmado_por_nome = private.nome_usuario()
  where id = r.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('posicao', r.id, r.embarque_id, r.id, e.cliente_id, r.data_operacional, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v));
  end loop;
  perform private.registrar('posicao', r.id, r.embarque_id, r.id, e.cliente_id, r.data_operacional, 'confirmacao',
    null, format('%s: na porta %s, em trânsito %s, carregados hoje %s',
                 case when v_novo = '{}'::jsonb then 'Confirmada sem alteração' else 'Posição salva' end,
                 n.porta, n.transito, n.carregados));

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;

-- A edição dos contadores pela Lista de Fretes também é uma atualização explícita: conta como confirmação.
-- Igual à versão de 20261026000300, mais as três colunas de confirmação quando um contador muda.
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
  v_contador boolean;
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
  v_contador := v_novo ?| array['porta', 'transito', 'carregados'];

  n := jsonb_populate_record(r, v_novo);
  update public.posicoes_diarias set
    porta = n.porta, transito = n.transito, carregados = n.carregados,
    obs_operacional = n.obs_operacional, obs_cliente = n.obs_cliente,
    versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid(),
    atualizado_por_nome = private.nome_usuario(),
    confirmado_em = case when v_contador then now() else r.confirmado_em end,
    confirmado_por = case when v_contador then auth.uid() else r.confirmado_por end,
    confirmado_por_nome = case when v_contador then private.nome_usuario() else r.confirmado_por_nome end
  where id = r.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('posicao', r.id, r.embarque_id, r.id, e.cliente_id, r.data_operacional, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v));
  end loop;

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;

-- Horário do servidor (referência da janela de duas horas na Posição do Cliente).
create or replace function public.agora_servidor()
returns timestamptz
language sql
stable
as $$ select now() $$;

-- ---------------------------------------------------------------------------
-- Logo da empresa (TP) no quadro do cliente
-- ---------------------------------------------------------------------------
insert into public.configuracoes (chave, valor, descricao) values
  ('logo_empresa', 'null', 'Logo da Transpanorama (TP) no quadro de posição enviado ao cliente (imagem enviada em Configurações)')
on conflict (chave) do nothing;

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
  -- Imagem própria (data:image/...), para não depender de site externo nem contaminar a captura do quadro.
  if p_chave = 'logo_empresa' and jsonb_typeof(p_valor) <> 'null'
     and (jsonb_typeof(p_valor) <> 'string' or (p_valor #>> '{}') !~ '^data:image/(png|jpeg|webp);base64,'
          or length(p_valor #>> '{}') > 300000) then
    raise exception using errcode = '22023', message = 'Envie a logo como imagem PNG, JPEG ou WebP de até 200 KB.';
  end if;
  update public.configuracoes set valor = p_valor, atualizado_por = auth.uid(), atualizado_em = now() where chave = p_chave;
  -- A imagem não vai inteira para o histórico.
  perform private.registrar('configuracao', null, null, null, null, null, p_chave,
    case when p_chave = 'logo_empresa' then case when v_ant = 'null'::jsonb then null else 'imagem anterior' end else v_ant::text end,
    case when p_chave = 'logo_empresa' then case when p_valor = 'null'::jsonb then null else 'imagem nova' end else p_valor::text end);
end $$;

revoke all on function public.confirmar_posicao(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirmar_posicao(uuid, jsonb, jsonb) to authenticated;
revoke all on function public.agora_servidor() from public, anon;
grant execute on function public.agora_servidor() to authenticated;
