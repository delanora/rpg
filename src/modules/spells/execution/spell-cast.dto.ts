import type { SpellCast } from '@prisma/client';
import type { MechanicalEntity } from '../../shared/conditions.js';

/**
 * DTO SEGURO de uma conjuração (Fase 6.6A).
 *
 * Fora de propósito: `fingerprint`, `operationId` e qualquer metadado interno.
 * `effectGroupId` é HISTÓRICO (não diz se o efeito está ativo — quem responde
 * isso é o Effect Engine).
 */
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
  createdAt: string;
  committedAt: string;
  resolvedAt: string | null;
}

function entityOf(value: unknown): MechanicalEntity | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as { kind?: unknown; id?: unknown };
  if (typeof item.kind !== 'string' || typeof item.id !== 'string') return null;
  return { kind: item.kind as MechanicalEntity['kind'], id: item.id };
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
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}
