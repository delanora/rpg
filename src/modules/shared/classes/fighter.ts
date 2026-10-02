import type {
  ClassDefinition,
  ClassFeatureDefinition,
  FeatureChoiceOption,
  SubclassDefinition,
} from './types.js';
import { ALL_FIGHTING_STYLES } from './fighting-styles.js';
import { ARTISAN_TOOL_OPTIONS } from './option-lists.js';

// ---------------------------------------------------------------------------
// Guerreiro (Fighter) — PHB 2014
//
// O guerreiro NÃO conjura (nem Cavaleiro Arcano aqui: a conjuração de terço
// vem da subclasse, que ainda não está cadastrada).
//
// PENDENTES registrados nas características:
//   • Fase 5 (combate por ação/reação/rolagem de dado): gastar Surto de Ação,
//     Retomar o Fôlego e Indomável, e os ataques extras (Ataque Extra muda
//     quantas vezes a ação de Ataque pode atacar).
//
// SUBCLASSES: Campeão, Mestre da Batalha e Cavaleiro Arcano (arquétipo
// escolhido no 3º nível).
// ---------------------------------------------------------------------------

const FIGHTER_FEATURES: ClassFeatureDefinition[] = [
  {
    // O id leva a classe porque Paladino e Patrulheiro também têm Estilo de
    // Luta: as escolhas são guardadas por id de característica
    // (`classState.choices`), então cada um precisa do seu.
    id: 'fighter-fighting-style',
    name: 'Estilo de Luta',
    level: 1,
    description:
      'Você adota um estilo de combate à sua escolha. Só a Defesa tem efeito automático (+1 CA com armadura); os demais ficam registrados como escolha (o efeito em combate entra na Fase 5).',
    choice: {
      prompt: 'Estilo de Luta',
      count: 1,
      options: [...ALL_FIGHTING_STYLES],
    },
  },
  // PENDENTE (Fase 5): usar Retomar o Fôlego é uma ação bônus que cura
  // 1d10 + nível de guerreiro (o contador de usos já funciona).
  {
    id: 'second-wind',
    name: 'Retomar o Fôlego',
    level: 1,
    description:
      'Ação bônus para recuperar 1d10 + seu nível de guerreiro pontos de vida. Um uso, recuperado num descanso curto ou longo.',
    effect: {
      type: 'resource',
      id: 'second-wind',
      name: 'Retomar o Fôlego',
      resource: { name: 'Retomar o Fôlego', recharge: 'short', max: 1 },
    },
  },
  // PENDENTE (Fase 5): o Surto de Ação concede uma ação extra no turno.
  {
    id: 'action-surge',
    name: 'Surto de Ação',
    level: 2,
    description:
      'No seu turno, realize uma ação adicional (além da ação e da ação bônus). Um uso, recuperado num descanso curto ou longo — dois usos a partir do 17º nível.',
    effect: {
      type: 'resource',
      id: 'action-surge',
      name: 'Surto de Ação',
      resource: {
        name: 'Surto de Ação',
        recharge: 'short',
        maxByLevel: [
          { level: 2, value: 1 },
          { level: 17, value: 2 },
        ],
      },
    },
  },
  // PENDENTE (Fase 5): o número de ataques por ação de Ataque depende do turno
  // de combate e NÃO se acumula entre classes (Guerreiro 5 / Bárbaro 5 ataca
  // duas vezes, não três).
  {
    id: 'extra-attack',
    name: 'Ataque Extra',
    level: 5,
    description:
      'Ao usar a ação de Ataque, você ataca duas vezes em vez de uma. Não se acumula com o Ataque Extra de outra classe.',
  },
  {
    id: 'extra-attack-2',
    name: 'Ataque Extra (2)',
    level: 11,
    description: 'Ao usar a ação de Ataque, você ataca três vezes em vez de duas.',
  },
  {
    id: 'indomitable',
    name: 'Indomável',
    level: 9,
    description:
      'Você pode rerrolar um teste de resistência que falhou (precisa usar o novo resultado). Um uso por descanso longo — dois a partir do 13º nível e três a partir do 17º.',
    effect: {
      type: 'resource',
      id: 'indomitable',
      name: 'Indomável',
      resource: {
        name: 'Indomável',
        recharge: 'long',
        maxByLevel: [
          { level: 9, value: 1 },
          { level: 13, value: 2 },
          { level: 17, value: 3 },
        ],
      },
    },
  },
  {
    id: 'extra-attack-3',
    name: 'Ataque Extra (3)',
    level: 20,
    description: 'Ao usar a ação de Ataque, você ataca quatro vezes em vez de três.',
  },
];

