import type { ClassDefinition } from './types.js';
import { NO_FEATURES, NO_SUBCLASSES } from './types.js';

export const warlock: ClassDefinition = {
  key: 'warlock',
  name: 'Bruxo',
  hitDie: 8,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 1, // Patrono Extraplanar
  spellcasting: { type: 'pact', ability: 'charisma', learning: 'known' },
  features: NO_FEATURES,
  subclasses: NO_SUBCLASSES,
};
