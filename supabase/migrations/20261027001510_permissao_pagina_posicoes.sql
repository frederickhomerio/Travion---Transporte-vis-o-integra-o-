-- Acesso à página Posições de Embarque vira permissão da matriz (Administração → Permissões), pedido de 27/10/2026.
-- Padrão: gestor, supervisor e coordenador comercial (papel comercial); administrador tem todas.
-- O Coordenador Comercial também passa a editar os contadores das posições. Só acrescenta.
insert into public.permissoes (chave, grupo, descricao) values
  ('posicoes.pagina', 'Posições', 'Acessar a página Posições de Embarque')
on conflict do nothing;
insert into public.papel_permissoes (papel, chave) values
  ('gestor', 'posicoes.pagina'), ('supervisor', 'posicoes.pagina'), ('comercial', 'posicoes.pagina'),
  ('comercial', 'posicoes.editar_contadores')
on conflict do nothing;
