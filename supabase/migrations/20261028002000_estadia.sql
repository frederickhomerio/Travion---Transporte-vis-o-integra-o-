-- Aba Estadia (pedido de 28/10/2026): o comercial envia a solicitação de estadia; o apoio confere o cálculo,
-- encaminha ao cliente à mão e registra o retorno, o pagamento informado e o encerramento.
-- Reaproveita a fila do Apoio Operacional: a mesma tabela solicitacoes_doc ganha o tipo 'estadia', sem embarque.
-- Sem integração com ERP ou cliente: pagamento, receita e aprovação são fatos informados por usuários autorizados.
--
-- Cálculo (definido pelo usuário; o apoio informa os parâmetros de horas pelas diretrizes de cada cliente):
--   permanência   = saída − início, em horas decimais
--   horas válidas = permanência > limite ? máximo(0, permanência − horas a retroagir) : 0   (no limite exato não cobra)
--   valor         = tarifa (R$/t/h) × peso (t) × horas válidas, arredondado em centavos só no final
-- Cada conferência é uma versão nova (estadia_conferencias); retornos e pagamentos guardam a versão usada.
-- Só acrescenta tabelas, colunas, valores permitidos e funções; não apaga dados.

-- ---------------------------------------------------------------------------
-- Permissões (ajustáveis em Administração → Permissões)
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('estadia.solicitar', 'Estadia', 'Abrir a aba Estadia, enviar solicitações de estadia e responder pendências'),
  ('estadia.ver',       'Estadia', 'Consultar as estadias das suas filiais e da sua carteira, além das próprias'),
  ('estadia.reabrir',   'Estadia', 'Reabrir estadia cancelada, encerrada ou aprovada (com motivo, fica no histórico)')
on conflict do nothing;

insert into public.papel_permissoes (papel, chave) values
  ('gestor', 'estadia.solicitar'), ('gestor', 'estadia.ver'), ('gestor', 'estadia.reabrir'),
  ('supervisor', 'estadia.solicitar'), ('supervisor', 'estadia.ver'),
  ('embarcador', 'estadia.solicitar'), ('embarcador', 'estadia.ver'),
  ('comercial', 'estadia.solicitar'), ('comercial', 'estadia.ver'),
  ('apoio', 'estadia.ver'), ('operacao', 'estadia.ver')
on conflict do nothing;

-- Quantidade máxima de arquivos por categoria e tamanho por arquivo (configurável nesta tabela).
insert into public.configuracoes (chave, valor, descricao) values
  ('estadia_anexos', jsonb_build_object('limite_mb', 10, 'max', jsonb_build_object(
     'est_documento', 10, 'est_nf_carga', 20, 'est_comprovante', 10, 'est_agendamento', 5, 'est_tratativa', 10,
     'est_retorno', 10, 'est_pagamento', 5, 'correcao', 10)),
   'Estadia: arquivos por categoria e tamanho máximo por arquivo (MB)')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- Solicitação: tipo Estadia, sem embarque, com campos próprios e unidades explícitas
-- ---------------------------------------------------------------------------
create sequence if not exists public.estadia_codigo_seq;

alter table public.solicitacoes_doc
  add column if not exists est_codigo text unique,
  add column if not exists est_tipo_documento text check (est_tipo_documento in ('cte', 'nfs')),
  add column if not exists est_documentos text[],
  add column if not exists est_nfs_carga text[],
  add column if not exists est_sindicato boolean,
  add column if not exists est_sindicato_nome text,
  add column if not exists est_inicio timestamptz,
  add column if not exists est_saida timestamptz,
  -- Tarifa da estadia em R$ por tonelada por hora (não é o frete da viagem).
  add column if not exists est_tarifa numeric(14, 6),
  add column if not exists est_peso_t numeric(12, 3),
  -- Peso como o usuário informou (t ou kg); est_peso_t é o convertido.
  add column if not exists est_peso_informado numeric(14, 3),
  add column if not exists est_peso_unidade text check (est_peso_unidade in ('t', 'kg')),
  add column if not exists est_motivo text check (est_motivo in (
    'demora_descarga', 'redirecionamento', 'agendamento_alongado', 'troca_nota', 'falta_cota', 'outro')),
  add column if not exists est_motivo_outro text,
  add column if not exists est_modalidade text check (est_modalidade in ('padrao', 'acordo')),
  add column if not exists est_acordo_valor numeric(14, 2),
  add column if not exists est_acordo_confirmado_por text,
  add column if not exists est_acordo_data date,
  add column if not exists est_acordo_descricao text,
  -- Conferência vigente (a última versão salva pelo apoio).
  add column if not exists est_conferencia_id uuid,
  add column if not exists est_conferencia_versao integer,
  add column if not exists est_limite_h numeric(8, 2),
  add column if not exists est_retroagir_h numeric(8, 2),
  add column if not exists est_horas_validas numeric(14, 6),
  add column if not exists est_valor_calculado numeric(14, 2),
  add column if not exists est_conferido_em timestamptz,
  add column if not exists est_conferido_por_nome text,
  add column if not exists est_encaminhado_em timestamptz,
  -- Resultado da análise do cliente, separado da situação operacional.
  add column if not exists est_resultado text check (est_resultado in ('aprovada', 'aprovada_parcial', 'rejeitada')),
  add column if not exists est_valor_aprovado numeric(14, 2),
  add column if not exists est_retorno_em timestamptz,
  -- Pagamento informado (feito fora do app) com receita pendente.
  add column if not exists est_valor_pago numeric(14, 2),
  add column if not exists est_pago_em date,
  add column if not exists est_encerrado_motivo text;

alter table public.solicitacoes_doc
  drop constraint if exists solicitacoes_doc_tipo_check,
  drop constraint if exists solicitacoes_doc_status_check,
  drop constraint if exists solicitacoes_doc_conclusao_por_tipo,
  drop constraint if exists solicitacoes_doc_status_por_tipo,
  drop constraint if exists solicitacoes_doc_campos_documentacao,
  drop constraint if exists solicitacoes_doc_campos_estadia,
  add constraint solicitacoes_doc_tipo_check check (tipo in ('lote_emissao', 'emissao', 'cadastro', 'estadia')),
  add constraint solicitacoes_doc_status_check check (status in (
    'enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'documentacao_disponivel', 'cadastro_concluido',
    'aguardando_cliente', 'pago_pendencia', 'aprovada', 'aprovada_parcial', 'encerrado', 'cancelado')),
  -- Cada tipo só usa as próprias etapas de conclusão.
  add constraint solicitacoes_doc_status_por_tipo check (
    status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'cancelado')
    or (tipo in ('lote_emissao', 'emissao') and status = 'documentacao_disponivel')
    or (tipo = 'cadastro' and status = 'cadastro_concluido')
    or (tipo = 'estadia' and status in ('aguardando_cliente', 'pago_pendencia', 'aprovada', 'aprovada_parcial', 'encerrado'))),
  add constraint solicitacoes_doc_campos_documentacao check (
    tipo in ('cadastro', 'estadia') or (
      embarque_id is not null and frete_empresa is not null and frete_empresa_unidade is not null
      and frete_motorista is not null and frete_motorista_unidade is not null and forma_pagamento is not null
      and pedagio is not null and exige_obs_cte is not null and cte_por_nf is not null)),
  add constraint solicitacoes_doc_campos_estadia check (
    tipo <> 'estadia' or (
      embarque_id is null and cliente_id is not null and est_codigo is not null and est_tipo_documento is not null
      and cardinality(est_documentos) between 1 and 20 and cardinality(est_nfs_carga) between 1 and 50
      and est_sindicato is not null and (not est_sindicato or length(trim(coalesce(est_sindicato_nome, ''))) between 1 and 120)
      and est_inicio is not null and est_saida > est_inicio
      and est_tarifa > 0 and est_peso_t > 0 and est_peso_informado > 0 and est_peso_unidade is not null
      and est_motivo is not null and (est_motivo <> 'outro' or length(trim(coalesce(est_motivo_outro, ''))) between 1 and 200)
      and est_modalidade is not null
      and (est_modalidade <> 'acordo' or (est_acordo_valor > 0 and length(trim(coalesce(est_acordo_confirmado_por, ''))) between 1 and 120
           and est_acordo_data is not null and length(trim(coalesce(est_acordo_descricao, ''))) between 1 and 2000))));

