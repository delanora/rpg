import { prisma } from '../../config/prisma.js';

/**
 * RESERVA LÓGICA de RECURSOS DE ACAMPAMENTO (mecânica OPCIONAL do Descanso Longo
 * coletivo).
 *
 * Contribuir NÃO remove o item do inventário: a quantidade comprometida fica
 * apenas RESERVADA. Este módulo é a fonte única do cálculo "quanto está
 * reservado", usado por:
 *   - a validação da própria contribuição (não reservar além do que existe);
 *   - as operações que podem REDUZIR a quantidade de uma pilha (usar consumível,
 *     gastar munição, o mestre editar/remover o inventário).
 *
 * Fica separado (só depende do Prisma) para que o módulo de fichas o importe sem
 * criar dependência circular com o serviço do Descanso Longo.
 *
 * Fica em `prisma` (e não num repositório próprio) para que uma leitura sempre
 * enxergue as contribuições já gravadas na MESMA transação.
 */

/**
 * Estado de solicitação cujas reservas ainda VALEM (descanso em andamento).
 * COMPLETED/CANCELLED não contam — não dependemos da exclusão física da linha.
 */
export const RESERVING_REQUEST_STATUS = 'APPROVED';

/**
 * Quantidade DISPONÍVEL para outras operações = persistida − reservada.
 * Nunca negativa (uma pilha nunca fica "devedora").
 */
export function availableQuantity(quantity: number, reserved: number): number {
  return Math.max(0, quantity - reserved);
}

/**
 * Soma das reservas ATIVAS por id de entrada do inventário.
 * Consulta só as contribuições de solicitações ainda APPROVED.
 */
export async function reservedQuantities(
  inventoryItemIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(inventoryItemIds)];
  if (ids.length === 0) return new Map();

  const rows = await prisma.longRestCampSupplyContribution.groupBy({
    by: ['inventoryItemId'],
    where: {
      inventoryItemId: { in: ids },
      request: { status: RESERVING_REQUEST_STATUS },
    },
    _sum: { quantity: true },
  });

  return new Map(rows.map((row) => [row.inventoryItemId, row._sum.quantity ?? 0]));
}

/** Reserva ativa de UMA pilha (0 quando não há contribuição válida). */
export async function reservedQuantity(inventoryItemId: string): Promise<number> {
  return (await reservedQuantities([inventoryItemId])).get(inventoryItemId) ?? 0;
}
