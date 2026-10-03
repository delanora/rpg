import type { Background } from './types.js';

/** Acólito (Acolyte): templo, ritos e dois idiomas à escolha. */
export const acolyte: Background = {
  id: 'acolyte',
  namePt: 'Acólito',
  nameEn: 'Acolyte',
  description: 'Você serviu a um templo e conhece os ritos, as orações e os segredos da fé.',
  skillProficiencies: ['insight', 'religion'],
  languageChoices: 2,
  feature: {
    name: 'Abrigo dos Fiéis',
    description:
      'Você e seu grupo podem receber cura e abrigo gratuitos em templos da sua fé, desde que a ajuda não coloque os religiosos em risco.',
  },
  suggestedEquipment:
    'Símbolo sagrado, livro de orações, 5 varetas de incenso, vestes cerimoniais, roupas comuns e uma bolsa com 15 PO.',
};
