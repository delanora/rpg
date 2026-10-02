import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

// ---------------------------------------------------------------------------
// Druida (Druid) — PHB 2014
// ---------------------------------------------------------------------------

const DRUID_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'druidic',
    name: 'Druídico',
    level: 1,
    description:
      'Você conhece a língua secreta dos druidas e pode usá-la para deixar mensagens escondidas. Outros druidas identificam essas mensagens automaticamente.',
  },
  {
    id: 'wild-shape',
    name: 'Forma Selvagem',
    level: 2,
    description:
      'Como ação, transforme-se numa fera já vista. Usos por descanso curto ou longo: 2 (níveis 2-19) e ilimitado no 20º. Formas permitidas: até CR 1/4 sem deslocamento de voo/natação (nível 2), até CR 1/2 ainda sem voo (nível 4) e até CR 1, agora podendo voar, a partir do nível 8.',
    effects: [
      {
        type: 'resource',
        id: 'wild-shape',
        name: 'Forma Selvagem',
        resource: {
          name: 'Forma Selvagem',
          recharge: 'short',
          maxByLevel: [
            { level: 2, value: 2 },
            { level: 20, value: -1 },
          ],
        },
      },
      {
        type: 'wildShape',
        scaling: [
          { level: 2, value: 0.25 },
          { level: 4, value: 0.5 },
          { level: 8, value: 1 },
        ],
      },
    ],
  },
  {
    id: 'timeless-body',
    name: 'Corpo Atemporal',
    level: 18,
    description:
      'Você envelhece apenas 1 ano para cada 10 anos de vida e não pode ser envelhecido magicamente.',
  },
  {
    id: 'beast-spells',
    name: 'Magias da Fera',
    level: 18,
    description:
      'Você pode lançar magias enquanto estiver na forma selvagem, realizando os gestos e a fala apesar da forma de fera.',
  },
  {
    id: 'archdruid',
    name: 'Arquidruida',
    level: 20,
    description:
      'Você usa a Forma Selvagem um número ilimitado de vezes. Além disso, ignora componentes verbais e somáticos de magias de druida e os componentes materiais sem custo.',
  },
];

