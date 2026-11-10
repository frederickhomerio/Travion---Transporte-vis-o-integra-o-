-- Industrializado (10/11/2026): funções exclusivas do módulo, com os mesmos nomes do Travion.
-- Fica sozinho porque um valor novo de enum só pode ser usado depois que esta transação termina
-- (as tabelas, permissões e funções vêm na migração 4110). Só acrescenta. Reexecutável.
alter type public.papel_usuario add value if not exists 'ind_supervisor';
alter type public.papel_usuario add value if not exists 'ind_embarcador';
alter type public.papel_usuario add value if not exists 'ind_apoio';
