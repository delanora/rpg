import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

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

export const wizard: ClassDefinition = {
  key: 'wizard',
  name: 'Mago',
  description:
    'Estudioso do arcano que copia fórmulas no grimório e molda a magia pelo entendimento.',
  hitDie: 6,
  savingThrows: ['intelligence', 'wisdom'],
  subclassLevel: 2, // Tradição Arcana
  spellcasting: { type: 'full', ability: 'intelligence', learning: 'prepared' },
  features: WIZARD_FEATURES,
  subclasses: WIZARD_SUBCLASSES,
};
