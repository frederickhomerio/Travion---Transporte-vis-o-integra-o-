-- Apoio Operacional: solicitações de documentação (lote do ERP + emissão de CT-e/MDF-e), pedido de 27/10/2026.
-- O app organiza dados, anexos, pendências e notificações. Lote e emissão são feitos à mão no ERP pelo apoio;
-- não há integração com o ERP nem envio externo de mensagens.
--
-- Modelo:
--   lotes_erp          um lote por embarque (o embarque é o pedido com vários veículos); número informado pelo apoio
--   solicitacoes_doc   uma por veículo/viagem; a primeira (lote_emissao) junta abertura do lote e emissão
--   doc_anexos         NF, evidência de frete, correções e documentos emitidos (arquivos no Storage, bucket privado)
--   doc_mensagens      pendências, respostas e eventos (histórico só de inserção)
--   notificacoes       avisos internos por destinatário (sino)
-- Tudo é gravado por funções SECURITY DEFINER; leitura por RLS com o mesmo escopo dos embarques.

-- ---------------------------------------------------------------------------
-- Permissões (ajustáveis em Administração → Permissões)
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('documentacao.ver',       'Documentação', 'Consultar a documentação dos embarques (solicitações, pendências e documentos emitidos)'),
  ('documentacao.solicitar', 'Documentação', 'Pedir geração de lote e emissão de documentos e responder pendências do apoio'),
  ('documentacao.cancelar',  'Documentação', 'Cancelar solicitações de documentação (com motivo)'),
  ('apoio.pagina',           'Documentação', 'Acessar a aba Apoio Operacional (fila de demandas)'),
  ('apoio.atender',          'Documentação', 'Assumir e atender demandas: registrar lote, pedir ajuste, anexar e liberar documentos')
on conflict do nothing;

insert into public.papel_permissoes (papel, chave) values
  ('apoio', 'embarques.ver'), ('apoio', 'documentacao.ver'), ('apoio', 'apoio.pagina'), ('apoio', 'apoio.atender'),
  ('apoio', 'documentacao.cancelar'),
  ('gestor', 'documentacao.ver'), ('gestor', 'documentacao.solicitar'), ('gestor', 'documentacao.cancelar'), ('gestor', 'apoio.pagina'),
  ('supervisor', 'documentacao.ver'), ('supervisor', 'documentacao.solicitar'),
  ('embarcador', 'documentacao.ver'), ('embarcador', 'documentacao.solicitar'),
  ('comercial', 'documentacao.ver'), ('comercial', 'documentacao.solicitar'),
  ('operacao', 'documentacao.ver')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.lotes_erp (
  id uuid primary key default gen_random_uuid(),
  embarque_id uuid not null unique references public.embarques (id),
  numero text not null check (length(trim(numero)) between 1 and 60),
  solicitacao_id uuid,
  registrado_por uuid references public.perfis (id),
  registrado_por_nome text not null,
  registrado_em timestamptz not null default now(),
  versao integer not null default 1,
  atualizado_em timestamptz not null default now()
);

