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
 * A união discriminada tem duas variantes: `immediate-healing` (6.6I.3) e
 * `attack-damage` (6.6I.4 — ataque mágico resolvido na hora). Nada de tabela por
 * magia e nada de recálculo em retry/refresh.
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

/** Componente de dano já rolado e já defendido pelo núcleo compartilhado. */
export const attackDamageComponentSnapshotSchema = z.object({
  type: z.string().nullable(),
  /** Dados rolados (o crítico dobra a quantidade, nunca o bônus). */
  count: z.number().int().nonnegative(),
  sides: z.number().int().nonnegative(),
  rolls: z.array(z.number().int()),
  bonus: z.number().int(),
  raw: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  modifier: z
    .enum(['immunity', 'resistance', 'vulnerability', 'resistance-vulnerability'])
    .nullable(),
});

/**
 * FASE 6.6I.4 — SNAPSHOT DO ATAQUE MÁGICO.
 *
 * Guarda o d20 mantido, os dados rolados, o modo, o bônus SNAPSHOTADO no
 * `SpellCast`, a CA do alvo NO MOMENTO da resolução e o dano por componente.
 * Miss não inventa evento de dano: `damage: null`.
 */
export const attackDamageSnapshotSchema = z.object({
  kind: z.literal('attack-damage'),
  attack: z.object({
    kind: z.enum(['melee', 'ranged']),
    /** Índice do ataque dentro do cast (hoje sempre 0). */
    index: z.number().int().nonnegative(),
    /** Identidade do ataque (`spell-cast:<castId>:attack:<index>`). */
    occurrenceId: z.string(),
    naturalRoll: z.number().int(),
    rolls: z.array(z.number().int()),
    mode: z.enum(['normal', 'advantage', 'disadvantage']),
    /** Bônus vindo do SNAPSHOT do cast (nunca recalculado). */
    attackBonus: z.number().int(),
    effectBonus: z.number().int(),
    effectDice: z.array(
      z.object({
        sides: z.number().int(),
        value: z.number().int(),
        sign: z.number().int(),
        label: z.string().nullable(),
      }),
    ),
    /** Fontes visíveis que contribuíram (efeito privado = `null`). */
    sources: z.array(z.string().nullable()),
    total: z.number().int(),
    targetAc: z.number().int(),
    hit: z.boolean(),
    critical: z.boolean(),
    autoMiss: z.boolean(),
    autoHit: z.boolean(),
  }),
  damage: z
    .object({
      /** `spell-cast:<castId>:attack:<index>:damage`. */
      eventId: z.string(),
      components: z.array(attackDamageComponentSnapshotSchema),
      rawDamage: z.number().int().nonnegative(),
      finalDamage: z.number().int().nonnegative(),
      hpBefore: z.number().int().nullable(),
      hpAfter: z.number().int().nullable(),
      critical: z.boolean(),
    })
    .nullable(),
  target: z.object({ kind: z.string(), id: z.string() }),
  casterName: z.string(),
  noEffectReason: z.enum(['attack-miss', 'zero-damage']).nullable(),
  at: z.string(),
});

export type AttackDamageSnapshot = z.infer<typeof attackDamageSnapshotSchema>;

/** União das resoluções imediatas persistidas em `SpellCast.resolutionSnapshot`. */
export const spellResolutionSnapshotSchema = z.discriminatedUnion('kind', [
  immediateHealingSnapshotSchema,
  attackDamageSnapshotSchema,
]);
export type SpellResolutionSnapshot = z.infer<typeof spellResolutionSnapshotSchema>;

/** Leitura FECHADA do snapshot de resolução (inválido/ausente = `null`). */
export function parseSpellResolutionSnapshot(value: unknown): SpellResolutionSnapshot | null {
  return parseJson(spellResolutionSnapshotSchema, value, null as never) ?? null;
}

/** Lê o snapshot persistido; JSON inválido/ausente vira `null` (nunca inventa). */
export function parseImmediateHealingSnapshot(value: unknown): ImmediateHealingSnapshot | null {
  return parseJson(immediateHealingSnapshotSchema, value, null as never) ?? null;
}
