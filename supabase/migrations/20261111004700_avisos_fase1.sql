-- Avisos por usuário, Fase 1 (pedido do Frederick, 06/11/2026; lista aprovada em 11/11/2026).
--
-- Novos avisos no sino:
--   1. Solicitação nova na fila            → quem tem "avisos.fila_nova" no escopo (padrão: Apoio Operacional)
--   2. Solicitação assumida pelo apoio      → quem pediu
--   3. Solicitação cancelada (com o motivo) → quem pediu e quem atendia            (+ WhatsApp)
--   4. Fila estourou o prazo                → sem responsável: "avisos.fila_nova"; com responsável: ele.
--                                             Cópia para "avisos.prazo" (padrão: Gestor e administrador) (+ WhatsApp)
--   5. Novo embarque liberado               → "avisos.embarque_novo" do centro (padrão: Embarcador, Supervisor)
--   6. Embarque suspenso/encerrado/reativado→ quem criou + "avisos.embarque_estado" do centro
--                                             (padrão: Supervisor, Coordenador Comercial, administrador) (+ WhatsApp)
-- Avisos que já existiam e passam a ir também pelo WhatsApp: ajuste solicitado, documentação disponível,
-- correção recebida (resposta_enviada) e cadastro cancelado.
--
-- WhatsApp: só para quem o administrador ligou em Administração → Usuários (perfis.whatsapp_avisos) e tem
-- celular no cadastro. O banco chama o n8n da VPS (pg_net, assíncrono), que envia pela Z-API.
-- Usa o mesmo token da conferência NF × CT-e (Vault travion_n8n_auditoria_token) e a URL do Vault
-- travion_n8n_whatsapp_url (criada aqui). Sem a URL ou o token, o aviso fica só no sino.
-- Nada é apagado: só acrescenta colunas, permissões, funções e gatilhos.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
alter table public.perfis add column if not exists whatsapp_avisos boolean not null default false;

alter table public.notificacoes alter column solicitacao_id drop not null;
alter table public.notificacoes add column if not exists whatsapp_pedido_em timestamptz;
alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'ajuste_solicitado', 'documentacao_disponivel', 'resposta_enviada', 'cadastro_concluido', 'cadastro_cancelado',
  'estadia_atualizada', 'documentacao_devolvida',
  'fila_nova', 'solicitacao_assumida', 'solicitacao_cancelada', 'prazo_estourado', 'embarque_novo', 'embarque_estado'));
alter table public.notificacoes drop constraint if exists notificacoes_destino_check;
alter table public.notificacoes add constraint notificacoes_destino_check check (destino in ('embarque', 'apoio', 'cadastro', 'estadia', 'lista'));
alter table public.notificacoes drop constraint if exists notificacoes_alvo;
alter table public.notificacoes add constraint notificacoes_alvo check (solicitacao_id is not null or embarque_id is not null);

-- Aviso de embarque (sem solicitação): vale o escopo do embarque.
drop policy if exists leitura on public.notificacoes;
create policy leitura on public.notificacoes for select to authenticated
  using (destinatario_id = auth.uid() and case when solicitacao_id is not null then private.pode_ver_solicitacao(solicitacao_id)
                                               else private.pode_ver_embarque(embarque_id) end);

-- ---------------------------------------------------------------------------
-- 2. Permissões (ajustáveis em Administração → Permissões)
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('avisos.fila_nova', 'Avisos', 'Receber aviso de cada solicitação nova na fila do Apoio (Lote e Emissão, Emissão, Cadastro, Estadia) e de prazo estourado sem responsável'),
  ('avisos.prazo', 'Avisos', 'Receber cópia dos avisos de fila com prazo estourado'),
  ('avisos.embarque_novo', 'Avisos', 'Receber aviso de novo embarque liberado no seu centro de custo'),
  ('avisos.embarque_estado', 'Avisos', 'Receber aviso de embarque suspenso, encerrado ou reativado no seu centro de custo')
