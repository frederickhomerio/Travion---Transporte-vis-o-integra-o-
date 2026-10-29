-- Botão "Editar lote" no Detalhes da Lista de Fretes (pedido de 29/10/2026): ativo para Supervisor, Coordenador Comercial,
-- Gestor e Administrador. O botão é a permissão embarques.editar_lote (ajustável em Administração → Permissões);
-- cada campo continua conferido pela sua permissão no servidor. Para o Coordenador Comercial editar o lote inteiro,
-- ele passa a ter também "Alterar cliente, rota, produto, filial, locais e observação" e "Alterar toneladas médias por veículo".

insert into public.permissoes (chave, grupo, descricao) values
  ('embarques.editar_lote', 'Embarques', 'Botão Editar lote no Detalhes da Lista de Fretes (os campos seguem as demais permissões)')
on conflict do nothing;

insert into public.papel_permissoes (papel, chave) values
  ('supervisor', 'embarques.editar_lote'), ('comercial', 'embarques.editar_lote'), ('gestor', 'embarques.editar_lote'),
  ('comercial', 'embarques.editar_cadastro'), ('comercial', 'embarques.editar_capacidade')
on conflict do nothing;
