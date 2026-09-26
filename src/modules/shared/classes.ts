import { abilityModifier, type AbilityKey } from './dnd5e.js';

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
  /** Máximo igual ao nível do personagem (ex.: pontos de Ki do monge). */
  perLevel?: boolean;
  /** Multiplicador do máximo por nível quando `perLevel` (padrão 1; Couraça Arcana usa 2). */
  perLevelMultiplier?: number;
  /** Somado ao máximo o modificador deste atributo (ex.: Couraça Arcana usa INT). */
  abilityMod?: AbilityKey;
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
    | 'martialArts'
    | 'wildShape'
    | 'hpBonus'
    | 'abilityBonus'
    | 'other';
  /** Identificador do toggle/recurso (ex.: 'rage'). Vazio = id da feature. */
  id?: string;
  /** Recurso consumido pelo toggle (ex.: 'ki'); vazio = recurso de mesmo id. */
  resourceId?: string;
  /** Valor base em `type: 'unarmoredDefense'` (padrão 10; Linhagem Dracônica usa 13). */
  base?: number;
  /** Multiplica o valor pelo nível do personagem (ex.: +1 PV por nível). */
  perLevel?: boolean;
  /** Substitui efeitos anteriores do mesmo tipo (ex.: CR da Forma Selvagem do Círculo da Lua). */
  override?: boolean;
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
  /** Atributo somado na Defesa sem Armadura (Bárbaro: CON; Monge: SAB). */
  unarmoredDefenseAbility?: AbilityKey;
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
    effect: { type: 'unarmoredDefense', unarmoredDefenseAbility: 'constitution' },
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

// ---------------------------------------------------------------------------
// Monge (Monk) — PHB 2014
// ---------------------------------------------------------------------------

const MONK_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'unarmored-defense',
    name: 'Defesa sem Armadura',
    level: 1,
    description:
      'Enquanto não usar armadura nem escudo, sua CA é 10 + mod. de Destreza + mod. de Sabedoria.',
    effect: { type: 'unarmoredDefense', unarmoredDefenseAbility: 'wisdom' },
  },
  {
    id: 'martial-arts',
    name: 'Artes Marciais',
    level: 1,
    description:
      'Você pode usar Destreza em vez de Força nas jogadas de ataque e dano de ataques desarmados e armas de monge (clava, bordão, adaga, machadinha, azagaia, maça, cimitarra e funda). O dado de dano desarmado escala com o nível: 1d4 (níveis 1-4), 1d6 (5-10), 1d8 (11-16) e 1d10 (17-20). Ao usar a ação de Ataque com ataque desarmado ou arma de monge, você pode fazer um ataque desarmado como ação bônus.',
    effect: {
      type: 'martialArts',
      scaling: [
        { level: 1, value: 4 },
        { level: 5, value: 6 },
        { level: 11, value: 8 },
        { level: 17, value: 10 },
      ],
    },
  },
  {
    id: 'ki',
    name: 'Ki',
    level: 2,
    description:
      'Você ganha um número de pontos de ki igual ao seu nível de monge. Pode gastá-los para usar as características abaixo. A CD de salvaguarda de ki é 8 + bônus de proficiência + mod. de Sabedoria.',
    effect: {
      type: 'resource',
      id: 'ki',
      name: 'Ki',
      resource: { name: 'Ki', recharge: 'short', perLevel: true },
    },
  },
  {
    id: 'flurry-of-blows',
    name: 'Rajada de Golpes',
    level: 2,
    description:
      'Gaste 1 ponto de ki para fazer dois ataques desarmados adicionais como ação bônus.',
    effect: { type: 'toggle', id: 'flurry-of-blows', name: 'Rajada de Golpes (1 ki)', resourceId: 'ki' },
  },
  {
    id: 'patient-defense',
    name: 'Defesa Paciente',
    level: 2,
    description: 'Gaste 1 ponto de ki para usar a ação Esquivar como ação bônus.',
    effect: { type: 'toggle', id: 'patient-defense', name: 'Defesa Paciente (1 ki)', resourceId: 'ki' },
  },
  {
    id: 'step-of-the-wind',
    name: 'Passo de Vento',
    level: 2,
    description:
      'Gaste 1 ponto de ki para usar Disparada ou Desengajar como ação bônus; neste turno seu salto em distância é dobrado.',
    effect: { type: 'toggle', id: 'step-of-the-wind', name: 'Passo de Vento (1 ki)', resourceId: 'ki' },
  },
  {
    id: 'unarmored-movement',
    name: 'Movimento sem Armadura',
    level: 2,
    description:
      'Seu deslocamento aumenta enquanto você não usar armadura nem escudo: +3 m (10 pés) no 2º nível, +4,5 m (15) no 6º, +6 m (20) no 10º, +7,5 m (25) no 14º e +9 m (30) no 18º.',
    effect: {
      type: 'speed',
      scaling: [
        { level: 2, value: 10 },
        { level: 6, value: 15 },
        { level: 10, value: 20 },
        { level: 14, value: 25 },
        { level: 18, value: 30 },
      ],
    },
  },
  {
    id: 'deflect-missiles',
    name: 'Defletir Mísseis',
    level: 3,
    description:
      'Usando sua reação, reduza o dano de um ataque à distância em 1d10 + mod. de Destreza + nível de monge. Se o dano for reduzido a 0 e o projétil for pequeno o bastante para segurar, gaste 1 ponto de ki para arremessá-lo de volta (ataque à distância com proficiência e dado de Artes Marciais).',
  },
  {
    id: 'slow-fall',
    name: 'Queda Suave',
    level: 4,
    description: 'Usando sua reação, reduza o dano de queda em 5 × nível de monge.',
  },
  {
    id: 'extra-attack',
    name: 'Ataque Extra',
    level: 5,
    description: 'Ao usar a ação de Ataque, você ataca duas vezes em vez de uma.',
  },
  {
    id: 'stunning-strike',
    name: 'Golpe Atordoante',
    level: 5,
    description:
      'Ao acertar um ataque corpo a corpo, gaste 1 ponto de ki para forçar o alvo a um teste de resistência de Constituição; se falhar, fica atordoado até o fim do seu próximo turno.',
    effect: { type: 'toggle', id: 'stunning-strike', name: 'Golpe Atordoante (1 ki)', resourceId: 'ki' },
  },
  {
    id: 'ki-empowered-strikes',
    name: 'Golpes Imbuídos de Ki',
    level: 6,
    description:
      'Seus ataques desarmados contam como mágicos para superar resistência e imunidade a dano não mágico.',
  },
  {
    id: 'evasion',
    name: 'Evasão',
    level: 7,
    description:
      'Em testes de resistência de Destreza para sofrer metade do dano, você não sofre dano se passar e sofre apenas metade se falhar.',
  },
  {
    id: 'stillness-of-mind',
    name: 'Serenidade Mental',
    level: 7,
    description:
      'Como ação, você encerra em si mesmo um efeito que o deixa enfeitiçado ou amedrontado.',
  },
  {
    id: 'purity-of-body',
    name: 'Pureza do Corpo',
    level: 9,
    description: 'Você é imune a doenças e veneno.',
  },
  {
    id: 'tongue-of-sun-and-moon',
    name: 'Língua do Sol e da Lua',
    level: 13,
    description:
      'Você compreende todos os idiomas falados e, se tocar uma criatura consciente, ela compreende o que você diz.',
  },
  {
    id: 'diamond-soul',
    name: 'Alma de Diamante',
    level: 14,
    description:
      'Você ganha proficiência em todas as salvaguardas. Além disso, quando falhar num teste de resistência, pode gastar 1 ponto de ki para rolá-lo novamente e usar o novo resultado.',
    effects: [
      { type: 'save', ability: 'strength' },
      { type: 'save', ability: 'dexterity' },
      { type: 'save', ability: 'constitution' },
      { type: 'save', ability: 'intelligence' },
      { type: 'save', ability: 'wisdom' },
      { type: 'save', ability: 'charisma' },
      {
        type: 'toggle',
        id: 'diamond-soul-reroll',
        name: 'Alma de Diamante — rerrolar (1 ki)',
        resourceId: 'ki',
      },
    ],
  },
  {
    id: 'timeless-body',
    name: 'Corpo Atemporal',
    level: 15,
    description:
      'Você não envelhece nem sofre os efeitos da idade, e não precisa comer nem beber.',
  },
  {
    id: 'empty-body',
    name: 'Corpo Vazio',
    level: 18,
    description:
      'Como ação, gaste 4 pontos de ki para ficar invisível por 1 minuto (nesse estado você tem resistência a todo dano exceto de força). Gaste 8 pontos de ki para usar projeção astral sem componentes materiais.',
    effect: {
      type: 'toggle',
      id: 'empty-body-invisibility',
      name: 'Corpo Vazio — invisível (4 ki)',
      resourceId: 'ki',
    },
  },
  {
    id: 'perfect-self',
    name: 'Eu Perfeito',
    level: 20,
    description:
      'Se você começar seu turno com 0 pontos de ki, recupera 4 pontos de ki.',
  },
];

