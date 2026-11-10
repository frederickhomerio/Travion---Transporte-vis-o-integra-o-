-- Módulo Industrializado (10/11/2026): cargas paletizadas, batidas e a granel do centro de custo Industrializado (Goiânia).
-- Separado das demais operações: tabelas próprias (ind_*), permissões ind.* e funções exclusivas
-- (Supervisor, Embarcador e Apoio Operacional do Industrializado). Coordenador Comercial, Gestor e Administrador veem tudo.
--
-- Como grava: cada carga, ocorrência e cliente é um documento (jsonb) com versão. O app manda o documento inteiro
-- e o servidor confere quem pode fazer o quê comparando o antes e o depois:
--   * carga nova: ind.lancar (nasce Lançada; código IND-xxxx dado pelo servidor);
--   * voltar etapa: ind.voltar; cancelar: ind.cancelar; Carregada → Documentada: ind.emissao; encerrar: ind.pos_entrega;
--     demais avanços: ind.avancar;
--   * valores da carga: ind.financeiro (ou ind.emissao ao liberar os documentos, que conferem os valores);
--   * histórico só cresce (ninguém apaga o que já foi registrado); carga encerrada ou cancelada não muda mais;
--   * versão diferente = outra pessoa mexeu antes: a gravação é recusada e a tela recarrega.
--   * ocorrência nova: ind.ocorrencias (código OC-xxxx dado pelo servidor); aprovar, pagar, cancelar e mudar valores: ind.ocorrencias_aprovar.
--   * clientes: ind.clientes; meta diária: ind.meta. Nada é apagado (não há DELETE).
-- Leitura: quem tem ind.pagina. Escrita só pelas funções abaixo. Só acrescenta. Reexecutável.

-- ---------------------------------------------------------------------------
-- Permissões e matriz por função
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('ind.pagina', 'Industrializado', 'Acessar o módulo Industrializado (só o centro de custo Industrializado)'),
  ('ind.lancar', 'Industrializado', 'Lançar e editar cargas, informar PO e criar entrega reversa'),
  ('ind.avancar', 'Industrializado', 'Avançar etapas, conferências, combinado com o motorista e situação das paradas'),
  ('ind.voltar', 'Industrializado', 'Voltar etapa da carga (com motivo)'),
  ('ind.cancelar', 'Industrializado', 'Cancelar carga (com motivo)'),
  ('ind.emissao', 'Industrializado', 'Atender a Emissão do Industrializado (CT-e, MDF-e, NF, PO e conferência de valores)'),
  ('ind.ocorrencias', 'Industrializado', 'Abrir ocorrências e finalizar cargas no Painel'),
  ('ind.ocorrencias_aprovar', 'Industrializado', 'Aprovar valores de ocorrências, marcar pagamento ao motorista e cancelar ocorrências'),
  ('ind.pos_entrega', 'Industrializado', 'Registrar canhotos, conferir comprovante e encerrar cargas'),
  ('ind.financeiro', 'Industrializado', 'Ver e lançar valores da carga e a margem'),
  ('ind.clientes', 'Industrializado', 'Acessar e gerenciar os clientes do Industrializado'),
  ('ind.meta', 'Industrializado', 'Definir a meta diária de cargas')
on conflict (chave) do update set grupo = excluded.grupo, descricao = excluded.descricao;

