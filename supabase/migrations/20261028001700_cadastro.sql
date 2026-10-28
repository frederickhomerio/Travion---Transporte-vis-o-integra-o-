-- Aba Cadastro (pedido de 28/10/2026): o comercial pede o cadastro de motorista/veículo e o apoio faz o cadastro à mão no ERP.
-- Reaproveita a fila do Apoio Operacional: a mesma tabela solicitacoes_doc ganha o tipo 'cadastro', sem embarque,
-- com os campos próprios do formulário. Não há integração com o ERP: "Cadastro concluído" é a confirmação do responsável.
-- Só acrescenta colunas, valores permitidos e funções; não apaga dados.

-- ---------------------------------------------------------------------------
-- Permissões (ajustáveis em Administração → Permissões)
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('cadastro.solicitar', 'Cadastro', 'Abrir a aba Cadastro, enviar cadastros de motorista/veículo ao apoio e responder pendências'),
  ('cadastro.ver',       'Cadastro', 'Acompanhar os cadastros das suas filiais e da sua carteira, além dos próprios')
on conflict do nothing;

insert into public.papel_permissoes (papel, chave) values
  ('gestor', 'cadastro.solicitar'), ('gestor', 'cadastro.ver'),
  ('supervisor', 'cadastro.solicitar'), ('supervisor', 'cadastro.ver'),
  ('embarcador', 'cadastro.solicitar'), ('embarcador', 'cadastro.ver'),
  ('comercial', 'cadastro.solicitar'), ('comercial', 'cadastro.ver'),
  ('apoio', 'cadastro.ver')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Solicitação: tipo Cadastro, sem embarque, com os campos do formulário
-- ---------------------------------------------------------------------------
alter table public.solicitacoes_doc
  alter column embarque_id drop not null,
  alter column frete_empresa drop not null,
  alter column frete_empresa_unidade drop not null,
  alter column frete_motorista drop not null,
  alter column frete_motorista_unidade drop not null,
  alter column forma_pagamento drop not null,
  alter column pedagio drop not null,
  alter column exige_obs_cte drop not null,
  alter column cte_por_nf drop not null,
  add column filial_id uuid references public.filiais (id),
  add column comercial_id uuid references public.comerciais (id),
  add column cliente_id uuid references public.clientes (id),
  add column telefone_motorista text,
  add column mercadoria text,
  add column valor_carga numeric(14, 2),
  add column origem_cidade text,
  add column origem_uf text,
  add column destino_cidade text,
  add column destino_uf text,
  add column primeiro_embarque boolean,
  add column erp_referencia text,
  add column retorno_solicitante text;

