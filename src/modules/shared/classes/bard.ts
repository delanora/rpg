import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';
import { EXPERTISE_CHOICE_OPTIONS, SKILL_CHOICE_OPTIONS } from './option-lists.js';

// ---------------------------------------------------------------------------
// Bardo (Bard) — PHB 2014
//
// A CONJURAÇÃO já vem do registro da classe (`spellcasting`: conjurador
// completo de Carisma, magias conhecidas, desde o nível 1), então não há uma
// característica "Conjuração" na lista — é a mesma decisão das outras classes.
//
// PENDENTES registrados nas características (mantidos aqui para consulta):
//   • Fase 5 (combate por ação/reação/rolagem de dado): gastar a Inspiração de
//     Bardo e rolar o dado dela, a Canção de Descanso, o Contra-encanto e a
//     Inspiração Superior (recuperar um uso ao rolar iniciativa).
//   • Fase 4 (catálogo de magias): os Segredos Mágicos (+2 magias de qualquer
//     classe nos níveis 10, 14 e 18).
//
// SUBCLASSES: os Colégios de Bardo ainda são `[]` — só as características de
// CLASSE estão cadastradas aqui.
// ---------------------------------------------------------------------------

const BARD_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'bardic-inspiration',
    name: 'Inspiração de Bardo',
    level: 1,
    description:
      'Ação bônus para inspirar uma criatura a até 18 m (60 pés): ela recebe um dado de Inspiração de Bardo (d6; d8 no 5º nível, d10 no 10º e d12 no 15º) para somar a um teste de habilidade, rolagem de ataque ou teste de resistência. Usos = modificador de Carisma (mínimo 1), recuperados num descanso longo — com Fonte de Inspiração (5º nível), também num descanso curto.',
    effects: [
      {
        type: 'resource',
        id: 'bardic-inspiration',
        name: 'Inspiração de Bardo',
        resource: {
          name: 'Inspiração de Bardo',
          recharge: 'long',
          abilityMod: 'charisma',
          min: 1,
        },
      },
    ],
  },
  // PENDENTE (Fase 5): a inspiração é gasta com uma ação bônus e o dado é
  // rolado pela criatura inspirada — não há como automatizar isso agora.
  {
    id: 'jack-of-all-trades',
    name: 'Pau para Toda Obra',
    level: 2,
    description:
      'Some METADE do seu bônus de proficiência (arredondado para baixo) a qualquer teste de habilidade que ainda não inclua o bônus completo — vale para as perícias em que você não é proficiente e para a iniciativa.',
    effect: { type: 'halfProficiency', target: 'checks', name: 'Pau para Toda Obra' },
  },
  // PENDENTE (Fase 5): a Canção de Descanso muda a cura de um descanso curto
  // (d6 no 2º nível, d8 no 9º, d10 no 13º e d12 no 17º) — depende do descanso.
  {
    id: 'song-of-rest',
    name: 'Canção de Descanso',
    level: 2,
    description:
      'Aliados que gastarem Dados de Vida num descanso curto com você recuperam 1d6 pontos de vida extra (d8 no 9º nível, d10 no 13º e d12 no 17º).',
  },
  {
    id: 'expertise',
    name: 'Especialização',
    level: 3,
    description:
      'Escolha duas proficiências (perícias ou ferramentas de ladrão): nelas o bônus de proficiência é dobrado.',
    effect: { type: 'expertise', value: 2 },
    choice: {
      prompt: 'Especialização (2 perícias ou ferramentas com proficiência)',
      count: 2,
      apply: 'expertise',
      options: EXPERTISE_CHOICE_OPTIONS,
    },
  },
  {
    id: 'expertise-improvement',
    name: 'Especialização Aprimorada',
    level: 10,
    description: 'Escolha mais duas proficiências para receber Especialização.',
    effect: { type: 'expertise', value: 2 },
    choice: {
      prompt: 'Especialização aprimorada (mais 2 perícias ou ferramentas)',
      count: 2,
      apply: 'expertise',
      options: EXPERTISE_CHOICE_OPTIONS,
    },
  },
  {
    id: 'font-of-inspiration',
    name: 'Fonte de Inspiração',
    level: 5,
    description:
      'Sua Inspiração de Bardo passa a se recarregar também num descanso curto (mantém o mesmo máximo).',
    effect: {
      type: 'resource',
      id: 'bardic-inspiration',
      name: 'Inspiração de Bardo',
      resource: {
        name: 'Inspiração de Bardo',
        recharge: 'short',
        abilityMod: 'charisma',
        min: 1,
      },
    },
  },
  // PENDENTE (Fase 5): o Contra-encanto é uma ação com concentração que dá
  // vantagem contra ser enfeitiçado/amedrontado aos aliados a até 9 m.
  {
    id: 'countercharm',
    name: 'Contra-encanto',
    level: 6,
    description:
      'Como ação, você inicia uma apresentação que dura até o fim do seu próximo turno: os aliados a até 9 m (30 pés) que puderem ouvir você têm vantagem nos testes de resistência contra ser enfeitiçados ou amedrontados.',
  },
  // PENDENTE (Fase 4): os Segredos Mágicos escolhem magias de QUALQUER classe
  // (2 no 10º nível, 2 no 14º e 2 no 18º) — depende do catálogo de magias.
  {
    id: 'magical-secrets',
    name: 'Segredos Mágicos',
    level: 10,
    description:
      'Aprenda duas magias de qualquer classe (de um nível que você possa lançar). Elas contam como magias de bardo para você.',
  },
  {
    id: 'magical-secrets-14',
    name: 'Segredos Mágicos',
    level: 14,
    description: 'Aprenda mais duas magias de qualquer classe (de um nível que você possa lançar).',
  },
  {
    id: 'magical-secrets-18',
    name: 'Segredos Mágicos',
    level: 18,
    description: 'Aprenda mais duas magias de qualquer classe (de um nível que você possa lançar).',
  },
  // PENDENTE (Fase 5): recuperar um uso ao rolar iniciativa (sem usos restantes).
  {
    id: 'superior-inspiration',
    name: 'Inspiração Superior',
    level: 20,
    description:
      'Quando rolar iniciativa e não tiver nenhum uso de Inspiração de Bardo, você recupera um uso.',
  },
];

