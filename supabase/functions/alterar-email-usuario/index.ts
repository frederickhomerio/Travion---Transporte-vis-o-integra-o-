// Troca o e-mail de entrada de um usuário do Travion, mantendo acesso, centro de custo e histórico.
// A regra (quem pode, e-mail livre) fica no banco: public.alterar_email_usuario, chamada com o login de quem pediu.
// 1) confere  2) troca no login (auth), já confirmado  3) grava no perfil e no histórico.
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

  const url = Deno.env.get('SUPABASE_URL')!;
  const sb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Entre no Travion para alterar e-mails.' }, 401);

  let corpo: { perfil_id?: string; email?: string };
  try { corpo = await req.json(); } catch { return resposta({ erro: 'Pedido inválido.' }, 400); }
  const args = { p_perfil_id: corpo.perfil_id, p_email: corpo.email ?? '' };

  const { data: conf, error: e1 } = await sb.rpc('alterar_email_usuario', { ...args, p_aplicar: false });
  if (e1) return resposta({ erro: e1.message }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error: e2 } = await admin.auth.admin.updateUserById(conf.id, { email: conf.email, email_confirm: true });
  if (e2) return resposta({ erro: `O e-mail não foi alterado: ${e2.message}` }, 400);

  const { error: e3 } = await sb.rpc('alterar_email_usuario', { ...args, p_aplicar: true });
  if (e3) {
    // Volta o login ao e-mail anterior para não ficar diferente do perfil.
    await admin.auth.admin.updateUserById(conf.id, { email: conf.email_anterior, email_confirm: true });
    return resposta({ erro: e3.message }, 400);
  }
  return resposta({ ok: true, email: conf.email });
});