create index if not exists solicitacoes_doc_estadia_placa on public.solicitacoes_doc (placa) where tipo = 'estadia';
create index if not exists solicitacoes_doc_estadia_docs on public.solicitacoes_doc using gin (est_documentos) where tipo = 'estadia';
drop index if exists public.solicitacoes_doc_abertas;
create index solicitacoes_doc_abertas on public.solicitacoes_doc (status)
  where status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'aguardando_cliente', 'pago_pendencia');

-- Anexos da estadia por categoria.
alter table public.doc_anexos
  drop constraint if exists doc_anexos_categoria_check,
  add constraint doc_anexos_categoria_check check (categoria in (
    'nf', 'evidencia_frete', 'correcao', 'cte', 'mdfe', 'outro_emitido', 'motorista', 'veiculo',
    'est_documento', 'est_nf_carga', 'est_comprovante', 'est_agendamento', 'est_tratativa', 'est_retorno', 'est_pagamento'));

-- Notificações de Estadia abrem Consultar Estadia.
alter table public.notificacoes
  drop constraint if exists notificacoes_tipo_check,
  drop constraint if exists notificacoes_destino_check,
  add constraint notificacoes_tipo_check check (tipo in (
    'ajuste_solicitado', 'documentacao_disponivel', 'resposta_enviada', 'cadastro_concluido', 'estadia_atualizada')),
  add constraint notificacoes_destino_check check (destino in ('embarque', 'apoio', 'cadastro', 'estadia'));

-- ---------------------------------------------------------------------------
-- Conferências (versões do cálculo), retornos do cliente e pagamentos informados: só inserção
-- ---------------------------------------------------------------------------
create table if not exists public.estadia_conferencias (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  versao integer not null,
  inicio timestamptz not null,
  saida timestamptz not null,
  tarifa numeric(14, 6) not null check (tarifa > 0),
  peso_t numeric(12, 3) not null check (peso_t > 0),
  limite_h numeric(8, 2) not null check (limite_h >= 0),
  retroagir_h numeric(8, 2) not null check (retroagir_h >= 0),
  permanencia_h numeric(14, 6) not null,
  horas_validas numeric(14, 6) not null check (horas_validas >= 0),
  valor numeric(14, 2) not null check (valor >= 0),
  -- Valores da solicitação que o apoio corrigiu nesta conferência: {campo: {original, usado}}.
  alteracoes jsonb not null default '{}'::jsonb,
  observacao text,
  autor_id uuid references public.perfis (id),
  autor_nome text not null,
  criado_em timestamptz not null default now(),
  unique (solicitacao_id, versao),
  check (saida > inicio)
);

create table if not exists public.estadia_retornos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  resultado text not null check (resultado in ('aprovada', 'aprovada_parcial', 'rejeitada')),
  valor_aprovado numeric(14, 2) check (valor_aprovado > 0),
  justificativa text not null check (length(trim(justificativa)) between 1 and 2000),
  data_retorno date not null,
  conferencia_id uuid not null references public.estadia_conferencias (id),
  valor_calculado numeric(14, 2) not null,
  status_anterior text not null,
  status_novo text not null,
  mensagem_id uuid references public.doc_mensagens (id),
  autor_id uuid references public.perfis (id),
  autor_nome text not null,
  criado_em timestamptz not null default now(),
  check ((resultado = 'rejeitada') = (valor_aprovado is null))
);

create table if not exists public.estadia_pagamentos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_doc (id),
  valor_pago numeric(14, 2) not null check (valor_pago > 0),
  data_pagamento date not null,
  observacao text,
  conferencia_id uuid references public.estadia_conferencias (id),
  mensagem_id uuid references public.doc_mensagens (id),
  autor_id uuid references public.perfis (id),
  autor_nome text not null,
  criado_em timestamptz not null default now()
);

create index if not exists estadia_conferencias_sol on public.estadia_conferencias (solicitacao_id, versao);
create index if not exists estadia_retornos_sol on public.estadia_retornos (solicitacao_id, criado_em);
create index if not exists estadia_pagamentos_sol on public.estadia_pagamentos (solicitacao_id, criado_em);

alter table public.estadia_conferencias enable row level security;
alter table public.estadia_retornos enable row level security;
alter table public.estadia_pagamentos enable row level security;
drop policy if exists leitura on public.estadia_conferencias;
drop policy if exists leitura on public.estadia_retornos;
drop policy if exists leitura on public.estadia_pagamentos;
create policy leitura on public.estadia_conferencias for select to authenticated using (private.pode_ver_solicitacao(solicitacao_id));
create policy leitura on public.estadia_retornos for select to authenticated using (private.pode_ver_solicitacao(solicitacao_id));
create policy leitura on public.estadia_pagamentos for select to authenticated using (private.pode_ver_solicitacao(solicitacao_id));
revoke all on public.estadia_conferencias, public.estadia_retornos, public.estadia_pagamentos from anon, authenticated;
grant select on public.estadia_conferencias, public.estadia_retornos, public.estadia_pagamentos to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura: estadia segue solicitante, filial e carteira (como o Cadastro)
-- ---------------------------------------------------------------------------
create or replace function private.pode_ver_estadia(p_solicitante uuid, p_filial uuid, p_comercial uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.usuario_ativo() and (
    p_solicitante = auth.uid()
    or ((private.tem_permissao('estadia.ver') or private.tem_permissao('apoio.pagina'))
        and (private.eh_admin()
             or (p_filial is not null and private.no_escopo(p_filial, null))
             or (p_comercial is not null and private.no_escopo(null, p_comercial)))))
$$;

create or replace function private.pode_ver_solicitacao_reg(s public.solicitacoes_doc)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when s.tipo = 'cadastro' then private.pode_ver_cadastro(s.solicitante_id, s.filial_id, s.comercial_id)
              when s.tipo = 'estadia' then private.pode_ver_estadia(s.solicitante_id, s.filial_id, s.comercial_id)
              else private.pode_ver_documentacao(s.embarque_id) end
$$;

create or replace function private.doc_rotulo(s public.solicitacoes_doc)
returns text language sql immutable as $$
  select case s.tipo when 'lote_emissao' then 'Lote e Emissão' when 'emissao' then 'Emissão' when 'estadia' then 'Estadia' else 'Cadastro' end
$$;

-- Identificação nas mensagens: "Estadia EST-001" ou "Cadastro nº 12".
create or replace function private.doc_titulo(s public.solicitacoes_doc)
returns text language sql immutable as $$
  select case when s.tipo = 'estadia' then 'Estadia ' || coalesce(s.est_codigo, '') else private.doc_rotulo(s) || ' nº ' || s.numero end
$$;

-- ---------------------------------------------------------------------------
-- Armazenamento e anexos: estadia aceita a lista ampla (PDF, imagem, Office, vídeo, áudio), até o limite configurado
-- ---------------------------------------------------------------------------
drop policy if exists travion_doc_envio on storage.objects;
create policy travion_doc_envio on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentacao'
    and name like 'envios/' || auth.uid()::text || '/%'
    and (private.tem_permissao('documentacao.solicitar') or private.tem_permissao('apoio.atender')
         or private.tem_permissao('cadastro.solicitar') or private.tem_permissao('estadia.solicitar'))
  );

