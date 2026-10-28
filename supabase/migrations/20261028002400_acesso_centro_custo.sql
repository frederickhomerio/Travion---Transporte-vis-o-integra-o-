-- Acesso por centro de custo (pedido de 28/10/2026).
-- O usuário passa a ser ligado a centros de custo (conjuntos de filiais), não a filiais soltas.
-- Centro de Custo Gerencial: acesso a todas as filiais (Apoio Operacional, Coordenadores, Gestor e Administrador).
-- A carteira deixa de ser ligada ao usuário: ela só liga os clientes ao comercial.
-- Como funciona: perfil_centros guarda a escolha; perfil_filiais continua sendo o escopo conferido em todas as regras
-- e passa a ser preenchido sozinho a partir dos centros (inclusive quando uma filial muda de centro).
-- Não apaga embarques, posições nem demandas; desfaz só o vínculo de carteira dos usuários.

alter table public.centros_custo add column if not exists acesso_total boolean not null default false;
comment on column public.centros_custo.acesso_total is 'Centro de custo que dá acesso a todas as filiais (Gerencial).';

insert into public.centros_custo (nome, acesso_total) values ('Gerencial', true)
on conflict (nome_busca, is_demo) do update set acesso_total = true, ativo = true;

create table if not exists public.perfil_centros (
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  centro_custo_id uuid not null references public.centros_custo (id) on delete cascade,
  primary key (perfil_id, centro_custo_id)
);
alter table public.perfil_centros enable row level security;
revoke all on public.perfil_centros from public, anon, authenticated;
grant select on public.perfil_centros to authenticated;
create policy leitura on public.perfil_centros for select to authenticated
  using (perfil_id = auth.uid() or private.tem_permissao('usuarios.gerenciar'));

alter table public.convites add column if not exists centros uuid[] not null default '{}';