create table public.solicitacoes_doc (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  embarque_id uuid not null references public.embarques (id),
  lote_id uuid references public.lotes_erp (id),
  tipo text not null check (tipo in ('lote_emissao', 'emissao')),
  status text not null default 'enviado'
    check (status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'documentacao_disponivel', 'cancelado')),
  placa text not null check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  placas_reboque text[] not null default '{}',
  frete_empresa numeric(12, 2) not null check (frete_empresa > 0),
  frete_empresa_unidade text not null check (frete_empresa_unidade in ('rs_tonelada', 'rs_viagem')),
  frete_motorista numeric(12, 2) not null check (frete_motorista > 0),
  frete_motorista_unidade text not null check (frete_motorista_unidade in ('rs_tonelada', 'rs_viagem')),
  tipo_operacao text check (tipo_operacao in ('exportacao', 'mi_tributado', 'mi_isento')),
  forma_pagamento text not null check (forma_pagamento in ('cheque', 'pagbem')),
  pedagio text not null check (pedagio in ('sem_parar', 'move_mais', 'conect_car', 'veloe', 'nao_ha')),
  exige_obs_cte boolean not null,
  obs_cte text,
  cte_por_nf boolean not null,
  observacoes text,
  retrato jsonb not null,
  chave_envio uuid not null,
  solicitante_id uuid not null references public.perfis (id),
  solicitante_nome text not null,
  responsavel_id uuid references public.perfis (id),
  responsavel_nome text,
  enviado_em timestamptz not null default now(),
  assumido_em timestamptz,
  concluido_em timestamptz,
  concluido_por_nome text,
  cancelado_em timestamptz,
  cancelado_por_nome text,
  cancelado_motivo text,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  check (not exige_obs_cte or length(trim(coalesce(obs_cte, ''))) > 0),
  check (tipo = 'emissao' or tipo_operacao is not null),
  unique (solicitante_id, chave_envio)
);
-- Uma única solicitação inicial (lote e emissão) por embarque, garantida pelo banco.
create unique index solicitacoes_doc_inicial_unica on public.solicitacoes_doc (embarque_id)
  where tipo = 'lote_emissao' and status <> 'cancelado';
create index solicitacoes_doc_embarque on public.solicitacoes_doc (embarque_id);
create index solicitacoes_doc_atualizado on public.solicitacoes_doc (atualizado_em);

alter table public.lotes_erp add constraint lotes_erp_solicitacao_fk foreign key (solicitacao_id) references public.solicitacoes_doc (id);

create table public.doc_mensagens (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  tipo text not null check (tipo in ('pendencia', 'resposta', 'evento')),
  texto text not null check (length(trim(texto)) between 1 and 4000),
  referencia text,
  autor_id uuid references public.perfis (id),
  autor_nome text not null,
  criado_em timestamptz not null default now()
);
create index doc_mensagens_solicitacao on public.doc_mensagens (solicitacao_id, criado_em);

create table public.doc_anexos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  categoria text not null check (categoria in ('nf', 'evidencia_frete', 'correcao', 'cte', 'mdfe', 'outro_emitido')),
  caminho text not null unique,
  nome text not null check (length(trim(nome)) between 1 and 200),
  tipo_mime text not null check (tipo_mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  tamanho bigint not null check (tamanho > 0 and tamanho <= 15728640),
  mensagem_id uuid references public.doc_mensagens (id),
  enviado_por uuid references public.perfis (id),
  enviado_por_nome text not null,
  enviado_em timestamptz not null default now()
);
create index doc_anexos_solicitacao on public.doc_anexos (solicitacao_id);

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid not null references public.perfis (id),
  tipo text not null check (tipo in ('ajuste_solicitado', 'documentacao_disponivel', 'resposta_enviada')),
  titulo text not null,
  texto text not null,
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  embarque_id uuid not null references public.embarques (id),
  destino text not null check (destino in ('embarque', 'apoio')),
  chave text not null,
  criada_em timestamptz not null default now(),
  lida_em timestamptz,
  unique (destinatario_id, chave)
);
create index notificacoes_destinatario on public.notificacoes (destinatario_id, criada_em desc);

