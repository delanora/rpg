import type { FeatureChoiceOption } from './types.js';

// ---------------------------------------------------------------------------
// Estilos de Luta (PHB 2014, cap. 3)
//
// As mesmas opções servem a Guerreiro, Paladino e Patrulheiro — cada um oferece
// um subconjunto (o Guerreiro tem os seis; o Paladino e o Patrulheiro, quatro).
// Fica em módulo próprio para os três nunca saírem de sincronia.
//
// EFEITO NUMÉRICO AUTOMÁTICO: só a **Defesa** (+1 CA enquanto usar armadura).
// TODAS as demais dependem de combate por ação/reação/rolagem — ficam como
// escolha INFORMATIVA (PENDENTE Fase 5):
//   • Arquearia: +2 nas rolagens de ataque à distância;
//   • Duelismo: +2 de dano com arma de uma mão empunhada sozinha;
//   • Combate com Armas Grandes: rerrolar 1 e 2 no dano de arma de duas mãos;
//   • Proteção: usar a reação e o escudo para dar desvantagem a um ataque
//     contra um aliado a até 1,5 m;
//   • Combate com Duas Armas: somar o mod. de atributo ao dano da segunda arma.
//
// O livro proíbe escolher o MESMO estilo duas vezes: se o personagem receber
// Estilo de Luta de mais de uma classe, os bônus também não se acumulam (ver
// `mergeAdjustments`).
// ---------------------------------------------------------------------------

export const FIGHTING_STYLE_ARCHERY: FeatureChoiceOption = {
  key: 'archery',
  name: 'Arquearia',
  description: '+2 nas rolagens de ataque com armas à distância.',
};

export const FIGHTING_STYLE_DEFENSE: FeatureChoiceOption = {
  key: 'defense',
  name: 'Defesa',
  description: '+1 na Classe de Armadura enquanto usar armadura.',
  effect: {
    type: 'armorClass',
    value: 1,
    requiresArmor: true,
    name: 'Estilo de Luta (Defesa)',
  },
};

export const FIGHTING_STYLE_DUELING: FeatureChoiceOption = {
  key: 'dueling',
  name: 'Duelismo',
  description: '+2 de dano com arma de uma mão empunhada sozinha.',
};

export const FIGHTING_STYLE_GREAT_WEAPON: FeatureChoiceOption = {
  key: 'great-weapon-fighting',
  name: 'Combate com Armas Grandes',
  description: 'Pode rerrolar 1 e 2 nos dados de dano de armas de duas mãos (usa o novo valor).',
};

export const FIGHTING_STYLE_PROTECTION: FeatureChoiceOption = {
  key: 'protection',
  name: 'Proteção',
  description:
    'Com um escudo, use a reação para impor desvantagem no ataque de uma criatura contra um aliado a até 1,5 m (5 pés).',
};

export const FIGHTING_STYLE_TWO_WEAPON: FeatureChoiceOption = {
  key: 'two-weapon-fighting',
  name: 'Combate com Duas Armas',
  description: 'Soma o modificador de atributo ao dano do segundo ataque com a outra arma.',
};

/** Os seis estilos (Guerreiro). */
export const ALL_FIGHTING_STYLES: readonly FeatureChoiceOption[] = [
  FIGHTING_STYLE_ARCHERY,
  FIGHTING_STYLE_DEFENSE,
  FIGHTING_STYLE_DUELING,
  FIGHTING_STYLE_GREAT_WEAPON,
  FIGHTING_STYLE_PROTECTION,
  FIGHTING_STYLE_TWO_WEAPON,
];

/** Os quatro do Paladino (PHB: Defesa, Duelismo, Armas Grandes e Proteção). */
export const PALADIN_FIGHTING_STYLES: readonly FeatureChoiceOption[] = [
  FIGHTING_STYLE_DEFENSE,
  FIGHTING_STYLE_DUELING,
  FIGHTING_STYLE_GREAT_WEAPON,
  FIGHTING_STYLE_PROTECTION,
];

/** Os quatro do Patrulheiro (PHB: Arquearia, Defesa, Duelismo e Duas Armas). */
export const RANGER_FIGHTING_STYLES: readonly FeatureChoiceOption[] = [
  FIGHTING_STYLE_ARCHERY,
  FIGHTING_STYLE_DEFENSE,
  FIGHTING_STYLE_DUELING,
  FIGHTING_STYLE_TWO_WEAPON,
];
