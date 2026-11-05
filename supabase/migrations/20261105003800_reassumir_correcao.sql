-- 05/11: reassumir chamado com correção recebida.
-- Quando o apoio devolve a solicitação ao comercial (pedir ajuste) e o comercial responde, o chamado volta como
-- "correcao_recebida" para quem devolveu. Se essa pessoa saiu (almoço, fim do expediente), outra pessoa do apoio
-- pode reassumir: vira a responsável e o atendimento continua (status em_atendimento).
--   * Nova permissão apoio.reassumir (ajustável em Administração → Permissões); padrão: papéis que já atendem a fila.
--   * Vale para todas as filas do apoio (Lote e Emissão, Emissão, Cadastro, Estadia), só na etapa correcao_recebida.
--   * Registro: evento "retomado" com o novo responsável (gatilho), mensagem no histórico e aviso a quem estava com ele.
-- Reexecutável.

insert into public.permissoes (chave, grupo, descricao) values
  ('apoio.reassumir', 'Documentação', 'Reassumir chamado com correção recebida que está com outra pessoa do apoio (ex.: almoço ou fim do expediente)')
on conflict (chave) do update set grupo = excluded.grupo, descricao = excluded.descricao;

insert into public.papel_permissoes (papel, chave)
select distinct pp.papel, 'apoio.reassumir' from public.papel_permissoes pp where pp.chave = 'apoio.atender'
on conflict do nothing;

create or replace function public.retomar_atendimento_doc(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  v_antes_id uuid;
  v_antes_nome text;
  v_nome text := coalesce(private.nome_usuario(), 'Usuário');
begin
  s := private.doc_carregar(p_id);
  if s.status = 'em_atendimento' and s.responsavel_id = auth.uid() then
    return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s)); -- já retomado (clique repetido)
  end if;
  if s.responsavel_id is not distinct from auth.uid() then
    perform private.doc_exigir_responsavel(s, array['correcao_recebida']);
    update public.solicitacoes_doc set status = 'em_atendimento', versao = versao + 1, atualizado_em = now()
    where id = s.id returning * into s;
    perform private.doc_evento(s.id, 'evento', 'Atendimento retomado por ' || v_nome);
    return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
  end if;

  -- Outra pessoa do apoio reassume o chamado devolvido e já corrigido.
  perform private.exigir('apoio.atender');
  perform private.exigir('apoio.reassumir');
  if s.status <> 'correcao_recebida' then
    if s.status = 'em_atendimento' then
      perform private.doc_erro('55000', 'Este chamado já foi retomado por ' || coalesce(s.responsavel_nome, 'outra pessoa') || '.');
    end if;
    perform private.doc_erro('55000', 'Só dá para reassumir um chamado com correção recebida.');
  end if;
  v_antes_id := s.responsavel_id;
  v_antes_nome := s.responsavel_nome;
  update public.solicitacoes_doc set responsavel_id = auth.uid(), responsavel_nome = v_nome,
    status = 'em_atendimento', versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  perform private.doc_evento(s.id, 'evento',
    'Atendimento reassumido por ' || v_nome || coalesce(' (estava com ' || v_antes_nome || ')', ''));
  perform private.doc_notificar(v_antes_id, 'resposta_enviada', 'Chamado reassumido por ' || v_nome,
    format('%s nº %s · %s: a correção foi retomada por %s.', private.doc_rotulo(s), s.numero, s.placa, v_nome),
    s, 'apoio', 'reassumido:' || s.id || ':' || s.versao);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s), 'reassumido', true);
end $$;

revoke all on function public.retomar_atendimento_doc(uuid) from public, anon;
grant execute on function public.retomar_atendimento_doc(uuid) to authenticated;
