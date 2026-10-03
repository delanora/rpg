import type { Background } from './types.js';

/** Forasteiro (Outlander): terras selvagens, um instrumento à escolha e 1 idioma. */
export const outlander: Background = {
  id: 'outlander',
  namePt: 'Forasteiro',
  nameEn: 'Outlander',
  description: 'Você cresceu nas terras selvagens, longe das cidades e das estradas.',
  skillProficiencies: ['athletics', 'survival'],
  toolChoices: [{ id: 'outlander-instrument', label: 'Instrumento musical', category: 'musicalInstrument' }],
  languageChoices: 1,
  feature: {
    name: 'Andarilho',
    description:
      'Você consegue encontrar comida e água para si e para o grupo e pode guiar o bando por terras selvagens.',
  },
  suggestedEquipment:
    'Cajado, arpéu, troféu de caça, roupas de viajante e uma bolsa com 10 PO.',
};
