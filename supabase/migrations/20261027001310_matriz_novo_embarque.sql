-- Quem cadastra embarque (e gera o anúncio do frete): gestor, comercial, supervisor e embarcador (pedido de 27/10/2026).
-- Gestor passa a ter financeiro (decisão de 27/10/2026). O embarcador vê frete motorista e margem de cada embarque (é premiado pela margem). O anúncio leva só o frete motorista.
-- Só acrescenta permissões; o administrador continua ajustando a matriz na tela Permissões.
insert into public.papel_permissoes (papel, chave) values
  ('gestor', 'financeiro.ver'), ('gestor', 'financeiro.editar'),
  ('comercial', 'embarques.criar'), ('comercial', 'embarques.liberar'),
  ('supervisor', 'embarques.ver'), ('supervisor', 'embarques.criar'), ('supervisor', 'embarques.editar_cadastro'),
  ('supervisor', 'embarques.liberar'), ('supervisor', 'embarques.editar_cadencia'), ('supervisor', 'embarques.editar_capacidade'),
  ('supervisor', 'embarques.arquivar'), ('supervisor', 'posicoes.abrir'), ('supervisor', 'posicoes.editar_contadores'),
  ('supervisor', 'posicoes.editar_obs_operacional'), ('supervisor', 'posicoes.editar_obs_cliente'), ('supervisor', 'historico.ver'),
  ('supervisor', 'compartilhamento.preparar'), ('supervisor', 'compartilhamento.links'),
  ('supervisor', 'financeiro.ver'), ('supervisor', 'financeiro.editar'),
  ('embarcador', 'embarques.ver'), ('embarcador', 'embarques.criar'), ('embarcador', 'embarques.liberar'),
  ('embarcador', 'posicoes.abrir'), ('embarcador', 'posicoes.editar_contadores'), ('embarcador', 'posicoes.editar_obs_operacional'),
  ('embarcador', 'financeiro.ver'), ('embarcador', 'financeiro.editar')
on conflict do nothing;