-- ---------------------------------------------------------------------------
-- Leitura (RLS): mesmo escopo do embarque + permissão de documentação ou da aba Apoio
-- ---------------------------------------------------------------------------
create or replace function private.pode_ver_documentacao(p_embarque_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (private.tem_permissao('documentacao.ver') or private.tem_permissao('apoio.pagina'))
    and private.pode_ver_embarque(p_embarque_id)
$$;

create or replace function private.pode_ver_solicitacao(p_solicitacao_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.solicitacoes_doc s
                 where s.id = p_solicitacao_id and private.pode_ver_documentacao(s.embarque_id))
$$;

alter table public.lotes_erp enable row level security;
alter table public.solicitacoes_doc enable row level security;
alter table public.doc_mensagens enable row level security;
alter table public.doc_anexos enable row level security;
alter table public.notificacoes enable row level security;

create policy leitura on public.lotes_erp for select to authenticated using (private.pode_ver_documentacao(embarque_id));
create policy leitura on public.solicitacoes_doc for select to authenticated using (private.pode_ver_documentacao(embarque_id));
create policy leitura on public.doc_mensagens for select to authenticated using (private.pode_ver_solicitacao(solicitacao_id));
create policy leitura on public.doc_anexos for select to authenticated using (private.pode_ver_solicitacao(solicitacao_id));
-- Notificação só para o destinatário e só enquanto ele ainda pode ver a solicitação.
create policy leitura on public.notificacoes for select to authenticated
  using (destinatario_id = auth.uid() and private.pode_ver_solicitacao(solicitacao_id));

revoke all on public.lotes_erp, public.solicitacoes_doc, public.doc_mensagens, public.doc_anexos, public.notificacoes from anon, authenticated;
grant select on public.lotes_erp, public.solicitacoes_doc, public.doc_mensagens, public.doc_anexos, public.notificacoes to authenticated;

-- ---------------------------------------------------------------------------
-- Armazenamento dos arquivos: bucket privado, só PDF/imagem até 15 MB.
-- O usuário envia para envios/<seu id>/...; o arquivo só passa a valer quando uma função o vincula
-- à solicitação (conferindo dono, tamanho e tipo). Leitura: o próprio envio ou anexo de solicitação visível.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentacao', 'documentacao', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists travion_doc_envio on storage.objects;
create policy travion_doc_envio on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentacao'
    and name like 'envios/' || auth.uid()::text || '/%'
    and (private.tem_permissao('documentacao.solicitar') or private.tem_permissao('apoio.atender'))
  );
