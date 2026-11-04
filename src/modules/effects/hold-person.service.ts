import { randomUUID } from 'node:crypto';
import type { PendingEffectSave, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { loadEntity, type LoadedEntity } from '../mechanical/mechanical.service.js';
import { applyEffectConditions, saveMechanicalState } from './effect-conditions.js';
import {
  appendEffectLog,
  endEffectsForConcentration,
  publishEffects,
  type EffectActor,
} from './effects.service.js';
import { findEffectDefinition } from './definitions/registry.js';
import { toEffectDto, type EffectDto } from './effects.dto.js';
import { HOLD_PERSON_SPELL_ID } from './definitions/hold-person.js';
import {
  definitionLabel,
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
} from './pending-effect-saves.js';
import { cancelSpellCastForPending, castProofSpell } from '../spells/execution/spell-cast.service.js';
import { tryFinalizeSaveEffectCast } from '../spells/execution/save-effect-finalizer.js';
import type { ApplyHoldPersonInput } from './effects.schema.js';

/**
 * FASE 6.6A — HOLD PERSON como consumidor do SPELL CAST SERVICE.
 *
 * A aplicação de prova virou um wrapper do contrato único: VALIDATE → COMMIT →
 * RESOLVE. A grande mudança de semântica (6.6A): o COMMIT de uma conjuração
 * concentrada encerra a Concentração ANTERIOR do caster ANTES de qualquer
 * salvaguarda. Passar no save não restaura a concentração antiga e não cria
 * concentração nova.
 *
 * FASE 6.6E — MULTI-ALVO com RESOLUTION BARRIER: um cast com espaço superior
 * pode atingir N humanoides. Isso continua sendo UM SpellCast, UM espaço, UMA
 * Ação e UMA Concentração potencial — o que muda é existir UMA
 * `PendingEffectSave` por alvo. Nenhum Effect nasce antes de o ÚLTIMO save
 * resolver: aí o `save-effect-finalizer` cria UM grupo com uma instância por
 * falha. Cancelar a pendência cancela a CONJURAÇÃO inteira (nada é parcial).
 */

export interface HoldPersonResult {
  pending: PendingEffectSaveDto;
  /** Todas as pendências do cast (multi-alvo desde 6.6E). */
  pendings: PendingEffectSaveDto[];
  replayed: boolean;
}

export interface HoldPersonResolution {
  pending: PendingEffectSaveDto;
  success: boolean;
  replayed: boolean;
  target: MechanicalEntity | null;
  caster: MechanicalEntity | null;
  /** Efeito criado para ESTE alvo (null em sucesso/barrier). */
  effect: EffectDto | null;
  /** Alvos que falharam e receberam o efeito. */
  failedTargets: MechanicalEntity[];
  /** Visões derivadas que mudaram (publicar depois do commit). */
  affectedTargets: MechanicalEntity[];
  /** Todos os alvos do cast (as pendências deles mudaram). */
  castTargets: MechanicalEntity[];
  label: string;
  dc: number;
}

function keyOf(entity: MechanicalEntity): string {
  return `${entity.kind}:${entity.id}`;
}

function uniqueEntities(entities: readonly MechanicalEntity[]): MechanicalEntity[] {
  const seen = new Set<string>();
  const result: MechanicalEntity[] = [];
  for (const entity of entities) {
    const key = keyOf(entity);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entity);
  }
  return result;
}

/**
 * APLICAÇÃO CONTROLADA (Mestre) — delega ao cast service.
 *
 * Todo detalhe mecânico (atributo do save, CD de magia, Condition, definição de
 * efeito, quantidade de alvos, alcance, ordem do lifecycle) é do SERVIDOR; o
 * payload só traz caster, alvos, a confirmação espacial quando exigida e, no
 * multiclasse, qual fonte/espaço. Desde a 6.6C a conjuração gasta um espaço:
 * passar no save NÃO devolve o espaço, nem cancelar a pendência depois do commit.
 */
