import type { Race } from './types.js';

/**
 * Anão (Dwarf) — PHB 2014, com as duas sub-raças do Livro do Jogador: Anão da
 * Colina e Anão da Montanha.
 *
 * Terceira raça do catálogo ESTRUTURADO (`shared/races/`). Como nas anteriores,
 * os efeitos mecânicos são DECLARADOS aqui; a integração com o `derived` (motor
 * de raça) é etapa futura. Exceção deliberada: a **Robustez Anã** (Anão da
 * Colina) tem o PV aplicado/REVERTIDO de verdade quando o mestre troca a
 * raça/sub-raça pela ficha (ver `raceHpBonus` em `index.ts` e o tratamento no
 * serviço de personagens).
 *
 * `speed`/`darkvision` em METROS (1 pé = 0,3 m: 25 pés = 7,5 m, 60 pés = 18 m).
 */

/** Os três ofícios do PHB (ids estáveis do catálogo `shared/tools`). */
const DWARF_TOOL_OPTIONS = [
  { id: 'smith-tools', label: 'Ferramentas de Ferreiro' },
  { id: 'brewer-supplies', label: 'Ferramentas de Cervejeiro' },
  { id: 'mason-tools', label: 'Ferramentas de Pedreiro' },
];

export const dwarf: Race = {
  id: 'dwarf',
  namePt: 'Anão',
  nameEn: 'Dwarf',
  description:
    'Guerreiros resistentes e artesãos das montanhas, os anões são robustos, teimosos e ' +
    'conhecem a pedra como ninguém. Seu deslocamento de 7,5 m (25 pés) NÃO é reduzido por ' +
    'usar armadura pesada.',
  abilityScoreIncrease: [{ ability: 'constitution', amount: 2 }],
  speed: 7.5,
  size: 'Medium',
  // 18 m = 60 pés (visão no escuro).
  darkvision: 18,
  // TODO: não há campo de idioma na ficha; os idiomas ficam como texto no traço.
  languages: ['Comum', 'Anão'],
  traits: [
    {
      id: 'dwarven-resilience',
      name: 'Resiliência Anã',
      description:
        'Você tem vantagem em testes de resistência contra veneno e resistência a dano de ' +
        'veneno.',
      // DOIS efeitos num traço: resistência (legível por máquina) + vantagem
      // condicional (vai como 'other', pois o tipo 'save' só representa
      // proficiência de salvaguarda). Por isso `mechanicalEffects`, não
      // `mechanicalEffect`.
      mechanicalEffects: [
        { type: 'resistance', damageTypes: ['Veneno'] },
        {
          type: 'other',
          id: 'dwarven-resilience',
          name: 'Resiliência Anã',
          notes: 'Vantagem em testes de resistência contra veneno (condição restrita; sem tipo).',
        },
      ],
    },
    {
      id: 'dwarven-combat-training',
      name: 'Treinamento de Combate Anão',
      description:
        'Você tem proficiência com machados de batalha, machadinhas, martelos leves e ' +
        'martelos de guerra.',
      // Ids CANÔNICOS do catálogo `shared/weapons`: o motor de raça os soma às
      // proficiências de arma na derivação e o ataque passa a somar o bônus.
      mechanicalEffect: {
        type: 'weaponProficiency',
        targets: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'],
      },
    },
    {
      id: 'dwarven-tool-proficiency',
      name: 'Proficiência com Ferramenta',
      description:
        'Você tem proficiência com uma ferramenta de artesão à sua escolha, entre ' +
        'ferramentas de ferreiro, suprimentos de cervejeiro ou ferramentas de pedreiro ' +
        '(veja a escolha abaixo).',
      // A escolha vive em hasChoices (id 'dwarf-tool-proficiency'). Por ora ela
      // só é DECLARADA: a fundação não previu o efeito colateral de gravar o id
      // escolhido em `toolProficiencies` — isso fica para o motor de raça.
    },
    {
      id: 'stonecunning',
      name: 'Conhecimento de Pedra',
      description:
        'Sempre que fizer um teste de Inteligência (História) relacionado à origem de ' +
        'trabalho em pedra, some o dobro do seu bônus de proficiência em vez do bônus normal.',
      // Textual: a condição ("relacionado a trabalho em pedra") não é modelada.
    },
  ],
  hasChoices: [
    {
      id: 'dwarf-tool-proficiency',
      label: 'Proficiência com Ferramenta',
      // O id da opção é o id de uma ferramenta do catálogo: o motor de raça
      // (2.10) grava a escolhida em `toolProficiencies`.
      apply: 'tool',
      options: DWARF_TOOL_OPTIONS,
    },
  ],
  subraces: [
    {
      id: 'hill-dwarf',
      namePt: 'Anão da Colina',
      abilityScoreIncrease: [{ ability: 'wisdom', amount: 1 }],
      traits: [
        {
          id: 'dwarven-toughness',
          name: 'Robustez Anã',
          description: 'Seu PV máximo aumenta em 1 a cada nível de personagem.',
          // +1 PV por nível TOTAL do personagem: este é o ÚNICO efeito de raça
          // aplicado de verdade hoje — o serviço o aplica/reverte ao trocar a
          // raça/sub-raça (ver raceHpBonus/raceHpBonusDelta no index).
          mechanicalEffect: {
            type: 'hpBonus',
            id: 'dwarven-toughness',
            value: 1,
            perLevel: true,
          },
        },
      ],
    },
    {
      id: 'mountain-dwarf',
      namePt: 'Anão da Montanha',
      abilityScoreIncrease: [{ ability: 'strength', amount: 2 }],
      traits: [
        {
          id: 'dwarven-armor-training',
          name: 'Treinamento com Armadura Anã',
          description: 'Você tem proficiência com armaduras leves e médias.',
          // TODO(proficiência de armadura por raça): só classe/subclasse
          // alimentam `proficiencies.armor` hoje; nada a conceder até o motor
          // de raça.
        },
      ],
    },
  ],
};
