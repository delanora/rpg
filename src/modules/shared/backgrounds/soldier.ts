import type { Background } from './types.js';

/**
 * Soldado (Soldier): patente militar, veículo terrestre fixo e um jogo de
 * tabuleiro/cartas (o catálogo tem um único item genérico `gaming-set`).
 */
export const soldier: Background = {
  id: 'soldier',
  namePt: 'Soldado',
  nameEn: 'Soldier',
  description: 'Você treinou e lutou num exército; a disciplina (ou a cicatriz) ficou.',
  skillProficiencies: ['athletics', 'intimidation'],
  toolProficiencies: ['land-vehicle', 'gaming-set'],
  feature: {
    name: 'Patente Militar',
    description:
      'Sua patente impõe respeito entre soldados e permite requisitar equipamento e alojamento de unidades aliadas.',
  },
  suggestedEquipment:
    'Insígnia de patente, troféu tirado de um inimigo, um jogo de dados ou cartas, roupas comuns e uma bolsa com 10 PO.',
};
