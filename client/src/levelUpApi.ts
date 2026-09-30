import { api } from './api';
import type { Character, LevelDownRequest, LevelDownResult, LevelUpRequest } from './types';

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

/**
 * O MESTRE reduz um nível de um personagem — o inverso do Level Up.
 *
 * A resposta traz a ficha já revertida, o resumo do que saiu (`levelDown`) e os
 * avisos dos níveis anteriores ao histórico.
 */
export function levelDownCharacter(
  characterId: string,
  request: LevelDownRequest,
): Promise<LevelDownResult> {
  return api<LevelDownResult>(`/api/characters/${characterId}/level-down`, {
    method: 'POST',
    body: request,
  });
}
