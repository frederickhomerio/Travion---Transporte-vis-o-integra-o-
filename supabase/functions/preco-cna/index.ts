// Preço de mercado dos produtos (pauta) a partir da tabela diária de commodities da CNA
// (https://cnabrasil.org.br/servicos/precos-commodities). Converte cada cotação para R$/kg.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FONTE = 'https://cnabrasil.org.br/apicna/precos';

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Quilos da unidade da cotação ("R$ / SACA 60 KG", "R$ / TON", "R$ / ARROBA"...). null = não convertível. */
function kgDaUnidade(titulo: string): number | null {
  const t = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const kg = t.match(/(\d+(?:[.,]\d+)?)\s*KG/);
  if (kg) return Number(kg[1].replace(',', '.'));
  if (/\bTON|TONELADA/.test(t)) return 1000;
  if (/ARROBA|@/.test(t)) return 15;
  if (/\bKG\b|QUILO/.test(t)) return 1;
  return null;
}

/** Cotações que não vêm em peso: algodão em R$ por libra-peso e etanol em R$/litro (densidade a 20 °C, faixa da ANP). */
function kgEspecial(titulo: string, produto: string): number | null {
  const t = titulo.toUpperCase();
  const p = norm(produto);
  if (/LIBRA/.test(t)) return 0.45359237;
  if (/\/\s*L\s*$|LITRO/.test(t) && /ETANOL/.test(p)) return /ANIDRO/.test(p) ? 0.791 : 0.809;
  return null;
}

/** "1571.95", "1.571,95" ou 79.12 → número. */
const numero = (v: unknown) => { const t = String(v ?? '').trim(); return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };

interface Cotacao { NOME_PRODUTO: string; TITULO: string; UF: string; PRACA: string; DATA: string; VALOR: string | number; VARIACAO_MENSAL?: string | number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Faça login para consultar preços.' }, 401);

  let produto = '';
  try { produto = String((await req.json())?.produto ?? '').replace(/\[DEMO\]/gi, '').trim().slice(0, 80); } catch { return resposta({ erro: 'Requisição inválida.' }, 400); }

  let dados: Cotacao[];
  try {
    const r = await fetch(FONTE, { headers: { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    dados = JSON.parse(await r.text());
    if (!Array.isArray(dados)) throw new Error('formato inesperado');
  } catch (e) {
    console.log(`CNA: ${(e as Error).message}`);
    return resposta({ erro: 'O site da CNA não respondeu agora. Tente de novo em alguns minutos.' }, 502);
  }

  const produtos = [...new Set(dados.map((d) => String(d.NOME_PRODUTO ?? '').trim()).filter(Boolean))].sort();
  // Casa pelo nome: "Soja", "SOJA EM GRÃOS" e "Milho amarelo" encontram SOJA / MILHO na CNA.
  const p = norm(produto);
  const palavras = p.split(' ').filter((w) => w.length >= 3 && !['EM', 'GRAO', 'GRAOS', 'TIPO', 'COM', 'SEM'].includes(w));
  const casa = (nome: string) => {
    const n = norm(nome);
    return !!p && (n === p || n.includes(p) || p.includes(n) || palavras.some((w) => n.split(' ').includes(w)));
  };

  const cotacoes = dados.filter((d) => casa(String(d.NOME_PRODUTO ?? ''))).map((d) => {
    const valor = numero(d.VALOR);
    const kg = kgDaUnidade(String(d.TITULO ?? '')) ?? kgEspecial(String(d.TITULO ?? ''), String(d.NOME_PRODUTO ?? ''));
    return {
      produto: String(d.NOME_PRODUTO).trim(), unidade: String(d.TITULO ?? '').trim(), uf: String(d.UF ?? '').trim(), praca: String(d.PRACA ?? '').trim(),
      data: String(d.DATA ?? '').trim(), valor, valor_kg: kg && Number.isFinite(valor) ? Math.round((valor / kg) * 10000) / 10000 : null,
      variacao_mensal: d.VARIACAO_MENSAL === undefined ? null : numero(d.VARIACAO_MENSAL),
    };
  }).filter((c) => Number.isFinite(c.valor))
    // Goiás primeiro, depois estados vizinhos, depois o resto.
    .sort((a, b) => ordemUF(a.uf) - ordemUF(b.uf) || a.produto.localeCompare(b.produto) || a.praca.localeCompare(b.praca));

  return resposta({ fonte: 'CNA - Preços das Commodities', produtos, cotacoes });
});

const VIZINHOS = ['GO', 'DF', 'MG', 'MT', 'MS', 'TO', 'BA', 'SP', 'PR'];
function ordemUF(uf: string) { const i = VIZINHOS.indexOf(uf); return i < 0 ? 99 : i; }
