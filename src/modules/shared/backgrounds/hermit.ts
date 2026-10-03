import type { Background } from './types.js';

/** Eremita (Hermit): isolamento, kit de herbalismo e 1 idioma à escolha. */
export const hermit: Background = {
  id: 'hermit',
  namePt: 'Eremita',
  nameEn: 'Hermit',
  description: 'Você se isolou do mundo em busca de iluminação — e encontrou algo.',
  skillProficiencies: ['medicine', 'religion'],
  toolProficiencies: ['herbalism-kit'],
  languageChoices: 1,
  feature: {
    name: 'Descoberta',
    description:
      'Você descobriu uma verdade única e poderosa durante o isolamento; o mestre decide junto com você o que ela é e o que ela implica.',
  },
  suggestedEquipment:
    'Estojo de pergaminhos com anotações, cobertor de inverno, roupas comuns, kit de herbalismo e uma bolsa com 5 PO.',
};
