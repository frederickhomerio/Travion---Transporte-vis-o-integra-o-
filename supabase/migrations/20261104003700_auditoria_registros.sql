-- Registro permanente da conferência NF × CT-e (pedido de 04/11/2026): quem enviou cada CT-e, o que a conferência
-- mostrou e em que situação a documentação foi liberada ao comercial. Só recebe linhas novas: ninguém edita nem apaga.
-- Base para relatórios (liberados com divergência por pessoa/mês, acerto por emissor, campos que mais divergem).
--
-- Regra (Frederick, 04/11): liberar exige motivo escrito sempre que a conferência NÃO estiver toda verde
-- (divergência, atenção, ainda lendo, não conferido ou sem conferência). Ver concluir_solicitacao_doc_motivo.

create table public.auditoria_registros (
  id bigint generated always as identity primary key,
  evento text not null check (evento in ('cte_enviado', 'conferencia', 'reconferir', 'liberado')),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  auditoria_id uuid references public.auditoria_participantes (id),
  anexo_id uuid references public.doc_anexos (id),
  -- Situação da conferência no momento do fato (na liberação: a pior entre os CT-es da solicitação).
  status_conferencia text check (status_conferencia in ('processando', 'conferido', 'alerta', 'divergente', 'erro', 'sem_conferencia')),
  campos_divergentes text[] not null default '{}',
  campos_atencao text[] not null default '{}',
  detalhe jsonb not null default '{}'::jsonb,
  motivo text,
  ator_id uuid,
  ator_nome text,
  -- Retrato da solicitação no momento (número, tipo, placa, cliente, filial, centro de custo, lote, nome do arquivo).
  retrato jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index auditoria_registros_solicitacao on public.auditoria_registros (solicitacao_id, criado_em);
create index auditoria_registros_evento on public.auditoria_registros (evento, criado_em);
create index auditoria_registros_ator on public.auditoria_registros (ator_id, criado_em);

alter table public.auditoria_registros enable row level security;
create policy leitura on public.auditoria_registros for select to authenticated
  using (private.pode_ver_solicitacao(solicitacao_id));
revoke all on public.auditoria_registros from anon, authenticated;
grant select on public.auditoria_registros to authenticated;

-- Só inclusão: bloqueia alteração e exclusão até para quem tem acesso total ao banco pelo app.
create or replace function private.auditoria_registros_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'O registro da conferência não pode ser alterado nem apagado.' using errcode = '42501';
end $$;
create trigger auditoria_registros_imutavel before update or delete on public.auditoria_registros
  for each row execute function private.auditoria_registros_imutavel();
create trigger auditoria_registros_sem_truncate before truncate on public.auditoria_registros
  for each statement execute function private.auditoria_registros_imutavel();

create or replace function private.auditoria_retrato(p_solicitacao uuid, p_anexo uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('numero', s.numero, 'tipo', s.tipo, 'placa', s.placa, 'status', s.status,
    'cliente', s.retrato ->> 'cliente', 'filial', s.retrato ->> 'filial', 'filial_id', s.retrato ->> 'filial_id',
    'centro_custo', s.retrato ->> 'centro_custo', 'centro_custo_id', s.retrato ->> 'centro_custo_id',
    'lote', s.retrato ->> 'lote_numero', 'solicitante', s.solicitante_nome, 'responsavel', s.responsavel_nome,
    'arquivo', (select a.nome from public.doc_anexos a where a.id = p_anexo))
  from public.solicitacoes_doc s where s.id = p_solicitacao
$$;

create or replace function private.auditoria_campos(p_resultado jsonb, p_resultados text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(l ->> 'rotulo' order by ord), '{}')
  from jsonb_array_elements(coalesce(p_resultado, '[]'::jsonb)) with ordinality as t(l, ord)
  where l ->> 'resultado' = any (p_resultados)
$$;

-- 1) CT-e anexado: grava quem enviou (mantém o disparo do n8n da migração 3600).
create or replace function private.auditoria_ao_anexar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if new.categoria <> 'cte' then return new; end if;
  insert into public.auditoria_participantes (solicitacao_id, anexo_id)
  values (new.solicitacao_id, new.id) returning id into v_id;
  insert into public.auditoria_registros (evento, solicitacao_id, auditoria_id, anexo_id, status_conferencia, ator_id, ator_nome, retrato)
  values ('cte_enviado', new.solicitacao_id, v_id, new.id, 'processando', coalesce(new.enviado_por, auth.uid()),
    coalesce(new.enviado_por_nome, private.nome_usuario()), private.auditoria_retrato(new.solicitacao_id, new.id));
  perform private.auditoria_disparar(v_id);
  return new;
end $$;

-- 2) Resultado da conferência (cada leitura, inclusive as repetidas) e 3) pedido de nova conferência.
create or replace function private.auditoria_ao_mudar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status and new.concluido_em is not distinct from old.concluido_em then return new; end if;
  if new.status = 'processando' and old.status <> 'processando' then
    insert into public.auditoria_registros (evento, solicitacao_id, auditoria_id, anexo_id, status_conferencia, detalhe, ator_id, ator_nome, retrato)
    values ('reconferir', new.solicitacao_id, new.id, new.anexo_id, old.status,
      jsonb_build_object('tentativa', new.tentativas), auth.uid(), private.nome_usuario(),
      private.auditoria_retrato(new.solicitacao_id, new.anexo_id));
  elsif new.status <> 'processando' then
    insert into public.auditoria_registros (evento, solicitacao_id, auditoria_id, anexo_id, status_conferencia,
      campos_divergentes, campos_atencao, detalhe, ator_nome, retrato)
    values ('conferencia', new.solicitacao_id, new.id, new.anexo_id, new.status,
      private.auditoria_campos(new.resultado, array['divergente']),
      private.auditoria_campos(new.resultado, array['alerta', 'nao_lido']),
      jsonb_build_object('tentativa', new.tentativas, 'origem', new.origem, 'mensagem', new.mensagem, 'resultado', new.resultado),
      'Conferência automática', private.auditoria_retrato(new.solicitacao_id, new.anexo_id));
  end if;
  return new;
