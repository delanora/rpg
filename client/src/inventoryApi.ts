import { api } from './api';
import type { Character, DiceRollDto, InventoryMoveRequest } from './types';

/**
 * Move/equipa um item do inventário no servidor.
 *
 * O servidor trata a troca (destino ocupado) e devolve a ficha já atualizada,
 * que passa a ser a fonte de verdade na tela.
 */
export async function moveInventoryItem(request: InventoryMoveRequest): Promise<Character> {
  const { character } = await api<{ character: Character }>('/api/characters/me/inventory/move', {
    method: 'POST',
    body: request,
  });
  return character;
}

/**
 * Usa (consome) UMA unidade de um item do inventário (Poção ou consumível).
 *
 * O servidor desconta a unidade, remove a entrada quando chega a zero e, se o
 * item tiver `effectRoll`, devolve também a rolagem do efeito (`roll`).
 */
export async function useInventoryItem(
  itemInventoryId: string,
): Promise<{ character: Character; roll: DiceRollDto | null }> {
  return api<{ character: Character; roll: DiceRollDto | null }>(
    '/api/characters/me/inventory/use',
    { method: 'POST', body: { itemInventoryId } },
  );
}
