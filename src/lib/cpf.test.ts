import { describe, expect, it } from 'vitest';
import { completarCpf, cpfValido, mascaraCpf } from './cpf';

describe('cpf', () => {
  it('formata enquanto digita', () => {
    expect(mascaraCpf('122')).toBe('122');
    expect(mascaraCpf('1224')).toBe('122.4');
    expect(mascaraCpf('52998224725')).toBe('529.982.247-25');
    expect(mascaraCpf('529.982.247-2599')).toBe('529.982.247-25');
  });
  it('aceita só CPF correto', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('122')).toBe(false);
    expect(cpfValido(completarCpf('100200300'))).toBe(true);
  });
});