create or replace function private.estadia_config()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor from public.configuracoes where chave = 'estadia_anexos'),
    '{"limite_mb":10,"max":{"est_documento":10,"est_nf_carga":20,"est_comprovante":10,"est_agendamento":5,"est_tratativa":10,"est_retorno":10,"est_pagamento":5,"correcao":10}}'::jsonb)
$$;

create or replace function private.doc_vincular_anexos(
  p_solicitacao_id uuid, p_anexos jsonb, p_categorias text[], p_mensagem_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a jsonb;
  o record;
  v_cat text;
  v_total integer := 0;
  v_tipo text := (select tipo from public.solicitacoes_doc where id = p_solicitacao_id);
  v_amplo boolean := v_tipo in ('cadastro', 'estadia');
  v_limite bigint := case when v_tipo = 'estadia' then coalesce((private.estadia_config() ->> 'limite_mb')::bigint, 10) * 1048576
                          when v_tipo = 'cadastro' then 10485760 else 15728640 end;
  v_tipos text[] := case when v_amplo then array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/webm']
    else array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] end;
begin
  if p_anexos is null or jsonb_typeof(p_anexos) <> 'array' then return 0; end if;
  for a in select * from jsonb_array_elements(p_anexos) loop
    v_cat := a ->> 'categoria';
    if v_cat is null or not (v_cat = any (p_categorias)) then
      perform private.doc_erro('22023', 'Categoria de anexo não permitida nesta etapa.');
    end if;
    if coalesce(a ->> 'caminho', '') not like 'envios/' || auth.uid()::text || '/%' then
      perform private.doc_erro('42501', 'Arquivo enviado por outro usuário.');
    end if;
    select ob.name, ob.metadata into o from storage.objects ob
     where ob.bucket_id = 'documentacao' and ob.name = a ->> 'caminho'
       and coalesce(ob.owner_id, ob.owner::text) = auth.uid()::text;
    if not found then
      perform private.doc_erro('22023', 'Arquivo não encontrado no armazenamento: envie novamente (' || coalesce(a ->> 'nome', 'sem nome') || ').');
    end if;
    if coalesce((o.metadata ->> 'size')::bigint, 0) <= 0 then
      perform private.doc_erro('22023', 'Arquivo vazio ou envio incompleto: ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    if (o.metadata ->> 'size')::bigint > v_limite then
      perform private.doc_erro('22023', 'Arquivo acima de ' || (v_limite / 1048576) || ' MB: ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    if not (coalesce(o.metadata ->> 'mimetype', '') = any (v_tipos)) then
      perform private.doc_erro('22023', 'Tipo de arquivo não aceito: ' || coalesce(a ->> 'nome', 'sem nome') || '.');
    end if;
    insert into public.doc_anexos (solicitacao_id, categoria, caminho, nome, tipo_mime, tamanho, mensagem_id, enviado_por, enviado_por_nome)
    values (p_solicitacao_id, v_cat, a ->> 'caminho', left(coalesce(nullif(trim(a ->> 'nome'), ''), 'arquivo'), 200),
            o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint, p_mensagem_id, auth.uid(), private.nome_usuario())
    on conflict (caminho) do nothing;
    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

-- Limite de arquivos por categoria numa mesma gravação (envio, resposta, retorno ou pagamento).
create or replace function private.estadia_conferir_limites(p_solicitacao_id uuid, p_mensagem_id uuid, p_desde timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_max jsonb := private.estadia_config() -> 'max';
begin
  for r in select categoria, count(*) n from public.doc_anexos
            where solicitacao_id = p_solicitacao_id and enviado_em >= p_desde
              and (mensagem_id is not distinct from p_mensagem_id)
            group by categoria loop
    if v_max ? r.categoria and r.n > (v_max ->> r.categoria)::integer then
      perform private.doc_erro('22023', format('No máximo %s arquivo(s) em %s.', v_max ->> r.categoria, private.estadia_categoria(r.categoria)));
    end if;
  end loop;
end $$;

create or replace function private.estadia_categoria(p text)
returns text language sql immutable as $$
  select case p when 'est_documento' then 'CT-e ou Nota Fiscal de Serviço' when 'est_nf_carga' then 'Nota fiscal da carga'
    when 'est_comprovante' then 'Comprovantes de início e fim' when 'est_agendamento' then 'Agendamento'
    when 'est_tratativa' then 'Tratativa com cliente ou mesa' when 'est_retorno' then 'Evidência do retorno do cliente'
    when 'est_pagamento' then 'Comprovante de pagamento' when 'correcao' then 'Correção' else p end
$$;

-- ---------------------------------------------------------------------------
-- Cálculo da estadia (uma única regra, usada em toda conferência)
-- ---------------------------------------------------------------------------
create or replace function private.estadia_calcular(
  p_inicio timestamptz, p_saida timestamptz, p_tarifa numeric, p_peso_t numeric, p_limite_h numeric, p_retroagir_h numeric,
  out permanencia_h numeric, out horas_validas numeric, out valor numeric)
language plpgsql
immutable
as $$
begin
  -- Horas decimais exatas (15h28 = 15,4666… h), sem arredondar antes de multiplicar.
  permanencia_h := extract(epoch from (p_saida - p_inicio)) / 3600;
  horas_validas := case when permanencia_h > p_limite_h then greatest(0, permanencia_h - p_retroagir_h) else 0 end;
  valor := round(p_tarifa * p_peso_t * horas_validas, 2);
end $$;

-- Lista de números (CT-e, NFS, NF): texto, sem espaços nas pontas, sem repetidos, preservando zeros à esquerda.
create or replace function private.estadia_numeros(p jsonb, p_max integer, p_rotulo text)
returns text[]
language plpgsql
immutable
as $$
declare
  v text[];
begin
  if p is null or jsonb_typeof(p) <> 'array' then perform private.doc_erro('22023', 'Informe ' || p_rotulo || '.'); end if;
  select array_agg(distinct x order by x) into v
    from (select upper(regexp_replace(trim(e), '\s+', '', 'g')) x from jsonb_array_elements_text(p) e) t where x <> '';
  if v is null or cardinality(v) = 0 then perform private.doc_erro('22023', 'Informe ' || p_rotulo || '.'); end if;
  if cardinality(v) > p_max then perform private.doc_erro('22023', format('No máximo %s números em %s.', p_max, p_rotulo)); end if;
  if exists (select 1 from unnest(v) x where length(x) > 60 or x !~ '^[A-Z0-9./-]+$') then
    perform private.doc_erro('22023', 'Número inválido em ' || p_rotulo || ': use só letras, números, ponto, barra ou hífen.');
  end if;
  return v;
end $$;

create or replace function private.estadia_numero(p text, p_rotulo text)
returns numeric
language plpgsql
immutable
as $$
declare
  v numeric;
begin
  if p is null or trim(p) = '' then return null; end if;
  begin v := trim(p)::numeric; exception when others then perform private.doc_erro('22023', p_rotulo || ': valor numérico inválido.'); end;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Comercial: enviar estadia
-- ---------------------------------------------------------------------------
create or replace function public.criar_solicitacao_estadia(p_dados jsonb, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  c public.clientes;
  v_chave uuid := (p_dados ->> 'chave_envio')::uuid;
  v_placa text := upper(regexp_replace(coalesce(p_dados ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_tipo_doc text := p_dados ->> 'tipo_documento';
  v_docs text[];
  v_nfs text[];
  v_inicio timestamptz;
  v_saida timestamptz;
  v_tarifa numeric := private.estadia_numero(p_dados ->> 'tarifa', 'Tarifa');
  v_peso numeric := private.estadia_numero(p_dados ->> 'peso', 'Peso');
  v_unid text := p_dados ->> 'peso_unidade';
  v_peso_t numeric;
  v_motivo text := p_dados ->> 'motivo';
  v_outro text := nullif(left(trim(coalesce(p_dados ->> 'motivo_outro', '')), 200), '');
  v_modal text := p_dados ->> 'modalidade';
  v_sind boolean := (p_dados ->> 'sindicato')::boolean;
  v_sind_nome text := nullif(left(trim(coalesce(p_dados ->> 'sindicato_nome', '')), 120), '');
  v_ac_valor numeric;
  v_ac_quem text := nullif(left(trim(coalesce(p_dados ->> 'acordo_confirmado_por', '')), 120), '');
  v_ac_data date;
  v_ac_desc text := nullif(left(trim(coalesce(p_dados ->> 'acordo_descricao', '')), 2000), '');
  v_dups jsonb;
  v_retrato jsonb;
  v_conta record;
  v_inicio_tx timestamptz := now();
begin
  perform private.exigir('estadia.solicitar');
  if v_chave is null then perform private.doc_erro('22023', 'Envio sem identificador: recarregue a página.'); end if;
  select * into s from public.solicitacoes_doc where solicitante_id = auth.uid() and chave_envio = v_chave;
  if found then return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'repetido', true); end if;

  if v_tipo_doc is null or v_tipo_doc not in ('cte', 'nfs') then perform private.doc_erro('22023', 'Escolha o tipo de documento (CT-e ou Nota Fiscal de Serviço).'); end if;
  v_docs := private.estadia_numeros(p_dados -> 'documentos', 20, case when v_tipo_doc = 'cte' then 'o(s) número(s) do CT-e' else 'o(s) número(s) da NFS' end);
  v_nfs := private.estadia_numeros(p_dados -> 'nfs_carga', 50, 'o(s) número(s) da nota fiscal da carga');
  if v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    perform private.doc_erro('22023', 'Placa do veículo inválida: use o formato ABC1D23 ou ABC1234.');
  end if;
  if v_sind is null then perform private.doc_erro('22023', 'Responda se possui sindicato.'); end if;
  if v_sind and v_sind_nome is null then perform private.doc_erro('22023', 'Informe qual sindicato.'); end if;

  begin
    v_inicio := (p_dados ->> 'inicio')::timestamptz;
    v_saida := (p_dados ->> 'saida')::timestamptz;
  exception when others then perform private.doc_erro('22023', 'Data e horário de início ou saída inválidos.');
  end;
  if v_inicio is null or v_saida is null then perform private.doc_erro('22023', 'Informe início e saída da estadia.'); end if;
  if v_saida <= v_inicio then perform private.doc_erro('22023', 'A saída precisa ser depois do início da estadia.'); end if;
  if v_saida > now() + interval '15 minutes' then perform private.doc_erro('22023', 'A saída não pode estar no futuro.'); end if;
  if v_saida - v_inicio > interval '60 days' then perform private.doc_erro('22023', 'Permanência acima de 60 dias: confira as datas.'); end if;

  if v_tarifa is null or v_tarifa <= 0 or v_tarifa > 10000 then perform private.doc_erro('22023', 'Informe a tarifa da estadia em R$/t/h (maior que zero).'); end if;
  if v_unid is null or v_unid not in ('t', 'kg') then perform private.doc_erro('22023', 'Escolha a unidade do peso (t ou kg).'); end if;
  if v_peso is null or v_peso <= 0 then perform private.doc_erro('22023', 'Informe o peso do veículo (maior que zero).'); end if;
  v_peso_t := round(case when v_unid = 'kg' then v_peso / 1000 else v_peso end, 3);
  if v_peso_t <= 0 then perform private.doc_erro('22023', 'Peso do veículo muito pequeno: confira a unidade.'); end if;
  if v_peso_t > 100 then perform private.doc_erro('22023', 'Peso acima de 100 t: confira o valor e a unidade (t ou kg).'); end if;

  if v_motivo is null or v_motivo not in ('demora_descarga', 'redirecionamento', 'agendamento_alongado', 'troca_nota', 'falta_cota', 'outro') then
    perform private.doc_erro('22023', 'Escolha o motivo da estadia.');
  end if;
  if v_motivo = 'outro' and v_outro is null then perform private.doc_erro('22023', 'Descreva o motivo "Outro".'); end if;
  if v_modal is null or v_modal not in ('padrao', 'acordo') then perform private.doc_erro('22023', 'Escolha o tipo de estadia.'); end if;
  if v_modal = 'acordo' then
    v_ac_valor := private.estadia_numero(p_dados ->> 'acordo_valor', 'Valor acordado');
    begin v_ac_data := (p_dados ->> 'acordo_data')::date; exception when others then v_ac_data := null; end;
    if v_ac_valor is null or v_ac_valor <= 0 then perform private.doc_erro('22023', 'Informe o valor acordado em reais.'); end if;
    if v_ac_quem is null then perform private.doc_erro('22023', 'Informe quem confirmou o acordo.'); end if;
    if v_ac_data is null then perform private.doc_erro('22023', 'Informe a data da confirmação do acordo.'); end if;
    if v_ac_data > (now() at time zone 'America/Sao_Paulo')::date then perform private.doc_erro('22023', 'A data da confirmação do acordo não pode estar no futuro.'); end if;
    if v_ac_desc is null then perform private.doc_erro('22023', 'Descreva a tratativa do acordo.'); end if;
  end if;

  select * into c from public.clientes where id = nullif(p_dados ->> 'cliente_id', '')::uuid;
  if not found or not private.pode_ver_cliente(c.id) then perform private.doc_erro('22023', 'Selecione um cliente autorizado.'); end if;
  if v_filial is not null and not private.no_escopo(v_filial, null) then perform private.doc_erro('42501', 'Filial fora do seu escopo.'); end if;
  if v_filial is null and not private.eh_admin() and exists (select 1 from public.perfil_filiais where perfil_id = auth.uid()) then
    perform private.doc_erro('22023', 'Selecione a filial.');
  end if;

  -- Possível duplicidade: mesma placa com período sobreposto, ou mesmo documento do mesmo cliente. Avisa; não bloqueia.
  perform pg_advisory_xact_lock(hashtext('estadia:' || v_placa));
  if not coalesce((p_dados ->> 'confirmar_duplicidade')::boolean, false) then
    select jsonb_agg(jsonb_build_object('id', case when private.pode_ver_solicitacao_reg(x) then x.id end, 'codigo', x.est_codigo,
             'placa', x.placa, 'inicio', x.est_inicio, 'saida', x.est_saida, 'status', x.status,
             'motivo', case when x.placa = v_placa and tstzrange(x.est_inicio, x.est_saida) && tstzrange(v_inicio, v_saida)
                            then 'periodo' else 'documento' end) order by x.numero)
      into v_dups
      from public.solicitacoes_doc x
     where x.tipo = 'estadia' and x.status <> 'cancelado'
       and ((x.placa = v_placa and tstzrange(x.est_inicio, x.est_saida) && tstzrange(v_inicio, v_saida))
            or (x.cliente_id = c.id and x.est_tipo_documento = v_tipo_doc and x.est_documentos && v_docs));
    if v_dups is not null then return jsonb_build_object('status', 'possivel_duplicidade', 'duplicadas', v_dups); end if;
  end if;

  select jsonb_build_object(
    'codigo', null, 'cliente', c.nome, 'cliente_id', c.id, 'carteira', cm.nome, 'filial', f.nome, 'filial_id', f.id,
    'centro_custo', cc.nome, 'centro_custo_id', f.centro_custo_id,
    'origem_cidade', '', 'origem_uf', null, 'coleta', null, 'destino_cidade', '', 'destino_uf', null, 'entrega', null,
    'produto', null, 'lote_numero', null)
  into v_retrato
  from (select 1) x
  left join public.comerciais cm on cm.id = c.comercial_id
  left join public.filiais f on f.id = v_filial
  left join public.centros_custo cc on cc.id = f.centro_custo_id;

  insert into public.solicitacoes_doc (
    tipo, placa, observacoes, retrato, chave_envio, solicitante_id, solicitante_nome, filial_id, comercial_id, cliente_id,
    est_codigo, est_tipo_documento, est_documentos, est_nfs_carga, est_sindicato, est_sindicato_nome, est_inicio, est_saida,
    est_tarifa, est_peso_t, est_peso_informado, est_peso_unidade, est_motivo, est_motivo_outro, est_modalidade,
    est_acordo_valor, est_acordo_confirmado_por, est_acordo_data, est_acordo_descricao)
  values (
    'estadia', v_placa, nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''), v_retrato, v_chave,
    auth.uid(), coalesce(private.nome_usuario(), 'Usuário'), v_filial, c.comercial_id, c.id,
    'EST-' || lpad(nextval('public.estadia_codigo_seq')::text, 3, '0'), v_tipo_doc, v_docs, v_nfs, v_sind, case when v_sind then v_sind_nome end,
    v_inicio, v_saida, v_tarifa, v_peso_t, v_peso, v_unid, v_motivo, case when v_motivo = 'outro' then v_outro end, v_modal,
    case when v_modal = 'acordo' then round(v_ac_valor, 2) end, case when v_modal = 'acordo' then v_ac_quem end,
    case when v_modal = 'acordo' then v_ac_data end, case when v_modal = 'acordo' then v_ac_desc end)
  returning * into s;

  perform private.doc_vincular_anexos(s.id, p_anexos, array['est_documento', 'est_nf_carga', 'est_comprovante', 'est_agendamento', 'est_tratativa'], null);
  select count(*) filter (where categoria = 'est_documento') d, count(*) filter (where categoria = 'est_nf_carga') n,
         count(*) filter (where categoria = 'est_comprovante') p, count(*) filter (where categoria = 'est_tratativa') t
    into v_conta from public.doc_anexos where solicitacao_id = s.id;
  if v_conta.d = 0 then perform private.doc_erro('22023', 'Anexe o CT-e ou a Nota Fiscal de Serviço.'); end if;
  if v_conta.n = 0 then perform private.doc_erro('22023', 'Anexe a nota fiscal da carga.'); end if;
  if v_conta.p = 0 then perform private.doc_erro('22023', 'Anexe os comprovantes de início e fim da estadia.'); end if;
  if v_modal = 'acordo' and v_conta.t = 0 then perform private.doc_erro('22023', 'Anexe a evidência do acordo com o cliente ou a mesa.'); end if;
  perform private.estadia_conferir_limites(s.id, null, v_inicio_tx);
  perform private.doc_evento(s.id, 'evento', 'Estadia ' || s.est_codigo || ' enviada ao apoio');
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- ---------------------------------------------------------------------------
-- Apoio: conferir (salvar a memória de cálculo), encaminhar ao cliente, registrar retorno e pagamento, encerrar
-- ---------------------------------------------------------------------------
create or replace function private.estadia_carregar(p_id uuid, p_versao integer)
returns public.solicitacoes_doc
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  if s.tipo <> 'estadia' then perform private.doc_erro('55000', 'Esta solicitação não é de estadia.'); end if;
  if p_versao is not null and s.versao <> p_versao then
    perform private.doc_erro('40001', 'A estadia foi alterada por outra pessoa enquanto você editava. Os dados foram atualizados: confira e salve de novo.');
  end if;
  return s;
end $$;

create or replace function public.conferir_estadia(p_id uuid, p_dados jsonb, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_lim numeric := private.estadia_numero(p_dados ->> 'limite_h', 'Cobrar após quantas horas');
  v_ret numeric := private.estadia_numero(p_dados ->> 'retroagir_h', 'Horas a retroagir');
  v_tarifa numeric := private.estadia_numero(p_dados ->> 'tarifa', 'Tarifa');
  v_peso numeric := private.estadia_numero(p_dados ->> 'peso_t', 'Peso');
  v_inicio timestamptz;
  v_saida timestamptz;
  v_obs text := nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 1000), '');
  v_alt jsonb := '{}'::jsonb;
  v_calc record;
  v_ultima public.estadia_conferencias;
  v_conf public.estadia_conferencias;
begin
  s := private.estadia_carregar(p_id, p_versao);
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if v_lim is null or v_ret is null then
    perform private.doc_erro('22023', 'Informe "Cobrar após quantas horas" e "Horas a retroagir" (zero é um valor válido; vazio não).');
  end if;
  if v_lim < 0 or v_lim > 720 or v_ret < 0 or v_ret > 720 then perform private.doc_erro('22023', 'Horas entre 0 e 720.'); end if;
  begin
    v_inicio := coalesce(nullif(p_dados ->> 'inicio', '')::timestamptz, s.est_inicio);
    v_saida := coalesce(nullif(p_dados ->> 'saida', '')::timestamptz, s.est_saida);
  exception when others then perform private.doc_erro('22023', 'Data e horário inválidos.');
  end;
  v_tarifa := coalesce(v_tarifa, s.est_tarifa);
  v_peso := coalesce(v_peso, s.est_peso_t);
  if v_saida <= v_inicio then perform private.doc_erro('22023', 'A saída precisa ser depois do início da estadia.'); end if;
  if v_tarifa <= 0 or v_tarifa > 10000 then perform private.doc_erro('22023', 'Tarifa em R$/t/h maior que zero.'); end if;
  if v_peso <= 0 or v_peso > 100 then perform private.doc_erro('22023', 'Peso em toneladas entre 0 e 100: confira a unidade.'); end if;
  v_peso := round(v_peso, 3);
  -- O que o apoio corrigiu em relação ao que foi enviado fica registrado na própria conferência.
  if v_inicio <> s.est_inicio then v_alt := v_alt || jsonb_build_object('inicio', jsonb_build_object('original', s.est_inicio, 'usado', v_inicio)); end if;
  if v_saida <> s.est_saida then v_alt := v_alt || jsonb_build_object('saida', jsonb_build_object('original', s.est_saida, 'usado', v_saida)); end if;
  if v_tarifa <> s.est_tarifa then v_alt := v_alt || jsonb_build_object('tarifa', jsonb_build_object('original', s.est_tarifa, 'usado', v_tarifa)); end if;
  if v_peso <> s.est_peso_t then v_alt := v_alt || jsonb_build_object('peso_t', jsonb_build_object('original', s.est_peso_t, 'usado', v_peso)); end if;
  if v_alt <> '{}'::jsonb and v_obs is null then
    perform private.doc_erro('22023', 'Você alterou dados enviados pelo solicitante: explique na observação da conferência.');
  end if;

  select * into v_calc from private.estadia_calcular(v_inicio, v_saida, v_tarifa, v_peso, v_lim, v_ret);
  select * into v_ultima from public.estadia_conferencias where solicitacao_id = s.id order by versao desc limit 1;
  if found and v_ultima.inicio = v_inicio and v_ultima.saida = v_saida and v_ultima.tarifa = v_tarifa and v_ultima.peso_t = v_peso
     and v_ultima.limite_h = v_lim and v_ultima.retroagir_h = v_ret and v_ultima.observacao is not distinct from v_obs then
    return jsonb_build_object('status', 'sem_alteracao', 'registro', to_jsonb(s));
  end if;
  insert into public.estadia_conferencias (solicitacao_id, versao, inicio, saida, tarifa, peso_t, limite_h, retroagir_h,
    permanencia_h, horas_validas, valor, alteracoes, observacao, autor_id, autor_nome)
  values (s.id, coalesce(v_ultima.versao, 0) + 1, v_inicio, v_saida, v_tarifa, v_peso, v_lim, v_ret,
    v_calc.permanencia_h, v_calc.horas_validas, v_calc.valor, v_alt, v_obs, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'))
  returning * into v_conf;
  update public.solicitacoes_doc set est_conferencia_id = v_conf.id, est_conferencia_versao = v_conf.versao,
    est_limite_h = v_lim, est_retroagir_h = v_ret, est_horas_validas = v_calc.horas_validas, est_valor_calculado = v_calc.valor,
    est_conferido_em = v_conf.criado_em, est_conferido_por_nome = v_conf.autor_nome, versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', format('Memória de cálculo v%s salva: %s × %s t × %s h válidas = R$ %s (limite %s h, retroagir %s h)%s',
    v_conf.versao, to_char(v_tarifa, 'FM999G990D00####'), to_char(v_peso, 'FM999G990D000'), to_char(v_calc.horas_validas, 'FM999G990D00'),
    to_char(v_calc.valor, 'FM999G999G990D00'), to_char(v_lim, 'FM9990D##'), to_char(v_ret, 'FM9990D##'),
    case when v_alt <> '{}'::jsonb then ' · dados ajustados pelo apoio: ' || v_obs else '' end), 'calculo');
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'conferencia', to_jsonb(v_conf));
end $$;

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
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if s.est_conferencia_id is null then perform private.doc_erro('55000', 'Salve a memória de cálculo antes de aguardar o retorno do cliente.'); end if;
  update public.solicitacoes_doc set status = 'aguardando_cliente', est_encaminhado_em = now(), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', format('Encaminhada ao cliente pelo apoio (fora do app), conferência v%s: R$ %s%s',
    s.est_conferencia_versao, to_char(s.est_valor_calculado, 'FM999G999G990D00'), coalesce(' · ' || v_obs, '')), 'cliente');
  perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia aguardando retorno do cliente',
    format('%s · %s · valor calculado R$ %s', private.doc_titulo(s), s.retrato ->> 'cliente', to_char(s.est_valor_calculado, 'FM999G999G990D00')),
    s, 'estadia', 'estadia_cliente:' || s.id || ':' || s.versao);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

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
  v_data date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_antes text;
  v_novo text;
  v_msg uuid;
  v_ret public.estadia_retornos;
  v_desde timestamptz := now();
