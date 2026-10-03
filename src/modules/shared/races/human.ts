import type { Race } from './types.js';

/**
 * Humano (Human) — PHB 2014. A raça mais simples do catálogo: +1 em TODOS os
 * seis atributos, sem traços, sem sub-raças e sem visão no escuro.
 *
 * O **Humano Variante** (troca o +1 em tudo por +1 em dois atributos à escolha
 * + 1 perícia + 1 talento) NÃO é cadastrado aqui: depende de talentos
 * mecânicos, que ainda não existem (talentos hoje são só registro textual no
 * Level Up). Ver o TODO abaixo.
 */
export const human: Race = {
  id: 'human',
  namePt: 'Humano',
  nameEn: 'Human',
  description: 'Versátil e ambicioso: um pouco melhor em tudo.',
  abilityScoreIncrease: [
    { ability: 'strength', amount: 1 },
    { ability: 'dexterity', amount: 1 },
    { ability: 'constitution', amount: 1 },
    { ability: 'intelligence', amount: 1 },
    { ability: 'wisdom', amount: 1 },
    { ability: 'charisma', amount: 1 },
  ],
  speed: 9,
  size: 'Medium',
  // TODO(idiomas): não há campo de idioma na ficha; os campos abaixo guardam a
  // intenção (Comum + 1 idioma à escolha).
  languages: ['Comum'],
  bonusLanguageChoices: 1,
  traits: [],
  // TODO: Humano Variante — depende da implementação de talentos mecânicos.
  // Por ora o Humano só oferece o +1 em todos os atributos.
};
