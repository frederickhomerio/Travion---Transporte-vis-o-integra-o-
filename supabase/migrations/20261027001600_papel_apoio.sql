-- Papel novo: Apoio Operacional (pedido de 27/10/2026). Fica sozinho porque um valor novo de enum
-- só pode ser usado depois que esta transação termina (a matriz vem na migração 1610).
alter type public.papel_usuario add value if not exists 'apoio' after 'embarcador';
