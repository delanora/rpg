import type { Race, RaceTrait } from './types.js';

/**
 * Elfo (Elf) — PHB 2014, com as três sub-raças do Livro do Jogador: Alto Elfo,
 * Elfo da Floresta e Drow.
 *
 * Segunda raça do catálogo ESTRUTURADO (`shared/races/`). Como no Draconato,
 * os efeitos mecânicos são DECLARADOS aqui, mas ainda NÃO são processados: a
 * integração com o `derived` (motor de raça) é etapa futura. O `RACE_CATALOG`
 * de `shared/creation.ts` (que alimenta o assistente e o compêndio) segue
 * intocado — a substituição é o Prompt 2.10.
 *
 * MAGIAS RACIAIS (truque do Alto Elfo e Magia Drow): ficam DESCRITIVAS por
 * enquanto, porque o catálogo de magias ainda não existe (`SPELL_CATALOG` é
 * `[]`, não há `shared/spells/`). Quando ele existir, basta declarar a escolha
 * (`hasChoices`) com as opções vindas do catálogo — sem reescrever os traços.
 * Ver os TODOs em cada traço.
 *
 * `speed`/`darkvision` estão em METROS (1 pé = 0,3 m: 30 pés = 9 m, 60 pés =
 * 18 m, 120 pés = 36 m, 35 pés = 10,5 m).
 */

/** Treinamento com Arma Élfica: comum ao Alto Elfo e ao Elfo da Floresta. */
const ELVEN_WEAPON_TRAINING: RaceTrait = {
  id: 'elven-weapon-training',
  name: 'Treinamento com Arma Élfica',
  // Proficiência de ARMA só é exibida como texto hoje (ProficienciesState.weapons);
  // não há tipo de efeito de proficiência no union — nada a declarar por ora.
  description:
    'Você tem proficiência com espadas longas, espadas curtas, arcos longos e arcos curtos.',
};

/**
 * Ancestralidade Feérica — o Mesmo traço (e o mesmo dado) do Elfo e do
 * Meio-Elfo. Exportado para o Meio-Elfo reusar exatamente esta estrutura.
 */
export const FEY_ANCESTRY: RaceTrait = {
  id: 'fey-ancestry',
  name: 'Ancestralidade Feérica',
  description:
    'Você tem vantagem em testes de resistência para evitar ser enfeitiçado, e magia ' +
    'não pode colocá-lo para dormir.',
  // Vantagem condicional em salvaguarda e imunidade a uma condição mágica NÃO
  // têm tipo de efeito próprio — vão como 'other' com a descrição.
  mechanicalEffect: {
    type: 'other',
    id: 'fey-ancestry',
    name: 'Ancestralidade Feérica',
    notes:
      'Vantagem em salvaguardas contra ser enfeitiçado; imune a ser posto para dormir por ' +
      'magia. Não modelado (nem vantagem condicional nem imunidade a condição têm tipo).',
  },
};

