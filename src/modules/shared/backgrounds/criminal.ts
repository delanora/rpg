import type { Background } from './types.js';

/**
 * Criminoso (Criminal): contatos do submundo, ferramentas de ladrão e um jogo
 * de tabuleiro/cartas (o catálogo tem um único item genérico `gaming-set`, então
 * ele é concedido FIXO em vez de à escolha).
 */
export const criminal: Background = {
  id: 'criminal',
  namePt: 'Criminoso',
  nameEn: 'Criminal',
  description: 'Você tem contatos no submundo e um passado que prefere não comentar.',
  skillProficiencies: ['deception', 'stealth'],
  toolProficiencies: ['thieves-tools', 'gaming-set'],
  feature: {
    name: 'Contato Criminoso',
    description:
      'Você tem um contato confiável no submundo do crime, que serve de elo com a rede de ilegalidade local.',
  },
  suggestedEquipment:
    'Pé de cabra, roupas escuras comuns com capuz e uma bolsa com 15 PO.',
};
