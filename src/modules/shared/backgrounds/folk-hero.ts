import type { Background } from './types.js';

/** Herói do Povo (Folk Hero): o campo, a ferramenta de artesão e o veículo terrestre. */
export const folkHero: Background = {
  id: 'folk-hero',
  namePt: 'Herói do Povo',
  nameEn: 'Folk Hero',
  description: 'Você veio do campo e o povo simples o tem como campeão.',
  skillProficiencies: ['animalHandling', 'survival'],
  toolProficiencies: ['land-vehicle'],
  toolChoices: [{ id: 'folk-hero-artisan', label: 'Ferramenta de artesão', category: 'artisan' }],
  feature: {
    name: 'Hospitalidade Rústica',
    description:
      'O povo simples o abriga e o esconde dos que o perseguem; você se sente em casa entre camponeses.',
  },
  suggestedEquipment:
    'Ferramentas de artesão, uma pá, uma panela de ferro, roupas comuns e uma bolsa com 10 PO.',
};
