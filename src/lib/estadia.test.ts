import { describe, expect, it } from 'vitest';
import { calcularEstadia, centavos, fmtHoras, fmtHorasRelogio, isoParaLocal, lerDecimal, lerNumeros, localParaIso, pesoToneladas } from './estadia';

const base = { inicio: '2026-10-02T13:09:00-03:00', saida: '2026-10-03T16:37:00-03:00', tarifa: 0.45, peso_t: 37.6, limite_h: 24, retroagir_h: 12 };

describe('cálculo da estadia', () => {
  it('reconcilia o exemplo verificado: 27h28, limite 24, retroagir 12 → 15h28 → R$ 261,70', () => {
    const c = calcularEstadia(base)!;
    expect(fmtHorasRelogio(c.permanencia_h)).toBe('27h28');
    expect(c.horas_validas).toBeCloseTo(15.466667, 5);
    expect(fmtHoras(c.horas_validas)).toBe('15h28 = 15,47 h');
    expect(c.valor).toBe(261.7);
  });
  it('no limite exato não cobra', () => {
    const c = calcularEstadia({ ...base, inicio: '2026-10-02T10:00:00-03:00', saida: '2026-10-03T10:00:00-03:00' })!;
    expect(c.horas_validas).toBe(0);
    expect(c.valor).toBe(0);
  });
  it('um minuto acima do limite retroage uma única vez e preserva a fração', () => {
    const c = calcularEstadia({ ...base, inicio: '2026-10-02T10:00:00-03:00', saida: '2026-10-03T10:01:00-03:00' })!;
    expect(c.horas_validas).toBeCloseTo(12 + 1 / 60, 9);
    expect(c.valor).toBe(203.32);
  });
  it('retroagir maior que a permanência dá zero, nunca negativo', () => {
    expect(calcularEstadia({ ...base, saida: '2026-10-02T18:09:00-03:00', limite_h: 2 })!.valor).toBe(0);
  });
  it('parâmetro vazio não vira zero: sem cálculo', () => {
    expect(calcularEstadia({ ...base, limite_h: null })).toBeNull();
    expect(calcularEstadia({ ...base, retroagir_h: undefined })).toBeNull();
    expect(calcularEstadia({ ...base, saida: base.inicio })).toBeNull();
    expect(calcularEstadia({ ...base, limite_h: 0, retroagir_h: 0 })!.valor).toBe(centavos(0.45 * 37.6 * (27 + 28 / 60)));
  });
});

describe('entrada de dados', () => {
  it('lê números no padrão brasileiro sem inventar unidade', () => {
    expect(lerDecimal('0,45')).toBe(0.45);
    expect(lerDecimal('37,6')).toBe(37.6);
    expect(lerDecimal('37.6')).toBe(37.6);
    expect(lerDecimal('37.600')).toBe(37600);
    expect(lerDecimal('1.234,56')).toBe(1234.56);
    expect(lerDecimal('')).toBeNull();
    expect(lerDecimal('abc')).toBeNaN();
  });
  it('converte kg só quando a unidade é kg', () => {
    expect(pesoToneladas(37600, 'kg')).toBe(37.6);
    expect(pesoToneladas(37.6, 't')).toBe(37.6);
  });
  it('números de documento ficam como texto, com zeros e sem repetidos', () => {
    expect(lerNumeros(' 000123, 000124;000123\n abc-9 ')).toEqual(['000123', '000124', 'ABC-9']);
  });
  it('data e hora em Brasília', () => {
    expect(localParaIso('2026-10-02T13:09')).toBe('2026-10-02T16:09:00.000Z');
    expect(isoParaLocal('2026-10-02T16:09:00.000Z')).toBe('2026-10-02T13:09');
  });
});