insert into public.papel_permissoes (papel, chave)
select x.papel::public.papel_usuario, x.chave from (values
  -- Coordenador Comercial e Gestor: todo o módulo (Administrador sempre tem tudo).
  ('comercial', 'ind.pagina'), ('comercial', 'ind.lancar'), ('comercial', 'ind.avancar'), ('comercial', 'ind.voltar'),
  ('comercial', 'ind.cancelar'), ('comercial', 'ind.emissao'), ('comercial', 'ind.ocorrencias'), ('comercial', 'ind.ocorrencias_aprovar'),
  ('comercial', 'ind.pos_entrega'), ('comercial', 'ind.financeiro'), ('comercial', 'ind.clientes'), ('comercial', 'ind.meta'),
  ('gestor', 'ind.pagina'), ('gestor', 'ind.lancar'), ('gestor', 'ind.avancar'), ('gestor', 'ind.voltar'),
  ('gestor', 'ind.cancelar'), ('gestor', 'ind.emissao'), ('gestor', 'ind.ocorrencias'), ('gestor', 'ind.ocorrencias_aprovar'),
  ('gestor', 'ind.pos_entrega'), ('gestor', 'ind.financeiro'), ('gestor', 'ind.clientes'), ('gestor', 'ind.meta'),
  -- Supervisor do Industrializado: todo o módulo.
  ('ind_supervisor', 'ind.pagina'), ('ind_supervisor', 'ind.lancar'), ('ind_supervisor', 'ind.avancar'), ('ind_supervisor', 'ind.voltar'),
  ('ind_supervisor', 'ind.cancelar'), ('ind_supervisor', 'ind.emissao'), ('ind_supervisor', 'ind.ocorrencias'), ('ind_supervisor', 'ind.ocorrencias_aprovar'),
  ('ind_supervisor', 'ind.pos_entrega'), ('ind_supervisor', 'ind.financeiro'), ('ind_supervisor', 'ind.clientes'), ('ind_supervisor', 'ind.meta'),
  -- Embarcador do Industrializado: lança e contrata, tracking, emissão, ocorrências e pós-entrega (vê margem).
  ('ind_embarcador', 'ind.pagina'), ('ind_embarcador', 'ind.lancar'), ('ind_embarcador', 'ind.avancar'), ('ind_embarcador', 'ind.emissao'),
  ('ind_embarcador', 'ind.ocorrencias'), ('ind_embarcador', 'ind.pos_entrega'), ('ind_embarcador', 'ind.financeiro'),
  -- Apoio Operacional do Industrializado: tracking, emissão (confere valores), ocorrências e pós-entrega.
  ('ind_apoio', 'ind.pagina'), ('ind_apoio', 'ind.avancar'), ('ind_apoio', 'ind.emissao'),
  ('ind_apoio', 'ind.ocorrencias'), ('ind_apoio', 'ind.pos_entrega'), ('ind_apoio', 'ind.financeiro')
) as x(papel, chave)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.ind_clientes (
  id text primary key check (length(id) between 1 and 64),
  dados jsonb not null,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis(id)
);

create sequence if not exists public.ind_viagens_codigo_seq;
create table if not exists public.ind_viagens (
  id text primary key check (length(id) between 1 and 64),
  codigo integer not null unique,
  cliente_id text not null references public.ind_clientes(id),
  etapa text not null check (etapa in ('lancada', 'contratado', 'coleta_agendada', 'carregando', 'carregada', 'documentada',
    'transito', 'entregas', 'entregue', 'encerrada', 'cancelada')),
  dados jsonb not null,
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.perfis(id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis(id)
);
create index if not exists ind_viagens_etapa on public.ind_viagens (etapa);

create sequence if not exists public.ind_ocorrencias_codigo_seq;
create table if not exists public.ind_ocorrencias (
  id text primary key check (length(id) between 1 and 64),
  codigo integer not null unique,
  viagem_id text not null references public.ind_viagens(id),
  situacao text not null check (situacao in ('aberta', 'aprovada', 'paga', 'cancelada')),
  dados jsonb not null,
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.perfis(id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis(id)
);
create index if not exists ind_ocorrencias_viagem on public.ind_ocorrencias (viagem_id);

create table if not exists public.ind_metas (
  data date primary key,
  meta integer not null check (meta between 0 and 999),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis(id)
);

alter table public.ind_clientes enable row level security;
alter table public.ind_viagens enable row level security;
alter table public.ind_ocorrencias enable row level security;
alter table public.ind_metas enable row level security;

drop policy if exists leitura on public.ind_clientes;
drop policy if exists leitura on public.ind_viagens;
drop policy if exists leitura on public.ind_ocorrencias;
drop policy if exists leitura on public.ind_metas;
create policy leitura on public.ind_clientes for select to authenticated using (private.tem_permissao('ind.pagina'));
create policy leitura on public.ind_viagens for select to authenticated using (private.tem_permissao('ind.pagina'));
create policy leitura on public.ind_ocorrencias for select to authenticated using (private.tem_permissao('ind.pagina'));
create policy leitura on public.ind_metas for select to authenticated using (private.tem_permissao('ind.pagina'));

revoke all on table public.ind_clientes, public.ind_viagens, public.ind_ocorrencias, public.ind_metas from anon, authenticated;
grant select on table public.ind_clientes, public.ind_viagens, public.ind_ocorrencias, public.ind_metas to authenticated;
revoke all on sequence public.ind_viagens_codigo_seq, public.ind_ocorrencias_codigo_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.ind_erro(p_codigo text, p_msg text)
returns void
language plpgsql
as $$ begin raise exception using errcode = p_codigo, message = p_msg; end $$;

create or replace function private.ind_alguma(p_chaves text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from unnest(p_chaves) k where private.tem_permissao(k)) $$;

create or replace function private.ind_ordem(p_etapa text)
returns integer
language sql
immutable
as $$
  select array_position(array['lancada', 'contratado', 'coleta_agendada', 'carregando', 'carregada', 'documentada',
    'transito', 'entregas', 'entregue', 'encerrada'], p_etapa)
$$;

/** O histórico novo precisa começar exatamente pelo histórico já gravado (só acrescenta). */
create or replace function private.ind_historico_cresce(p_antigo jsonb, p_novo jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(coalesce(p_novo, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p_novo, '[]'::jsonb)) >= jsonb_array_length(coalesce(p_antigo, '[]'::jsonb))
     and coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(coalesce(p_novo, '[]'::jsonb)) with ordinality t(e, i)
                   where i <= jsonb_array_length(coalesce(p_antigo, '[]'::jsonb))), '[]'::jsonb) = coalesce(p_antigo, '[]'::jsonb)
$$;

/** Algum valor da carga diferente de zero? */
create or replace function private.ind_tem_valor(p_valores jsonb)
returns boolean
language sql
immutable
as $$ select exists (select 1 from jsonb_each(coalesce(p_valores, '{}'::jsonb)) v where jsonb_typeof(v.value) = 'number' and (v.value)::numeric <> 0) $$;

-- ---------------------------------------------------------------------------
-- Leitura do módulo
-- ---------------------------------------------------------------------------
create or replace function public.ind_estado()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('ind.pagina');
  return jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(c.dados || jsonb_build_object('id', c.id, 'versao', c.versao) order by c.dados->>'nome') from public.ind_clientes c), '[]'::jsonb),
    'viagens', coalesce((select jsonb_agg(v.dados || jsonb_build_object('id', v.id, 'codigo', v.codigo, 'versao', v.versao) order by v.codigo) from public.ind_viagens v), '[]'::jsonb),
    'ocorrencias', coalesce((select jsonb_agg(o.dados || jsonb_build_object('id', o.id, 'versao', o.versao) order by o.codigo) from public.ind_ocorrencias o), '[]'::jsonb),
    'metas', coalesce((select jsonb_object_agg(to_char(m.data, 'YYYY-MM-DD'), m.meta) from public.ind_metas m), '{}'::jsonb)
  );
