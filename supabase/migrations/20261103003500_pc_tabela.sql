-- 03/11/2026 (migração 3500): Lote ERP, PC e Tabela. Só acrescenta colunas, uma permissão e funções; não altera dados.
--
-- Pedido do Frederick: na Lista de Fretes, a coluna "Lote-PC-Tabela" mostra o lote do ERP, a PC e a tabela, um abaixo
-- do outro, cada um com quem preencheu ("Lote 1234 - Amanda"). PC e Tabela são informados na criação do embarque
-- (opcionais, texto até 60 caracteres) ou depois, no Detalhes, enquanto estiverem vazios.
-- REGRA: depois de preenchido, Lote, PC ou Tabela só muda com a permissão nova embarques.corrigir_lote_pc_tabela
-- (Coordenador Comercial por padrão; administrador sempre). Vale também para o apoio corrigir o número do lote no
-- atendimento. Toda alteração fica no histórico e passa a mostrar o nome de quem corrigiu.
-- "Toneladas médias por veículo" saiu do formulário de criação: o embarque nasce com o padrão da configuração.
-- A vitrine (lista_fretes_vitrine) NÃO devolve PC nem tabela: fora do centro de custo esses dados não aparecem.

insert into public.permissoes (chave, grupo, descricao) values
  ('embarques.corrigir_lote_pc_tabela', 'Embarques', 'Corrigir Lote ERP, PC e Tabela depois de preenchidos')
on conflict do nothing;
insert into public.papel_permissoes (papel, chave) values ('comercial', 'embarques.corrigir_lote_pc_tabela')
on conflict do nothing;

alter table public.embarques add column if not exists pc text;
alter table public.embarques add column if not exists pc_por uuid;
alter table public.embarques add column if not exists pc_por_nome text;
alter table public.embarques add column if not exists pc_em timestamptz;
alter table public.embarques add column if not exists tabela text;
alter table public.embarques add column if not exists tabela_por uuid;
alter table public.embarques add column if not exists tabela_por_nome text;
alter table public.embarques add column if not exists tabela_em timestamptz;
alter table public.embarques drop constraint if exists embarques_pc_tamanho;
alter table public.embarques add constraint embarques_pc_tamanho check (pc is null or length(pc) <= 60);
alter table public.embarques drop constraint if exists embarques_tabela_tamanho;
alter table public.embarques add constraint embarques_tabela_tamanho check (tabela is null or length(tabela) <= 60);

create or replace function private.rotulo_campo(p_campo text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_build_object(
    'porta', 'Porta', 'transito', 'Trânsito', 'carregados', 'Carregados',
    'obs_operacional', 'Observação operacional', 'obs_cliente', 'Observação para o cliente',
    'cliente_id', 'Cliente', 'comercial_id', 'Carteira', 'filial_id', 'Filial', 'produto_id', 'Produto',
    'origem_cidade', 'Cidade de origem', 'origem_uf', 'UF de origem', 'local_coleta_id', 'Local de coleta',
    'destino_cidade', 'Cidade de destino', 'destino_uf', 'UF de destino', 'local_entrega_id', 'Local de entrega',
    'status_liberacao', 'Status de liberação', 'data_liberacao', 'Data de liberação',
    'cadencia_valor', 'Cadência', 'cadencia_unidade', 'Unidade da cadência',
    'toneladas_por_veiculo', 'Toneladas médias por veículo', 'observacao_interna', 'Observação interna',
    'pc', 'PC', 'tabela', 'Tabela',
    'situacao', 'Situação cadastral', 'frete_empresa', 'Frete empresa', 'frete_motorista', 'Frete motorista',
    'unidade_frete', 'Unidade do frete', 'meta_valor', 'Meta da posição', 'meta_unidade', 'Unidade da meta'
  ) ->> p_campo, p_campo)
$$;

