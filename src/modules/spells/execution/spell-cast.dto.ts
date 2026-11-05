import type { SpellCast } from '@prisma/client';
import type { MechanicalEntity } from '../../shared/conditions.js';
import { durationSummary, parseDurationSnapshot } from './spell-duration.js';
import {
  parseSpellResolutionSnapshot,
  type AttackDamageSnapshot,
  type ImmediateHealingSnapshot,
} from './spell-resolution-snapshot.js';

/**
 * DTO SEGURO de uma conjuração (Fase 6.6A).
 *
 * Fora de propósito: `fingerprint`, `operationId` e qualquer metadado interno.
 * `effectGroupId` é HISTÓRICO (não diz se o efeito está ativo — quem responde
 * isso é o Effect Engine).
 */
/**
 * DTO do ataque mágico (6.6I.4): igual ao snapshot persistido, exceto a CA do
 * alvo, que só é exposta quando ele é um PERSONAGEM. Criatura/NPC segue a
 * política atual de esconder CA/PV — o snapshot no banco continua auditável.
 */
export type AttackDamageResolutionDto = Omit<AttackDamageSnapshot, 'attack'> & {
  attack: Omit<AttackDamageSnapshot['attack'], 'targetAc'> & { targetAc: number | null };
};

/** União exposta no DTO: resolução imediata de cura ou de ataque mágico. */
export type SpellCastResolutionDto = ImmediateHealingSnapshot | AttackDamageResolutionDto;

export interface SpellCastDto {
  id: string;
  spellId: string;
  casterEntity: MechanicalEntity;
  casterName: string | null;
  targetEntities: MechanicalEntity[];
  status: 'resolving' | 'resolved' | 'cancelled';
  outcome: 'effect' | 'no-effect' | 'cancelled' | null;
  requiresConcentration: boolean;
  effectGroupId: string | null;
  saveDc: number | null;
  /**
   * Snapshot do perfil de conjuração (6.6B). `null` nos casts anteriores à
   * migração: a leitura nunca recalcula nem inventa valores.
   */
  spellcasting: {
    source: { kind: string; id: string; label: string | null };
    mode: 'derived' | 'explicit' | null;
    ability: string | null;
    abilityScore: number | null;
    abilityModifier: number | null;
    proficiencyBonus: number | null;
    saveDc: number | null;
    attackBonus: number | null;
  } | null;
  /**
   * Snapshot do RECURSO gasto (6.6C). `null` em truques e nos casts antigos:
   * um descanso posterior NÃO reescreve qual espaço foi usado.
   */
  casting: {
    spellLevel: number;
    castAtLevel: number;
    resourceKind: string | null;
    resourceLevel: number | null;
    resourceSourceId: string | null;
    /** Tempo de conjuração usado (6.6D): action/bonus-action/reaction/long. */
    timeKind: string | null;
    /** Custo de economia efetivamente gasto (null fora de combate/truque). */
    economyCostKind: string | null;
  } | null;
  /**
   * Snapshot do TARGETING (6.6E). `null` nos casts anteriores à migração:
   * quantos/max/alcance/modo de validação do dia do cast, nunca recalculados.
   */
  targeting: {
    maxTargets: number | null;
    targetCount: number | null;
    rangeFeet: number | null;
    validationMode: string | null;
    requiresSight: boolean;
    requiresClearPath: boolean;
    constraints: { kind: string; result: string; confirmed: boolean }[];
  } | null;
  /**
   * Snapshot dos COMPONENTES V/S/M (6.6G): quais foram exigidos, como o material
   * foi fornecido e se algo foi consumido. `null` nos casts anteriores.
   */
  components: {
    verbal: boolean;
    somatic: boolean;
    somaticHand: string | null;
    material: boolean;
    providerKind: string | null;
    providerLabel: string | null;
    consumed: boolean;
    spellSpecifiedCostGp: number | null;
  } | null;
  /**
   * SNAPSHOT da DURAÇÃO (6.6H): definição, modo de acompanhamento e rounds.
   * `null` em magias sem duração acompanhada ou casts anteriores à migração.
   */
  duration: {
    label: string;
    unit: string;
    amount: number;
    tracking: 'combat' | 'manual';
    totalRounds: number | null;
    dueRoundNumber: number | null;
  } | null;
  /**
   * Motivo auditável de um cast fechado SEM Effect por decisão do motor
   * (ex.: `duration-expired` na barreira inicial). `null` nos demais casos.
   */
  resolutionReason: string | null;
  /**
   * SNAPSHOT da resolução IMEDIATA (6.6I.3): rolagem, modificador, cura
   * solicitada/efetiva e HP antes/depois. `null` em Effect/pendência.
   */
  resolution: SpellCastResolutionDto | null;
  createdAt: string;
  committedAt: string;
  resolvedAt: string | null;
}

function componentsOf(value: unknown): SpellCastDto['components'] {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return {
    verbal: item.verbal === true,
    somatic: item.somatic === true,
    somaticHand: typeof item.somaticHand === 'string' ? item.somaticHand : null,
    material: item.material === true,
    providerKind: typeof item.providerKind === 'string' ? item.providerKind : null,
    providerLabel: typeof item.providerLabel === 'string' ? item.providerLabel : null,
    consumed: item.materialConsumed === true,
    spellSpecifiedCostGp:
      typeof item.spellSpecifiedCostGp === 'number' ? item.spellSpecifiedCostGp : null,
  };
}

