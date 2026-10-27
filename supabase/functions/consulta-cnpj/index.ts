// Consulta de CNPJ para o cadastro de clientes do Travion.
// Fontes públicas da Receita Federal: CNPJ.ws (inclui inscrições estaduais) e, como reserva, BrasilAPI.
// Só atende usuários logados; não grava nada, apenas devolve os dados normalizados.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DadosCnpj {
  fonte: string;
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  atividade_principal: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  inscricao_estadual: string | null;
  inscricoes_estaduais: Array<{ ie: string; uf: string | null; ativa: boolean }>;
}

const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const fone = (ddd: unknown, num: unknown) => {
  const d = txt(ddd), n = txt(num);
  if (!n) return null;
  return d ? `(${d}) ${n}` : n;
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function buscar(url: string) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Travion/1.0' }, signal: AbortSignal.timeout(12000) });
  if (r.status === 404) return { naoEncontrado: true as const };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { dados: await r.json() };
}

async function cnpjWs(cnpj: string): Promise<DadosCnpj | 'nao_encontrado'> {
  const r = await buscar(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  if ('naoEncontrado' in r) return 'nao_encontrado';
  const d = r.dados;
  const e = d.estabelecimento ?? {};
  const uf = txt(e.estado?.sigla);
  const ies = (e.inscricoes_estaduais ?? []).map((i: Record<string, any>) => ({
    ie: String(i.inscricao_estadual), uf: txt(i.estado?.sigla), ativa: !!i.ativo,
  }));
  const principal = ies.find((i: { uf: string | null; ativa: boolean }) => i.ativa && i.uf === uf) ?? ies.find((i: { ativa: boolean }) => i.ativa) ?? null;
  return {
    fonte: 'CNPJ.ws (Receita Federal)',
    cnpj,
    razao_social: txt(d.razao_social),
    nome_fantasia: txt(e.nome_fantasia),
    situacao_cadastral: txt(e.situacao_cadastral),
    atividade_principal: e.atividade_principal ? [txt(e.atividade_principal.subclasse ?? e.atividade_principal.id), txt(e.atividade_principal.descricao)].filter(Boolean).join(' - ') : null,
    logradouro: [txt(e.tipo_logradouro), txt(e.logradouro)].filter(Boolean).join(' ') || null,
    numero: txt(e.numero),
    complemento: txt(e.complemento),
    bairro: txt(e.bairro),
    municipio: txt(e.cidade?.nome),
    uf,
    cep: txt(e.cep),
    telefone: fone(e.ddd1, e.telefone1),
    email: txt(e.email)?.toLowerCase() ?? null,
    inscricao_estadual: principal?.ie ?? null,
    inscricoes_estaduais: ies,
  };
}

async function brasilApi(cnpj: string): Promise<DadosCnpj | 'nao_encontrado'> {
  const r = await buscar(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if ('naoEncontrado' in r) return 'nao_encontrado';
  const d = r.dados;
  const tel = txt(d.ddd_telefone_1);
  return {
    fonte: 'BrasilAPI (Receita Federal)',
    cnpj,
    razao_social: txt(d.razao_social),
    nome_fantasia: txt(d.nome_fantasia),
    situacao_cadastral: txt(d.descricao_situacao_cadastral),
    atividade_principal: d.cnae_fiscal ? `${d.cnae_fiscal} - ${txt(d.cnae_fiscal_descricao) ?? ''}`.trim() : null,
    logradouro: [txt(d.descricao_tipo_de_logradouro), txt(d.logradouro)].filter(Boolean).join(' ') || null,
    numero: txt(d.numero),
    complemento: txt(d.complemento),
    bairro: txt(d.bairro),
    municipio: txt(d.municipio),
    uf: txt(d.uf),
    cep: txt(d.cep),
    telefone: tel && tel.length >= 10 ? `(${tel.slice(0, 2)}) ${tel.slice(2)}` : tel,
    email: txt(d.email)?.toLowerCase() ?? null,
    inscricao_estadual: null,
    inscricoes_estaduais: [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Faça login para consultar CNPJ.' }, 401);

  let cnpj = '';
  try {
    cnpj = String((await req.json())?.cnpj ?? '').replace(/\D/g, '');
  } catch {
    return resposta({ erro: 'Requisição inválida.' }, 400);
  }
  if (cnpj.length !== 14) return resposta({ erro: 'CNPJ deve ter 14 dígitos.' }, 400);

  const falhas: string[] = [];
  for (const fonte of [cnpjWs, brasilApi]) {
    try {
      const r = await fonte(cnpj);
      if (r === 'nao_encontrado') return resposta({ erro: 'CNPJ não encontrado na Receita Federal.' }, 404);
      return resposta(r);
    } catch (e) {
      falhas.push(`${fonte.name}: ${(e as Error).message}`);
    }
  }
  return resposta({ erro: 'As bases públicas de CNPJ não responderam. Tente de novo em 1 minuto.', detalhes: falhas }, 502);
});
