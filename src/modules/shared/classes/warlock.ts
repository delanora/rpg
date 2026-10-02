import type { ClassDefinition, SubclassDefinition } from './types.js';
import { NO_FEATURES } from './types.js';

/**
 * Patronos Extraplanares do Bruxo (Livro do Jogador 2014).
 *
 * O bruxo escolhe o patrono JÁ no nível 1 — junto do Feiticeiro e do Clérigo,
 * é uma das classes em que a subclasse faz parte do pacote inicial. Por isso o
 * assistente de criação pede o patrono no passo da classe.
 *
 * As características de cada patrono (lista de magias expandida, Dádiva do
 * Pacto, Invocações de Bênção...) ainda não estão cadastradas — como `features`
 * da própria classe, ficam para uma etapa futura.
 */
const WARLOCK_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'archfey',
    name: 'Arquifada',
    description:
      'Seu patrono é um senhor da Corte Feérica: encantamento, ilusão e a magia esquiva das fadas.',
    features: NO_FEATURES,
  },
  {
    id: 'fiend',
    name: 'O Corruptor',
    description:
      'Um senhor infernal alimenta seu poder com fogo e sofrimento, recompensando a ousadia com vigor roubado.',
    features: NO_FEATURES,
  },
  {
    id: 'great-old-one',
    name: 'O Grande Antigo',
    description:
      'Uma entidade além da compreensão sussurra segredos: telepatia, loucura e magia que não deveria ser conhecida.',
    features: NO_FEATURES,
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
  features: NO_FEATURES,
  subclasses: WARLOCK_SUBCLASSES,
};
