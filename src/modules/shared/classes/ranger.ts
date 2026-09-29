import type {
  ClassDefinition,
  ClassFeatureDefinition,
  FeatureChoiceOption,
  SubclassDefinition,
} from './types.js';
import { RANGER_FIGHTING_STYLES } from './fighting-styles.js';

// ---------------------------------------------------------------------------
// Patrulheiro (Ranger) — PHB 2014
//
// A CONJURAÇÃO vem do registro da classe (`spellcasting`: meio-conjurador de
// magias CONHECIDAS de Sabedoria, a partir do 2º nível) — ver `ownCasterLevel`
// e `preparedSpellCountFor`.
//
// PENDENTES registrados nas características:
//   • Fase 5 (combate por ação/reação/rolagem de dado): os benefícios de
//     Inimigo Favorito e Explorador Nato nos testes/rastreamento, Ataque Extra,
//     Passo Terrestre, Esconder-se à Vista de Todos, Desaparecer, Sentidos
//     Selvagens e Matador de Inimigos.
//
// SUBCLASSES: Caçador e Senhor das Feras (arquétipo escolhido no 3º nível).
// No Caçador, CADA nível de escolha (3, 7, 11 e 15) é uma característica com a
// sua própria escolha — o mecanismo genérico grava uma por id.
// ---------------------------------------------------------------------------

/** Tipos de criatura do Inimigo Favorito (PHB 2014). */
const CREATURE_TYPES: FeatureChoiceOption[] = [
  { key: 'aberrations', name: 'Aberrações' },
  { key: 'beasts', name: 'Bestas' },
  { key: 'celestials', name: 'Celestiais' },
  { key: 'constructs', name: 'Constructos' },
  { key: 'dragons', name: 'Dragões' },
  { key: 'elementals', name: 'Elementais' },
  { key: 'fey', name: 'Fadas' },
  { key: 'fiends', name: 'Ínferos' },
  { key: 'giants', name: 'Gigantes' },
  { key: 'monstrosities', name: 'Monstruosidades' },
  { key: 'oozes', name: 'Lodos' },
  { key: 'plants', name: 'Plantas' },
  { key: 'undead', name: 'Mortos-vivos' },
];

/** Terrenos favoritos do Explorador Nato (PHB 2014). */
const FAVORED_TERRAINS: FeatureChoiceOption[] = [
  { key: 'arctic', name: 'Ártico' },
  { key: 'coast', name: 'Costa' },
  { key: 'desert', name: 'Deserto' },
  { key: 'forest', name: 'Floresta' },
  { key: 'grassland', name: 'Planície' },
  { key: 'mountain', name: 'Montanha' },
  { key: 'swamp', name: 'Pântano' },
  { key: 'underdark', name: 'Subterrâneo' },
];

/** Texto do bônus do Inimigo Favorito (usado nas três características). */
const FAVORED_ENEMY_NOTE =
  'Você tem vantagem em Sobrevivência para rastrear o tipo escolhido e em Inteligência para recordar informações sobre ele; ao rastreá-lo, sabe o número exato, o tamanho e há quanto tempo passou.';

