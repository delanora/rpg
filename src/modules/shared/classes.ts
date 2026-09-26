import type { AbilityKey } from './dnd5e.js';

/**
 * Registro das 12 classes do Livro do Jogador (PHB 2014).
 *
 * Esta é a fonte única de verdade sobre classes: dado de vida, salvaguardas
 * fixas, nível de escolha de subclasse e o modo de conjuração. As features de
 * cada classe/subclasse ainda NÃO estão preenchidas — a estrutura já está
 * pronta (`features` e `subclasses`) para recebê-las nos próximos passos, uma
 * classe por vez.
 */

/** Como a classe obtém e usa magias. */
export type SpellcastingType = 'none' | 'full' | 'half' | 'third' | 'pact';

/** De onde vêm as magias: lista fixa (conhecidas) ou recalculada (preparadas). */
export type SpellLearning = 'known' | 'prepared' | 'none';

/** Recurso com contador concedido por uma característica (ex.: Fúria). */
export interface ClassFeatureResource {
  name: string;
  max: number;
  recharge: 'short' | 'long' | 'none';
}

/**
 * Efeito mecânico opcional de uma característica. É a ponte entre o texto da
 * característica e a aplicação automática na ficha (bônus numérico, recurso
 * com contador etc.). Preenchido junto com as features de cada classe.
 */
export interface ClassFeatureEffect {
  type: 'bonus' | 'resource' | 'other';
  /** Alvo do bônus quando `type: 'bonus'` (ex.: 'armorClass', 'initiative', 'speed'). */
  target?: string;
  /** Valor do bônus. */
  value?: number;
  /** Recurso com contador quando `type: 'resource'`. */
  resource?: ClassFeatureResource;
  /** Observações livres sobre o efeito. */
  notes?: string;
}

/** Uma característica concedida por uma classe ou subclasse. */
export interface ClassFeatureDefinition {
  /** Identificador estável (ex.: 'rage'). */
  id: string;
  name: string;
  /** Nível do personagem em que a característica é obtida. */
  level: number;
  description: string;
  /** Efeito mecânico vinculado, quando houver. */
  effect?: ClassFeatureEffect;
}

/** Uma subclasse (ex.: Caminho Primal do Bárbaro). */
export interface SubclassDefinition {
  id: string;
  name: string;
  description: string;
  features: ClassFeatureDefinition[];
}

