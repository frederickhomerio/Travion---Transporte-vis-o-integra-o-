-- Pedido de 27/10/2026: Operação e Apoio Operacional viram um tipo de usuário só, "Apoio Operacional" (papel `apoio`).
-- O papel `apoio` recebe também o que a Operação fazia; quem era Operação passa para Apoio Operacional.
-- O valor `operacao` continua no tipo do banco (não dá para removê-lo sem recriar o tipo), mas some das telas.
insert into public.papel_permissoes (papel, chave)
select 'apoio', chave from public.papel_permissoes where papel = 'operacao'
on conflict do nothing;
-- Por segurança, um perfil que ainda esteja como `operacao` tem as mesmas permissões do Apoio.
insert into public.papel_permissoes (papel, chave)
select 'operacao', chave from public.papel_permissoes where papel = 'apoio'
on conflict do nothing;
update public.perfis set papel = 'apoio' where papel = 'operacao';
