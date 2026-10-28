-- Painel Operacional da aba Análise (pedido de 28/10/2026): filas, atendimento por colaborador, mapa de calor e evolução
-- das demandas do Apoio Operacional.
--
-- O que muda no fluxo:
--   * Histórico de eventos do chamado (solicitacao_eventos), gravado por gatilho a cada mudança real de etapa ou de
--     responsável, com horário do servidor. Só leitura para os usuários; ninguém altera ou apaga pelo app.
--   * Nova etapa "correcao_recebida": a resposta do solicitante volta o chamado para a fila do responsável, que retoma
--     o atendimento explicitamente (retomar_atendimento_doc). Assim a espera pela retomada não se mistura com o
--     tempo em atendimento nem com o tempo aguardando o solicitante.
--   * Pedir ajuste exige motivo categorizado (e descrição quando "Outro"), além da mensagem ao solicitante.
--   * painel_operacional(): devolve só o necessário para os quadros (sem placa, motorista, documentos ou valores),
--     com o mesmo escopo de leitura das solicitações e exigindo a permissão analise.operacional.
--
-- Chamados anteriores: os eventos são preenchidos com os horários que já estavam gravados (envio, assumido, pendências,
-- respostas, conclusão e cancelamento), marcados como origem 'historico'. Antes desta migração a retomada era
-- automática (no instante da resposta) e o motivo da devolução não era registrado ('sem_registro').
-- Só acrescenta tabela, colunas, valores permitidos e funções; não apaga dados.

-- ---------------------------------------------------------------------------
-- Permissão (ajustável em Administração → Permissões)
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('analise.operacional', 'Análise', 'Ver o Painel Operacional (filas, atendimento por colaborador e evolução das demandas do Apoio)')
on conflict do nothing;

insert into public.papel_permissoes (papel, chave) values
  ('gestor', 'analise.operacional'), ('apoio', 'analise.operacional'), ('operacao', 'analise.operacional')
on conflict do nothing;

