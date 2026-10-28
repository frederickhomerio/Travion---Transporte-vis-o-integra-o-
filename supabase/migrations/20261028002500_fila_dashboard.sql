-- Quadro "Tempo de fila por operação" no Dashboard Embarques (pedido de 28/10/2026): quem envia demandas ao Apoio
-- (embarcador, supervisor, coordenador...) acompanha a fila de documentos, cadastro e estadia, sem abrir o Painel Operacional.
-- A fila é a do Apoio inteiro (todas as filiais), sem nomes: só tipo, situação, horário de envio e eventos de fila.
-- Também ajusta textos de permissões que citavam a carteira do usuário (o acesso agora é pelo centro de custo, migração 2400).

insert into public.permissoes (chave, grupo, descricao) values
  ('analise.fila', 'Análise', 'Ver o tempo de fila do Apoio (Cadastro, Emissão e Estadia) no Dashboard Embarques')
on conflict do nothing;

insert into public.papel_permissoes (papel, chave) values
  ('gestor', 'analise.fila'), ('supervisor', 'analise.fila'), ('embarcador', 'analise.fila'),
  ('comercial', 'analise.fila'), ('apoio', 'analise.fila'), ('operacao', 'analise.fila')
on conflict do nothing;

update public.permissoes set descricao = 'Acompanhar os cadastros do seu centro de custo (os próprios sempre aparecem)' where chave = 'cadastro.ver';
update public.permissoes set descricao = 'Consultar as estadias do seu centro de custo, além das próprias' where chave = 'estadia.ver';

create or replace function public.fila_apoio()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform private.exigir('analise.fila');
  with base as (
    select s.id, s.numero, s.tipo, s.status, null::text as filial_id, null::text as centro_custo_id,
           null::uuid as solicitante_id, '' as solicitante_nome, null::uuid as responsavel_id, null::text as responsavel_nome, s.enviado_em
      from public.solicitacoes_doc s
     where s.status in ('enviado', 'correcao_recebida')
  )
  select jsonb_build_object(
    'agora', clock_timestamp(),
    'solicitacoes', coalesce((select jsonb_agg(to_jsonb(b) order by b.enviado_em) from base b), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('s', e.solicitacao_id, 'evento', e.evento, 'em', e.criado_em,
               'responsavel_id', null, 'responsavel_nome', null, 'motivo', null, 'origem', e.origem)
             order by e.criado_em, e.id)
        from public.solicitacao_eventos e join base b on b.id = e.solicitacao_id), '[]'::jsonb))
  into v;
  return v;
end $$;

revoke all on function public.fila_apoio() from public, anon;
grant execute on function public.fila_apoio() to authenticated;
