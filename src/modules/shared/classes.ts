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
  type: 'bonus' | 'resource' | 'save' | 'expertise' | 'sneakAttack' | 'other';
  /** Alvo do bônus quando `type: 'bonus'` (ex.: 'armorClass', 'initiative', 'speed'). */
  target?: string;
  /** Valor do bônus (ou quantidade de espaços, em `type: 'expertise'`). */
  value?: number;
  /** Salvaguarda concedida quando `type: 'save'`. */
  ability?: AbilityKey;
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
  /**
   * Conjuração própria da subclasse, quando houver (ex.: Trapaceiro Arcano,
   * um terço-conjurador). Sobreponha-se à conjuração da classe.
   */
  spellcasting?: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
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

// ---------------------------------------------------------------------------
// Ladino (Rogue) — PHB 2014
// ---------------------------------------------------------------------------

const ROGUE_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'expertise',
    name: 'Perícia (Expertise)',
    level: 1,
    description:
      'Escolha duas proficiências (perícias ou ferramentas de ladrão). O bônus de proficiência é dobrado nas escolhidas.',
    effect: { type: 'expertise', value: 2 },
  },
  {
    id: 'sneak-attack',
    name: 'Ataque Furtivo',
    level: 1,
    description:
      'Uma vez por turno, cause dano extra de 1d6 quando atacar com vantagem usando uma arma sutil ou à distância, ou quando outro inimigo do alvo estiver a 1,5 m dele e você não tiver desvantagem no ataque. O dado cresce com o nível do ladino (1d6 no 1º, +1d6 a cada dois níveis ímpares).',
    effect: { type: 'sneakAttack' },
  },
  {
    id: 'cunning-action',
    name: 'Ação Ardilosa',
    level: 2,
    description:
      'A cada turno, use uma ação bônus para Disparada, Desengajar ou Esconder-se.',
  },
  {
    id: 'uncanny-dodge',
    name: 'Esquiva Ilesa',
    level: 5,
    description:
      'Usando sua reação, reduza à metade o dano de um ataque que a acertou.',
  },
  {
    id: 'expertise-improvement',
    name: 'Perícia Aprimorada',
    level: 6,
    description: 'Escolha mais duas proficiências para receber Expertise.',
    effect: { type: 'expertise', value: 2 },
  },
  {
    id: 'evasion',
    name: 'Evasão',
    level: 7,
    description:
      'Em testes de resistência de Destreza para sofrer metade do dano, você não sofre dano se passar e sofre apenas metade se falhar.',
  },
  {
    id: 'reliable-talent',
    name: 'Talento Confiável',
    level: 11,
    description:
      'Em testes de perícia com proficiência, resultados de d20 abaixo de 10 contam como 10.',
  },
  {
    id: 'blindsense',
    name: 'Sentido Cego',
    level: 14,
    description:
      'Se não puder ver, você percebe criaturas escondidas a até 3 metros (10 pés) de você.',
  },
  {
    id: 'slippery-mind',
    name: 'Mente Escorregadia',
    level: 15,
    description: 'Você ganha proficiência em testes de resistência de Sabedoria.',
    effect: { type: 'save', ability: 'wisdom' },
  },
  {
    id: 'elusive',
    name: 'Elusivo',
    level: 18,
    description:
      'Enquanto não estiver incapacitado, nenhum ataque tem vantagem contra você.',
  },
  {
    id: 'stroke-of-luck',
    name: 'Golpe de Sorte',
    level: 20,
    description:
      'Uma vez por descanso curto ou longo, transforme o resultado de um teste de d20 (seu) em sucesso, ou o ataque de um inimigo contra você em erro.',
    effect: { type: 'resource', resource: { name: 'Golpe de Sorte', max: 1, recharge: 'short' } },
  },
];

