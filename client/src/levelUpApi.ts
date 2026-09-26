import { api } from './api';
import type { Character, LevelUpRequest } from './types';

/**
 * Aplica o Level Up de uma vez. O dado de vida é rolado no servidor: o cliente
 * só escolhe entre rolar e a média, e o servidor devolve a ficha já atualizada.
 */
export async function levelUpCharacter(request: LevelUpRequest): Promise<Character> {
  const { character } = await api<{ character: Character }>('/api/characters/me/level-up', {
    method: 'POST',
    body: request,
  });
  return character;
}