drop policy if exists travion_doc_leitura on storage.objects;
create policy travion_doc_leitura on storage.objects for select to authenticated
  using (
    bucket_id = 'documentacao'
    and (
      name like 'envios/' || auth.uid()::text || '/%'
      or exists (select 1 from public.doc_anexos a where a.caminho = name and private.pode_ver_solicitacao(a.solicitacao_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------------
create or replace function private.doc_erro(p_codigo text, p_msg text)
returns void language plpgsql as $$
begin
  raise exception using errcode = p_codigo, message = p_msg;
end $$;

-- Confere e grava os anexos enviados pelo usuário (objetos já no Storage, no prefixo dele).
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
    if coalesce(o.metadata ->> 'mimetype', '') not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then
      perform private.doc_erro('22023', 'Tipo de arquivo não aceito (use PDF, PNG, JPG ou WEBP): ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    insert into public.doc_anexos (solicitacao_id, categoria, caminho, nome, tipo_mime, tamanho, mensagem_id, enviado_por, enviado_por_nome)
    values (p_solicitacao_id, v_cat, a ->> 'caminho', left(coalesce(nullif(trim(a ->> 'nome'), ''), 'arquivo'), 200),
            o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint, p_mensagem_id, auth.uid(), private.nome_usuario())
    on conflict (caminho) do nothing;
    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

create or replace function private.doc_evento(p_solicitacao_id uuid, p_tipo text, p_texto text, p_referencia text default null)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.doc_mensagens (solicitacao_id, tipo, texto, referencia, autor_id, autor_nome)
  values (p_solicitacao_id, p_tipo, p_texto, p_referencia, auth.uid(), coalesce(private.nome_usuario(), 'Sistema'))
  returning id
$$;

create or replace function private.doc_notificar(
  p_destinatario uuid, p_tipo text, p_titulo text, p_texto text, s public.solicitacoes_doc, p_destino text, p_chave text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notificacoes (destinatario_id, tipo, titulo, texto, solicitacao_id, embarque_id, destino, chave)
  select p_destinatario, p_tipo, p_titulo, p_texto, s.id, s.embarque_id, p_destino, p_chave
  where p_destinatario is not null and p_destinatario is distinct from auth.uid()
  on conflict (destinatario_id, chave) do nothing
$$;

-- Carrega a solicitação travada e confere escopo.
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
  if not found or not private.pode_ver_documentacao(s.embarque_id) then
    perform private.doc_erro('P0002', 'Solicitação não encontrada ou fora do seu escopo.');
  end if;
  return s;
end $$;

create or replace function private.doc_exigir_responsavel(s public.solicitacoes_doc, p_status text[])
returns void
language plpgsql
as $$
begin
  perform private.exigir('apoio.atender');
  if s.responsavel_id is distinct from auth.uid() then
    perform private.doc_erro('42501', 'Somente o responsável pelo atendimento (' || coalesce(s.responsavel_nome, 'ninguém') || ') pode fazer isso.');
  end if;
  if not (s.status = any (p_status)) then
    perform private.doc_erro('55000', 'A solicitação não está numa etapa que permite esta ação.');
  end if;
end $$;

create or replace function private.doc_tocar(p_id uuid)
returns public.solicitacoes_doc
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.solicitacoes_doc set versao = versao + 1, atualizado_em = now() where id = p_id returning *
$$;

-- ---------------------------------------------------------------------------
-- Comercial: criar solicitação (primeira nota = Lote e Emissão; próximos veículos = Emissão)
-- ---------------------------------------------------------------------------
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
      tipo_operacao, forma_pagamento, pedagio, exige_obs_cte, obs_cte, cte_por_nf, observacoes, retrato, chave_envio,
      solicitante_id, solicitante_nome)
    values (
      e.id, l.id, v_tipo, v_placa, v_reboques, (p_dados ->> 'frete_empresa')::numeric, p_dados ->> 'frete_empresa_unidade',
      (p_dados ->> 'frete_motorista')::numeric, p_dados ->> 'frete_motorista_unidade',
      v_tipo_op, p_dados ->> 'forma_pagamento', p_dados ->> 'pedagio', v_exige,
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

-- ---------------------------------------------------------------------------
-- Apoio: assumir (atômico), registrar lote, pedir ajuste, anexar emitidos, liberar
-- ---------------------------------------------------------------------------
create or replace function public.assumir_solicitacao_doc(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  perform private.exigir('apoio.atender');
  s := private.doc_carregar(p_id);
  if s.responsavel_id is not null then
    return jsonb_build_object('status', case when s.responsavel_id = auth.uid() then 'ok' else 'ja_assumida' end, 'registro', to_jsonb(s));
  end if;
  if s.status <> 'enviado' then
    return jsonb_build_object('status', 'indisponivel', 'registro', to_jsonb(s));
  end if;
  update public.solicitacoes_doc set responsavel_id = auth.uid(), responsavel_nome = coalesce(private.nome_usuario(), 'Usuário'),
    status = 'em_atendimento', assumido_em = now(), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Atendimento assumido por ' || s.responsavel_nome);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
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
    if l.solicitacao_id is distinct from s.id then
      perform private.doc_erro('55000', 'Este embarque já tem lote registrado (' || l.numero || ').');
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
    format('%s nº %s · %s: %s', case when s.tipo = 'lote_emissao' then 'Lote e Emissão' else 'Emissão' end, s.numero, s.placa, left(trim(p_texto), 140)),
    s, 'embarque', 'ajuste:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- Comercial responde a pendência (texto obrigatório; anexos de correção opcionais, sem substituir os anteriores).
create or replace function public.responder_ajuste_doc(p_id uuid, p_texto text, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_msg uuid;
begin
  perform private.exigir('documentacao.solicitar');
  s := private.doc_carregar(p_id);
  if s.status <> 'aguardando_informacao' then
    perform private.doc_erro('55000', 'Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
  end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then perform private.doc_erro('22023', 'Escreva a resposta para o apoio.'); end if;
  v_msg := private.doc_evento(s.id, 'resposta', left(trim(p_texto), 4000));
  perform private.doc_vincular_anexos(s.id, p_anexos, array['nf', 'evidencia_frete', 'correcao'], v_msg);
  update public.solicitacoes_doc set status = 'em_atendimento', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.responsavel_id, 'resposta_enviada', 'Resposta do comercial',
    format('%s nº %s · %s: %s', case when s.tipo = 'lote_emissao' then 'Lote e Emissão' else 'Emissão' end, s.numero, s.placa, left(trim(p_texto), 140)),
    s, 'apoio', 'resposta:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

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
    format('%s nº %s · %s · %s', case when s.tipo = 'lote_emissao' then 'Lote e Emissão' else 'Emissão' end, s.numero, s.placa, s.retrato ->> 'cliente'),
    s, 'embarque', 'disponivel:' || s.id);
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
  if s.status in ('documentacao_disponivel', 'cancelado') then
    perform private.doc_erro('55000', 'Solicitação já concluída ou cancelada.');
  end if;
  -- Quem pediu pode desistir enquanto ninguém assumiu; depois disso, só quem tem a permissão de cancelar.
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

create or replace function public.marcar_notificacoes_lidas(p_ids uuid[])
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with m as (
    update public.notificacoes set lida_em = now()
    where destinatario_id = auth.uid() and lida_em is null and (p_ids is null or id = any (p_ids))
    returning 1)
  select count(*)::integer from m
$$;

-- Mensagens e anexos novos também atualizam a solicitação (a fila sincroniza por atualizado_em).
create or replace function private.doc_mensagem_toca()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.solicitacoes_doc set atualizado_em = now() where id = new.solicitacao_id and atualizado_em < now();
  return new;
end $$;
create trigger doc_anexos_toca after insert on public.doc_anexos for each row execute function private.doc_mensagem_toca();

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
revoke all on function private.pode_ver_documentacao(uuid), private.pode_ver_solicitacao(uuid) from public, anon;
grant execute on function private.pode_ver_documentacao(uuid), private.pode_ver_solicitacao(uuid) to authenticated;
revoke all on function private.doc_vincular_anexos(uuid, jsonb, text[], uuid), private.doc_evento(uuid, text, text, text),
  private.doc_notificar(uuid, text, text, text, public.solicitacoes_doc, text, text), private.doc_carregar(uuid),
  private.doc_tocar(uuid), private.doc_mensagem_toca() from public, anon, authenticated;
revoke all on function public.criar_solicitacao_doc(uuid, jsonb, jsonb), public.assumir_solicitacao_doc(uuid),
  public.registrar_lote_doc(uuid, text), public.solicitar_ajuste_doc(uuid, text, text), public.responder_ajuste_doc(uuid, text, jsonb),
  public.anexar_documentos_doc(uuid, jsonb), public.concluir_solicitacao_doc(uuid), public.cancelar_solicitacao_doc(uuid, text),
  public.marcar_notificacoes_lidas(uuid[]) from public, anon;
grant execute on function public.criar_solicitacao_doc(uuid, jsonb, jsonb), public.assumir_solicitacao_doc(uuid),
  public.registrar_lote_doc(uuid, text), public.solicitar_ajuste_doc(uuid, text, text), public.responder_ajuste_doc(uuid, text, jsonb),
  public.anexar_documentos_doc(uuid, jsonb), public.concluir_solicitacao_doc(uuid), public.cancelar_solicitacao_doc(uuid, text),
  public.marcar_notificacoes_lidas(uuid[]) to authenticated;

-- Tempo real (o Realtime aplica o RLS de leitura de cada assinante)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.solicitacoes_doc, public.lotes_erp, public.doc_mensagens, public.doc_anexos, public.notificacoes;
  end if;
end $$;
