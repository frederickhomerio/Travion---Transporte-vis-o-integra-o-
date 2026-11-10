-- Estadia: dois relógios (pedido do Frederick, 05/11/2026, aprovado em 10/11/2026).
--
-- Relógio Transpanorama: corre na fila, no atendimento e aguardando correção do solicitante.
-- Relógio Cliente: abre quando o apoio clica "Aguardando retorno do cliente" e fecha na data e hora em que o
-- cliente respondeu (informada no registro do retorno). Cada reenvio ao cliente abre uma nova rodada; o tempo
-- do cliente é a soma das rodadas. A demora entre a resposta do cliente e o registro no app volta para a TP.
-- Pago em pendência depois do encaminhamento continua no relógio do cliente; pagamento antes de encaminhar
-- fica na TP até o apoio encaminhar (o encaminhamento passa a ser aceito também em Pago em pendência).
-- Prazo de resposta do cliente: até 7 dias no prazo, de 7 a 15 dias atenção, acima de 15 dias atrasado.
-- Ao passar de 7 e de 15 dias, o solicitante e o usuário ligado ao comercial do cliente recebem aviso no app.
--
-- Não apaga dados. Reexecutável.

alter table public.solicitacoes_doc
  add column if not exists est_cliente_desde timestamptz,
  add column if not exists est_cliente_seg integer not null default 0 check (est_cliente_seg >= 0),
  add column if not exists est_rodadas_cliente smallint not null default 0 check (est_rodadas_cliente >= 0);

comment on column public.solicitacoes_doc.est_cliente_desde is 'Estadia: início da rodada aberta com o cliente (relógio do cliente correndo). Nulo = relógio do cliente parado.';
comment on column public.solicitacoes_doc.est_cliente_seg is 'Estadia: segundos com o cliente nas rodadas já fechadas (encaminhamento → resposta do cliente).';
comment on column public.solicitacoes_doc.est_rodadas_cliente is 'Estadia: quantas vezes foi encaminhada ao cliente.';

alter table public.estadia_retornos
  add column if not exists retorno_em timestamptz,
  add column if not exists rodada smallint,
  add column if not exists tempo_cliente_seg integer;

comment on column public.estadia_retornos.retorno_em is 'Data e hora em que o cliente respondeu (informada pelo apoio).';
comment on column public.estadia_retornos.tempo_cliente_seg is 'Segundos da rodada: encaminhamento → resposta do cliente. Nulo quando o retorno veio sem encaminhamento.';

-- Rodadas que já estão abertas: o relógio do cliente começa no encaminhamento já registrado.
update public.solicitacoes_doc
   set est_cliente_desde = est_encaminhado_em, est_rodadas_cliente = greatest(est_rodadas_cliente, 1)
 where tipo = 'estadia' and status in ('aguardando_cliente', 'pago_pendencia')
   and est_encaminhado_em is not null and est_cliente_desde is null;

-- ---------------------------------------------------------------------------
-- Encaminhar ao cliente: abre a rodada (em atendimento, ou pago em pendência sem rodada aberta).
-- ---------------------------------------------------------------------------
create or replace function public.encaminhar_cliente_estadia(p_id uuid, p_observacao text, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_obs text := nullif(left(trim(coalesce(p_observacao, '')), 1000), '');
begin
  s := private.estadia_carregar(p_id, p_versao);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'pago_pendencia']);
  if s.est_conferencia_id is null then perform private.doc_erro('55000', 'Salve a memória de cálculo antes de aguardar o retorno do cliente.'); end if;
  if s.est_cliente_desde is not null then perform private.doc_erro('55000', 'Esta estadia já está aguardando o retorno do cliente.'); end if;
  update public.solicitacoes_doc
     set status = case when s.status = 'em_atendimento' then 'aguardando_cliente' else s.status end,
         est_encaminhado_em = now(), est_cliente_desde = now(), est_rodadas_cliente = est_rodadas_cliente + 1,
         versao = versao + 1, atualizado_em = now()
   where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', format('Encaminhada ao cliente pelo apoio (fora do app)%s, conferência v%s: R$ %s · relógio da TP pausado, relógio do cliente aberto%s',
    case when s.est_rodadas_cliente > 1 then format(' · rodada %s', s.est_rodadas_cliente) else '' end,
    s.est_conferencia_versao, to_char(s.est_valor_calculado, 'FM999G999G990D00'), coalesce(' · ' || v_obs, '')), 'cliente');
  perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia aguardando retorno do cliente',
    format('%s · %s · valor calculado R$ %s', private.doc_titulo(s), s.retrato ->> 'cliente', to_char(s.est_valor_calculado, 'FM999G999G990D00')),
    s, 'estadia', 'estadia_cliente:' || s.id || ':' || s.versao);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- ---------------------------------------------------------------------------