// ---------------------------------------------------------------------------
// Arquétipos Marciais (subclasse escolhida no 3º nível)
// ---------------------------------------------------------------------------

/**
 * As 16 manobras do Mestre da Batalha (PHB 2014).
 *
 * Texto fiel ao livro; o efeito em combate (gastar o dado, o teste de
 * resistência, o deslocamento) fica INFORMATIVO até a Fase 5 — o recurso dos
 * dados de superioridade e as escolhas das manobras já funcionam.
 */
const MANEUVER_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'commanders-strike',
    name: 'Ataque de Comando',
    description:
      'Ao usar a ação de Ataque, abra mão de um dos seus ataques e gaste um dado de superioridade: um aliado usa a reação dele para atacar, somando o dado ao dano.',
  },
  {
    key: 'disarming-attack',
    name: 'Ataque Desarmante',
    description:
      'Ao acertar, gaste um dado (some ao dano): o alvo faz teste de resistência de Força ou deixa cair um item que esteja empunhando.',
  },
  {
    key: 'distracting-strike',
    name: 'Ataque Distrativo',
    description:
      'Ao acertar, gaste um dado (some ao dano): o próximo ataque de outra criatura contra o alvo tem vantagem.',
  },
  {
    key: 'evasive-footwork',
    name: 'Trabalho de Pés Evasivo',
    description:
      'Ao se mover, gaste um dado e some ao seu CA até você parar de se mover.',
  },
  {
    key: 'feinting-attack',
    name: 'Ataque de Finta',
    description:
      'Use a ação bônus e gaste um dado para fintar uma criatura a até 1,5 m (5 pés): vantagem no seu próximo ataque contra ela neste turno e o dado entra no dano.',
  },
  {
    key: 'goading-attack',
    name: 'Ataque Provocador',
    description:
      'Ao acertar, gaste um dado (some ao dano): o alvo faz teste de resistência de Sabedoria; se falhar, tem desvantagem em ataques contra outras criaturas até o fim do seu próximo turno.',
  },
  {
    key: 'lunging-attack',
    name: 'Ataque Estendido',
    description:
      'Ao atacar, gaste um dado (some ao dano): seu alcance aumenta em 1,5 m (5 pés) neste ataque.',
  },
  {
    key: 'maneuvering-attack',
    name: 'Ataque Manobrado',
    description:
      'Ao acertar, gaste um dado (some ao dano): um aliado usa a reação para se mover até metade do deslocamento dele, sem provocar ataques de oportunidade do alvo.',
  },
  {
    key: 'menacing-attack',
    name: 'Ataque Ameaçador',
    description:
      'Ao acertar, gaste um dado (some ao dano): o alvo faz teste de resistência de Sabedoria; se falhar, fica amedrontado até o fim do seu próximo turno.',
  },
  {
    key: 'parry',
    name: 'Aparar',
    description:
      'Quando outra criatura acertar você com um ataque corpo a corpo, use a reação e gaste um dado: reduza o dano em dado de superioridade + mod. de Destreza.',
  },
  {
    key: 'precision-attack',
    name: 'Ataque Preciso',
    description:
      'Ao atacar, gaste um dado e some à rolagem de ataque (antes ou depois de rolar, mas antes de saber o resultado).',
  },
  {
    key: 'pushing-attack',
    name: 'Ataque de Empurrão',
    description:
      'Ao acertar, gaste um dado (some ao dano): o alvo faz teste de resistência de Força; se falhar, é empurrado até 4,5 m (15 pés).',
  },
  {
    key: 'rally',
    name: 'Reunir',
    description:
      'Use a ação bônus e gaste um dado: um aliado ganha PV temporários iguais ao dado + mod. de Carisma.',
  },
  {
    key: 'riposte',
    name: 'Contra-ataque',
    description:
      'Quando uma criatura errar um ataque corpo a corpo contra você, use a reação e gaste um dado para atacá-la, somando o dado ao dano.',
  },
  {
    key: 'sweeping-attack',
    name: 'Ataque Amplo',
    description:
      'Ao acertar, gaste um dado e escolha outra criatura a até 1,5 m (5 pés) do alvo: ela sofre dano igual ao resultado do dado se o seu ataque também a teria acertado.',
  },
  {
    key: 'trip-attack',
    name: 'Ataque de Derrubar',
    description:
      'Ao acertar, gaste um dado (some ao dano): o alvo (Grande ou menor) faz teste de resistência de Força; se falhar, cai no chão.',
  },
];