const RANGER_FEATURES: ClassFeatureDefinition[] = [
  // PENDENTE (Fase 5): vantagem e informações de rastreamento só valem em cena.
  {
    id: 'favored-enemy',
    name: 'Inimigo Favorito',
    level: 1,
    description: `Escolha um tipo de criatura como inimigo favorito (um tipo novo no 6º e no 14º nível). ${FAVORED_ENEMY_NOTE}`,
    choice: { prompt: 'Inimigo Favorito', count: 1, options: [...CREATURE_TYPES] },
  },
  // PENDENTE (Fase 5): os benefícios de terreno valem durante a exploração.
  {
    id: 'natural-explorer',
    name: 'Explorador Nato',
    level: 1,
    description:
      'Escolha um terreno favorito (um terreno novo no 6º nível e dois no 10º). No terreno escolhido você ignora terreno difícil, não se perde, fica alerta mesmo em viagem, se move furtivamente sozinho em ritmo normal, encontra o dobro de comida e conhece os caminhos com precisão.',
    choice: { prompt: 'Explorador Nato', count: 1, options: [...FAVORED_TERRAINS] },
  },
  {
    // Id com a classe: Guerreiro e Paladino também têm Estilo de Luta e as
    // escolhas são guardadas por id de característica (`classState.choices`).
    id: 'ranger-fighting-style',
    name: 'Estilo de Luta',
    level: 2,
    description:
      'Você adota um estilo de combate à sua escolha. Só a Defesa tem efeito automático (+1 CA com armadura); os demais ficam registrados como escolha (o efeito em combate entra na Fase 5).',
    choice: { prompt: 'Estilo de Luta', count: 1, options: [...RANGER_FIGHTING_STYLES] },
  },
  {
    id: 'primeval-awareness',
    name: 'Consciência Primitiva',
    level: 3,
    description:
      'Como ação, sinta quantas criaturas do tipo do seu Inimigo Favorito estão a até 8 km (5 milhas) e em que direção. Um uso, recuperado num descanso curto ou longo.',
    effect: {
      type: 'resource',
      id: 'primeval-awareness',
      name: 'Consciência Primitiva',
      resource: { name: 'Consciência Primitiva', recharge: 'short', max: 1 },
    },
  },
  {
    id: 'extra-attack',
    name: 'Ataque Extra',
    level: 5,
    description:
      'Ao usar a ação de Ataque, você ataca duas vezes em vez de uma. Não se acumula com o Ataque Extra de outra classe.',
  },
  {
    id: 'favored-enemy-6',
    name: 'Inimigo Favorito',
    level: 6,
    description: `Escolha mais um tipo de criatura como inimigo favorito. ${FAVORED_ENEMY_NOTE}`,
    choice: { prompt: 'Inimigo Favorito (nível 6)', count: 1, options: [...CREATURE_TYPES] },
  },
  {
    id: 'natural-explorer-6',
    name: 'Explorador Nato',
    level: 6,
    description:
      'Escolha mais um terreno favorito — a 10º nível você escolhe mais dois.',
    choice: { prompt: 'Explorador Nato (nível 6)', count: 1, options: [...FAVORED_TERRAINS] },
  },
  {
    id: 'natural-explorer-10',
    name: 'Explorador Nato',
    level: 10,
    description: 'Escolha mais dois terrenos favoritos.',
    choice: { prompt: 'Explorador Nato (nível 10)', count: 2, options: [...FAVORED_TERRAINS] },
  },
  {
    id: 'hide-in-plain-sight',
    name: 'Esconder-se à Vista de Todos',
    level: 10,
    description:
      'Você pode tentar se esconder mesmo quando apenas camuflado por folhagem, lama, neve ou outro fenômeno natural.',
  },
  // PENDENTE (Fase 5): esconder-se e não deixar rastros são ações em cena.
  {
    id: 'vanish',
    name: 'Desaparecer',
    level: 14,
    description:
      'Você pode usar a ação Esconder-se como ação bônus e não pode ser rastreado por meios não mágicos, a menos que queira.',
  },
  {
    id: 'favored-enemy-14',
    name: 'Inimigo Favorito',
    level: 14,
    description: `Escolha mais um tipo de criatura como inimigo favorito. ${FAVORED_ENEMY_NOTE}`,
    choice: { prompt: 'Inimigo Favorito (nível 14)', count: 1, options: [...CREATURE_TYPES] },
  },
  {
    id: 'feral-senses',
    name: 'Sentidos Selvagens',
    level: 18,
    description:
      'Você ganha percepção às cegas de 9 m (30 pés): percebe criaturas escondidas de você por escuridão, névoa, folhagem densa ou qualquer outro tipo de obscurecimento.',
  },
  {
    id: 'foe-slayer',
    name: 'Matador de Inimigos',
    level: 20,
    description:
      'Uma vez por turno, some o seu modificador de Sabedoria à rolagem de ataque ou de dano contra um inimigo favorito.',
  },
];

// ---------------------------------------------------------------------------
// Arquétipos de Patrulheiro (subclasse escolhida no 3º nível)
// ---------------------------------------------------------------------------

/** Presa do Caçador (3º nível): uma opção. */
const HUNTERS_PREY_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'colossus-slayer',
    name: 'Matador de Colossos',
    description:
      'Uma vez por turno, quando acertar uma criatura com um ataque de arma, você pode causar 1d8 de dano extra se ela estiver com menos pontos de vida que o máximo dela.',
  },
  {
    key: 'giant-killer',
    name: 'Matador de Gigantes',
    description:
      'Quando uma criatura Grande ou maior acertar ou errar um ataque contra você, use a reação para atacá-la, se puder vê-la.',
  },
  {
    key: 'horde-breaker',
    name: 'Destruidor de Hordas',
    description:
      'Uma vez por turno, quando fizer um ataque de arma, você pode fazer outro ataque com a mesma arma contra uma criatura diferente a até 1,5 m (5 pés) do alvo original e dentro do seu alcance.',
  },
];

/** Táticas Defensivas (7º nível): uma opção. */
const DEFENSIVE_TACTICS_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'escape-the-horde',
    name: 'Escapar da Horda',
    description: 'Ataques de oportunidade contra você têm desvantagem.',
  },
  {
    key: 'multiattack-defense',
    name: 'Defesa contra Multiataque',
    description:
      'Quando uma criatura acertar você com um ataque, você ganha +4 de CA contra cada ataque subsequente dela no mesmo turno.',
  },
  {
    key: 'steel-will',
    name: 'Vontade de Aço',
    description: 'Você tem vantagem em testes de resistência contra ser amedrontado.',
  },
];

/** Multiataque (11º nível): uma opção. */
const MULTIATTACK_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'volley',
    name: 'Saraivada',
    description:
      'Use a ação para fazer um ataque à distância contra qualquer número de criaturas a até 3 m (10 pés) de um ponto que você possa ver, desde que estejam dentro do alcance da arma.',
  },
  {
    key: 'whirlwind-attack',
    name: 'Ataque Giratório',
    description:
      'Use a ação para fazer um ataque corpo a corpo contra qualquer número de criaturas a até 1,5 m (5 pés) de você.',
  },
];