-- Escopo de filiais de um usuário a partir dos centros de custo.
create or replace function private.sincronizar_escopo(p_perfil_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.perfil_filiais where perfil_id = p_perfil_id;
  if exists (select 1 from public.perfil_centros pc join public.centros_custo c on c.id = pc.centro_custo_id
             where pc.perfil_id = p_perfil_id and c.acesso_total) then
    insert into public.perfil_filiais (perfil_id, filial_id) select p_perfil_id, f.id from public.filiais f;
  else
    insert into public.perfil_filiais (perfil_id, filial_id)
    select distinct p_perfil_id, f.id from public.filiais f
    join public.perfil_centros pc on pc.centro_custo_id = f.centro_custo_id and pc.perfil_id = p_perfil_id;
  end if;
end $$;

create or replace function private.ao_mudar_perfil_centros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.sincronizar_escopo(coalesce(new.perfil_id, old.perfil_id));
  return null;
end $$;
drop trigger if exists sincronizar_escopo on public.perfil_centros;
create trigger sincronizar_escopo after insert or delete on public.perfil_centros
  for each row execute function private.ao_mudar_perfil_centros();

-- Filial nova ou trocada de centro: refaz o escopo de quem é afetado.
create or replace function private.ao_mudar_filial_centro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p uuid;
begin
  for p in select distinct pc.perfil_id from public.perfil_centros pc join public.centros_custo c on c.id = pc.centro_custo_id
           where c.acesso_total or pc.centro_custo_id = new.centro_custo_id
              or (tg_op = 'UPDATE' and pc.centro_custo_id = old.centro_custo_id) loop
    perform private.sincronizar_escopo(p);
  end loop;
  return null;
end $$;
drop trigger if exists sincronizar_escopo on public.filiais;
create trigger sincronizar_escopo after insert or update of centro_custo_id on public.filiais
  for each row execute function private.ao_mudar_filial_centro();

-- Dados atuais: quem é do Apoio, Coordenador, Gestor ou Administrador vai para o Gerencial;
-- os demais ficam com os centros das filiais que já tinham.
insert into public.perfil_centros (perfil_id, centro_custo_id)
select p.id, c.id from public.perfis p
cross join (select id from public.centros_custo where acesso_total and not is_demo order by criado_em limit 1) c
where p.papel in ('apoio', 'comercial', 'gestor', 'administrador')
on conflict do nothing;
insert into public.perfil_centros (perfil_id, centro_custo_id)
select distinct pf.perfil_id, f.centro_custo_id from public.perfil_filiais pf
join public.filiais f on f.id = pf.filial_id
join public.perfis p on p.id = pf.perfil_id
where f.centro_custo_id is not null and p.papel not in ('apoio', 'comercial', 'gestor', 'administrador')
on conflict do nothing;
do $$ declare p uuid; begin
  for p in select id from public.perfis loop perform private.sincronizar_escopo(p); end loop;
end $$;

-- Carteira deixa de ser ligada ao usuário.
update public.perfis set comercial_id = null where comercial_id is not null;
update public.convites set comercial_id = null where comercial_id is not null;

-- Novo usuário: aplica o convite (função e centros de custo).
create or replace function private.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cv public.convites;
  c uuid;
  k text;
  v jsonb;
begin
  select * into cv from public.convites
  where lower(email) = lower(new.email) and usado_em is null and expira_em > now()
  order by criado_em desc limit 1;

  insert into public.perfis (id, email, nome, papel, status, aprovado_por, aprovado_em)
  values (new.id, new.email,
          coalesce(cv.nome, new.raw_user_meta_data ->> 'nome', new.raw_user_meta_data ->> 'full_name', ''),
          coalesce(cv.papel, 'consulta'),
          case when cv.id is not null then 'ativo'::public.status_usuario else 'pendente'::public.status_usuario end,
          cv.criado_por, case when cv.id is not null then now() end)
  on conflict (id) do nothing;

  if cv.id is not null then
    -- Convites antigos guardavam filiais: vira o centro de custo de cada uma.
    foreach c in array (case when cardinality(cv.centros) > 0 then cv.centros
                        else coalesce((select array_agg(distinct f.centro_custo_id) from public.filiais f
                                       where f.id = any (cv.filiais) and f.centro_custo_id is not null), '{}') end) loop
      insert into public.perfil_centros (perfil_id, centro_custo_id) values (new.id, c) on conflict do nothing;
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

create or replace function public.criar_convite(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.convites;
  v_centros uuid[];
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
  select coalesce(array_agg(x::uuid), '{}') into v_centros from jsonb_array_elements_text(coalesce(p_dados -> 'centros', '[]')) x;
  if cardinality(v_centros) = 0 and p_dados ->> 'papel' <> 'administrador' then
    raise exception using errcode = '22023', message = 'Escolha ao menos um centro de custo.';
  end if;
  if exists (select 1 from unnest(v_centros) c where not exists (select 1 from public.centros_custo cc where cc.id = c)) then
    raise exception using errcode = '22023', message = 'Centro de custo não encontrado.';
  end if;
  delete from public.convites where lower(email) = lower(p_dados ->> 'email') and usado_em is null;
  insert into public.convites (email, nome, papel, centros, permissoes, criado_por)
  values (lower(trim(p_dados ->> 'email')), p_dados ->> 'nome', (p_dados ->> 'papel')::public.papel_usuario,
          v_centros, coalesce(p_dados -> 'permissoes', '{}'), auth.uid())
  returning * into n;
  perform private.registrar('usuario', n.id, null, null, null, null, 'convite', null,
    format('%s convidado como %s', n.email, n.papel));
  return to_jsonb(n);
end $$;

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
    if not (k = any (array['nome', 'papel', 'status', 'centros', 'filiais', 'permissoes'])) then
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

  update public.perfis set
    nome = n.nome, papel = n.papel, status = n.status, comercial_id = null, atualizado_em = now(),
    aprovado_por = case when r.status = 'pendente' and n.status = 'ativo' then auth.uid() else aprovado_por end,
    aprovado_em = case when r.status = 'pendente' and n.status = 'ativo' then now() else aprovado_em end
  where id = r.id returning * into n;

  for k in select unnest(array['nome', 'papel', 'status']) loop
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

revoke all on function private.sincronizar_escopo(uuid), private.ao_mudar_perfil_centros(), private.ao_mudar_filial_centro() from public, anon, authenticated;
