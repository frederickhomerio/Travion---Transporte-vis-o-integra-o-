-- Cadastro de motorista/veículo com cliente do Industrializado (10/11/2026, pedido do Frederick).
-- As funções do Industrializado escolhem o cliente na lista do módulo (ind_clientes); as demais seguem com os clientes do Travion.
-- Só acrescenta: coluna nova, regra do cadastro aceita um dos dois clientes, função de envio aceita ind_cliente_id. Reexecutável.

alter table public.solicitacoes_doc add column if not exists ind_cliente_id text references public.ind_clientes (id);

alter table public.solicitacoes_doc drop constraint if exists solicitacoes_doc_campos_cadastro;
alter table public.solicitacoes_doc add constraint solicitacoes_doc_campos_cadastro check (
  tipo <> 'cadastro' or (
    embarque_id is null and (cliente_id is not null or ind_cliente_id is not null)
    and length(trim(coalesce(telefone_motorista, ''))) between 1 and 40
    and length(trim(coalesce(mercadoria, ''))) between 1 and 200
    and valor_carga > 0
    and length(trim(coalesce(origem_cidade, ''))) between 1 and 120 and origem_uf ~ '^[A-Z]{2}$'
    and length(trim(coalesce(destino_cidade, ''))) between 1 and 120 and destino_uf ~ '^[A-Z]{2}$'
    and primeiro_embarque is not null));

