import type { EffectInstance } from '@prisma/client';
import type { MechanicalEntity } from '../shared/conditions.js';
import {
  parseEffectConditions,
  parseEffectModifiers,
  type EffectCondition,
  type EffectModifier,
} from './effect-modifiers.js';
import {
  effectEndReasonSchema,
  effectSourceTypeSchema,
  effectStatusSchema,
  effectVisibilitySchema,
  type EffectEndReason,
  type EffectSourceType,
  type EffectStatus,
  type EffectVisibility,
} from './effects.schema.js';

/**
 * DTO SEGURO de uma instância de efeito.
 *
 * Não é o modelo Prisma cru: `metadata` fica de fora de propósito nesta fase
 * (nada mecânico mora nele e ele pode guardar detalhes narrativos privados).
 * Os campos de união são VALIDADOS na leitura com fallback FECHADO:
 *  • visibility desconhecida → `private` (nunca vaza por dado inválido);
 *  • status desconhecido → `ended` (nunca conta como ativo);
 *  • sourceType desconhecido → `system`.
 */
export interface EffectDto {
  id: string;
  groupId: string | null;
  /** Identificador mecânico ("spell.bless"); o `label` é só exibição. */
  definitionId: string | null;
  label: string;
  sourceType: EffectSourceType;
  sourceId: string | null;
  /** Entidade responsável, quando existe (Cleric do Bless, Bárbaro da Fúria). */
  sourceEntity: MechanicalEntity | null;
  /** Origem legível carimbada pelo servidor ("Mestre", nome da criatura). */
  sourceLabel: string | null;
  targetEntity: MechanicalEntity;
  visibility: EffectVisibility;
  status: EffectStatus;
  /**
   * Modificadores mecânicos tipados da instância (6.5B). Efeito `private` nem
   * chega ao jogador (o filtro é no servidor), então aqui não há vazamento.
   */
  modifiers: EffectModifier[];
  /**
   * Conditions que a instância APLICA no alvo (6.5C). Efeito `private` nem
   * chega ao jogador, então esta definição também não vaza.
   */
  conditions: EffectCondition[];
  createdAt: string;
  createdBy: string | null;
  endedAt: string | null;
  endReason: EffectEndReason | null;
}

function entityOf(kind: string | null, id: string | null): MechanicalEntity | null {
  if (!kind || !id) return null;
  return { kind: kind as MechanicalEntity['kind'], id };
}

export function toEffectDto(row: EffectInstance): EffectDto {
  const sourceEntity = entityOf(row.sourceEntityKind, row.sourceEntityId);
  const endReason = effectEndReasonSchema.safeParse(row.endReason).success
    ? (row.endReason as EffectEndReason)
    : null;
  return {
    id: row.id,
    groupId: row.groupId ?? null,
    definitionId: row.definitionId ?? null,
    label: row.label,
    sourceType: effectSourceTypeSchema.catch('system').parse(row.sourceType),
    sourceId: row.sourceId ?? null,
    sourceEntity,
    sourceLabel: row.sourceLabel ?? null,
    targetEntity: { kind: row.targetEntityKind as MechanicalEntity['kind'], id: row.targetEntityId },
    visibility: effectVisibilitySchema.catch('private').parse(row.visibility),
    status: effectStatusSchema.catch('ended').parse(row.status),
    modifiers: parseEffectModifiers(row.modifiers),
    conditions: parseEffectConditions(row.conditions),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ?? null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    endReason,
  };
}

/**
 * Filtra o que o papel pode ver. O MASTER vê tudo; o jogador só `public`.
 * O filtro fica NO SERVIDOR (nunca em CSS/UI): efeito privado não chega ao
 * jogador nem para ser escondido.
 */
export function effectsVisibleTo(rows: EffectInstance[], isMaster: boolean): EffectDto[] {
  return rows
    .filter((row) => isMaster || row.visibility === 'public')
    .map(toEffectDto);
}