export async function applyHoldPerson(
  actor: EffectActor,
  input: ApplyHoldPersonInput,
): Promise<HoldPersonResult> {
  const targets = input.targets ?? (input.target ? [input.target] : []);
  const result = await castProofSpell(actor, {
    operationId: input.operationId,
    spellId: HOLD_PERSON_SPELL_ID,
    caster: input.caster,
    targets,
    ...(input.spellcastingSource ? { spellcastingSource: input.spellcastingSource } : {}),
    // 6.6C: o espaço é gasto no COMMIT (nível >= 2), antes da salvaguarda.
    ...(input.castingResource ? { castingResource: input.castingResource } : {}),
    ...(input.spatialConfirmation ? { spatialConfirmation: input.spatialConfirmation } : {}),
  });
  if (result.pendings.length === 0) {
    throw new HttpError('A conjuração não gerou salvaguarda pendente.', 409, 'CONFLICT');
  }
  return {
    pending: result.pendings[0],
    pendings: result.pendings,
    replayed: result.replayed,
  };
}

/** GET de pendências de um alvo, com privacidade aplicada no SERVIDOR. */
export async function listPendingEffectSaves(
  actor: EffectActor,
  target: MechanicalEntity,
): Promise<PendingEffectSaveDto[]> {
  const loaded = await loadEntity(target);
  if (actor.role !== 'MASTER') {
    if (loaded.entity.kind !== 'character' || loaded.ownerUserId !== actor.userId) {
      throw new HttpError('Você só pode consultar as pendências do seu personagem.', 403);
    }
  }
  const rows = await prisma.pendingEffectSave.findMany({
    where: {
      targetEntityKind: loaded.entity.kind,
      targetEntityId: loaded.entity.id,
      status: 'pending',
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows
    .filter((row) => actor.role === 'MASTER' || row.visibility === 'public')
    .map(toPendingEffectSaveDto);
}

/**
 * Cancela uma resolução pendente (ferramenta administrativa).
 *
 * 6.6E: como um cast multi-alvo é UM evento, cancelar QUALQUER pendência cancela
 * a conjuração INTEIRA — todas as pendências restantes vão para `cancelled`, o
 * SpellCast para `cancelled` e nenhum Effect inicial nasce. Sem cancelamento
 * parcial de alvo nesta fase. A Concentração anterior NÃO volta.
 */
export async function cancelPendingEffectSave(
  actor: EffectActor,
  pendingId: string,
): Promise<PendingEffectSaveDto> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre cancela a aplicação pendente.', 403);
  }
  const row = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);

  await prisma.$transaction(async (db) => {
    await db.pendingEffectSave.updateMany({
      where: { id: pendingId, status: 'pending' },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    if (row.spellCastId) {
      await db.pendingEffectSave.updateMany({
        where: { spellCastId: row.spellCastId, status: 'pending' },
        data: { status: 'cancelled', resolvedAt: new Date() },
      });
    }
    await cancelSpellCastForPending(row.spellCastId, db);
  });

  const fresh = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
  await publishPendingEffectSaves([
    { kind: fresh.targetEntityKind as MechanicalEntity['kind'], id: fresh.targetEntityId },
  ]);
  return toPendingEffectSaveDto(fresh);
}

export interface PendingEffectSaveForRoll {
  pending: PendingEffectSaveDto;
  /** Alvo CANÔNICO (personagem em combate → ficha). */
  targetEntity: MechanicalEntity;
}

/**
 * Carrega a pendência para a ROLAGEM do save.
 *
 * A autoridade de alvo/atributo/CD é a linha persistida; o cliente só informa
 * o id da pendência. Jogador só resolve a pendência do próprio personagem;
 * a de NPC/criatura é rolada pelo Mestre.
 */
export async function loadPendingEffectSaveForRoll(
  actor: EffectActor,
  pendingId: string,
): Promise<PendingEffectSaveForRoll> {
  const row = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
  if (row.status !== 'pending') {
    throw new HttpError('Esta salvaguarda não está mais pendente.', 409, 'CONFLICT');
  }
  const target = await loadEntity({
    kind: row.targetEntityKind as MechanicalEntity['kind'],
    id: row.targetEntityId,
  });
  if (actor.role !== 'MASTER') {
    if (target.entity.kind !== 'character' || target.ownerUserId !== actor.userId) {
      throw new HttpError('Você só pode rolar a salvaguarda do seu personagem.', 403);
    }
  }
  return { pending: toPendingEffectSaveDto(row), targetEntity: target.entity };
}

function replayedResolution(row: PendingEffectSave): HoldPersonResolution {
  const target = { kind: row.targetEntityKind as MechanicalEntity['kind'], id: row.targetEntityId };
  const caster = { kind: row.casterEntityKind as MechanicalEntity['kind'], id: row.casterEntityId };
  return {
    pending: toPendingEffectSaveDto(row),
    success: row.result === 'success',
    replayed: true,
    target,
    caster,
    effect: null,
    failedTargets: [],
    affectedTargets: [],
    castTargets: [target],
    label: definitionLabel(row.definitionId),
    dc: row.dc,
  };
}

/**
 * Aplicação de uma pendência SEM SpellCast (linhas anteriores à 6.6A).
 *
 * Mantém o comportamento histórico de 1 pendência = 1 efeito, sem tocar no
 * caminho novo (que sempre tem `spellCastId`).
 */
async function finalizeStandalonePending(
  db: Prisma.TransactionClient,
  row: PendingEffectSave,
  caster: LoadedEntity,
  target: MechanicalEntity,
): Promise<void> {
  const effect = findEffectDefinition(row.definitionId);
  if (!effect) return;
  const groupId = randomUUID();
  const effectRow = await db.effectInstance.create({
    data: {
      groupId,
      definitionId: effect.definitionId,
      label: effect.label,
      sourceType: 'spell',
      sourceId: HOLD_PERSON_SPELL_ID,
      sourceEntityKind: caster.entity.kind,
      sourceEntityId: caster.entity.id,
      sourceLabel: caster.name,
      modifiers: effect.modifiers() as unknown as Prisma.InputJsonValue,
      conditions: effect.conditions() as unknown as Prisma.InputJsonValue,
      targetEntityKind: target.kind,
      targetEntityId: target.id,
      visibility: 'public',
      status: 'active',
      createdBy: row.createdBy ?? null,
    },
  });
  const fresh = await loadEntity(caster.entity, db);
  fresh.state.concentration = {
    id: randomUUID(),
    label: effect.label,
    sourceType: 'effect',
    sourceId: groupId,
    visibility: 'public',
    startedAt: new Date().toISOString(),
    ...(row.createdBy ? { startedBy: row.createdBy } : {}),
  };
  fresh.state.pendingConcentrationSaves = [];
  await saveMechanicalState(fresh, fresh.state, db);
  await applyEffectConditions(effectRow, target, db);
  await db.pendingEffectSave.update({
    where: { id: row.id },
    data: { groupId, effectId: effectRow.id },
  });
}

/**
 * RESOLVE a pendência com o TOTAL já rolado pelo pipeline de salvaguarda.
 *
 * Em 6.6E o save NÃO cria mais o Effect sozinho: ele grava o resultado e tenta
 * fechar a conjuração inteira pelo `save-effect-finalizer`. Enquanto sobrar
 * qualquer alvo pendente, a SpellCast continua `resolving` e nada mecânico nasce.
 *
 * Idempotência/concorrência: a transição `pending → resolved` guardada por
 * status é a reivindicação; retry devolve o snapshot e NUNCA rola/aplica duas
 * vezes.
 */
export async function resolvePendingEffectSave(
  pendingId: string,
  total: number,
  actorName = 'Sistema',
): Promise<HoldPersonResolution> {
  const initial = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!initial) throw new HttpError('Aplicação pendente não encontrada.', 404);
  if (initial.status !== 'pending') return replayedResolution(initial);

  const success = total >= initial.dc;

  try {
    return await prisma.$transaction(async (db) => {
      const row = await db.pendingEffectSave.findUnique({ where: { id: pendingId } });
      if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
      if (row.status !== 'pending') return replayedResolution(row);

      const caster = await loadEntity(
        { kind: row.casterEntityKind as MechanicalEntity['kind'], id: row.casterEntityId },
        db,
      );
      const target = await loadEntity(
        { kind: row.targetEntityKind as MechanicalEntity['kind'], id: row.targetEntityId },
        db,
      );

      const claimed = await db.pendingEffectSave.updateMany({
        where: { id: pendingId, status: 'pending' },
        data: {
          status: 'resolved',
          result: success ? 'success' : 'failure',
          resolvedAt: new Date(),
        },
      });
      if (!claimed.count) {
        const later = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
        return replayedResolution(later);
      }

      let effect: EffectDto | null = null;
      let failedTargets: MechanicalEntity[] = [];
      let affectedTargets: MechanicalEntity[] = [target.entity];
      let castTargets: MechanicalEntity[] = [target.entity];

      if (row.spellCastId) {
        // RESOLUTION BARRIER: só cria Effect/Concentração quando TODOS os saves
        // do cast resolveram. Um alvo que passou nunca recebe Paralyzed.
        const finalization = await tryFinalizeSaveEffectCast(row.spellCastId, db);
        failedTargets = finalization.failedTargets;
        affectedTargets = uniqueEntities([...affectedTargets, ...finalization.affectedTargets]);
        castTargets = uniqueEntities([...finalization.castTargets, target.entity]);
        const own = finalization.effects.find(
          (item) =>
            item.targetEntityKind === target.entity.kind &&
            item.targetEntityId === target.entity.id,
        );
        effect = own ? toEffectDto(own) : null;
      } else if (!success) {
        await finalizeStandalonePending(db, row, caster, target.entity);
        failedTargets = [target.entity];
        const own = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
        if (own.effectId) {
          const effectRow = await db.effectInstance.findUniqueOrThrow({ where: { id: own.effectId } });
          effect = toEffectDto(effectRow);
        }
      }

      const fresh = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
      return {
        pending: toPendingEffectSaveDto(fresh),
        success,
        replayed: false,
        target: target.entity,
        caster: caster.entity,
        effect,
        failedTargets,
        affectedTargets,
        castTargets,
        label: definitionLabel(row.definitionId),
        dc: row.dc,
      } satisfies HoldPersonResolution;
    });
  } catch (error) {
    // Entidade removida no meio do caminho: as pendências e o cast são
    // CANCELADOS; nenhum efeito aponta para algo inexistente.
    if (error instanceof HttpError && error.status === 404) {
      await prisma.$transaction(async (db) => {
        const row = await db.pendingEffectSave.findUnique({ where: { id: pendingId } });
        await db.pendingEffectSave.updateMany({
          where: { id: pendingId, status: 'pending' },
          data: { status: 'cancelled', resolvedAt: new Date() },
        });
        if (row?.spellCastId) {
          await db.pendingEffectSave.updateMany({
            where: { spellCastId: row.spellCastId, status: 'pending' },
            data: { status: 'cancelled', resolvedAt: new Date() },
          });
        }
        await cancelSpellCastForPending(row?.spellCastId, db);
      });
      throw new HttpError(
        'A entidade desta aplicação não existe mais; a salvaguarda foi cancelada.',
        409,
        'CONFLICT',
      );
    }
    throw error;
  }
}

/**
 * Publica o resultado: pendências restantes, consequências (se houver) e as
 * visões derivadas. UMA linha de registro por alvo que mudou.
 */
export async function publishHoldPersonResult(
  resolution: HoldPersonResolution,
  actorName: string,
): Promise<void> {
  if (resolution.replayed) return;
  const targets = uniqueEntities([
    ...resolution.castTargets,
    ...resolution.affectedTargets,
  ]);
  for (const failed of resolution.failedTargets) {
    await appendEffectLog(
      failed,
      actorName,
      (name) => `${name} falhou na salvaguarda e ficou Paralisado — ${resolution.label}.`,
      false,
    );
  }
  if (resolution.success && resolution.target) {
    await appendEffectLog(
      resolution.target,
      actorName,
      (name) => `${name} resistiu a ${resolution.label} (salvaguarda de Sabedoria).`,
      false,
    );
  }
  // As pendências de TODOS os alvos mudaram (uma resolveu), então a lista é
  // republicada para cada um — sem vazar pendências privadas de NPC.
  if (targets.length > 0) {
    await publishPendingEffectSaves(targets);
    await publishEffects(targets);
  }
}
