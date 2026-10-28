-- Permissões por usuário (pedido de 28/10/2026): em Administração → Permissões, escolher o usuário e marcar o que ele pode.
-- Acesso: Administrador e Gestor (nova permissão permissoes.gerenciar, ajustável na matriz por função).
-- Só acrescenta permissão e funções; não apaga dados.

insert into public.permissoes (chave, grupo, descricao) values
  ('permissoes.gerenciar', 'Administração', 'Definir as permissões de cada usuário em Administração → Permissões')
on conflict do nothing;
insert into public.papel_permissoes (papel, chave) values ('gestor', 'permissoes.gerenciar') on conflict do nothing;

-- Lista de usuários com as permissões individuais (exceções ao padrão da função).
create or replace function public.listar_permissoes_usuarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('permissoes.gerenciar');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'email', p.email, 'papel', p.papel, 'status', p.status,
      'permissoes', coalesce((select jsonb_object_agg(pp.chave, pp.permitido) from public.perfil_permissoes pp where pp.perfil_id = p.id), '{}'::jsonb))
      order by lower(coalesce(nullif(p.nome, ''), p.email)))
    from public.perfis p), '[]'::jsonb);
end $$;

-- Grava as permissões individuais de um usuário. true = permitir, false = negar, null = voltar ao padrão da função.
-- Quem não é administrador: não altera administradores nem a si mesmo, só concede o que também tem,
-- e não concede o acesso a esta tela nem à gestão de usuários.
create or replace function public.salvar_permissoes_usuario(p_perfil_id uuid, p_permissoes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.perfis;
  k text;
  v jsonb;
  v_ant text;
  v_admin boolean := private.eh_admin();
begin
  perform private.exigir('permissoes.gerenciar');
  select * into r from public.perfis where id = p_perfil_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Usuário não encontrado.'; end if;
  if r.papel = 'administrador' then
    raise exception using errcode = '22023', message = 'Administrador já tem todas as permissões.';
  end if;
  if r.id = auth.uid() and not v_admin then
    raise exception using errcode = '42501', message = 'Você não pode alterar as suas próprias permissões.';
  end if;
  if jsonb_typeof(coalesce(p_permissoes, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Nenhuma alteração informada.';
  end if;
  for k, v in select * from jsonb_each(p_permissoes) loop
    if not exists (select 1 from public.permissoes where chave = k) then
      raise exception using errcode = '22023', message = format('Permissão "%s" não existe.', k);
    end if;
    if jsonb_typeof(v) not in ('boolean', 'null') then
      raise exception using errcode = '22023', message = format('Valor inválido para "%s".', k);
    end if;
    if not v_admin and jsonb_typeof(v) = 'boolean' and v::text::boolean then
      if k in ('usuarios.gerenciar', 'permissoes.gerenciar') then
        raise exception using errcode = '42501', message = 'Somente administradores concedem acesso à gestão de usuários e de permissões.';
      end if;
      if not private.tem_permissao(k) then
        raise exception using errcode = '42501', message = format('Você só pode conceder permissões que você também tem (%s).', k);
      end if;
    end if;
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
  return coalesce((select jsonb_object_agg(chave, permitido) from public.perfil_permissoes where perfil_id = r.id), '{}'::jsonb);
end $$;

revoke all on function public.listar_permissoes_usuarios(), public.salvar_permissoes_usuario(uuid, jsonb) from public, anon;
grant execute on function public.listar_permissoes_usuarios(), public.salvar_permissoes_usuario(uuid, jsonb) to authenticated;
