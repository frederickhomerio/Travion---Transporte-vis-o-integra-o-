-- 09/11: histórico fiel dos estados de cada embarque (Liberado, Suspenso, Encerrado), dia a dia.
-- Antes, o app só sabia o estado ATUAL (e suspenso_em é apagado na reativação), então metas de dias passados
-- mudavam quando um lote era suspenso, reativado ou encerrado depois. Agora:
--   * Tabela embarques_estados: uma linha a cada mudança de estado (desde quando vale e quem mudou). Só inclusão.
--   * Gatilho na tabela embarques grava sozinho toda mudança, venha de onde vier (app, rotina de 7 dias, SQL).
--   * Carga inicial a partir do histórico de alterações já existente (criação, status_liberacao, encerramento,
--     reativação de encerrado), conferida contra o estado atual.
-- Regra do Painel de embarques: o lote entra na meta do dia D se o estado dele no FIM do dia D (horário de Brasília)
-- era Liberado. Suspenso hoje → sai de hoje em diante; dias anteriores ficam como estavam.
-- Não apaga nada. Reexecutável.

create table if not exists public.embarques_estados (
  id bigint generated always as identity primary key,
  embarque_id uuid not null references public.embarques (id),
  estado text not null check (estado in ('liberado', 'suspenso', 'encerrado')),
  desde timestamptz not null,
  origem text not null default 'gatilho',
  usuario_nome text
);
create index if not exists embarques_estados_embarque on public.embarques_estados (embarque_id, desde);
create index if not exists embarques_estados_desde on public.embarques_estados (desde);

alter table public.embarques_estados enable row level security;
drop policy if exists leitura on public.embarques_estados;
create policy leitura on public.embarques_estados for select to authenticated
  using (private.pode_ver_embarque(embarque_id));
revoke all on public.embarques_estados from anon, authenticated;
grant select on public.embarques_estados to authenticated;

-- Estado de negócio de uma linha de embarques.
create or replace function private.estado_embarque(p_situacao text, p_status text, p_encerrado_em timestamptz)
returns text language sql immutable as $$
  select case when p_encerrado_em is not null or p_situacao = 'arquivado' then 'encerrado'
              when p_status = 'suspenso' then 'suspenso'
              else 'liberado' end
$$;

-- Só inclusão: alteração e exclusão bloqueadas.
create or replace function private.embarques_estados_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception using errcode = '42501', message = 'O histórico de estados dos embarques não pode ser alterado nem apagado.';
end $$;
drop trigger if exists imutavel on public.embarques_estados;
create trigger imutavel before update or delete on public.embarques_estados
  for each row execute function private.embarques_estados_imutavel();

-- Grava a mudança de estado (inclusão e alteração do embarque).
create or replace function private.embarque_registrar_estado()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_novo text := private.estado_embarque(new.situacao, new.status_liberacao, new.encerrado_em);
  v_ultimo text;
begin
  select estado into v_ultimo from public.embarques_estados
   where embarque_id = new.id order by desde desc, id desc limit 1;
  if v_ultimo is distinct from v_novo then
    insert into public.embarques_estados (embarque_id, estado, desde, origem, usuario_nome)
    values (new.id, v_novo, now(), 'gatilho', private.nome_usuario());
  end if;
  return null;
end $$;
drop trigger if exists registrar_estado on public.embarques;
create trigger registrar_estado after insert or update of situacao, status_liberacao, encerrado_em on public.embarques
  for each row execute function private.embarque_registrar_estado();

-- Carga inicial (só para embarques que ainda não têm histórico de estados).
do $$
begin
  if exists (select 1 from public.embarques_estados) then return; end if;

  -- 1) Nascimento: Liberado na criação (todo embarque novo nasce Liberado).
  insert into public.embarques_estados (embarque_id, estado, desde, origem, usuario_nome)
  select e.id, 'liberado', e.criado_em, 'carga_inicial', null from public.embarques e;

  -- 2) Mudanças registradas no histórico de alterações.
  insert into public.embarques_estados (embarque_id, estado, desde, origem, usuario_nome)
  select h.embarque_id,
         case h.campo when 'status_liberacao' then h.valor_novo
                      when 'encerramento' then 'encerrado'
                      when 'reativacao_encerrado' then 'liberado' end,
         h.alterado_em, 'carga_inicial', h.usuario_nome
    from public.historico_alteracoes h
    join public.embarques e on e.id = h.embarque_id
   where h.entidade = 'embarque'
     and (h.campo = 'encerramento' or h.campo = 'reativacao_encerrado'
          or (h.campo = 'status_liberacao' and h.valor_novo in ('liberado', 'suspenso')));

  -- 3) Conferência: se o último estado montado não bate com o atual, registra o atual na última alteração do embarque.
  insert into public.embarques_estados (embarque_id, estado, desde, origem, usuario_nome)
  select e.id, private.estado_embarque(e.situacao, e.status_liberacao, e.encerrado_em),
         greatest(coalesce(e.encerrado_em, e.suspenso_em, e.atualizado_em, now()), u.desde), 'carga_inicial_ajuste', null
    from public.embarques e
    left join lateral (select x.estado, x.desde from public.embarques_estados x where x.embarque_id = e.id
                       order by x.desde desc, x.id desc limit 1) u on true
   where u.estado is distinct from private.estado_embarque(e.situacao, e.status_liberacao, e.encerrado_em);
end $$;
