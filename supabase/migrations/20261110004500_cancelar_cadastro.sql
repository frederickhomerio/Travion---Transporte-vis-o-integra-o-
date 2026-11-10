-- Cancelar ficha de cadastro (pedido de 10/11/2026): o embarcador ou o apoio cancela a ficha, sempre com motivo.
-- Antes: quem enviou só cancelava enquanto ninguém tinha assumido, e o apoio não cancelava (só o Gestor).
-- Agora, só para fichas de Cadastro (lote, emissão e estadia continuam como estão):
--   cadastro.cancelar         → cancela qualquer ficha em aberto do seu escopo (padrão: Apoio, Gestor, Apoio do Industrializado);
--   cadastro.cancelar_propria → cancela a própria ficha em aberto, mesmo depois que o apoio assumiu
--                               (padrão: todas as funções que hoje enviam cadastro).
-- Ajustáveis em Administração → Permissões. Avisos pelo sino: quem enviou (se outra pessoa cancelou) e o responsável do apoio.
-- Só acrescenta permissões e troca uma função. Não apaga dados. Reexecutável.

insert into public.permissoes (chave, grupo, descricao) values
  ('cadastro.cancelar_propria', 'Cadastro', 'Cancelar a própria ficha de cadastro em aberto, mesmo depois que o apoio assumiu (com motivo)'),
  ('cadastro.cancelar',         'Cadastro', 'Cancelar qualquer ficha de cadastro em aberto do seu escopo (com motivo)')
on conflict do nothing;

-- Quem envia cadastro hoje passa a poder cancelar a própria ficha.
insert into public.papel_permissoes (papel, chave)
select papel, 'cadastro.cancelar_propria' from public.papel_permissoes where chave = 'cadastro.solicitar'
on conflict do nothing;

-- Apoio (e o antigo papel Operação, unificado no Apoio), Gestor e Apoio do Industrializado cancelam qualquer ficha.
insert into public.papel_permissoes (papel, chave)
select p::public.papel_usuario, 'cadastro.cancelar' from unnest(array['apoio', 'operacao', 'gestor', 'ind_apoio']) p
on conflict do nothing;

-- Novo aviso do sino.
alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'ajuste_solicitado', 'documentacao_disponivel', 'resposta_enviada', 'cadastro_concluido', 'cadastro_cancelado',
  'estadia_atualizada', 'documentacao_devolvida'));

create or replace function public.cancelar_solicitacao_doc(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_minha boolean;
  v_titulo text;
  v_texto text;
begin
  s := private.doc_carregar(p_id);
  if s.status in ('documentacao_disponivel', 'cadastro_concluido', 'aprovada', 'aprovada_parcial', 'encerrado', 'cancelado') then
    perform private.doc_erro('55000', 'Solicitação já concluída, encerrada ou cancelada.');
  end if;
  v_minha := s.solicitante_id = auth.uid();
  if not (private.tem_permissao('documentacao.cancelar')
          or (v_minha and s.status = 'enviado')
          or (s.tipo = 'cadastro' and (private.tem_permissao('cadastro.cancelar')
                                       or (v_minha and private.tem_permissao('cadastro.cancelar_propria'))))) then
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
  if s.tipo = 'cadastro' then
    -- doc_notificar não avisa a própria pessoa que cancelou.
    v_titulo := 'Cadastro da placa ' || substr(s.placa, 1, 3) || '-' || substr(s.placa, 4) || ' cancelado';
    v_texto := format('Cadastro nº %s · %s: %s', s.numero, s.cancelado_por_nome, left(s.cancelado_motivo, 140));
    perform private.doc_notificar(s.solicitante_id, 'cadastro_cancelado', v_titulo, v_texto, s, 'cadastro', 'cadastro_cancelado:' || s.id);
    perform private.doc_notificar(s.responsavel_id, 'cadastro_cancelado', v_titulo, v_texto, s, 'apoio', 'cadastro_cancelado:' || s.id);
  end if;
  if s.tipo = 'estadia' then
    perform private.doc_notificar(s.solicitante_id, 'estadia_atualizada', 'Estadia cancelada',
      format('%s · %s', private.doc_titulo(s), left(s.cancelado_motivo, 140)), s, 'estadia', 'estadia_cancelada:' || s.id || ':' || s.versao);
  end if;
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;
