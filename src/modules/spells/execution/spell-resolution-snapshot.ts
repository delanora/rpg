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
 * A união discriminada tem três variantes: `immediate-healing` (6.6I.3),
 * `attack-damage` (6.6I.4 — ataque mágico resolvido na hora) e `save-damage`
 * (6.6J.2). Nada de tabela por magia e nada de recálculo em retry/refresh.
 *
 * 6.6J.4 — MÚLTIPLAS JOGADAS: `attack-damage` passou a guardar `attacks[]`
 * (uma ocorrência por jogada, ordenada por índice). Snapshots ANTIGOS (uma única
 * jogada) continuam legíveis: o parser normaliza o formato v1 para v2, sem
 * migration e sem reescrever dados históricos.
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
 * 6.6J.5 — COBERTURA registrada por ocorrência/ataque. `not-assessed` NÃO é
 * "sem cobertura": é ausência de geometria, com bônus 0 e rastro auditável.
 */
export const coverSnapshotSchema = z.object({
  status: z.enum(['known', 'unknown', 'not-assessed']),
  level: z.enum(['none', 'half', 'three-quarters', 'total']).nullable(),
  acBonus: z.number().int().nonnegative(),
  saveBonus: z.number().int().nonnegative(),
  provenance: z.enum(['authoritative', 'master-confirmed']).nullable(),
});

/** Dados/resultado de UMA jogada de ataque (6.6I.4, generalizado na 6.6J.4). */
export const spellAttackRollSnapshotSchema = z.object({
  kind: z.enum(['melee', 'ranged']),
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
});

export const attackDamageEventSnapshotSchema = z.object({
  /** `spell-cast:<castId>:attack:<index>:damage` — ÚNICO por ocorrência. */
  eventId: z.string(),
  components: z.array(attackDamageComponentSnapshotSchema),
  rawDamage: z.number().int().nonnegative(),
  finalDamage: z.number().int().nonnegative(),
  hpBefore: z.number().int().nullable(),
  hpAfter: z.number().int().nullable(),
  critical: z.boolean(),
});

/**
 * FASE 6.6J.4 — UMA OCORRÊNCIA de ataque dentro do `SpellCast`.
 *
 * `index` é estável (0..N-1) e `occurrenceId` é determinístico. O alvo é POR
 * OCORRÊNCIA: o mesmo alvo pode receber duas jogadas, e cada uma tem seu próprio
 * evento de dano (HP/defesas/Concentração/morte independentes).
 */
export const spellAttackOccurrenceSnapshotSchema = z.object({
  index: z.number().int().nonnegative(),
  occurrenceId: z.string(),
  target: z.object({ kind: z.string(), id: z.string() }),
  attack: spellAttackRollSnapshotSchema,
  /** `null` em miss e quando nenhum dano foi produzido. */
  damage: attackDamageEventSnapshotSchema.nullable(),
  /** IDs de modificadores OPCIONAIS usados nesta jogada (só identidades). */
  selectedModifiers: z.array(z.string()),
  /** 6.6J.5: cobertura RELATIVA à origem desta jogada (ausente em casts antigos). */
  cover: coverSnapshotSchema.optional(),
  noEffectReason: z.enum(['attack-miss', 'zero-damage']).nullable(),
});

export type SpellAttackOccurrenceSnapshot = z.infer<typeof spellAttackOccurrenceSnapshotSchema>;

/**
 * FASE 6.6J.4 — SNAPSHOT DO ATAQUE MÁGICO (N jogadas).
 *
 * `attacks` preserva TODAS as ocorrências, na ordem dos índices. `targets` é só
 * o resumo do conjunto canônico único (nunca reconstrói as jogadas).
 */
export const attackDamageSnapshotSchema = z.object({
  kind: z.literal('attack-damage'),
  attacks: z.array(spellAttackOccurrenceSnapshotSchema).min(1),
  targets: z.array(z.object({ kind: z.string(), id: z.string() })),
  casterName: z.string(),
  noEffectReason: z.enum(['attack-miss', 'zero-damage']).nullable(),
  at: z.string(),
});

export type AttackDamageSnapshot = z.infer<typeof attackDamageSnapshotSchema>;

/**
 * FORMATO LEGADO (6.6I.4) — UMA jogada, campos no nível do snapshot.
 *
 * Mantido para LEITURA de casts históricos. Nunca é escrito de novo.
 */
export const legacyAttackDamageSnapshotSchema = z.object({
  kind: z.literal('attack-damage'),
  attack: spellAttackRollSnapshotSchema.extend({
    index: z.number().int().nonnegative(),
    occurrenceId: z.string(),
  }),
  damage: attackDamageEventSnapshotSchema.nullable(),
  target: z.object({ kind: z.string(), id: z.string() }),
  casterName: z.string(),
  noEffectReason: z.enum(['attack-miss', 'zero-damage']).nullable(),
  at: z.string(),
});

export type LegacyAttackDamageSnapshot = z.infer<typeof legacyAttackDamageSnapshotSchema>;

/** O snapshot é legado quando os campos estão no nível do registro. */
export function isLegacyAttackDamageSnapshot(
  value: AttackDamageSnapshot | LegacyAttackDamageSnapshot,
): value is LegacyAttackDamageSnapshot {
  return !('attacks' in value);
}

