-- Testes da migração 2900: unidade de frete R$/m³.
\set QUIET on
set client_min_messages = warning;
\o /dev/null
do $$ begin
  assert 'rs_m3' = any (enum_range(null::public.unidade_frete)::text[]), 'enum com rs_m3';
  assert exists (select 1 from pg_constraint where conname = 'solicitacoes_doc_frete_empresa_unidade_check' and pg_get_constraintdef(oid) like '%rs_m3%'), 'check das solicitações';
  assert (select prosrc like '%rs_m3%' from pg_proc where proname = 'atualizar_financeiro'), 'atualizar_financeiro aceita rs_m3';
end $$;
\o