begin
  s := private.estadia_carregar(p_id, p_versao);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_cliente', 'pago_pendencia']);
  if s.est_conferencia_id is null then perform private.doc_erro('55000', 'Salve a memória de cálculo antes de registrar o retorno do cliente.'); end if;
  if v_res is null or v_res not in ('aprovada', 'aprovada_parcial', 'rejeitada') then perform private.doc_erro('22023', 'Escolha o resultado do cliente.'); end if;
  if v_just is null then perform private.doc_erro('22023', 'Descreva o retorno do cliente (justificativa).'); end if;
  begin v_data := coalesce(nullif(p_dados ->> 'data_retorno', '')::date, v_hoje); exception when others then perform private.doc_erro('22023', 'Data do retorno inválida.'); end;
  if v_data > v_hoje then perform private.doc_erro('22023', 'A data do retorno não pode estar no futuro.'); end if;
  if v_res = 'rejeitada' then v_valor := null;
  elsif v_res = 'aprovada' then v_valor := round(coalesce(v_valor, s.est_valor_calculado), 2);
  else v_valor := round(v_valor, 2);
  end if;
  if v_res <> 'rejeitada' and (v_valor is null or v_valor <= 0) then perform private.doc_erro('22023', 'Informe o valor aprovado pelo cliente (maior que zero).'); end if;

  v_antes := s.status;
  v_novo := case v_res when 'aprovada' then 'aprovada' when 'aprovada_parcial' then 'aprovada_parcial' else 'em_atendimento' end;
  v_msg := private.doc_evento(s.id, 'evento', format('Retorno do cliente registrado (%s): %s%s · %s%s',
    to_char(v_data, 'DD/MM/YYYY'),
    case v_res when 'aprovada' then 'Aprovada' when 'aprovada_parcial' then 'Aprovada parcialmente' else 'Rejeitada' end,
    case when v_valor is not null then ', valor aprovado R$ ' || to_char(v_valor, 'FM999G999G990D00') else '' end,
    v_just,
    case when v_antes = 'pago_pendencia' and v_novo = 'aprovada' then ' · situação Pago em pendência → Aprovada (pagamento e pendência de receita continuam registrados)'
         when v_antes = 'pago_pendencia' and v_novo = 'aprovada_parcial' then ' · situação Pago em pendência → Aprovada parcialmente (pagamento continua registrado)'
         else '' end), 'retorno');
  perform private.doc_vincular_anexos(s.id, p_anexos, array['est_retorno'], v_msg);
  if not exists (select 1 from public.doc_anexos where mensagem_id = v_msg and categoria = 'est_retorno') then
    perform private.doc_erro('22023', 'Anexe a evidência do retorno do cliente.');
  end if;
  perform private.estadia_conferir_limites(s.id, v_msg, v_desde);
  insert into public.estadia_retornos (solicitacao_id, resultado, valor_aprovado, justificativa, data_retorno, conferencia_id, valor_calculado,
    status_anterior, status_novo, mensagem_id, autor_id, autor_nome)
  values (s.id, v_res, v_valor, v_just, v_data, s.est_conferencia_id, s.est_valor_calculado, v_antes, v_novo, v_msg, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'))
  returning * into v_ret;
  update public.solicitacoes_doc set status = v_novo, est_resultado = v_res, est_valor_aprovado = v_valor, est_retorno_em = now(),
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

create or replace function public.registrar_pagamento_estadia(p_id uuid, p_dados jsonb, p_anexos jsonb, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_valor numeric := private.estadia_numero(p_dados ->> 'valor_pago', 'Valor pago');
  v_data date;
  v_obs text := nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 1000), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_msg uuid;
  v_pag public.estadia_pagamentos;
  v_desde timestamptz := now();
begin
  s := private.estadia_carregar(p_id, p_versao);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_cliente', 'pago_pendencia']);
  if s.est_conferencia_id is null then perform private.doc_erro('55000', 'Salve a memória de cálculo antes de registrar o pagamento.'); end if;
  if v_valor is null or v_valor <= 0 then perform private.doc_erro('22023', 'Informe o valor efetivamente pago (maior que zero).'); end if;
  begin v_data := nullif(p_dados ->> 'data_pagamento', '')::date; exception when others then v_data := null; end;
  if v_data is null then perform private.doc_erro('22023', 'Informe a data do pagamento.'); end if;
  if v_data > v_hoje then perform private.doc_erro('22023', 'A data do pagamento não pode estar no futuro.'); end if;
  v_msg := private.doc_evento(s.id, 'evento', format('Pagamento informado (feito fora do app) em %s: R$ %s, com receita pendente%s',
    to_char(v_data, 'DD/MM/YYYY'), to_char(round(v_valor, 2), 'FM999G999G990D00'), coalesce(' · ' || v_obs, '')), 'pagamento');
  perform private.doc_vincular_anexos(s.id, p_anexos, array['est_pagamento'], v_msg);
  if not exists (select 1 from public.doc_anexos where mensagem_id = v_msg and categoria = 'est_pagamento') then
    perform private.doc_erro('22023', 'Anexe o comprovante do pagamento.');
  end if;
  perform private.estadia_conferir_limites(s.id, v_msg, v_desde);
  insert into public.estadia_pagamentos (solicitacao_id, valor_pago, data_pagamento, observacao, conferencia_id, mensagem_id, autor_id, autor_nome)
  values (s.id, round(v_valor, 2), v_data, v_obs, s.est_conferencia_id, v_msg, auth.uid(), coalesce(private.nome_usuario(), 'Usuário'))
  returning * into v_pag;
  update public.solicitacoes_doc set status = 'pago_pendencia',
    est_valor_pago = (select sum(valor_pago) from public.estadia_pagamentos where solicitacao_id = s.id),
    est_pago_em = (select max(data_pagamento) from public.estadia_pagamentos where solicitacao_id = s.id),
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia paga com receita pendente',
    format('%s · %s · pago R$ %s', private.doc_titulo(s), s.retrato ->> 'cliente', to_char(v_pag.valor_pago, 'FM999G999G990D00')),
    s, 'estadia', 'estadia_pagamento:' || v_pag.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'pagamento', to_jsonb(v_pag));