/**
 * Normaliza v1 → v2. O histórico continua auditável com o MESMO parser; nada de
 * migration de JSONB e nada de inventar dados (o `damage` é preservado como é).
 */
export function normalizeAttackDamageSnapshot(
  value: AttackDamageSnapshot | LegacyAttackDamageSnapshot,
): AttackDamageSnapshot {
  if (!isLegacyAttackDamageSnapshot(value)) return value;
  const { index, occurrenceId, ...attack } = value.attack;
  return {
    kind: 'attack-damage',
    attacks: [
      {
        index,
        occurrenceId,
        target: value.target,
        attack,
        damage: value.damage,
        selectedModifiers: [],
        noEffectReason: value.noEffectReason,
      },
    ],
    targets: [value.target],
    casterName: value.casterName,
    noEffectReason: value.noEffectReason,
    at: value.at,
  };
}

/**
 * FASE 6.6J.2 — SNAPSHOT DO `save-damage` NO PRÓPRIO CAST.
 *
 * O DANO pertence a UM roll compartilhado (`spell-cast:<castId>:damage-roll:0`),
 * enquanto cada alvo tem seu PRÓPRIO evento (`spell-cast:<castId>:target:...:damage`)
 * usado por HP, morte e Concentração. A pendência guarda só o resultado do SAVE.
 */
export const saveDamageShareSnapshotSchema = z.enum(['none', 'half', 'full']);

export const sharedDamageRollComponentSchema = z.object({
  bonus: z.number().int().optional(),
  type: z.string().nullable(),
  count: z.number().int().nonnegative(),
  sides: z.number().int().nonnegative(),
  rolls: z.array(z.number().int()),
  raw: z.number().int().nonnegative(),
});

export const saveDamageTargetResultSchema = z.object({
  target: z.object({ kind: z.string(), id: z.string() }),
  pendingSaveId: z.string().nullable(),
  save: z
    .object({
      success: z.boolean(),
      total: z.number().int(),
      dc: z.number().int(),
    })
    .nullable(),
  status: z.enum(['applied', 'no-damage', 'unavailable']),
  components: z.array(
    z.object({
      type: z.string().nullable(),
      raw: z.number().int().nonnegative(),
      afterSave: z.number().int().nonnegative(),
      applied: z.number().int().nonnegative(),
      modifier: z
        .enum(['immunity', 'resistance', 'vulnerability', 'resistance-vulnerability'])
        .nullable(),
    }),
  ),
  rawDamage: z.number().int().nonnegative(),
  damageAfterSave: z.number().int().nonnegative(),
  finalDamage: z.number().int().nonnegative(),
  eventId: z.string(),
  hpBefore: z.number().int().nullable(),
  hpAfter: z.number().int().nullable(),
  concentration: z.boolean(),
});

export const saveDamageCastSnapshotSchema = z.object({
  kind: z.literal('save-damage'),
  castId: z.string(),
  /** Id do ROLL compartilhado. */
  eventId: z.string(),
  outcome: z.object({
    success: saveDamageShareSnapshotSchema,
    failure: saveDamageShareSnapshotSchema,
  }),
  damageType: z.string(),
  damageRoll: z
    .object({
      id: z.string(),
      index: z.number().int().nonnegative(),
      components: z.array(sharedDamageRollComponentSchema),
      rawDamage: z.number().int().nonnegative(),
    })
    .nullable(),
  /** Resultados na ORDEM CANÔNICA do targeting snapshot. */
  targets: z.array(saveDamageTargetResultSchema),
  noEffectReason: z.enum(['no-damage', 'no-valid-target']).nullable(),
  at: z.string(),
});

export type SaveDamageCastSnapshot = z.infer<typeof saveDamageCastSnapshotSchema>;
export type SaveDamageTargetResult = z.infer<typeof saveDamageTargetResultSchema>;

/**
 * União das resoluções imediatas persistidas em `SpellCast.resolutionSnapshot`.
 *
 * O `attack-damage` legado entra na união (e não num `discriminatedUnion`) porque
 * as duas versões compartilham o mesmo `kind`: o parser tenta o formato NOVO
 * primeiro e cai no antigo, que é normalizado.
 */
export const spellResolutionSnapshotSchema = z.union([
  immediateHealingSnapshotSchema,
  saveDamageCastSnapshotSchema,
  attackDamageSnapshotSchema,
  legacyAttackDamageSnapshotSchema,
]);
export type SpellResolutionSnapshot =
  | ImmediateHealingSnapshot
  | SaveDamageCastSnapshot
  | AttackDamageSnapshot;

/** Leitura FECHADA do snapshot de resolução (inválido/ausente = `null`). */
export function parseSpellResolutionSnapshot(value: unknown): SpellResolutionSnapshot | null {
  const parsed = spellResolutionSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.kind !== 'attack-damage') return parsed.data;
  return normalizeAttackDamageSnapshot(parsed.data);
}

/** Lê o snapshot persistido; JSON inválido/ausente vira `null` (nunca inventa). */
export function parseImmediateHealingSnapshot(value: unknown): ImmediateHealingSnapshot | null {
  return parseJson(immediateHealingSnapshotSchema, value, null as never) ?? null;
}