const FIGHTER_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'champion',
    name: 'Campeão',
    description:
      'Guerreiro que confia no corpo: acerta o golpe decisivo com mais facilidade, resiste mais que os outros e vira o atleta mais completo da mesa.',
    features: [
      {
        id: 'improved-critical',
        name: 'Crítico Aprimorado',
        level: 3,
        description:
          'Seus ataques com arma e desarmados acertam criticamente com 19 ou 20 no d20.',
        effect: { type: 'critThreshold', value: 19, name: 'Crítico Aprimorado' },
      },
      {
        id: 'remarkable-athlete',
        name: 'Atleta Extraordinário',
        level: 7,
        description:
          'Some METADE do seu bônus de proficiência (arredondada para CIMA) a qualquer teste de Força, Destreza ou Constituição que ainda não inclua o bônus completo — vale para as perícias desses atributos em que você não é proficiente e para a iniciativa. Também soma 1,5 m (5 pés) na distância de corrida de salto.',
        // Arredonda para CIMA (o padrão do efeito é para baixo) e nunca soma
        // com o Pau para Toda Obra do bardo: vale o maior valor.
        effect: { type: 'halfProficiency', target: 'physicalChecks', round: 'up' },
      },
      {
        id: 'champion-fighting-style',
        name: 'Estilo de Luta Adicional',
        level: 10,
        description: 'Você adota outro Estilo de Luta à sua escolha.',
        choice: { prompt: 'Estilo de Luta Adicional', count: 1, options: [...ALL_FIGHTING_STYLES] },
      },
      {
        id: 'superior-critical',
        name: 'Crítico Superior',
        level: 15,
        description: 'Seus ataques com arma e desarmados acertam criticamente com 18, 19 ou 20.',
        effect: { type: 'critThreshold', value: 18, name: 'Crítico Superior' },
      },
      // PENDENTE (Fase 5): a regeneração é no início do turno de combate.
      {
        id: 'survivor',
        name: 'Sobrevivente',
        level: 18,
        description:
          'No início de cada turno seu, recupere 5 + mod. de Constituição pontos de vida se estiver com no máximo metade dos PV e não estiver a 0. Você também estabiliza ao começar o turno com 0 PV (recuperando-se com 1 PV depois de 1d4 horas).',
      },
    ],
  },
  {
    id: 'battle-master',
    name: 'Mestre da Batalha',
    description:
      'Guerreiro que estuda a guerra como ciência: comanda aliados, desarma e derruba inimigos gastando dados de superioridade.',
    features: [
      {
        id: 'combat-superiority',
        name: 'Superioridade em Combate',
        level: 3,
        description:
          'Você aprende manobras alimentadas por dados de superioridade (d8; d10 no 10º nível e d12 no 18º). Dados: 4 no 3º nível, 5 no 7º e 6 no 15º — recuperados num descanso curto ou longo. CD das manobras = 8 + proficiência + o MAIOR dos modificadores de Força ou Destreza.',
        effect: {
          type: 'resource',
          id: 'superiority-dice',
          name: 'Dados de Superioridade',
          resource: {
            name: 'Dados de Superioridade',
            recharge: 'short',
            maxByLevel: [
              { level: 3, value: 4 },
              { level: 7, value: 5 },
              { level: 15, value: 6 },
            ],
          },
        },
      },
      {
        id: 'maneuvers',
        name: 'Manobras',
        level: 3,
        description:
          'Você conhece três manobras à sua escolha (mais duas no 7º nível, duas no 10º e duas no 15º).',
        choice: { prompt: 'Manobras conhecidas', count: 3, options: [...MANEUVER_OPTIONS] },
      },
      {
        id: 'student-of-war',
        name: 'Estudante da Guerra',
        level: 3,
        description:
          'Você ganha proficiência com uma ferramenta de artesão à sua escolha.',
        choice: { prompt: 'Ferramenta de artesão', count: 1, options: [...ARTISAN_TOOL_OPTIONS] },
      },
      {
        id: 'maneuvers-7',
        name: 'Manobras',
        level: 7,
        description: 'Você conhece mais duas manobras.',
        choice: { prompt: 'Manobras (nível 7)', count: 2, options: [...MANEUVER_OPTIONS] },
      },
      {
        id: 'know-your-enemy',
        name: 'Conheça seu Inimigo',
        level: 7,
        description:
          'Se você passar ao menos 1 minuto observando ou interagindo com uma criatura, o mestre revela o que ela tem de melhor e de pior nas capacidades (Força, Destreza, Constituição, CA, PV, imunidades, resistências...).',
      },
      {
        id: 'maneuvers-10',
        name: 'Manobras',
        level: 10,
        description: 'Você conhece mais duas manobras; seus dados de superioridade viram d10.',
        choice: { prompt: 'Manobras (nível 10)', count: 2, options: [...MANEUVER_OPTIONS] },
      },
      {
        id: 'maneuvers-15',
        name: 'Manobras',
        level: 15,
        description: 'Você conhece mais duas manobras.',
        choice: { prompt: 'Manobras (nível 15)', count: 2, options: [...MANEUVER_OPTIONS] },
      },
      // PENDENTE (Fase 5): recuperar um dado ao rolar iniciativa sem nenhum.
      {
        id: 'relentless',
        name: 'Implacável',
        level: 15,
        description:
          'Quando você rolar iniciativa e não tiver nenhum dado de superioridade, recupera um dado.',
      },
      {
        id: 'combat-superiority-mastery',
        name: 'Superioridade em Combate Aprimorada',
        level: 18,
        description: 'Seus dados de superioridade viram d12.',
      },
    ],
  },
  {
    id: 'eldritch-knight',
    name: 'Cavaleiro Arcano',
    description:
      'Guerreiro que aprende magias de abjuração e evocação para reforçar a própria lâmina (terço-conjurador de Inteligência).',
    spellcasting: { type: 'third', ability: 'intelligence', learning: 'known' },
    features: [
      // PENDENTE (Fase 5): invocar/vincular as armas é uma ação.
      {
        id: 'weapon-bond',
        name: 'Vínculo com Arma',
        level: 3,
        description:
          'Você faz um ritual de 1 hora para vincular até duas armas: não pode ser desarmado delas a menos que esteja incapacitado, e pode invocá-las para a mão como ação bônus. Você não pode vincular uma arma mágica.',
      },
      {
        id: 'war-magic',
        name: 'Magia de Guerra',
        level: 7,
        description:
          'Ao usar a ação de Ataque, você pode lançar um truque como ação bônus (mesmo os que não sejam de abjuração ou evocação).',
      },
      {
        id: 'eldritch-strike',
        name: 'Golpe Místico',
        level: 10,
        description:
          'O alvo de um dos seus ataques de arma tem desvantagem no próximo teste de resistência contra uma magia sua lançada antes do fim do seu próximo turno.',
      },
      {
        id: 'arcane-charge',
        name: 'Carga Arcana',
        level: 15,
        description:
          'Ao usar Ataque Extra, você pode se teletransportar até 9 m (30 pés) como parte do ataque, para um espaço desocupado que veja. Não conta como deslocamento.',
      },
      {
        id: 'improved-war-magic',
        name: 'Magia de Guerra Aprimorada',
        level: 18,
        description:
          'Quando lançar uma magia com uma ação, você pode fazer um ataque corpo a corpo com arma como ação bônus.',
      },
    ],
  },
];

export const fighter: ClassDefinition = {
  key: 'fighter',
  name: 'Guerreiro',
  description:
    'Mestre de armas e armaduras — o combatente mais versátil e resistente do campo de batalha.',
  hitDie: 10,
  savingThrows: ['strength', 'constitution'],
  subclassLevel: 3, // Arquétipo Marcial
  spellcasting: { type: 'none', ability: null, learning: 'none' },
  features: FIGHTER_FEATURES,
  subclasses: FIGHTER_SUBCLASSES,
};
