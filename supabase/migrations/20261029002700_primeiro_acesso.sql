-- Situação "Convite pendente" na lista de Usuários (pedido de 29/10/2026): quem só recebeu o convite fica pendente;
-- vira Ativo depois de criar a senha e entrar pela primeira vez. Lê de auth.users só dois sinais (sem expor a senha).

create or replace function public.usuarios_primeiro_acesso()
returns table (perfil_id uuid, senha_criada boolean, primeiro_acesso_em timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('usuarios.gerenciar');
  return query
    select p.id, coalesce(u.encrypted_password, '') <> '', u.last_sign_in_at
      from public.perfis p
      join auth.users u on u.id = p.id;
end;
$$;

revoke all on function public.usuarios_primeiro_acesso() from public, anon;
grant execute on function public.usuarios_primeiro_acesso() to authenticated;