end $$;

create or replace function public.encerrar_estadia(p_id uuid, p_motivo text, p_versao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 1000), '');
begin
  s := private.estadia_carregar(p_id, p_versao);
  perform private.doc_exigir_responsavel(s, array['em_atendimento']);
  if s.est_resultado is distinct from 'rejeitada' then
    perform private.doc_erro('55000', 'Encerrar vale para estadia que não gerou cobrança: registre antes o retorno do cliente como Rejeitada.');
  end if;
  if v_motivo is null then perform private.doc_erro('22023', 'Informe o motivo do encerramento.'); end if;
  update public.solicitacoes_doc set status = 'encerrado', est_encerrado_motivo = v_motivo, concluido_em = now(),
    concluido_por_nome = coalesce(private.nome_usuario(), 'Usuário'), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Estadia encerrada sem cobrança por ' || s.concluido_por_nome || ': ' || v_motivo
    || case when s.est_valor_pago is not null then ' · pagamento informado de R$ ' || to_char(s.est_valor_pago, 'FM999G999G990D00') || ' continua registrado' else '' end, 'encerramento');
  perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia encerrada',
    format('%s · %s · %s', private.doc_titulo(s), s.retrato ->> 'cliente', left(v_motivo, 120)), s, 'estadia', 'estadia_encerrada:' || s.id || ':' || s.versao);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.reabrir_estadia(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 1000), '');
  v_antes text;
