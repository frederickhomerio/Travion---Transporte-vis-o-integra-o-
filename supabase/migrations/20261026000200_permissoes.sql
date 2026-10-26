-- Frete IQ — permissões, escopo e políticas de acesso (RLS)
--
-- Princípio: usuários autenticados só LEEM tabelas (via RLS). Toda gravação passa por funções
-- do servidor (SECURITY DEFINER) que verificam permissão campo a campo. Assim, ocultar um botão
-- na interface nunca é a única barreira: uma requisição direta à API também é recusada.

-- ---------------------------------------------------------------------------
-- Catálogo de permissões e matriz inicial
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, grupo, descricao) values
  ('embarques.ver',              'Embarques',      'Consultar embarques e posições no escopo autorizado'),
  ('embarques.criar',            'Embarques',      'Cadastrar novos embarques'),
  ('embarques.editar_cadastro',  'Embarques',      'Alterar cliente, rota, produto, filial, locais e observação interna'),
  ('embarques.liberar',          'Embarques',      'Liberar ou suspender embarques e alterar a data de liberação'),
  ('embarques.editar_cadencia',  'Embarques',      'Alterar cadência (meta) do embarque'),
  ('embarques.editar_capacidade','Embarques',      'Alterar toneladas médias por veículo'),
  ('embarques.arquivar',         'Embarques',      'Arquivar ou reativar embarques'),
  ('carteira.editar',            'Comercial',      'Alterar a carteira (responsável comercial) de clientes e embarques'),
  ('posicoes.abrir',             'Posições',       'Abrir posição para nova data operacional'),
  ('posicoes.editar_contadores', 'Posições',       'Alterar porta, trânsito e carregados'),
  ('posicoes.editar_obs_operacional','Posições',   'Alterar observação operacional interna'),
  ('posicoes.editar_obs_cliente','Posições',       'Alterar observação destinada ao cliente'),
  ('financeiro.ver',             'Financeiro',     'Ver fretes, tickets, faturamento e margem'),
  ('financeiro.editar',          'Financeiro',     'Alterar fretes, unidade do frete e metas financeiras'),
  ('historico.ver',              'Histórico',      'Consultar histórico de alterações'),
  ('compartilhamento.preparar',  'Compartilhamento','Preparar posição para WhatsApp, e-mail, imagem e PDF'),
  ('compartilhamento.links',     'Compartilhamento','Criar e revogar links externos de consulta'),
  ('importacao.executar',        'Administração',  'Importar planilhas e ver dados de referência da origem'),
  ('cadastros.gerenciar',        'Administração',  'Gerenciar clientes, filiais, comerciais, produtos e locais'),
  ('usuarios.gerenciar',         'Administração',  'Gerenciar usuários, convites e matriz de permissões'),
  ('configuracoes.gerenciar',    'Administração',  'Alterar configurações gerais (capacidade padrão, meta padrão etc.)');

-- Administrador tem acesso total por regra (ver private.tem_permissao); a matriz abaixo é dos demais papéis.
insert into public.papel_permissoes (papel, chave) values
  -- Gestor: acesso financeiro depende de autorização específica (exceção por usuário)
  ('gestor', 'embarques.ver'), ('gestor', 'embarques.criar'), ('gestor', 'embarques.editar_cadastro'),
  ('gestor', 'embarques.liberar'), ('gestor', 'embarques.editar_cadencia'), ('gestor', 'embarques.editar_capacidade'),
  ('gestor', 'embarques.arquivar'), ('gestor', 'posicoes.abrir'), ('gestor', 'posicoes.editar_contadores'),
  ('gestor', 'posicoes.editar_obs_operacional'), ('gestor', 'posicoes.editar_obs_cliente'),
  ('gestor', 'historico.ver'), ('gestor', 'compartilhamento.preparar'), ('gestor', 'compartilhamento.links'),
  -- Operação
  ('operacao', 'embarques.ver'), ('operacao', 'posicoes.abrir'), ('operacao', 'posicoes.editar_contadores'),
  ('operacao', 'posicoes.editar_obs_operacional'),
  -- Comercial: contadores dependem de permissão adicional
  ('comercial', 'embarques.ver'), ('comercial', 'financeiro.ver'), ('comercial', 'financeiro.editar'),
  ('comercial', 'embarques.editar_cadencia'), ('comercial', 'posicoes.editar_obs_cliente'),
  ('comercial', 'historico.ver'), ('comercial', 'compartilhamento.preparar'), ('comercial', 'compartilhamento.links'),
  -- Consulta interna
  ('consulta', 'embarques.ver');

