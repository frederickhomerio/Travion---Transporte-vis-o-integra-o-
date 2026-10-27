import type { DadosCnpj } from '../types';

const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

/**
 * Consulta direta à BrasilAPI (dados públicos da Receita Federal) a partir do navegador.
 * Usada na prévia local e como reserva quando a consulta do servidor não responde.
 * Não traz inscrição estadual.
 */
export async function consultarCnpjBrasilApi(cnpj: string): Promise<DadosCnpj> {
  const d = cnpj.replace(/\D/g, '');
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { headers: { Accept: 'application/json' } });
  if (r.status === 404) throw new Error('CNPJ não encontrado na Receita Federal.');
  if (!r.ok) throw new Error('A consulta de CNPJ não respondeu. Tente de novo em 1 minuto.');
  const j = await r.json();
  const tel = txt(j.ddd_telefone_1);
  return {
    fonte: 'BrasilAPI (Receita Federal)',
    cnpj: d,
    razao_social: txt(j.razao_social),
    nome_fantasia: txt(j.nome_fantasia),
    situacao_cadastral: txt(j.descricao_situacao_cadastral),
    atividade_principal: j.cnae_fiscal ? `${j.cnae_fiscal} - ${txt(j.cnae_fiscal_descricao) ?? ''}`.trim() : null,
    logradouro: [txt(j.descricao_tipo_de_logradouro), txt(j.logradouro)].filter(Boolean).join(' ') || null,
    numero: txt(j.numero),
    complemento: txt(j.complemento),
    bairro: txt(j.bairro),
    municipio: txt(j.municipio),
    uf: txt(j.uf),
    cep: txt(j.cep),
    telefone: tel && tel.length >= 10 ? `(${tel.slice(0, 2)}) ${tel.slice(2)}` : tel,
    email: txt(j.email)?.toLowerCase() ?? null,
    inscricao_estadual: null,
    inscricoes_estaduais: [],
  };
}

const PROVEDORES_GRATUITOS = /^(gmail|hotmail|outlook|live|yahoo|bol|uol|terra|ig|icloud|msn|globo|r7|zipmail)\./i;

/** Domínio do site da empresa a partir do e-mail cadastrado (ignora provedores gratuitos). */
export function dominioDoEmail(email: string | null | undefined): string | null {
  const dom = (email ?? '').split('@')[1]?.trim().toLowerCase();
  if (!dom || PROVEDORES_GRATUITOS.test(dom)) return null;
  return dom;
}

/**
 * Reduz a imagem para no máximo `max` px no lado maior, mantendo a proporção (sem cortar),
 * e devolve em data URL pequena o bastante para ficar no cadastro.
 */
export function reduzirDataUrl(dataUrl: string, max = 480): Promise<string> {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onerror = () => falha(new Error('Arquivo de imagem inválido.'));
    img.onload = () => {
      // SVG sem tamanho declarado chega com 0 px: usa um tamanho de referência.
      const w0 = img.naturalWidth || 400;
      const h0 = img.naturalHeight || 200;
      const k = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k));
      c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      let saida = c.toDataURL('image/png');
      if (saida.length > 280000) saida = c.toDataURL('image/webp', 0.85);
      if (saida.length > 280000) saida = c.toDataURL('image/jpeg', 0.8);
      ok(saida);
    };
    img.src = dataUrl;
  });
}

export function reduzirImagem(arquivo: File, max = 480): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onerror = () => falha(new Error('Não foi possível ler a imagem.'));
    leitor.onload = () => { reduzirDataUrl(String(leitor.result), max).then(ok, falha); };
    leitor.readAsDataURL(arquivo);
  });
}
