-- 07/11: o embarcador devolve a documentação emitida quando ela chegou errada.
-- Hoje, depois de "Documentação disponível", não havia caminho de volta: o erro era tratado por fora (WhatsApp, telefone)
-- e não ficava registro. Agora:
--   * Nova permissão documentacao.devolver (ajustável em Administração → Permissões); padrão: quem já pede emissão
--     (Gestor, Supervisor, Embarcador, Coordenador Comercial).
--   * Só em Lote e Emissão ou Emissão com a documentação liberada (documentacao_disponivel), dentro do escopo do usuário.
--   * Motivo (lista) + descrição obrigatória + prints/fotos opcionais (categoria "correcao").
--   * Os documentos emitidos daquela liberação ficam marcados como devolvidos (não somem: ficam no histórico, riscados);
--     o embarcador deixa de baixá-los e o apoio precisa anexar os corrigidos para liberar de novo.
--   * A solicitação volta para a fila de quem liberou, como "Correção recebida" (outra pessoa do apoio pode reassumir).
--   * Registro: mensagem no histórico, evento "reaberto" no fluxo (gatilho), contador de devoluções e aviso no sino do apoio.
-- Não apaga nada. Reexecutável.

insert into public.permissoes (chave, grupo, descricao) values
  ('documentacao.devolver', 'Documentação', 'Devolver ao apoio a documentação emitida (CT-e, MDF-e) que chegou errada, com motivo')
on conflict (chave) do update set grupo = excluded.grupo, descricao = excluded.descricao;

insert into public.papel_permissoes (papel, chave)
select distinct pp.papel, 'documentacao.devolver' from public.papel_permissoes pp where pp.chave = 'documentacao.solicitar'
on conflict do nothing;

alter table public.solicitacoes_doc
  add column if not exists devolucoes integer not null default 0,
  add column if not exists devolvida_em timestamptz,
  add column if not exists devolvida_por_nome text,
  add column if not exists devolvida_motivo text;

alter table public.doc_anexos
  add column if not exists devolvido_em timestamptz;

alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'ajuste_solicitado', 'documentacao_disponivel', 'resposta_enviada', 'cadastro_concluido', 'estadia_atualizada', 'documentacao_devolvida'));

create or replace function public.devolver_documentacao_doc(p_id uuid, p_motivo text, p_texto text, p_anexos jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_nome text := coalesce(private.nome_usuario(), 'Usuário');
  v_texto text := left(trim(coalesce(p_texto, '')), 2000);
  v_rotulo text;
  v_msg uuid;
  v_n integer;
begin
  perform private.exigir('documentacao.devolver');
  s := private.doc_carregar(p_id);
  if s.tipo not in ('lote_emissao', 'emissao') then
    perform private.doc_erro('55000', 'Só dá para devolver documentação de Lote e Emissão ou Emissão.');
  end if;
  if s.status <> 'documentacao_disponivel' then
    perform private.doc_erro('55000', 'Só dá para devolver documentação já liberada (esta solicitação está em outra etapa).');
  end if;
  v_rotulo := case p_motivo
    when 'cte_errado' then 'CT-e com dados errados'
    when 'mdfe_errado' then 'MDF-e com dados errados'
    when 'documento_faltando' then 'Documento faltando'
    when 'arquivo_errado' then 'Arquivo errado ou de outro veículo'
    when 'outro' then 'Outro' end;
  if v_rotulo is null then perform private.doc_erro('22023', 'Escolha o motivo da devolução.'); end if;
  if length(v_texto) = 0 then perform private.doc_erro('22023', 'Descreva o que está errado na documentação.'); end if;

  v_msg := private.doc_evento(s.id, 'evento',
    format('Documentação devolvida por %s. Motivo: %s. %s', v_nome, v_rotulo, v_texto), 'devolucao');
  v_n := private.doc_vincular_anexos(s.id, p_anexos, array['correcao'], v_msg);

  update public.doc_anexos set devolvido_em = now()
  where solicitacao_id = s.id and categoria in ('cte', 'mdfe', 'outro_emitido') and devolvido_em is null;

  update public.solicitacoes_doc set
    status = case when responsavel_id is null then 'enviado' else 'correcao_recebida' end,
    concluido_em = null, concluido_por_nome = null,
    devolucoes = devolucoes + 1, devolvida_em = now(), devolvida_por_nome = v_nome, devolvida_motivo = v_rotulo,
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;

  perform private.doc_notificar(s.responsavel_id, 'documentacao_devolvida', 'Documentação devolvida: corrija e libere de novo',
    format('%s nº %s · %s · %s: %s', private.doc_rotulo(s), s.numero, s.placa, v_rotulo, left(v_texto, 120)),
    s, 'apoio', 'devolvida:' || s.id || ':' || s.devolucoes);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'anexos', v_n);
end $$;

revoke all on function public.devolver_documentacao_doc(uuid, text, text, jsonb) from public, anon;
grant execute on function public.devolver_documentacao_doc(uuid, text, text, jsonb) to authenticated;

