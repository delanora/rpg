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

/**
 * Ferramentas que a Expertise pode dobrar (PHB 2014: o Ladino e o Bardo
 * escolhem perícias OU ferramentas, desde que JÁ tenham a proficiência).
 *
 * A chave leva o prefixo `tool:` para nunca colidir com as chaves das 18
 * perícias — o que a ficha guarda é o RÓTULO da ferramenta, então a lista
 * dinâmica de um personagem repete esse mesmo formato.
 */
export const EXPERTISE_TOOL_OPTIONS: FeatureChoiceOption[] = [
  { key: 'tool:Ferramentas de ladrão', name: 'Ferramentas de ladrão' },
  ...ARTISAN_TOOL_OPTIONS.map((option) => ({
    key: `tool:${option.name}`,
    name: option.name,
  })),
  { key: 'tool:Kit de disfarce', name: 'Kit de disfarce' },
  { key: 'tool:Kit de falsificação', name: 'Kit de falsificação' },
  { key: 'tool:Kit de venenos', name: 'Kit de venenos' },
  { key: 'tool:Kit de herbalismo', name: 'Kit de herbalismo' },
  { key: 'tool:Instrumento musical', name: 'Instrumento musical' },
];

/**
 * Opções de uma escolha de Expertise quando NÃO há o personagem em mãos (ex.:
 * o catálogo de classes do seletor): as 18 perícias + as ferramentas. Com o
 * personagem, a ficha restringe ao que ele JÁ tem proficiência.
 */
export const EXPERTISE_CHOICE_OPTIONS: FeatureChoiceOption[] = [
  ...SKILL_CHOICE_OPTIONS,
  ...EXPERTISE_TOOL_OPTIONS,
];