function entityOf(value: unknown): MechanicalEntity | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as { kind?: unknown; id?: unknown };
  if (typeof item.kind !== 'string' || typeof item.id !== 'string') return null;
  return { kind: item.kind as MechanicalEntity['kind'], id: item.id };
}

function targetingOf(value: unknown): SpellCastDto['targeting'] {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const constraints = Array.isArray(item.constraints)
    ? item.constraints.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const constraint = entry as { kind?: unknown; result?: unknown; confirmed?: unknown };
        if (typeof constraint.kind !== 'string' || typeof constraint.result !== 'string') return [];
        return [
          {
            kind: constraint.kind,
            result: constraint.result,
            confirmed: constraint.confirmed === true,
          },
        ];
      })
    : [];
  return {
    maxTargets: typeof item.maxTargets === 'number' ? item.maxTargets : null,
    targetCount: typeof item.targetCount === 'number' ? item.targetCount : null,
    rangeFeet: typeof item.rangeFeet === 'number' ? item.rangeFeet : null,
    validationMode: typeof item.validationMode === 'string' ? item.validationMode : null,
    requiresSight: item.requiresSight === true,
    requiresClearPath: item.requiresClearPath === true,
    constraints,
  };
}

/**
 * Snapshot de resolução SEGURO para o cliente.
 *
 * `immediate-healing` passa inteiro. No `attack-damage` a CA do alvo só sai
 * quando o alvo é um personagem: criatura/NPC é estado privado do Mestre.
 */
function resolutionOf(row: SpellCast): SpellCastResolutionDto | null {
  const snapshot = parseSpellResolutionSnapshot(row.resolutionSnapshot);
  if (!snapshot) return null;
  if (snapshot.kind === 'immediate-healing') return snapshot;
  const targets = Array.isArray(row.targets)
    ? row.targets.map(entityOf).filter((entity): entity is MechanicalEntity => entity !== null)
    : [];
  const hidesArmorClass = targets.some((entity) => entity.kind !== 'character');
  return hidesArmorClass
    ? { ...snapshot, attack: { ...snapshot.attack, targetAc: null } }
    : snapshot;
}

export function toSpellCastDto(row: SpellCast): SpellCastDto {
  const targets = Array.isArray(row.targets)
    ? row.targets.map(entityOf).filter((entity): entity is MechanicalEntity => entity !== null)
    : [];
  const status = (['resolving', 'resolved', 'cancelled'] as const).includes(
    row.status as 'resolving' | 'resolved' | 'cancelled',
  )
    ? (row.status as 'resolving' | 'resolved' | 'cancelled')
    : 'cancelled';
  const outcome =
    row.outcome === 'effect' || row.outcome === 'no-effect' || row.outcome === 'cancelled'
      ? row.outcome
      : null;
  const spellcasting =
    row.spellcastingSourceKind && row.spellcastingSourceId
      ? {
          source: {
            kind: row.spellcastingSourceKind,
            id: row.spellcastingSourceId,
            label: row.spellcastingSourceLabel ?? null,
          },
          mode:
            row.spellcastingMode === 'derived'
              ? ('derived' as const)
              : row.spellcastingMode === 'explicit'
                ? ('explicit' as const)
                : null,
          ability: row.spellcastingAbility ?? null,
          abilityScore: row.spellcastingAbilityScore ?? null,
          abilityModifier: row.spellcastingAbilityModifier ?? null,
          proficiencyBonus: row.spellcastingProficiencyBonus ?? null,
          saveDc: row.spellSaveDc ?? row.saveDc ?? null,
          attackBonus: row.spellAttackBonus ?? null,
        }
      : null;
  const casting =
    row.spellLevel !== null || row.castAtLevel !== null
      ? {
          spellLevel: row.spellLevel ?? row.castAtLevel ?? 0,
          castAtLevel: row.castAtLevel ?? row.spellLevel ?? 0,
          resourceKind: row.castingResourceKind ?? null,
          resourceLevel: row.castingResourceLevel ?? null,
          resourceSourceId: row.castingResourceSourceId ?? null,
          timeKind: row.castingTimeKind ?? null,
          economyCostKind: row.economyCostKind ?? null,
        }
      : null;
  return {
    id: row.id,
    spellId: row.spellId,
    casterEntity: {
      kind: row.casterEntityKind as MechanicalEntity['kind'],
      id: row.casterEntityId,
    },
    casterName: row.casterLabel ?? null,
    targetEntities: targets,
    status,
    outcome,
    requiresConcentration: row.requiresConcentration,
    effectGroupId: row.effectGroupId ?? null,
    saveDc: row.saveDc ?? null,
    spellcasting,
    casting,
    targeting: targetingOf(row.targetingSnapshot),
    components: componentsOf(row.componentsSnapshot),
    duration: (() => {
      const snapshot = parseDurationSnapshot(row.durationSnapshot);
      if (!snapshot) return null;
      const summary = durationSummary(snapshot, null);
      return {
        label: summary.label,
        unit: summary.unit,
        amount: summary.amount,
        tracking: summary.tracking,
        totalRounds: summary.totalRounds,
        dueRoundNumber: summary.dueRoundNumber,
      };
    })(),
    resolutionReason: row.resolutionReason ?? null,
    resolution: resolutionOf(row),
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}