create or replace function public.criar_solicitacao_cadastro(p_dados jsonb, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  aberta public.solicitacoes_doc;
  c public.clientes;
  ci public.ind_clientes;
  v_ind text := nullif(p_dados ->> 'ind_cliente_id', '');
  v_cliente_nome text;
  v_placa text := upper(regexp_replace(coalesce(p_dados ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_tel text := left(trim(coalesce(p_dados ->> 'telefone_motorista', '')), 40);
  v_dig text := regexp_replace(coalesce(p_dados ->> 'telefone_motorista', ''), '\D', '', 'g');
  v_chave uuid := (p_dados ->> 'chave_envio')::uuid;
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_valor numeric;
  v_ouf text := upper(trim(coalesce(p_dados ->> 'origem_uf', '')));
  v_duf text := upper(trim(coalesce(p_dados ->> 'destino_uf', '')));
  v_retrato jsonb;
  v_mot integer;
  v_vei integer;
begin
  perform private.exigir('cadastro.solicitar');
  if v_chave is null then perform private.doc_erro('22023', 'Envio sem identificador: recarregue a página.'); end if;
  select * into s from public.solicitacoes_doc where solicitante_id = auth.uid() and chave_envio = v_chave;
  if found then return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'repetido', true); end if;

  if v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    perform private.doc_erro('22023', 'Placa do cavalo inválida: use o formato ABC1D23 ou ABC1234.');
  end if;
  -- Telefone guardado como texto; confere só DDD + número (10 ou 11 dígitos, com ou sem +55 e zero de operadora).
  if v_dig ~ '^55\d{10,11}$' then v_dig := substr(v_dig, 3); end if;
  if v_dig ~ '^0\d{10,11}$' then v_dig := substr(v_dig, 2); end if;
  if v_dig !~ '^[1-9][1-9]\d{8,9}$' then
    perform private.doc_erro('22023', 'Telefone do motorista inválido: informe DDD + número.');
  end if;
  begin
    v_valor := (p_dados ->> 'valor_carga')::numeric;
  exception when others then v_valor := null;
  end;
  if v_valor is null or v_valor <= 0 then perform private.doc_erro('22023', 'Informe o valor da carga (maior que zero).'); end if;
  if length(trim(coalesce(p_dados ->> 'mercadoria', ''))) = 0 then perform private.doc_erro('22023', 'Informe a mercadoria.'); end if;
  if length(trim(coalesce(p_dados ->> 'origem_cidade', ''))) = 0 or v_ouf !~ '^[A-Z]{2}$' then
    perform private.doc_erro('22023', 'Informe a origem (cidade e UF).');
  end if;
  if length(trim(coalesce(p_dados ->> 'destino_cidade', ''))) = 0 or v_duf !~ '^[A-Z]{2}$' then
    perform private.doc_erro('22023', 'Informe o destino (cidade e UF).');
  end if;
  if (p_dados ->> 'primeiro_embarque') is null then
    perform private.doc_erro('22023', 'Responda se é o primeiro embarque do motorista.');
  end if;

  -- Cliente: do Industrializado (quem acessa o módulo) ou do Travion (no escopo da pessoa).
  if v_ind is not null then
    select * into ci from public.ind_clientes where id = v_ind;
    if not found or not private.tem_permissao('ind.pagina') or coalesce((ci.dados ->> 'ativo')::boolean, true) = false then
      perform private.doc_erro('22023', 'Selecione um cliente do Industrializado ativo.');
    end if;
    v_cliente_nome := ci.dados ->> 'nome';
  else
    select * into c from public.clientes where id = nullif(p_dados ->> 'cliente_id', '')::uuid;
    if not found or not private.pode_ver_cliente(c.id) then perform private.doc_erro('22023', 'Selecione um cliente autorizado.'); end if;
    v_cliente_nome := c.nome;
  end if;
  -- Filial: só uma das suas. Quem tem filiais no perfil precisa escolher; administrador e carteira podem deixar sem.
  if v_filial is not null and not private.no_escopo(v_filial, null) then
    perform private.doc_erro('42501', 'Filial fora do seu escopo.');
  end if;
  if v_filial is null and not private.eh_admin() and exists (select 1 from public.perfil_filiais where perfil_id = auth.uid()) then
    perform private.doc_erro('22023', 'Selecione a filial.');
  end if;

  -- Cadastro em aberto para a mesma placa: orienta a acompanhar o existente (concluídos e cancelados não bloqueiam).
  perform pg_advisory_xact_lock(hashtext('cadastro:' || v_placa));
  select * into aberta from public.solicitacoes_doc
   where tipo = 'cadastro' and placa = v_placa and status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida')
   order by numero limit 1;
  if found then
    return jsonb_build_object('status', 'cadastro_aberto', 'numero', aberta.numero, 'situacao', aberta.status,
      'registro', case when private.pode_ver_solicitacao_reg(aberta) then to_jsonb(aberta) end);
  end if;

  select jsonb_build_object(
    'codigo', null, 'cliente', v_cliente_nome, 'cliente_id', c.id, 'ind_cliente_id', v_ind, 'carteira', cm.nome, 'filial', f.nome, 'filial_id', f.id,
    'centro_custo', cc.nome, 'centro_custo_id', f.centro_custo_id,
    'origem_cidade', trim(p_dados ->> 'origem_cidade'), 'origem_uf', v_ouf,
    'destino_cidade', trim(p_dados ->> 'destino_cidade'), 'destino_uf', v_duf,
    'produto', trim(p_dados ->> 'mercadoria'), 'lote_numero', null)
  into v_retrato
  from (select 1) x
  left join public.comerciais cm on cm.id = c.comercial_id
  left join public.filiais f on f.id = v_filial
  left join public.centros_custo cc on cc.id = f.centro_custo_id;

  insert into public.solicitacoes_doc (
    tipo, placa, observacoes, retrato, chave_envio, solicitante_id, solicitante_nome,
    filial_id, comercial_id, cliente_id, ind_cliente_id, telefone_motorista, mercadoria, valor_carga,
    origem_cidade, origem_uf, destino_cidade, destino_uf, primeiro_embarque)
  values (
    'cadastro', v_placa, nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''), v_retrato, v_chave,
    auth.uid(), coalesce(private.nome_usuario(), 'Usuário'),
    v_filial, c.comercial_id, c.id, case when v_ind is not null then ci.id end, v_tel, left(trim(p_dados ->> 'mercadoria'), 200), round(v_valor, 2),
    left(trim(p_dados ->> 'origem_cidade'), 120), v_ouf, left(trim(p_dados ->> 'destino_cidade'), 120), v_duf,
    (p_dados ->> 'primeiro_embarque')::boolean)
  returning * into s;

  perform private.doc_vincular_anexos(s.id, p_anexos, array['motorista', 'veiculo'], null);
  select count(*) filter (where categoria = 'motorista'), count(*) filter (where categoria = 'veiculo')
    into v_mot, v_vei from public.doc_anexos where solicitacao_id = s.id;
  if v_mot = 0 then perform private.doc_erro('22023', 'Anexe ao menos um documento do motorista.'); end if;
  if v_vei = 0 then perform private.doc_erro('22023', 'Anexe ao menos um documento dos veículos.'); end if;
  if v_mot > 4 then perform private.doc_erro('22023', 'Documentos do motorista: no máximo 4 arquivos.'); end if;
  if v_vei > 10 then perform private.doc_erro('22023', 'Documentos dos veículos: no máximo 10 arquivos.'); end if;
  perform private.doc_evento(s.id, 'evento', 'Cadastro enviado ao apoio');
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;
