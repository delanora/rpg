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
  recharge: 'short' | 'long' | 'none';
  /** Máximo fixo (quando não varia com o nível). */
  max?: number;
  /** Máximo por nível: usa o maior nível menor ou igual ao atual. -1 = ilimitado. */
  maxByLevel?: { level: number; value: number }[];
}

/**
 * Efeito mecânico opcional de uma característica. É a ponte entre o texto da
 * característica e a aplicação automática na ficha (bônus numérico, recurso
 * com contador etc.). Preenchido junto com as features de cada classe.
 */
export interface ClassFeatureEffect {
  type:
    | 'bonus'
    | 'resource'
    | 'save'
    | 'expertise'
    | 'sneakAttack'
    | 'toggle'
    | 'resistance'
    | 'speed'
    | 'damageBonus'
    | 'critDice'
    | 'unarmoredDefense'
    | 'abilityBonus'
    | 'other';
  /** Identificador do toggle/recurso (ex.: 'rage'). Vazio = id da feature. */
  id?: string;
  /** Rótulo do toggle (ex.: 'Fúria'). */
  name?: string;
  /** Alvo do bônus quando `type: 'bonus'`. */
  target?: string;
  /** Valor fixo (ou espaços, em `type: 'expertise'`). */
  value?: number;
  /** Valor escalonado por nível: usa o maior nível menor ou igual ao atual. */
  scaling?: { level: number; value: number }[];
  /** Atributo concedido/afetado (`save`, `abilityBonus`). */
  ability?: AbilityKey;
  /** Teto do atributo em `abilityBonus` (ex.: 24 no Campeão Primitivo). */
  max?: number;
  /** Tipos de dano resistidos em `type: 'resistance'`. */
  damageTypes?: string[];
  /** Recurso com contador em `type: 'resource'`. */
  resource?: ClassFeatureResource;
  /** Só vale enquanto o toggle com este id estiver ativo (ex.: efeitos da Fúria). */
  requiresActive?: string;
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
  /** Efeito mecânico vinculado, quando houver (features simples). */
  effect?: ClassFeatureEffect;
  /** Efeitos múltiplos (ex.: Fúria tem toggle, recurso, bônus e resistência). */
  effects?: ClassFeatureEffect[];
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

// ---------------------------------------------------------------------------
// Bárbaro (Barbarian) — PHB 2014
// ---------------------------------------------------------------------------

const BARBARIAN_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'rage',
    name: 'Fúria',
    level: 1,
    description:
      'Ação bônus para entrar em fúria por 1 minuto (ou até não atacar nem sofrer dano por 1 turno). Em fúria: vantagem em testes e salvaguardas de Força; bônus de dano corpo a corpo com Força (+2 até o 8º nível, +3 do 9º ao 15º, +4 do 16º ao 20º); resistência a dano contundente, perfurante e cortante. Usos por descanso longo: 2 (níveis 1-2), 3 (3-5), 4 (6-11), 5 (12-16), 6 (17-19) e ilimitado (20).',
    effects: [
      { type: 'toggle', id: 'rage', name: 'Fúria' },
      {
        type: 'resource',
        id: 'rage',
        name: 'Fúria',
        resource: {
          name: 'Fúria',
          recharge: 'long',
          maxByLevel: [
            { level: 1, value: 2 },
            { level: 3, value: 3 },
            { level: 6, value: 4 },
            { level: 12, value: 5 },
            { level: 17, value: 6 },
            { level: 20, value: -1 },
          ],
        },
      },
      {
        type: 'damageBonus',
        id: 'rage',
        name: 'Bônus de Fúria',
        requiresActive: 'rage',
        scaling: [
          { level: 1, value: 2 },
          { level: 9, value: 3 },
          { level: 16, value: 4 },
        ],
      },
      {
        type: 'resistance',
        id: 'rage',
        requiresActive: 'rage',
        damageTypes: ['Concussão', 'Perfurante', 'Cortante'],
      },
    ],
  },
  {
    id: 'unarmored-defense',
    name: 'Defesa sem Armadura',
    level: 1,
    description:
      'Enquanto não usar armadura, sua CA é 10 + mod. de Destreza + mod. de Constituição. Funciona com escudo.',
    effect: { type: 'unarmoredDefense' },
  },
  {
    id: 'reckless-attack',
    name: 'Ataque Descuidado',
    level: 2,
    description:
      'Você pode atacar de forma descuidada: ganha vantagem em ataques corpo a corpo com Força neste turno, mas ataques contra você têm vantagem até o seu próximo turno.',
    effect: { type: 'toggle', id: 'reckless-attack', name: 'Ataque Descuidado' },
  },
  {
    id: 'danger-sense',
    name: 'Senso de Perigo',
    level: 2,
    description:
      'Você tem vantagem em testes de resistência de Destreza contra efeitos que possa ver (como armadilhas e magias).',
  },
  {
    id: 'extra-attack',
    name: 'Ataque Extra',
    level: 5,
    description: 'Ao usar a ação de Ataque, você ataca duas vezes em vez de uma.',
  },
  {
    id: 'fast-movement',
    name: 'Movimento Rápido',
    level: 5,
    description:
      'Seu deslocamento aumenta em 3 metros (10 pés) enquanto você não usar armadura pesada.',
    effect: { type: 'speed', value: 10 },
  },
  {
    id: 'feral-instinct',
    name: 'Instinto Selvagem',
    level: 7,
    description:
      'Você tem vantagem em rolagens de iniciativa e não pode ser surpreendido enquanto estiver consciente — a menos que esteja incapacitado.',
  },
  {
    id: 'brutal-critical',
    name: 'Crítico Brutal',
    level: 9,
    description:
      'Em um acerto crítico com arma corpo a corpo, role um dado de dano extra da arma (+2 dados no 13º nível, +3 no 17º).',
    effect: {
      type: 'critDice',
      scaling: [
        { level: 9, value: 1 },
        { level: 13, value: 2 },
        { level: 17, value: 3 },
      ],
    },
  },
  {
    id: 'relentless-rage',
    name: 'Fúria Implacável',
    level: 11,
    description:
      'Se cair a 0 PV em fúria sem morrer imediatamente, faça um teste de resistência de Constituição CD 10 para ficar com 1 PV. A CD aumenta em 5 a cada uso antes de um descanso.',
  },
  {
    id: 'persistent-rage',
    name: 'Fúria Persistente',
    level: 15,
    description:
      'Sua fúria só termina quando você ficar inconsciente ou escolher encerrá-la (não precisa atacar nem sofrer dano a cada turno).',
  },
  {
    id: 'indomitable-might',
    name: 'Poder Indomável',
    level: 18,
    description:
      'Se o total de um teste de Força for menor que sua pontuação de Força, você pode usar a própria pontuação.',
  },
  {
    id: 'primal-champion',
    name: 'Campeão Primitivo',
    level: 20,
    description: 'Sua Força e Constituição aumentam em 4, até o máximo de 24.',
    effects: [
      { type: 'abilityBonus', ability: 'strength', value: 4, max: 24 },
      { type: 'abilityBonus', ability: 'constitution', value: 4, max: 24 },
    ],
  },
];

