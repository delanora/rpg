import type {
  ClassDefinition,
  ClassFeatureDefinition,
  FeatureChoiceOption,
  SubclassDefinition,
} from './types.js';

/**
 * Bruxo (Warlock) — PHB 2014.
 *
 * O bruxo escolhe o Patrono JÁ no nível 1 — junto do Feiticeiro e do Clérigo, é
 * uma das classes em que a subclasse faz parte do pacote inicial. Por isso o
 * assistente de criação pede o patrono no passo da classe.
 *
 * DÁDIVA DO PACTO (3): escolha entre Lâmina, Corrente e Grimório (padrão de
 * `choice`, como a Metamagia do feiticeiro). A escolha fica em
 * `classState.choices['pact-boon']` e é ela que libera as invocações com
 * `requiresPact` (Lâmina Sedenta, Sorvedouro de Vida, Livro dos Segredos...).
 *
 * INVOCAÇÕES MÍSTICAS: crescem nos níveis 2 (2 opções), 5, 7, 9, 12, 15 e 18
 * (1 cada), como a Metamagia. As opções com `requiresLevel`/`requiresPact` só
 * aparecem quando o pré-requisito é atendido (o servidor também recusa).
 *
 * ARCANUM MÍSTICO: uma magia de 6º/7º/8º/9º nos níveis 11/13/15/17, utilizável
 * 1x por descanso longo sem gastar espaço. O CATÁLOGO DE MAGIAS ainda não existe
 * (ver REVISAO-CODIGO.md), então ficam como TEXTO — sem `choice`, para não exigir
 * uma escolha sem opções.
 */

// ---------------------------------------------------------------------------
// Dádiva do Pacto (nível 3)
// ---------------------------------------------------------------------------

const PACT_BOON_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'blade',
    name: 'Pacto da Lâmina',
    description:
      'Com uma ação, você cria uma arma de pacto numa mão vazia (qualquer arma corpo a corpo) e é proficiente com ela; a arma conta como mágica para superar resistências. Você pode vincular uma arma mágica como pacto com um ritual e pode guardar/chamar a arma como ação.',
  },
  {
    key: 'chain',
    name: 'Pacto da Corrente',
    description:
      'Você aprende Conjurar Familiar e pode conjurá-la como ritual; ao conjurá-la, pode escolher formas especiais: imp, pseudodragão, quasit ou sprite. Ao usar a ação de Ataque, pode renunciar a um dos seus ataques para o familiar atacar como reação. (A ficha do familiar é Fase 5.)',
    // TODO(catálogo de magias): Conjurar Familiar como ritual (Fase 4).
  },
  {
    key: 'tome',
    name: 'Pacto do Grimório',
    description:
      'Você recebe um Livro das Sombras. Ao obtê-lo, escolha três truques de qualquer lista de classe: eles ficam no livro, contam como magias de bruxo e não entram no limite de truques conhecidos.',
    // TODO(catálogo de magias): registrar os 3 truques do Livro das Sombras (Fase 4).
  },
];

// ---------------------------------------------------------------------------
// Invocações Místicas (só as do PHB que NÃO dependem de magia específica)
// ---------------------------------------------------------------------------

/**
 * As invocações implementáveis sem o catálogo de magias. As demais (que concedem
 * ou alteram uma magia: Repulsão Agonizante, Armadura de Sombras, Vigor Infernal,
 * Máscara de Muitos Rostos...) entram quando o catálogo existir.
 */
