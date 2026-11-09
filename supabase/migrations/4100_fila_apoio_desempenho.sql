-- Travion: correção de lentidão da fila do Apoio Operacional (09/11/2026)
-- Causa: a regra de segurança (RLS) dos anexos, mensagens, eventos etc. checava a
-- permissão do usuário UMA VEZ POR LINHA (2.300+ anexos => ~7 s, limite do banco = 8 s).
-- Correção: calcular UMA VEZ por consulta a lista de solicitações que o usuário pode ver
-- e usar essa lista em todas as regras. Mesma regra de acesso de antes, só mais rápida.
-- Não apaga nem altera dados. Pode rodar mais de uma vez.

create or replace function private.solicitacoes_visiveis()
returns setof uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with me as (
    select p.id, p.comercial_id,
           (p.status = 'ativo') as ativo,
           (p.status = 'ativo' and p.papel = 'administrador') as admin
    from public.perfis p where p.id = auth.uid()
  ),
  perm as (
    select private.tem_permissao('cadastro.ver')      as cad,
           private.tem_permissao('estadia.ver')       as est,
           private.tem_permissao('documentacao.ver')  as doc,
           private.tem_permissao('apoio.pagina')      as apoio,
           private.tem_permissao('embarques.ver')     as emb
  ),
  fil as (select pf.filial_id from public.perfil_filiais pf join me on pf.perfil_id = me.id)
  select s.id
  from public.solicitacoes_doc s cross join me cross join perm
  where case
    when s.tipo in ('cadastro', 'estadia') then
      me.ativo and (
        s.solicitante_id = me.id
        or (((s.tipo = 'cadastro' and perm.cad) or (s.tipo = 'estadia' and perm.est) or perm.apoio)
            and (me.admin
                 or (s.filial_id is not null and s.filial_id in (select filial_id from fil))
                 or (s.comercial_id is not null and me.comercial_id = s.comercial_id))))
    else
      (perm.doc or perm.apoio) and perm.emb and me.ativo and exists (
        select 1 from public.embarques e
        where e.id = s.embarque_id
          and (me.admin
               or e.filial_id in (select filial_id from fil)
               or (me.comercial_id is not null and me.comercial_id = e.comercial_id)))
  end
$$;

revoke all on function private.solicitacoes_visiveis() from public;
grant execute on function private.solicitacoes_visiveis() to authenticated;

-- Regras de leitura: mesma lógica, calculada uma vez por consulta.
alter policy leitura on public.solicitacoes_doc      using (id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.doc_anexos            using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.doc_mensagens         using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.solicitacao_eventos   using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.estadia_conferencias  using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.estadia_retornos      using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.estadia_pagamentos    using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.auditoria_participantes using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.auditoria_registros   using (solicitacao_id in (select private.solicitacoes_visiveis()));
alter policy leitura on public.notificacoes          using (destinatario_id = (select auth.uid()) and solicitacao_id in (select private.solicitacoes_visiveis()));
