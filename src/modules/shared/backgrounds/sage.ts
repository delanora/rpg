import type { Background } from './types.js';

/** Sábio (Sage): livros e arquivos, sem ferramentas, dois idiomas à escolha. */
export const sage: Background = {
  id: 'sage',
  namePt: 'Sábio',
  nameEn: 'Sage',
  description: 'Você passou a vida entre livros e arquivos, caçando conhecimento proibido.',
  skillProficiencies: ['arcana', 'history'],
  languageChoices: 2,
  feature: {
    name: 'Pesquisador',
    description:
      'Quando você não sabe algo, geralmente sabe ONDE e COM QUEM descobrir — um arquivo, uma biblioteca ou um especialista.',
  },
  suggestedEquipment:
    'Tinteiro e pena, faca pequena, carta de um colega morto, roupas comuns e uma bolsa com 10 PO.',
};