/** Defesa Superior do Caçador (15º nível): uma opção. */
const SUPERIOR_HUNTERS_DEFENSE_OPTIONS: FeatureChoiceOption[] = [
  {
    key: 'evasion',
    name: 'Evasão',
    description:
      'Em testes de resistência de Destreza para sofrer metade do dano, você não sofre dano se passar e sofre apenas metade se falhar.',
  },
  {
    key: 'stand-against-the-tide',
    name: 'Resistir à Maré',
    description:
      'Quando uma criatura hostil errar um ataque contra você, use a reação para forçar essa criatura a fazer o mesmo ataque contra outra criatura à sua escolha.',
  },
  {
    key: 'uncanny-dodge',
    name: 'Esquiva Sobrenatural',
    description:
      'Quando um atacante que você possa ver acertar você, use a reação para reduzir o dano do ataque à metade.',
  },
];

const RANGER_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'hunter',
    name: 'Caçador',
    description:
      'O arquétipo clássico do patrulheiro: um especialista em abater o alvo certo da forma certa, escolhendo a cada etapa em que tipo de presa e de ameaça se tornou mestre.',
    features: [
      // PENDENTE (Fase 5): os efeitos dependem da cena (dano por turno, reação,
      // ataque extra contra outra criatura, +4 de CA no mesmo turno).
      {
        id: 'hunters-prey',
        name: 'Presa do Caçador',
        level: 3,
        description: 'Você escolhe um dos talentos de caça a seguir.',
        choice: {
          prompt: 'Presa do Caçador',
          count: 1,
          options: [...HUNTERS_PREY_OPTIONS],
        },
      },
      {
        id: 'defensive-tactics',
        name: 'Táticas Defensivas',
        level: 7,
        description: 'Você escolhe um dos talentos defensivos a seguir.',
        choice: {
          prompt: 'Táticas Defensivas',
          count: 1,
          options: [...DEFENSIVE_TACTICS_OPTIONS],
        },
      },
      {
        id: 'multiattack',
        name: 'Multiataque',
        level: 11,
        description: 'Você escolhe um dos talentos de multiataque a seguir.',
        choice: {
          prompt: 'Multiataque',
          count: 1,
          options: [...MULTIATTACK_OPTIONS],
        },
      },
      {
        id: 'superior-hunters-defense',
        name: 'Defesa Superior do Caçador',
        level: 15,
        description: 'Você escolhe um dos talentos defensivos superiores a seguir.',
        choice: {
          prompt: 'Defesa Superior do Caçador',
          count: 1,
          options: [...SUPERIOR_HUNTERS_DEFENSE_OPTIONS],
        },
      },
    ],
  },
  {
    id: 'beast-master',
    name: 'Senhor das Feras',
    description:
      'O patrulheiro que luta ao lado de um companheiro animal treinado: juntos, vocês são uma só força de caça.',
    features: [
      // PENDENTE: o companheiro animal não é modelado na ficha (a Fase 5 cuida
      // do combate e uma ficha própria do companheiro fica para depois).
      {
        id: 'rangers-companion',
        name: 'Companheiro do Patrulheiro',
        level: 3,
        description:
          'Você adquire um companheiro animal (o mestre escolhe a ficha, se você não tiver um animal já; ver "Companheiro do Patrulheiro" no PHB). Ele é leal a você, obedece aos seus comandos e age no seu turno: usa a sua proficiência, ganha os seus bônus e os PV gastos nele saem dos seus. **pendente: ficha do companheiro**',
      },
      {
        id: 'exceptional-training',
        name: 'Treinamento Excepcional',
        level: 7,
        description:
          'No seu turno, use uma ação bônus para comandar o companheiro a usar a ação Ajudar, Correr, Desengajar, Esquivar ou Disparada. Quando o companheiro usa Ajudar, ele pode atender a uma criatura a até 9 m (30 pés) de si.',
      },
      // PENDENTE (Fase 5): o companheiro ataca duas vezes quando comandado.
      {
        id: 'bestial-fury',
        name: 'Fúria Bestial',
        level: 11,
        description:
          'Quando você comanda o companheiro a usar a ação Ataque, ele pode atacar duas vezes.',
      },
      {
        id: 'share-spells',
        name: 'Compartilhar Magias',
        level: 15,
        description:
          'Quando você lança uma magia que tem você como alvo, você pode fazer com que ela também afete o companheiro, se ele estiver a até 9 m (30 pés) de você.',
      },
    ],
  },
];

export const ranger: ClassDefinition = {
  key: 'ranger',
  name: 'Patrulheiro',
  hitDie: 10,
  savingThrows: ['strength', 'dexterity'],
  subclassLevel: 3, // Arquétipo de Patrulheiro
  spellcasting: { type: 'half', ability: 'wisdom', learning: 'known' },
  features: RANGER_FEATURES,
  subclasses: RANGER_SUBCLASSES,
};
