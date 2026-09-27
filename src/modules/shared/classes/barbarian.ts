import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

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
      'Seu deslocamento aumenta em 3 metros enquanto você não usar armadura pesada.',
    effect: { type: 'speed', value: 3 },
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

export const barbarian: ClassDefinition = {
  key: 'barbarian',
  name: 'Bárbaro',
  hitDie: 12,
  savingThrows: ['strength', 'constitution'],
  subclassLevel: 3, // Caminho Primal
  spellcasting: { type: 'none', ability: null, learning: 'none' },
  features: BARBARIAN_FEATURES,
  subclasses: BARBARIAN_SUBCLASSES,
};
