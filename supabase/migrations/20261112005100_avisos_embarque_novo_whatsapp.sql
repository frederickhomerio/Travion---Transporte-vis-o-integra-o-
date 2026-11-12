-- 12/11/2026, pedido do Frederick: aviso de novo embarque liberado também no WhatsApp,
-- para Embarcadores, Supervisores, Coordenador Comercial e Gestor do centro de custo (Administrador já recebia).
-- Não apaga nenhum dado. O disparo dos embarques liberados no dia 12/11 foi feito à parte, uma vez só.

insert into public.papel_permissoes (papel, chave) values
  ('comercial', 'avisos.embarque_novo'), ('gestor', 'avisos.embarque_novo')
on conflict do nothing;

-- Envio de um aviso ao WhatsApp (usado pelo gatilho e por reenvios pontuais).
create or replace function private.whatsapp_enviar(n public.notificacoes)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.perfis;
  v_tel text;
  v_url text;
  v_token text;
  v_link text;
  v_base text := 'https://travion-transporte-vis-o-integra-o-ten.vercel.app/#';
begin
  if n.tipo not in ('solicitacao_cancelada', 'prazo_estourado', 'embarque_estado', 'embarque_novo', 'ajuste_solicitado',
                    'documentacao_disponivel', 'resposta_enviada', 'cadastro_cancelado') then
    return false;
  end if;
  select * into p from public.perfis where id = n.destinatario_id;
  if not found or p.status <> 'ativo' or not p.whatsapp_avisos then return false; end if;
  v_tel := regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g');
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if length(v_tel) not in (12, 13) then return false; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'travion_n8n_whatsapp_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'travion_n8n_auditoria_token';
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then return false; end if;
  v_link := v_base || case n.destino
    when 'apoio' then '/apoio/' || n.solicitacao_id
    when 'cadastro' then '/cadastro?s=' || n.solicitacao_id
    when 'estadia' then '/estadia/consultar?s=' || n.solicitacao_id
    when 'lista' then '/?emb=' || n.embarque_id
    else '/?emb=' || n.embarque_id || '&doc=' || n.solicitacao_id end;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notificacao_id', n.id, 'telefone', v_tel, 'nome', split_part(p.nome, ' ', 1),
      'titulo', n.titulo, 'texto', n.texto, 'link', v_link),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-travion-token', v_token),
    timeout_milliseconds := 10000);
  update public.notificacoes set whatsapp_pedido_em = now() where id = n.id;
  return true;
end $$;

create or replace function private.avisos_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.whatsapp_enviar(new);
  return null;
exception when others then
  raise warning 'avisos_whatsapp: %', sqlerrm;
  return null;
end $$;

revoke all on function private.whatsapp_enviar(public.notificacoes) from public, anon, authenticated;
