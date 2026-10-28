-- Alterar o e-mail de entrada de um usuário (pedido de 28/10/2026), mantendo acesso, filiais e histórico.
-- Quem pode: usuarios.gerenciar; e-mail de administrador só um administrador altera.
-- Fluxo: a função de borda alterar-email-usuario chama esta função com p_aplicar = false (só confere),
-- troca o e-mail no login (auth) e chama de novo com p_aplicar = true (grava no perfil e no histórico).
-- Só acrescenta uma função; não apaga dados.

create or replace function public.alterar_email_usuario(p_perfil_id uuid, p_email text, p_aplicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.perfis;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform private.exigir('usuarios.gerenciar');
  select * into r from public.perfis where id = p_perfil_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Usuário não encontrado.';
  end if;
  if r.papel = 'administrador' and not private.eh_admin() then
    raise exception using errcode = '42501', message = 'Somente administradores podem alterar o e-mail de um administrador.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception using errcode = '22023', message = 'Informe um e-mail válido.';
  end if;
  if not p_aplicar and lower(coalesce(r.email, '')) = v_email then
    raise exception using errcode = '22023', message = 'Este já é o e-mail do usuário.';
  end if;
  if exists (select 1 from public.perfis where lower(email) = v_email and id <> r.id)
     or exists (select 1 from auth.users where lower(email) = v_email and id <> r.id) then
    raise exception using errcode = '23505', message = 'Este e-mail já é usado por outro usuário.';
  end if;
  if exists (select 1 from public.convites where lower(email) = v_email and usado_em is null) then
    raise exception using errcode = '23505', message = 'Há um convite aberto para este e-mail. Exclua o convite antes.';
  end if;

  if p_aplicar then
    if lower(coalesce(r.email, '')) <> v_email then
      update public.perfis set email = v_email, atualizado_em = now() where id = r.id;
      perform private.registrar('usuario', r.id, null, null, null, null, 'email', r.email, v_email);
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'email_anterior', r.email, 'email', v_email);
end $$;

revoke all on function public.alterar_email_usuario(uuid, text, boolean) from public, anon;
grant execute on function public.alterar_email_usuario(uuid, text, boolean) to authenticated;
