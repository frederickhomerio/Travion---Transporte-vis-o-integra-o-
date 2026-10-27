// Busca a logo de uma empresa no próprio site dela, para o cadastro de clientes do Travion.
// Lê a página inicial, coleta candidatas (imagens marcadas como "logo", logo do JSON-LD, ícones e og:image)
// e devolve cada uma já baixada (data URL), para o usuário escolher a imagem completa certa.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_IMAGEM = 1_500_000;

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const attr = (tag: string, nome: string) => tag.match(new RegExp(`\\s${nome}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? null;

function candidatas(html: string, base: URL): Array<{ url: string; origem: string; peso: number }> {
  const saida: Array<{ url: string; origem: string; peso: number }> = [];
  const add = (u: string | null, origem: string, peso: number) => {
    if (!u || u.startsWith('data:') && u.length < 200) return;
    try { saida.push({ url: new URL(u.trim().split(/\s+/)[0], base).href, origem, peso }); } catch { /* ignora */ }
  };
  // JSON-LD: "logo": "https://..." ou {"url": "..."}
  for (const m of html.matchAll(/"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*?"url"\s*:\s*"([^"]+)")/gi)) add(m[1] ?? m[2], 'Logo declarada no site', 100);
  // <img> com "logo" no endereço, classe, id ou texto alternativo (geralmente o cabeçalho)
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0];
    if (/logo|marca|brand/i.test(t)) {
      const src = attr(t, 'src') ?? attr(t, 'data-src') ?? attr(t, 'data-lazy-src') ?? attr(t, 'srcset');
      add(src, 'Imagem do cabeçalho do site', /\.svg/i.test(src ?? '') ? 95 : 90);
    }
  }
  // <svg> embutido com "logo" é comum; não dá para extrair com segurança aqui, então seguimos com os ícones.
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    const rel = (attr(t, 'rel') ?? '').toLowerCase();
    if (rel.includes('apple-touch-icon')) add(attr(t, 'href'), 'Ícone do site (quadrado)', 40);
    else if (rel.includes('icon')) add(attr(t, 'href'), 'Ícone do site (quadrado)', /\.svg/i.test(attr(t, 'href') ?? '') ? 45 : 30);
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if (/property\s*=\s*["']og:image["']/i.test(t)) add(attr(t, 'content'), 'Imagem de divulgação do site', 50);
  }
  const vistos = new Set<string>();
  return saida.sort((a, b) => b.peso - a.peso).filter((c) => !vistos.has(c.url) && vistos.add(c.url)).slice(0, 8);
}

async function baixar(url: string): Promise<{ dataUrl: string; tipo: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!tipo.startsWith('image/')) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGEM) return null;
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { dataUrl: `data:${tipo};base64,${btoa(bin)}`, tipo };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Faça login para buscar logos.' }, 401);

  let site = '';
  try { site = String((await req.json())?.site ?? '').trim().toLowerCase(); } catch { return resposta({ erro: 'Requisição inválida.' }, 400); }
  const dominio = site.replace(/^https?:\/\//, '').split('/')[0];
  // Só domínios públicos (evita usar a função para acessar endereços internos).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio) || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(dominio) || /\.(local|internal)$/.test(dominio)) {
    return resposta({ erro: 'Informe o site da empresa (ex.: empresa.com.br).' }, 400);
  }

  let html = '';
  let base: URL | null = null;
  for (const tentativa of [`https://${dominio}`, `https://www.${dominio.replace(/^www\./, '')}`, `http://${dominio}`]) {
    try {
      const r = await fetch(tentativa, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      html = (await r.text()).slice(0, 2_000_000);
      base = new URL(r.url || tentativa);
      break;
    } catch { /* tenta a próxima */ }
  }
  if (!base) return resposta({ erro: 'Não foi possível abrir o site informado. Confira o endereço ou envie a imagem.' }, 404);

  const lista = candidatas(html, base);
  const baixadas = await Promise.all(lista.map(async (c) => ({ ...c, ...(await baixar(c.url)) })));
  const ok = baixadas.filter((c) => 'dataUrl' in c && c.dataUrl).map(({ url, origem, dataUrl, tipo }) => ({ url, origem, dataUrl, tipo }));
  if (ok.length === 0) return resposta({ erro: 'Não encontramos a logo nesse site. Envie a imagem pelo botão "Enviar imagem".' }, 404);
  return resposta({ site: base.origin, candidatas: ok });
});
