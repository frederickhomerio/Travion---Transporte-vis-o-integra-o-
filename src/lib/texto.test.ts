import { describe, expect, it } from 'vitest';
import { normalizar, parseContador, parseNumeroBR, parseStatus, parseUF, sugereSuspensao } from './texto';

describe('normalização da planilha', () => {
  it('trata espaços e acentos', () => {
    expect(normalizar('  SOJA EM GRÃOS ')).toBe('SOJA EM GRAOS');
    expect(normalizar('São  Simão')).toBe('SAO SIMAO');
  });
  it('números no padrão brasileiro', () => {
    expect(parseNumeroBR('R$ 67,50')).toBe(67.5);
    expect(parseNumeroBR('R$ 142,00')).toBe(142);
    expect(parseNumeroBR('138,50')).toBe(138.5);
    expect(parseNumeroBR('1.234,56')).toBe(1234.56);
    expect(parseNumeroBR(639.93)).toBe(639.93);
    expect(parseNumeroBR('')).toBeNull();
    expect(parseNumeroBR(null)).toBeNull();
    expect(parseNumeroBR('a combinar')).toBeUndefined();
  });
  it('contadores aceitam só inteiros >= 0', () => {
    expect(parseContador(3)).toBe(3);
    expect(parseContador('4')).toBe(4);
    expect(parseContador(-1)).toBeUndefined();
    expect(parseContador(1.5)).toBeUndefined();
    expect(parseContador('')).toBeNull();
  });
  it('UF e status', () => {
    expect(parseUF('GO ')).toBe('GO');
    expect(parseUF('Goiás')).toBeUndefined();
    expect(parseStatus('')).toBe('nao_informado');
    expect(parseStatus('Liberado')).toBe('liberado');
    expect(parseStatus('SUSPENSO')).toBe('suspenso');
  });
  it('observação com "suspenso" só sugere', () => {
    expect(sugereSuspensao('LOTE SUSPENSO')).toBe(true);
    expect(sugereSuspensao('SUSPENSO ')).toBe(true);
    expect(sugereSuspensao('COTAS ALONGADAS')).toBe(false);
  });
});
