-- Travion: correção dos estados e preservação do histórico, 02/11/2026.
-- JÁ APLICADA EM PRODUÇÃO (migração remota travion_tres_estados_preservar_historico, 20261102154753).
-- Cópia fiel para o repositório e para os testes locais: NÃO rodar de novo no Supabase de produção.
-- Estados de negócio: Liberado, Suspenso e Encerrado. "Não informado" fica só no tipo enum (compatibilidade)
-- e uma CHECK impede gravá-lo; criar_embarque normaliza entradas legadas para Liberado.
begin; -- (no Supabase a migração já roda numa transação)
lock table public.embarques in share row exclusive mode;
insert into public.permissoes(chave,grupo,descricao)
values('embarques.reativar_encerrado','Embarques','Reativar embarques encerrados, com motivo e histórico')
on conflict(chave) do nothing;
update public.permissoes set descricao='Encerrar embarques preservando o histórico' where chave='embarques.encerrar';
CREATE OR REPLACE FUNCTION private.regras_embarque()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'cliente_id',        jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'filial_id',         jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'produto_id',        jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'origem_cidade',     jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto_obrigatorio'),
    'origem_uf',         jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uf'),
    'local_coleta_id',   jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'destino_cidade',    jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto_obrigatorio'),
    'destino_uf',        jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uf'),
    'local_entrega_id',  jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'uuid'),
    'observacao_interna',jsonb_build_object('perm', 'embarques.editar_cadastro', 'tipo', 'texto'),
    'status_liberacao',  jsonb_build_object('perm', 'embarques.liberar', 'tipo', 'enum',
                                            'valores', '["liberado","suspenso"]'::jsonb),
    'data_liberacao',    jsonb_build_object('perm', 'embarques.liberar', 'tipo', 'data'),
    'cadencia_valor',    jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'positivo_obrigatorio'),
    'cadencia_unidade',  jsonb_build_object('perm', 'embarques.editar_cadencia', 'tipo', 'enum',
                                            'valores', '["veiculos_dia","toneladas_dia"]'::jsonb),
    'toneladas_por_veiculo', jsonb_build_object('perm', 'embarques.editar_capacidade', 'tipo', 'positivo_obrigatorio'),
    'situacao',          jsonb_build_object('perm', 'embarques.arquivar', 'tipo', 'enum',
                                            'valores', '["ativo","arquivado"]'::jsonb),
    'comercial_id',      jsonb_build_object('perm', 'carteira.editar', 'tipo', 'uuid'))
