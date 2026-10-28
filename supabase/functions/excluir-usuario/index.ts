// Exclui de vez um usuário do Travion que ainda não registrou nada no app (quem tem registros é inativado).
// A regra (só administrador por padrão, sem registros, não a si mesmo) fica no banco: public.excluir_usuario,
// chamada com o login de quem pediu. 1) confere  2) apaga o perfil e grava no histórico  3) apaga o login (auth).
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
  if (!u?.user) return resposta({ erro: 'Entre no Travion para excluir usuários.' }, 401);

  let corpo: { perfil_id?: string };
  try { corpo = await req.json(); } catch { return resposta({ erro: 'Pedido inválido.' }, 400); }

  const { data: conf, error: e1 } = await sb.rpc('excluir_usuario', { p_perfil_id: corpo.perfil_id, p_aplicar: false });
  if (e1) return resposta({ erro: e1.message }, 400);
  const { error: e2 } = await sb.rpc('excluir_usuario', { p_perfil_id: corpo.perfil_id, p_aplicar: true });
  if (e2) return resposta({ erro: e2.message }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error: e3 } = await admin.auth.admin.deleteUser(conf.id);
  if (e3) return resposta({ erro: `O acesso foi removido do Travion, mas o login não foi apagado: ${e3.message}` }, 400);
  return resposta({ ok: true });
});
