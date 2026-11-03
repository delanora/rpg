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

/* -------------------------------------------------------------------------- */
/* FASE 6.6C — ESPAÇOS DE MAGIA da criatura/NPC                               */
/* -------------------------------------------------------------------------- */

/**
 * O statblock declara os espaços MÁXIMOS. Nada de derivar progressão pelo ND.
 *
 *  • MÁXIMO (`Creature.spellcastingResources`): pertence ao TEMPLATE;
 *  • USO (`spellcastingUsed`): pertence a QUEM CONJURA — o template para um NPC
 *    avulso, ou a INSTÂNCIA de combate. Duas cópias do mesmo template NUNCA
 *    compartilham espaços gastos.
 *
 * Nível 0 (truques) não entra: truque não gasta espaço.
 */
const slotSchema = z.object({
  level: z.number().int().min(1).max(9),
  max: z.number().int().min(0).max(20),
});

export const creatureSpellcastingResourcesSchema = z.object({
  spellSlots: z.array(slotSchema).max(9).default([]),
  pactSlot: slotSchema.nullable().default(null),
});

export type CreatureSpellcastingResources = z.infer<typeof creatureSpellcastingResourcesSchema>;

const usedSchema = z.object({
  spellSlotsUsed: z.record(z.string(), z.number().int().min(0).max(99)).default({}),
  pactSlotUsed: z.number().int().min(0).max(99).default(0),
});

export interface CreatureSpellcastingUsed {
  spellSlotsUsed: Record<string, number>;
  pactSlotUsed: number;
}

/** MÁXIMO declarado pelo statblock (vazio = a criatura não conjura). */
export function creatureSpellcastingMaxOf(value: unknown): CreatureSpellcastingResources {
  const parsed = parseJson<CreatureSpellcastingResources>(creatureSpellcastingResourcesSchema, value, {
    spellSlots: [],
    pactSlot: null,
  });
  return {
    spellSlots: parsed.spellSlots
      .filter((slot) => slot.max > 0)
      .sort((a, b) => a.level - b.level),
    pactSlot: parsed.pactSlot && parsed.pactSlot.max > 0 ? parsed.pactSlot : null,
  };
}

/** USO corrente de quem conjura (template ou instância). */
export function creatureSpellcastingUsedOf(value: unknown): CreatureSpellcastingUsed {
  return parseJson<CreatureSpellcastingUsed>(usedSchema, value, {
    spellSlotsUsed: {},
    pactSlotUsed: 0,
  });
}

export function emptyCreatureSpellcastingUsed(): CreatureSpellcastingUsed {
  return { spellSlotsUsed: {}, pactSlotUsed: 0 };
}
