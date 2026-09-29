import { SKILLS } from '../dnd5e.js';
import type { FeatureChoiceOption } from './types.js';

// ---------------------------------------------------------------------------
// Listas de opções reutilizadas pelas escolhas de característica
//
// Ficam aqui (e não dentro de uma classe) para o bardo, o guerreiro e o
// patrulheiro usarem exatamente a mesma lista quando o livro pede a mesma
// escolha — e para o rótulo em português nunca divergir do resto da ficha.
// ---------------------------------------------------------------------------

/** As 18 perícias do PHB (Colégio do Conhecimento: 3 à escolha). */
export const SKILL_CHOICE_OPTIONS: FeatureChoiceOption[] = SKILLS.map((skill) => ({
  key: skill.key,
  name: skill.label,
}));

/**
 * Ferramentas de artesão do PHB (Estudante da Guerra do Mestre da Batalha:
 * uma ferramenta de artesão à escolha).
 */
export const ARTISAN_TOOL_OPTIONS: FeatureChoiceOption[] = [
  { key: 'carpenter', name: 'Ferramentas de carpinteiro' },
  { key: 'cartographer', name: 'Ferramentas de cartógrafo' },
  { key: 'cobbler', name: 'Ferramentas de sapateiro' },
  { key: 'glassblower', name: 'Ferramentas de vidreiro' },
  { key: 'jeweler', name: 'Ferramentas de joalheiro' },
  { key: 'leatherworker', name: 'Ferramentas de curtidor' },
  { key: 'mason', name: 'Ferramentas de pedreiro' },
  { key: 'painter', name: 'Suprimentos de pintor' },
  { key: 'potter', name: 'Ferramentas de oleiro' },
  { key: 'smith', name: 'Ferramentas de ferreiro' },
  { key: 'tinker', name: 'Ferramentas de funileiro' },
  { key: 'weaver', name: 'Ferramentas de tecelão' },
  { key: 'woodcarver', name: 'Ferramentas de entalhador' },
];
