import type { Background } from './types.js';

/** Artesão de Guilda (Guild Artisan): carta de guilda, uma ferramenta à escolha e 1 idioma. */
export const guildArtisan: Background = {
  id: 'guild-artisan',
  namePt: 'Artesão de Guilda',
  nameEn: 'Guild Artisan',
  description: 'Você é membro de uma guilda de artesãos, com carta, oficina e contatos.',
  skillProficiencies: ['insight', 'persuasion'],
  toolChoices: [{ id: 'guild-artisan-tool', label: 'Ferramenta de artesão', category: 'artisan' }],
  languageChoices: 1,
  feature: {
    name: 'Filiação à Guilda',
    description:
      'Sua guilda oferece alojamento, apoio político e ajuda legal; em troca, você paga uma taxa mensal e responde a ela.',
  },
  suggestedEquipment:
    'Ferramentas de artesão, carta de apresentação da guilda, roupas de viajante e uma bolsa com 15 PO.',
};
