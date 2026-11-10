-- 10/11/2026: aviso de conflito de versão passa de 40001 (PostgREST repete sem parar e esgota as conexões) para PT409 (HTTP 409, sem repetição).
do $$
declare f record; def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosrc like '%''40001''%'
  loop
    def := replace(pg_get_functiondef(f.oid), '''40001''', '''PT409''');
    execute def;
  end loop;
end $$;

-- Conferência: deve voltar 0 linhas.
select n.nspname || '.' || p.proname as ainda_com_40001
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prosrc like '%''40001''%';
