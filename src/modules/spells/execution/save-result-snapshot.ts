import { z } from 'zod';
import { parseJson } from '../../shared/json.js';

/**
 * FASE 6.6J.2 — SNAPSHOT DO RESULTADO DO SAVE (por pendência).
 *
 * Com o dano COMPARTILHADO morando no `SpellCast.resolutionSnapshot`, a
 * pendência guarda apenas o que é dela: o resultado do SEU save. Assim o
 * retry/replay de uma pendência devolve o mesmo save sem nunca carregar (nem
 * rerrolar) o dano dos outros alvos.
 */
export const saveResultSnapshotSchema = z.object({
  kind: z.literal('save-result'),
  ability: z.string(),
  dc: z.number().int(),
  total: z.number().int(),
  success: z.boolean(),
  at: z.string(),
});

export type SaveResultSnapshot = z.infer<typeof saveResultSnapshotSchema>;

/**
 * Snapshot do alvo DEPOIS da barreira: visão derivada do resultado do cast.
 *
 * NÃO duplica os dados rolados — eles existem uma única vez no snapshot do
 * `SpellCast`. Aqui ficam o resultado do save, o dano já calculado e a REFERÊNCIA
 * (`damageRollId`/`damageRollIndex`) ao roll compartilhado.
 */
export const saveDamageTargetSnapshotSchema = z.object({
  kind: z.literal('save-result'),
  ability: z.string(),
  dc: z.number().int(),
  total: z.number().int(),
  success: z.boolean(),
  eventId: z.string(),
  damageRollId: z.string().nullable(),
  damageRollIndex: z.number().int().nullable(),
  damageType: z.string(),
  scalingLevel: z.number().int(),
  rawDamage: z.number().int().nonnegative(),
  damageAfterSave: z.number().int().nonnegative(),
  finalDamage: z.number().int().nonnegative(),
  outcome: z.object({ success: z.string(), failure: z.string() }),
  components: z.array(
    z.object({
      type: z.string().nullable(),
      count: z.number().int().nonnegative(),
      sides: z.number().int().nonnegative(),
      raw: z.number().int().nonnegative(),
      afterSave: z.number().int().nonnegative(),
      applied: z.number().int().nonnegative(),
      modifier: z
        .enum(['immunity', 'resistance', 'vulnerability', 'resistance-vulnerability'])
        .nullable(),
    }),
  ),
  /** LEGADO (compatibilidade de leitura): primeiro componente, sem os dados. */
  dice: z.object({ count: z.number().int(), sides: z.number().int() }).nullable(),
  target: z.object({ kind: z.string(), id: z.string() }),
  casterName: z.string(),
  at: z.string(),
});

export type SaveDamageTargetSnapshot = z.infer<typeof saveDamageTargetSnapshotSchema>;

/** Lê o snapshot salvo; JSON inválido/legado vira `null` (nunca "ganha" regra). */
export function saveResultOf(row: { resolutionSnapshot: unknown }): SaveResultSnapshot | null {
  return parseJson(saveResultSnapshotSchema, row.resolutionSnapshot, null as never) ?? null;
}

/** Visão derivada por alvo (gravada na pendência após a finalização). */
export function buildSaveDamageTargetSnapshot(input: {
  ability: string;
  dc: number;
  total: number;
  success: boolean;
  eventId: string;
  damageRollId: string | null;
  damageRollIndex: number | null;
  damageType: string;
  scalingLevel: number;
  rawDamage: number;
  damageAfterSave: number;
  finalDamage: number;
  outcome: { success: string; failure: string };
  components: SaveDamageTargetSnapshot['components'];
  target: { kind: string; id: string };
  casterName: string;
}): SaveDamageTargetSnapshot {
  const first = input.components[0];
  return {
    kind: 'save-result',
    ability: input.ability,
    dc: input.dc,
    total: input.total,
    success: input.success,
    eventId: input.eventId,
    damageRollId: input.damageRollId,
    damageRollIndex: input.damageRollIndex,
    damageType: input.damageType,
    scalingLevel: input.scalingLevel,
    rawDamage: input.rawDamage,
    damageAfterSave: input.damageAfterSave,
    finalDamage: input.finalDamage,
    outcome: input.outcome,
    components: input.components,
    dice: first ? { count: first.count, sides: first.sides } : null,
    target: input.target,
    casterName: input.casterName,
    at: new Date().toISOString(),
  };
}

export function buildSaveResultSnapshot(input: {
  ability: string;
  dc: number;
  total: number;
  success: boolean;
}): SaveResultSnapshot {
  return {
    kind: 'save-result',
    ability: input.ability,
    dc: input.dc,
    total: input.total,
    success: input.success,
    at: new Date().toISOString(),
  };
}