on conflict (chave) do update set grupo = excluded.grupo, descricao = excluded.descricao;

insert into public.papel_permissoes (papel, chave) values
  ('apoio', 'avisos.fila_nova'), ('operacao', 'avisos.fila_nova'),
  ('gestor', 'avisos.prazo'),
  ('embarcador', 'avisos.embarque_novo'), ('supervisor', 'avisos.embarque_novo'),
  ('supervisor', 'avisos.embarque_estado'), ('comercial', 'avisos.embarque_estado')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Destinatários
-- ---------------------------------------------------------------------------
-- Permissão de OUTRO perfil (tem_permissao olha só o usuário logado).
-- Administrador: recebe os avisos críticos (prazo e estado do embarque) e só recebe os de volume
-- (fila nova, embarque novo) se marcado para ele em Permissões.
create or replace function private.perfil_pode(p_perfil uuid, p_chave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when p.status <> 'ativo' then false
      when p.papel = 'administrador' then coalesce(
        (select pp.permitido from public.perfil_permissoes pp where pp.perfil_id = p.id and pp.chave = p_chave),
        not (p_chave in ('avisos.fila_nova', 'avisos.embarque_novo')))
      else coalesce(
        (select pp.permitido from public.perfil_permissoes pp where pp.perfil_id = p.id and pp.chave = p_chave),
        exists (select 1 from public.papel_permissoes rp where rp.papel = p.papel and rp.chave = p_chave))
    end
    from public.perfis p where p.id = p_perfil
  ), false)
$$;

