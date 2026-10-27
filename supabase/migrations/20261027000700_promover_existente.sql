-- Usuários criados no Supabase antes do Travion (ex.: por outro sistema no mesmo projeto) não têm perfil.
-- A promoção passa a criar o perfil quando ele não existir.
create or replace function private.promover_administrador(p_email text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.perfis (id, email, nome, papel, status, aprovado_em)
  select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'nome', u.raw_user_meta_data ->> 'full_name', ''),
         'administrador', 'ativo', now()
  from auth.users u where lower(u.email) = lower(p_email)
  on conflict (id) do update set papel = 'administrador', status = 'ativo', aprovado_em = now()
  returning id into v_id;
  if v_id is null then
    return 'Nenhum usuário com este e-mail. Peça para a pessoa criar a conta primeiro.';
  end if;
  return 'Usuário promovido a administrador.';
end $$;
revoke all on function private.promover_administrador(text) from public, anon, authenticated;
