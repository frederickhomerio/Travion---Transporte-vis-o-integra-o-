// Anúncio de frete liberado para motoristas: textos da imagem de divulgação e da mensagem de WhatsApp.
// Usa o frete do MOTORISTA (nunca o frete da empresa).

import type { Financeiro, UnidadeFrete } from '../types';

export interface DadosAnuncio {
  origem_cidade: string; origem_uf: string | null; coleta: string | null;
  destino_cidade: string; destino_uf: string | null; entrega: string | null;
  produto: string | null; link_mapa: string | null;
  frete: Pick<Financeiro, 'frete_motorista' | 'unidade_frete'> | null;
}

/** Tira o prefixo dos dados demonstrativos ("[DEMO] Soja" → "Soja"). */
export const semDemo = (t: string | null | undefined) => (t ?? '').replace(/\[DEMO\]\s*/gi, '').trim();

/** "Montividiu", "GO" → "Montividiu-GO" (formato do anúncio). */
export function cidadeAnuncio(cidade: string, uf: string | null): string {
  const c = semDemo(cidade);
  return uf ? `${c}-${uf}` : c;
}

export const UNIDADE_ANUNCIO: Record<UnidadeFrete, string> = {
  rs_tonelada: 'por ton', rs_viagem: 'por viagem', outra: '', nao_confirmada: '',
};

/** "R$ 139,00" ou null quando não há frete do motorista numérico. */
export function valorFrete(frete: DadosAnuncio['frete']): string | null {
  const v = frete?.frete_motorista;
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).replace(/ /g, ' ');
}

/** Mensagem pronta para colar no WhatsApp, no modelo definido pelo comercial. */
export function textoWhatsApp(d: DadosAnuncio): string {
  const valor = valorFrete(d.frete);
  const unidade = d.frete ? UNIDADE_ANUNCIO[d.frete.unidade_frete] : '';
  const linhas = [
    `📍 *${cidadeAnuncio(d.origem_cidade, d.origem_uf)} ➜ ${cidadeAnuncio(d.destino_cidade, d.destino_uf)}*`,
    `🏭 Coleta: ${semDemo(d.coleta) || 'a informar'} | Entrega: ${semDemo(d.entrega) || 'a informar'}`,
    `💵 Frete: ${valor ? `${valor}${unidade ? ` ${unidade}` : ''}` : 'a combinar'}`,
    `🌱 Produto: ${semDemo(d.produto) || 'a informar'}`,
  ];
  if (d.link_mapa) linhas.push(`🌎 Link Local de Carregamento: ${d.link_mapa}`);
  return linhas.join('\n');
}

/** Linhas da imagem de divulgação (tudo em maiúsculas, local entre parênteses). */
export function textosImagem(d: DadosAnuncio) {
  const valor = valorFrete(d.frete);
  return {
    origem: cidadeAnuncio(d.origem_cidade, d.origem_uf).toUpperCase(),
    coleta: d.coleta ? `(${semDemo(d.coleta).toUpperCase()})` : '',
    destino: cidadeAnuncio(d.destino_cidade, d.destino_uf).toUpperCase(),
    entrega: d.entrega ? `(${semDemo(d.entrega).toUpperCase()})` : '',
    valor: valor ? valor.replace(' ', '') : 'A COMBINAR',
    unidade: d.frete?.unidade_frete === 'rs_viagem' ? 'POR VIAGEM' : '',
  };
}
