import { z } from 'zod';

/**
 * SINTONIZAÇÃO (PHB 2014, p. 136).
 *
 * Regra ÚNICA do sistema — não existia um motor de sintonização antes desta
 * etapa; a mesma função é usada pelo inventário do NPC (o único que hoje expõe
 * o controle). O limite é 3 itens sintonizados por criatura, salvo uma feature
 * futura que altere o teto. Só itens que EXIGEM sintonização podem ser
 * sintonizados; sintonizar um item comum é recusado.
 *
 * Fica em `shared` porque é regra de domínio, nunca de interface.
 */

export const ATTUNEMENT_LIMIT = 3;

/** Mínimo que um item precisa ter para entrar na conta. */
interface AttunableItem {
  attuned?: boolean;
  requiresAttunement?: boolean;
}

/** Quantos itens estão sintonizados agora. */
export function attunedCount(inventory: readonly AttunableItem[]): number {
  return inventory.filter((item) => item.attuned === true).length;
}

/** O item pode ser sintonizado? (exige sintonização e ainda não está). */
export function canAttune(inventory: readonly AttunableItem[], item: AttunableItem): boolean {
  return item.requiresAttunement === true && item.attuned !== true && attunedCount(inventory) < ATTUNEMENT_LIMIT;
}

/**
 * Valida a mudança de sintonização de UM item. Devolve o motivo da recusa ou
 * `null` quando pode aplicar.
 */
export function attunementError(
  inventory: readonly AttunableItem[],
  item: AttunableItem,
  attuned: boolean,
): string | null {
  if (!attuned) return null;
  if (item.requiresAttunement !== true) {
    return 'Este item não exige sintonização.';
  }
  if (item.attuned === true) return null;
  if (attunedCount(inventory) >= ATTUNEMENT_LIMIT) {
    return `Limite de ${ATTUNEMENT_LIMIT} itens sintonizados atingido.`;
  }
  return null;
}

/** Leitura tolerante de uma lista de inventário só para a contagem. */
export const attunementListSchema = z.array(
  z.object({ attuned: z.boolean().optional(), requiresAttunement: z.boolean().optional() }),
);