$function$
;
CREATE OR REPLACE FUNCTION public.criar_embarque(p_dados jsonb, p_is_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n public.embarques;
  c public.clientes;
  v_cap numeric := (select (valor #>> '{}')::numeric from public.configuracoes where chave = 'capacidade_padrao_t');
  v_fin jsonb := p_dados -> 'financeiro';
  v_data date;
  k text;
  v_lote text := nullif(trim(coalesce(p_dados ->> 'lote_erp', '')), '');
begin
  perform private.exigir('embarques.criar');
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'Dados do embarque não informados.';
  end if;

  if not (p_dados ? 'status_liberacao') or p_dados->>'status_liberacao' is null or p_dados->>'status_liberacao'='nao_informado' then
    p_dados:=jsonb_set(p_dados,'{status_liberacao}','"liberado"'::jsonb);
  end if;
  -- Valida todos os campos com as mesmas regras da edição (exceto permissões, conferidas abaixo).
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
  if n.status_liberacao='suspenso' or n.data_liberacao is not null then perform private.exigir('embarques.liberar'); end if;
  n.situacao := 'ativo';
  n.is_demo := coalesce(p_is_demo, false);
  perform private.validar_referencias_embarque(n);

  insert into public.embarques
    (cliente_id, comercial_id, filial_id, produto_id, origem_cidade, origem_uf, local_coleta_id,
     destino_cidade, destino_uf, local_entrega_id, status_liberacao, data_liberacao, cadencia_valor, cadencia_unidade,
     toneladas_por_veiculo, observacao_interna, situacao, is_demo, criado_por, atualizado_por, atualizado_por_nome)
  values
    (n.cliente_id, n.comercial_id, n.filial_id, n.produto_id, n.origem_cidade, n.origem_uf, n.local_coleta_id,
     n.destino_cidade, n.destino_uf, n.local_entrega_id, n.status_liberacao, n.data_liberacao, n.cadencia_valor, n.cadencia_unidade,
     n.toneladas_por_veiculo, n.observacao_interna, n.situacao, n.is_demo, auth.uid(), auth.uid(), private.nome_usuario())
  returning * into n;

  insert into public.embarque_financeiro (embarque_id) values (n.id);
  if v_lote is not null then
    insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
    values (n.id, v_lote, null, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'));
    perform private.registrar('embarque', n.id, n.id, null, n.cliente_id, null, 'lote_erp', null, v_lote);
  end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.atualizar_embarque(p_embarque_id uuid, p_alteracoes jsonb, p_base jsonb, p_forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r public.embarques;
  n public.embarques;
  v_prep jsonb;
  v_novo jsonb;
  k text;
  v jsonb;
  v_propagadas integer := 0;
  v_regras jsonb := private.regras_embarque();
begin
  perform private.exigir_ativo();
  select * into r from public.embarques where id = p_embarque_id for update;
  if not found or not private.pode_ver_embarque(r.id) then
    raise exception using errcode = 'P0002', message = 'Embarque não encontrado ou fora do seu escopo.';
  end if;
  if r.situacao = 'arquivado' and not (p_alteracoes ? 'situacao') then
    raise exception using errcode = '55000', message = 'Embarque arquivado: reative o cadastro antes de alterá-lo.';
  end if;

  if p_alteracoes ? 'situacao' and p_alteracoes->>'situacao' is distinct from r.situacao::text then
    raise exception using errcode='55000',message='Use Encerrar ou Reativar encerrado para preservar o histórico.';
  end if;
  -- Quem criou o embarque pode alterar a meta com a permissão "dos embarques que criei".
  if r.criado_por = auth.uid() and not private.tem_permissao('embarques.editar_cadencia')
     and private.tem_permissao('embarques.editar_cadencia_proprio') then
    v_regras := jsonb_set(jsonb_set(v_regras, '{cadencia_valor,perm}', '"embarques.editar_cadencia_proprio"'),
      '{cadencia_unidade,perm}', '"embarques.editar_cadencia_proprio"');
  end if;
  v_prep := private.preparar_alteracoes(to_jsonb(r), p_alteracoes, p_base, p_forcar, v_regras);
  if jsonb_array_length(v_prep -> 'conflitos') > 0 then
    return jsonb_build_object('status', 'conflito', 'conflitos', v_prep -> 'conflitos', 'registro', to_jsonb(r));
  end if;
  v_novo := v_prep -> 'novo';
  if v_novo = '{}'::jsonb then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(r));
  end if;

  n := jsonb_populate_record(r, v_novo);
  perform private.validar_referencias_embarque(n);

  update public.embarques set
    cliente_id = n.cliente_id, comercial_id = n.comercial_id, filial_id = n.filial_id, produto_id = n.produto_id,
    origem_cidade = n.origem_cidade, origem_uf = n.origem_uf, local_coleta_id = n.local_coleta_id,
    destino_cidade = n.destino_cidade, destino_uf = n.destino_uf, local_entrega_id = n.local_entrega_id,
    status_liberacao = n.status_liberacao, data_liberacao = n.data_liberacao,
    cadencia_valor = n.cadencia_valor, cadencia_unidade = n.cadencia_unidade,
    toneladas_por_veiculo = n.toneladas_por_veiculo, observacao_interna = n.observacao_interna,
    situacao = n.situacao, versao = r.versao + 1, atualizado_em = now(), atualizado_por = auth.uid(),
    atualizado_por_nome = private.nome_usuario()
  where id = r.id
  returning * into n;

  for k, v in select * from jsonb_each(v_novo) loop
    perform private.registrar('embarque', r.id, r.id, null, n.cliente_id, null, k,
      private.json_texto(to_jsonb(r) -> k), private.json_texto(v));
  end loop;

  if v_novo ?| array['toneladas_por_veiculo', 'cadencia_valor', 'cadencia_unidade'] then
    v_propagadas := private.propagar_capacidade_meta(n);
  end if;

  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(n), 'posicoes_atualizadas', v_propagadas);
end $function$
;

create or replace function private.embarque_suspensao_encerramento()
returns trigger language plpgsql set search_path=public,pg_temp as $fn$
declare
 v_excecoes text[]:=array['situacao','status_liberacao','suspenso_em','encerrado_em',
 'encerrado_por','encerrado_por_nome','encerrado_motivo','versao',
 'atualizado_em','atualizado_por','atualizado_por_nome'];
begin
 if old.encerrado_em is not null then
  if not(private.tem_permissao('embarques.reativar_encerrado')
   and private.pode_ver_embarque(old.id)
   and new.situacao='ativo' and new.status_liberacao='liberado'
   and new.encerrado_em is null and new.encerrado_por is null
   and new.encerrado_por_nome is null and new.encerrado_motivo is null
   and (to_jsonb(old)-v_excecoes)=(to_jsonb(new)-v_excecoes)) then
    raise exception using errcode='42501',message='Embarque encerrado: utilize a reativação autorizada com motivo.';
  end if;
 end if;
 if new.situacao='arquivado' and new.encerrado_em is null then
  raise exception using errcode='55000',message='Use Encerrar para preservar os dados do encerramento.';
 end if;
 if new.status_liberacao='suspenso' and old.status_liberacao is distinct from 'suspenso' then
  new.suspenso_em:=now();
 elsif new.status_liberacao is distinct from 'suspenso' then new.suspenso_em:=null;
 end if;
 return new;
end $fn$;
create or replace function public.reativar_embarque_encerrado(
 p_embarque_id uuid,p_motivo text,p_versao integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare r public.embarques; n public.embarques; v_motivo text:=nullif(btrim(p_motivo),'');
begin
 perform private.exigir('embarques.reativar_encerrado');
 if v_motivo is null or length(v_motivo)>500 then
  raise exception using errcode='22023',message='Informe o motivo da reativação (até 500 caracteres).';
 end if;
 select * into r from public.embarques where id=p_embarque_id for update;
 if not found or not private.pode_ver_embarque(r.id) then
  raise exception using errcode='P0002',message='Embarque não encontrado ou fora do seu escopo.';
 end if;
 if r.encerrado_em is null or r.situacao<>'arquivado' then
  raise exception using errcode='55000',message='Este embarque não está encerrado.';
 end if;
 if p_versao is null or p_versao<>r.versao then
  return jsonb_build_object('status','conflito','registro',to_jsonb(r));
 end if;
 update public.embarques set
  situacao='ativo',status_liberacao='liberado',suspenso_em=null,
  encerrado_em=null,encerrado_por=null,encerrado_por_nome=null,encerrado_motivo=null,
  versao=r.versao+1,atualizado_em=now(),atualizado_por=auth.uid(),
  atualizado_por_nome=private.nome_usuario()
 where id=r.id returning * into n;
 perform private.registrar('embarque',r.id,r.id,null,r.cliente_id,null,'reativacao_encerrado',
  jsonb_build_object('situacao',r.situacao,'status_liberacao',r.status_liberacao,
   'encerrado_em',r.encerrado_em,'encerrado_por',r.encerrado_por,
   'encerrado_por_nome',r.encerrado_por_nome,'encerrado_motivo',r.encerrado_motivo)::text,
  jsonb_build_object('status','liberado','motivo',v_motivo)::text,true);
 return jsonb_build_object('status','ok','registro',to_jsonb(n));
end $fn$;
revoke all on function public.reativar_embarque_encerrado(uuid,text,integer) from public,anon;
grant execute on function public.reativar_embarque_encerrado(uuid,text,integer) to authenticated;
do $fn$
declare r public.embarques;
begin
 for r in select * from public.embarques where status_liberacao='nao_informado' for update loop
  update public.embarques set status_liberacao='liberado',versao=versao+1,
   atualizado_em=now(),atualizado_por=null,atualizado_por_nome='Sistema: correção de status'
  where id=r.id;
  perform private.registrar('embarque',r.id,r.id,null,r.cliente_id,null,'status_liberacao',
   'nao_informado','liberado',false,'correcao_status_20261102');
 end loop;
end $fn$;
alter table public.embarques alter column status_liberacao set default 'liberado';
alter table public.embarques add constraint embarques_status_informado
 check(status_liberacao in('liberado','suspenso'));
alter table public.embarques add constraint embarques_encerramento_consistente
 check((situacao='arquivado' and encerrado_em is not null) or(situacao='ativo' and encerrado_em is null));
create or replace function private.impedir_exclusao_embarque()
returns trigger language plpgsql set search_path=public,pg_temp as $fn$
begin
 raise exception using errcode='55000',
  message='Embarques não podem ser excluídos permanentemente. Utilize Encerrar para preservar o histórico.';
end $fn$;
revoke all on function private.impedir_exclusao_embarque() from public,anon,authenticated;
create trigger embarques_preservar_historico_delete before delete on public.embarques
 for each row execute function private.impedir_exclusao_embarque();
create trigger embarques_preservar_historico_truncate before truncate on public.embarques
 for each statement execute function private.impedir_exclusao_embarque();
commit;
notify pgrst,'reload schema';
