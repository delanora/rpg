import type { PendingEffectSave, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { ServerEvents } from '../../realtime/events.js';
import type { AbilityKey } from '../shared/dnd5e.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { HOLD_PERSON_DEFINITION_ID, HOLD_PERSON_LABEL } from './definitions/hold-person.js';

/**
 * FASE 6.5H — APLICAÇÃO DE EFEITO AGUARDANDO SALVAGUARDA.
 *
 * Uma pendência é só o intervalo entre "o efeito foi direcionado" e "o alvo
 * passou/falhou no save": nenhum Effect/Condition/Concentração nasce antes do
 * resultado. Por isso ela NÃO mora no `mechanicalState` nem em memória do
 * processo — é uma linha persistente (`pending_effect_saves`) com transição
 * guardada por `status`, o que dá idempotência e concorrência seguras.
 *
 * NÃO é a Spell Execution Engine: não há slot, Ação, componentes, alcance,
 * duração nem upcasting. `definitionId`, atributo do save e Condition são
 * fixados pelo SERVIDOR; o cliente só escolhe caster/alvo (Mestre) e resolve.
 */

export type PendingEffectSaveStatus = 'pending' | 'resolved' | 'cancelled';
export type PendingEffectSaveResult = 'success' | 'failure';

export interface PendingEffectSaveDto {
  id: string;
  definitionId: string;
  /** Rótulo humano da definição (nunca decide regra). */
  label: string;
  ability: AbilityKey;
  dc: number;
  visibility: 'public' | 'private';
  status: PendingEffectSaveStatus;
  result: PendingEffectSaveResult | null;
  casterEntity: MechanicalEntity;
  /** Origem legível carimbada pelo SERVIDOR na criação. */
  casterName: string | null;
  targetEntity: MechanicalEntity;
  groupId: string | null;
  effectId: string | null;
  /** Conjuração que originou a pendência (6.6A; null em fluxos antigos). */
  spellCastId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Rótulo da definição (o `definitionId` é a identidade; isto é exibição). */
export function definitionLabel(definitionId: string): string {
  return definitionId === HOLD_PERSON_DEFINITION_ID ? HOLD_PERSON_LABEL : 'Efeito';
}

function entityOf(kind: string, id: string): MechanicalEntity {
  return { kind: kind as MechanicalEntity['kind'], id };
}

/** DTO seguro: nada de fingerprint/operationId, nada de dado de rolagem. */
export function toPendingEffectSaveDto(row: PendingEffectSave): PendingEffectSaveDto {
  const status = (['pending', 'resolved', 'cancelled'] as const).includes(
    row.status as PendingEffectSaveStatus,
  )
    ? (row.status as PendingEffectSaveStatus)
    : 'cancelled';
  const result =
    row.result === 'success' || row.result === 'failure' ? (row.result as PendingEffectSaveResult) : null;
  return {
    id: row.id,
    definitionId: row.definitionId,
    label: definitionLabel(row.definitionId),
    ability: row.ability as AbilityKey,
    dc: row.dc,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    status,
    result,
    casterEntity: entityOf(row.casterEntityKind, row.casterEntityId),
    casterName: row.casterLabel ?? null,
    targetEntity: entityOf(row.targetEntityKind, row.targetEntityId),
    groupId: row.groupId ?? null,
    effectId: row.effectId ?? null,
    spellCastId: row.spellCastId ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/**
 * Pendências ATIVAS de um alvo, para o DTO do estado mecânico.
 *
 * Leitura PURA (nenhum auto-repair): o servidor só devolve o que existe. O
 * filtro de privacidade é aplicado na leitura, nunca no CSS.
 */
export async function pendingEffectSavesForEntity(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PendingEffectSaveDto[]> {
  const rows = await db.pendingEffectSave.findMany({
    where: {
      targetEntityKind: entity.kind,
      targetEntityId: entity.id,
      status: 'pending',
      visibility: 'public',
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toPendingEffectSaveDto);
}

/**
 * Cancela as pendências de uma entidade ESTRUTURALMENTE removida.
 *
 * Chamado pelos fluxos autoritativos de remoção (Effect lifecycle): uma
 * pendência nunca fica apontando para ficha/criatura que não existe mais.
 */
export async function cancelPendingEffectSavesForEntity(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const where = {
    status: 'pending',
    OR: [
      { targetEntityKind: entity.kind, targetEntityId: entity.id },
      { casterEntityKind: entity.kind, casterEntityId: entity.id },
    ],
  };
  // Cast ligado sai de `resolving` junto: nenhuma conjuração fica pendurada
  // apontando para entidade removida (6.6A). A concentração anterior NÃO volta.
  const linked = await db.pendingEffectSave.findMany({
    where,
    select: { spellCastId: true },
  });
  const cancelled = await db.pendingEffectSave.updateMany({
    where,
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  const castIds = linked
    .map((row) => row.spellCastId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (castIds.length > 0) {
    await db.spellCast.updateMany({
      where: { id: { in: castIds }, status: 'resolving' },
      data: { status: 'cancelled', outcome: 'cancelled', resolvedAt: new Date() },
    });
  }
  return cancelled.count;
}

/**
 * Publica as pendências ATIVAS do alvo.
 *
 * Mestres recebem tudo; o DONO do personagem só o que é público. O cliente
 * NUNCA recebe uma pendência privada para esconder.
 */
export async function publishPendingEffectSaves(
  targets: readonly MechanicalEntity[],
): Promise<void> {
  const seen = new Set<string>();
  for (const target of targets) {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const rows = await prisma.pendingEffectSave.findMany({
        where: {
          targetEntityKind: target.kind,
          targetEntityId: target.id,
          status: 'pending',
        },
        orderBy: { createdAt: 'asc' },
      });
      const broadcaster = getBroadcaster();
      broadcaster.toMasters(ServerEvents.EFFECTS_PENDING, {
        entity: target,
        pending: rows.map(toPendingEffectSaveDto),
      });
      if (target.kind === 'character') {
        const owner = await prisma.character.findUnique({
          where: { id: target.id },
          select: { userId: true },
        });
        if (owner) {
          broadcaster.toUser(owner.userId, ServerEvents.EFFECTS_PENDING, {
            entity: target,
            pending: rows
              .filter((row) => row.visibility === 'public')
              .map(toPendingEffectSaveDto),
          });
        }
      }
    } catch (error) {
      console.error('[effects] falha ao publicar pendências de efeito:', error);
    }
  }
}
