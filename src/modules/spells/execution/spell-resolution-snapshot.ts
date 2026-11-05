import { z } from 'zod';
import { parseJson } from '../../shared/json.js';

/**
 * FASE 6.6I.3 — SNAPSHOT GENÉRICO DA RESOLUÇÃO IMEDIATA.
 *
 * Diferente de `save-damage` (que persiste na pendência), uma magia instantânea
 * resolve dentro do próprio `SpellCast`. O registro guarda o que foi ROLADO e
 * APLICADO no dia da conjuração — retry, refresh e mudanças posteriores de ficha
 * nunca recalculam nem rolam de novo.
 *
 * A união discriminada começa com `immediate-healing`; dano por ataque mágico
 * entrará como outro `kind` quando a 6.6I.4 existir. Nada de tabela por magia.
 */

export const immediateHealingSnapshotSchema = z.object({
  kind: z.literal('immediate-healing'),
  /** Identidade determinística do evento (`spell-cast:<castId>:healing`). */
  eventId: z.string(),
  spellId: z.string(),
  castAtLevel: z.number().int(),
  ability: z.string().nullable(),
  /** Modificador do atributo de conjuração no COMMIT (snapshot, nunca recalculado). */
  abilityModifier: z.number().int(),
  dice: z.object({
    count: z.number().int().nonnegative(),
    sides: z.number().int().nonnegative(),
    rolls: z.array(z.number().int()),
  }),
  rolledTotal: z.number().int(),
  /** Cura pedida ao núcleo (`max(0, rolado + modificador)`). */
  requestedHealing: z.number().int().nonnegative(),
  /** Cura efetiva (limitada pelo PV máximo e nunca negativa). */
  finalHealing: z.number().int().nonnegative(),
  target: z.object({ kind: z.string(), id: z.string() }),
  hpBefore: z.number().int(),
  hpAfter: z.number().int(),
  /** Motivo auditável de uma conjuração válida sem cura efetiva. */
  noEffectReason: z
    .enum(['creature-type-immune', 'target-at-max-hp', 'zero-healing'])
    .nullable(),
  at: z.string(),
});

export type ImmediateHealingSnapshot = z.infer<typeof immediateHealingSnapshotSchema>;

/** Lê o snapshot persistido; JSON inválido/ausente vira `null` (nunca inventa). */
export function parseImmediateHealingSnapshot(value: unknown): ImmediateHealingSnapshot | null {
  return parseJson(immediateHealingSnapshotSchema, value, null as never) ?? null;
}
