-- Inativar e excluir usuário (pedido de 28/10/2026): por padrão só o administrador.
-- As permissões ficam no catálogo (Administração → Permissões) sem nenhuma função marcada; o administrador tem todas.
--   * Inativar: situação "bloqueado" (rótulo Inativo no app). A pessoa não entra mais; tudo o que ela fez continua no histórico.
--     Vale também para reativar. Conferido num gatilho, valha a mudança por qual caminho vier.
--   * Excluir: apaga o usuário de vez, só se ele ainda não tiver nada registrado no app (embarques, posições, demandas,
--     histórico...). Com registros, o app pede para inativar: assim não se perde quem fez o quê.

insert into public.permissoes (chave, grupo, descricao) values
  ('usuarios.inativar', 'Administração', 'Inativar e reativar usuários'),
  ('usuarios.excluir', 'Administração', 'Excluir usuários que ainda não têm registros no app')
on conflict do nothing;

create or replace function private.ao_mudar_situacao_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem login (rotinas do servidor) não confere; pendente → ativo é aprovação, não inativação.
  if auth.uid() is not null and new.status is distinct from old.status
     and 'bloqueado' in (old.status::text, new.status::text) and not private.tem_permissao('usuarios.inativar') then
    raise exception using errcode = '42501', message = 'Somente o administrador pode inativar ou reativar usuários.';
  end if;
  return new;
end $$;

drop trigger if exists situacao_usuario on public.perfis;
create trigger situacao_usuario before update of status on public.perfis
  for each row execute function private.ao_mudar_situacao_usuario();

-- Confere (p_aplicar = false) ou exclui (true) o perfil. O login (auth) é apagado depois pela função excluir-usuario.
create or replace function public.excluir_usuario(p_perfil_id uuid, p_aplicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.perfis;
  fk record;
  v_tem boolean;
begin
  perform private.exigir('usuarios.excluir');
  select * into r from public.perfis where id = p_perfil_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Usuário não encontrado.';
  end if;
  if r.id = auth.uid() then
    raise exception using errcode = '55000', message = 'Você não pode excluir o seu próprio usuário.';
  end if;
  if r.papel = 'administrador' and r.status = 'ativo'
     and (select count(*) from public.perfis where papel = 'administrador' and status = 'ativo') <= 1 then
    raise exception using errcode = '55000', message = 'Não é possível excluir o último administrador ativo.';
  end if;

  -- Qualquer registro que aponte para o usuário (exceto o próprio acesso, que sai junto) impede a exclusão.
  v_tem := exists (select 1 from public.historico_alteracoes h where h.usuario_id = r.id);
  for fk in
    select c.conrelid::regclass as tabela, a.attname as coluna
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.perfis'::regclass and c.confdeltype <> 'c'
  loop
    exit when v_tem;
    execute format('select exists (select 1 from %s where %I = $1)', fk.tabela, fk.coluna) into v_tem using r.id;
  end loop;
  if v_tem then
    raise exception using errcode = '55000',
      message = 'Este usuário já tem registros no app (embarques, posições, demandas ou histórico). Para manter quem fez o quê, use Inativar.';
  end if;

  if p_aplicar then
    perform private.registrar('usuario', r.id, null, null, null, null, 'excluido',
      format('%s (%s, %s)', r.nome, r.email, r.papel), null);
    delete from public.convites where lower(email) = lower(r.email);
    delete from public.perfis where id = r.id;
  end if;
  return jsonb_build_object('id', r.id, 'email', r.email, 'nome', r.nome);
end $$;

revoke all on function private.ao_mudar_situacao_usuario() from public, anon, authenticated;
revoke all on function public.excluir_usuario(uuid, boolean) from public, anon;
grant execute on function public.excluir_usuario(uuid, boolean) to authenticated;
