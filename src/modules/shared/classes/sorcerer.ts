import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

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

export const sorcerer: ClassDefinition = {
  key: 'sorcerer',
  name: 'Feiticeiro',
  description:
    'Conjurador nato: a magia corre no sangue e se manifesta pela vontade, sem livro nem prece.',
  hitDie: 6,
  savingThrows: ['constitution', 'charisma'],
  subclassLevel: 1, // Origem de Feitiçaria
  spellcasting: { type: 'full', ability: 'charisma', learning: 'known' },
  features: SORCERER_FEATURES,
  subclasses: SORCERER_SUBCLASSES,
};