create or replace function public.criar_embarque(p_dados jsonb, p_is_demo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.embarques;
  c public.clientes;
  v_cap numeric := (select (valor #>> '{}')::numeric from public.configuracoes where chave = 'capacidade_padrao_t');
  v_fin jsonb := p_dados -> 'financeiro';
  v_data date;
  k text;
  v_lote text := nullif(trim(coalesce(p_dados ->> 'lote_erp', '')), '');
  v_pc text := nullif(trim(coalesce(p_dados ->> 'pc', '')), '');
  v_tabela text := nullif(trim(coalesce(p_dados ->> 'tabela', '')), '');
begin
  perform private.exigir('embarques.criar');
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'Dados do embarque não informados.';
  end if;

  if not (p_dados ? 'status_liberacao') or p_dados->>'status_liberacao' is null or p_dados->>'status_liberacao'='nao_informado' then
    p_dados:=jsonb_set(p_dados,'{status_liberacao}','"liberado"'::jsonb);
  end if;
  -- Valida todos os campos com as mesmas regras da edição (exceto permissões, conferidas abaixo).
  p_dados := p_dados - 'pc' - 'tabela';
  for k in select jsonb_object_keys(p_dados - 'financeiro' - 'abrir_posicao_em' - 'lote_erp') loop
    if not (private.regras_embarque() ? k) then
      raise exception using errcode = '22023', message = format('Campo "%s" não reconhecido.', k);
    end if;
    p_dados := jsonb_set(p_dados, array[k],
      private.validar_valor(k, private.regras_embarque() -> k ->> 'tipo', p_dados -> k, private.regras_embarque() -> k -> 'valores'));
  end loop;

  n := jsonb_populate_record(null::public.embarques, p_dados - 'lote_erp');
  if n.cliente_id is null or n.filial_id is null or n.origem_cidade is null or n.destino_cidade is null then
    raise exception using errcode = '22023', message = 'Cliente, filial, cidade de origem e cidade de destino são obrigatórios.';
  end if;
  select * into c from public.clientes where id = n.cliente_id;

  -- Carteira: sugerida pelo cadastro do cliente; escolher outra exige permissão específica.
  if not (p_dados ? 'comercial_id') then
    n.comercial_id := c.comercial_id;
  elsif n.comercial_id is distinct from c.comercial_id then
    perform private.exigir('carteira.editar');
  end if;
  if n.toneladas_por_veiculo is null then
    n.toneladas_por_veiculo := coalesce(v_cap, 40);
  elsif n.toneladas_por_veiculo <> coalesce(v_cap, 40) then
    perform private.exigir('embarques.editar_capacidade');
  end if;
  -- Meta diária obrigatória em todo embarque novo (veículos ou toneladas por dia).
  if n.cadencia_valor is null or n.cadencia_valor <= 0 then
    raise exception using errcode = '22023', message = 'Informe a meta diária do embarque (veículos ou toneladas por dia).';
  end if;
  if n.cadencia_unidade is null then n.cadencia_unidade := 'veiculos_dia'; end if;
  if not private.tem_permissao('embarques.editar_cadencia') and not private.tem_permissao('embarques.editar_cadencia_proprio') then
    raise exception using errcode = '42501', message = 'Você não tem permissão para definir a meta diária do embarque.';
  end if;
  if v_lote is not null and length(v_lote) > 60 then
    raise exception using errcode = '22023', message = 'O número do lote do ERP tem no máximo 60 caracteres.';
  end if;
  if length(v_pc) > 60 or length(v_tabela) > 60 then
    raise exception using errcode = '22023', message = 'PC e tabela têm no máximo 60 caracteres.';
  end if;
  if n.status_liberacao='suspenso' or n.data_liberacao is not null then perform private.exigir('embarques.liberar'); end if;
  n.situacao := 'ativo';
  n.is_demo := coalesce(p_is_demo, false);
  perform private.validar_referencias_embarque(n);

  insert into public.embarques
    (cliente_id, comercial_id, filial_id, produto_id, origem_cidade, origem_uf, local_coleta_id,
     destino_cidade, destino_uf, local_entrega_id, status_liberacao, data_liberacao, cadencia_valor, cadencia_unidade,
     toneladas_por_veiculo, observacao_interna, pc, pc_por, pc_por_nome, pc_em, tabela, tabela_por, tabela_por_nome, tabela_em,
     situacao, is_demo, criado_por, atualizado_por, atualizado_por_nome)
  values
    (n.cliente_id, n.comercial_id, n.filial_id, n.produto_id, n.origem_cidade, n.origem_uf, n.local_coleta_id,
     n.destino_cidade, n.destino_uf, n.local_entrega_id, n.status_liberacao, n.data_liberacao, n.cadencia_valor, n.cadencia_unidade,
     n.toneladas_por_veiculo, n.observacao_interna,
     v_pc, case when v_pc is not null then auth.uid() end, case when v_pc is not null then private.nome_usuario() end, case when v_pc is not null then now() end,
     v_tabela, case when v_tabela is not null then auth.uid() end, case when v_tabela is not null then private.nome_usuario() end, case when v_tabela is not null then now() end,
     n.situacao, n.is_demo, auth.uid(), auth.uid(), private.nome_usuario())
  returning * into n;

  insert into public.embarque_financeiro (embarque_id) values (n.id);
  if v_lote is not null then
    insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
    values (n.id, v_lote, null, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'));
    perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'lote_erp', null, v_lote);
  end if;
  if v_pc is not null then perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'pc', null, v_pc); end if;
  if v_tabela is not null then perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'tabela', null, v_tabela); end if;
  perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'criacao', null,
    format('Embarque EMB-%s criado', lpad(n.codigo::text, 6, '0')));

  if v_fin is not null and jsonb_typeof(v_fin) = 'object' and v_fin <> '{}'::jsonb then
    perform public.atualizar_financeiro(n.id, v_fin, null, true);
  end if;

  if p_dados ? 'abrir_posicao_em' and nullif(p_dados ->> 'abrir_posicao_em', '') is not null then
    v_data := (p_dados ->> 'abrir_posicao_em')::date;
    perform public.abrir_posicoes(v_data, false, array[n.id], n.is_demo);
  end if;

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n));
end $$;

