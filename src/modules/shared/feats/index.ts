import { ABILITY_KEYS, type AbilityKey } from '../dnd5e.js';
import { CATEGORY_A_FEATS } from './category-a.js';
import { CATEGORY_B_FEATS } from './category-b.js';
import { CATEGORY_C_FEATS } from './category-c.js';
import type { Feat } from './types.js';

export * from './types.js';

/**
 * Catálogo estruturado dos talentos do Livro do Jogador (2014).
 *
 * A lista é fechada e a ordem é: Categoria A (com efeito), depois B e C (só
 * registro textual). O `id` é estável e é o valor gravado em
 * `characters.features[].featId` quando o talento é escolhido no Level Up.
 */
export const FEATS: readonly Feat[] = [...CATEGORY_A_FEATS, ...CATEGORY_B_FEATS, ...CATEGORY_C_FEATS];

const FEAT_BY_ID = new Map(FEATS.map((feats) => [feats.id, feats]));

/** Todos os talentos (cópia defensiva). */
export function allFeats(): Feat[] {
  return [...FEATS];
}

/** Busca um talento pelo id estável (ex.: 'athlete'). */
export function getFeat(id: string): Feat | undefined {
  return FEAT_BY_ID.get(id.trim());
}

/** Busca um talento pelo NOME em português (compatibilidade com o que já está gravado). */
export function findFeatByName(name: string): Feat | undefined {
  const target = name.trim().toLowerCase();
  return FEATS.find((feat) => feat.name.toLowerCase() === target);
}

/** Resolve um talento pelo id estável OU pelo nome em português. */
export function resolveFeat(idOrName: string): Feat | undefined {
  return getFeat(idOrName) ?? findFeatByName(idOrName);
}

/**
 * Valida a escolha de atributo de um half-feat: o atributo precisa estar entre
 * as `options` do talento. Devolve o `AbilityKey` normalizado ou `null` quando
 * não bate (o serviço recusa com 400).
 */
export function resolveFeatAbility(feat: Feat, ability: string): AbilityKey | null {
  if (!feat.abilityChoice) return null;
  const key = ability.trim();
  if (!(ABILITY_KEYS as readonly string[]).includes(key)) return null;
  return feat.abilityChoice.options.includes(key as AbilityKey) ? (key as AbilityKey) : null;
}