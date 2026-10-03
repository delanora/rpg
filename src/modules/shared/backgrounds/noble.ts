import type { Background } from './types.js';

/**
 * Nobre (Noble): linhagem, jogo de tabuleiro/cartas (o catálogo tem um único
 * item genérico `gaming-set`) e 1 idioma à escolha.
 */
export const noble: Background = {
  id: 'noble',
  namePt: 'Nobre',
  nameEn: 'Noble',
  description: 'Você nasceu com título, terras e a educação (e as dívidas) da nobreza.',
  skillProficiencies: ['history', 'persuasion'],
  toolProficiencies: ['gaming-set'],
  languageChoices: 1,
  feature: {
    name: 'Posição de Privilégio',
    description:
      'Sua linhagem abre portas: você é bem recebido na alta sociedade e as pessoas tendem a tratá-lo com deferência.',
  },
  suggestedEquipment:
    'Roupas finas, anel de sinete, pergaminho de linhagem e uma bolsa com 25 PO.',
};
