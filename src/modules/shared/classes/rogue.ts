import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

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

export const rogue: ClassDefinition = {
  key: 'rogue',
  name: 'Ladino',
  hitDie: 8,
  savingThrows: ['dexterity', 'intelligence'],
  subclassLevel: 3, // Arquétipo Ladino
  spellcasting: { type: 'none', ability: null, learning: 'none' },
  features: ROGUE_FEATURES,
  subclasses: ROGUE_SUBCLASSES,
};
