-- Correções aprovadas em 02/11/2026 (migração 3400). Só acrescenta/substitui funções; não altera dados.
--
-- 1) Vitrine da Lista de Fretes: todo usuário interno ATIVO consulta os fretes LIBERADOS de todos os centros de custo,
--    com os campos da lista e da divulgação (rota, locais, produto, filial e frete do motorista). Não devolve cliente,
--    carteira, frete empresa, margem, observações nem posições. A coluna no_escopo diz se a pessoa pode abrir Detalhes,
--    suspender ou encerrar aquele frete (centro de custo autorizado + embarques.ver); as ações continuam conferidas
--    pelas próprias funções (pode_ver_embarque) e a RLS das tabelas não foi ampliada.
--    Por que uma função nova: a RLS de embarques/embarque_financeiro entrega o registro inteiro (com valores internos);
--    abrir essa leitura exporia dados financeiros fora do escopo. Nenhuma permissão nova foi necessária.
--
-- 2) Posições de uma nova data nascem SEMPRE com porta, trânsito e carregados em 0. O parâmetro legado
--    p_transportar_saldos continua aceito (telas antigas), mas é ignorado de forma explícita: nenhum saldo é copiado.
--    Posições já existentes na data não são tocadas; repetir a abertura só cria o que falta (on conflict do nothing).
--    A data operacional segue Brasília (private.hoje_sp). Nada é confirmado na abertura (confirmado_em fica nulo) e
--    nenhuma observação do dia anterior é copiada.
--
-- 3) Compatibilidade com o fim do "Não informado": carregar_dados_demo e importar_planilha ainda gravavam
--    'nao_informado' (o modo demonstração parou de carregar com a CHECK de 02/11). Um gatilho BEFORE INSERT normaliza
--    esse valor legado para 'liberado' só na CRIAÇÃO, como já faz criar_embarque. Alterações continuam bloqueadas
--    pela CHECK embarques_status_informado.
--
-- 4) O bloqueio de DELETE de 02/11 também impedia "Limpar dados demonstrativos" (Administração → modo demonstração).
--    A exclusão continua bloqueada para TODO embarque real (is_demo = false) e o TRUNCATE continua bloqueado sempre;
--    só os registros fictícios do modo demonstração (is_demo = true) podem ser removidos, pela função limpar_dados_demo.

create or replace function public.lista_fretes_vitrine(p_is_demo boolean default false)
returns table (
  id uuid, codigo bigint, filial_id uuid, centro_custo_id uuid, produto_id uuid,
  origem_cidade text, origem_uf text, local_coleta_id uuid,
  destino_cidade text, destino_uf text, local_entrega_id uuid,
  frete_motorista numeric, unidade_frete public.unidade_frete,
  atualizado_em timestamptz, no_escopo boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.usuario_ativo() then
    raise exception using errcode = '42501', message = 'Acesso negado: usuário inativo ou sem cadastro.';
  end if;
  return query
    select e.id, e.codigo, e.filial_id, fi.centro_custo_id, e.produto_id,
           e.origem_cidade, e.origem_uf, e.local_coleta_id,
           e.destino_cidade, e.destino_uf, e.local_entrega_id,
           f.frete_motorista, f.unidade_frete,
           e.atualizado_em, private.pode_ver_embarque(e.id)
      from public.embarques e
      left join public.filiais fi on fi.id = e.filial_id
      left join public.embarque_financeiro f on f.embarque_id = e.id
     where e.is_demo = coalesce(p_is_demo, false)
       and e.situacao = 'ativo'
       and e.encerrado_em is null
       and e.status_liberacao = 'liberado'
     order by e.codigo;
end $$;

revoke all on function public.lista_fretes_vitrine(boolean) from public, anon;
grant execute on function public.lista_fretes_vitrine(boolean) to authenticated;

create or replace function public.abrir_posicoes(p_data date, p_transportar_saldos boolean, p_embarque_ids uuid[] default null,
                                                 p_is_demo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e record;
  v_id uuid;
  v_criadas integer := 0;
  v_existentes integer := 0;
  v_desc text := 'Porta, trânsito e carregados iniciados em 0';
begin
  perform private.exigir('posicoes.abrir');
  if p_data is null then
    raise exception using errcode = '22023', message = 'Informe a data operacional.';
  end if;
  if p_data > private.hoje_sp() + 1 then
    raise exception using errcode = '22023', message = 'Só é possível abrir posições até o dia seguinte.';
  end if;
  -- p_transportar_saldos: parâmetro legado, ignorado. Toda posição nova nasce zerada (decisão de 02/11/2026).
  if coalesce(p_transportar_saldos, false) then
    v_desc := 'Porta, trânsito e carregados iniciados em 0 (pedido de transporte de saldo ignorado)';
  end if;

  for e in
    select x.* from public.embarques x
    where x.is_demo = coalesce(p_is_demo, false) and x.situacao = 'ativo'
      and (p_embarque_ids is null or x.id = any (p_embarque_ids))
      and private.pode_ver_embarque(x.id)
    order by x.codigo
  loop
    v_id := null;
    insert into public.posicoes_diarias
      (embarque_id, data_operacional, porta, transito, carregados, toneladas_por_veiculo, meta_valor, meta_unidade,
       is_demo, origem, criado_por, atualizado_por, atualizado_por_nome)
    values
      (e.id, p_data, 0, 0, 0, e.toneladas_por_veiculo, e.cadencia_valor, e.cadencia_unidade,
       e.is_demo, 'abertura', auth.uid(), auth.uid(), private.nome_usuario())
    on conflict (embarque_id, data_operacional) do nothing
    returning id into v_id;

    if v_id is null then
      v_existentes := v_existentes + 1;
      continue;
    end if;
    perform private.registrar('posicao', v_id, e.id, v_id, e.cliente_id, p_data, 'abertura', null, v_desc);
    v_criadas := v_criadas + 1;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ja_existiam', v_existentes, 'sem_posicao_anterior', 0);
end $$;

revoke all on function public.abrir_posicoes(date, boolean, uuid[], boolean) from public, anon;
grant execute on function public.abrir_posicoes(date, boolean, uuid[], boolean) to authenticated;

create or replace function private.impedir_exclusao_embarque()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and tg_level = 'ROW' and old.is_demo then
    return old;
  end if;
  raise exception using errcode = '55000',
    message = 'Embarques não podem ser excluídos permanentemente. Utilize Encerrar para preservar o histórico.';
end $$;
revoke all on function private.impedir_exclusao_embarque() from public, anon, authenticated;

create or replace function private.normalizar_status_novo_embarque()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status_liberacao is null or new.status_liberacao::text = 'nao_informado' then
    new.status_liberacao := 'liberado';
  end if;
  return new;
end $$;
revoke all on function private.normalizar_status_novo_embarque() from public, anon, authenticated;

drop trigger if exists embarques_normalizar_status_novo on public.embarques;
create trigger embarques_normalizar_status_novo before insert on public.embarques
  for each row execute function private.normalizar_status_novo_embarque();

notify pgrst, 'reload schema';
