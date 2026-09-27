import type { ClassDefinition } from './types.js';
import { NO_FEATURES, NO_SUBCLASSES } from './types.js';

export const bard: ClassDefinition = {
  key: 'bard',
  name: 'Bardo',
  hitDie: 8,
  savingThrows: ['dexterity', 'charisma'],
  subclassLevel: 3, // Colégio de Bardo
  spellcasting: { type: 'full', ability: 'charisma', learning: 'known' },
  features: NO_FEATURES,
  subclasses: NO_SUBCLASSES,
};
