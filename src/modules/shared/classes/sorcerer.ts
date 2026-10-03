import type {
  ClassDefinition,
  ClassFeatureDefinition,
  FeatureChoiceOption,
  SubclassDefinition,
} from './types.js';

// ---------------------------------------------------------------------------
// Feiticeiro (Sorcerer) — PHB 2014
// ---------------------------------------------------------------------------

/**
 * As 8 opções de Metamagia do PHB 2014. Todas ficam disponíveis desde o 3º nível
 * (não há pré-requisito por metamagia); o custo em pontos de feitiçaria vai na
 * descrição. A escolha de cada opção é OBRIGATÓRIA nos níveis 3, 10 e 17.
 *
 * O texto de cada opção só aparece no hover (tooltip), como nas demais
 * informações da ficha — a característica em si mostra só o resumo.
 */
const METAMAGIC_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'careful',
    name: 'Cuidadosa',
    description:
      'Gaste 1 ponto de feitiçaria: escolha criaturas até o seu modificador de Carisma (mínimo 1) para passarem automaticamente na salvaguarda contra a magia.',
  },
  {
    key: 'distant',
    name: 'Distante',
    description:
      'Gaste 1 ponto de feitiçaria: dobre o alcance da magia, ou transforme uma magia de toque em alcance de 9 metros.',
  },
  {
    key: 'empowered',
    name: 'Fortalecida',
    description:
      'Gaste 1 ponto de feitiçaria: rerrole um número de dados de dano da magia até o seu modificador de Carisma (mínimo 1) e use os novos resultados.',
  },
  {
    key: 'extended',
    name: 'Estendida',
    description:
      'Gaste 1 ponto de feitiçaria: dobre a duração da magia, até o máximo de 24 horas.',
  },
  {
    key: 'heightened',
    name: 'Elevada',
    description:
      'Gaste 3 pontos de feitiçaria: uma criatura alvo da magia tem desvantagem na primeira salvaguarda contra ela.',
  },
  {
    key: 'quickened',
    name: 'Acelerada',
    description:
      'Gaste 2 pontos de feitiçaria: conjure a magia com 1 ação como ação bônus (apenas uma magia acelerada por turno).',
  },
  {
    key: 'subtle',
    name: 'Sutil',
    description: 'Gaste 1 ponto de feitiçaria: conjure a magia sem componentes verbais nem somáticos.',
  },
  {
    key: 'twinned',
    name: 'Geminada',
    description:
      'Gaste pontos de feitiçaria iguais ao nível da magia (mínimo 1): uma magia de alvo único passa a ter um segundo alvo.',
  },
];

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
      'Escolha 2 opções de Metamagia. Cada uma gasta pontos de feitiçaria para alterar uma magia no momento da conjuração; em geral só uma opção pode ser usada por magia. Passe o mouse sobre cada opção para ver o que ela faz.',
    choice: {
      count: 2,
      options: METAMAGIC_OPTIONS,
      excludeChosen: true,
    },
  },
  {
    id: 'metamagic-improvement',
    name: 'Metamagia Aprimorada',
    level: 10,
    description:
      'Você aprende 1 opção adicional de Metamagia. Passe o mouse sobre cada opção para ver o que ela faz.',
    choice: {
      count: 1,
      options: METAMAGIC_OPTIONS,
      excludeChosen: true,
    },
  },
  {
    id: 'metamagic-master',
    name: 'Mestre da Metamagia',
    level: 17,
    description:
      'Você aprende 1 opção adicional de Metamagia. Passe o mouse sobre cada opção para ver o que ela faz.',
    choice: {
      count: 1,
      options: METAMAGIC_OPTIONS,
      excludeChosen: true,
    },
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
