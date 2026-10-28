-- Forma de pagamento PIX na solicitação de documentação (Emissão / Lote e Emissão).
-- Com PIX, a solicitação guarda de quem é a chave (proprietário ou motorista) e a chave informada.
-- Só acrescenta colunas e redefine a função de envio; não apaga dados.

do $$ declare r record; begin
  for r in select conname from pg_constraint
            where conrelid = 'public.solicitacoes_doc'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%forma_pagamento%' and pg_get_constraintdef(oid) like '%pagbem%' loop
    execute format('alter table public.solicitacoes_doc drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.solicitacoes_doc
  add column if not exists pix_titular text,
  add column if not exists pix_chave text;
alter table public.solicitacoes_doc
  add constraint solicitacoes_doc_forma_pagamento_check check (forma_pagamento in ('cheque', 'pagbem', 'pix')),
  add constraint solicitacoes_doc_pix_check check (
    (forma_pagamento is distinct from 'pix' and pix_titular is null and pix_chave is null)
    or (forma_pagamento = 'pix' and pix_titular in ('proprietario', 'motorista') and length(trim(pix_chave)) between 1 and 140));

create or replace function public.criar_solicitacao_doc(p_embarque_id uuid, p_dados jsonb, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.embarques;
  l public.lotes_erp;
  aberta public.solicitacoes_doc;
  ini public.solicitacoes_doc;
  s public.solicitacoes_doc;
  v_tipo text;
  v_placa text := upper(regexp_replace(coalesce(p_dados ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_reboques text[];
  v_exige boolean := (p_dados ->> 'exige_obs_cte')::boolean;
  v_chave uuid := (p_dados ->> 'chave_envio')::uuid;
  v_retrato jsonb;
  v_tipo_op text := p_dados ->> 'tipo_operacao';
begin
  perform private.exigir('documentacao.solicitar');
  if v_chave is null then perform private.doc_erro('22023', 'Envio sem identificador: recarregue a página.'); end if;
  -- Reenvio do mesmo formulário (clique duplo, rede instável): devolve a solicitação já gravada.
  select * into s from public.solicitacoes_doc where solicitante_id = auth.uid() and chave_envio = v_chave;
  if found then return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'repetido', true); end if;

  select * into e from public.embarques where id = p_embarque_id;
  if not found or not private.pode_ver_documentacao(e.id) then
    perform private.doc_erro('P0002', 'Embarque não encontrado ou fora do seu escopo.');
  end if;
  if e.situacao <> 'ativo' or e.encerrado_em is not null then
    perform private.doc_erro('55000', 'Embarque arquivado ou encerrado: não aceita novas solicitações.');
  end if;

  -- Trava o embarque: duas solicitações iniciais simultâneas não passam (o índice único também garante).
  perform 1 from public.embarques where id = e.id for update;
  select * into l from public.lotes_erp where embarque_id = e.id;
  if found then
    v_tipo := 'emissao';
    select * into ini from public.solicitacoes_doc where id = l.solicitacao_id;
    v_tipo_op := coalesce(ini.tipo_operacao, v_tipo_op);
  else
    select * into aberta from public.solicitacoes_doc
     where embarque_id = e.id and tipo = 'lote_emissao' and status <> 'cancelado';
    if found then
      return jsonb_build_object('status', 'inicial_aberta', 'registro', to_jsonb(aberta));
    end if;
    v_tipo := 'lote_emissao';
    if v_tipo_op is null then perform private.doc_erro('22023', 'Informe o tipo de operação.'); end if;
  end if;

  if v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    perform private.doc_erro('22023', 'Placa inválida: use o formato ABC1D23 ou ABC1234.');
  end if;
  select coalesce(array_agg(x), '{}') into v_reboques from (
    select upper(regexp_replace(value, '[^A-Za-z0-9]', '', 'g')) x from jsonb_array_elements_text(coalesce(p_dados -> 'placas_reboque', '[]'))
  ) r where x <> '';
  if exists (select 1 from unnest(v_reboques) x where x !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$') then
    perform private.doc_erro('22023', 'Placa de carreta inválida: use o formato ABC1D23 ou ABC1234.');
  end if;
  if v_exige is null or (p_dados ->> 'cte_por_nf') is null then
    perform private.doc_erro('22023', 'Responda se o cliente exige observação no CT-e e se é um CT-e por NF.');
  end if;
  if v_exige and length(trim(coalesce(p_dados ->> 'obs_cte', ''))) = 0 then
    perform private.doc_erro('22023', 'Informe qual observação o cliente exige no CT-e.');
  end if;
  -- PIX: de quem é a chave (proprietário ou motorista) e a chave em si.
  if p_dados ->> 'forma_pagamento' = 'pix' then
    if coalesce(p_dados ->> 'pix_titular', '') not in ('proprietario', 'motorista') then
      perform private.doc_erro('22023', 'No PIX, informe se a chave é do proprietário ou do motorista.');
    end if;
    if length(trim(coalesce(p_dados ->> 'pix_chave', ''))) = 0 or length(trim(p_dados ->> 'pix_chave')) > 140 then
      perform private.doc_erro('22023', 'Informe a chave PIX (até 140 caracteres).');
    end if;
  end if;

  -- Retrato dos dados do embarque no momento do envio (o histórico não muda se o cadastro mudar).
  select jsonb_build_object(
    'codigo', e.codigo, 'cliente', c.nome, 'carteira', cm.nome, 'filial', f.nome, 'centro_custo', cc.nome,
    'origem_cidade', e.origem_cidade, 'origem_uf', e.origem_uf, 'coleta', lc.nome,
    'destino_cidade', e.destino_cidade, 'destino_uf', e.destino_uf, 'entrega', le.nome, 'produto', pr.nome,
    'lote_numero', l.numero, 'filial_id', e.filial_id, 'centro_custo_id', f.centro_custo_id, 'cliente_id', e.cliente_id)
  into v_retrato
  from public.clientes c
  left join public.comerciais cm on cm.id = e.comercial_id
  left join public.filiais f on f.id = e.filial_id
  left join public.centros_custo cc on cc.id = f.centro_custo_id
  left join public.locais lc on lc.id = e.local_coleta_id
  left join public.locais le on le.id = e.local_entrega_id
  left join public.produtos pr on pr.id = e.produto_id
  where c.id = e.cliente_id;

  begin
    insert into public.solicitacoes_doc (
      embarque_id, lote_id, tipo, placa, placas_reboque, frete_empresa, frete_empresa_unidade, frete_motorista, frete_motorista_unidade,
      tipo_operacao, forma_pagamento, pix_titular, pix_chave, pedagio, exige_obs_cte, obs_cte, cte_por_nf, observacoes, retrato, chave_envio,
      solicitante_id, solicitante_nome)
    values (
      e.id, l.id, v_tipo, v_placa, v_reboques, (p_dados ->> 'frete_empresa')::numeric, p_dados ->> 'frete_empresa_unidade',
      (p_dados ->> 'frete_motorista')::numeric, p_dados ->> 'frete_motorista_unidade',
      v_tipo_op, p_dados ->> 'forma_pagamento',
      case when p_dados ->> 'forma_pagamento' = 'pix' then p_dados ->> 'pix_titular' end,
      case when p_dados ->> 'forma_pagamento' = 'pix' then trim(p_dados ->> 'pix_chave') end,
      p_dados ->> 'pedagio', v_exige,
      case when v_exige then left(trim(p_dados ->> 'obs_cte'), 1000) end, (p_dados ->> 'cte_por_nf')::boolean,
      nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''), v_retrato, v_chave,
      auth.uid(), coalesce(private.nome_usuario(), 'Usuário'))
    returning * into s;
  exception
    when unique_violation then
      select * into aberta from public.solicitacoes_doc
       where embarque_id = e.id and tipo = 'lote_emissao' and status <> 'cancelado';
      return jsonb_build_object('status', 'inicial_aberta', 'registro', to_jsonb(aberta));
    when check_violation or invalid_text_representation or not_null_violation then
      perform private.doc_erro('22023', 'Confira fretes (valores maiores que zero, unidade R$/t ou R$/viagem), pagamento e pedágio.');
  end;

  perform private.doc_vincular_anexos(s.id, p_anexos,
    case when v_tipo = 'lote_emissao' then array['nf', 'evidencia_frete'] else array['nf'] end, null);
  if not exists (select 1 from public.doc_anexos where solicitacao_id = s.id and categoria = 'nf') then
    perform private.doc_erro('22023', 'Anexe ao menos uma NF.');
  end if;
  if v_tipo = 'lote_emissao' and not exists (select 1 from public.doc_anexos where solicitacao_id = s.id and categoria = 'evidencia_frete') then
    perform private.doc_erro('22023', 'Anexe a evidência do frete.');
  end if;
  perform private.doc_evento(s.id, 'evento',
    case when v_tipo = 'lote_emissao' then 'Solicitação de lote e emissão enviada ao apoio' else 'Solicitação de emissão enviada ao apoio (lote ' || l.numero || ')' end);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;
