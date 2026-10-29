-- Cancelar solicitação (pedido de 29/10/2026): botão também na fila do Apoio, mas por padrão só o Gestor cancela
-- (administrador sempre). Outras funções ou usuários ganham o acesso em Administração → Permissões.
-- O solicitante continua podendo cancelar a própria solicitação enquanto ninguém assumiu.
delete from public.papel_permissoes where chave = 'documentacao.cancelar' and papel in ('apoio', 'operacao');
