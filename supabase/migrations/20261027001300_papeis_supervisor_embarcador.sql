-- Novos papéis pedidos pelo Frederick (27/10/2026). Fica sozinho porque um valor novo de enum
-- só pode ser usado depois que esta transação termina (a matriz vem na migração 1310).
alter type public.papel_usuario add value if not exists 'supervisor' after 'gestor';
alter type public.papel_usuario add value if not exists 'embarcador' after 'supervisor';