end $$;
create trigger auditoria_ao_mudar after update on public.auditoria_participantes
  for each row execute function private.auditoria_ao_mudar();

-- 4) Liberação ao comercial: grava a situação da conferência naquele instante. Com divergência, exige motivo.
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
         when bool_or(status = 'divergente') then 'divergente'
         when bool_or(status = 'processando') then 'processando'
         when bool_or(status = 'erro') then 'erro'
         when bool_or(status = 'alerta') then 'alerta'
         else 'conferido' end,
    jsonb_agg(jsonb_build_object('auditoria_id', id, 'anexo_id', anexo_id, 'status', status, 'tentativas', tentativas))
  into v_status, v_det
  from public.auditoria_participantes where solicitacao_id = new.id;
  select coalesce(array_agg(distinct c), '{}') into v_div
  from public.auditoria_participantes a, unnest(private.auditoria_campos(a.resultado, array['divergente'])) c
  where a.solicitacao_id = new.id;
  select coalesce(array_agg(distinct c), '{}') into v_ate
  from public.auditoria_participantes a, unnest(private.auditoria_campos(a.resultado, array['alerta', 'nao_lido'])) c
  where a.solicitacao_id = new.id;
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
create trigger auditoria_ao_liberar after update of status on public.solicitacoes_doc
  for each row execute function private.auditoria_ao_liberar();

-- Liberar informando o motivo (obrigatório quando a conferência não está toda verde).
create or replace function public.concluir_solicitacao_doc_motivo(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('travion.motivo_liberacao', left(coalesce(p_motivo, ''), 1000), true);
  return public.concluir_solicitacao_doc(p_id);
end $$;

revoke all on function private.auditoria_registros_imutavel(), private.auditoria_retrato(uuid, uuid),
  private.auditoria_campos(jsonb, text[]), private.auditoria_ao_mudar(), private.auditoria_ao_liberar()
  from public, anon, authenticated;
revoke all on function public.concluir_solicitacao_doc_motivo(uuid, text) from public, anon;
grant execute on function public.concluir_solicitacao_doc_motivo(uuid, text) to authenticated;

-- CT-es anexados antes deste registro: entram como "cte_enviado" (sem histórico de resultado anterior).
insert into public.auditoria_registros (evento, solicitacao_id, auditoria_id, anexo_id, status_conferencia, ator_id, ator_nome, retrato, criado_em)
select 'cte_enviado', a.solicitacao_id, p.id, a.id, coalesce(p.status, 'sem_conferencia'), a.enviado_por, a.enviado_por_nome,
  private.auditoria_retrato(a.solicitacao_id, a.id), a.enviado_em
from public.doc_anexos a
left join public.auditoria_participantes p on p.anexo_id = a.id
where a.categoria = 'cte';

-- Relatório pronto: uma linha por CT-e com quem enviou, o último resultado e a liberação.
create or replace view public.relatorio_conferencia_cte
with (security_invoker = true) as
select
  e.criado_em as enviado_em, e.ator_nome as enviado_por, e.retrato ->> 'arquivo' as arquivo,
  (e.retrato ->> 'numero')::int as solicitacao_numero, e.retrato ->> 'tipo' as tipo, e.retrato ->> 'placa' as placa,
  e.retrato ->> 'cliente' as cliente, e.retrato ->> 'filial' as filial, e.retrato ->> 'centro_custo' as centro_custo,
  e.retrato ->> 'lote' as lote,
  r.status_conferencia as ultimo_resultado, r.campos_divergentes, r.campos_atencao, r.criado_em as conferido_em,
  (select count(*) from public.auditoria_registros x where x.anexo_id = e.anexo_id and x.evento = 'reconferir') as reconferencias,
  l.criado_em as liberado_em, l.ator_nome as liberado_por, l.status_conferencia as situacao_na_liberacao, l.motivo as motivo_liberacao,
  e.solicitacao_id, e.anexo_id
from public.auditoria_registros e
left join lateral (select * from public.auditoria_registros x where x.anexo_id = e.anexo_id and x.evento = 'conferencia'
                   order by x.criado_em desc limit 1) r on true
left join lateral (select * from public.auditoria_registros x where x.solicitacao_id = e.solicitacao_id and x.evento = 'liberado'
                   and x.criado_em >= e.criado_em order by x.criado_em limit 1) l on true
where e.evento = 'cte_enviado';
revoke all on public.relatorio_conferencia_cte from anon;
grant select on public.relatorio_conferencia_cte to authenticated;