create or replace function public.registrar_lote_doc(p_id uuid, p_numero text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  l public.lotes_erp;
  ini public.solicitacoes_doc;
  v_num text := trim(coalesce(p_numero, ''));
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_informacao']);
  if s.tipo not in ('lote_emissao', 'emissao') or s.embarque_id is null then
    perform private.doc_erro('55000', 'Só Lote e Emissão ou Emissão registram o lote.');
  end if;
  if length(v_num) = 0 or length(v_num) > 60 then perform private.doc_erro('22023', 'Informe o código do lote do ERP.'); end if;
  select * into ini from public.solicitacoes_doc
   where embarque_id = s.embarque_id and tipo = 'lote_emissao' and status <> 'cancelado'
   order by enviado_em limit 1;
  select * into l from public.lotes_erp where embarque_id = s.embarque_id for update;
  if found then
    if s.tipo = 'emissao' or (l.solicitacao_id is not null and l.solicitacao_id is distinct from s.id) then
      -- Lote já criado para o embarque: vincula se o código conferir.
      if upper(l.numero) <> upper(v_num) then
        perform private.doc_erro('55000', 'Este embarque já tem o lote ' || l.numero || ' criado. Confira o código no ERP.');
      end if;
      if s.lote_id = l.id then return jsonb_build_object('status', 'sem_alteracao', 'lote', to_jsonb(l), 'registro', to_jsonb(s)); end if;
      perform private.doc_evento(s.id, 'evento', 'Vinculada ao lote ' || l.numero || ' (já criado no ERP)', 'lote');
    else
      -- Lote informado na criação do embarque: o apoio confirma (ou corrige) e ele passa a ser desta solicitação.
      if l.solicitacao_id is null then
        update public.lotes_erp set solicitacao_id = s.id where id = l.id returning * into l;
      end if;
      if l.numero = v_num and s.lote_id = l.id then
        return jsonb_build_object('status', 'sem_alteracao', 'lote', to_jsonb(l), 'registro', to_jsonb(s));
      end if;
      if l.numero <> v_num then
        -- 03/11: lote já preenchido só é corrigido por quem tem a permissão (Coordenador Comercial; admin sempre).
        if not private.tem_permissao('embarques.corrigir_lote_pc_tabela') then
          perform private.doc_erro('42501', 'O lote ' || l.numero || ' já foi informado por ' || l.registrado_por_nome
            || '. Só quem tem a permissão "Corrigir Lote ERP, PC e Tabela" pode alterar. Para vincular, use o mesmo código.');
        end if;
        perform private.doc_evento(s.id, 'evento', 'Número do lote corrigido de ' || l.numero || ' para ' || v_num, 'lote');
        perform private.registrar('embarque', s.embarque_id, s.embarque_id, null, (s.retrato ->> 'cliente_id')::uuid, null, 'lote_erp', l.numero, v_num);
        update public.lotes_erp set numero = v_num, registrado_por = auth.uid(), registrado_por_nome = coalesce(private.nome_usuario(), 'Usuário'),
          registrado_em = now(), versao = versao + 1, atualizado_em = now() where id = l.id returning * into l;
      else
        perform private.doc_evento(s.id, 'evento', 'Vinculada ao lote ' || l.numero, 'lote');
      end if;
    end if;
  else
    insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
    values (s.embarque_id, v_num, coalesce(ini.id, s.id), auth.uid(), coalesce(private.nome_usuario(), 'Usuário')) returning * into l;
    perform private.doc_evento(s.id, 'evento', 'Lote ' || v_num || ' registrado (gerado no ERP) e vinculado. A emissão segue em atendimento.', 'lote');
    perform private.registrar('embarque', s.embarque_id, s.embarque_id, null, (s.retrato ->> 'cliente_id')::uuid, null, 'lote_erp', null, v_num);
  end if;
  update public.solicitacoes_doc set lote_id = l.id, retrato = retrato || jsonb_build_object('lote_numero', l.numero),
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  -- Demais solicitações do embarque sem lote (a inicial e as emissões da fila) passam a apontar para o lote;
  -- número corrigido também atualiza o retrato das já vinculadas.
  update public.solicitacoes_doc set lote_id = l.id, retrato = retrato || jsonb_build_object('lote_numero', l.numero),
    versao = versao + 1, atualizado_em = now()
  where embarque_id = s.embarque_id and id <> s.id and tipo in ('lote_emissao', 'emissao') and status <> 'cancelado'
    and (lote_id is null or (lote_id = l.id and retrato ->> 'lote_numero' is distinct from l.numero));
  return jsonb_build_object('status', 'ok', 'lote', to_jsonb(l), 'registro', to_jsonb(s));
end $$;
revoke all on function public.registrar_lote_doc(uuid, text) from public, anon;
grant execute on function public.registrar_lote_doc(uuid, text) to authenticated;

-- Preencher (vazio) ou corrigir (já preenchido) Lote ERP, PC ou Tabela pelo Detalhes do embarque.
-- Preencher: quem cadastra ou edita embarques (embarques.criar, editar_lote ou editar_cadastro) no seu centro de custo.
-- Corrigir: só com embarques.corrigir_lote_pc_tabela. Registra quem preencheu/corrigiu e o histórico.
create or replace function public.definir_lote_pc_tabela(p_embarque_id uuid, p_campo text, p_valor text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.embarques;
  l public.lotes_erp;
  v_val text := nullif(trim(coalesce(p_valor, '')), '');
  v_atual text;
  v_nome text := coalesce(private.nome_usuario(), 'Usuário');
begin
  perform private.exigir_ativo();
  if p_campo not in ('lote_erp', 'pc', 'tabela') then
    raise exception using errcode = '22023', message = 'Campo inválido.';
  end if;
  if v_val is null or length(v_val) > 60 then
    raise exception using errcode = '22023', message = 'Informe o valor (até 60 caracteres).';
  end if;
  select * into e from public.embarques where id = p_embarque_id for update;
  if not found or not private.pode_ver_embarque(e.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  if e.encerrado_em is not null then
    raise exception using errcode = '55000', message = 'Embarque encerrado: reative antes de alterar.';
  end if;
  if p_campo = 'lote_erp' then
    select * into l from public.lotes_erp where embarque_id = e.id for update;
    v_atual := l.numero;
  elsif p_campo = 'pc' then v_atual := e.pc;
  else v_atual := e.tabela;
  end if;

  if v_atual is not null and v_atual = v_val then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(e), 'lote', to_jsonb(l));
  end if;
  if v_atual is null then
    if not (private.tem_permissao('embarques.criar') or private.tem_permissao('embarques.editar_lote')
            or private.tem_permissao('embarques.editar_cadastro')) then
      raise exception using errcode = '42501', message = 'Você não tem permissão para preencher este campo.';
    end if;
  else
    perform private.exigir('embarques.corrigir_lote_pc_tabela');
  end if;

  if p_campo = 'lote_erp' then
    if l.id is null then
      insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
      values (e.id, v_val, null, auth.uid(), v_nome) returning * into l;
    else
      update public.lotes_erp set numero = v_val, registrado_por = auth.uid(), registrado_por_nome = v_nome, registrado_em = now(),
        versao = versao + 1, atualizado_em = now() where id = l.id returning * into l;
      update public.solicitacoes_doc set retrato = retrato || jsonb_build_object('lote_numero', l.numero), versao = versao + 1, atualizado_em = now()
       where lote_id = l.id and retrato ->> 'lote_numero' is distinct from l.numero;
    end if;
  elsif p_campo = 'pc' then
    update public.embarques set pc = v_val, pc_por = auth.uid(), pc_por_nome = v_nome, pc_em = now(),
      versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = v_nome
     where id = e.id returning * into e;
  else
    update public.embarques set tabela = v_val, tabela_por = auth.uid(), tabela_por_nome = v_nome, tabela_em = now(),
      versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = v_nome
     where id = e.id returning * into e;
  end if;
  perform private.registrar('embarque', e.id, e.id, null, e.cliente_id, null, p_campo, v_atual, v_val);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(e), 'lote', to_jsonb(l));
end $$;

revoke all on function public.definir_lote_pc_tabela(uuid, text, text) from public, anon;
grant execute on function public.definir_lote_pc_tabela(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