end $$;

/** Nomes dos colaboradores ativos do Industrializado (campo "Contratado por"). */
create or replace function public.ind_colaboradores()
returns table (nome text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('ind.pagina');
  return query
    select coalesce(nullif(p.nome, ''), p.email)::text from public.perfis p
    where p.status = 'ativo' and p.papel::text in ('ind_supervisor', 'ind_embarcador', 'ind_apoio')
    order by 1;
end $$;

-- ---------------------------------------------------------------------------
-- Gravação
-- ---------------------------------------------------------------------------
create or replace function public.ind_salvar_cliente(p_dados jsonb, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := p_dados->>'id';
  a public.ind_clientes;
  v_dados jsonb := p_dados - 'versao' - 'id';
begin
  perform private.exigir('ind.clientes');
  if v_id is null or length(v_id) not between 1 and 64 then perform private.ind_erro('22023', 'Cliente sem identificação.'); end if;
  if length(trim(coalesce(v_dados->>'nome', ''))) = 0 then perform private.ind_erro('22023', 'Informe o nome do cliente.'); end if;
  select * into a from public.ind_clientes where id = v_id for update;
  if not found then
    insert into public.ind_clientes (id, dados, atualizado_por) values (v_id, v_dados, auth.uid()) returning * into a;
  else
    if p_versao is not null and a.versao <> p_versao then
      perform private.ind_erro('40001', 'Este cliente foi alterado por outra pessoa. A tela foi atualizada; confira e salve de novo.');
    end if;
    update public.ind_clientes set dados = v_dados, versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid()
    where id = v_id returning * into a;
  end if;
  return a.dados || jsonb_build_object('id', a.id, 'versao', a.versao);
end $$;

create or replace function public.ind_salvar_viagem(p_dados jsonb, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := p_dados->>'id';
  a public.ind_viagens;
  v_dados jsonb := p_dados - 'versao' - 'id' - 'codigo';
  v_novo text := p_dados->>'etapa';
  v_velho text;
  v_cliente text := p_dados->>'cliente_id';
  v_codigo integer;
begin
  perform private.exigir('ind.pagina');
  if v_id is null or length(v_id) not between 1 and 64 then perform private.ind_erro('22023', 'Carga sem identificação.'); end if;
  if v_novo is null or (private.ind_ordem(v_novo) is null and v_novo <> 'cancelada') then perform private.ind_erro('22023', 'Etapa inválida.'); end if;
  if not exists (select 1 from public.ind_clientes where id = v_cliente) then perform private.ind_erro('22023', 'Cliente não encontrado no Industrializado.'); end if;
  if jsonb_typeof(coalesce(v_dados->'historico', 'null'::jsonb)) <> 'array' then perform private.ind_erro('22023', 'Carga sem histórico.'); end if;

  select * into a from public.ind_viagens where id = v_id for update;
  if not found then
    perform private.exigir('ind.lancar');
    if v_novo <> 'lancada' then perform private.ind_erro('22023', 'Carga nova nasce Lançada.'); end if;
    if private.ind_tem_valor(v_dados->'valores') and not private.tem_permissao('ind.financeiro') then
      perform private.ind_erro('42501', 'Seu perfil não lança valores da carga.');
    end if;
    v_codigo := nextval('public.ind_viagens_codigo_seq');
    v_dados := v_dados || jsonb_build_object('criado_em', now(), 'criado_por', private.nome_usuario());
    insert into public.ind_viagens (id, codigo, cliente_id, etapa, dados, criado_por, atualizado_por)
    values (v_id, v_codigo, v_cliente, v_novo, v_dados, auth.uid(), auth.uid()) returning * into a;
  else
    if p_versao is null or a.versao <> p_versao then
      perform private.ind_erro('40001', 'Esta carga foi alterada por outra pessoa. A tela foi atualizada; confira e refaça a ação.');
    end if;
    v_velho := a.etapa;
    if v_velho in ('encerrada', 'cancelada') then perform private.ind_erro('55000', 'Carga encerrada ou cancelada não pode mudar.'); end if;
    if not private.ind_historico_cresce(a.dados->'historico', v_dados->'historico') then
      perform private.ind_erro('42501', 'O histórico da carga não pode ser apagado nem alterado.');
    end if;
    -- Quem pode mudar a etapa
    if v_novo <> v_velho then
      if v_novo = 'cancelada' then perform private.exigir('ind.cancelar');
      elsif private.ind_ordem(v_novo) < private.ind_ordem(v_velho) then perform private.exigir('ind.voltar');
      elsif v_velho = 'carregada' and v_novo = 'documentada' then perform private.exigir('ind.emissao');
      elsif v_novo = 'encerrada' then perform private.exigir('ind.pos_entrega');
      else perform private.exigir('ind.avancar');
      end if;
    elsif not private.ind_alguma(array['ind.lancar', 'ind.avancar', 'ind.emissao', 'ind.ocorrencias', 'ind.pos_entrega']) then
      perform private.ind_erro('42501', 'Seu perfil não altera cargas do Industrializado.');
    end if;
    -- Valores: financeiro, ou a Emissão ao liberar os documentos (confere os valores do CT-e e do contrato)
    if (v_dados->'valores') is distinct from (a.dados->'valores')
       and not private.tem_permissao('ind.financeiro')
       and not (v_velho = 'carregada' and v_novo = 'documentada' and private.tem_permissao('ind.emissao')) then
      perform private.ind_erro('42501', 'Seu perfil não altera valores da carga.');
    end if;
    -- Imutáveis
    v_dados := v_dados || jsonb_build_object('criado_em', a.dados->'criado_em', 'criado_por', a.dados->'criado_por');
    update public.ind_viagens set cliente_id = v_cliente, etapa = v_novo, dados = v_dados, versao = versao + 1,
      atualizado_em = now(), atualizado_por = auth.uid()
    where id = v_id returning * into a;
  end if;
  return a.dados || jsonb_build_object('id', a.id, 'codigo', a.codigo, 'versao', a.versao);
end $$;

create or replace function public.ind_salvar_ocorrencia(p_dados jsonb, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := p_dados->>'id';
  a public.ind_ocorrencias;
  v_dados jsonb := p_dados - 'versao' - 'id';
  v_sit text := p_dados->>'situacao';
  v_viagem text := p_dados->>'viagem_id';
  v_codigo integer;
begin
  perform private.exigir('ind.pagina');
  if v_id is null or length(v_id) not between 1 and 64 then perform private.ind_erro('22023', 'Ocorrência sem identificação.'); end if;
  if v_sit not in ('aberta', 'aprovada', 'paga', 'cancelada') then perform private.ind_erro('22023', 'Situação inválida.'); end if;
  if length(trim(coalesce(v_dados->>'descricao', ''))) = 0 then perform private.ind_erro('22023', 'Descreva a ocorrência.'); end if;
  select * into a from public.ind_ocorrencias where id = v_id for update;
  if not found then
    perform private.exigir('ind.ocorrencias');
    if v_sit <> 'aberta' then perform private.ind_erro('22023', 'Ocorrência nova nasce Aberta.'); end if;
    if not exists (select 1 from public.ind_viagens where id = v_viagem and etapa not in ('encerrada', 'cancelada')) then
      perform private.ind_erro('55000', 'Carga não encontrada, encerrada ou cancelada.');
    end if;
    if ((v_dados->>'valor_motorista')::numeric <> 0 or (v_dados->>'valor_cliente')::numeric <> 0) and not private.tem_permissao('ind.financeiro') then
      perform private.ind_erro('42501', 'Seu perfil não lança valores da ocorrência.');
    end if;
    v_codigo := nextval('public.ind_ocorrencias_codigo_seq');
    v_dados := v_dados || jsonb_build_object('codigo', 'OC-' || lpad(v_codigo::text, 4, '0'), 'aberta_em', now(), 'aberta_por', private.nome_usuario());
    insert into public.ind_ocorrencias (id, codigo, viagem_id, situacao, dados, criado_por, atualizado_por)
    values (v_id, v_codigo, v_viagem, v_sit, v_dados, auth.uid(), auth.uid()) returning * into a;
  else
    if p_versao is null or a.versao <> p_versao then
      perform private.ind_erro('40001', 'Esta ocorrência foi alterada por outra pessoa. A tela foi atualizada; confira e refaça a ação.');
    end if;
    if v_viagem is distinct from a.viagem_id then perform private.ind_erro('22023', 'A ocorrência não muda de carga.'); end if;
    if a.situacao in ('paga', 'cancelada') and v_sit <> a.situacao then perform private.ind_erro('55000', 'Ocorrência paga ou cancelada não muda de situação.'); end if;
    if v_sit <> a.situacao
       or (v_dados->'valor_motorista') is distinct from (a.dados->'valor_motorista')
       or (v_dados->'valor_cliente') is distinct from (a.dados->'valor_cliente') then
      perform private.exigir('ind.ocorrencias_aprovar');
    elsif not private.ind_alguma(array['ind.ocorrencias', 'ind.ocorrencias_aprovar']) then
      perform private.ind_erro('42501', 'Seu perfil não altera ocorrências.');
    end if;
    v_dados := v_dados || jsonb_build_object('codigo', a.dados->'codigo', 'aberta_em', a.dados->'aberta_em', 'aberta_por', a.dados->'aberta_por');
    update public.ind_ocorrencias set situacao = v_sit, dados = v_dados, versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid()
    where id = v_id returning * into a;
  end if;
  return a.dados || jsonb_build_object('id', a.id, 'versao', a.versao);
end $$;

create or replace function public.ind_definir_meta(p_data date, p_meta integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.exigir('ind.meta');
  if p_meta is null or p_meta not between 0 and 999 then perform private.ind_erro('22023', 'Informe a meta em número de cargas (0 a 999).'); end if;
  insert into public.ind_metas (data, meta, atualizado_por) values (p_data, p_meta, auth.uid())
  on conflict (data) do update set meta = excluded.meta, atualizado_em = now(), atualizado_por = auth.uid();
end $$;

revoke all on function public.ind_estado(), public.ind_colaboradores(), public.ind_salvar_cliente(jsonb, integer),
  public.ind_salvar_viagem(jsonb, integer), public.ind_salvar_ocorrencia(jsonb, integer), public.ind_definir_meta(date, integer) from public, anon;
grant execute on function public.ind_estado(), public.ind_colaboradores(), public.ind_salvar_cliente(jsonb, integer),
  public.ind_salvar_viagem(jsonb, integer), public.ind_salvar_ocorrencia(jsonb, integer), public.ind_definir_meta(date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Tempo real
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['ind_clientes', 'ind_viagens', 'ind_ocorrencias', 'ind_metas'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