-- Início da medição completa (retomada explícita e motivo da devolução).
insert into public.configuracoes (chave, valor, descricao)
values ('painel_operacional_inicio', jsonb_build_object('em', now()), 'Início da medição completa do Painel Operacional')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- Etapa "Correção recebida" e motivo da devolução
-- ---------------------------------------------------------------------------
alter table public.solicitacoes_doc
  drop constraint if exists solicitacoes_doc_status_check,
  add constraint solicitacoes_doc_status_check check (status in (
    'enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'documentacao_disponivel', 'cadastro_concluido', 'cancelado'));

alter table public.doc_mensagens
  add column if not exists motivo text check (motivo in (
    'documento_ausente', 'documento_ilegivel', 'divergencia_dados', 'informacao_incompleta', 'outro', 'sem_registro')),
  add column if not exists motivo_outro text check (motivo_outro is null or length(trim(motivo_outro)) between 1 and 200);

create index if not exists solicitacoes_doc_enviado on public.solicitacoes_doc (enviado_em);
create index if not exists solicitacoes_doc_abertas on public.solicitacoes_doc (status)
  where status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida');

-- ---------------------------------------------------------------------------
-- Histórico de eventos do chamado
-- ---------------------------------------------------------------------------
create table if not exists public.solicitacao_eventos (
  id bigint generated always as identity primary key,
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  evento text not null check (evento in (
    'enviado', 'assumido', 'devolvido', 'corrigido', 'retomado', 'transferido', 'concluido', 'cancelado', 'reaberto', 'status_alterado')),
  status_anterior text,
  status_novo text not null,
  ator_id uuid references public.perfis (id),
  ator_nome text not null,
  -- Responsável pelo chamado depois do evento.
  responsavel_id uuid references public.perfis (id),
  responsavel_nome text,
  motivo text check (motivo in (
    'documento_ausente', 'documento_ilegivel', 'divergencia_dados', 'informacao_incompleta', 'outro', 'sem_registro')),
  motivo_outro text,
  mensagem_id uuid references public.doc_mensagens (id),
  -- 'registro': gravado no momento pelo gatilho; 'historico': preenchido nesta migração com horários já gravados.
  origem text not null default 'registro' check (origem in ('registro', 'historico')),
  criado_em timestamptz not null default now(),
  check ((evento = 'devolvido') = (motivo is not null))
);
-- Um mesmo evento não se repete no mesmo instante (reenvio, concorrência ou nova execução desta migração).
create unique index if not exists solicitacao_eventos_unico on public.solicitacao_eventos (solicitacao_id, evento, criado_em);
create index if not exists solicitacao_eventos_criado on public.solicitacao_eventos (criado_em);

alter table public.solicitacao_eventos enable row level security;
drop policy if exists leitura on public.solicitacao_eventos;
create policy leitura on public.solicitacao_eventos for select to authenticated using (private.pode_ver_solicitacao(solicitacao_id));
revoke all on public.solicitacao_eventos from anon, authenticated;
grant select on public.solicitacao_eventos to authenticated;

-- Gatilho: cada mudança gravada de etapa ou de responsável vira um evento (clique que falhou não grava nada).
-- A função de pedir ajuste informa a mensagem da pendência (com o motivo) por uma configuração da transação.
create or replace function private.fluxo_registrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento text;
  v_msg uuid;
  v_motivo text;
  v_outro text;
begin
  if tg_op = 'INSERT' then
    v_evento := 'enviado';
  elsif new.status is distinct from old.status then
    v_evento := case
      when old.status = 'enviado' and new.status = 'em_atendimento' then 'assumido'
      when new.status = 'aguardando_informacao' then 'devolvido'
      when old.status = 'aguardando_informacao' and new.status in ('correcao_recebida', 'em_atendimento') then 'corrigido'
      when old.status = 'correcao_recebida' and new.status = 'em_atendimento' then 'retomado'
      when new.status in ('documentacao_disponivel', 'cadastro_concluido') then 'concluido'
      when new.status = 'cancelado' then 'cancelado'
      when old.status in ('documentacao_disponivel', 'cadastro_concluido', 'cancelado') then 'reaberto'
      else 'status_alterado' end;
  elsif new.responsavel_id is distinct from old.responsavel_id then
    v_evento := 'transferido';
  else
    return null;
  end if;
  if v_evento = 'devolvido' then
    v_msg := nullif(current_setting('travion.fluxo_mensagem', true), '')::uuid;
    select m.motivo, m.motivo_outro into v_motivo, v_outro from public.doc_mensagens m where m.id = v_msg and m.solicitacao_id = new.id;
    if not found then v_msg := null; end if;
  end if;
  insert into public.solicitacao_eventos (solicitacao_id, evento, status_anterior, status_novo, ator_id, ator_nome,
    responsavel_id, responsavel_nome, motivo, motivo_outro, mensagem_id, criado_em)
  values (new.id, v_evento, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(), coalesce(private.nome_usuario(), 'Sistema'),
    new.responsavel_id, new.responsavel_nome,
    case when v_evento = 'devolvido' then coalesce(v_motivo, 'sem_registro') end, v_outro, v_msg,
    case when tg_op = 'INSERT' then new.enviado_em else now() end);
  return null;
end $$;

drop trigger if exists solicitacoes_doc_fluxo on public.solicitacoes_doc;
create trigger solicitacoes_doc_fluxo
  after insert or update of status, responsavel_id on public.solicitacoes_doc
  for each row execute function private.fluxo_registrar();

-- Chamados que já existiam: eventos com os horários gravados na época (sem estimativa).
insert into public.solicitacao_eventos (solicitacao_id, evento, status_anterior, status_novo, ator_id, ator_nome,
  responsavel_id, responsavel_nome, motivo, mensagem_id, origem, criado_em)
select id, 'enviado', null::text, 'enviado', solicitante_id, solicitante_nome, null::uuid, null::text, null::text, null::uuid, 'historico', enviado_em
  from public.solicitacoes_doc
union all
select id, 'assumido', 'enviado', 'em_atendimento', responsavel_id, responsavel_nome, responsavel_id, responsavel_nome, null, null, 'historico', assumido_em
  from public.solicitacoes_doc where assumido_em is not null and responsavel_id is not null
union all
select m.solicitacao_id, 'devolvido', 'em_atendimento', 'aguardando_informacao', m.autor_id, m.autor_nome, s.responsavel_id, s.responsavel_nome,
       'sem_registro', m.id, 'historico', m.criado_em
  from public.doc_mensagens m join public.solicitacoes_doc s on s.id = m.solicitacao_id where m.tipo = 'pendencia'
union all
select m.solicitacao_id, 'corrigido', 'aguardando_informacao', 'em_atendimento', m.autor_id, m.autor_nome, s.responsavel_id, s.responsavel_nome,
       null, null, 'historico', m.criado_em
  from public.doc_mensagens m join public.solicitacoes_doc s on s.id = m.solicitacao_id where m.tipo = 'resposta'
union all
-- No fluxo anterior a resposta já voltava o chamado para Em atendimento: retomada no mesmo instante.
select m.solicitacao_id, 'retomado', 'aguardando_informacao', 'em_atendimento', null, 'Automática (fluxo anterior)', s.responsavel_id, s.responsavel_nome,
       null, null, 'historico', m.criado_em
  from public.doc_mensagens m join public.solicitacoes_doc s on s.id = m.solicitacao_id where m.tipo = 'resposta'
union all
select id, 'concluido', null, status, null, coalesce(concluido_por_nome, 'Sem registro'), responsavel_id, responsavel_nome, null, null, 'historico', concluido_em
  from public.solicitacoes_doc where status in ('documentacao_disponivel', 'cadastro_concluido') and concluido_em is not null
union all
select id, 'cancelado', null, 'cancelado', null, coalesce(cancelado_por_nome, 'Sem registro'), responsavel_id, responsavel_nome, null, null, 'historico', cancelado_em
  from public.solicitacoes_doc where status = 'cancelado' and cancelado_em is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Apoio: pedir ajuste com motivo; solicitante responde (vai para Correção recebida); apoio retoma
-- ---------------------------------------------------------------------------
drop function if exists public.solicitar_ajuste_doc(uuid, text, text);
create or replace function public.solicitar_ajuste_doc(
  p_id uuid, p_texto text, p_referencia text default null, p_motivo text default null, p_motivo_outro text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_msg uuid;
  v_outro text := nullif(left(trim(coalesce(p_motivo_outro, '')), 200), '');
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if p_motivo is null or p_motivo not in ('documento_ausente', 'documento_ilegivel', 'divergencia_dados', 'informacao_incompleta', 'outro') then
    perform private.doc_erro('22023', 'Escolha o motivo da devolução.');
  end if;
  if p_motivo = 'outro' and v_outro is null then perform private.doc_erro('22023', 'Descreva o motivo "Outro".'); end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then perform private.doc_erro('22023', 'Descreva o que falta ou precisa ser corrigido.'); end if;
  v_msg := private.doc_evento(s.id, 'pendencia', left(trim(p_texto), 4000), nullif(trim(coalesce(p_referencia, '')), ''));
  update public.doc_mensagens set motivo = p_motivo, motivo_outro = case when p_motivo = 'outro' then v_outro end where id = v_msg;
  perform set_config('travion.fluxo_mensagem', v_msg::text, true);
  update public.solicitacoes_doc set status = 'aguardando_informacao', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform set_config('travion.fluxo_mensagem', '', true);
  perform private.doc_notificar(s.solicitante_id, 'ajuste_solicitado', 'Ajuste solicitado pelo apoio',
    format('%s nº %s · %s: %s', private.doc_rotulo(s), s.numero, s.placa, left(trim(p_texto), 140)),
    s, case when s.tipo = 'cadastro' then 'cadastro' else 'embarque' end, 'ajuste:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.responder_ajuste_doc(p_id uuid, p_texto text, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_msg uuid;
  v_mot integer;
  v_vei integer;
begin
  s := private.doc_carregar(p_id);
  perform private.exigir(case when s.tipo = 'cadastro' then 'cadastro.solicitar' else 'documentacao.solicitar' end);
  if s.status <> 'aguardando_informacao' then
    perform private.doc_erro('55000', 'Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
  end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then perform private.doc_erro('22023', 'Escreva a resposta para o apoio.'); end if;
  v_msg := private.doc_evento(s.id, 'resposta', left(trim(p_texto), 4000));
  perform private.doc_vincular_anexos(s.id, p_anexos,
    case when s.tipo = 'cadastro' then array['motorista', 'veiculo', 'correcao'] else array['nf', 'evidencia_frete', 'correcao'] end, v_msg);
  if s.tipo = 'cadastro' then
    -- Correções entram como nova versão: os anteriores ficam; o limite vale para os arquivos desta resposta.
    select count(*) filter (where categoria = 'motorista'), count(*) filter (where categoria = 'veiculo')
      into v_mot, v_vei from public.doc_anexos where mensagem_id = v_msg;
    if v_mot > 4 or v_vei > 10 then
      perform private.doc_erro('22023', 'Na resposta: até 4 documentos do motorista e 10 dos veículos.');
    end if;
  end if;
  -- Volta para a fila do responsável: a nova espera começa agora, até ele retomar.
  update public.solicitacoes_doc set status = 'correcao_recebida', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.responsavel_id, 'resposta_enviada', 'Correção recebida: retome o atendimento',
    format('%s nº %s · %s: %s', private.doc_rotulo(s), s.numero, s.placa, left(trim(p_texto), 140)),
    s, 'apoio', 'resposta:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.retomar_atendimento_doc(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  if s.status = 'em_atendimento' and s.responsavel_id = auth.uid() then
    return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s)); -- já retomado (clique repetido)
  end if;
  perform private.doc_exigir_responsavel(s, array['correcao_recebida']);
  update public.solicitacoes_doc set status = 'em_atendimento', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Atendimento retomado por ' || coalesce(private.nome_usuario(), 'Usuário'));
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- Cadastro em aberto para a mesma placa: a nova etapa também conta como aberta.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.criar_solicitacao_cadastro(jsonb, jsonb)'::regprocedure);
  if position('correcao_recebida' in v_def) > 0 then return; end if; -- já aplicado
  if position($q$status in ('enviado', 'em_atendimento', 'aguardando_informacao')$q$ in v_def) = 0 then
    raise exception 'criar_solicitacao_cadastro: trecho da regra de cadastro em aberto não encontrado';
  end if;
  execute replace(v_def, $q$status in ('enviado', 'em_atendimento', 'aguardando_informacao')$q$,
    $q$status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida')$q$);
end $$;

-- ---------------------------------------------------------------------------
-- Dados do painel: chamados enviados no período (ou ainda abertos) e seus eventos, no escopo de quem consulta.
-- p_alterados_desde: só o que mudou a partir desse instante (consulta incremental de reforço).
-- ---------------------------------------------------------------------------
create or replace function public.painel_operacional(p_desde timestamptz, p_ate timestamptz, p_alterados_desde timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform private.exigir('analise.operacional');
  if p_desde is null or p_ate is null or p_ate <= p_desde then perform private.doc_erro('22023', 'Período inválido.'); end if;
  if p_ate - p_desde > interval '400 days' then perform private.doc_erro('22023', 'Escolha um período de até 400 dias.'); end if;
  with base as (
    select s.id, s.numero, s.tipo, s.status, s.retrato ->> 'filial_id' as filial_id, s.retrato ->> 'centro_custo_id' as centro_custo_id,
           s.solicitante_id, s.solicitante_nome, s.responsavel_id, s.responsavel_nome, s.enviado_em
      from public.solicitacoes_doc s
     where ((s.enviado_em >= p_desde and s.enviado_em < p_ate)
            or s.status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida'))
       and (p_alterados_desde is null or s.atualizado_em >= p_alterados_desde)
       and private.pode_ver_solicitacao_reg(s)
  )
  select jsonb_build_object(
    'agora', clock_timestamp(),
    'inicio_registro', (select c.valor ->> 'em' from public.configuracoes c where c.chave = 'painel_operacional_inicio'),
    'inicio_dados', (select min(x.enviado_em) from public.solicitacoes_doc x),
    'solicitacoes', coalesce((select jsonb_agg(to_jsonb(b) order by b.enviado_em) from base b), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('s', e.solicitacao_id, 'evento', e.evento, 'em', e.criado_em,
               'responsavel_id', e.responsavel_id, 'responsavel_nome', e.responsavel_nome, 'motivo', e.motivo, 'origem', e.origem)
             order by e.criado_em, e.id)
        from public.solicitacao_eventos e join base b on b.id = e.solicitacao_id), '[]'::jsonb))
  into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
revoke all on function private.fluxo_registrar() from public, anon, authenticated;
revoke all on function public.solicitar_ajuste_doc(uuid, text, text, text, text), public.retomar_atendimento_doc(uuid),
  public.painel_operacional(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.solicitar_ajuste_doc(uuid, text, text, text, text), public.retomar_atendimento_doc(uuid),
  public.painel_operacional(timestamptz, timestamptz, timestamptz) to authenticated;
