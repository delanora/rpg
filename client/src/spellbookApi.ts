import { api } from './api';
import type { Character } from './types';

/** Uma magia escolhida do catálogo para uma classe. */
export interface SpellbookEntryRequest {
  key: string;
  prepared: boolean;
}

/**
 * Define o livro de magias de UMA classe (Prompt 6.2). O servidor valida a
 * seleção contra o catálogo (lista da classe, nível máximo e limites) e devolve
 * a ficha já atualizada.
 */
export async function setSpellbook(
  classKey: string,
  entries: SpellbookEntryRequest[],
): Promise<Character> {
  const { character } = await api<{ character: Character }>('/api/characters/me/spellbook', {
    method: 'PUT',
    body: { classKey, entries },
  });
  return character;
}