/** Definição completa de uma classe. */
export interface ClassDefinition {
  /** Chave canônica (estável, usada no banco e nas APIs). */
  key: string;
  name: string;
  /** Dado de vida: 6, 8, 10 ou 12. */
  hitDie: number;
  /** As duas salvaguardas com proficiência — fixas, nunca mudam. */
  savingThrows: [AbilityKey, AbilityKey];
  /** Nível em que a subclasse é escolhida. */
  subclassLevel: number;
  spellcasting: {
    type: SpellcastingType;
    /** Atributo de conjuração (nulo quando a classe não conjura). */
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  /** Características de classe (vazio por enquanto). */
  features: ClassFeatureDefinition[];
  /** Subclasses disponíveis (vazio por enquanto). */
  subclasses: SubclassDefinition[];
}

/** Resumo usado para montar o seletor de classe no cliente. */
export interface ClassSummary {
  key: string;
  name: string;
  hitDie: number;
  subclassLevel: number;
  spellcastingType: SpellcastingType;
}

/** Nenhuma classe tem features/subclasses cadastradas ainda. */
const NO_FEATURES: ClassFeatureDefinition[] = [];
const NO_SUBCLASSES: SubclassDefinition[] = [];

/**
 * As 12 classes. Os níveis de subclasse seguem o PHB 2014:
 * Clérigo, Bruxo e Feiticeiro escolhem no nível 1; Druida e Mago no 2;
 * as demais no 3.
 */
export const CLASS_DEFINITIONS: readonly ClassDefinition[] = [
  {
    key: 'barbarian',
    name: 'Bárbaro',
    hitDie: 12,
    savingThrows: ['strength', 'constitution'],
    subclassLevel: 3, // Caminho Primal
    spellcasting: { type: 'none', ability: null, learning: 'none' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'bard',
    name: 'Bardo',
    hitDie: 8,
    savingThrows: ['dexterity', 'charisma'],
    subclassLevel: 3, // Colégio de Bardo
    spellcasting: { type: 'full', ability: 'charisma', learning: 'known' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'cleric',
    name: 'Clérigo',
    hitDie: 8,
    savingThrows: ['wisdom', 'charisma'],
    subclassLevel: 1, // Domínio Divino
    spellcasting: { type: 'full', ability: 'wisdom', learning: 'prepared' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'druid',
    name: 'Druida',
    hitDie: 8,
    savingThrows: ['intelligence', 'wisdom'],
    subclassLevel: 2, // Círculo Druídico
    spellcasting: { type: 'full', ability: 'wisdom', learning: 'prepared' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'fighter',
    name: 'Guerreiro',
    hitDie: 10,
    savingThrows: ['strength', 'constitution'],
    subclassLevel: 3, // Arquétipo Marcial
    spellcasting: { type: 'none', ability: null, learning: 'none' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'rogue',
    name: 'Ladino',
    hitDie: 8,
    savingThrows: ['dexterity', 'intelligence'],
    subclassLevel: 3, // Arquétipo Ladino
    spellcasting: { type: 'none', ability: null, learning: 'none' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'wizard',
    name: 'Mago',
    hitDie: 6,
    savingThrows: ['intelligence', 'wisdom'],
    subclassLevel: 2, // Tradição Arcana
    spellcasting: { type: 'full', ability: 'intelligence', learning: 'prepared' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'monk',
    name: 'Monge',
    hitDie: 8,
    savingThrows: ['strength', 'dexterity'],
    subclassLevel: 3, // Tradição Monástica
    spellcasting: { type: 'none', ability: null, learning: 'none' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'paladin',
    name: 'Paladino',
    hitDie: 10,
    savingThrows: ['wisdom', 'charisma'],
    subclassLevel: 3, // Juramento Sagrado
    spellcasting: { type: 'half', ability: 'charisma', learning: 'prepared' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'ranger',
    name: 'Patrulheiro',
    hitDie: 10,
    savingThrows: ['strength', 'dexterity'],
    subclassLevel: 3, // Arquétipo de Patrulheiro
    spellcasting: { type: 'half', ability: 'wisdom', learning: 'known' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'warlock',
    name: 'Bruxo',
    hitDie: 8,
    savingThrows: ['wisdom', 'charisma'],
    subclassLevel: 1, // Patrono Extraplanar
    spellcasting: { type: 'pact', ability: 'charisma', learning: 'known' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
  {
    key: 'sorcerer',
    name: 'Feiticeiro',
    hitDie: 6,
    savingThrows: ['constitution', 'charisma'],
    subclassLevel: 1, // Origem de Feitiçaria
    spellcasting: { type: 'full', ability: 'charisma', learning: 'known' },
    features: NO_FEATURES,
    subclasses: NO_SUBCLASSES,
  },
];

const CLASS_BY_KEY: ReadonlyMap<string, ClassDefinition> = new Map(
  CLASS_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** Converte uma definição no resumo usado pelo seletor. */
export function toClassSummary(definition: ClassDefinition): ClassSummary {
  return {
    key: definition.key,
    name: definition.name,
    hitDie: definition.hitDie,
    subclassLevel: definition.subclassLevel,
    spellcastingType: definition.spellcasting.type,
  };
}

/** Catálogo resumido das 12 classes (para o seletor da ficha). */
export const CLASS_CATALOG: ClassSummary[] = CLASS_DEFINITIONS.map(toClassSummary);

/** Busca uma classe pela chave canônica. */
export function getClassDefinition(key: string): ClassDefinition | null {
  return CLASS_BY_KEY.get(key.trim()) ?? null;
}

/**
 * Força as salvaguardas com proficiência da classe, que são fixas e nunca
 * podem ser desmarcadas. As demais salvaguardas permanecem como estavam.
 */
export function applyClassSavingThrows(
  saves: Record<AbilityKey, boolean>,
  definition: ClassDefinition | null,
): Record<AbilityKey, boolean> {
  if (!definition) return saves;

  const next = { ...saves };
  for (const ability of definition.savingThrows) next[ability] = true;
  return next;
}

/** Rótulos do tipo de conjuração. */
export const SPELLCASTING_TYPE_LABELS: Record<SpellcastingType, string> = {
  none: 'Sem conjuração',
  full: 'Conjurador completo',
  half: 'Meio-conjurador',
  third: 'Terço-conjurador',
  pact: 'Magia de pacto',
};

/** Rótulos do modo de aprendizado de magias. */
export const SPELL_LEARNING_LABELS: Record<SpellLearning, string> = {
  known: 'Conhecidas',
  prepared: 'Preparadas',
  none: '—',
};