const ELDRITCH_INVOCATION_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'beguiling-influence',
    name: 'Influência Sedutora',
    description: 'Você ganha proficiência nas perícias Enganação e Persuasão.',
  },
  {
    key: 'devils-sight',
    name: 'Visão do Abismo',
    description: 'Você enxerga normalmente na escuridão — mágica ou não — a até 36 m (120 pés).',
  },
  {
    key: 'eyes-of-the-rune-keeper',
    name: 'Olhos do Guardião de Runas',
    description: 'Você consegue ler toda escrita.',
  },
  {
    key: 'gaze-of-two-minds',
    name: 'Olhar de Duas Mentes',
    description:
      'Com uma ação, você toca num humanoide voluntário e percebe pelos sentidos dele até o fim do seu próximo turno; mantém a ligação com ações nos turnos seguintes enquanto ele estiver no mesmo plano. Enquanto percebe pelos sentidos dele, você fica cego e surdo aos seus próprios arredores.',
  },
  {
    key: 'one-with-shadows',
    name: 'Um com as Sombras',
    description:
      'Em penumbra ou escuridão, você usa a ação para ficar invisível até se mover ou fazer uma ação ou reação.',
    requiresLevel: 5,
  },
  {
    key: 'thirsting-blade',
    name: 'Lâmina Sedenta',
    description:
      'Ao usar a ação de Ataque, você ataca duas vezes com a sua arma de pacto em vez de uma.',
    requiresLevel: 5,
    requiresPact: 'blade',
    // TODO(Fase 8): ataque extra no motor de combate.
  },
  {
    key: 'lifedrinker',
    name: 'Sorvedouro de Vida',
    description:
      'Quando acertar uma criatura com a sua arma de pacto, ela sofre dano necrótico extra igual ao seu modificador de Carisma (mínimo 1).',
    requiresLevel: 12,
    requiresPact: 'blade',
    // TODO(Fase 8): dano extra por ataque no motor de combate.
  },
  {
    key: 'voice-of-the-chain-master',
    name: 'Voz do Mestre das Correntes',
    description:
      'Enquanto perceber pelos sentidos do seu familiar, você pode falar com a sua voz pela boca dele. Você também pode falar telepaticamente com o familiar desde que estejam no mesmo plano de existência.',
    requiresPact: 'chain',
  },
  {
    key: 'witch-sight',
    name: 'Visão de Bruxa',
    description:
      'Você enxerga a forma verdadeira de qualquer criatura a até 9 m (30 pés) que esteja disfarçada por magia ou transformação.',
    requiresLevel: 15,
  },
];

/** Recurso de 1 uso por descanso (as características de patrono, em geral). */
function restResource(id: string, name: string, recharge: 'short' | 'long' = 'short') {
  return {
    type: 'resource' as const,
    id,
    name,
    resource: { name, recharge, max: 1 },
  };
}

/** Uma característica de Invocação Mística no nível dado. */
function invocationFeature(id: string, level: number, count: number): ClassFeatureDefinition {
  return {
    id,
    name: count > 1 ? 'Invocações Místicas' : 'Invocação Mística Adicional',
    level,
    description:
      count > 1
        ? 'Você aprende duas Invocações Místicas à sua escolha. Algumas exigem um nível mínimo ou uma Dádiva do Pacto específica e só aparecem quando o pré-requisito é atendido; passe o mouse para ver o que cada uma faz.'
        : 'Você aprende uma Invocação Mística adicional à sua escolha. Passe o mouse sobre cada opção para ver o que ela faz.',
    choice: { count, options: ELDRITCH_INVOCATION_OPTIONS, excludeChosen: true },
  };
}

const WARLOCK_FEATURES: ClassFeatureDefinition[] = [
  invocationFeature('eldritch-invocations', 2, 2),
  {
    id: 'pact-boon',
    name: 'Dádiva do Pacto',
    level: 3,
    description:
      'O seu patrono concede um dom pela sua lealdade: você escolhe entre o Pacto da Lâmina, o Pacto da Corrente e o Pacto do Grimório. Passe o mouse sobre cada opção para ver o que ela faz.',
    choice: { count: 1, options: PACT_BOON_OPTIONS },
  },
  invocationFeature('eldritch-invocations-5', 5, 1),
  invocationFeature('eldritch-invocations-7', 7, 1),
  invocationFeature('eldritch-invocations-9', 9, 1),
  {
    id: 'mystic-arcanum-6',
    name: 'Arcanum Místico (6º)',
    level: 11,
    description:
      'Você escolhe uma magia de 6º nível da lista do bruxo e aprende a lançá-la como Arcanum Místico: uma vez, sem gastar espaço de magia, e só recupera o uso num descanso longo.',
    // TODO(catálogo de magias): registrar a magia de 6º escolhida e o uso 1x/descanso longo (Fase 4).
  },
  invocationFeature('eldritch-invocations-12', 12, 1),
  {
    id: 'mystic-arcanum-7',
    name: 'Arcanum Místico (7º)',
    level: 13,
    description:
      'Você escolhe uma magia de 7º nível da lista do bruxo como Arcanum Místico (1 uso, recuperado num descanso longo, sem gastar espaço).',
    // TODO(catálogo de magias): registrar a magia de 7º (Fase 4).
  },
  invocationFeature('eldritch-invocations-15', 15, 1),
  {
    id: 'mystic-arcanum-8',
    name: 'Arcanum Místico (8º)',
    level: 15,
    description:
      'Você escolhe uma magia de 8º nível da lista do bruxo como Arcanum Místico (1 uso, recuperado num descanso longo, sem gastar espaço).',
    // TODO(catálogo de magias): registrar a magia de 8º (Fase 4).
  },
  {
    id: 'mystic-arcanum-9',
    name: 'Arcanum Místico (9º)',
    level: 17,
    description:
      'Você escolhe uma magia de 9º nível da lista do bruxo como Arcanum Místico (1 uso, recuperado num descanso longo, sem gastar espaço).',
    // TODO(catálogo de magias): registrar a magia de 9º (Fase 4).
  },
  invocationFeature('eldritch-invocations-18', 18, 1),
  {
    id: 'eldritch-master',
    name: 'Mestre Místico',
    level: 20,
    description:
      'Você pode gastar 1 minuto implorando ao seu patrono para recuperar TODOS os espaços de Magia de Pacto gastos. Uma vez usado, só recupera essa capacidade num descanso longo.',
    effect: restResource('eldritch-master', 'Mestre Místico', 'long'),
  },
];

