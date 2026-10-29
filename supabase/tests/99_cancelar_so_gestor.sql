-- Testes da migração 3200: cancelar solicitação só com o Gestor por padrão.
\set QUIET on
set client_min_messages = warning;
\o /dev/null
do $$ begin
  assert exists (select 1 from papel_permissoes where papel = 'gestor' and chave = 'documentacao.cancelar'), 'gestor cancela';
  assert not exists (select 1 from papel_permissoes where papel in ('apoio', 'operacao') and chave = 'documentacao.cancelar'), 'apoio não cancela por padrão';
end $$;
\o
select 'cancelar_so_gestor: ok';
