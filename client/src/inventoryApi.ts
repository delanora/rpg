import { api } from './api';
import type { Character, InventoryMoveRequest } from './types';

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