// ---------------------------------------------------------------------------
// Colégios de Bardo (subclasse escolhida no 3º nível)
//
// PENDENTE (Fase 5): Palavras de Interrupção, Inspiração de Combate e Magia de
// Batalha acontecem em combate (reação, dano extra, magia + ataque).
// PENDENTE (Fase 4): Segredos Mágicos Adicionais escolhem magias de qualquer
// classe — depende do catálogo de magias.
// ---------------------------------------------------------------------------

const BARD_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'lore',
    name: 'Colégio do Conhecimento',
    description:
      'Bardo que troca a espada pela erudição: sabe um pouco de tudo, desmonta argumentos alheios com uma palavra e colhe segredos mágicos de qualquer tradição.',
    features: [
      {
        id: 'bonus-proficiencies',
        name: 'Proficiências Adicionais',
        level: 3,
        description:
          'Você ganha proficiência em três perícias à sua escolha (podem ser as que já valem para o bardo ou quaisquer outras).',
        choice: {
          prompt: 'Proficiências Adicionais',
          count: 3,
          apply: 'skill',
          options: [...SKILL_CHOICE_OPTIONS],
        },
      },
      {
        id: 'cutting-words',
        name: 'Palavras de Interrupção',
        level: 3,
        description:
          'Quando uma criatura a até 18 m (60 pés) que você possa ver faz uma rolagem de ataque, teste de habilidade ou de dano, use a sua REAÇÃO e gaste um uso de Inspiração de Bardo para subtrair o dado de Inspiração da rolagem dela.',
      },
      {
        id: 'additional-magical-secrets',
        name: 'Segredos Mágicos Adicionais',
        level: 6,
        description:
          'Você aprende duas magias de qualquer classe (de um nível que possa lançar). Elas contam como magias de bardo para você.',
      },
      {
        id: 'peerless-skill',
        name: 'Perícia Inigualável',
        level: 14,
        description:
          'Quando fizer um teste de habilidade, gaste um uso de Inspiração de Bardo e role o dado: some o resultado ao teste (pode ser feito depois da rolagem, mas antes de saber o resultado).',
      },
    ],
  },
  {
    id: 'valor',
    name: 'Colégio da Bravura',
    description:
      'Bardo que inspira na linha de frente: treina com armaduras e armas marciais e transforma a Inspiração de Bardo em ordem de batalha.',
    // O Colégio da Bravura concede proficiências de armadura e arma (somadas
    // às do bardo quando a subclasse é escolhida).
    proficiencies: {
      armor: ['Armaduras médias', 'Escudos'],
      weapons: ['Armas marciais'],
      tools: [],
    },
    features: [
      // PENDENTE (Fase 5): a inspiração usada como dano/CA extra é ação bônus.
      {
        id: 'combat-inspiration',
        name: 'Inspiração de Combate',
        level: 3,
        description:
          'Uma criatura que tenha uma Inspiração de Bardo sua pode usá-la de duas formas: somar o dado a uma rolagem de DANO, ou somar o dado à Classe de Armadura dela contra um ataque (usando a reação, depois de ver a rolagem mas antes de saber se acertou).',
      },
      {
        id: 'extra-attack',
        name: 'Ataque Extra',
        level: 6,
        description:
          'Ao usar a ação de Ataque, você ataca duas vezes em vez de uma. Não se acumula com o Ataque Extra de outra classe.',
      },
      {
        id: 'battle-magic',
        name: 'Magia de Batalha',
        level: 14,
        description:
          'Depois de lançar uma magia com uma ação, você pode fazer um ataque corpo a corpo com arma como ação bônus.',
      },
    ],
  },
];

export const bard: ClassDefinition = {
  key: 'bard',
  name: 'Bardo',
  description:
    'Artista errante que inspira os aliados, sabe um pouco de tudo e molda magia com palavras e canções.',
  hitDie: 8,
  savingThrows: ['dexterity', 'charisma'],
  subclassLevel: 3, // Colégio de Bardo
  spellcasting: { type: 'full', ability: 'charisma', learning: 'known' },
  features: BARD_FEATURES,
  subclasses: BARD_SUBCLASSES,
};
