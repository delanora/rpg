import type { AbilityKey, FeatureSource, SpellLearning, SpellcastingType } from './types';

/**
 * Constantes de D&D 5e usadas apenas para exibição/labels no frontend.
 * Os cálculos são sempre feitos no servidor; aqui não há regra de negócio.
 */

export const ABILITY_KEYS: readonly AbilityKey[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

export const ABILITY_ABBREVIATIONS: Record<AbilityKey, string> = {
  strength: 'FOR',
  dexterity: 'DES',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'SAB',
  charisma: 'CAR',
};

export interface SkillDefinition {
  key: string;
  label: string;
  ability: AbilityKey;
}

export const SKILLS: readonly SkillDefinition[] = [
  { key: 'acrobatics', label: 'Acrobacia', ability: 'dexterity' },
  { key: 'animalHandling', label: 'Adestramento', ability: 'wisdom' },
  { key: 'arcana', label: 'Arcanismo', ability: 'intelligence' },
  { key: 'athletics', label: 'Atletismo', ability: 'strength' },
  { key: 'performance', label: 'Atuação', ability: 'charisma' },
  { key: 'deception', label: 'Enganação', ability: 'charisma' },
  { key: 'stealth', label: 'Furtividade', ability: 'dexterity' },
  { key: 'history', label: 'História', ability: 'intelligence' },
  { key: 'intimidation', label: 'Intimidação', ability: 'charisma' },
  { key: 'insight', label: 'Intuição', ability: 'wisdom' },
  { key: 'investigation', label: 'Investigação', ability: 'intelligence' },
  { key: 'medicine', label: 'Medicina', ability: 'wisdom' },
  { key: 'nature', label: 'Natureza', ability: 'intelligence' },
  { key: 'perception', label: 'Percepção', ability: 'wisdom' },
  { key: 'persuasion', label: 'Persuasão', ability: 'charisma' },
  { key: 'sleightOfHand', label: 'Prestidigitação', ability: 'dexterity' },
  { key: 'religion', label: 'Religião', ability: 'intelligence' },
  { key: 'survival', label: 'Sobrevivência', ability: 'wisdom' },
];

export const ALIGNMENTS = [
  'Leal e Bom',
  'Neutro e Bom',
  'Caótico e Bom',
  'Leal e Neutro',
  'Neutro',
  'Caótico e Neutro',
  'Leal e Mau',
  'Neutro e Mau',
  'Caótico e Mau',
] as const;

export const FEATURE_SOURCES: readonly FeatureSource[] = [
  'race',
  'class',
  'background',
  'feat',
  'other',
];

export const FEATURE_SOURCE_LABELS: Record<FeatureSource, string> = {
  race: 'Raça',
  class: 'Classe',
  background: 'Antecedente',
  feat: 'Talento',
  other: 'Outro',
};

/** Rótulos do tipo de conjuração de uma classe. */
export const SPELLCASTING_TYPE_LABELS: Record<SpellcastingType, string> = {
  none: 'Sem conjuração',
  full: 'Conjurador completo',
  half: 'Meio-conjurador',
  third: 'Terço-conjurador',
  pact: 'Magia de pacto',
};

/** Rótulos do modo de aprendizado das magias. */
export const SPELL_LEARNING_LABELS: Record<SpellLearning, string> = {
  known: 'Conhecidas',
  prepared: 'Preparadas',
  none: '—',
};

/** Formata o dado de vida (ex.: 10 -> "d10"). */
export function hitDieLabel(die: number | null): string {
  return die === null ? '—' : `d${die}`;
}

export const DAMAGE_TYPES = [
  'Cortante',
  'Perfurante',
  'Concussão',
  'Ácido',
  'Frio',
  'Fogo',
  'Elétrico',
  'Necrótico',
  'Veneno',
  'Psíquico',
  'Radiante',
  'Trovão',
  'Força',
] as const;

export const SPELL_SCHOOLS = [
  'Abjuração',
  'Adivinhação',
  'Conjuração',
  'Encantamento',
  'Evocação',
  'Ilusão',
  'Necromancia',
  'Transmutação',
] as const;

export const SPELL_LEVEL_LABELS: Record<number, string> = {
  0: 'Truques',
  1: '1º nível',
  2: '2º nível',
  3: '3º nível',
  4: '4º nível',
  5: '5º nível',
  6: '6º nível',
  7: '7º nível',
  8: '8º nível',
  9: '9º nível',
};

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