-- Liberar de novo exige ao menos um documento emitido que não foi devolvido.
create or replace function public.concluir_solicitacao_doc(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if s.tipo = 'cadastro' then perform private.doc_erro('55000', 'Use "Confirmar cadastro concluído" para cadastros.'); end if;
  if s.tipo = 'estadia' then perform private.doc_erro('55000', 'Estadia termina pelo retorno do cliente ou por Encerrar.'); end if;
  if not exists (select 1 from public.doc_anexos where solicitacao_id = s.id and categoria in ('cte', 'mdfe', 'outro_emitido')
                 and devolvido_em is null) then
    perform private.doc_erro('55000', case when s.devolucoes > 0
      then 'A documentação anterior foi devolvida: anexe os documentos corrigidos (CT-e, MDF-e ou outro) antes de liberar.'
      else 'Anexe ao menos um documento emitido (CT-e, MDF-e ou outro) antes de liberar.' end);
  end if;
  if s.tipo = 'lote_emissao' and s.lote_id is null then
    perform private.doc_erro('55000', 'Registre o número do lote gerado no ERP antes de liberar a documentação.');
  end if;
  if s.tipo = 'emissao' and s.lote_id is null then
    perform private.doc_erro('55000', 'Esta emissão está na fila do lote em geração: registre o lote na solicitação de lote e emissão antes de liberar.');
  end if;
  update public.solicitacoes_doc set status = 'documentacao_disponivel', concluido_em = now(),
    concluido_por_nome = coalesce(private.nome_usuario(), 'Usuário'), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', case when s.devolucoes > 0
    then 'Documentação corrigida, conferida e liberada de novo por ' || s.concluido_por_nome
    else 'Documentação disponível, conferida e liberada por ' || s.concluido_por_nome end);
  perform private.doc_notificar(s.solicitante_id, 'documentacao_disponivel',
    case when s.devolucoes > 0 then 'Documentação corrigida disponível' else 'Documentação disponível' end,
    format('%s nº %s · %s · %s', private.doc_rotulo(s), s.numero, s.placa, s.retrato ->> 'cliente'),
    s, 'embarque', 'disponivel:' || s.id || case when s.devolucoes > 0 then ':' || s.devolucoes else '' end);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- Conferência NF × CT-e na liberação: CT-es devolvidos não contam (só os documentos atuais).
create or replace function private.auditoria_ao_liberar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_div text[];
  v_ate text[];
  v_motivo text := nullif(trim(coalesce(current_setting('travion.motivo_liberacao', true), '')), '');
  v_det jsonb;
begin
  if new.status <> 'documentacao_disponivel' or old.status = 'documentacao_disponivel'
     or new.tipo not in ('lote_emissao', 'emissao') then
    return new;
  end if;
  select
    case when count(*) = 0 then 'sem_conferencia'
         when bool_or(a.status = 'divergente') then 'divergente'
         when bool_or(a.status = 'processando') then 'processando'
         when bool_or(a.status = 'erro') then 'erro'
         when bool_or(a.status = 'alerta') then 'alerta'
         else 'conferido' end,
    jsonb_agg(jsonb_build_object('auditoria_id', a.id, 'anexo_id', a.anexo_id, 'status', a.status, 'tentativas', a.tentativas))
  into v_status, v_det
  from public.auditoria_participantes a
  where a.solicitacao_id = new.id
    and not exists (select 1 from public.doc_anexos x where x.id = a.anexo_id and x.devolvido_em is not null);
  select coalesce(array_agg(distinct c), '{}') into v_div
  from public.auditoria_participantes a, unnest(private.auditoria_campos(a.resultado, array['divergente'])) c
  where a.solicitacao_id = new.id
    and not exists (select 1 from public.doc_anexos x where x.id = a.anexo_id and x.devolvido_em is not null);
  select coalesce(array_agg(distinct c), '{}') into v_ate
  from public.auditoria_participantes a, unnest(private.auditoria_campos(a.resultado, array['alerta', 'nao_lido'])) c
  where a.solicitacao_id = new.id
    and not exists (select 1 from public.doc_anexos x where x.id = a.anexo_id and x.devolvido_em is not null);
  if v_status <> 'conferido' and v_motivo is null then
    perform private.doc_erro('55000', 'A conferência automática não está toda verde (' ||
      case v_status when 'divergente' then 'divergência' when 'alerta' then 'atenção' when 'processando' then 'ainda lendo'
        else 'não conferido' end || '). Para liberar assim, escreva o motivo.');
  end if;
  insert into public.auditoria_registros (evento, solicitacao_id, status_conferencia, campos_divergentes, campos_atencao,
    detalhe, motivo, ator_id, ator_nome, retrato)
  values ('liberado', new.id, v_status, v_div, v_ate, jsonb_build_object('conferencias', coalesce(v_det, '[]'::jsonb)),
    left(v_motivo, 1000), auth.uid(), coalesce(new.concluido_por_nome, private.nome_usuario()), private.auditoria_retrato(new.id, null));
  if v_motivo is not null then
    perform private.doc_evento(new.id, 'evento', 'Liberada com a conferência em ' ||
      case v_status when 'divergente' then 'DIVERGÊNCIA' when 'alerta' then 'atenção' when 'processando' then 'leitura em andamento'
        when 'conferido' then 'tudo conferido' else 'não conferido' end || '. Motivo: ' || left(v_motivo, 500));
  end if;
  return new;
end $$;

revoke all on function private.auditoria_ao_liberar() from public, anon, authenticated;
