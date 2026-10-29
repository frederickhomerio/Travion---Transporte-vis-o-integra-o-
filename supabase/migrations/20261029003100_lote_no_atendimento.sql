-- Lote no atendimento (pedido de 29/10/2026): ao assumir qualquer Lote e Emissão ou Emissão, o apoio confere se o
-- embarque já tem lote, informa o código do lote do ERP e vincula a solicitação a ele. Só depois anexa (devolve)
-- os documentos emitidos. Com o lote já criado, o código informado precisa ser o mesmo (vincula); a correção do
-- número continua só na solicitação de lote e emissão dona do lote.

create or replace function public.registrar_lote_doc(p_id uuid, p_numero text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitacoes_doc;
  l public.lotes_erp;
  ini public.solicitacoes_doc;
  v_num text := trim(coalesce(p_numero, ''));
begin
  s := private.doc_carregar(p_id);
  perform private.doc_exigir_responsavel(s, array['em_atendimento', 'aguardando_informacao']);
  if s.tipo not in ('lote_emissao', 'emissao') or s.embarque_id is null then
    perform private.doc_erro('55000', 'Só Lote e Emissão ou Emissão registram o lote.');
  end if;
  if length(v_num) = 0 or length(v_num) > 60 then perform private.doc_erro('22023', 'Informe o código do lote do ERP.'); end if;
  select * into ini from public.solicitacoes_doc
   where embarque_id = s.embarque_id and tipo = 'lote_emissao' and status <> 'cancelado'
   order by enviado_em limit 1;
  select * into l from public.lotes_erp where embarque_id = s.embarque_id for update;
  if found then
    if s.tipo = 'emissao' or (l.solicitacao_id is not null and l.solicitacao_id is distinct from s.id) then
      -- Lote já criado para o embarque: vincula se o código conferir.
      if upper(l.numero) <> upper(v_num) then
        perform private.doc_erro('55000', 'Este embarque já tem o lote ' || l.numero || ' criado. Confira o código no ERP.');
      end if;
      if s.lote_id = l.id then return jsonb_build_object('status', 'sem_alteracao', 'lote', to_jsonb(l), 'registro', to_jsonb(s)); end if;
      perform private.doc_evento(s.id, 'evento', 'Vinculada ao lote ' || l.numero || ' (já criado no ERP)', 'lote');
    else
      -- Lote informado na criação do embarque: o apoio confirma (ou corrige) e ele passa a ser desta solicitação.
      if l.solicitacao_id is null then
        update public.lotes_erp set solicitacao_id = s.id where id = l.id returning * into l;
      end if;
      if l.numero = v_num and s.lote_id = l.id then
        return jsonb_build_object('status', 'sem_alteracao', 'lote', to_jsonb(l), 'registro', to_jsonb(s));
      end if;
      if l.numero <> v_num then
        perform private.doc_evento(s.id, 'evento', 'Número do lote corrigido de ' || l.numero || ' para ' || v_num, 'lote');
        perform private.registrar('embarque', s.embarque_id, s.embarque_id, null, (s.retrato ->> 'cliente_id')::uuid, null, 'lote_erp', l.numero, v_num);
        update public.lotes_erp set numero = v_num, versao = versao + 1, atualizado_em = now() where id = l.id returning * into l;
      else
        perform private.doc_evento(s.id, 'evento', 'Vinculada ao lote ' || l.numero, 'lote');
      end if;
    end if;
  else
    insert into public.lotes_erp (embarque_id, numero, solicitacao_id, registrado_por, registrado_por_nome)
    values (s.embarque_id, v_num, coalesce(ini.id, s.id), auth.uid(), coalesce(private.nome_usuario(), 'Usuário')) returning * into l;
    perform private.doc_evento(s.id, 'evento', 'Lote ' || v_num || ' registrado (gerado no ERP) e vinculado. A emissão segue em atendimento.', 'lote');
    perform private.registrar('embarque', s.embarque_id, s.embarque_id, null, (s.retrato ->> 'cliente_id')::uuid, null, 'lote_erp', null, v_num);
  end if;
  update public.solicitacoes_doc set lote_id = l.id, retrato = retrato || jsonb_build_object('lote_numero', l.numero),
    versao = versao + 1, atualizado_em = now()
  where id = s.id returning * into s;
  -- Demais solicitações do embarque sem lote (a inicial e as emissões da fila) passam a apontar para o lote;
  -- número corrigido também atualiza o retrato das já vinculadas.
  update public.solicitacoes_doc set lote_id = l.id, retrato = retrato || jsonb_build_object('lote_numero', l.numero),
    versao = versao + 1, atualizado_em = now()
  where embarque_id = s.embarque_id and id <> s.id and tipo in ('lote_emissao', 'emissao') and status <> 'cancelado'
    and (lote_id is null or (lote_id = l.id and retrato ->> 'lote_numero' is distinct from l.numero));
  return jsonb_build_object('status', 'ok', 'lote', to_jsonb(l), 'registro', to_jsonb(s));
end $$;

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
  if s.tipo in ('lote_emissao', 'emissao') and s.lote_id is null then
    perform private.doc_erro('55000', 'Informe o código do lote do ERP e vincule a solicitação antes de anexar os documentos emitidos.');
  end if;
  v_n := private.doc_vincular_anexos(s.id, p_anexos, array['cte', 'mdfe', 'outro_emitido'], null);
  if v_n = 0 then perform private.doc_erro('22023', 'Nenhum arquivo para anexar.'); end if;
  perform private.doc_evento(s.id, 'evento', v_n || ' documento(s) emitido(s) anexado(s), em conferência', 'documentos');
  s := private.doc_tocar(s.id);
  return jsonb_build_object('status', 'ok', 'registro', to_jsonb(s));
end $$;
