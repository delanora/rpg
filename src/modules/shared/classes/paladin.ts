import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';
import { PALADIN_FIGHTING_STYLES } from './fighting-styles.js';

// ---------------------------------------------------------------------------
// Paladino (Paladin) — PHB 2014
//
// A CONJURAÇÃO vem do registro da classe (`spellcasting`: meio-conjurador
// preparado de Carisma) e o sistema já sabe que ela começa no 2º nível (nível 1
// sem espaços e sem magias preparadas) — ver `ownCasterLevel` e
// `preparedSpellCountFor`.
//
// PENDENTES registrados nas características:
//   • Fase 4 (espaços de magia na ficha): Destruição Divina e Destruição Divina
//     Aprimorada gastam espaços de magia;
//   • Fase 5 (combate por ação/reação/rolagem de dado): Sentido Divino, Mãos
//     Consagradas, Ataque Extra e o bônus das auras (o bônus numérico da Aura de
//     Proteção JÁ entra nas salvaguardas).
//
// SUBCLASSES: Devoção, Anciões e Vingança (juramento escolhido no 3º nível). A
// Canalizar Divindade (3º nível) pertence ao juramento e por isso está em cada
// subclasse, e não entre as características de classe.
// ---------------------------------------------------------------------------

const PALADIN_FEATURES: ClassFeatureDefinition[] = [
  // PENDENTE (Fase 5): usar o Sentido Divino é uma ação no turno.
  {
    id: 'divine-sense',
    name: 'Sentido Divino',
    level: 1,
    description:
      'Ação para detectar, até 18 m (60 pés), celestiais, ínferos e mortos-vivos (e consagrar ou profanar objetos). Usos = 1 + modificador de Carisma, recuperados num descanso longo.',
    effect: {
      type: 'resource',
      id: 'divine-sense',
      name: 'Sentido Divino',
      resource: {
        name: 'Sentido Divino',
        recharge: 'long',
        max: 1,
        abilityMod: 'charisma',
        min: 1,
      },
    },
  },
  // PENDENTE (Fase 5): gastar pontos da reserva de cura é uma ação no turno.
  {
    id: 'lay-on-hands',
    name: 'Mãos Consagradas',
    level: 1,
    description:
      'Reserva de cura de 5 × seu nível de paladino pontos. Com um toque, gaste quantos pontos quiser para recuperar PV de uma criatura (ou 5 pontos por doença/veneno curado), como ação. A reserva volta num descanso longo.',
    effect: {
      type: 'resource',
      id: 'lay-on-hands',
      name: 'Mãos Consagradas',
      resource: {
        name: 'Mãos Consagradas',
        recharge: 'long',
        perLevel: true,
        perLevelMultiplier: 5,
      },
    },
  },
  {
    // Id com a classe: Guerreiro e Patrulheiro também têm Estilo de Luta e as
    // escolhas são guardadas por id de característica (`classState.choices`).
    id: 'paladin-fighting-style',
    name: 'Estilo de Luta',
    level: 2,
    description:
      'Você adota um estilo de combate à sua escolha. Só a Defesa tem efeito automático (+1 CA com armadura); os demais ficam registrados como escolha (o efeito em combate entra na Fase 5).',
    choice: {
      prompt: 'Estilo de Luta',
      count: 1,
      options: [...PALADIN_FIGHTING_STYLES],
    },
  },
  // PENDENTE (Fases 4 e 5): a Destruição Divina gasta um espaço de magia de 1º+
  // e soma 2d8 de dano radiante (mais dados contra mortos-vivos e ínferos).
  {
    id: 'divine-smite',
    name: 'Destruição Divina',
    level: 2,
    description:
      'Quando acertar um ataque corpo a corpo com arma, você pode gastar um espaço de magia para causar 2d8 de dano radiante extra (um espaço de 2º nível ou mais soma 1d8 por nível acima do 1º). Contra mortos-vivos e ínferos, some mais 1d8. Depende dos espaços de magia (Fase 4/5).',
  },
  {
    id: 'divine-health',
    name: 'Saúde Divina',
    level: 3,
    description: 'A energia divina o torna imune a doenças.',
  },
  {
    id: 'extra-attack',
    name: 'Ataque Extra',
    level: 5,
    description:
      'Ao usar a ação de Ataque, você ataca duas vezes em vez de uma. Não se acumula com o Ataque Extra de outra classe.',
  },
  {
    id: 'aura-of-protection',
    name: 'Aura de Proteção',
    level: 6,
    description:
      'Enquanto estiver consciente, você e os aliados a até 3 m (10 pés) somam o seu modificador de Carisma (mínimo +1) a todos os testes de resistência. A 18º nível, o alcance passa a 9 m (30 pés).',
    effect: {
      type: 'saveBonus',
      abilityMod: 'charisma',
      minValue: 1,
      name: 'Aura de Proteção',
    },
  },
  {
    id: 'aura-of-courage',
    name: 'Aura de Coragem',
    level: 10,
    description:
      'Você e os aliados a até 3 m (10 pés) não podem ser amedrontados enquanto você estiver consciente. A 18º nível, o alcance passa a 9 m (30 pés).',
  },
  // PENDENTE (Fases 4 e 5): soma 1d8 radiante a TODO ataque corpo a corpo com
  // arma (a magia Destruição Divina passa a valer o mesmo). Informativo por ora.
  {
    id: 'improved-divine-smite',
    name: 'Destruição Divina Aprimorada',
    level: 11,
    description:
      'Você soma 1d8 de dano radiante a todo ataque corpo a corpo com arma; a magia Destruição Divina passa a usar a mesma regra.',
  },
  // PENDENTE (Fase 5): o toque que encerra uma magia sobre uma criatura é uma ação.
  {
    id: 'cleansing-touch',
    name: 'Toque Purificador',
    level: 14,
    description:
      'Ação para encerrar uma magia sobre uma criatura à sua escolha (ela precisa ter sido lançada por outra criatura). Usos = modificador de Carisma (mínimo 1), recuperados num descanso longo.',
    effect: {
      type: 'resource',
      id: 'cleansing-touch',
      name: 'Toque Purificador',
      resource: {
        name: 'Toque Purificador',
        recharge: 'long',
        abilityMod: 'charisma',
        min: 1,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Juramentos Sagrados (subclasse escolhida no 3º nível)
//
// CANALIZAR DIVINDADE: 1 uso, recuperado num descanso curto ou longo (o efeito
// está na característica que a concede, no juramento).
//
// MAGIAS DE JURAIMENTO: ficam SEMPRE preparadas e NÃO contam no limite de magias
// preparadas. O catálogo de magias só chega na Fase 4, então elas entram como
// texto na ficha (o nome de cada uma, no nível em que é liberada).
//
// PENDENTE (Fase 5): as duas opções de Canalizar Divindade, as auras (que valem
// para os ALIADOS) e os efeitos por turno (regeneração, transformações).
// ---------------------------------------------------------------------------

/** Efeito comum do recurso "Canalizar Divindade" (1 uso, descanso curto/longo). */
const CHANNEL_DIVINITY_EFFECT = {
  type: 'resource' as const,
  id: 'channel-divinity',
  name: 'Canalizar Divindade',
  resource: {
    name: 'Canalizar Divindade',
    recharge: 'short' as const,
    max: 1,
  },
};

/**
 * Regra comum das magias de juramento (Prompt 6.3). Os NOMES de cada faixa vêm
 * dos IDs declarados em `SubclassDefinition.oathSpells` — o DTO os traduz do
 * catálogo na hora de exibir (aba Magias e resumo do Level Up).
 */
const OATH_SPELLS_RULE =
  'Estas magias ficam SEMPRE preparadas e não contam no limite de magias preparadas; elas aparecem na aba Magias com o selo "Juramento".';

const PALADIN_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'devotion',
    name: 'Juramento de Devoção',
    description:
      'O juramento do ideal: honestidade, coragem, compaixão e honra. O paladino devoto é o exemplo vivo do bem — e a luz que os outros seguem.',
    oathSpells: {
      3: ['protection-from-evil-and-good', 'sanctuary'],
      5: ['lesser-restoration', 'zone-of-truth'],
      9: ['beacon-of-hope', 'dispel-magic'],
      13: ['freedom-of-movement', 'guardian-of-faith'],
      17: ['commune', 'flame-strike'],
    },
    features: [
      {
        id: 'channel-divinity-devotion',
        name: 'Canalizar Divindade',
        level: 3,
        description:
          'Um uso, recuperado num descanso curto ou longo. **Arma Sagrada**: some o modificador de Carisma às rolagens de ataque por 1 minuto (a arma emite luz); **Expulsar Profano**: como ação, expulse ínferos e mortos-vivos a até 9 m (30 pés) que possam ver ou ouvir você.',
        effect: CHANNEL_DIVINITY_EFFECT,
      },
      {
        id: 'oath-spells',
        name: 'Magias de Juramento',
        level: 3,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-5',
        name: 'Magias de Juramento',
        level: 5,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-9',
        name: 'Magias de Juramento',
        level: 9,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-13',
        name: 'Magias de Juramento',
        level: 13,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-17',
        name: 'Magias de Juramento',
        level: 17,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'aura-of-devotion',
        name: 'Aura de Devoção',
        level: 7,
        description:
          'Você e os aliados a até 3 m (10 pés) não podem ser enfeitiçados enquanto você estiver consciente. A 18º nível, o alcance passa a 9 m (30 pés).',
      },
      {
        id: 'purity-of-spirit',
        name: 'Pureza de Espírito',
        level: 15,
        description:
          'Você está sempre sob o efeito de Proteção contra o Bem e o Mal. Com uma ação, pode encerrar uma magia de encantamento ou de necromancia sobre si (1 uso por descanso longo).',
        effect: {
          type: 'resource',
          id: 'purity-of-spirit',
          name: 'Pureza de Espírito',
          resource: { name: 'Pureza de Espírito', recharge: 'long', max: 1 },
        },
      },
      {
        id: 'holy-nimbus',
        name: 'Halo Sagrado',
        level: 20,
        description:
          'Como ação, emita um halo de luz solar por 1 minuto: luz plena a até 18 m (60 pés), vantagem em testes de resistência contra magias de ínferos e mortos-vivos, e 10 pontos de dano radiante por turno para quem terminar o turno a até 9 m (30 pés). Um uso por descanso longo.',
        effect: {
          type: 'resource',
          id: 'holy-nimbus',
          name: 'Halo Sagrado',
          resource: { name: 'Halo Sagrado', recharge: 'long', max: 1 },
        },
      },
    ],
  },
  {
    id: 'ancients',
    name: 'Juramento dos Anciões',
    description:
      'O juramento da luz antiga: proteger a natureza, a vida e a beleza do mundo contra a escuridão que corrói tudo.',
    oathSpells: {
      3: ['ensnaring-strike', 'speak-with-animals'],
      5: ['moonbeam', 'misty-step'],
      9: ['plant-growth', 'protection-from-energy'],
      13: ['ice-storm', 'stoneskin'],
      17: ['commune-with-nature', 'tree-stride'],
    },
    features: [
      {
        id: 'channel-divinity-ancients',
        name: 'Canalizar Divindade',
        level: 3,
        description:
          'Um uso, recuperado num descanso curto ou longo. **Fúria da Natureza**: como ação, vinhas espectrais prendem uma criatura a até 3 m (10 pés) que você possa ver (resiste com Força ou Destreza, ou fica impedida); **Expulsar os Fiéis**: como ação, expulse fadas e ínferos a até 9 m (30 pés) que possam ver ou ouvir você.',
        effect: CHANNEL_DIVINITY_EFFECT,
      },
      {
        id: 'oath-spells',
        name: 'Magias de Juramento',
        level: 3,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-5',
        name: 'Magias de Juramento',
        level: 5,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-9',
        name: 'Magias de Juramento',
        level: 9,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-13',
        name: 'Magias de Juramento',
        level: 13,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-17',
        name: 'Magias de Juramento',
        level: 17,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'aura-of-warding',
        name: 'Aura de Resguardo',
        level: 7,
        description:
          'Você e os aliados a até 3 m (10 pés) têm RESISTÊNCIA ao dano de magias enquanto você estiver consciente. A 18º nível, o alcance passa a 9 m (30 pés).',
      },
      {
        id: 'undying-sentinel',
        name: 'Sentinela Imortal',
        level: 15,
        description:
          'Quando cair a 0 PV sem morrer, você pode ficar com 1 PV no lugar (1 uso por descanso longo). Você também não sofre os efeitos da idade e envelhece apenas 1 ano a cada 10.',
        effect: {
          type: 'resource',
          id: 'undying-sentinel',
          name: 'Sentinela Imortal',
          resource: { name: 'Sentinela Imortal', recharge: 'long', max: 1 },
        },
      },
      {
        id: 'elder-champion',
        name: 'Campeão Ancestral',
        level: 20,
        description:
          'Como ação, assume por 1 minuto a forma ancestral: recupera 10 PV no início de cada turno, lança magias de paladino como ação bônus (sem componentes verbais/somáticos) e causa 10 de dano radiante a quem acertar dentro de 3 m (10 pés). Um uso por descanso longo.',
        effect: {
          type: 'resource',
          id: 'elder-champion',
          name: 'Campeão Ancestral',
          resource: { name: 'Campeão Ancestral', recharge: 'long', max: 1 },
        },
      },
    ],
  },
  {
    id: 'vengeance',
    name: 'Juramento de Vingança',
    description:
      'O juramento do castigo: usar a violência para punir quem fez o mal, custe o que custar à própria alma.',
    oathSpells: {
      3: ['bane', 'hunters-mark'],
      5: ['hold-person', 'misty-step'],
      9: ['haste', 'protection-from-energy'],
      13: ['banishment', 'dimension-door'],
      17: ['hold-monster', 'scrying'],
    },
    features: [
      {
        id: 'channel-divinity-vengeance',
        name: 'Canalizar Divindade',
        level: 3,
        description:
          'Um uso, recuperado num descanso curto ou longo. **Abjurar Inimigo**: como ação, uma criatura a até 18 m (60 pés) que você possa ver fica amedrontada e com deslocamento 0 (resiste com Sabedoria); **Voto de Inimizade**: como ação bônus, você tem vantagem nos ataques contra uma criatura a até 3 m (10 pés) por 1 minuto ou até ela cair.',
        effect: CHANNEL_DIVINITY_EFFECT,
      },
      {
        id: 'oath-spells',
        name: 'Magias de Juramento',
        level: 3,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-5',
        name: 'Magias de Juramento',
        level: 5,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-9',
        name: 'Magias de Juramento',
        level: 9,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-13',
        name: 'Magias de Juramento',
        level: 13,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'oath-spells-17',
        name: 'Magias de Juramento',
        level: 17,
        description: OATH_SPELLS_RULE,
      },
      {
        id: 'relentless-avenger',
        name: 'Vingador Implacável',
        level: 7,
        description:
          'Seu deslocamento aumenta em 3 m (10 pés). Quando você move no seu turno em direção a uma criatura que jurou vingança (Voto de Inimizade ou o juramento de destino), nenhum terreno difícil custa movimento extra.',
      },
      {
        id: 'soul-of-vengeance',
        name: 'Alma de Vingança',
        level: 15,
        description:
          'Quando um alvo do seu Voto de Inimizade acertar você, use a reação para fazer um ataque corpo a corpo com arma contra ele.',
      },
      {
        id: 'avenging-angel',
        name: 'Anjo Vingador',
        level: 20,
        description:
          'Como ação, ganha asas espectrais por 1 hora: deslocamento de voo de 18 m (60 pés) e, uma vez por turno, causa medo a quem estiver a até 9 m (30 pés) (sabedoria resiste). Um uso por descanso longo.',
        effect: {
          type: 'resource',
          id: 'avenging-angel',
          name: 'Anjo Vingador',
          resource: { name: 'Anjo Vingador', recharge: 'long', max: 1 },
        },
      },
    ],
  },
];

export const paladin: ClassDefinition = {
  key: 'paladin',
  name: 'Paladino',
  description:
    'Cavaleiro sagrado que une aço e juramento: cura pelas mãos e protege os aliados com a aura.',
  hitDie: 10,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 3, // Juramento Sagrado
  spellcasting: { type: 'half', ability: 'charisma', learning: 'prepared' },
  features: PALADIN_FEATURES,
  subclasses: PALADIN_SUBCLASSES,
};
