-- Estadia com cliente do Industrializado (10/11/2026, pedido do Frederick), igual ao Cadastro (migração 4300).
-- As funções do Industrializado escolhem o cliente na lista do módulo (ind_clientes); as demais seguem com os clientes do Travion.
-- Ajusta a função de envio que está no banco trocando só os trechos do cliente (cada troca é conferida; se algum
-- trecho não for encontrado, nada é gravado). Precisa da coluna ind_cliente_id da migração 4300. Reexecutável.

alter table public.solicitacoes_doc add column if not exists ind_cliente_id text references public.ind_clientes (id);

do $mig$
declare
  d text := pg_get_functiondef('public.criar_solicitacao_estadia(jsonb,jsonb)'::regprocedure);
  trocas text[][] := array[
    -- variáveis
    array['  c public.clientes;',
          '  c public.clientes;' || chr(10) || '  ci public.ind_clientes;' || chr(10)
          || '  v_ind text := nullif(p_dados ->> ''ind_cliente_id'', '''');' || chr(10) || '  v_cliente_nome text;'],
    -- cliente: do Industrializado (quem acessa o módulo) ou do Travion
    array['  select * into c from public.clientes where id = nullif(p_dados ->> ''cliente_id'', '''')::uuid;',
          '  if v_ind is not null then' || chr(10)
          || '    select * into ci from public.ind_clientes where id = v_ind;' || chr(10)
          || '    if not found or not private.tem_permissao(''ind.pagina'') or coalesce((ci.dados ->> ''ativo'')::boolean, true) = false then' || chr(10)
          || '      perform private.doc_erro(''22023'', ''Selecione um cliente do Industrializado ativo.'');' || chr(10)
          || '    end if;' || chr(10)
          || '    v_cliente_nome := ci.dados ->> ''nome'';' || chr(10)
          || '  else' || chr(10)
          || '  select * into c from public.clientes where id = nullif(p_dados ->> ''cliente_id'', '''')::uuid;'],
    array['  if not found or not private.pode_ver_cliente(c.id) then perform private.doc_erro(''22023'', ''Selecione um cliente autorizado.''); end if;',
          '  if not found or not private.pode_ver_cliente(c.id) then perform private.doc_erro(''22023'', ''Selecione um cliente autorizado.''); end if;' || chr(10)
          || '  v_cliente_nome := c.nome;' || chr(10) || '  end if;'],
    -- duplicidade por documento: mesmo cliente (Travion ou Industrializado)
    array['or (x.cliente_id = c.id and x.est_tipo_documento',
          'or ((x.cliente_id = c.id or (v_ind is not null and x.ind_cliente_id = v_ind)) and x.est_tipo_documento'],
    -- retrato
    array['''cliente'', c.nome, ''cliente_id'', c.id, ''carteira''',
          '''cliente'', v_cliente_nome, ''cliente_id'', c.id, ''ind_cliente_id'', v_ind, ''carteira'''],
    -- gravação
    array['solicitante_nome, filial_id, comercial_id, cliente_id,',
          'solicitante_nome, filial_id, comercial_id, cliente_id, ind_cliente_id,'],
    array['coalesce(private.nome_usuario(), ''Usuário''), v_filial, c.comercial_id, c.id,',
          'coalesce(private.nome_usuario(), ''Usuário''), v_filial, c.comercial_id, c.id, case when v_ind is not null then ci.id end,']
  ];
  i integer;
  chk text;
begin
  if position('v_ind' in d) > 0 then
    raise notice 'criar_solicitacao_estadia já aceita cliente do Industrializado: nada a trocar.';
  else
    for i in 1 .. array_length(trocas, 1) loop
      if position(trocas[i][1] in d) = 0 then
        raise exception 'Trecho % não encontrado na função criar_solicitacao_estadia: nada foi gravado.', i;
      end if;
      d := replace(d, trocas[i][1], trocas[i][2]);
    end loop;
    execute d;
  end if;

  -- Regra da estadia: aceita cliente do Travion ou do Industrializado.
  select pg_get_constraintdef(oid) into chk from pg_constraint
   where conrelid = 'public.solicitacoes_doc'::regclass and conname = 'solicitacoes_doc_campos_estadia';
  if chk is null then raise exception 'Regra solicitacoes_doc_campos_estadia não encontrada: nada foi gravado.'; end if;
  if position('ind_cliente_id' in chk) = 0 then
    if position('(cliente_id IS NOT NULL)' in chk) = 0 then
      raise exception 'Regra da estadia diferente do esperado: nada foi gravado.';
    end if;
    chk := replace(chk, '(cliente_id IS NOT NULL)', '((cliente_id IS NOT NULL) OR (ind_cliente_id IS NOT NULL))');
    execute 'alter table public.solicitacoes_doc drop constraint solicitacoes_doc_campos_estadia';
    execute 'alter table public.solicitacoes_doc add constraint solicitacoes_doc_campos_estadia ' || chk;
  end if;
end $mig$;