insert into public.configuracoes (chave, valor, descricao) values
  ('capacidade_padrao_t', '40', 'Toneladas médias por veículo sugeridas para novos embarques (planilha: 40 t)'),
  ('meta_veiculos_lote_padrao', '2', 'Meta padrão de veículos por lote/dia quando o embarque não tem cadência (planilha: 2)'),
  ('cadencia_unidade_padrao', '"veiculos_dia"', 'Unidade padrão da cadência: veiculos_dia ou toneladas_dia'),
  ('ticket_inclui_frete_zero', 'true', 'Se fretes iguais a zero entram na média simples do ticket (planilha: entram)'),
  ('link_validade_padrao_horas', '72', 'Validade padrão dos links externos de consulta, em horas');

-- ---------------------------------------------------------------------------
-- Funções de autorização (schema private: não exposto pela API)
-- ---------------------------------------------------------------------------
create or replace function private.perfil_id()
returns uuid
language sql
stable
as $$ select auth.uid() $$;

create or replace function private.usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and p.status = 'ativo')
$$;

create or replace function private.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and p.status = 'ativo' and p.papel = 'administrador')
$$;

create or replace function private.tem_permissao(p_chave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when p.status <> 'ativo' then false
      when p.papel = 'administrador' then true
      else coalesce(
        (select pp.permitido from public.perfil_permissoes pp where pp.perfil_id = p.id and pp.chave = p_chave),
        exists (select 1 from public.papel_permissoes rp where rp.papel = p.papel and rp.chave = p_chave))
    end
    from public.perfis p where p.id = auth.uid()
  ), false)
$$;

-- Escopo: administrador vê tudo; demais veem as filiais autorizadas e/ou a própria carteira comercial.
create or replace function private.no_escopo(p_filial_id uuid, p_comercial_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when p.status <> 'ativo' then false
      when p.papel = 'administrador' then true
      else exists (select 1 from public.perfil_filiais pf where pf.perfil_id = p.id and pf.filial_id = p_filial_id)
        or (p.comercial_id is not null and p.comercial_id = p_comercial_id)
    end
    from public.perfis p where p.id = auth.uid()
  ), false)
$$;

