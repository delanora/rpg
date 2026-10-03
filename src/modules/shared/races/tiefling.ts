import type { Race } from './types.js';

/**
 * Tiefling — PHB 2014. Sem sub-raças.
 *
 * Só DADOS por enquanto: Resistência Infernal usa `resistance` (Fogo). O Legado
 * Infernal fica descritivo (truque + magias a partir de níveis de PERSONAGEM),
 * porque o catálogo de magias ainda não existe — mesmo tratamento do truque do
 * Alto Elfo e da Magia Drow. `speed` em METROS (30 pés = 9 m).
 */
export const tiefling: Race = {
  id: 'tiefling',
  namePt: 'Tiefling',
  nameEn: 'Tiefling',
  description:
    'Marcados por um legado infernal, os tieflings carregam chifres, cauda e um poder ' +
    'sombrio no sangue. Seu deslocamento é de 9 m (30 pés).',
  abilityScoreIncrease: [
    { ability: 'charisma', amount: 2 },
    { ability: 'intelligence', amount: 1 },
  ],
  speed: 9,
  size: 'Medium',
  // 18 m = 60 pés (visão no escuro).
  darkvision: 18,
  // TODO(idiomas): não há campo de idioma na ficha.
  languages: ['Comum', 'Infernal'],
  traits: [
    {
      id: 'hellish-resistance',
      name: 'Resistência Infernal',
      description: 'Você tem resistência a dano de fogo.',
      mechanicalEffect: { type: 'resistance', damageTypes: ['Fogo'] },
    },
    {
      id: 'infernal-legacy',
      name: 'Legado Infernal',
      description:
        'Você conhece o truque Taumaturgia. No 3º nível de PERSONAGEM, você aprende ' +
        'Repreensão Infernal e pode lançá-la uma vez por descanso longo; no 5º nível, aprende ' +
        'Escuridão e pode lançá-la uma vez por descanso longo. Carisma é o atributo de ' +
        'conjuração dessas magias.',
      // TODO(catálogo de magias): o catálogo ainda não existe (SPELL_CATALOG é []).
      // Quando existir, ligar o truque (spellsByClass) e o recurso de 1 uso por
      // descanso longo escalonando pelo NÍVEL TOTAL DO PERSONAGEM — mesma decisão
      // do Draconato/Drow: representado no texto, sem tipo de efeito novo.
    },
  ],
};