create or replace function private.perfil_ve_filial(p_perfil uuid, p_filial uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_filial is null
      or exists (select 1 from public.perfis p where p.id = p_perfil and p.papel = 'administrador')
      or exists (select 1 from public.perfil_filiais pf where pf.perfil_id = p_perfil and pf.filial_id = p_filial)
$$;

-- Grava um aviso (nunca para quem causou o evento, nem para inativos; repetido pela chave é ignorado).
create or replace function private.avisar(p_dest uuid, p_tipo text, p_titulo text, p_texto text,
  p_solicitacao uuid, p_embarque uuid, p_destino text, p_chave text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notificacoes (destinatario_id, tipo, titulo, texto, solicitacao_id, embarque_id, destino, chave)
  select p_dest, p_tipo, left(p_titulo, 200), left(p_texto, 500), p_solicitacao, p_embarque, p_destino, p_chave
  where p_dest is not null and p_dest is distinct from auth.uid()
    and exists (select 1 from public.perfis p where p.id = p_dest and p.status = 'ativo')
  on conflict (destinatario_id, chave) do nothing
$$;

-- Todos que têm a permissão e enxergam a filial.
create or replace function private.avisar_permissao(p_permissao text, p_filial uuid, p_tipo text, p_titulo text, p_texto text,
  p_solicitacao uuid, p_embarque uuid, p_destino text, p_chave text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.perfis p
     where p.status = 'ativo' and private.perfil_pode(p.id, p_permissao) and private.perfil_ve_filial(p.id, p_filial)
  loop
    perform private.avisar(v_id, p_tipo, p_titulo, p_texto, p_solicitacao, p_embarque, p_destino, p_chave);
  end loop;
end $$;

create or replace function private.rotulo_solicitacao(s public.solicitacoes_doc)
returns text
language sql
immutable
as $$
  select case s.tipo when 'lote_emissao' then 'Lote e Emissão' when 'emissao' then 'Emissão'
                     when 'cadastro' then 'Cadastro' else 'Estadia' end
    || ' nº ' || s.numero || ' · ' || substr(s.placa, 1, 3) || '-' || substr(s.placa, 4)
$$;

-- Onde o solicitante acompanha o pedido.
create or replace function private.destino_solicitante(s public.solicitacoes_doc)
returns text
language sql
immutable
as $$
  select case s.tipo when 'cadastro' then 'cadastro' when 'estadia' then 'estadia' else 'embarque' end
$$;

create or replace function private.filial_solicitacao(s public.solicitacoes_doc)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(s.filial_id, (select e.filial_id from public.embarques e where e.id = s.embarque_id))
$$;

-- ---------------------------------------------------------------------------
-- 4. Avisos das solicitações (fila nova, assumida, cancelada) pelo registro de eventos do fluxo
-- ---------------------------------------------------------------------------
create or replace function private.avisos_evento_solicitacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_rot text;
begin
  if new.evento not in ('enviado', 'assumido', 'cancelado') then return null; end if;
  select * into s from public.solicitacoes_doc where id = new.solicitacao_id;
  if not found then return null; end if;
  if s.embarque_id is not null and exists (select 1 from public.embarques e where e.id = s.embarque_id and e.is_demo) then return null; end if;
  v_rot := private.rotulo_solicitacao(s);

  if new.evento = 'enviado' then
    perform private.avisar_permissao('avisos.fila_nova', private.filial_solicitacao(s), 'fila_nova',
      'Nova na fila: ' || split_part(v_rot, ' nº', 1), v_rot || ' · enviada por ' || s.solicitante_nome,
      s.id, s.embarque_id, 'apoio', 'fila_nova:' || s.id);
  elsif new.evento = 'assumido' then
    perform private.avisar(s.solicitante_id, 'solicitacao_assumida', 'Pedido assumido pelo apoio',
      v_rot || ' · ' || coalesce(s.responsavel_nome, new.ator_nome) || ' começou o atendimento',
      s.id, s.embarque_id, private.destino_solicitante(s), 'assumida:' || new.id);
  elsif new.evento = 'cancelado' and s.tipo <> 'cadastro' then
    -- Cadastro cancelado já avisa pelo tipo cadastro_cancelado (migração 4500).
    perform private.avisar(s.solicitante_id, 'solicitacao_cancelada', split_part(v_rot, ' nº', 1) || ' cancelada',
      v_rot || ' · ' || coalesce(s.cancelado_por_nome, new.ator_nome) || ': ' || coalesce(left(s.cancelado_motivo, 160), 'sem motivo'),
      s.id, s.embarque_id, private.destino_solicitante(s), 'cancelada:' || new.id);
    perform private.avisar(s.responsavel_id, 'solicitacao_cancelada', split_part(v_rot, ' nº', 1) || ' cancelada',
      v_rot || ' · ' || coalesce(s.cancelado_por_nome, new.ator_nome) || ': ' || coalesce(left(s.cancelado_motivo, 160), 'sem motivo'),
      s.id, s.embarque_id, 'apoio', 'cancelada:' || new.id);
  end if;
  return null;
exception when others then
  -- Aviso nunca pode impedir o atendimento.
  raise warning 'avisos_evento_solicitacao: %', sqlerrm;
  return null;
end $$;

drop trigger if exists avisos_evento on public.solicitacao_eventos;
create trigger avisos_evento after insert on public.solicitacao_eventos
  for each row execute function private.avisos_evento_solicitacao();

-- ---------------------------------------------------------------------------
-- 5. Prazo estourado (a cada 5 min). Mesma regra das cores da fila: prazo + 5 min de tolerância.
--    Cadastro 30 min, Emissão e Lote e Emissão 20 min, Estadia 96 h. Só avisa até 1 h depois de estourar,
--    para não disparar avisos antigos de uma vez.
-- ---------------------------------------------------------------------------
create or replace function private.avisar_prazos_fila()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n integer := 0;
  v_rot text;
  v_texto text;
  v_chave text;
begin
  for r in
    select s, f.desde, f.prazo
      from public.solicitacoes_doc s
      cross join lateral (
        select coalesce((select max(ev.criado_em) from public.solicitacao_eventos ev
                          where ev.solicitacao_id = s.id and ev.status_novo = s.status), s.enviado_em) as desde,
               case s.tipo when 'cadastro' then interval '30 minutes' when 'estadia' then interval '96 hours'
                           else interval '20 minutes' end as prazo) f
     where s.status in ('enviado', 'correcao_recebida')
       and f.desde + f.prazo + interval '5 minutes' <= now()
       and f.desde + f.prazo + interval '5 minutes' > now() - interval '1 hour'
       and not exists (select 1 from public.embarques e where e.id = s.embarque_id and e.is_demo)
  loop
    v_rot := private.rotulo_solicitacao(r.s);
    v_texto := v_rot || ' · na fila desde ' || to_char(r.desde at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      || case when (r.s).responsavel_id is null then ' · ninguém assumiu' else ' · com ' || (r.s).responsavel_nome end;
    v_chave := 'prazo:' || (r.s).id || ':' || floor(extract(epoch from r.desde))::bigint;
    if (r.s).responsavel_id is null then
      perform private.avisar_permissao('avisos.fila_nova', private.filial_solicitacao(r.s), 'prazo_estourado',
        'Prazo estourado: ' || split_part(v_rot, ' nº', 1), v_texto, (r.s).id, (r.s).embarque_id, 'apoio', v_chave);
    else
      perform private.avisar((r.s).responsavel_id, 'prazo_estourado', 'Prazo estourado: ' || split_part(v_rot, ' nº', 1),
        v_texto, (r.s).id, (r.s).embarque_id, 'apoio', v_chave);
    end if;
    perform private.avisar_permissao('avisos.prazo', private.filial_solicitacao(r.s), 'prazo_estourado',
      'Prazo estourado: ' || split_part(v_rot, ' nº', 1), v_texto, (r.s).id, (r.s).embarque_id, 'apoio', v_chave);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Agendamento só onde existe pg_cron (Supabase); o banco local de testes não tem.
do $agenda$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'travion-avisos-prazo';
  perform cron.schedule('travion-avisos-prazo', '*/5 * * * *', 'select private.avisar_prazos_fila()');
end $agenda$;

-- ---------------------------------------------------------------------------
-- 6. Embarques: novo liberado e mudança de estado (pelo histórico de estados, migração 3350)
-- ---------------------------------------------------------------------------
create or replace function private.avisos_estado_embarque()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.embarques;
  v_ant text;
  v_desc text;
  v_titulo text;
  v_texto text;
  v_quem text := coalesce(new.usuario_nome, 'Sistema');
begin
  if new.origem is distinct from 'gatilho' then return null; end if;
  select * into e from public.embarques where id = new.embarque_id;
  if not found or e.is_demo then return null; end if;
  select estado into v_ant from public.embarques_estados
   where embarque_id = new.embarque_id and id <> new.id order by desde desc, id desc limit 1;
  v_desc := '#' || e.codigo || ' · ' || coalesce((select c.nome from public.clientes c where c.id = e.cliente_id), 'Cliente')
    || ' · ' || e.origem_cidade || coalesce('-' || e.origem_uf, '') || ' → ' || e.destino_cidade || coalesce('-' || e.destino_uf, '');

  if v_ant is null then
    if new.estado = 'liberado' then
      perform private.avisar_permissao('avisos.embarque_novo', e.filial_id, 'embarque_novo', 'Novo embarque liberado',
        v_desc || ' · por ' || v_quem, null, e.id, 'lista', 'embarque_novo:' || e.id);
    end if;
    return null;
  end if;
  if v_ant = new.estado then return null; end if;

  v_titulo := case new.estado when 'suspenso' then 'Embarque suspenso' when 'encerrado' then 'Embarque encerrado'
                              else 'Embarque reativado' end;
  v_texto := v_desc || ' · ' || v_quem
    || case when new.estado = 'encerrado' and e.encerrado_motivo is not null then ': ' || left(e.encerrado_motivo, 160) else '' end;
  perform private.avisar(e.criado_por, 'embarque_estado', v_titulo, v_texto, null, e.id, 'lista', 'embarque_estado:' || new.id);
  perform private.avisar_permissao('avisos.embarque_estado', e.filial_id, 'embarque_estado', v_titulo, v_texto,
    null, e.id, 'lista', 'embarque_estado:' || new.id);
  return null;
exception when others then
  raise warning 'avisos_estado_embarque: %', sqlerrm;
  return null;
end $$;

drop trigger if exists avisos_estado on public.embarques_estados;
create trigger avisos_estado after insert on public.embarques_estados
  for each row execute function private.avisos_estado_embarque();

-- ---------------------------------------------------------------------------
-- 7. WhatsApp: cada aviso dos tipos abaixo vai ao n8n, que envia pela Z-API
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('vault.secrets') is null then return; end if;
  if not exists (select 1 from vault.secrets where name = 'travion_n8n_whatsapp_url') then
    perform vault.create_secret('https://n8n-0apl.srv2096548.hstgr.cloud/webhook/travion-avisos-whatsapp',
      'travion_n8n_whatsapp_url', 'Webhook do n8n que envia os avisos do Travion pelo WhatsApp (Z-API)');
  end if;
end $$;

create or replace function private.avisos_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.perfis;
  v_tel text;
  v_url text;
  v_token text;
  v_link text;
  v_base text := 'https://travion-transporte-vis-o-integra-o-ten.vercel.app/#';
begin
  if new.tipo not in ('solicitacao_cancelada', 'prazo_estourado', 'embarque_estado', 'ajuste_solicitado',
                      'documentacao_disponivel', 'resposta_enviada', 'cadastro_cancelado') then
    return null;
  end if;
  select * into p from public.perfis where id = new.destinatario_id;
  if not found or p.status <> 'ativo' or not p.whatsapp_avisos then return null; end if;
  v_tel := regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g');
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if length(v_tel) not in (12, 13) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'travion_n8n_whatsapp_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'travion_n8n_auditoria_token';
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then return null; end if;
  v_link := v_base || case new.destino
    when 'apoio' then '/apoio/' || new.solicitacao_id
    when 'cadastro' then '/cadastro?s=' || new.solicitacao_id
    when 'estadia' then '/estadia/consultar?s=' || new.solicitacao_id
    when 'lista' then '/?emb=' || new.embarque_id
    else '/?emb=' || new.embarque_id || '&doc=' || new.solicitacao_id end;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notificacao_id', new.id, 'telefone', v_tel, 'nome', split_part(p.nome, ' ', 1),
      'titulo', new.titulo, 'texto', new.texto, 'link', v_link),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-travion-token', v_token),
    timeout_milliseconds := 10000);
  update public.notificacoes set whatsapp_pedido_em = now() where id = new.id;
  return null;
exception when others then
  raise warning 'avisos_whatsapp: %', sqlerrm;
  return null;
end $$;

drop trigger if exists avisos_whatsapp on public.notificacoes;
create trigger avisos_whatsapp after insert on public.notificacoes
  for each row execute function private.avisos_whatsapp();

-- ---------------------------------------------------------------------------
-- 8. Administração → Usuários: ligar/desligar o WhatsApp de cada pessoa (decisão de 11/11: o admin escolhe)
-- ---------------------------------------------------------------------------
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
  v_centros uuid[];
begin
  perform private.exigir('usuarios.gerenciar');
  select * into r from public.perfis where id = p_perfil_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Usuário não encontrado.';
  end if;
  for k in select jsonb_object_keys(p_dados) loop
    -- 'filiais' fica só por compatibilidade (escopo direto, sem centro de custo); o app usa 'centros'.
    if not (k = any (array['nome', 'telefone', 'papel', 'status', 'centros', 'filiais', 'permissoes', 'whatsapp_avisos'])) then
      raise exception using errcode = '22023', message = format('Campo "%s" não reconhecido.', k);
    end if;
  end loop;
  if (p_dados ? 'papel' and p_dados ->> 'papel' = 'administrador' or r.papel = 'administrador') and not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores podem conceder ou alterar acesso de administrador.';
  end if;

  n := jsonb_populate_record(r, p_dados - 'centros' - 'filiais' - 'permissoes');
  if r.papel = 'administrador' and r.status = 'ativo' and (n.papel <> 'administrador' or n.status <> 'ativo')
     and (select count(*) from public.perfis where papel = 'administrador' and status = 'ativo') <= 1 then
    raise exception using errcode = '55000', message = 'Não é possível remover o último administrador ativo.';
  end if;
  if r.id = auth.uid() and n.status <> 'ativo' then
    raise exception using errcode = '55000', message = 'Você não pode bloquear o seu próprio acesso.';
  end if;
  if n.whatsapp_avisos and length(regexp_replace(coalesce(n.telefone, ''), '\D', '', 'g')) not between 10 and 13 then
    raise exception using errcode = '22023', message = 'Para receber avisos no WhatsApp, informe o celular com DDD.';
  end if;

  update public.perfis set
    nome = n.nome, telefone = nullif(left(trim(coalesce(n.telefone, '')), 40), ''), papel = n.papel, status = n.status, comercial_id = null,
    whatsapp_avisos = coalesce(n.whatsapp_avisos, false), atualizado_em = now(),
    aprovado_por = case when r.status = 'pendente' and n.status = 'ativo' then auth.uid() else aprovado_por end,
    aprovado_em = case when r.status = 'pendente' and n.status = 'ativo' then now() else aprovado_em end
  where id = r.id returning * into n;

  for k in select unnest(array['nome', 'telefone', 'papel', 'status', 'whatsapp_avisos']) loop
    if (to_jsonb(r) -> k) is distinct from (to_jsonb(n) -> k) then
      perform private.registrar('usuario', r.id, null, null, null, null, k,
        private.json_texto(to_jsonb(r) -> k), private.json_texto(to_jsonb(n) -> k));
    end if;
  end loop;

  if p_dados ? 'centros' then
    select coalesce(array_agg(x::uuid order by x), '{}') into v_centros from jsonb_array_elements_text(p_dados -> 'centros') x;
    if exists (select 1 from unnest(v_centros) c where not exists (select 1 from public.centros_custo cc where cc.id = c)) then
      raise exception using errcode = '22023', message = 'Centro de custo não encontrado.';
    end if;
    select string_agg(c.nome, ', ' order by c.nome) into v_ant
      from public.perfil_centros pc join public.centros_custo c on c.id = pc.centro_custo_id where pc.perfil_id = r.id;
    delete from public.perfil_centros where perfil_id = r.id and centro_custo_id <> all (v_centros);
    insert into public.perfil_centros (perfil_id, centro_custo_id) select r.id, unnest(v_centros) on conflict do nothing;
    perform private.sincronizar_escopo(r.id);
    if v_ant is distinct from (select string_agg(c.nome, ', ' order by c.nome) from public.centros_custo c where c.id = any (v_centros)) then
      perform private.registrar('usuario', r.id, null, null, null, null, 'centros_custo', v_ant,
        (select string_agg(c.nome, ', ' order by c.nome) from public.centros_custo c where c.id = any (v_centros)));
    end if;
  end if;

  if p_dados ? 'filiais' and not (p_dados ? 'centros') then
    delete from public.perfil_centros where perfil_id = r.id;
    delete from public.perfil_filiais where perfil_id = r.id;
    insert into public.perfil_filiais (perfil_id, filial_id)
    select r.id, x::uuid from jsonb_array_elements_text(p_dados -> 'filiais') x on conflict do nothing;
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

revoke all on function private.perfil_pode(uuid, text), private.perfil_ve_filial(uuid, uuid),
  private.avisar(uuid, text, text, text, uuid, uuid, text, text),
  private.avisar_permissao(text, uuid, text, text, text, uuid, uuid, text, text),
  private.avisar_prazos_fila(), private.avisos_evento_solicitacao(), private.avisos_estado_embarque(), private.avisos_whatsapp()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
