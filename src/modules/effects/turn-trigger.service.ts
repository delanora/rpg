import type { PendingEffectSave, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { orderCombatants } from '../combat/combat.dto.js';
import {
  endOfTurnTriggers,
  manualTriggerOccurrenceId,
  parseTurnTriggers,
  turnTriggerOccurrenceId,
  type EffectTurnTriggerDefinition,
} from './effect-turn-triggers.js';
import { endEffectInstance } from './effect-group-lifecycle.js';
import {
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
} from './pending-effect-saves.js';
import type { EffectActor } from './effects.service.js';

/**
 * FASE 6.6H — TRIGGERS DE EFEITO CONTÍNUO.
 *
 * O trigger é do EFEITO (definição + snapshot na instância). Este módulo só
 * materializa a OPORTUNIDADE de salvaguarda — nunca uma nova conjuração:
 *
 *   EffectInstance → fim do turno do alvo → PendingEffectSave `ongoing`
 *   → success (encerra SÓ esta instância) | failure (mantém) | decline (mantém)
 *
 * Regras de ouro:
 *  • nenhuma pendência duplicada: a identidade da ocorrência é determinística e
 *    o índice ÚNICO parcial do banco (phase = 'ongoing') é a barreira final;
 *  • recusar é terminal DAQUELA ocorrência e NÃO encerra o efeito (§43/§47/§88);
 *  • a pendência contínua NUNCA reabre o `SpellCast` (§38);
 *  • a CD vem do SNAPSHOT do cast de origem, nunca do caster atual (§57).
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Efeito ativo com triggers + dados do grupo/fonte. */
interface TriggerEffect {
  id: string;
  groupId: string | null;
  definitionId: string | null;
  label: string;
  visibility: string;
  turnTriggers: unknown;
  sourceEntityKind: string | null;
  sourceEntityId: string | null;
  sourceLabel: string | null;
  targetEntityKind: string;
  targetEntityId: string;
}

const TRIGGER_EFFECT_SELECT = {
  id: true,
  groupId: true,
  definitionId: true,
  label: true,
  visibility: true,
  turnTriggers: true,
  sourceEntityKind: true,
  sourceEntityId: true,
  sourceLabel: true,
  targetEntityKind: true,
  targetEntityId: true,
} as const;

/** Chave canônica do ALVO de um combatente (personagem → ficha). */
export function canonicalTargetOf(combatant: {
  id: string;
  characterId: string | null;
}): MechanicalEntity {
  return combatant.characterId
    ? { kind: 'character', id: combatant.characterId }
    : { kind: 'combatant', id: combatant.id };
}

/**
 * CD do save repetido: SNAPSHOT do cast de origem.
 *
 * O vínculo é o grupo (`SpellCast.effectGroupId`), não o nome da magia. Sem
 * cast identificável não existe CD confiável — o trigger é simplesmente
 * ignorado em vez de inventar um número.
 */
async function originSaveDc(
  effect: Pick<TriggerEffect, 'groupId'>,
  db: Db,
): Promise<number | null> {
  if (!effect.groupId) return null;
  const cast = await db.spellCast.findFirst({
    where: { effectGroupId: effect.groupId, status: 'resolved' },
    orderBy: { committedAt: 'asc' },
    select: { spellSaveDc: true, saveDc: true },
  });
  return cast?.spellSaveDc ?? cast?.saveDc ?? null;
}

interface OngoingPendingInput {
  effect: TriggerEffect;
  trigger: EffectTurnTriggerDefinition;
  occurrenceId: string;
  dc: number;
  createdBy: string | null;
}

/**
 * Cria (ou devolve) a pendência contínua daquela ocorrência.
 *
 * `operationId` = identidade da ocorrência: o índice único devolve a MESMA
 * linha em retry/concorrência, sem criar uma segunda oportunidade.
 */
async function createOngoingPending(
  input: OngoingPendingInput,
  db: Prisma.TransactionClient,
): Promise<PendingEffectSave> {
  const existing = await db.pendingEffectSave.findFirst({
    where: { effectInstanceId: input.effect.id, triggerOccurrenceId: input.occurrenceId },
  });
  if (existing) return existing;

  try {
    return await db.pendingEffectSave.create({
      data: {
        definitionId: input.effect.definitionId ?? 'effect.turn-trigger',
        // Pendência CONTÍNUA: nunca vinculada a um novo SpellCast.
        spellCastId: null,
        phase: 'ongoing',
        effectInstanceId: input.effect.id,
        triggerKey: input.trigger.key,
        triggerOccurrenceId: input.occurrenceId,
        optional: input.trigger.optional,
        casterEntityKind: input.effect.sourceEntityKind ?? input.effect.targetEntityKind,
        casterEntityId: input.effect.sourceEntityId ?? input.effect.targetEntityId,
        casterLabel: input.effect.sourceLabel,
        targetEntityKind: input.effect.targetEntityKind,
        targetEntityId: input.effect.targetEntityId,
        ability: input.trigger.ability,
        dc: input.dc,
        visibility: input.effect.visibility === 'private' ? 'private' : 'public',
        status: 'pending',
        operationId: input.occurrenceId,
        fingerprint: `ongoing:${input.occurrenceId}`,
        createdBy: input.createdBy,
      },
    });
  } catch (error) {
    // Corrida do mesmo fim de turno: a constraint decide o vencedor.
    const winner = await db.pendingEffectSave.findFirst({
      where: { effectInstanceId: input.effect.id, triggerOccurrenceId: input.occurrenceId },
    });
    if (winner) return winner;
    throw error;
  }
}

export interface EndOfTurnTriggerResult {
  /** `true` quando existe pendência contínua não resolvida (turno NÃO avança). */
  blocked: boolean;
  /** Alvos cujas pendências mudaram (publicar depois do commit). */
  targets: MechanicalEntity[];
  pendingCount: number;
}

/**
 * Abre as oportunidades de fim de turno do combatente ATUAL.
 *
 * Roda ANTES de avançar o turno e em transação PRÓPRIA de propósito: as
 * pendências precisam existir mesmo quando o avanço é recusado. A recusa em si
 * acontece no `nextTurn` (read-only), com o código `TURN_END_TRIGGER_PENDING`.
 */
export async function openEndOfTurnTriggers(combatId: string): Promise<EndOfTurnTriggerResult> {
  const result = await prisma.$transaction(async (db) => {
    const combat = await db.combat.findUnique({
      where: { id: combatId },
      include: { combatants: true },
    });
    if (!combat || combat.status !== 'ACTIVE') {
      return { blocked: false, targets: [] as MechanicalEntity[], pendingCount: 0, opened: 0 };
    }
    const ordered = orderCombatants(combat.combatants as never);
    const outgoing = ordered[combat.currentIndex];
    if (!outgoing) {
      return { blocked: false, targets: [] as MechanicalEntity[], pendingCount: 0, opened: 0 };
    }

    const target = canonicalTargetOf(outgoing);
    const effects = (await db.effectInstance.findMany({
      where: {
        targetEntityKind: target.kind,
        targetEntityId: target.id,
        status: 'active',
      },
      orderBy: { createdAt: 'asc' },
      select: TRIGGER_EFFECT_SELECT,
    })) as TriggerEffect[];

    let opened = 0;
    const effectIds = effects.map((effect) => effect.id);
    for (const effect of effects) {
      for (const trigger of endOfTurnTriggers(parseTurnTriggers(effect.turnTriggers))) {
        const dc = trigger.dc.kind === 'fixed' ? trigger.dc.value : await originSaveDc(effect, db);
        if (!dc) continue;
        const occurrenceId = turnTriggerOccurrenceId({
          combatId: combat.id,
          turnSequence: combat.turnSequence,
          effectInstanceId: effect.id,
          triggerKey: trigger.key,
        });
        const before = await db.pendingEffectSave.findFirst({
          where: { effectInstanceId: effect.id, triggerOccurrenceId: occurrenceId },
          select: { id: true },
        });
        if (before) continue;
        await createOngoingPending({ effect, trigger, occurrenceId, dc, createdBy: null }, db);
        opened += 1;
      }
    }

    const pendingCount = effectIds.length
      ? await db.pendingEffectSave.count({
          where: {
            effectInstanceId: { in: effectIds },
            phase: 'ongoing',
            status: 'pending',
          },
        })
      : 0;

    return {
      blocked: pendingCount > 0,
      targets: [target],
      pendingCount,
      opened,
    };
  });

  if (result.opened > 0) await publishPendingEffectSaves(result.targets);
  return { blocked: result.blocked, targets: result.targets, pendingCount: result.pendingCount };
}

async function assertActorCanResolve(
  actor: EffectActor,
  row: PendingEffectSave,
  db: Db,
): Promise<void> {
  if (actor.role === 'MASTER') return;
  if (row.targetEntityKind !== 'character') {
    throw new HttpError('Você só pode resolver a salvaguarda do seu personagem.', 403);
  }
  const owner = await db.character.findUnique({
    where: { id: row.targetEntityId },
    select: { userId: true },
  });
  if (!owner || owner.userId !== actor.userId) {
    throw new HttpError('Você só pode resolver a salvaguarda do seu personagem.', 403);
  }
}

/**
 * RECUSA explícita de uma salvaguarda OPCIONAL de fim de turno.
 *
 * PHB: "the target CAN make another saving throw". Recusar:
 *  • só vale para `phase = 'ongoing'` + `optional` (§44/§45);
 *  • deixa o efeito ATIVO (§47);
 *  • não rola dado, não gasta Ação/slot;
 *  • é terminal daquela ocorrência — o próximo turno oferece outra (§137).
 */
export async function declinePendingEffectSave(
  actor: EffectActor,
  pendingId: string,
): Promise<PendingEffectSaveDto> {
  const row = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
  await assertActorCanResolve(actor, row, prisma);

  if (row.phase !== 'ongoing' || !row.optional) {
    throw new HttpError(
      'Esta salvaguarda é obrigatória e não pode ser recusada.',
      409,
      'PENDING_EFFECT_SAVE_NOT_OPTIONAL',
    );
  }
  if (row.status !== 'pending') {
    return toPendingEffectSaveDto(row);
  }

  await prisma.pendingEffectSave.updateMany({
    where: { id: pendingId, status: 'pending' },
    data: { status: 'declined', result: null, declinedAt: new Date(), resolvedAt: new Date() },
  });
  const fresh = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
  await publishPendingEffectSaves([
    { kind: fresh.targetEntityKind as MechanicalEntity['kind'], id: fresh.targetEntityId },
  ]);
  return toPendingEffectSaveDto(fresh);
}

/**
 * EFECTO do resultado de um save CONTÍNUO.
 *
 * Sucesso → encerra SOMENTE aquela instância pelo lifecycle central (que remove
 * Conditions/Paralyzed da própria fonte e, se o grupo ficou vazio, encerra a
 * Concentração). Falha → nada muda. Nenhum caminho cria SpellCast/slot/Ação.
 */
export async function applyOngoingSaveOutcome(
  row: PendingEffectSave,
  success: boolean,
  db: Db,
): Promise<{ targets: MechanicalEntity[]; concentrationEnded: boolean }> {
  if (!success || !row.effectInstanceId) return { targets: [], concentrationEnded: false };
  return endEffectInstance(row.effectInstanceId, 'repeat-save-success', db);
}

/**
 * TRIGGER MANUAL (fora de combate, §93–§95).
 *
 * Sem world clock não existe "fim de turno" autoritativo: o MESTRE declara que
 * o equivalente narrativo aconteceu e a oportunidade é aberta. `operationId`
 * entra na identidade da ocorrência, então o retry devolve a MESMA pendência.
 */
export async function fireEffectTurnTrigger(
  actor: EffectActor,
  effectId: string,
  triggerKey: string,
  operationId: string,
): Promise<PendingEffectSaveDto> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre dispara um gatilho manual.', 403);
  }
  const effect = await prisma.effectInstance.findUnique({ where: { id: effectId } });
  if (!effect) throw new HttpError('Efeito não encontrado.', 404);
  if (effect.status !== 'active') {
    throw new HttpError('Este efeito já foi encerrado.', 409, 'EFFECT_NOT_ACTIVE');
  }
  const trigger = endOfTurnTriggers(parseTurnTriggers(effect.turnTriggers)).find(
    (item) => item.key === triggerKey,
  );
  if (!trigger) {
    throw new HttpError('Este efeito não possui este gatilho de turno.', 409, 'EFFECT_TRIGGER_UNKNOWN');
  }

  const occurrenceId = manualTriggerOccurrenceId({
    effectInstanceId: effect.id,
    triggerKey: trigger.key,
    operationId,
  });
  const stored = (await effectInstanceRow(effect.id)) as TriggerEffect;
  const pending = await prisma.$transaction(async (db) => {
    const dc = trigger.dc.kind === 'fixed' ? trigger.dc.value : await originSaveDc(stored, db);
    if (!dc) {
      throw new HttpError(
        'A CD desta salvaguarda não pode ser recuperada do cast de origem.',
        409,
        'EFFECT_TRIGGER_WITHOUT_DC',
      );
    }
    return createOngoingPending(
      { effect: stored, trigger, occurrenceId, dc, createdBy: actor.userId },
      db,
    );
  });

  await publishPendingEffectSaves([
    { kind: effect.targetEntityKind as MechanicalEntity['kind'], id: effect.targetEntityId },
  ]);
  return toPendingEffectSaveDto(pending);
}

function effectInstanceRow(effectId: string): Promise<TriggerEffect> {
  return prisma.effectInstance.findUniqueOrThrow({
    where: { id: effectId },
    select: TRIGGER_EFFECT_SELECT,
  }) as Promise<TriggerEffect>;
}
