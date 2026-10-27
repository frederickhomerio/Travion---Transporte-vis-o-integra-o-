-- Fixa o search_path das funções auxiliares (recomendação do verificador de segurança do Supabase).
alter function private.exigir_ativo() set search_path = public, extensions, pg_temp;
alter function private.exigir(text) set search_path = public, extensions, pg_temp;
alter function private.hash_token(text) set search_path = public, extensions, pg_temp;
alter function private.hoje_sp() set search_path = public, extensions, pg_temp;
alter function private.json_texto(jsonb) set search_path = public, extensions, pg_temp;
alter function private.normalizar(text) set search_path = public, extensions, pg_temp;
alter function private.perfil_id() set search_path = public, extensions, pg_temp;
alter function private.preparar_alteracoes(jsonb, jsonb, jsonb, boolean, jsonb) set search_path = public, extensions, pg_temp;
alter function private.regras_embarque() set search_path = public, extensions, pg_temp;
alter function private.rotulo_campo(text) set search_path = public, extensions, pg_temp;
alter function private.validar_valor(text, text, jsonb, jsonb) set search_path = public, extensions, pg_temp;