export const elf: Race = {
  id: 'elf',
  namePt: 'Elfo',
  nameEn: 'Elf',
  description:
    'Povo antigo e longevo, de sentidos aguçados e graça sobrenatural. As linhagens ' +
    'divergem entre a magia das torres, as matas e o Subterrâneo.',
  abilityScoreIncrease: [{ ability: 'dexterity', amount: 2 }],
  speed: 9,
  size: 'Medium',
  // 18 m = 60 pés (visão no escuro).
  darkvision: 18,
  // TODO: não há campo de idioma na ficha (o mesmo vale para o Draconato);
  // os idiomas ficam como texto informativo no traço/descrição.
  languages: ['Comum', 'Élfico'],
  traits: [
    {
      id: 'keen-senses',
      name: 'Sentidos Aguçados',
      description: 'Você tem proficiência na perícia Percepção.',
      // Declarado como DADO: a proficiência de perícia real é concedida pelo
      // motor de raça (futuro). A chave 'perception' é a canônica de SKILLS.
      mechanicalEffect: { type: 'skillProficiency', target: 'perception' },
    },
    FEY_ANCESTRY,
    {
      id: 'trance',
      name: 'Transe',
      description:
        'Elfos não precisam dormir. Em vez de 8 horas de sono, meditam em transe profundo 4 ' +
        'horas por dia (permanecendo conscientes) para obter os mesmos benefícios de um ' +
        'descanso longo de 8 horas.',
      // TODO(textual): sem automação enquanto o sistema de descanso não for revisado.
    },
  ],
  subraces: [
    {
      id: 'high-elf',
      namePt: 'Alto Elfo',
      abilityScoreIncrease: [{ ability: 'intelligence', amount: 1 }],
      traits: [
        ELVEN_WEAPON_TRAINING,
        {
          id: 'high-elf-cantrip',
          name: 'Truque',
          description:
            'Você conhece um truque da sua escolha da lista de truques do Mago. Inteligência ' +
            'é o atributo de conjuração dele.',
          // TODO(catálogo de magias): quando `shared/spells/` existir, declarar
          // hasChoices id 'high-elf-cantrip' com as opções de spellsByClass('wizard', 0)
          // e refletir o truque em character.spells como magia conhecida "de graça".
        },
      ],
    },
    {
      id: 'wood-elf',
      namePt: 'Elfo da Floresta',
      abilityScoreIncrease: [{ ability: 'wisdom', amount: 1 }],
      // Passo Ligeiro: 35 pés = 10,5 m (sobrescreve os 9 m da raça base).
      speed: 10.5,
      traits: [
        ELVEN_WEAPON_TRAINING,
        {
          id: 'fleet-of-foot',
          name: 'Passo Ligeiro',
          description: 'Seu deslocamento base de caminhada aumenta para 10,5 m (35 pés).',
        },
        {
          id: 'mask-of-the-wild',
          name: 'Máscara da Natureza Selvagem',
          description:
            'Você pode tentar se esconder mesmo quando apenas levemente obscurecido por ' +
            'folhagem, chuva forte, neve, névoa ou outro fenômeno natural.',
        },
      ],
    },
    {
      id: 'drow-elf',
      namePt: 'Drow',
      abilityScoreIncrease: [{ ability: 'charisma', amount: 1 }],
      // Visão no Escuro Superior: 120 pés = 36 m (sobrescreve os 18 m da base).
      darkvision: 36,
      traits: [
        {
          id: 'superior-darkvision',
          name: 'Visão no Escuro Superior',
          description: 'Sua visão no escuro alcança 36 m (120 pés).',
        },
        {
          id: 'drow-weapon-training',
          name: 'Treinamento com Arma Drow',
          description: 'Você tem proficiência com rapieiras, espadas curtas e bestas de mão.',
        },
        {
          id: 'sunlight-sensitivity',
          name: 'Sensibilidade à Luz Solar',
          description:
            'Você tem desvantagem em ataques e em testes de Percepção (Sabedoria) que ' +
            'dependam de visão quando você, o alvo do ataque ou o objeto a ser percebido ' +
            'estiver sob luz solar direta.',
          // TODO(textual): depende de um sistema de iluminação/linha de visão que
          // NÃO existe hoje — nada a implementar enquanto isso não existir.
        },
        {
          id: 'drow-magic',
          name: 'Magia Drow',
          description:
            'Você conhece o truque Luzes Dançantes. No 3º nível de PERSONAGEM, você aprende ' +
            'Fogo das Fadas e pode lançá-la uma vez por descanso longo; no 5º nível, aprende ' +
            'Escuridão e pode lançá-la uma vez por descanso longo. Carisma é o atributo de ' +
            'conjuração dessas magias.',
          // TODO(catálogo de magias): o catálogo de magias ainda não existe
          // (SPELL_CATALOG é []). Quando existir, ligar os truques (spellsByClass) e o
          // recurso de 1 uso por descanso longo escalonando pelo NÍVEL TOTAL DO
          // PERSONAGEM — mesma decisão da Arma de Sopro do Draconato: representado no
          // texto, sem tipo de efeito novo.
        },
      ],
    },
  ],
};
