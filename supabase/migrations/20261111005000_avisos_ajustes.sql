-- Ajustes dos avisos pedidos pelo Frederick em 11/11/2026 (depois de ver os exemplos):
--   1. Prazo estourado vai só para Gestor, Administrador e Supervisor do Apoio Operacional
--      (permissão "avisos.prazo"). O Apoio e o responsável não recebem mais esse aviso.
--   2. Novo tipo de usuário "Supervisor do Apoio Operacional": reaproveita o papel `operacao`, que estava
--      sem uso desde 28/10 (unificado no Apoio). Tem as mesmas permissões do Apoio + aviso de prazo.
--   3. Estadia: o sino só avisa quando o cliente autoriza (aprovada ou aprovada parcialmente).
--      As atualizações do Apoio (encaminhada ao cliente, paga, encerrada, reaberta, cancelada, rejeitada) não avisam.
--      O alerta de cliente sem retorno há 7/15 dias (relógio do cliente, 10/11) continua.
--   4. Valores em reais nos avisos no formato brasileiro (R$ 7.959,06), também no WhatsApp.
--   5. 11/11 11h16: Frederick pediu tirar os avisos de prazo estourado POR ENQUANTO. O agendamento
--      travion-avisos-prazo é desligado (a função fica pronta; para voltar, agendar de novo a cada 5 min).
-- Não apaga nenhum dado.

-- ---------------------------------------------------------------------------
-- 1 e 2. Permissões
-- ---------------------------------------------------------------------------
update public.permissoes set descricao = 'Receber aviso de cada solicitação nova na fila do Apoio (Lote e Emissão, Emissão, Cadastro, Estadia)'
 where chave = 'avisos.fila_nova';
update public.permissoes set descricao = 'Receber aviso de solicitação com prazo estourado na fila do Apoio'
 where chave = 'avisos.prazo';

-- Supervisor do Apoio Operacional (papel `operacao`): tudo o que o Apoio tem hoje + aviso de prazo.
insert into public.papel_permissoes (papel, chave)
select 'operacao', chave from public.papel_permissoes where papel = 'apoio'
on conflict do nothing;
insert into public.papel_permissoes (papel, chave) values ('operacao', 'avisos.prazo')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Prazo estourado: só quem tem "avisos.prazo" (Gestor, Supervisor do Apoio; Administrador sempre)
-- ---------------------------------------------------------------------------
create or replace function private.avisar_prazos_fila()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n integer := 0;
  v_rot text;
  v_texto text;
  v_chave text;
begin
  for r in
    select s, f.desde, f.prazo
      from public.solicitacoes_doc s
      cross join lateral (
        select coalesce((select max(ev.criado_em) from public.solicitacao_eventos ev
                          where ev.solicitacao_id = s.id and ev.status_novo = s.status), s.enviado_em) as desde,
               case s.tipo when 'cadastro' then interval '30 minutes' when 'estadia' then interval '96 hours'
                           else interval '20 minutes' end as prazo) f
     where s.status in ('enviado', 'correcao_recebida')
       and f.desde + f.prazo + interval '5 minutes' <= now()
       and f.desde + f.prazo + interval '5 minutes' > now() - interval '1 hour'
       and not exists (select 1 from public.embarques e where e.id = s.embarque_id and e.is_demo)
  loop
    v_rot := private.rotulo_solicitacao(r.s);
    v_texto := v_rot || ' · na fila desde ' || to_char(r.desde at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      || case when (r.s).responsavel_id is null then ' · ninguém assumiu' else ' · com ' || (r.s).responsavel_nome end;
    v_chave := 'prazo:' || (r.s).id || ':' || floor(extract(epoch from r.desde))::bigint;
    perform private.avisar_permissao('avisos.prazo', private.filial_solicitacao(r.s), 'prazo_estourado',
      'Prazo estourado: ' || split_part(v_rot, ' nº', 1), v_texto, (r.s).id, (r.s).embarque_id, 'apoio', v_chave);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3 e 4. Filtro antes de gravar qualquer aviso
-- ---------------------------------------------------------------------------
-- R$ 7,959.06 → R$ 7.959,06 (o banco formata números no padrão americano).
create or replace function private.reais_br(p_texto text)
returns text
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  m text[];
  v text := p_texto;
begin
  if v is null or position('R$' in v) = 0 then return v; end if;
  for m in select regexp_matches(p_texto, 'R\$ ?([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})(?![0-9])', 'g') loop
    v := replace(v, m[1], translate(m[1], ',.', '.,'));
  end loop;
  return v;
end $$;

create or replace function private.notificacoes_filtrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Estadia: só a autorização do cliente e o alerta de cliente sem retorno.
  if new.tipo = 'estadia_atualizada'
     and new.titulo not in ('Estadia aprovada pelo cliente', 'Estadia aprovada parcialmente')
     and new.titulo not like 'Cliente sem retorno há mais de %' then
    return null;
  end if;
  new.titulo := private.reais_br(new.titulo);
  new.texto := private.reais_br(new.texto);
  return new;
end $$;

drop trigger if exists notificacoes_filtrar on public.notificacoes;
create trigger notificacoes_filtrar before insert on public.notificacoes
  for each row execute function private.notificacoes_filtrar();

revoke all on function private.reais_br(text), private.notificacoes_filtrar() from public, anon, authenticated;

-- 5. Prazo estourado desligado por enquanto (já desligado no banco em 11/11 11h16).
do $agenda$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'travion-avisos-prazo';
  end if;
end $agenda$;
