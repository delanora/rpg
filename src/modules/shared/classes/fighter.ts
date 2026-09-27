import type { ClassDefinition } from './types.js';
import { NO_FEATURES, NO_SUBCLASSES } from './types.js';

export const fighter: ClassDefinition = {
  key: 'fighter',
  name: 'Guerreiro',
  hitDie: 10,
  savingThrows: ['strength', 'constitution'],
  subclassLevel: 3, // Arquétipo Marcial
  spellcasting: { type: 'none', ability: null, learning: 'none' },
  features: NO_FEATURES,
  subclasses: NO_SUBCLASSES,
};
