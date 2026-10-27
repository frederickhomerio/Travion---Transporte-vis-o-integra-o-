import { describe, expect, it } from 'vitest';
import { prazoSuspensao, reativavel } from './suspensao';
import type { Embarque } from '../types';

const AGORA = Date.parse('2026-10-27T12:00:00Z');
const dias = (d: number) => new Date(AGORA - d * 86400e3).toISOString();

describe('suspensão', () => {
  it('conta os 7 dias a partir da suspensão', () => {
    expect(prazoSuspensao({ suspenso_em: dias(0) }, AGORA)).toEqual({ texto: 'Encerra em 7 dias', urgente: false });
    expect(prazoSuspensao({ suspenso_em: dias(5) }, AGORA)).toEqual({ texto: 'Encerra em 2 dias', urgente: true });
    expect(prazoSuspensao({ suspenso_em: dias(6.5) }, AGORA).texto).toBe('Encerra em menos de 1 dia');
    expect(prazoSuspensao({ suspenso_em: dias(7) }, AGORA).texto).toBe('Encerramento automático pendente');
  });
  it('encerrado ou arquivado não volta para a lista', () => {
    const e = { status_liberacao: 'suspenso', situacao: 'ativo', encerrado_em: null } as Embarque;
    expect(reativavel(e)).toBe(true);
    expect(reativavel({ ...e, encerrado_em: dias(1), situacao: 'arquivado' })).toBe(false);
    expect(reativavel({ ...e, status_liberacao: 'liberado' })).toBe(false);
  });
});
