-- Quadro "Tempo de fila por operação" do Dashboard Embarques (pedido de 29/10/2026): além dos chamados aguardando na
-- fila, mostra quantos estão em atendimento agora. A função passa a devolver também os chamados "em_atendimento"
-- (sem nomes, como antes); o "mais antigo aguardando" continua contando só os que esperam o apoio.

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
     where s.status in ('enviado', 'correcao_recebida', 'em_atendimento')
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