// ---------------------------------------------------------------------------
// Patronos Extraplanares (subclasse escolhida no 1º nível)
// ---------------------------------------------------------------------------

/** Magia expandida do patrono: sempre disponível na lista do bruxo (Fase 4). */
function expandedSpellsFeature(id: string, spells: string): ClassFeatureDefinition {
  return {
    id,
    name: 'Magias Expandidas',
    level: 1,
    description: spells,
    // TODO(catálogo de magias): somar estas magias à lista do bruxo do patrono
    // (mesma decisão das Magias de Domínio do clérigo / de Juramento do paladino).
  };
}

const WARLOCK_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'archfey',
    name: 'Arquifada',
    description:
      'Seu patrono é um senhor da Corte Feérica: encantamento, ilusão e a magia esquiva das fadas.',
    features: [
      {
        id: 'fey-presence',
        name: 'Presença Feérica',
        level: 1,
        description:
          'Como ação, cada criatura num cubo de 3 m (10 pés) a partir de você faz uma salvaguarda de Sabedoria contra a CD da sua magia de bruxo. Quem falhar fica enfeitiçado OU amedrontado por você (à sua escolha) até o fim do seu próximo turno. Recupera-se num descanso curto ou longo.',
        effect: restResource('fey-presence', 'Presença Feérica'),
      },
      expandedSpellsFeature(
        'archfey-expanded-spells',
        'Magias expandidas (sempre na lista do bruxo): 1º — Fogo das Fadas, Sono; 2º — Acalmar Emoções, Força Fantasmagórica; 3º — Piscar, Crescer Plantas; 4º — Dominar Fera, Invisibilidade Maior; 5º — Dominar Pessoa, Parecer.',
      ),
      {
        id: 'misty-escape',
        name: 'Escape Enevoado',
        level: 6,
        description:
          'Quando você sofre dano, usa a reação para ficar invisível e se teleportar até 18 m (60 pés) para um espaço desocupado que possa ver. Você fica invisível até o início do seu próximo turno ou até atacar ou lançar uma magia. Recupera-se num descanso curto ou longo.',
        effect: restResource('misty-escape', 'Escape Enevoado'),
      },
      {
        id: 'beguiling-defenses',
        name: 'Defesas Sedutoras',
        level: 10,
        description:
          'Você é imune a ser enfeitiçado. Quando outra criatura tenta enfeitiçá-lo, você usa a reação para virar o encantamento contra ela: a criatura faz uma salvaguarda de Sabedoria contra a CD da sua magia ou fica enfeitiçada por você por 1 minuto, ou até sofrer dano.',
      },
      {
        id: 'dark-delirium',
        name: 'Delírio Sombrio',
        level: 14,
        description:
          'Como ação, escolha uma criatura que você possa ver a até 18 m (60 pés): ela faz uma salvaguarda de Sabedoria contra a CD da sua magia. Se falhar, fica enfeitiçada OU amedrontada (à sua escolha) por 1 minuto ou até você perder a concentração (como numa magia). Recupera-se num descanso curto ou longo.',
        effect: restResource('dark-delirium', 'Delírio Sombrio'),
      },
    ],
  },
  {
    id: 'fiend',
    name: 'O Corruptor',
    description:
      'Um senhor infernal alimenta seu poder com fogo e sofrimento, recompensando a ousadia com vigor roubado.',
    features: [
      {
        id: 'dark-ones-blessing',
        name: 'Bênção do Um Sombrio',
        level: 1,
        description:
          'Quando você reduz uma criatura hostil a 0 pontos de vida, ganha pontos de vida temporários iguais ao seu modificador de Carisma + o seu nível de bruxo (mínimo 1).',
        // TODO(Fase 8): PV temporários automáticos ao derrubar um inimigo no combate.
      },
      expandedSpellsFeature(
        'fiend-expanded-spells',
        'Magias expandidas (sempre na lista do bruxo): 1º — Mãos Flamejantes, Comando; 2º — Cegueira/Surdez, Raio Escaldante; 3º — Bola de Fogo, Nuvem Fétida; 4º — Escudo de Fogo, Muralha de Fogo; 5º — Coluna de Chamas, Santificar.',
      ),
      {
        id: 'dark-ones-own-luck',
        name: 'Sorte do Um Sombrio',
        level: 6,
        description:
          'Quando fizer um teste de atributo ou uma salvaguarda, você usa esta característica para somar 1d10 à rolagem — depois de ver o dado, mas antes de saber o resultado. Recupera-se num descanso curto ou longo.',
        effect: restResource('dark-ones-own-luck', 'Sorte do Um Sombrio'),
      },
      {
        id: 'fiendish-resilience',
        name: 'Resiliência Infernal',
        level: 10,
        description:
          'Ao terminar um descanso curto ou longo, escolha um tipo de dano: você ganha resistência a ele até escolher outro com esta característica. Dano de armas mágicas ou prateadas ignora essa resistência.',
      },
      {
        id: 'hurl-through-hell',
        name: 'Arremessar pelo Inferno',
        level: 14,
        description:
          'Quando acertar uma criatura com um ataque, você pode transportá-la instantaneamente pelos planos inferiores. Ela desaparece e volta no fim do seu próximo turno no espaço que ocupava (ou no mais próximo). Se não for um ínfero, sofre 10d10 de dano psíquico. Recupera-se num descanso longo.',
        effect: restResource('hurl-through-hell', 'Arremessar pelo Inferno', 'long'),
      },
    ],
  },
  {
    id: 'great-old-one',
    name: 'O Grande Antigo',
    description:
      'Uma entidade além da compreensão sussurra segredos: telepatia, loucura e magia que não deveria ser conhecida.',
    features: [
      {
        id: 'awakened-mind',
        name: 'Mente Desperta',
        level: 1,
        description:
          'Você fala telepaticamente com qualquer criatura que possa ver a até 9 m (30 pés). Não precisa compartilhar um idioma com ela, mas a criatura precisa entender ao menos um idioma.',
      },
      expandedSpellsFeature(
        'goo-expanded-spells',
        'Magias expandidas (sempre na lista do bruxo): 1º — Sussurros Dissonantes, Risada Nefasta de Tasha; 2º — Detectar Pensamentos, Força Fantasmagórica; 3º — Clarividência, Enviar Mensagem; 4º — Dominar Fera, Tentáculos Negros de Evard; 5º — Dominar Pessoa, Telecinese.',
      ),
      {
        id: 'entropic-ward',
        name: 'Guarda Entrópica',
        level: 6,
        description:
          'Quando uma criatura faz uma rolagem de ataque contra você, você usa a reação para impor desvantagem a ela. Se o ataque errar, o seu próximo ataque contra essa criatura tem vantagem, desde que seja antes do fim do seu próximo turno. Recupera-se num descanso curto ou longo.',
        effect: restResource('entropic-ward', 'Guarda Entrópica'),
      },
      {
        id: 'thought-shield',
        name: 'Escudo Mental',
        level: 10,
        description:
          'Os seus pensamentos não podem ser lidos por telepatia nem por outros meios, a menos que você permita. Você também ganha resistência a dano psíquico e, sempre que uma criatura causar dano psíquico a você, ela sofre a mesma quantidade de dano.',
        effect: { type: 'resistance', damageTypes: ['Psíquico'] },
      },
      {
        id: 'create-thrall',
        name: 'Criar Escravo',
        level: 14,
        description:
          'Com uma ação, você toca num humanoide incapacitado e o enfeitiça até que uma magia Remover Maldição seja lançada nele, a condição enfeitiçado seja removida, ou você use esta característica de novo. Você pode falar telepaticamente com a criatura enfeitiçada enquanto estiverem no mesmo plano de existência.',
      },
    ],
  },
];

export const warlock: ClassDefinition = {
  key: 'warlock',
  name: 'Bruxo',
  description:
    'Fez um pacto com um patrono extraplanar e recebe dons estranhos em troca de serviço.',
  hitDie: 8,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 1, // Patrono Extraplanar
  spellcasting: { type: 'pact', ability: 'charisma', learning: 'known' },
  features: WARLOCK_FEATURES,
  subclasses: WARLOCK_SUBCLASSES,
};
