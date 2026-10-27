// Suspensão e encerramento de embarques (migração 1500): suspenso há mais de 7 dias é encerrado pelo banco.

import type { Embarque } from '../types';

export const DIAS_SUSPENSO = 7;
const DIA = 86400e3;

/** Suspenso e ainda não encerrado (os suspensos que podem voltar para a Lista de Fretes). */
export const reativavel = (e: Embarque) => e.status_liberacao === 'suspenso' && e.situacao === 'ativo' && !e.encerrado_em;

/** Momento em que o banco encerra o embarque suspenso (null se não há data de suspensão). */
export function encerraEm(e: Pick<Embarque, 'suspenso_em'>): number | null {
  return e.suspenso_em ? Date.parse(e.suspenso_em) + DIAS_SUSPENSO * DIA : null;
}

/** Texto do prazo: "Encerra em 3 dias", "Encerra hoje" ou "Encerramento automático pendente". */
export function prazoSuspensao(e: Pick<Embarque, 'suspenso_em'>, agora = Date.now()): { texto: string; urgente: boolean } {
  const fim = encerraEm(e);
  if (fim === null) return { texto: `Encerra ${DIAS_SUSPENSO} dias após a suspensão`, urgente: false };
  const resta = fim - agora;
  if (resta <= 0) return { texto: 'Encerramento automático pendente', urgente: true };
  const dias = Math.ceil(resta / DIA);
  if (resta < DIA) return { texto: 'Encerra em menos de 1 dia', urgente: true };
  return { texto: `Encerra em ${dias} dias`, urgente: dias <= 2 };
}
