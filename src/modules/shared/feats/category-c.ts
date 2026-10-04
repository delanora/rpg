import type { Feat } from './types.js';

/**
 * Talentos de CATEGORIA C: dependem de um SISTEMA PRÓPRIO ainda inexistente
 * (não é sobre ação/reação). Ficam só como texto + `other` + TODO explicando do
 * que cada um depende. Observador entra aqui com o +1 de atributo ativo, mas a
 * Percepção/Investigação passivas ficam pendentes; Alerta fica 100% texto.
 */
export const CATEGORY_C_FEATS: readonly Feat[] = [
  {
    id: 'elemental-adept',
    name: 'Adepto Elemental',
    description:
      'Escolha um tipo de dano (ácido, frio, fogo, elétrico ou trovejante): suas magias ignoram resistência a ele e tratam imunidade como resistência. // TODO: depende do sistema de resistência/imunidade por parcela de dano de magia (A7) e da escolha do tipo de dano.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'lucky',
    name: 'Sortudo',
    description:
      'Você tem 3 pontos de sorte. Pode gastar 1 para rolar um dado adicional em um ataque, teste ou salvaguarda seu, ou para forçar a rerrolagem de um ataque contra você. // TODO: depende de um recurso com gasto e de uma escolha interativa na rolagem (o luckyReroll automático do Halfling não cobre).',
    effects: [{ type: 'other' }],
  },
  {
    id: 'magic-initiate',
    name: 'Iniciação em Magia',
    description:
      'Escolha uma classe: você aprende dois truques e uma magia de 1º nível dela, usando o atributo de conjuração dessa classe. // TODO: depende do catálogo de magias (ainda incompleto) e de magias por talento.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'ritual-caster',
    name: 'Conjurador Ritual',
    description:
      'Você aprende duas magias ritualísticas de 1º nível de uma classe escolhida e pode copiar outras magias ritualísticas que encontrar. // TODO: depende do catálogo de magias e do sistema de rituais.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'spell-sniper',
    name: 'Atirador de Magias',
    description:
      'Suas magias de ataque dobram o alcance e ignoram cobertura parcial e três quartos. Aprender uma magia que exige ataque não precisa ser de perto. // TODO: depende do catálogo de magias e do sistema de alcance/cobertura.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'war-caster',
    name: 'Conjurador de Guerra',
    description:
      'Você tem vantagem em salvaguardas de Constituição para manter concentração, pode conjurar com as mãos ocupadas e pode fazer gestos somáticos mesmo com armas e escudo. // TODO (Fase 5 — motor de ações): a concentração e a conjuração com as mãos ocupadas dependem do motor de conjuração.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'skilled',
    name: 'Habilidoso',
    description:
      'Você ganha proficiência em quaisquer três perícias ou ferramentas. // TODO: depende de uma sub-escolha de três perícias/ferramentas concedida por talento (o skillProficiency existe, mas é race-only e fora do derived).',
    effects: [{ type: 'other' }],
  },
  {
    id: 'observant',
    name: 'Observador',
    description:
      'Aumente Inteligência ou Sabedoria em 1 (máx. 20). Você lê lábios e ganha +5 em Percepção e Investigação passivas. // TODO: o +5 nas passivas depende de um efeito de Percepção/Investigação passiva (hoje só a Percepção passiva é calculada, e não há bônus de perícia por talento).',
    abilityChoice: { options: ['intelligence', 'wisdom'], amount: 1 },
  },
  {
    id: 'alert',
    name: 'Alerta',
    description:
      'Você ganha +5 na iniciativa, não pode ser surpreendido enquanto estiver consciente e criaturas ocultas não têm vantagem nos ataques contra você. // TODO: o +5 na iniciativa depende de um efeito de bônus de iniciativa (o tipo "bonus" existe, mas não é processado); a imunidade a surpresa depende do motor de combate.',
    effects: [{ type: 'other' }],
  },
];