const BARBARIAN_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'berserker',
    name: 'Guerreiro Primitivo',
    description: 'Bárbaro que transforma a fúria em violência pura.',
    features: [
      {
        id: 'frenzy',
        name: 'Frenesi',
        level: 3,
        description:
          'Enquanto estiver em fúria, você pode usar uma ação bônus a cada turno para fazer um ataque corpo a corpo com arma. Ao término da fúria, sofre um nível de exaustão.',
      },
      {
        id: 'mindless-rage',
        name: 'Fúria Insensata',
        level: 6,
        description:
          'Não pode ser enfeitiçado nem amedrontado enquanto estiver em fúria. Se já estiver sob esse efeito ao entrar em fúria, ele é suspenso durante a fúria.',
      },
      {
        id: 'intimidating-presence',
        name: 'Presença Intimidante',
        level: 10,
        description:
          'Como ação, assuste uma criatura a até 9 m (30 pés) que possa ver ou ouvir você; se ela falhar num teste de resistência de Sabedoria, fica amedrontada por 1 minuto.',
      },
      {
        id: 'retaliation',
        name: 'Retaliação',
        level: 14,
        description:
          'Quando sofrer dano de uma criatura a até 1,5 m (5 pés), use sua reação para fazer um ataque corpo a corpo com arma contra ela.',
      },
    ],
  },
  {
    id: 'totem-warrior',
    name: 'Guerreiro Totêmico',
    description:
      'Bárbaro que trilha a comunhão com um Espírito Totêmico (Urso, Águia ou Lobo).',
    features: [
      {
        id: 'totem-spirit',
        name: 'Espírito Totêmico',
        level: 3,
        description:
          'Escolha um totem em fúria: Urso (resistência a todo dano exceto psíquico), Águia (Desengajar como ação bônus e ataques de oportunidade contra você têm desvantagem) ou Lobo (aliados têm vantagem contra inimigos a até 1,5 m de você).',
      },
      {
        id: 'aspect-of-the-beast',
        name: 'Aspecto da Fera',
        level: 6,
        description:
          'Ganha um benefício passivo conforme o totem: Urso (capacidade de carga dobrada), Águia (enxerga a até 1,6 km) ou Lobo (rastreia a passo rápido sem dificuldade).',
      },
      {
        id: 'spirit-walker',
        name: 'Andarilho Espiritual',
        level: 10,
        description:
          'Você pode lançar Fala com Animais e Sentido Feral como rituais, comunicando-se com os espíritos da natureza.',
      },
      {
        id: 'totemic-attunement',
        name: 'Sintonia Totêmica',
        level: 14,
        description:
          'Em fúria, ganha um efeito adicional do totem: Urso (inimigos a até 1,5 m têm desvantagem em ataques contra outros alvos), Águia (deslocamento de voo igual ao de caminhada) ou Lobo (derruba criaturas Grandes ou menores que você acertar).',
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
    features: BARBARIAN_FEATURES,
    subclasses: BARBARIAN_SUBCLASSES,
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

/** Efeitos de uma feature, aceitando tanto `effect` quanto `effects`. */
export function featureEffectsOf(feature: ClassFeatureDefinition): ClassFeatureEffect[] {
  if (feature.effects && feature.effects.length > 0) return feature.effects;
  return feature.effect ? [feature.effect] : [];
}

/** Valor escalonado por nível: usa o maior nível menor ou igual ao atual. */
export function effectValueAtLevel(
  effect: ClassFeatureEffect,
  level: number,
): number | null {
  if (effect.scaling && effect.scaling.length > 0) {
    const sorted = [...effect.scaling].sort((a, b) => a.level - b.level);
    let value: number | null = null;
    for (const step of sorted) if (step.level <= level) value = step.value;
    return value;
  }
  return effect.value ?? null;
}

/** Máximo de um recurso no nível atual (-1 = ilimitado). */
export function resourceMaxAtLevel(
  resource: ClassFeatureResource,
  level: number,
): number {
  if (resource.maxByLevel && resource.maxByLevel.length > 0) {
    const sorted = [...resource.maxByLevel].sort((a, b) => a.level - b.level);
    let value = sorted[0]?.value ?? 0;
    for (const step of sorted) if (step.level <= level) value = step.value;
    return value;
  }
  return resource.max ?? 0;
}

/** Total de espaços de Expertise concedidos pelas features ativas. */
export function expertiseSlots(features: ActiveClassFeature[]): number {
  return features.reduce(
    (sum, feature) =>
      sum +
      featureEffectsOf(feature).reduce(
        (inner, effect) => inner + (effect.type === 'expertise' ? (effect.value ?? 0) : 0),
        0,
      ),
    0,
  );
}

/** Estado de runtime da classe (toggles ativos e usos gastos). */
export interface ClassState {
  active: string[];
  used: Record<string, number>;
}

/** Lê/normaliza o estado de classe vindo do JSONB. */
export function normalizeClassState(input: unknown): ClassState {
  const source = (input ?? {}) as { active?: unknown; used?: unknown };

  const active = Array.isArray(source.active)
    ? source.active.filter((item): item is string => typeof item === 'string')
    : [];

  const used: Record<string, number> = {};
  if (source.used && typeof source.used === 'object') {
    for (const [key, value] of Object.entries(source.used as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        used[key] = Math.floor(value);
      }
    }
  }

  return { active, used };
}

/** Um toggle ativável (ex.: Fúria, Ataque Descuidado). */
export interface ActiveToggle {
  id: string;
  name: string;
  active: boolean;
  /** Recurso consumido ao ativar (ex.: 'rage'); nulo quando não há custo. */
  resourceId: string | null;
}

/** Um recurso com contador (ex.: usos de Fúria por descanso longo). */
export interface ActiveResource {
  id: string;
  name: string;
  recharge: 'short' | 'long' | 'none';
  max: number;
  used: number;
  remaining: number;
  unlimited: boolean;
}

/** Ajustes calculados a partir das features ativas e do estado de classe. */
export interface ClassAdjustments {
  toggles: ActiveToggle[];
  resources: ActiveResource[];
  activeToggleIds: string[];
  /** Bônus de dano corpo a corpo enquanto os toggles exigidos estiverem ativos. */
  meleeDamageBonus: number;
  /** Tipos de dano resistidos (ex.: contundente/perfurante/cortante em fúria). */
  resistances: string[];
  /** Bônus de deslocamento passivo (ex.: Movimento Rápido). */
  speedBonus: number;
  /** Dados de dano extras em críticos (ex.: Crítico Brutal). */
  critExtraDice: number;
  unarmoredDefense: boolean;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  abilityCaps: Partial<Record<AbilityKey, number>>;
}

/**
 * Reúne os ajustes mecânicos das features ativas: toggles, recursos, bônus de
 * dano, resistências, deslocamento, dados de crítico e bônus de atributo.
 */
export function computeClassAdjustments(
  features: ActiveClassFeature[],
  level: number,
  state: ClassState,
): ClassAdjustments {
  const activeSet = new Set(state.active);
  const toggles: ActiveToggle[] = [];
  const resources: ActiveResource[] = [];
  let meleeDamageBonus = 0;
  const resistances = new Set<string>();
  let speedBonus = 0;
  let critExtraDice = 0;
  let unarmoredDefense = false;
  const abilityBonuses: Partial<Record<AbilityKey, number>> = {};
  const abilityCaps: Partial<Record<AbilityKey, number>> = {};

  for (const feature of features) {
    for (const effect of featureEffectsOf(feature)) {
      const effectId = effect.id ?? feature.id;

      switch (effect.type) {
        case 'toggle':
          toggles.push({ id: effectId, name: effect.name ?? feature.name, active: activeSet.has(effectId), resourceId: null });
          break;
        case 'resource': {
          const resource = effect.resource;
          if (!resource) break;
          const max = resourceMaxAtLevel(resource, level);
          const used = Math.max(0, state.used[effectId] ?? 0);
          resources.push({
            id: effectId,
            name: effect.name ?? resource.name,
            recharge: resource.recharge,
            max,
            used,
            remaining: max < 0 ? -1 : Math.max(0, max - used),
            unlimited: max < 0,
          });
          break;
        }
        case 'damageBonus':
          if (effect.requiresActive && !activeSet.has(effect.requiresActive)) break;
          meleeDamageBonus += effectValueAtLevel(effect, level) ?? 0;
          break;
        case 'resistance':
          if (effect.requiresActive && !activeSet.has(effect.requiresActive)) break;
          for (const type of effect.damageTypes ?? []) resistances.add(type);
          break;
        case 'speed':
          speedBonus += effect.value ?? 0;
          break;
        case 'critDice':
          critExtraDice = Math.max(critExtraDice, effectValueAtLevel(effect, level) ?? 0);
          break;
        case 'unarmoredDefense':
          unarmoredDefense = true;
          break;
        case 'abilityBonus': {
          const ability = effect.ability;
          if (!ability) break;
          abilityBonuses[ability] = (abilityBonuses[ability] ?? 0) + (effect.value ?? 0);
          if (effect.max !== undefined) abilityCaps[ability] = effect.max;
          break;
        }
        default:
          break;
      }
    }
  }

  // Liga cada toggle ao recurso de mesmo id (ex.: Fúria tem usos).
  const resourceIds = new Set(resources.map((resource) => resource.id));
  for (const toggle of toggles) {
    toggle.resourceId = resourceIds.has(toggle.id) ? toggle.id : null;
  }

  return {
    toggles,
    resources,
    activeToggleIds: toggles.filter((toggle) => toggle.active).map((toggle) => toggle.id),
    meleeDamageBonus,
    resistances: [...resistances],
    speedBonus,
    critExtraDice,
    unarmoredDefense,
    abilityBonuses,
    abilityCaps,
  };
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
