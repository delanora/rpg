import type { ClassDefinition } from './types.js';
import { NO_FEATURES, NO_SUBCLASSES } from './types.js';

export const paladin: ClassDefinition = {
  key: 'paladin',
  name: 'Paladino',
  hitDie: 10,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 3, // Juramento Sagrado
  spellcasting: { type: 'half', ability: 'charisma', learning: 'prepared' },
  features: NO_FEATURES,
  subclasses: NO_SUBCLASSES,
};
