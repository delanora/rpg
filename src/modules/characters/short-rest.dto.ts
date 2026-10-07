import type { ShortRestSession } from '@prisma/client';

/**
 * Sessão de Descanso Curto (DTO).
 *
 * A sessão é PERSISTENTE: nasce ACTIVE no início do descanso e termina
 * COMPLETED (recuperou os recursos de recarga curta) ou CANCELLED (o descanso
 * não foi concluído — nada é desfeito). Ver `ShortRestSession` no schema.
 */

export type ShortRestStatusDto = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface ShortRestSessionDto {
  id: string;
  status: ShortRestStatusDto;
  /** Início da sessão (ISO). Só auditoria — a duração de 1h é da ficção. */
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  /**
   * Quantos Dados de Vida foram gastos NESTA sessão. É DERIVADO das operações
   * ligadas à sessão (não há contador redundante gravado).
   */
  hitDiceSpent: number;
}

/** Monta o DTO da sessão. `hitDiceSpent` vem à parte (derivado das operações). */
export function toShortRestSessionDto(
  session: ShortRestSession,
  hitDiceSpent: number,
): ShortRestSessionDto {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    cancelledAt: session.cancelledAt ? session.cancelledAt.toISOString() : null,
    hitDiceSpent,
  };
}
