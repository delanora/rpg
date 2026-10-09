import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { parseJson } from '../shared/json.js';

/**
 * RESERVA LÓGICA de RECURSOS DE ACAMPAMENTO (mecânica OPCIONAL do Descanso Longo
 * coletivo).
 *
 * Contribuir NÃO remove o item do inventário: a quantidade comprometida fica
 * apenas RESERVADA. Este módulo é a fonte única do cálculo "quanto está
 * reservado", usado por:
 *   - a validação da própria contribuição (não reservar além do que existe);
 *   - as operações que podem REDUZIR/consumir a quantidade de uma pilha (usar
 *     consumível, gastar munição em combate, o mestre editar o inventário).
 *
 * Fica separado (só depende do Prisma e de `shared`) para que o módulo de fichas
 * o importe sem criar dependência circular com o serviço do Descanso Longo.
 *
 * Fica em `prisma` (e não num repositório próprio) para que uma leitura sempre
 * enxergue as contribuições já gravadas na MESMA transação.
 *
 * Uma reserva é EFETIVA apenas quando as DUAS condições valem:
 *   1. a solicitação está EM ANDAMENTO (`APPROVED`);
 *   2. a mecânica está LIGADA na mesa (`game_config.campSuppliesEnabled`).
 *
 * A contribuição continua PERSISTIDA como histórico quando a mecânica é
 * desligada — ela só deixa de bloquear o inventário. Ao religar, a reserva é
 * REAVALIADA contra o inventário ATUAL: nunca passa do que a pilha realmente tem
 * (uma pilha reduzida/removida enquanto a mecânica estava desligada não
 * ressuscita quantidade nem produz reserva negativa). A revalidação "dura" —
 * aceitar só o que existe e nunca consumir quantidade inexistente — acontece na
 * conclusão do descanso (`camp-supplies-calculator.ts`).
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

/** A mecânica de recursos de acampamento está LIGADA na mesa agora? */
export async function campSuppliesEnabled(): Promise<boolean> {
  const config = await prisma.gameConfig.findUnique({ where: { id: 'main' } });
  return config?.campSuppliesEnabled ?? false;
}

/** Leitura mínima do JSONB do inventário: só o id da pilha e a quantidade. */
const stackQuantitiesSchema = z.array(
  z.object({ id: z.string().min(1), quantity: z.number().default(0) }),
);

type StackQuantity = z.infer<typeof stackQuantitiesSchema>[number];

/**
 * Soma das reservas EFETIVAS por id de entrada do inventário.
 *
 * Considera só as contribuições de solicitações ainda APPROVED **e** a mecânica
 * ligada (com ela desligada, todas as reservas valem ZERO — as contribuições
 * permanecem como histórico e voltam a valer, reavaliadas, se o mestre religar).
 * O valor devolvido é limitado à quantidade que a pilha realmente tem: uma
 * pilha removida ou reduzida nunca gera reserva acima do existente nem negativa.
 */
export async function reservedQuantities(
  inventoryItemIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(inventoryItemIds)];
  if (ids.length === 0) return new Map();

  const rows = await prisma.longRestCampSupplyContribution.findMany({
    where: {
      inventoryItemId: { in: ids },
      request: { status: RESERVING_REQUEST_STATUS },
    },
    select: { characterId: true, inventoryItemId: true, quantity: true },
  });
  // Caminho comum (nada reservado): nenhuma leitura além desta.
  if (rows.length === 0) return new Map();

  // Mecânica DESLIGADA ⇒ nenhuma reserva efetiva, sem tocar nas contribuições.
  if (!(await campSuppliesEnabled())) return new Map();

  // Quantidade REAL de cada pilha agora (a reserva não inventa quantidade).
  const characterIds = [...new Set(rows.map((row) => row.characterId))];
  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds } },
    select: { id: true, inventory: true },
  });
  const quantityById = new Map<string, number>();
  for (const character of characters) {
    for (const stack of parseJson<StackQuantity[]>(stackQuantitiesSchema, character.inventory, [])) {
      quantityById.set(stack.id, Math.max(0, stack.quantity));
    }
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.inventoryItemId, (totals.get(row.inventoryItemId) ?? 0) + row.quantity);
  }

  const reserved = new Map<string, number>();
  for (const [inventoryItemId, total] of totals) {
    reserved.set(
      inventoryItemId,
      Math.min(total, quantityById.get(inventoryItemId) ?? 0),
    );
  }
  return reserved;
}

/** Reserva efetiva de UMA pilha (0 quando não há contribuição válida). */
export async function reservedQuantity(inventoryItemId: string): Promise<number> {
  return (await reservedQuantities([inventoryItemId])).get(inventoryItemId) ?? 0;
}
