import { SKILLS } from '../dnd5e.js';
import { FEY_ANCESTRY } from './elf.js';
import type { Race } from './types.js';

/**
 * Meio-Elfo (Half-Elf) — PHB 2014. Sem sub-raças.
 *
 * A escolha de +1 em DOIS atributos é modelada como DOIS `RaceChoiceDefinition`
 * (ability-1/ability-2), cada um de escolha única — a regra de "não repetir" o
 * mesmo atributo nas duas fica para o validador do motor de raça (2.10). O
 * mesmo vale para as duas perícias da Versatilidade. Nada é aplicado à ficha
 * ainda; aqui é só dado.
 */
const HALF_ELF_ABILITY_OPTIONS: { id: string; label: string }[] = [
  { id: 'strength', label: 'Força' },
  { id: 'dexterity', label: 'Destreza' },
  { id: 'constitution', label: 'Constituição' },
  { id: 'intelligence', label: 'Inteligência' },
  { id: 'wisdom', label: 'Sabedoria' },
];

const SKILL_OPTIONS: { id: string; label: string }[] = SKILLS.map((skill) => ({
  id: skill.key,
  label: skill.label,
}));

export const halfElf: Race = {
  id: 'half-elf',
  namePt: 'Meio-Elfo',
  nameEn: 'Half-Elf',
  description:
    'Entre dois mundos, os meio-elfos combinam o charme humano com a graça élfica. Seu ' +
    'deslocamento é de 9 m (30 pés).',
  abilityScoreIncrease: [{ ability: 'charisma', amount: 2 }],
  speed: 9,
  size: 'Medium',
  // 18 m = 60 pés (visão no escuro).
  darkvision: 18,
  // TODO(idiomas): não há campo de idioma na ficha (Comum, Élfico + 1 à escolha).
  languages: ['Comum', 'Élfico'],
  bonusLanguageChoices: 1,
  traits: [
    FEY_ANCESTRY,
    {
      id: 'skill-versatility',
      name: 'Versatilidade de Perícia',
      description: 'Você ganha proficiência em duas perícias à sua escolha.',
      // As duas escolhas vivem em hasChoices (half-elf-skill-1/2); virar
      // proficiência em `character.skills` é do motor de raça (2.10).
    },
  ],
  hasChoices: [
    {
      id: 'half-elf-ability-1',
      label: 'Atributo +1 (1º)',
      apply: 'ability',
      options: HALF_ELF_ABILITY_OPTIONS,
    },
    {
      id: 'half-elf-ability-2',
      label: 'Atributo +1 (2º)',
      apply: 'ability',
      options: HALF_ELF_ABILITY_OPTIONS,
    },
    { id: 'half-elf-skill-1', label: 'Perícia (1ª)', apply: 'skill', options: SKILL_OPTIONS },
    { id: 'half-elf-skill-2', label: 'Perícia (2ª)', apply: 'skill', options: SKILL_OPTIONS },
  ],
  // Sem sub-raças.
};