begin
  perform private.exigir('estadia.reabrir');
  s := private.estadia_carregar(p_id, null);
  if s.status not in ('cancelado', 'encerrado', 'aprovada', 'aprovada_parcial') then
    perform private.doc_erro('55000', 'Só estadia cancelada, encerrada ou aprovada pode ser reaberta.');
  end if;
  if v_motivo is null then perform private.doc_erro('22023', 'Informe o motivo da reabertura.'); end if;
  v_antes := s.status;
  update public.solicitacoes_doc set status = case when responsavel_id is null then 'enviado' else 'em_atendimento' end,
    concluido_em = null, concluido_por_nome = null, versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', format('Estadia reaberta por %s (estava %s): %s',
    coalesce(private.nome_usuario(), 'Usuário'),
    case v_antes when 'cancelado' then 'Cancelada' when 'encerrado' then 'Encerrada' when 'aprovada' then 'Aprovada' else 'Aprovada parcialmente' end,
    v_motivo), 'reabertura');
  perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia reaberta',
    format('%s · %s', private.doc_titulo(s), left(v_motivo, 140)), s, 'estadia', 'estadia_reaberta:' || s.id || ':' || s.versao);
  perform private.doc_notificar(s.responsavel_id, 'estadia_atualizada', 'Estadia reaberta para você',
    format('%s · %s', private.doc_titulo(s), left(v_motivo, 140)), s, 'apoio', 'estadia_reaberta_apoio:' || s.id || ':' || s.versao);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- ---------------------------------------------------------------------------
