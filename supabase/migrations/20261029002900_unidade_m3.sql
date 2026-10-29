-- Unidade de frete em metros cúbicos (R$/m³), pedido de 29/10/2026: vale no embarque (frete empresa e motorista),
-- no anúncio ("por m³") e nas solicitações de documentação. Projeções em toneladas tratam R$/m³ como R$/viagem
-- (fora da soma em R$/t).

alter type public.unidade_frete add value if not exists 'rs_m3' after 'rs_viagem';

alter table public.solicitacoes_doc drop constraint if exists solicitacoes_doc_frete_empresa_unidade_check;
alter table public.solicitacoes_doc add constraint solicitacoes_doc_frete_empresa_unidade_check
  check (frete_empresa_unidade in ('rs_tonelada', 'rs_viagem', 'rs_m3'));
alter table public.solicitacoes_doc drop constraint if exists solicitacoes_doc_frete_motorista_unidade_check;
alter table public.solicitacoes_doc add constraint solicitacoes_doc_frete_motorista_unidade_check
  check (frete_motorista_unidade in ('rs_tonelada', 'rs_viagem', 'rs_m3'));

-- atualizar_financeiro: igual à migração 0300, aceitando rs_m3.
create or replace function public.atualizar_financeiro(
  p_embarque_id uuid, p_alteracoes jsonb, p_base jsonb, p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.embarque_financeiro;
  n public.embarque_financeiro;
  e public.embarques;
  v_prep jsonb;
  v_novo jsonb;
  k text;
  v jsonb;
begin
  perform private.exigir('financeiro.ver');
  perform private.exigir('financeiro.editar');
  select * into e from public.embarques where id = p_embarque_id;
  if not found or not private.pode_ver_embarque(e.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  insert into public.embarque_financeiro (embarque_id) values (e.id) on conflict do nothing;
  select * into r from public.embarque_financeiro where embarque_id = e.id for update;

  v_prep := private.preparar_alteracoes(to_jsonb(r), p_alteracoes, p_base, p_forcar, jsonb_build_object(
    'frete_empresa',   jsonb_build_object('perm', 'financeiro.editar', 'tipo', 'dinheiro'),
    'frete_motorista', jsonb_build_object('perm', 'financeiro.editar', 'tipo', 'dinheiro'),
    'unidade_frete',   jsonb_build_object('perm', 'financeiro.editar', 'tipo', 'enum',
                                          'valores', '["nao_confirmada","rs_tonelada","rs_viagem","rs_m3","outra"]'::jsonb)));
  if jsonb_array_length(v_prep -> 'conflitos') > 0 then
    return jsonb_build_object('status', 'conflito', 'conflitos', v_prep -> 'conflitos', 'registro', to_jsonb(r));
  end if;
  v_novo := v_prep -> 'novo';
  if v_novo = '{}'::jsonb then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(r));
  end if;

  n := jsonb_populate_record(r, v_novo);
  update public.embarque_financeiro set
    frete_empresa = n.frete_empresa, frete_motorista = n.frete_motorista, unidade_frete = n.unidade_frete,
    versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid()
  where embarque_id = e.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('financeiro', e.id, e.id, null, e.cliente_id, null, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v), true);
  end loop;
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;
