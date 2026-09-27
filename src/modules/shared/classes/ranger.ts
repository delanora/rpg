import type { ClassDefinition } from './types.js';
import { NO_FEATURES, NO_SUBCLASSES } from './types.js';

export const ranger: ClassDefinition = {
  key: 'ranger',
  name: 'Patrulheiro',
  hitDie: 10,
  savingThrows: ['strength', 'dexterity'],
  subclassLevel: 3, // Arquétipo de Patrulheiro
  spellcasting: { type: 'half', ability: 'wisdom', learning: 'known' },
  features: NO_FEATURES,
  subclasses: NO_SUBCLASSES,
};
