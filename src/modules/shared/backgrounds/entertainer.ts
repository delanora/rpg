import type { Background } from './types.js';

/** Artista (Entertainer): palco, disfarce e um instrumento musical à escolha. */
export const entertainer: Background = {
  id: 'entertainer',
  namePt: 'Artista',
  nameEn: 'Entertainer',
  description: 'Você vive para a plateia: música, dança, malabarismo ou lábia de palco.',
  skillProficiencies: ['acrobatics', 'performance'],
  toolProficiencies: ['disguise-kit'],
  toolChoices: [{ id: 'entertainer-instrument', label: 'Instrumento musical', category: 'musicalInstrument' }],
  feature: {
    name: 'Sob Demanda Popular',
    description:
      'Você sempre encontra um lugar para se apresentar e costuma receber hospedagem e comida em troca do seu número.',
  },
  suggestedEquipment:
    'Instrumento musical, o favor de um admirador, um figurino e uma bolsa com 15 PO.',
};
