import type { Spell } from './types.js';

/**
 * FASE 6.6G — COMPONENTES DE MAGIA (V/S/M) como METADADO MECÂNICO.
 *
 * O catálogo já declara `components: { verbal, somatic, material }` e, quando há
 * material, `material: { text, costGp?, consumed? }`. Nada disso é texto livre
 * interpretado: o custo e o consumo só existem quando a PRÓPRIA MAGIA os declara
 * (PHB 2014) — o preço de mercado de um item do inventário nunca entra aqui.
 *
 * `componentsText` continua sendo APRESENTAÇÃO. Nenhum parser de "V, S, M (...)"
 * participa de regra.
 */

/** Componentes que uma magia pode exigir. */
export const SPELL_COMPONENT_KINDS = ['verbal', 'somatic', 'material'] as const;
export type SpellComponentKind = (typeof SPELL_COMPONENT_KINDS)[number];

export const SPELL_COMPONENT_LABELS: Record<SpellComponentKind, string> = {
  verbal: 'Verbal',
  somatic: 'Somático',
  material: 'Material',
};

/**
 * Focos de conjuração do PHB 2014. O TIPO é concedido pela FONTE de conjuração
 * (classe/subclasse/statblock), nunca pela lista de magias nem pelo nome do item.
 */
export const SPELLCASTING_FOCUS_KINDS = [
  'arcane',
  'holy-symbol',
  'druidic',
  'musical-instrument',
] as const;
export type SpellcastingFocusKind = (typeof SPELLCASTING_FOCUS_KINDS)[number];

export const SPELLCASTING_FOCUS_LABELS: Record<SpellcastingFocusKind, string> = {
  arcane: 'Foco Arcano',
  'holy-symbol': 'Símbolo Sagrado',
  druidic: 'Foco Druídico',
  'musical-instrument': 'Instrumento Musical',
};

/**
 * Uma exigência MATERIAL da magia.
 *
 * `key` é a identidade ESTÁVEL do material específico (ex.: `straight-iron-piece`)
 * e casa com `details.spellComponentKeys` do item — nunca com o nome exibido.
 * `minimumValueGp` é o custo EXPLICITAMENTE indicado pela magia (null quando ela
 * não indica valor) e `consumed` só é verdadeiro quando o texto declara consumo.
 */
export interface MaterialRequirement {
  key: string | null;
  label: string;
  quantity: number;
  consumed: boolean;
  minimumValueGp: number | null;
}

export interface SpellComponentRequirement {
  verbal: boolean;
  somatic: boolean;
  /** `null` = a magia não exige material. */
  material: MaterialRequirement[] | null;
}

/**
 * Traduz o catálogo para o formato MECÂNICO. `components.material` verdadeiro
 * sem `material` cadastrado ainda exige material (comum, substituível por bolsa
 * ou foco) — o catálogo de 361 magias não precisa ser reescrito para isso.
 */
export function spellComponentRequirement(spell: Spell): SpellComponentRequirement {
  const declared = spell.material;
  const material =
    spell.components.material
      ? [
          {
            key: declared?.componentKey ?? null,
            label: declared?.text ?? 'Material',
            quantity: declared?.quantity ?? 1,
            consumed: declared?.consumed === true,
            minimumValueGp:
              typeof declared?.costGp === 'number' && declared.costGp > 0
                ? declared.costGp
                : null,
          } satisfies MaterialRequirement,
        ]
      : null;
  return {
    verbal: spell.components.verbal,
    somatic: spell.components.somatic,
    material,
  };
}

/**
 * Um material é SUBSTITUÍVEL por bolsa de componentes/foco quando a magia não
 * indica custo e não o consome (§11–§13). Custo ou consumo explicitados pela
 * magia exigem o material específico, a cada conjuração.
 */
export function materialSubstitutable(entry: MaterialRequirement): boolean {
  return !entry.consumed && entry.minimumValueGp === null;
}

/** Resumo exibível dos componentes exigidos (ex.: "V, S, M"). */
export function spellComponentsLabel(requirement: SpellComponentRequirement): string {
  const parts: string[] = [];
  if (requirement.verbal) parts.push('V');
  if (requirement.somatic) parts.push('S');
  if (requirement.material) parts.push('M');
  return parts.join(', ') || 'Nenhum';
}