const DRUID_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'land',
    name: 'Círculo da Terra',
    description:
      'Druida que canaliza a magia do território onde foi iniciado, ganhando magias de círculo ligadas ao terreno e recuperação de espaços.',
    features: [
      {
        id: 'bonus-cantrip',
        name: 'Truque Adicional',
        level: 2,
        description: 'Você aprende um truque de druida adicional.',
      },
      {
        id: 'circle-spells',
        name: 'Magias do Círculo',
        level: 2,
        description:
          'Escolha um terreno: Ártico (Imobilizar Pessoa, Crescer Espinhos / Nevasca, Lentidão / Liberdade de Movimento, Tempestade de Gelo / Comungar com a Natureza, Cone de Frio); Costa (Imagem Espelhada, Passo Enevoado / Respirar na Água, Caminhar na Água / Controlar Água, Liberdade de Movimento / Conjurar Elemental, Vidência); Deserto (Desfoque, Silêncio / Criar Comida e Água, Proteção contra Energia / Apodrecer, Terreno Alucinatório / Praga de Insetos, Muralha de Pedra); Floresta (Pele de Casca, Escalada de Aranha / Invocar Relâmpagos, Crescer Plantas / Adivinhação, Liberdade de Movimento / Comungar com a Natureza, Passo de Árvore); Charco (Escuridão, Flecha Ácida / Caminhar na Água, Nuvem Fétida / Liberdade de Movimento, Localizar Criatura / Praga de Insetos, Vidência); Montanha (Escalada de Aranha, Crescer Espinhos / Relâmpago, Fundir-se à Pedra / Moldar Pedra, Pele de Pedra / Passagem de Parede, Muralha de Pedra); Campina (Invisibilidade, Passar sem Deixar Rastros / Luz do Dia, Pressa / Adivinhação, Liberdade de Movimento / Sonho, Praga de Insetos); Selva (Escalada de Aranha, Teia / Forma Gasosa, Nuvem Fétida / Invisibilidade Maior, Moldar Pedra / Nuvem Venenosa, Praga de Insetos). As magias do terreno estão sempre preparadas e não contam no limite de magias preparadas.',
      },
      {
        id: 'natural-recovery',
        name: 'Recuperação Natural',
        level: 2,
        description:
          'Uma vez por dia, durante um descanso curto, recupere espaços de magia gastos totalizando metade do seu nível de druida, arredondado para cima. Nenhum espaço de 6º nível ou superior pode ser recuperado assim.',
      },
      {
        id: 'lands-stride',
        name: 'Passada da Natureza',
        level: 6,
        description:
          'Mover-se por terreno difícil não mágico não custa movimento extra. Você também atravessa plantas não mágicas sem ser retardado e tem vantagem em salvaguardas contra plantas criadas magicamente.',
      },
      {
        id: 'natures-ward',
        name: 'Proteção da Natureza',
        level: 10,
        description:
          'Você é imune a enfeitiçado e amedrontado por elementais e feéricos, e é imune a doenças e veneno.',
      },
      {
        id: 'natures-sanctuary',
        name: 'Santuário da Natureza',
        level: 14,
        description:
          'Criaturas que tentarem atacar você devem antes passar num teste de resistência de Sabedoria (CD = CD de magia). Se falharem, não conseguem atacar e devem escolher outro alvo (ou perdem o ataque).',
      },
    ],
  },
  {
    id: 'moon',
    name: 'Círculo da Lua',
    description:
      'Druida guardião que domina a Forma Selvagem e assume formas de fera muito mais poderosas.',
    features: [
      {
        id: 'combat-wild-shape',
        name: 'Forma Selvagem de Combate',
        level: 2,
        description:
          'Você pode usar a Forma Selvagem como ação bônus. Enquanto transformado, pode gastar um espaço de magia para recuperar 1d8 pontos de vida por nível do espaço gasto.',
      },
      {
        id: 'circle-forms',
        name: 'Formas Circulares',
        level: 2,
        description:
          'Você pode usar a Forma Selvagem para assumir formas de fera de CR igual ou inferior a 1 já no nível 2, escalando pelo seu nível de druida: CR 1 (nível 2), CR 2 (6º), CR 3 (9º), CR 4 (12º), CR 5 (15º) e CR 6 (18º).',
        effect: {
          type: 'wildShape',
          override: true,
          scaling: [
            { level: 2, value: 1 },
            { level: 6, value: 2 },
            { level: 9, value: 3 },
            { level: 12, value: 4 },
            { level: 15, value: 5 },
            { level: 18, value: 6 },
          ],
        },
      },
      {
        id: 'primal-strike',
        name: 'Golpe Primordial',
        level: 6,
        description:
          'Seus ataques na Forma Selvagem contam como mágicos para superar resistência e imunidade a dano não mágico.',
      },
      {
        id: 'elemental-wild-shape',
        name: 'Forma Selvagem Elemental',
        level: 10,
        description:
          'Gaste 2 usos de Forma Selvagem para assumir a forma de um elemental (ar, água, fogo ou terra).',
      },
      {
        id: 'thousand-forms',
        name: 'Mil Formas',
        level: 14,
        description:
          'Você pode lançar a magia Disfarce (Alterar Personagem) à vontade.',
      },
    ],
  },
];

export const druid: ClassDefinition = {
  key: 'druid',
  name: 'Druida',
  description:
    'Guardião do equilíbrio natural, que conjura magias da natureza e assume formas animais.',
  hitDie: 8,
  savingThrows: ['intelligence', 'wisdom'],
  subclassLevel: 2, // Círculo Druídico
  spellcasting: { type: 'full', ability: 'wisdom', learning: 'prepared' },
  features: DRUID_FEATURES,
  subclasses: DRUID_SUBCLASSES,
};
