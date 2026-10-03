import type { Background } from './types.js';

/** Órfão de Rua (Urchin): disfarce e ferramentas de ladrão fixas. */
export const urchin: Background = {
  id: 'urchin',
  namePt: 'Órfão de Rua',
  nameEn: 'Urchin',
  description: 'Você cresceu sozinho nas ruas, rápido de mãos e invisível nos becos.',
  skillProficiencies: ['sleightOfHand', 'stealth'],
  toolProficiencies: ['disguise-kit', 'thieves-tools'],
  feature: {
    name: 'Segredos da Cidade',
    description:
      'Você conhece as passagens secretas e os atalhos das cidades e viaja pelo dobro da velocidade entre pontos urbanos.',
  },
  suggestedEquipment:
    'Faca pequena, mapa da cidade natal, camundongo de estimação, lembrança dos pais, roupas comuns e uma bolsa com 10 PO.',
};
