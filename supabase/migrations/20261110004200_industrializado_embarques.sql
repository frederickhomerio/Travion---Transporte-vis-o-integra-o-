-- Industrializado (10/11/2026, pedido do Frederick): as funções do módulo também acessam, no módulo Embarques,
-- a Lista de Fretes (ver e divulgar, com o frete do motorista), o Cadastro e a Estadia, com o escopo do
-- centro de custo da pessoa, como nos outros centros. Sem editar lote, sem pedir emissão, sem posições.
-- Só acrescenta. Reexecutável.
insert into public.papel_permissoes (papel, chave)
select p::public.papel_usuario, c
from unnest(array['ind_supervisor', 'ind_embarcador', 'ind_apoio']) p,
     unnest(array['embarques.ver', 'financeiro.ver', 'cadastro.solicitar', 'cadastro.ver', 'estadia.solicitar', 'estadia.ver']) c
on conflict do nothing;
