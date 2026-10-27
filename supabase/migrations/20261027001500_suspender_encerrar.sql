-- Suspender e encerrar embarques pela Lista de Fretes (pedido de 27/10/2026).
-- Suspenso: sai da Lista de Fretes e das Posições de Embarque; volta com "Reativar" (status liberado).
--   Se ficar 7 dias suspenso sem reativação, o próprio banco encerra.
-- Encerrado: arquivado de vez, com quem/quando/motivo. Não pode mais ser reativado nem alterado.
--   Só gestor e administrador (permissão nova embarques.encerrar).

insert into public.permissoes (chave, grupo, descricao) values
  ('embarques.encerrar', 'Embarques', 'Encerrar embarque definitivamente (sem reativação)')
on conflict do nothing;
insert into public.papel_permissoes (papel, chave) values ('gestor', 'embarques.encerrar') on conflict do nothing;

alter table public.embarques
  add column if not exists suspenso_em timestamptz,
  add column if not exists encerrado_em timestamptz,
  add column if not exists encerrado_por uuid references public.perfis (id),
  add column if not exists encerrado_por_nome text,
  add column if not exists encerrado_motivo text;

-- Embarques já suspensos começam a contar os 7 dias agora.
update public.embarques set suspenso_em = now() where status_liberacao = 'suspenso' and suspenso_em is null;

create index if not exists embarques_suspensos_idx on public.embarques (suspenso_em)
  where status_liberacao = 'suspenso' and encerrado_em is null;

-- Marca a data da suspensão e protege o encerramento, valha a gravação de onde vier.
create or replace function private.embarque_suspensao_encerramento()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.encerrado_em is not null then
    raise exception using errcode = '55000', message = 'Embarque encerrado: não pode ser reativado nem alterado.';
  end if;
  if new.status_liberacao = 'suspenso' and old.status_liberacao is distinct from 'suspenso' then
    new.suspenso_em := now();
  elsif new.status_liberacao is distinct from 'suspenso' then
    new.suspenso_em := null;
  end if;
  return new;
end $$;

drop trigger if exists embarques_suspensao_encerramento on public.embarques;
create trigger embarques_suspensao_encerramento
  before update on public.embarques
  for each row execute function private.embarque_suspensao_encerramento();

-- Uso interno: encerra um embarque, grava os dados do encerramento e o histórico.
create or replace function private.encerrar(r public.embarques, p_motivo text)
returns public.embarques
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.embarques;
begin
  update public.embarques set
    situacao = 'arquivado', encerrado_em = now(), encerrado_por = auth.uid(),
    encerrado_por_nome = coalesce(private.nome_usuario(), 'Sistema'), encerrado_motivo = p_motivo,
    versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid(),
    atualizado_por_nome = coalesce(private.nome_usuario(), 'Sistema')
  where id = r.id
  returning * into n;
  perform private.registrar('embarque', r.id, r.id, null, r.cliente_id, null, 'encerramento',
    case when r.status_liberacao = 'suspenso' then 'Suspenso' else 'Ativo' end,
    'Encerrado' || coalesce(': ' || p_motivo, ''));
  return n;
end $$;

create or replace function public.encerrar_embarque(p_embarque_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.embarques;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  perform private.exigir('embarques.encerrar');
  select * into r from public.embarques where id = p_embarque_id for update;
  if not found or not private.pode_ver_embarque(r.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  if r.encerrado_em is not null then
    raise exception using errcode = '55000', message = 'Embarque já encerrado.';
  end if;
  if length(v_motivo) > 500 then
    raise exception using errcode = '22023', message = 'Motivo muito longo (máximo de 500 caracteres).';
  end if;
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(private.encerrar(r, v_motivo)));
end $$;

-- Encerra os suspensos há mais de 7 dias. Roda de hora em hora (pg_cron) e pode ser chamada à mão.
create or replace function private.encerrar_suspensos_vencidos()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.embarques;
  v_total integer := 0;
begin
  for r in
    select * from public.embarques
    where status_liberacao = 'suspenso' and encerrado_em is null and suspenso_em <= now() - interval '7 days'
    for update skip locked
  loop
    perform private.encerrar(r, 'Suspenso há mais de 7 dias sem reativação');
    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

revoke all on function private.embarque_suspensao_encerramento() from public, anon, authenticated;
revoke all on function private.encerrar(public.embarques, text) from public, anon, authenticated;
revoke all on function private.encerrar_suspensos_vencidos() from public, anon, authenticated;
revoke all on function public.encerrar_embarque(uuid, text) from public, anon;
grant execute on function public.encerrar_embarque(uuid, text) to authenticated;

-- Agendamento só onde existe pg_cron (Supabase); o banco local de testes não tem.
do $agenda$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('travion-encerrar-suspensos', '7 * * * *', 'select private.encerrar_suspensos_vencidos()');
end $agenda$;
