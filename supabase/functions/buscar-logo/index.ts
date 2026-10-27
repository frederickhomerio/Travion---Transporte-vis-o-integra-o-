// Busca a logo de uma empresa no próprio site dela, para o cadastro de clientes do Travion.
// Lê a página inicial, coleta candidatas (imagens marcadas como "logo", logo do JSON-LD, ícones e og:image)
// e devolve cada uma já baixada (data URL), para o usuário escolher a imagem completa certa.
// Sites com bloqueio de robôs (ex.: cargill.com) não abrem: nesse caso usa a logo oficial registrada no
// Wikidata/Wikimedia (busca pelo domínio e pelo nome da empresa) e, por último, o ícone do site.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_IMAGEM = 1_500_000;
const UA_WIKI = 'Travion/1.0 (app interno Transpanorama; busca de logo de clientes)';
const CABECALHOS_NAVEGADOR = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};
type Candidata = { url: string; origem: string; peso: number };

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const attr = (tag: string, nome: string) => tag.match(new RegExp(`\\s${nome}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? null;

function candidatas(html: string, base: URL): Candidata[] {
  const saida: Candidata[] = [];
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
    const ua = /wiki(media|data|pedia)\.org/.test(new URL(url).hostname) ? UA_WIKI : UA;
    const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
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

async function lerSite(dominio: string): Promise<{ html: string; base: URL } | null> {
  for (const tentativa of [`https://www.${dominio}`, `https://${dominio}`, `http://www.${dominio}`]) {
    try {
      const r = await fetch(tentativa, { headers: CABECALHOS_NAVEGADOR, redirect: 'follow', signal: AbortSignal.timeout(10000) });
      const tipo = r.headers.get('content-type') ?? '';
      if (!tipo.includes('html')) { console.log(`${tentativa}: ${r.status} ${tipo}`); continue; }
      const html = (await r.text()).slice(0, 2_000_000);
      // Alguns sites respondem 403 mas ainda mandam a página; só aproveita se tiver cabeçalho de verdade.
      if (!r.ok && !/<link\b[^>]*icon|<img\b[^>]*logo/i.test(html)) { console.log(`${tentativa}: ${r.status}`); continue; }
      return { html, base: new URL(r.url || tentativa) };
    } catch (e) { console.log(`${tentativa}: ${(e as Error).message}`); }
  }
  return null;
}

async function wikidata(params: Record<string, string>): Promise<any> {
  const u = new URL('https://www.wikidata.org/w/api.php');
  for (const [k, v] of Object.entries({ ...params, format: 'json', origin: '*' })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'User-Agent': UA_WIKI }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`wikidata ${r.status}`);
  return r.json();
}

/** Procura a empresa no Wikidata pelo site oficial (P856) e pelo nome, e devolve a logo (P154) registrada. */
async function logosWikidata(dominio: string, nome: string): Promise<Candidata[]> {
  try {
    const ids = new Set<string>();
    const termos = [...new Set([nome, dominio.split('.')[0]].map((t) => t.trim()).filter((t) => t.length >= 2))];
    if (dominio) {
      try {
        const r = await wikidata({ action: 'query', list: 'search', srsearch: `haswbstatement:P154 insource:"${dominio}"`, srlimit: '5' });
        for (const x of r?.query?.search ?? []) ids.add(x.title);
      } catch (e) { console.log(`wikidata site: ${(e as Error).message}`); }
    }
    for (const t of termos) {
      for (const lang of ['pt', 'en']) {
        const r = await wikidata({ action: 'wbsearchentities', search: t, language: lang, uselang: lang, type: 'item', limit: '5' });
        for (const x of r?.search ?? []) ids.add(x.id);
      }
    }
    if (ids.size === 0) return [];
    const r = await wikidata({ action: 'wbgetentities', ids: [...ids].slice(0, 20).join('|'), props: 'claims|labels', languages: 'pt|en' });
    const saida: Candidata[] = [];
    for (const ent of Object.values<any>(r?.entities ?? {})) {
      const arquivo = ent?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
      if (typeof arquivo !== 'string') continue;
      const sites: string[] = (ent.claims.P856 ?? []).map((c: any) => String(c?.mainsnak?.datavalue?.value ?? '').toLowerCase());
      const mesmoSite = dominio && sites.some((s) => s.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].endsWith(dominio));
      if (dominio && sites.length && !mesmoSite) continue; // empresa homônima com outro site
      const rotulo = ent.labels?.pt?.value ?? ent.labels?.en?.value ?? '';
      saida.push({
        url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(arquivo)}?width=600`,
        origem: `Logo oficial registrada (Wikimedia${rotulo ? ` — ${rotulo}` : ''})`,
        peso: mesmoSite ? 98 : 70,
      });
    }
    return saida.slice(0, 4);
  } catch (e) {
    console.log(`wikidata: ${(e as Error).message}`);
    return [];
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
  let nome = '';
  try {
    const corpo = await req.json();
    site = String(corpo?.site ?? '').trim().toLowerCase();
    nome = String(corpo?.nome ?? '').replace(/\[DEMO\]/gi, '').trim().slice(0, 120);
  } catch { return resposta({ erro: 'Requisição inválida.' }, 400); }
  const dominio = site.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  // Só domínios públicos (evita usar a função para acessar endereços internos).
  const dominioOk = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio) && !/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(dominio) && !/\.(local|internal)$/.test(dominio);
  if (site && !dominioOk) return resposta({ erro: 'Informe o site da empresa (ex.: empresa.com.br).' }, 400);
  if (!dominioOk && nome.length < 2) return resposta({ erro: 'Informe o site ou o nome da empresa para buscar a logo.' }, 400);

  const lista: Candidata[] = [];
  let origem = dominioOk ? `https://www.${dominio}` : '';
  if (dominioOk) {
    const pagina = await lerSite(dominio);
    if (pagina) { lista.push(...candidatas(pagina.html, pagina.base)); origem = pagina.base.origin; }
    else console.log(`site ${dominio} não abriu; usando Wikidata e ícone`);
  }
  // Logo oficial registrada no Wikidata (imagem completa, normalmente SVG da marca).
  lista.push(...(await logosWikidata(dominioOk ? dominio : '', nome)));
  if (dominioOk) {
    lista.push({ url: `https://www.google.com/s2/favicons?domain=${dominio}&sz=256`, origem: 'Ícone do site (quadrado)', peso: 20 });
    lista.push({ url: `https://icons.duckduckgo.com/ip3/${dominio}.ico`, origem: 'Ícone do site (quadrado)', peso: 10 });
  }

  const vistos = new Set<string>();
  const unicas = lista.sort((a, b) => b.peso - a.peso).filter((c) => !vistos.has(c.url) && vistos.add(c.url)).slice(0, 10);
  const baixadas = await Promise.all(unicas.map(async (c) => ({ ...c, ...(await baixar(c.url)) })));
  // Remove imagens repetidas (mesmo conteúdo vindo de endereços diferentes).
  const conteudos = new Set<string>();
  const ok = baixadas
    .filter((c) => 'dataUrl' in c && c.dataUrl && !conteudos.has(c.dataUrl) && conteudos.add(c.dataUrl))
    .map(({ url, origem, dataUrl, tipo }) => ({ url, origem, dataUrl, tipo }));
  if (ok.length === 0) return resposta({ erro: 'Não encontramos a logo dessa empresa. Envie a imagem pelo botão "Enviar imagem".' }, 404);
  return resposta({ site: origem, candidatas: ok });
});
