import type { Background } from './types.js';

/** Charlatão (Charlatan): identidade falsa, disfarce e falsificação. */
export const charlatan: Background = {
  id: 'charlatan',
  namePt: 'Charlatão',
  nameEn: 'Charlatan',
  description: 'Você sempre teve um plano, uma identidade falsa e a lábia para vendê-la.',
  skillProficiencies: ['deception', 'sleightOfHand'],
  toolProficiencies: ['disguise-kit', 'forgery-kit'],
  feature: {
    name: 'Identidade Falsa',
    description:
      'Você mantém uma segunda identidade documentada e sabe como usá-la para se passar por outra pessoa, com contatos que a sustentam.',
  },
  suggestedEquipment:
    'Roupas finas, kit de disfarce, ferramentas do golpe e uma bolsa com 15 PO.',
};
