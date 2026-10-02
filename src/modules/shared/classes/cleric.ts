import type { ClassDefinition, SubclassDefinition } from './types.js';
import { NO_FEATURES } from './types.js';

/**
 * Domínios Divinos do Clérigo (Livro do Jogador 2014).
 *
 * O clérigo escolhe o domínio JÁ no nível 1 — é uma das três classes em que a
 * subclasse faz parte do pacote inicial (as outras são o Feiticeiro e o Bruxo).
 * Por isso o assistente de criação pede o domínio no passo da classe.
 *
 * As características de cada domínio (magias de domínio sempre preparadas,
 * Bênção do Discípulo, Expulsar Mortos-Vivos aprimorado...) ainda não estão
 * cadastradas — como `features` da própria classe, ficam para uma etapa futura.
 */
const CLERIC_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'life',
    name: 'Domínio da Vida',
    description:
      'A energia positiva que sustenta toda a existência é a sua devoção: suas curas são reforçadas e você mantém os aliados de pé.',
    features: NO_FEATURES,
  },
  {
    id: 'light',
    name: 'Domínio da Luz',
    description:
      'Você canaliza a luz purificadora, incinerando as trevas e protegendo os seus com lampejos radiantes.',
    features: NO_FEATURES,
  },
  {
    id: 'knowledge',
    name: 'Domínio do Conhecimento',
    description:
      'O saber é uma forma de devoção: idiomas, novas perícias e a leitura do que os outros escondem.',
    features: NO_FEATURES,
  },
  {
    id: 'nature',
    name: 'Domínio da Natureza',
    description:
      'Você serve às forças do mundo natural, aprendendo um truque druídico e falando com animais e plantas.',
    features: NO_FEATURES,
  },
  {
    id: 'tempest',
    name: 'Domínio da Tempestade',
    description:
      'A fúria do trovão é sua: relâmpagos, estrondos e o castigo de quem ousa tocá-lo.',
    features: NO_FEATURES,
  },
  {
    id: 'trickery',
    name: 'Domínio do Engano',
    description:
      'Seu padroeiro é o embusteiro: ilusões, disfarces e a graça de passar despercebido.',
    features: NO_FEATURES,
  },
  {
    id: 'war',
    name: 'Domínio da Guerra',
    description:
      'Você luta pelo seu deus: treinamento marcial, armas sagradas e golpes extras em nome da fé.',
    features: NO_FEATURES,
  },
];

export const cleric: ClassDefinition = {
  key: 'cleric',
  name: 'Clérigo',
  description:
    'Servo de um poder divino: cura os seus e castiga os inimigos em nome do domínio que escolheu.',
  hitDie: 8,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 1, // Domínio Divino
  spellcasting: { type: 'full', ability: 'wisdom', learning: 'prepared' },
  features: NO_FEATURES,
  subclasses: CLERIC_SUBCLASSES,
};
