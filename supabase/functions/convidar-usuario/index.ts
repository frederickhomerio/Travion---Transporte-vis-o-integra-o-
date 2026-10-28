// Envia por e-mail o convite de acesso ao Travion.
// Só quem tem usuarios.gerenciar consegue: o convite (papel e centro de custo) precisa existir e estar aberto,
// e a leitura dele é feita com o login de quem pediu (a regra de acesso da tabela decide).
// O e-mail sai pelo SMTP configurado no Supabase; o link leva ao app, onde a pessoa cria a própria senha.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const sb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Entre no Travion para enviar convites.' }, 401);

  let corpo: { email?: string; redirectTo?: string };
  try { corpo = await req.json(); } catch { return resposta({ erro: 'Pedido inválido.' }, 400); }
  const email = String(corpo.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta({ erro: 'Informe um e-mail válido.' }, 400);

  // Com o login de quem pediu: sem usuarios.gerenciar a regra da tabela não devolve o convite.
  const { data: cv, error: e1 } = await sb.from('convites').select('id, nome, expira_em')
    .eq('email', email).is('usado_em', null).maybeSingle();
  if (e1) return resposta({ erro: e1.message }, 400);
  if (!cv) return resposta({ erro: 'Não há convite aberto para este e-mail (ou você não tem permissão para gerenciar usuários).' }, 403);
  if (cv.expira_em < new Date().toISOString()) return resposta({ erro: 'Este convite expirou. Exclua e registre um novo.' }, 400);

  // O endereço de volta precisa ser o do próprio app (lista de endereços permitidos do Supabase).
  const volta = typeof corpo.redirectTo === 'string' && /^https:\/\//.test(corpo.redirectTo) ? corpo.redirectTo : undefined;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error: e2 } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: volta, data: { nome: cv.nome ?? '' } });
  if (e2) {
    const jaExiste = /already|registered|exists/i.test(e2.message);
    return resposta({ erro: jaExiste
      ? 'Este e-mail já tem conta. A pessoa pode entrar direto ou usar "Esqueci a senha".'
      : `O e-mail não foi enviado: ${e2.message}` }, 400);
  }
  return resposta({ ok: true });
});
