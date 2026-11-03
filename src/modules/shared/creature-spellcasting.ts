import { z } from 'zod';
import { ABILITY_KEYS } from './dnd5e.js';
import { parseJson } from './json.js';

/**
 * FASE 6.6B — PERFIL DE CONJURAÇÃO do statblock (NPC/Creature).
 *
 * Em D&D 5e, o statblock é a AUTORIDADE: quando ele traz a CD e o bônus de
 * ataque mágico explícitos, esses valores valem — não são recalculados pela
 * fórmula de personagem (que depende de nível de classe e proficiência, coisas
 * que uma criatura não tem).
 *
 * Guardamos só o PERFIL de conjuração (`ability`, `saveDc`, `attackBonus`), não
 * um repertório de magias: lista de magias/usos do NPC é outra fase.
 *
 * `ability` é opcional: há statblocks que só publicam a CD. NÃO inferimos o
 * atributo pelo maior valor (isso seria errado).
 */
export const creatureSpellcastingProfileSchema = z.object({
  /** Atributo de conjuração quando o statblock o declara. */
  ability: z.enum(ABILITY_KEYS).optional(),
  /** CD de magia explícita do statblock (1..40). */
  saveDc: z.number().int().min(1).max(40).optional(),
  /** Bônus de ataque mágico explícito do statblock (-20..40). */
  attackBonus: z.number().int().min(-20).max(40).optional(),
});

export type CreatureSpellcastingProfile = z.infer<typeof creatureSpellcastingProfileSchema>;

/** Lê o perfil persistido; JSON inválido/ausente vira `{}` (sem perfil). */
export function creatureSpellcastingProfileOf(input: unknown): CreatureSpellcastingProfile {
  return parseJson(creatureSpellcastingProfileSchema, input, {});
}

/** Um perfil é UTILIZÁVEL como fonte de conjuração quando publica a CD. */
export function hasCreatureSpellcastingProfile(input: unknown): boolean {
  return creatureSpellcastingProfileOf(input).saveDc !== undefined;
}