const ROGUE_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'thief',
    name: 'Ladrão',
    description: 'Ágil e sorrateiro, mestre em furtos, escalada e dispositivos.',
    features: [
      {
        id: 'fast-hands',
        name: 'Mãos Rápidas',
        level: 3,
        description:
          'Use a ação bônus para realizar Prestidigitação, abrir fechaduras, desarmar armadilhas ou usar um objeto.',
      },
      {
        id: 'second-story-work',
        name: 'Trabalho de Segundo Andar',
        level: 3,
        description:
          'Escalar não custa movimento extra e seu salto em distância com corrida aumenta em 30 cm por ponto de proficiência.',
      },
      {
        id: 'supreme-sneak',
        name: 'Sorrateiro Supremo',
        level: 9,
        description:
          'Você tem vantagem em Furtividade se mover no máximo metade do seu deslocamento no mesmo turno.',
      },
      {
        id: 'use-magic-device',
        name: 'Uso de Dispositivos Mágicos',
        level: 13,
        description:
          'Você ignora requisitos de classe, raça e nível para usar ou sintonizar itens mágicos.',
      },
      {
        id: 'thiefs-reflexes',
        name: 'Reflexos de Ladrão',
        level: 17,
        description:
          'Na primeira rodada de combate você age duas vezes: na sua iniciativa e na sua iniciativa menos 10.',
      },
    ],
  },
  {
    id: 'assassin',
    name: 'Assassino',
    description: 'Especialista em disfarces, venenos e golpes mortais contra alvos desprevenidos.',
    features: [
      {
        id: 'assassin-tools',
        name: 'Ferramentas do Ofício',
        level: 3,
        description: 'Você ganha proficiência com um kit de disfarce e um kit de veneno.',
      },
      {
        id: 'assassinate',
        name: 'Assassinar',
        level: 3,
        description:
          'Você tem vantagem em ataques contra qualquer criatura que ainda não tenha agido no combate. Qualquer acerto contra uma criatura surpreendida é um crítico.',
      },
      {
        id: 'infiltration-expertise',
        name: 'Especialista em Infiltração',
        level: 9,
        description:
          'Você cria identidades falsas com proficiência, capaz de falsificar documentos e se passar por outra pessoa.',
      },
      {
        id: 'impostor',
        name: 'Impostor',
        level: 13,
        description:
          'Você imita com perfeição a fala, a escrita e o comportamento de outra pessoa após observá-la por ao menos 1 hora.',
      },
      {
        id: 'death-strike',
        name: 'Golpe Mortal',
        level: 17,
        description:
          'Quando você acerta uma criatura surpreendida, ela deve passar num teste de resistência de Constituição (CD = 8 + proficiência + mod. de Destreza); se falhar, sofre o dobro do dano do ataque.',
      },
    ],
  },
  {
    id: 'arcane-trickster',
    name: 'Trapaceiro Arcano',
    description:
      'Ladino que complementa a furtividade com magias de ilusão e encantamento (terço-conjurador de Inteligência).',
    spellcasting: { type: 'third', ability: 'intelligence', learning: 'known' },
    features: [
      {
        id: 'mage-hand-legerdemain',
        name: 'Mão Mágica Ardilosa',
        level: 3,
        description:
          'Você aprende Mage Hand. Ao lançá-la com Ação Ardilosa, a mão fica invisível e você pode comandá-la à distância.',
      },
      {
        id: 'magical-ambush',
        name: 'Emboscada Mágica',
        level: 9,
        description:
          'Se estiver escondido de uma criatura e lançar sobre ela uma magia de ilusão ou encantamento, ela tem desvantagem no teste de resistência.',
      },
      {
        id: 'versatile-trickster',
        name: 'Trapaceiro Versátil',
        level: 13,
        description:
          'Com uma Mage Hand, você dá vantagem no seu ataque furtivo contra o alvo da mão.',
      },
      {
        id: 'spell-thief',
        name: 'Ladrão de Magias',
        level: 17,
        description:
          'Quando uma criatura lança uma magia contra você, você pode tentar roubá-la (reação) e, passando na resistência, conhece e pode lançar essa magia.',
      },
    ],
  },
];

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
    features: ROGUE_FEATURES,
    subclasses: ROGUE_SUBCLASSES,
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

/** Busca a subclasse pelo nome ou pelo id. */
export function findSubclass(
  definition: ClassDefinition | null,
  subclass: string,
): SubclassDefinition | null {
  if (!definition || !subclass) return null;
  const key = subclass.trim();
  return definition.subclasses.find((item) => item.id === key || item.name === key) ?? null;
}

/** Uma feature já liberada para o personagem (classe ou subclasse). */
export interface ActiveClassFeature extends ClassFeatureDefinition {
  source: 'class' | 'subclass';
  /** Nome da subclasse, quando vier dela. */
  subclassName?: string;
}

/**
 * Features efetivamente disponíveis: as da classe até o nível atual e, quando
 * houver subclasse escolhida, as dela até o nível atual.
 */
export function getActiveClassFeatures(
  definition: ClassDefinition | null,
  level: number,
  subclass: string,
): ActiveClassFeature[] {
  if (!definition) return [];

  const fromClass: ActiveClassFeature[] = definition.features
    .filter((feature) => feature.level <= level)
    .map((feature) => ({ ...feature, source: 'class' }));

  const subclassDefinition = findSubclass(definition, subclass);
  const fromSubclass: ActiveClassFeature[] = subclassDefinition
    ? subclassDefinition.features
        .filter((feature) => feature.level <= level)
        .map((feature) => ({
          ...feature,
          source: 'subclass' as const,
          subclassName: subclassDefinition.name,
        }))
    : [];

  return [...fromClass, ...fromSubclass].sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name),
  );
}

/** Dados de Ataque Furtivo do ladino: 1d6 no nível 1 e +1d6 a cada 2 níveis. */
export function sneakAttackDice(level: number): number {
  return Math.max(1, Math.ceil(level / 2));
}

/** Total de espaços de Expertise concedidos pelas features ativas. */
export function expertiseSlots(features: ActiveClassFeature[]): number {
  return features.reduce(
    (sum, feature) =>
      sum + (feature.effect?.type === 'expertise' ? (feature.effect.value ?? 0) : 0),
    0,
  );
}

/**
 * Força as salvaguardas com proficiência da classe, que são fixas e nunca
 * podem ser desmarcadas. As demais salvaguardas permanecem como estavam.
 */
export function applySaveProficiencies(
  saves: Record<AbilityKey, boolean>,
  abilities: readonly AbilityKey[],
): Record<AbilityKey, boolean> {
  const next = { ...saves };
  for (const ability of abilities) next[ability] = true;
  return next;
}

export function applyClassSavingThrows(
  saves: Record<AbilityKey, boolean>,
  definition: ClassDefinition | null,
): Record<AbilityKey, boolean> {
  if (!definition) return saves;
  return applySaveProficiencies(saves, definition.savingThrows);
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
