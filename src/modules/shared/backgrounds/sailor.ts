import type { Background } from './types.js';

/** Marinheiro (Sailor): navegação e veículo aquático fixos. */
export const sailor: Background = {
  id: 'sailor',
  namePt: 'Marinheiro',
  nameEn: 'Sailor',
  description: 'Você navegou por anos: conhece cordas, tempestades e portos de todo lugar.',
  skillProficiencies: ['athletics', 'perception'],
  toolProficiencies: ['navigator-tools', 'water-vehicle'],
  feature: {
    name: 'Passagem de Navio',
    description:
      'Quando precisar, você consegue passagem gratuita em um navio para si e seus companheiros (desde que o navio tenha espaço).',
  },
  suggestedEquipment:
    'Malagueta (clava), 15 m de corda de seda, amuleto da sorte, roupas comuns e uma bolsa com 10 PO.',
};
