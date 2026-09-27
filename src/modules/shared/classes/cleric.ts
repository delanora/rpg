import type { ClassDefinition } from './types.js';
import { NO_FEATURES, NO_SUBCLASSES } from './types.js';

export const cleric: ClassDefinition = {
  key: 'cleric',
  name: 'Clérigo',
  hitDie: 8,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 1, // Domínio Divino
  spellcasting: { type: 'full', ability: 'wisdom', learning: 'prepared' },
  features: NO_FEATURES,
  subclasses: NO_SUBCLASSES,
};
