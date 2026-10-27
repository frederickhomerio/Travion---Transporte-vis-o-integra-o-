import { describe, expect, it } from 'vitest';
import { textoWhatsApp, textosImagem, type DadosAnuncio } from './anuncio';

const base: DadosAnuncio = {
  origem_cidade: 'Montividiu', origem_uf: 'GO', coleta: 'Faz. Segredo', destino_cidade: 'Uberaba', destino_uf: 'MG', entrega: 'TIUB',
  produto: '[DEMO] Soja em grãos', link_mapa: 'https://maps.app.goo.gl/a4n1Z1LzwwtDoMaZ7', frete: { frete_motorista: 139, unidade_frete: 'rs_tonelada' },
};

describe('anúncio de frete', () => {
  it('monta o texto do WhatsApp no modelo do comercial', () => {
    expect(textoWhatsApp(base)).toBe([
      '📍 *Montividiu-GO ➜ Uberaba-MG*',
      '🏭 Coleta: Faz. Segredo | Entrega: TIUB',
      '💵 Frete: R$ 139,00 por ton',
      '🌱 Produto: Soja em grãos',
      '🌎 Link Local de Carregamento: https://maps.app.goo.gl/a4n1Z1LzwwtDoMaZ7',
    ].join('\n'));
  });
  it('sem frete e sem link: "a combinar" e sem linha do mapa', () => {
    const t = textoWhatsApp({ ...base, link_mapa: null, frete: null });
    expect(t).toContain('💵 Frete: a combinar');
    expect(t).not.toContain('🌎');
  });
  it('textos da imagem em maiúsculas com o local entre parênteses', () => {
    expect(textosImagem(base)).toMatchObject({ origem: 'MONTIVIDIU-GO', coleta: '(FAZ. SEGREDO)', destino: 'UBERABA-MG', entrega: '(TIUB)', valor: 'R$139,00', unidade: '' });
  });
});
