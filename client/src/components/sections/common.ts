import type { Character, CharacterPatch } from '../../types';

/** Toda seção recebe a ficha atual e a função que aplica um patch. */
export interface SheetSectionProps {
  character: Character;
  update: (patch: CharacterPatch) => void;
}
