import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

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
    // A Defesa sem Armadura do monge é a única que exige também nenhum escudo.
    effect: { type: 'unarmoredDefense', unarmoredDefenseAbility: 'wisdom', requiresNoShield: true },
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
      'Seu deslocamento aumenta enquanto você não usar armadura nem escudo: +3 m no 2º nível, +4,5 m no 6º, +6 m no 10º, +7,5 m no 14º e +9 m no 18º.',
    effect: {
      type: 'speed',
      scaling: [
        { level: 2, value: 3 },
        { level: 6, value: 4.5 },
        { level: 10, value: 6 },
        { level: 14, value: 7.5 },
        { level: 18, value: 9 },
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

export const monk: ClassDefinition = {
  key: 'monk',
  name: 'Monge',
  hitDie: 8,
  savingThrows: ['strength', 'dexterity'],
  subclassLevel: 3, // Tradição Monástica
  spellcasting: { type: 'none', ability: null, learning: 'none' },
  features: MONK_FEATURES,
  subclasses: MONK_SUBCLASSES,
};
