-- Conferência de participantes NF-e × CT-e (pedido de 04/11/2026).
-- Quando o Apoio anexa um CT-e (categoria 'cte') para devolver, o banco cria uma conferência "processando" e avisa o
-- n8n (webhook). O n8n baixa a NF e o CT-e da solicitação, lê os participantes (PDF/imagem por IA hoje; XML quando
-- houver integração com o ERP), compara e grava o resultado aqui. O Atendimento mostra o resultado em tempo real.
--
-- Campos conferidos: Remetente, Destinatário, Local de coleta, Local de entrega, Cliente pagador (tomador) e se a
-- chave da NF está citada no CT-e. A conferência AVISA, não bloqueia o "Liberar ao comercial".
--
-- Pré-requisito (uma vez, no SQL Editor, com os valores do n8n):
--   select vault.create_secret('<URL de produção do webhook do n8n>', 'travion_n8n_auditoria_url');
--   select vault.create_secret('<token longo e aleatório, o mesmo da credencial do n8n>', 'travion_n8n_auditoria_token');
-- Sem esses segredos a conferência fica "erro" com a mensagem "Integração com o n8n não configurada".

create extension if not exists pg_net with schema extensions;

create table public.auditoria_participantes (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  anexo_id uuid not null unique references public.doc_anexos (id),
  status text not null default 'processando'
    check (status in ('processando', 'conferido', 'alerta', 'divergente', 'erro')),
  origem text check (origem in ('pdf_imagem', 'xml')),
  -- Linhas da comparação: [{campo, rotulo, nf, cte, resultado ('ok'|'alerta'|'divergente'|'nao_lido'), observacao}]
  resultado jsonb not null default '[]'::jsonb,
  -- O que foi lido de cada arquivo (para conferência humana e para ajustar a leitura).
  leitura jsonb not null default '{}'::jsonb,
  mensagem text,
  tentativas integer not null default 1,
  pedido_id bigint,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index auditoria_participantes_solicitacao on public.auditoria_participantes (solicitacao_id);
create index auditoria_participantes_status on public.auditoria_participantes (status, criado_em);

alter table public.auditoria_participantes enable row level security;
create policy leitura on public.auditoria_participantes for select to authenticated
  using (private.pode_ver_solicitacao(solicitacao_id));
revoke all on public.auditoria_participantes from anon, authenticated;
grant select on public.auditoria_participantes to authenticated;

-- Dispara o n8n (assíncrono, pg_net). Não interrompe o anexo se falhar: marca a conferência como erro.
create or replace function private.auditoria_disparar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_token text;
  v_pedido bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'travion_n8n_auditoria_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'travion_n8n_auditoria_token';
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then
    update public.auditoria_participantes set status = 'erro', mensagem = 'Integração com o n8n não configurada.',
      atualizado_em = now(), concluido_em = now() where id = p_id;
    return;
  end if;
  select net.http_post(
    url := v_url,
    body := jsonb_build_object('auditoria_id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-travion-token', v_token),
    timeout_milliseconds := 10000
  ) into v_pedido;
  update public.auditoria_participantes set pedido_id = v_pedido where id = p_id;
exception when others then
  update public.auditoria_participantes set status = 'erro', mensagem = 'Falha ao chamar o n8n: ' || sqlerrm,
    atualizado_em = now(), concluido_em = now() where id = p_id;
end $$;

-- Cada CT-e anexado gera uma conferência.
create or replace function private.auditoria_ao_anexar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if new.categoria <> 'cte' then return new; end if;
  insert into public.auditoria_participantes (solicitacao_id, anexo_id)
  values (new.solicitacao_id, new.id) returning id into v_id;
  perform private.auditoria_disparar(v_id);
  return new;
end $$;

drop trigger if exists auditoria_ao_anexar on public.doc_anexos;
create trigger auditoria_ao_anexar after insert on public.doc_anexos
  for each row execute function private.auditoria_ao_anexar();

-- Apoio pede nova conferência (ex.: depois de trocar o arquivo, ou se ficou "processando"/"erro").
create or replace function public.reconferir_participantes(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.auditoria_participantes;
begin
  perform private.exigir('apoio.atender');
  select * into a from public.auditoria_participantes where id = p_id for update;
  if not found or not private.pode_ver_solicitacao(a.solicitacao_id) then
    perform private.doc_erro('P0002', 'Conferência não encontrada.');
  end if;
  update public.auditoria_participantes set status = 'processando', mensagem = null, tentativas = tentativas + 1,
    atualizado_em = now(), concluido_em = null where id = p_id returning * into a;
  perform private.auditoria_disparar(a.id);
  select * into a from public.auditoria_participantes where id = p_id;
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(a));
end $$;

-- Usado só pelo n8n (service_role): tudo que ele precisa para conferir uma conferência.
create or replace function public.auditoria_dados(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'auditoria_id', a.id,
    'solicitacao', jsonb_build_object('id', s.id, 'numero', s.numero, 'tipo', s.tipo, 'placa', s.placa,
                                      'cte_por_nf', s.cte_por_nf, 'tipo_operacao', s.tipo_operacao),
    'cliente', jsonb_build_object('nome', c.nome, 'razao_social', c.razao_social, 'documento', c.documento,
                                  'municipio', c.municipio, 'uf', c.uf),
    'rota', jsonb_build_object('origem_cidade', e.origem_cidade, 'origem_uf', e.origem_uf,
                               'destino_cidade', e.destino_cidade, 'destino_uf', e.destino_uf,
                               'local_coleta', lc.nome, 'local_entrega', le.nome),
    'cte', (select jsonb_build_object('id', x.id, 'caminho', x.caminho, 'nome', x.nome, 'tipo_mime', x.tipo_mime)
              from public.doc_anexos x where x.id = a.anexo_id),
    'nfs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'caminho', x.caminho, 'nome', x.nome,
                                                         'tipo_mime', x.tipo_mime) order by x.enviado_em)
                       from public.doc_anexos x where x.solicitacao_id = s.id and x.categoria = 'nf'), '[]'::jsonb)
  )
  from public.auditoria_participantes a
  join public.solicitacoes_doc s on s.id = a.solicitacao_id
  left join public.embarques e on e.id = s.embarque_id
  left join public.clientes c on c.id = e.cliente_id
  left join public.locais lc on lc.id = e.local_coleta_id
  left join public.locais le on le.id = e.local_entrega_id
  where a.id = p_id