-- Funções comuns que passam a conhecer a estadia
-- ---------------------------------------------------------------------------
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
    format('%s · %s: %s', private.doc_titulo(s), s.placa, left(trim(p_texto), 140)),
    s, case s.tipo when 'cadastro' then 'cadastro' when 'estadia' then 'estadia' else 'embarque' end, 'ajuste:' || v_msg);
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
  v_desde timestamptz := now();
begin
  s := private.doc_carregar(p_id);
  perform private.exigir(case s.tipo when 'cadastro' then 'cadastro.solicitar' when 'estadia' then 'estadia.solicitar' else 'documentacao.solicitar' end);
  if s.status <> 'aguardando_informacao' then
    perform private.doc_erro('55000', 'Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
  end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then perform private.doc_erro('22023', 'Escreva a resposta para o apoio.'); end if;
  v_msg := private.doc_evento(s.id, 'resposta', left(trim(p_texto), 4000));
  perform private.doc_vincular_anexos(s.id, p_anexos,
    case s.tipo when 'cadastro' then array['motorista', 'veiculo', 'correcao']
                when 'estadia' then array['est_documento', 'est_nf_carga', 'est_comprovante', 'est_agendamento', 'est_tratativa', 'correcao']
                else array['nf', 'evidencia_frete', 'correcao'] end, v_msg);
  if s.tipo = 'cadastro' then
    -- Correções entram como nova versão: os anteriores ficam; o limite vale para os arquivos desta resposta.
    select count(*) filter (where categoria = 'motorista'), count(*) filter (where categoria = 'veiculo')
      into v_mot, v_vei from public.doc_anexos where mensagem_id = v_msg;
    if v_mot > 4 or v_vei > 10 then
      perform private.doc_erro('22023', 'Na resposta: até 4 documentos do motorista e 10 dos veículos.');
    end if;
  elsif s.tipo = 'estadia' then
    perform private.estadia_conferir_limites(s.id, v_msg, v_desde);
  end if;
  -- Volta para a fila do responsável: a nova espera começa agora, até ele retomar.
  update public.solicitacoes_doc set status = 'correcao_recebida', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_notificar(s.responsavel_id, 'resposta_enviada', 'Correção recebida: retome o atendimento',
    format('%s · %s: %s', private.doc_titulo(s), s.placa, left(trim(p_texto), 140)),
    s, 'apoio', 'resposta:' || v_msg);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- Documentos emitidos e "Documentação disponível" valem só para Lote e Emissão / Emissão.
create or replace function public.anexar_documentos_doc(p_id uuid, p_anexos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_n integer;
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_informacao']);
  if s.tipo = 'cadastro' then perform private.doc_erro('55000', 'Cadastro não recebe documentos emitidos: confirme a conclusão do cadastro.'); end if;
  if s.tipo = 'estadia' then perform private.doc_erro('55000', 'Estadia não recebe documentos emitidos: use a memória de cálculo e o retorno do cliente.'); end if;
  v_n := private.doc_vincular_anexos(s.id, p_anexos, array['cte', 'mdfe', 'outro_emitido'], null);
  if v_n = 0 then perform private.doc_erro('22023', 'Nenhum arquivo para anexar.'); end if;
  perform private.doc_evento(s.id, 'evento', v_n || ' documento(s) emitido(s) anexado(s), em conferência', 'documentos');
  s := private.doc_tocar(s.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

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
  if not exists (select 1 from public.doc_anexos where solicitacao_id = s.id and categoria in ('cte', 'mdfe', 'outro_emitido')) then
    perform private.doc_erro('55000', 'Anexe ao menos um documento emitido (CT-e, MDF-e ou outro) antes de liberar.');
  end if;
  if s.tipo = 'lote_emissao' and s.lote_id is null then
    perform private.doc_erro('55000', 'Registre o número do lote gerado no ERP antes de liberar a documentação.');
  end if;
  update public.solicitacoes_doc set status = 'documentacao_disponivel', concluido_em = now(),
    concluido_por_nome = coalesce(private.nome_usuario(), 'Usuário'), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Documentação disponível, conferida e liberada por ' || s.concluido_por_nome);
  perform private.doc_notificar(s.solicitante_id, 'documentacao_disponivel', 'Documentação disponível',
    format('%s nº %s · %s · %s', private.doc_rotulo(s), s.numero, s.placa, s.retrato ->> 'cliente'),
    s, 'embarque', 'disponivel:' || s.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

create or replace function public.cancelar_solicitacao_doc(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
begin
  s := private.doc_carregar(p_id);
  if s.status in ('documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado', 'cancelado') then
    perform private.doc_erro('55000', 'Solicitação já concluída, encerrada ou cancelada.');
  end if;
  if not (private.tem_permissao('documentacao.cancelar') or (s.solicitante_id = auth.uid() and s.status = 'enviado')) then
    perform private.doc_erro('42501', 'Você não tem permissão para cancelar esta solicitação.');
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then perform private.doc_erro('22023', 'Informe o motivo do cancelamento.'); end if;
  if exists (select 1 from public.lotes_erp where solicitacao_id = s.id) then
    perform private.doc_erro('55000', 'O lote já foi registrado nesta solicitação: conclua a emissão em vez de cancelar.');
  end if;
  update public.solicitacoes_doc set status = 'cancelado', cancelado_em = now(), cancelado_por_nome = coalesce(private.nome_usuario(), 'Usuário'),
    cancelado_motivo = left(trim(p_motivo), 1000), versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento', 'Solicitação cancelada por ' || s.cancelado_por_nome || ': ' || s.cancelado_motivo);
  if s.tipo = 'estadia' then
    perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia cancelada',
      format('%s · %s', private.doc_titulo(s), left(s.cancelado_motivo, 140)), s, 'estadia', 'estadia_cancelada:' || s.id || ':' || s.versao);
  end if;
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;

-- ---------------------------------------------------------------------------
-- Eventos do Painel: espera pelo cliente separada do atendimento ativo
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.solicitacao_eventos'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%evento%status_alterado%' loop
    execute format('alter table public.solicitacao_eventos drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.solicitacao_eventos add constraint solicitacao_eventos_evento_check check (evento in (
  'enviado', 'assumido', 'devolvido', 'corrigido', 'retomado', 'transferido', 'concluido', 'cancelado', 'reaberto', 'status_alterado',
  'enviado_cliente', 'pago_pendencia', 'retorno_cliente'));

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
      when old.status in ('documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado', 'cancelado') then 'reaberto'
      when old.status = 'enviado' and new.status = 'em_atendimento' then 'assumido'
      when new.status = 'aguardando_informacao' then 'devolvido'
      when old.status = 'aguardando_informacao' and new.status in ('correcao_recebida', 'em_atendimento') then 'corrigido'
      when old.status = 'correcao_recebida' and new.status = 'em_atendimento' then 'retomado'
      when new.status = 'aguardando_cliente' then 'enviado_cliente'
      when new.status = 'pago_pendencia' then 'pago_pendencia'
      when old.status in ('aguardando_cliente', 'pago_pendencia') and new.status = 'em_atendimento' then 'retorno_cliente'
      when new.status in ('documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado') then 'concluido'
      when new.status = 'cancelado' then 'cancelado'
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
    case when tg_op = 'INSERT' then new.enviado_em else now() end)
  on conflict do nothing;
  return null;
end $$;

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
            or s.status in ('enviado', 'em_atendimento', 'aguardando_informacao', 'correcao_recebida', 'aguardando_cliente', 'pago_pendencia'))
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
-- Privilégios e tempo real
-- ---------------------------------------------------------------------------
revoke all on function private.pode_ver_estadia(uuid, uuid, uuid) from public, anon;
grant execute on function private.pode_ver_estadia(uuid, uuid, uuid) to authenticated;
revoke all on function private.doc_titulo(public.solicitacoes_doc), private.estadia_config(),
  private.estadia_conferir_limites(uuid, uuid, timestamptz), private.estadia_categoria(text),
  private.estadia_calcular(timestamptz, timestamptz, numeric, numeric, numeric, numeric),
  private.estadia_numeros(jsonb, integer, text), private.estadia_numero(text, text), private.estadia_carregar(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.criar_solicitacao_estadia(jsonb, jsonb), public.conferir_estadia(uuid, jsonb, integer),
  public.encaminhar_cliente_estadia(uuid, text, integer), public.registrar_retorno_estadia(uuid, jsonb, jsonb, integer),
  public.registrar_pagamento_estadia(uuid, jsonb, jsonb, integer), public.encerrar_estadia(uuid, text, integer),
  public.reabrir_estadia(uuid, text) from public, anon;
grant execute on function public.criar_solicitacao_estadia(jsonb, jsonb), public.conferir_estadia(uuid, jsonb, integer),
  public.encaminhar_cliente_estadia(uuid, text, integer), public.registrar_retorno_estadia(uuid, jsonb, jsonb, integer),
  public.registrar_pagamento_estadia(uuid, jsonb, jsonb, integer), public.encerrar_estadia(uuid, text, integer),
  public.reabrir_estadia(uuid, text) to authenticated;
revoke usage on sequence public.estadia_codigo_seq from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'estadia_conferencias') then
      alter publication supabase_realtime add table public.estadia_conferencias, public.estadia_retornos, public.estadia_pagamentos;
    end if;
  end if;
end $$;