-- Retorno do cliente: fecha a rodada na data e hora em que o cliente respondeu.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_retorno_estadia(p_id uuid, p_dados jsonb, p_anexos jsonb, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_res text := p_dados ->> 'resultado';
  v_valor numeric := private.estadia_numero(p_dados ->> 'valor_aprovado', 'Valor aprovado');
  v_just text := nullif(left(trim(coalesce(p_dados ->> 'justificativa', '')), 2000), '');
  v_retorno timestamptz;
  v_data date;
  v_antes text;
  v_novo text;
  v_msg uuid;
  v_ret public.estadia_retornos;
  v_desde timestamptz := now();
  v_rodada_seg integer;
begin
  s := private.estadia_carregar(p_id, p_versao);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_cliente', 'pago_pendencia']);
  if s.est_conferencia_id is null then perform private.doc_erro('55000', 'Salve a memória de cálculo antes de registrar o retorno do cliente.'); end if;
  if v_res is null or v_res not in ('aprovada', 'aprovada_parcial', 'rejeitada') then perform private.doc_erro('22023', 'Escolha o resultado do cliente.'); end if;
  if v_just is null then perform private.doc_erro('22023', 'Descreva o retorno do cliente (justificativa).'); end if;
  -- Data e hora da resposta do cliente. Versões antigas da tela mandavam só a data: vale o horário do registro.
  begin
    v_retorno := nullif(p_dados ->> 'retorno_em', '')::timestamptz;
  exception when others then perform private.doc_erro('22023', 'Data e hora do retorno inválidas.');
  end;
  v_retorno := coalesce(v_retorno, now());
  if v_retorno > now() + interval '5 minutes' then perform private.doc_erro('22023', 'A data e a hora do retorno não podem estar no futuro.'); end if;
  if s.est_cliente_desde is not null and v_retorno < s.est_cliente_desde then
    perform private.doc_erro('22023', format('O retorno não pode ser antes do encaminhamento ao cliente (%s).',
      to_char(s.est_cliente_desde at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
  end if;
  v_data := (v_retorno at time zone 'America/Sao_Paulo')::date;
  v_rodada_seg := case when s.est_cliente_desde is not null then floor(extract(epoch from v_retorno - s.est_cliente_desde))::integer end;
  if v_res = 'rejeitada' then v_valor := null;
  elsif v_res = 'aprovada' then v_valor := round(coalesce(v_valor, s.est_valor_calculado), 2);
  else v_valor := round(v_valor, 2);
  end if;
  if v_res <> 'rejeitada' and (v_valor is null or v_valor <= 0) then perform private.doc_erro('22023', 'Informe o valor aprovado pelo cliente (maior que zero).'); end if;

  v_antes := s.status;
  v_novo := case v_res when 'aprovada' then 'aprovada' when 'aprovada_parcial' then 'aprovada_parcial' else 'em_atendimento' end;
  v_msg := private.doc_evento(s.id, 'evento', format('Retorno do cliente registrado (%s): %s%s · %s%s%s',
    to_char(v_retorno at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    case v_res when 'aprovada' then 'Aprovada' when 'aprovada_parcial' then 'Aprovada parcialmente' else 'Rejeitada' end,
    case when v_valor is not null then ', valor aprovado R$ ' || to_char(v_valor, 'FM999G999G990D00') else '' end,
    v_just,
    case when v_rodada_seg is not null then format(' · cliente levou %s (rodada %s)', private.estadia_fmt_duracao(v_rodada_seg), s.est_rodadas_cliente) else '' end,
    case when v_antes = 'pago_pendencia' and v_novo = 'aprovada' then ' · situação Pago em pendência → Aprovada (pagamento e pendência de receita continuam registrados)'
         when v_antes = 'pago_pendencia' and v_novo = 'aprovada_parcial' then ' · situação Pago em pendência → Aprovada parcialmente (pagamento continua registrado)'
         else '' end), 'retorno');
  perform private.doc_vincular_anexos(s.id, p_anexos, array['est_retorno'], v_msg);
  if not exists (select 1 from public.doc_anexos where mensagem_id = v_msg and categoria = 'est_retorno') then
    perform private.doc_erro('22023', 'Anexe a evidência do retorno do cliente.');
  end if;
  perform private.estadia_conferir_limites(s.id, v_msg, v_desde);
  insert into public.estadia_retornos (solicitacao_id, resultado, valor_aprovado, justificativa, data_retorno, retorno_em, rodada, tempo_cliente_seg,
    conferencia_id, valor_calculado, status_anterior, status_novo, mensagem_id, autor_id, autor_nome)
  values (s.id, v_res, v_valor, v_just, v_data, v_retorno, case when v_rodada_seg is not null then s.est_rodadas_cliente end, v_rodada_seg,
    s.est_conferencia_id, s.est_valor_calculado, v_antes, v_novo, v_msg, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'))
  returning * into v_ret;
  update public.solicitacoes_doc set status = v_novo, est_resultado = v_res, est_valor_aprovado = v_valor, est_retorno_em = now(),
    est_cliente_seg = est_cliente_seg + coalesce(v_rodada_seg, 0), est_cliente_desde = null,
    concluido_em = case when v_novo in ('aprovada', 'aprovada_parcial') then now() else concluido_em end,
    concluido_por_nome = case when v_novo in ('aprovada', 'aprovada_parcial') then coalesce(private.nome_usuario(), 'Usuário') else concluido_por_nome end,
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada',
    case v_res when 'aprovada' then 'Estadia aprovada pelo cliente' when 'aprovada_parcial' then 'Estadia aprovada parcialmente' else 'Estadia rejeitada pelo cliente' end,
    format('%s · %s%s', private.doc_titulo(s), s.retrato ->> 'cliente', case when v_valor is not null then ' · R$ ' || to_char(v_valor, 'FM999G999G990D00') else '' end),
    s, 'estadia', 'estadia_retorno:' || v_ret.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'retorno', to_jsonb(v_ret));
end $$;

-- "3 d 4 h", "5 h 12 min", "40 min"
create or replace function private.estadia_fmt_duracao(p_seg integer)
returns text
language sql
immutable
as $$
  select case
    when p_seg < 3600 then (greatest(p_seg, 0) / 60) || ' min'
    when p_seg < 86400 then (p_seg / 3600) || ' h ' || lpad(((p_seg % 3600) / 60)::text, 2, '0') || ' min'
    else (p_seg / 86400) || ' d ' || ((p_seg % 86400) / 3600) || ' h' end
$$;

-- ---------------------------------------------------------------------------
-- Cancelamento (ou qualquer saída da etapa do cliente sem retorno): fecha a rodada aberta no horário da mudança.
-- ---------------------------------------------------------------------------
create or replace function private.estadia_fechar_rodada()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.est_cliente_desde is not null and new.status not in ('aguardando_cliente', 'pago_pendencia') then
    new.est_cliente_seg := new.est_cliente_seg + greatest(0, floor(extract(epoch from now() - new.est_cliente_desde))::integer);
    new.est_cliente_desde := null;
  end if;
  return new;
end $$;

drop trigger if exists solicitacoes_doc_estadia_rodada on public.solicitacoes_doc;
create trigger solicitacoes_doc_estadia_rodada before update of status on public.solicitacoes_doc
  for each row when (new.tipo = 'estadia') execute function private.estadia_fechar_rodada();

-- ---------------------------------------------------------------------------
-- Aviso de prazo do cliente (7 e 15 dias): solicitante e usuário ligado ao comercial do cliente.
-- A chave da notificação evita aviso repetido na mesma rodada.
-- ---------------------------------------------------------------------------
create or replace function private.estadia_alertar_cliente()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_dias integer;
  v_nivel integer;
  v_titulo text;
  v_texto text;
  v_chave text;
  v_dest uuid;
begin
  for s in
    select * from public.solicitacoes_doc
     where tipo = 'estadia' and est_cliente_desde is not null and status in ('aguardando_cliente', 'pago_pendencia')
       and est_cliente_desde <= now() - interval '7 days'
  loop
    v_dias := floor(extract(epoch from now() - s.est_cliente_desde) / 86400)::integer;
    v_nivel := case when v_dias >= 15 then 15 else 7 end;
    v_titulo := case when v_nivel = 15 then 'Cliente sem retorno há mais de 15 dias' else 'Cliente sem retorno há mais de 7 dias' end;
    v_texto := format('%s · %s · R$ %s aguardando desde %s', private.doc_titulo(s), coalesce(s.retrato ->> 'cliente', 'cliente'),
      to_char(coalesce(s.est_valor_calculado, 0), 'FM999G999G990D00'), to_char(s.est_cliente_desde at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'));
    v_chave := format('estadia_prazo_cliente:%s:%s:%s', s.id, s.est_rodadas_cliente, v_nivel);
    perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', v_titulo, v_texto, s, 'estadia', v_chave);
    for v_dest in
      select p.id from public.perfis p
       where p.status = 'ativo' and p.id is distinct from s.solicitante_id and s.comercial_id is not null
         and (p.comercial_id = s.comercial_id
              or exists (select 1 from public.comerciais c where c.id = s.comercial_id and c.email is not null and lower(c.email) = lower(p.email)))
    loop
      perform private.doc_notificar(v_dest, 'estadia_atualizada', v_titulo, v_texto, s, 'estadia', v_chave);
    end loop;
  end loop;
end $$;

revoke all on function private.estadia_alertar_cliente() from public, anon, authenticated;

do $agenda$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('travion-estadia-prazo-cliente', '23 * * * *', 'select private.estadia_alertar_cliente()');
end $agenda$;

notify pgrst, 'reload schema';