-- A regra "tipo de operação obrigatório fora da emissão" passa a valer só para Lote e Emissão.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.solicitacoes_doc'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%tipo_operacao IS NOT NULL%' loop
    execute format('alter table public.solicitacoes_doc drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.solicitacoes_doc
  drop constraint if exists solicitacoes_doc_tipo_check,
  drop constraint if exists solicitacoes_doc_status_check,
  add constraint solicitacoes_doc_tipo_check check (tipo in ('lote_emissao', 'emissao', 'cadastro')),
  add constraint solicitacoes_doc_status_check check (status in (
    'enviado', 'em_atendimento', 'aguardando_informacao', 'documentacao_disponivel', 'cadastro_concluido', 'cancelado')),
  -- Conclusão própria de cada tipo: Cadastro nunca vira "Documentação disponível" e vice-versa.
  add constraint solicitacoes_doc_conclusao_por_tipo check (
    (tipo = 'cadastro' and status <> 'documentacao_disponivel') or (tipo <> 'cadastro' and status <> 'cadastro_concluido')),
  add constraint solicitacoes_doc_lote_operacao check (tipo <> 'lote_emissao' or tipo_operacao is not null),
  add constraint solicitacoes_doc_campos_documentacao check (
    tipo = 'cadastro' or (
      embarque_id is not null and frete_empresa is not null and frete_empresa_unidade is not null
      and frete_motorista is not null and frete_motorista_unidade is not null and forma_pagamento is not null
      and pedagio is not null and exige_obs_cte is not null and cte_por_nf is not null)),
  add constraint solicitacoes_doc_campos_cadastro check (
    tipo <> 'cadastro' or (
      embarque_id is null and cliente_id is not null
      and length(trim(coalesce(telefone_motorista, ''))) between 1 and 40
      and length(trim(coalesce(mercadoria, ''))) between 1 and 200
      and valor_carga > 0
      and length(trim(coalesce(origem_cidade, ''))) between 1 and 120 and origem_uf ~ '^[A-Z]{2}$'
      and length(trim(coalesce(destino_cidade, ''))) between 1 and 120 and destino_uf ~ '^[A-Z]{2}$'
      and primeiro_embarque is not null));

create index solicitacoes_doc_cadastro_placa on public.solicitacoes_doc (placa) where tipo = 'cadastro';

-- Anexos do cadastro: documentos do motorista e dos veículos; mais formatos (Word, Excel, PowerPoint, vídeo, áudio).
alter table public.doc_anexos
  drop constraint if exists doc_anexos_categoria_check,
  drop constraint if exists doc_anexos_tipo_mime_check,
  add constraint doc_anexos_categoria_check check (categoria in (
    'nf', 'evidencia_frete', 'correcao', 'cte', 'mdfe', 'outro_emitido', 'motorista', 'veiculo')),
  add constraint doc_anexos_tipo_mime_check check (tipo_mime in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/webm'));

-- Notificações de Cadastro abrem a aba Cadastro (não a Documentação de um embarque).
alter table public.notificacoes
  alter column embarque_id drop not null,
  drop constraint if exists notificacoes_tipo_check,
  drop constraint if exists notificacoes_destino_check,
  add constraint notificacoes_tipo_check check (tipo in ('ajuste_solicitado', 'documentacao_disponivel', 'resposta_enviada', 'cadastro_concluido')),
  add constraint notificacoes_destino_check check (destino in ('embarque', 'apoio', 'cadastro'));

-- ---------------------------------------------------------------------------
-- Leitura: documentação segue o embarque; cadastro segue solicitante, filial e carteira
-- ---------------------------------------------------------------------------
create or replace function private.pode_ver_cadastro(p_solicitante uuid, p_filial uuid, p_comercial uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.usuario_ativo() and (
    p_solicitante = auth.uid()
    or ((private.tem_permissao('cadastro.ver') or private.tem_permissao('apoio.pagina'))
        and (private.eh_admin()
             or (p_filial is not null and private.no_escopo(p_filial, null))
             or (p_comercial is not null and private.no_escopo(null, p_comercial)))))
$$;

create or replace function private.pode_ver_solicitacao_reg(s public.solicitacoes_doc)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when s.tipo = 'cadastro' then private.pode_ver_cadastro(s.solicitante_id, s.filial_id, s.comercial_id)
              else private.pode_ver_documentacao(s.embarque_id) end
$$;

create or replace function private.pode_ver_solicitacao(p_solicitacao_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.solicitacoes_doc s where s.id = p_solicitacao_id and private.pode_ver_solicitacao_reg(s))
$$;

drop policy if exists leitura on public.solicitacoes_doc;
create policy leitura on public.solicitacoes_doc for select to authenticated using (private.pode_ver_solicitacao_reg(solicitacoes_doc));

create or replace function private.doc_carregar(p_id uuid)
returns public.solicitacoes_doc
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  perform private.exigir_ativo();
  select * into s from public.solicitacoes_doc where id = p_id for update;
  if not found or not private.pode_ver_solicitacao_reg(s) then
    perform private.doc_erro('P0002', 'Solicitação não encontrada ou fora do seu escopo.');
  end if;
  return s;
end $$;

-- Rótulo do tipo nas notificações.
create or replace function private.doc_rotulo(s public.solicitacoes_doc)
returns text language sql immutable as $$
  select case s.tipo when 'lote_emissao' then 'Lote e Emissão' when 'emissao' then 'Emissão' else 'Cadastro' end
$$;

-- ---------------------------------------------------------------------------
-- Armazenamento: mais formatos aceitos (o limite por arquivo do cadastro, 10 MB, é conferido ao vincular)
-- ---------------------------------------------------------------------------
update storage.buckets set allowed_mime_types = array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/webm']
where id = 'documentacao';

drop policy if exists travion_doc_envio on storage.objects;
create policy travion_doc_envio on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentacao'
    and name like 'envios/' || auth.uid()::text || '/%'
    and (private.tem_permissao('documentacao.solicitar') or private.tem_permissao('apoio.atender')
         or private.tem_permissao('cadastro.solicitar'))
  );

-- Vincula anexos conferindo dono, tamanho e tipo. Emissão: PDF/imagem até 15 MB. Cadastro: lista ampla até 10 MB.
create or replace function private.doc_vincular_anexos(
  p_solicitacao_id uuid, p_anexos jsonb, p_categorias text[], p_mensagem_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a jsonb;
  o record;
  v_cat text;
  v_total integer := 0;
  v_cadastro boolean := exists (select 1 from public.solicitacoes_doc where id = p_solicitacao_id and tipo = 'cadastro');
  v_limite bigint := case when v_cadastro then 10485760 else 15728640 end;
  v_tipos text[] := case when v_cadastro then array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/webm']
    else array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] end;
begin
  if p_anexos is null or jsonb_typeof(p_anexos) <> 'array' then return 0; end if;
  for a in select * from jsonb_array_elements(p_anexos) loop
    v_cat := a ->> 'categoria';
    if v_cat is null or not (v_cat = any (p_categorias)) then
      perform private.doc_erro('22023', 'Categoria de anexo não permitida nesta etapa.');
    end if;
    if coalesce(a ->> 'caminho', '') not like 'envios/' || auth.uid()::text || '/%' then
      perform private.doc_erro('42501', 'Arquivo enviado por outro usuário.');
    end if;
    select ob.name, ob.metadata into o from storage.objects ob
     where ob.bucket_id = 'documentacao' and ob.name = a ->> 'caminho'
       and coalesce(ob.owner_id, ob.owner::text) = auth.uid()::text;
    if not found then
      perform private.doc_erro('22023', 'Arquivo não encontrado no armazenamento: envie novamente (' || coalesce(a ->> 'nome', 'sem nome') || ').');
    end if;
    if coalesce((o.metadata ->> 'size')::bigint, 0) <= 0 then
      perform private.doc_erro('22023', 'Arquivo vazio ou envio incompleto: ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    if (o.metadata ->> 'size')::bigint > v_limite then
      perform private.doc_erro('22023', 'Arquivo acima de ' || (v_limite / 1048576) || ' MB: ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    if not (coalesce(o.metadata ->> 'mimetype', '') = any (v_tipos)) then
      perform private.doc_erro('22023', 'Tipo de arquivo não aceito: ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    insert into public.doc_anexos (solicitacao_id, categoria, caminho, nome, tipo_mime, tamanho, mensagem_id, enviado_por, enviado_por_nome)
    values (p_solicitacao_id, v_cat, a ->> 'caminho', left(coalesce(nullif(trim(a ->> 'nome'), ''), 'arquivo'), 200),
            o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint, p_mensagem_id, auth.uid(), private.nome_usuario())
    on conflict (caminho) do nothing;
    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Comercial: enviar cadastro
-- ---------------------------------------------------------------------------
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

  select * into c from public.clientes where id = nullif(p_dados ->> 'cliente_id', '')::uuid;
  if not found or not private.pode_ver_cliente(c.id) then perform private.doc_erro('22023', 'Selecione um cliente autorizado.'); end if;
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
   where tipo = 'cadastro' and placa = v_placa and status in ('enviado', 'em_atendimento', 'aguardando_informacao')
   order by numero limit 1;
  if found then
    return jsonb_build_object('status', 'cadastro_aberto', 'numero', aberta.numero, 'situacao', aberta.status,
      'registro', case when private.pode_ver_solicitacao_reg(aberta) then to_jsonb(aberta) end);
  end if;

  select jsonb_build_object(
    'codigo', null, 'cliente', c.nome, 'cliente_id', c.id, 'carteira', cm.nome, 'filial', f.nome, 'filial_id', f.id,
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
    filial_id, comercial_id, cliente_id, telefone_motorista, mercadoria, valor_carga,
    origem_cidade, origem_uf, destino_cidade, destino_uf, primeiro_embarque)
  values (
    'cadastro', v_placa, nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''), v_retrato, v_chave,
    auth.uid(), coalesce(private.nome_usuario(), 'Usuário'),
    v_filial, c.comercial_id, c.id, v_tel, left(trim(p_dados ->> 'mercadoria'), 200), round(v_valor, 2),
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

-- ---------------------------------------------------------------------------
-- Apoio: pedir ajuste / comercial responde (mesmas funções, agora sabendo o tipo)
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_ajuste_doc(p_id uuid, p_texto text, p_referencia text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_msg uuid;
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if length(trim(coalesce(p_texto, ''))) = 0 then perform private.doc_erro('22023', 'Descreva o que falta ou precisa ser corrigido.'); end if;
  v_msg := private.doc_evento(s.id, 'pendencia', left(trim(p_texto), 4000), nullif(trim(coalesce(p_referencia, '')), ''));
  update public.solicitacoes_doc set status = 'aguardando_informacao', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.solicitante_id, 'ajuste_solicitado', 'Ajuste solicitado pelo apoio',
    format('%s nº %s · %s: %s', private.doc_rotulo(s), s.numero, s.placa, left(trim(p_texto), 140)),
    s, case when s.tipo = 'cadastro' then 'cadastro' else 'embarque' end, 'ajuste:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.responder_ajuste_doc(p_id uuid, p_texto text, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_msg uuid;
  v_mot integer;
  v_vei integer;
begin
  s := private.doc_carregar(p_id);
  perform private.exigir(case when s.tipo = 'cadastro' then 'cadastro.solicitar' else 'documentacao.solicitar' end);
  if s.status <> 'aguardando_informacao' then
    perform private.doc_erro('55000', 'Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
  end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then perform private.doc_erro('22023', 'Escreva a resposta para o apoio.'); end if;
  v_msg := private.doc_evento(s.id, 'resposta', left(trim(p_texto), 4000));
  perform private.doc_vincular_anexos(s.id, p_anexos,
    case when s.tipo = 'cadastro' then array['motorista', 'veiculo', 'correcao'] else array['nf', 'evidencia_frete', 'correcao'] end, v_msg);
  if s.tipo = 'cadastro' then
    -- Correções entram como nova versão: os anteriores ficam; o limite vale para os arquivos desta resposta.
    select count(*) filter (where categoria = 'motorista'), count(*) filter (where categoria = 'veiculo')
      into v_mot, v_vei from public.doc_anexos where mensagem_id = v_msg;
    if v_mot > 4 or v_vei > 10 then
      perform private.doc_erro('22023', 'Na resposta: até 4 documentos do motorista e 10 dos veículos.');
    end if;
  end if;
  update public.solicitacoes_doc set status = 'em_atendimento', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.responsavel_id, 'resposta_enviada', 'Resposta do comercial',
    format('%s nº %s · %s: %s', private.doc_rotulo(s), s.numero, s.placa, left(trim(p_texto), 140)),
    s, 'apoio', 'resposta:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- Os documentos emitidos e "Documentação disponível" não se aplicam ao cadastro.
create or replace function public.anexar_documentos_doc(p_id uuid, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_n integer;
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_informacao']);
  if s.tipo = 'cadastro' then perform private.doc_erro('55000', 'Cadastro não recebe documentos emitidos: confirme a conclusão do cadastro.'); end if;
  v_n := private.doc_vincular_anexos(s.id, p_anexos, array['cte', 'mdfe', 'outro_emitido'], null);
  if v_n = 0 then perform private.doc_erro('22023', 'Nenhum arquivo para anexar.'); end if;
  perform private.doc_evento(s.id, 'evento', v_n || ' documento(s) emitido(s) anexado(s), em conferência', 'documentos');
  s := private.doc_tocar(s.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.concluir_solicitacao_doc(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if s.tipo = 'cadastro' then perform private.doc_erro('55000', 'Use "Confirmar cadastro concluído" para cadastros.'); end if;
  if not exists (select 1 from public.doc_anexos where solicitacao_id = s.id and categoria in ('cte', 'mdfe', 'outro_emitido')) then
    perform private.doc_erro('55000', 'Anexe ao menos um documento emitido (CT-e, MDF-e ou outro) antes de liberar.');
  end if;
  if s.tipo = 'lote_emissao' and s.lote_id is null then
    perform private.doc_erro('55000', 'Registre o número do lote gerado no ERP antes de liberar a documentação.');
  end if;
  update public.solicitacoes_doc set status = 'documentacao_disponivel', concluido_em = now(),
    concluido_por_nome = coalesce(private.nome_usuario(), 'Usuário'), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Documentação disponível, conferida e liberada por ' || s.concluido_por_nome);
  perform private.doc_notificar(s.solicitante_id, 'documentacao_disponivel', 'Documentação disponível',
    format('%s nº %s · %s · %s', private.doc_rotulo(s), s.numero, s.placa, s.retrato ->> 'cliente'),
    s, 'embarque', 'disponivel:' || s.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- O apoio fez o cadastro à mão no ERP e confirma aqui. Referência do ERP opcional; sem documento emitido.
create or replace function public.concluir_cadastro_doc(p_id uuid, p_referencia text, p_retorno text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  if s.tipo <> 'cadastro' then perform private.doc_erro('55000', 'Esta solicitação não é de cadastro.'); end if;
  if s.status = 'aguardando_informacao' then
    perform private.doc_erro('55000', 'Há pendência aguardando resposta do comercial: resolva antes de concluir.');
  end if;
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  update public.solicitacoes_doc set status = 'cadastro_concluido', concluido_em = now(),
    concluido_por_nome = coalesce(private.nome_usuario(), 'Usuário'),
    erp_referencia = nullif(left(trim(coalesce(p_referencia, '')), 120), ''),
    retorno_solicitante = nullif(left(trim(coalesce(p_retorno, '')), 2000), ''),
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Cadastro concluído no ERP, confirmado por ' || s.concluido_por_nome
    || coalesce(' · referência ' || s.erp_referencia, ''), 'conclusao');
  perform private.doc_notificar(s.solicitante_id, 'cadastro_concluido',
    'Cadastro da placa ' || substr(s.placa, 1, 3) || '-' || substr(s.placa, 4) || ' concluído',
    format('Cadastro nº %s · %s%s', s.numero, s.retrato ->> 'cliente', coalesce(' · ' || left(s.retorno_solicitante, 120), '')),
    s, 'cadastro', 'cadastro_concluido:' || s.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.cancelar_solicitacao_doc(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  if s.status in ('documentacao_disponivel', 'cadastro_concluido', 'cancelado') then
    perform private.doc_erro('55000', 'Solicitação já concluída ou cancelada.');
  end if;
  if not (private.tem_permissao('documentacao.cancelar') or (s.solicitante_id = auth.uid() and s.status = 'enviado')) then
    perform private.doc_erro('42501', 'Você não tem permissão para cancelar esta solicitação.');
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then perform private.doc_erro('22023', 'Informe o motivo do cancelamento.'); end if;
  if exists (select 1 from public.lotes_erp where solicitacao_id = s.id) then
    perform private.doc_erro('55000', 'O lote já foi registrado nesta solicitação: conclua a emissão em vez de cancelar.');
  end if;
  update public.solicitacoes_doc set status = 'cancelado', cancelado_em = now(), cancelado_por_nome = coalesce(private.nome_usuario(), 'Usuário'),
    cancelado_motivo = left(trim(p_motivo), 1000), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Solicitação cancelada por ' || s.cancelado_por_nome || ': ' || s.cancelado_motivo);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
revoke all on function private.pode_ver_cadastro(uuid, uuid, uuid), private.pode_ver_solicitacao_reg(public.solicitacoes_doc) from public, anon;
grant execute on function private.pode_ver_cadastro(uuid, uuid, uuid), private.pode_ver_solicitacao_reg(public.solicitacoes_doc) to authenticated;
revoke all on function private.doc_rotulo(public.solicitacoes_doc) from public, anon, authenticated;
revoke all on function public.criar_solicitacao_cadastro(jsonb, jsonb), public.concluir_cadastro_doc(uuid, text, text) from public, anon;
grant execute on function public.criar_solicitacao_cadastro(jsonb, jsonb), public.concluir_cadastro_doc(uuid, text, text) to authenticated;