$$;

-- Usado só pelo n8n (service_role): grava o resultado e deixa um registro no histórico da solicitação.
create or replace function public.auditoria_registrar(
  p_id uuid, p_status text, p_origem text, p_resultado jsonb, p_leitura jsonb, p_mensagem text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.auditoria_participantes;
  v_texto text;
begin
  if p_status not in ('conferido', 'alerta', 'divergente', 'erro') then
    raise exception 'Status inválido: %', p_status using errcode = '22023';
  end if;
  update public.auditoria_participantes set status = p_status, origem = p_origem,
    resultado = coalesce(p_resultado, '[]'::jsonb), leitura = coalesce(p_leitura, '{}'::jsonb),
    mensagem = left(p_mensagem, 500), atualizado_em = now(), concluido_em = now()
  where id = p_id returning * into a;
  if not found then raise exception 'Conferência não encontrada' using errcode = 'P0002'; end if;
  v_texto := 'Conferência de participantes NF × CT-e: ' || case p_status
    when 'conferido' then 'tudo confere'
    when 'alerta' then 'conferir manualmente'
    when 'divergente' then 'DIVERGÊNCIA'
    else 'não foi possível conferir' end
    || coalesce(' (' || nullif(p_mensagem, '') || ')', '');
  insert into public.doc_mensagens (solicitacao_id, tipo, texto, referencia, autor_id, autor_nome)
  values (a.solicitacao_id, 'evento', left(v_texto, 1000), 'auditoria', null, 'Conferência automática');
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(a));
end $$;

revoke all on function private.auditoria_disparar(uuid), private.auditoria_ao_anexar() from public, anon, authenticated;
revoke all on function public.auditoria_dados(uuid), public.auditoria_registrar(uuid, text, text, jsonb, jsonb, text),
  public.reconferir_participantes(uuid) from public, anon, authenticated;
grant execute on function public.reconferir_participantes(uuid) to authenticated;
grant execute on function public.auditoria_dados(uuid), public.auditoria_registrar(uuid, text, text, jsonb, jsonb, text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.auditoria_participantes;
  end if;
end $$;