create or replace function private.pode_ver_embarque(p_embarque_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.tem_permissao('embarques.ver') and exists (
    select 1 from public.embarques e
    where e.id = p_embarque_id and private.no_escopo(e.filial_id, e.comercial_id))
$$;

create or replace function private.pode_ver_cliente(p_cliente_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.usuario_ativo() and (
    private.eh_admin()
    or private.tem_permissao('cadastros.gerenciar')
    or private.tem_permissao('embarques.criar')
    or exists (select 1 from public.clientes c join public.perfis p on p.id = auth.uid()
               where c.id = p_cliente_id and p.comercial_id is not null and c.comercial_id = p.comercial_id)
    or exists (select 1 from public.embarques e
               where e.cliente_id = p_cliente_id and private.no_escopo(e.filial_id, e.comercial_id)))
$$;

create or replace function private.nome_usuario()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(nullif(p.nome, ''), p.email, 'Usuário') from public.perfis p where p.id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- Privilégios: leitura apenas; nenhuma escrita direta para usuários da API
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

grant select on
  public.filiais, public.comerciais, public.clientes, public.produtos, public.locais,
  public.perfis, public.perfil_filiais, public.permissoes, public.papel_permissoes, public.perfil_permissoes,
  public.convites, public.configuracoes, public.metas_diarias,
  public.embarques, public.embarque_financeiro, public.embarque_dados_origem,
  public.posicoes_diarias, public.historico_alteracoes, public.links_cliente, public.importacoes
to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.filiais enable row level security;
alter table public.comerciais enable row level security;
alter table public.clientes enable row level security;
alter table public.produtos enable row level security;
alter table public.locais enable row level security;
alter table public.perfis enable row level security;
alter table public.perfil_filiais enable row level security;
alter table public.permissoes enable row level security;
alter table public.papel_permissoes enable row level security;
alter table public.perfil_permissoes enable row level security;
alter table public.convites enable row level security;
alter table public.configuracoes enable row level security;
alter table public.metas_diarias enable row level security;
alter table public.embarques enable row level security;
alter table public.embarque_financeiro enable row level security;
alter table public.embarque_dados_origem enable row level security;
alter table public.posicoes_diarias enable row level security;
alter table public.historico_alteracoes enable row level security;
alter table public.links_cliente enable row level security;
alter table public.importacoes enable row level security;

create policy leitura on public.filiais for select to authenticated using (private.usuario_ativo());
create policy leitura on public.comerciais for select to authenticated using (private.usuario_ativo());
create policy leitura on public.produtos for select to authenticated using (private.usuario_ativo());
create policy leitura on public.locais for select to authenticated using (private.usuario_ativo());
create policy leitura on public.clientes for select to authenticated using (private.pode_ver_cliente(id));

create policy leitura on public.perfis for select to authenticated
  using (id = auth.uid() or private.tem_permissao('usuarios.gerenciar'));
create policy leitura on public.perfil_filiais for select to authenticated
  using (perfil_id = auth.uid() or private.tem_permissao('usuarios.gerenciar'));
create policy leitura on public.perfil_permissoes for select to authenticated
  using (perfil_id = auth.uid() or private.tem_permissao('usuarios.gerenciar'));
create policy leitura on public.permissoes for select to authenticated using (true);
create policy leitura on public.papel_permissoes for select to authenticated using (true);
create policy leitura on public.convites for select to authenticated using (private.tem_permissao('usuarios.gerenciar'));

create policy leitura on public.configuracoes for select to authenticated using (private.usuario_ativo());
create policy leitura on public.metas_diarias for select to authenticated using (private.tem_permissao('financeiro.ver'));

create policy leitura on public.embarques for select to authenticated
  using (private.tem_permissao('embarques.ver') and private.no_escopo(filial_id, comercial_id));
create policy leitura on public.embarque_financeiro for select to authenticated
  using (private.tem_permissao('financeiro.ver') and private.pode_ver_embarque(embarque_id));
create policy leitura on public.embarque_dados_origem for select to authenticated
  using (private.tem_permissao('importacao.executar') and private.pode_ver_embarque(embarque_id));
create policy leitura on public.posicoes_diarias for select to authenticated
  using (private.pode_ver_embarque(embarque_id));

create policy leitura on public.historico_alteracoes for select to authenticated
  using (
    private.tem_permissao('historico.ver')
    and (not sensivel or private.tem_permissao('financeiro.ver'))
    and case entidade
      when 'usuario' then private.tem_permissao('usuarios.gerenciar')
      when 'configuracao' then private.tem_permissao('configuracoes.gerenciar')
      when 'importacao' then private.tem_permissao('importacao.executar')
      when 'cliente' then private.pode_ver_cliente(cliente_id)
      when 'compartilhamento' then private.tem_permissao('compartilhamento.links') and private.pode_ver_cliente(cliente_id)
      else embarque_id is not null and private.pode_ver_embarque(embarque_id)
    end);

create policy leitura on public.links_cliente for select to authenticated
  using (private.tem_permissao('compartilhamento.links') and private.pode_ver_cliente(cliente_id));
create policy leitura on public.importacoes for select to authenticated
  using (private.tem_permissao('importacao.executar'));