const MONK_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'open-hand',
    name: 'Caminho da Mão Aberta',
    description:
      'Tradição que trata o corpo como arma e manipula o ki do adversário, empurrando, derrubando e paralisando.',
    features: [
      {
        id: 'open-hand-technique',
        name: 'Técnica da Mão Aberta',
        level: 3,
        description:
          'Ao usar Golpe Atordoante ou acertar dois ataques desarmados no mesmo turno, escolha um efeito: derrubar o alvo, empurrá-lo 4,5 m (15 pés) ou impedi-lo de usar reações até o início do seu próximo turno.',
      },
      {
        id: 'wholeness-of-body',
        name: 'Totalidade do Corpo',
        level: 6,
        description:
          'Como ação, recupere 3 × nível de monge de pontos de vida. Uma vez por descanso longo.',
        effects: [
          {
            type: 'resource',
            id: 'wholeness-of-body',
            name: 'Totalidade do Corpo',
            resource: { name: 'Totalidade do Corpo', max: 1, recharge: 'long' },
          },
          {
            type: 'toggle',
            id: 'wholeness-of-body',
            name: 'Totalidade do Corpo',
            resourceId: 'wholeness-of-body',
          },
        ],
      },
      {
        id: 'tranquility',
        name: 'Tranquilidade',
        level: 11,
        description:
          'Ao terminar um descanso longo, você ganha o efeito da magia Santuário (CD = CD de ki) até o início do seu próximo descanso longo.',
      },
      {
        id: 'quivering-palm',
        name: 'Palma Trêmula',
        level: 17,
        description:
          'Gaste 3 pontos de ki para implantar vibrações mortais ao acertar um ataque desarmado. Depois, com uma ação, você força o alvo a um teste de resistência de Constituição; se falhar, morre após 1d4 dias (ou imediatamente, se você gastar 3 pontos de ki ao ativar).',
        effect: { type: 'toggle', id: 'quivering-palm', name: 'Palma Trêmula (3 ki)', resourceId: 'ki' },
      },
    ],
  },
  {
    id: 'shadow',
    name: 'Caminho da Sombra',
    description:
      'Monge que trilha as artes das sombras, combinando furtividade, ilusões e teleporte entre sombras.',
    features: [
      {
        id: 'shadow-arts',
        name: 'Artes das Sombras',
        level: 3,
        description:
          'Gaste 2 pontos de ki para lançar Escuridão, Silêncio, Disfarce Menor ou Ilusão Menor, sem componentes materiais.',
        effect: { type: 'toggle', id: 'shadow-arts', name: 'Artes das Sombras (2 ki)', resourceId: 'ki' },
      },
      {
        id: 'shadow-step',
        name: 'Passo na Sombra',
        level: 6,
        description:
          'Como ação bônus, quando estiver em luz baixa ou escuridão, teleporte-se a até 18 m (60 pés) para um espaço desocupado também em luz baixa ou escuridão. Você tem vantagem no próximo ataque corpo a corpo antes do fim do turno.',
      },
      {
        id: 'cloak-of-shadows',
        name: 'Manto de Sombras',
        level: 11,
        description:
          'Como ação, quando estiver em luz baixa ou escuridão, torne-se invisível até usar um ataque, lançar uma magia ou sair da área.',
      },
      {
        id: 'opportunist',
        name: 'Oportunista',
        level: 17,
        description:
          'Usando sua reação, faça um ataque corpo a corpo contra uma criatura a até 1,5 m (5 pés) que tenha sofrido dano de outra fonte.',
      },
    ],
  },
  {
    id: 'four-elements',
    name: 'Caminho dos Quatro Elementos',
    description:
      'Monge que canaliza o ki para controlar os elementos, aprendendo disciplinas elementais que gastam ki como magias.',
    features: [
      {
        id: 'elemental-discipline-3',
        name: 'Discípulo dos Elementos',
        level: 3,
        description:
          'Você aprende disciplinas elementais que gastam ki (CD = CD de ki): Elemental Attunement (controle elemental), Fangs of the Fire Snake (1 ki), Fist of Four Thunders (2 ki), Fist of Unbroken Air (2 ki), Rush of the Gale Spirits (2 ki), Shape the Flowing River (1 ki), Sweeping Cinder Strike (1 ki) e Water Whip (2 ki).',
        effect: {
          type: 'toggle',
          id: 'elemental-discipline-3',
          name: 'Disciplina Elemental (ki)',
          resourceId: 'ki',
        },
      },
      {
        id: 'elemental-discipline-6',
        name: 'Disciplina Elemental (6º nível)',
        level: 6,
        description:
          'Você aprende disciplinas elementais adicionais que gastam ki (CD = CD de ki): Clench of the North Wind (3 ki) e Gong of the Summit (3 ki).',
      },
      {
        id: 'elemental-discipline-11',
        name: 'Disciplina Elemental (11º nível)',
        level: 11,
        description:
          'Você aprende mais disciplinas elementais que gastam ki (CD = CD de ki): Eternal Mountain Defense (4 ki), Flames of the Phoenix (4 ki), Mist Stance (4 ki) e Ride the Wind (4 ki).',
      },
      {
        id: 'elemental-discipline-17',
        name: 'Disciplina Elemental (17º nível)',
        level: 17,
        description:
          'Você aprende as disciplinas elementais mais poderosas (CD = CD de ki): River of Hungry Flame (5 ki) e Wave of Rolling Earth (5 ki).',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Druida (Druid) — PHB 2014
// ---------------------------------------------------------------------------

const DRUID_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'druidic',
    name: 'Druídico',
    level: 1,
    description:
      'Você conhece a língua secreta dos druidas e pode usá-la para deixar mensagens escondidas. Outros druidas identificam essas mensagens automaticamente.',
  },
  {
    id: 'wild-shape',
    name: 'Forma Selvagem',
    level: 2,
    description:
      'Como ação, transforme-se numa fera já vista. Usos por descanso curto ou longo: 2 (níveis 2-19) e ilimitado no 20º. Formas permitidas: até CR 1/4 sem deslocamento de voo/natação (nível 2), até CR 1/2 ainda sem voo (nível 4) e até CR 1, agora podendo voar, a partir do nível 8.',
    effects: [
      {
        type: 'resource',
        id: 'wild-shape',
        name: 'Forma Selvagem',
        resource: {
          name: 'Forma Selvagem',
          recharge: 'short',
          maxByLevel: [
            { level: 2, value: 2 },
            { level: 20, value: -1 },
          ],
        },
      },
      {
        type: 'wildShape',
        scaling: [
          { level: 2, value: 0.25 },
          { level: 4, value: 0.5 },
          { level: 8, value: 1 },
        ],
      },
    ],
  },
  {
    id: 'timeless-body',
    name: 'Corpo Atemporal',
    level: 18,
    description:
      'Você envelhece apenas 1 ano para cada 10 anos de vida e não pode ser envelhecido magicamente.',
  },
  {
    id: 'beast-spells',
    name: 'Magias da Fera',
    level: 18,
    description:
      'Você pode lançar magias enquanto estiver na forma selvagem, realizando os gestos e a fala apesar da forma de fera.',
  },
  {
    id: 'archdruid',
    name: 'Arquidruida',
    level: 20,
    description:
      'Você usa a Forma Selvagem um número ilimitado de vezes. Além disso, ignora componentes verbais e somáticos de magias de druida e os componentes materiais sem custo.',
  },
];

const DRUID_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'land',
    name: 'Círculo da Terra',
    description:
      'Druida que canaliza a magia do território onde foi iniciado, ganhando magias de círculo ligadas ao terreno e recuperação de espaços.',
    features: [
      {
        id: 'bonus-cantrip',
        name: 'Truque Adicional',
        level: 2,
        description: 'Você aprende um truque de druida adicional.',
      },
      {
        id: 'circle-spells',
        name: 'Magias do Círculo',
        level: 2,
        description:
          'Escolha um terreno: Ártico (Imobilizar Pessoa, Crescer Espinhos / Nevasca, Lentidão / Liberdade de Movimento, Tempestade de Gelo / Comungar com a Natureza, Cone de Frio); Costa (Imagem Espelhada, Passo Enevoado / Respirar na Água, Caminhar na Água / Controlar Água, Liberdade de Movimento / Conjurar Elemental, Vidência); Deserto (Desfoque, Silêncio / Criar Comida e Água, Proteção contra Energia / Apodrecer, Terreno Alucinatório / Praga de Insetos, Muralha de Pedra); Floresta (Pele de Casca, Escalada de Aranha / Invocar Relâmpagos, Crescer Plantas / Adivinhação, Liberdade de Movimento / Comungar com a Natureza, Passo de Árvore); Charco (Escuridão, Flecha Ácida / Caminhar na Água, Nuvem Fétida / Liberdade de Movimento, Localizar Criatura / Praga de Insetos, Vidência); Montanha (Escalada de Aranha, Crescer Espinhos / Relâmpago, Fundir-se à Pedra / Moldar Pedra, Pele de Pedra / Passagem de Parede, Muralha de Pedra); Campina (Invisibilidade, Passar sem Deixar Rastros / Luz do Dia, Pressa / Adivinhação, Liberdade de Movimento / Sonho, Praga de Insetos); Selva (Escalada de Aranha, Teia / Forma Gasosa, Nuvem Fétida / Invisibilidade Maior, Moldar Pedra / Nuvem Venenosa, Praga de Insetos). As magias do terreno estão sempre preparadas e não contam no limite de magias preparadas.',
      },
      {
        id: 'natural-recovery',
        name: 'Recuperação Natural',
        level: 2,
        description:
          'Uma vez por dia, durante um descanso curto, recupere espaços de magia gastos totalizando metade do seu nível de druida, arredondado para cima. Nenhum espaço de 6º nível ou superior pode ser recuperado assim.',
      },
      {
        id: 'lands-stride',
        name: 'Passada da Natureza',
        level: 6,
        description:
          'Mover-se por terreno difícil não mágico não custa movimento extra. Você também atravessa plantas não mágicas sem ser retardado e tem vantagem em salvaguardas contra plantas criadas magicamente.',
      },
      {
        id: 'natures-ward',
        name: 'Proteção da Natureza',
        level: 10,
        description:
          'Você é imune a enfeitiçado e amedrontado por elementais e feéricos, e é imune a doenças e veneno.',
      },
      {
        id: 'natures-sanctuary',
        name: 'Santuário da Natureza',
        level: 14,
        description:
          'Criaturas que tentarem atacar você devem antes passar num teste de resistência de Sabedoria (CD = CD de magia). Se falharem, não conseguem atacar e devem escolher outro alvo (ou perdem o ataque).',
      },
    ],
  },
  {
    id: 'moon',
    name: 'Círculo da Lua',
    description:
      'Druida guardião que domina a Forma Selvagem e assume formas de fera muito mais poderosas.',
    features: [
      {
        id: 'combat-wild-shape',
        name: 'Forma Selvagem de Combate',
        level: 2,
        description:
          'Você pode usar a Forma Selvagem como ação bônus. Enquanto transformado, pode gastar um espaço de magia para recuperar 1d8 pontos de vida por nível do espaço gasto.',
      },
      {
        id: 'circle-forms',
        name: 'Formas Circulares',
        level: 2,
        description:
          'Você pode usar a Forma Selvagem para assumir formas de fera de CR igual ou inferior a 1 já no nível 2, escalando pelo seu nível de druida: CR 1 (nível 2), CR 2 (6º), CR 3 (9º), CR 4 (12º), CR 5 (15º) e CR 6 (18º).',
        effect: {
          type: 'wildShape',
          override: true,
          scaling: [
            { level: 2, value: 1 },
            { level: 6, value: 2 },
            { level: 9, value: 3 },
            { level: 12, value: 4 },
            { level: 15, value: 5 },
            { level: 18, value: 6 },
          ],
        },
      },
      {
        id: 'primal-strike',
        name: 'Golpe Primordial',
        level: 6,
        description:
          'Seus ataques na Forma Selvagem contam como mágicos para superar resistência e imunidade a dano não mágico.',
      },
      {
        id: 'elemental-wild-shape',
        name: 'Forma Selvagem Elemental',
        level: 10,
        description:
          'Gaste 2 usos de Forma Selvagem para assumir a forma de um elemental (ar, água, fogo ou terra).',
      },
      {
        id: 'thousand-forms',
        name: 'Mil Formas',
        level: 14,
        description:
          'Você pode lançar a magia Disfarce (Alterar Personagem) à vontade.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Feiticeiro (Sorcerer) — PHB 2014
// ---------------------------------------------------------------------------

const SORCERER_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'font-of-magic',
    name: 'Fonte de Magia',
    level: 2,
    description:
      'Você ganha pontos de feitiçaria iguais ao seu nível de feiticeiro, repostos num descanso longo. Como ação bônus, converta pontos em espaços de magia (1º nível = 2 pontos, 2º = 3, 3º = 5, 4º = 6, 5º = 7) ou converta um espaço de magia em pontos iguais ao nível do espaço. Não é possível criar nem converter espaços de 6º nível ou superiores.',
    effect: {
      type: 'resource',
      id: 'sorcery-points',
      name: 'Pontos de Feitiçaria',
      resource: { name: 'Pontos de Feitiçaria', recharge: 'long', perLevel: true },
    },
  },
  {
    id: 'metamagic',
    name: 'Metamagia',
    level: 3,
    description:
      'Escolha 2 opções de Metamagia. Cuidadosa (1 ponto: exclui até o mod. de Carisma de criaturas da área), Distante (1: dobra o alcance ou transforma toque em 9 m), Fortalecida (1: rerrola até o mod. de Carisma de dados de dano), Estendida (1: dobra a duração, máx. 24h), Elevada (2: desvantagem na primeira salvaguarda do alvo), Acelerada (2: magia de ação vira ação bônus, 1x por turno), Sutil (1: sem componentes verbais/somáticos) e Geminada (nível da magia em pontos, mín. 1: atinge um segundo alvo).',
  },
  {
    id: 'metamagic-improvement',
    name: 'Metamagia Aprimorada',
    level: 10,
    description: 'Você aprende 1 opção adicional de Metamagia.',
  },
  {
    id: 'metamagic-master',
    name: 'Mestre da Metamagia',
    level: 17,
    description: 'Você aprende 1 opção adicional de Metamagia.',
  },
  {
    id: 'sorcerous-restoration',
    name: 'Restauração Feiticeira',
    level: 20,
    description: 'Ao terminar um descanso curto, recupere 4 pontos de feitiçaria gastos.',
  },
];

const SORCERER_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'draconic',
    name: 'Linhagem Dracônica',
    description:
      'Sua magia vem de um ancestral dragão, concedendo resistência natural e poder elemental.',
    features: [
      {
        id: 'dragon-ancestor',
        name: 'Ancestral Dracônico',
        level: 1,
        description:
          'Escolha um tipo de dragão (Negro/Ácido, Azul/Elétrico, Branco/Frio, Bronze/Elétrico, Cobre/Ácido, Latão/Fogo, Ouro/Fogo, Prata/Frio, Verde/Veneno, Vermelho/Fogo). Você pode falar, ler e escrever Dracônico e dobra o bônus de proficiência em testes de Carisma ao interagir com dragões.',
      },
      {
        id: 'draconic-resilience',
        name: 'Resiliência Dracônica',
        level: 1,
        description:
          'Sua pele ganha escamas. Seu HP máximo aumenta em 1 por nível de feiticeiro e, quando não usa armadura, sua CA é 13 + mod. de Destreza.',
        effects: [
          { type: 'hpBonus', id: 'draconic-resilience', value: 1, perLevel: true },
          { type: 'unarmoredDefense', base: 13 },
        ],
      },
      {
        id: 'elemental-affinity',
        name: 'Afinidade Elemental',
        level: 6,
        description:
          'Escolha um tipo de dano (ácido, elétrico, frio, fogo ou veneno). Você soma o mod. de Carisma ao dano de uma magia que cause esse tipo de dano. Também ganha resistência a esse tipo de dano.',
      },
      {
        id: 'dragon-wings',
        name: 'Asas Dracônicas',
        level: 14,
        description:
          'Como ação bônus, brote asas nas costas e ganhe deslocamento de voo igual ao seu deslocamento atual até guardá-las.',
      },
      {
        id: 'draconic-presence',
        name: 'Presença Dracônica',
        level: 18,
        description:
          'Como ação, exale uma aura de 18 m (60 pés). Escolha entre amedrontar ou cativar criaturas na área (salvaguarda de Sabedoria evita), por 1 minuto ou até você perder a concentração.',
      },
    ],
  },
  {
    id: 'wild-magic',
    name: 'Magia Selvagem',
    description:
      'Sua magia brota de forças do caos, com surtos imprevisíveis de efeitos aleatórios.',
    features: [
      {
        id: 'wild-magic-surge',
        name: 'Surto de Magia Selvagem',
        level: 1,
        description:
          'Imediatamente após lançar uma magia de 1º nível ou superior, o mestre pode pedir que você role 1d20; num resultado 1, role na tabela de Surto de Magia Selvagem.',
      },
      {
        id: 'tides-of-chaos',
        name: 'Marés do Caos',
        level: 1,
        description:
          'Você pode ganhar vantagem em um ataque, teste de atributo ou salvaguarda. Ao usar, o mestre pode então pedir que você role na tabela de Surto de Magia Selvagem. Repõe-se num descanso longo.',
        effect: { type: 'resource', id: 'tides-of-chaos', name: 'Marés do Caos', resource: { name: 'Marés do Caos', max: 1, recharge: 'long' } },
      },
      {
        id: 'bend-luck',
        name: 'Dobrar a Sorte',
        level: 6,
        description:
          'Usando sua reação e gastando 2 pontos de feitiçaria, some ou subtraia 1d4 de um teste de atributo, ataque ou salvaguarda seu ou de uma criatura que você possa ver.',
      },
      {
        id: 'controlled-chaos',
        name: 'Caos Controlado',
        level: 14,
        description:
          'Ao rolar na tabela de Surto de Magia Selvagem, role duas vezes e escolha qual dos dois efeitos ocorre.',
      },
      {
        id: 'spell-bombardment',
        name: 'Bombardeio Mágico',
        level: 18,
        description:
          'Quando rolar o valor máximo num dado de dano de uma magia, role outro dado e some ao dano. Você pode continuar rolando enquanto tirar o valor máximo, até rolar o surto e o mestre pedir para sair da tabela.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Mago (Wizard) — PHB 2014
// ---------------------------------------------------------------------------

const WIZARD_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'arcane-recovery',
    name: 'Recuperação Arcana',
    level: 1,
    description:
      'Uma vez por dia, durante um descanso curto, recupere espaços de magia gastos totalizando metade do seu nível de mago, arredondado para cima. Nenhum espaço de 6º nível ou superior pode ser recuperado assim.',
  },
  {
    id: 'spell-mastery',
    name: 'Maestria em Magia',
    level: 18,
    description:
      'Escolha uma magia de 1º nível e uma de 2º nível do seu grimório. Você pode lançá-las à vontade, no nível mais baixo, sem gastar espaços de magia.',
  },
  {
    id: 'signature-spells',
    name: 'Magias Assinatura',
    level: 20,
    description:
      'Escolha duas magias de 3º nível do seu grimório: elas ficam sempre preparadas e podem ser lançadas gratuitamente, cada uma uma vez, repondo os usos num descanso curto ou longo.',
  },
];

const WIZARD_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'abjuration',
    name: 'Escola de Abjuração',
    description: 'Especialista em magias de proteção, barreiras e banimento.',
    features: [
      {
        id: 'abjuration-savant',
        name: 'Especialista em Abjuração',
        level: 2,
        description:
          'Copiar uma magia de Abjuração para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'arcane-ward',
        name: 'Couraça Arcana',
        level: 2,
        description:
          'Ao lançar uma magia de Abjuração de 1º nível ou superior, crie uma couraça mágica que absorve dano. Os pontos são 2 × nível de mago + mod. de Inteligência. A couraça se recarrega quando você lança magias de Abjuração e se esvazia num descanso longo.',
        effect: {
          type: 'resource',
          id: 'arcane-ward',
          name: 'Couraça Arcana',
          resource: {
            name: 'Couraça Arcana',
            recharge: 'long',
            perLevel: true,
            perLevelMultiplier: 2,
            abilityMod: 'intelligence',
          },
        },
      },
      {
        id: 'projected-ward',
        name: 'Couraça Projetada',
        level: 6,
        description:
          'Quando uma criatura a até 9 m (30 pés) sofrer dano, use sua reação para projetar sua Couraça Arcana sobre ela, absorvendo o dano com seus pontos.',
      },
      {
        id: 'improved-abjuration',
        name: 'Abjuração Aprimorada',
        level: 10,
        description:
          'Você soma seu nível de mago às checagens de atributo ao lançar Contramágica ou Dissipar Magia.',
      },
      {
        id: 'spell-resistance',
        name: 'Resistência a Magia',
        level: 14,
        description: 'Você tem vantagem em testes de resistência contra magias.',
      },
    ],
  },
  {
    id: 'conjuration',
    name: 'Escola de Conjuração',
    description: 'Especialista em invocar criaturas e transportar objetos e pessoas.',
    features: [
      {
        id: 'conjuration-savant',
        name: 'Especialista em Conjuração',
        level: 2,
        description:
          'Copiar uma magia de Conjuração para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'minor-conjuration',
        name: 'Conjuração Menor',
        level: 2,
        description:
          'Como ação, crie um objeto inanimado não mágico de até 30 cm (1 pé) que dure 1 hora, ou faça surgir um item de até 3 m de distância.',
      },
      {
        id: 'benign-transposition',
        name: 'Transposição Benigna',
        level: 6,
        description:
          'Como ação bônus, teleporte-se até 9 m (30 pés) para um espaço desocupado que possa ver. Alternativamente, troque de lugar com uma criatura voluntária a até 9 m.',
      },
      {
        id: 'focused-conjuration',
        name: 'Conjuração Focada',
        level: 10,
        description:
          'Sua concentração em magias de Conjuração não pode ser interrompida por dano.',
      },
      {
        id: 'durable-summons',
        name: 'Invocações Duráveis',
        level: 14,
        description:
          'Criaturas que você invoca ou cria com magias de Conjuração ganham 30 pontos de vida temporários.',
      },
    ],
  },
  {
    id: 'divination',
    name: 'Escola de Adivinhação',
    description: 'Especialista em enxergar o futuro e obter informações ocultas.',
    features: [
      {
        id: 'divination-savant',
        name: 'Especialista em Adivinhação',
        level: 2,
        description:
          'Copiar uma magia de Adivinhação para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'portent',
        name: 'Presságio',
        level: 2,
        description:
          'Ao terminar um descanso longo, role 2d20 e registre os valores. Você pode substituir qualquer jogada de ataque, teste de atributo ou salvaguarda (sua ou de uma criatura que veja) por um desses valores, gastando-o. No nível 14 você rola 3d20.',
        effect: {
          type: 'resource',
          id: 'portent',
          name: 'Dados de Presságio',
          resource: {
            name: 'Dados de Presságio',
            recharge: 'long',
            maxByLevel: [
              { level: 2, value: 2 },
              { level: 14, value: 3 },
            ],
          },
        },
      },
      {
        id: 'expert-divination',
        name: 'Adivinhação Especialista',
        level: 6,
        description:
          'Ao lançar uma magia de Adivinhação de 2º nível ou superior, recupere um espaço de magia gasto de nível inferior a ela.',
      },
      {
        id: 'the-third-eye',
        name: 'O Terceiro Olho',
        level: 10,
        description:
          'Como ação, escolha um destes sentidos até um descanso longo: visão no escuro (18 m), ler qualquer idioma, ver criaturas invisíveis a até 3 m ou ver o Plano Etéreo a até 18 m.',
      },
      {
        id: 'greater-portent',
        name: 'Presságio Maior',
        level: 14,
        description: 'Você passa a rolar 3 dados de Presságio a cada descanso longo.',
      },
    ],
  },
  {
    id: 'enchantment',
    name: 'Escola de Encantamento',
    description: 'Especialista em controlar mentes e encantar criaturas.',
    features: [
      {
        id: 'enchantment-savant',
        name: 'Especialista em Encantamento',
        level: 2,
        description:
          'Copiar uma magia de Encantamento para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'hypnotic-gaze',
        name: 'Olhar Hipnótico',
        level: 2,
        description:
          'Como ação, escolha uma criatura a até 9 m (30 pés) que veja; ela faz uma salvaguarda de Sabedoria ou fica enfeitiçada e incapacitada até o fim do seu próximo turno.',
      },
      {
        id: 'instinctive-charm',
        name: 'Encanto Instintivo',
        level: 6,
        description:
          'Usando sua reação, desvie um ataque que teria como alvo você para outra criatura a até 9 m (30 pés), redirecionando o ataque.',
      },
      {
        id: 'split-enchantment',
        name: 'Encantamento Dividido',
        level: 10,
        description:
          'Ao lançar uma magia de Encantamento de alvo único, você pode escolher um segundo alvo para a mesma magia.',
      },
      {
        id: 'alter-memories',
        name: 'Alterar Memórias',
        level: 14,
        description:
          'Você pode apagar até 1 hora das memórias de uma criatura enfeitiçada por você, como a magia Modificar Memória.',
      },
    ],
  },
  {
    id: 'evocation',
    name: 'Escola de Evocação',
    description: 'Especialista em magias de energia bruta, como fogo, raio e frio.',
    features: [
      {
        id: 'evocation-savant',
        name: 'Especialista em Evocação',
        level: 2,
        description:
          'Copiar uma magia de Evocação para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'sculpt-spells',
        name: 'Moldar Magias',
        level: 2,
        description:
          'Ao lançar uma magia de Evocação que afeta outras criaturas que você possa ver, escolha um número delas igual a 1 + o nível da magia; as escolhidas passam automaticamente na salvaguarda e não sofrem dano.',
      },
      {
        id: 'potent-cantrip',
        name: 'Truque Potente',
        level: 6,
        description:
          'Quando uma criatura passa numa salvaguarda contra um de seus truques, ela ainda sofre metade do dano, mas nenhum efeito adicional.',
      },
      {
        id: 'empowered-evocation',
        name: 'Evocação Fortalecida',
        level: 10,
        description:
          'Você soma o mod. de Inteligência ao dano de qualquer magia de Evocação de mago que lançar.',
      },
      {
        id: 'overchannel',
        name: 'Sobrecarregar',
        level: 14,
        description:
          'Ao lançar uma magia de Evocação de 1º a 5º nível, você pode causar o dano máximo. Na primeira vez não sofre nada; a cada uso seguinte antes de um descanso longo, sofre 2d12 de dano necrótico por nível da magia (ignora resistência/imunidade).',
      },
    ],
  },
  {
    id: 'illusion',
    name: 'Escola de Ilusão',
    description: 'Especialista em enganar os sentidos com imagens e sons falsos.',
    features: [
      {
        id: 'illusion-savant',
        name: 'Especialista em Ilusão',
        level: 2,
        description:
          'Copiar uma magia de Ilusão para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'improved-minor-illusion',
        name: 'Ilusão Menor Aprimorada',
        level: 2,
        description:
          'Você aprende Disfarce Menor e pode criar tanto um som quanto uma imagem com uma única conjuração dela.',
      },
      {
        id: 'malleable-illusions',
        name: 'Ilusões Maleáveis',
        level: 6,
        description:
          'Como ação, você altera a natureza de uma ilusão já criada por uma magia de Ilusão (desde que continue dentro do alcance e você possa vê-la).',
      },
      {
        id: 'illusory-self',
        name: 'Eu Ilusório',
        level: 10,
        description:
          'Usando sua reação quando uma criatura o ataca, você cria uma duplicata ilusória e se torna invisível até o fim do seu próximo turno, fazendo o ataque errar.',
      },
      {
        id: 'illusory-reality',
        name: 'Realidade Ilusória',
        level: 14,
        description:
          'Como ação, transforme parte de uma ilusão em realidade por 1 minuto, tornando real um objeto inanimado não mágico de até 1,5 m (5 pés) de lado.',
      },
    ],
  },
  {
    id: 'necromancy',
    name: 'Escola de Necromancia',
    description: 'Especialista em manipular a vida e a morte, energias necróticas e mortos-vivos.',
    features: [
      {
        id: 'necromancy-savant',
        name: 'Especialista em Necromancia',
        level: 2,
        description:
          'Copiar uma magia de Necromancia para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'grim-harvest',
        name: 'Colheita Sombria',
        level: 2,
        description:
          'Uma vez por turno, ao matar uma criatura com uma magia, recupere PV iguais a 2 × nível da magia (3 × se for Necromancia). Formas de vitalidade recuperam o máximo.',
      },
      {
        id: 'undead-thralls',
        name: 'Servos Mortos-Vivos',
        level: 6,
        description:
          'Ao lançar Animar Mortos, você anima um esqueleto ou zumbi extra e ele não conta no limite de criaturas controladas. Esses servos somam seu mod. de Inteligência ao dano e ganham +1 PV por nível de mago.',
      },
      {
        id: 'inured-to-death',
        name: 'Resistente à Morte-em-Vida',
        level: 10,
        description:
          'Você ganha resistência a dano necrótico e não pode ter sua pontuação máxima de PV reduzida por efeitos necróticos.',
        effect: { type: 'resistance', damageTypes: ['Necrótico'] },
      },
      {
        id: 'command-undead',
        name: 'Comandar Mortos-Vivos',
        level: 14,
        description:
          'Como ação, escolha um morto-vivo a até 18 m (60 pés): ele faz uma salvaguarda de Carisma ou fica sob seu controle por 24 horas (ou até você usar esta ação de novo).',
      },
    ],
  },
  {
    id: 'transmutation',
    name: 'Escola de Transmutação',
    description: 'Especialista em alterar a matéria e a forma das coisas e criaturas.',
    features: [
      {
        id: 'transmutation-savant',
        name: 'Especialista em Transmutação',
        level: 2,
        description:
          'Copiar uma magia de Transmutação para o grimório custa metade do tempo e do ouro normais.',
      },
      {
        id: 'minor-alchemy',
        name: 'Alquimia Menor',
        level: 2,
        description:
          'Como ação, transmute temporariamente um objeto não mágico de um material em outro (madeira, pedra, ferro, cobre, prata) por até 1 hora.',
      },
      {
        id: 'transmuters-stone',
        name: 'Pedra do Transmutador',
        level: 6,
        description:
          'Como ação, crie uma pedra mágica que concede um benefício escolhido (visão no escuro; proficiência em salvaguardas de CON; deslocamento +3 m; ou resistência a ácido, frio, fogo, elétrico ou trovão). O benefício dura até ser trocado.',
      },
      {
        id: 'shapechanger',
        name: 'Metamorfo',
        level: 10,
        description:
          'Como ação, assuma a forma de uma fera de CR 1 ou menos, ou use Alterar Forma como ação, por até 1 hora.',
      },
      {
        id: 'master-transmuter',
        name: 'Mestre Transmutador',
        level: 14,
        description:
          'Você pode usar a Pedra do Transmutador para conceder benefícios a outras criaturas e, ao usá-la, pode reverter transformações, venenos e doenças, além de reviver criaturas mortas há menos de 1 hora (como Ressuscitar).',
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
    features: DRUID_FEATURES,
    subclasses: DRUID_SUBCLASSES,
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
    features: WIZARD_FEATURES,
    subclasses: WIZARD_SUBCLASSES,
  },
  {
    key: 'monk',
    name: 'Monge',
    hitDie: 8,
    savingThrows: ['strength', 'dexterity'],
    subclassLevel: 3, // Tradição Monástica
    spellcasting: { type: 'none', ability: null, learning: 'none' },
    features: MONK_FEATURES,
    subclasses: MONK_SUBCLASSES,
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
    features: SORCERER_FEATURES,
    subclasses: SORCERER_SUBCLASSES,
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
  abilities?: Record<AbilityKey, number>,
): number {
  let value: number;
  if (resource.perLevel) {
    value = Math.max(0, level) * (resource.perLevelMultiplier ?? 1);
  } else if (resource.maxByLevel && resource.maxByLevel.length > 0) {
    const sorted = [...resource.maxByLevel].sort((a, b) => a.level - b.level);
    value = sorted[0]?.value ?? 0;
    for (const step of sorted) if (step.level <= level) value = step.value;
  } else {
    value = resource.max ?? 0;
  }
  if (resource.abilityMod && abilities) {
    value += abilityModifier(abilities[resource.abilityMod]);
  }
  return value;
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
  /** Atributo somado à CA na Defesa sem Armadura (null quando não há). */
  unarmoredDefenseAbility: AbilityKey | null;
  /** Base da CA na Defesa sem Armadura (10 no Bárbaro/Monge; 13 na Linhagem Dracônica). */
  unarmoredDefenseBase: number;
  /** Faces do dado de dano desarmado de Artes Marciais (0 = sem a feature). */
  martialArtsDie: number;
  /** PV extras concedidos por features (ex.: +1 por nível de feiticeiro dracônico). */
  hpBonus: number;
  /** Limite de CR da Forma Selvagem (null = sem a feature). 0.25 = CR 1/4. */
  wildShapeCr: number | null;
  /** Forma Selvagem já permite deslocamento de voo (a partir do 8º nível). */
  wildShapeFlying: boolean;
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
  abilities?: Record<AbilityKey, number>,
): ClassAdjustments {
  const activeSet = new Set(state.active);
  const toggles: ActiveToggle[] = [];
  const resources: ActiveResource[] = [];
  let meleeDamageBonus = 0;
  const resistances = new Set<string>();
  let speedBonus = 0;
  let critExtraDice = 0;
  let unarmoredDefense = false;
  let unarmoredDefenseAbility: AbilityKey | null = null;
  let unarmoredDefenseBase = 10;
  let martialArtsDie = 0;
  let hpBonus = 0;
  let baseWildShapeCr = 0;
  let overrideWildShapeCr: number | null = null;
  const abilityBonuses: Partial<Record<AbilityKey, number>> = {};
  const abilityCaps: Partial<Record<AbilityKey, number>> = {};

  for (const feature of features) {
    for (const effect of featureEffectsOf(feature)) {
      const effectId = effect.id ?? feature.id;

      switch (effect.type) {
        case 'toggle':
          toggles.push({
            id: effectId,
            name: effect.name ?? feature.name,
            active: activeSet.has(effectId),
            resourceId: effect.resourceId ?? null,
          });
          break;
        case 'resource': {
          const resource = effect.resource;
          if (!resource) break;
          const max = resourceMaxAtLevel(resource, level, abilities);
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
          speedBonus += effectValueAtLevel(effect, level) ?? 0;
          break;
        case 'critDice':
          critExtraDice = Math.max(critExtraDice, effectValueAtLevel(effect, level) ?? 0);
          break;
        case 'unarmoredDefense':
          unarmoredDefense = true;
          if (effect.unarmoredDefenseAbility) unarmoredDefenseAbility = effect.unarmoredDefenseAbility;
          unarmoredDefenseBase = Math.max(unarmoredDefenseBase, effect.base ?? 10);
          break;
        case 'martialArts':
          martialArtsDie = Math.max(martialArtsDie, effectValueAtLevel(effect, level) ?? 0);
          break;
        case 'hpBonus': {
          const value = effectValueAtLevel(effect, level) ?? 0;
          hpBonus += value * (effect.perLevel ? level : 1);
          break;
        }
        case 'wildShape': {
          const value = effectValueAtLevel(effect, level) ?? 0;
          if (effect.override) overrideWildShapeCr = Math.max(overrideWildShapeCr ?? 0, value);
          else baseWildShapeCr = Math.max(baseWildShapeCr, value);
          break;
        }
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

  // Liga cada toggle sem recurso explícito ao recurso de mesmo id (ex.: Fúria).
  const resourceIds = new Set(resources.map((resource) => resource.id));
  for (const toggle of toggles) {
    if (toggle.resourceId === null && resourceIds.has(toggle.id)) toggle.resourceId = toggle.id;
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
    unarmoredDefenseAbility,
    unarmoredDefenseBase,
    martialArtsDie,
    hpBonus,
    wildShapeCr: overrideWildShapeCr ?? (baseWildShapeCr > 0 ? baseWildShapeCr : null),
    wildShapeFlying: (overrideWildShapeCr ?? baseWildShapeCr) > 0 && level >= 8,
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
