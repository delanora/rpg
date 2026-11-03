import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deriveConditionEffects, type MechanicalEntity } from '../shared/conditions.js';
import { loadEntity } from '../mechanical/mechanical.service.js';
import { applyEffectConditions, saveMechanicalState } from './effect-conditions.js';
import {
  appendEffectLog,
  endEffectsForConcentration,
  publishEffects,
  type EffectActor,
} from './effects.service.js';
import { toEffectDto, type EffectDto } from './effects.dto.js';
import {
  HOLD_PERSON_CONDITIONS,
  HOLD_PERSON_DEFINITION_ID,
  HOLD_PERSON_LABEL,
  HOLD_PERSON_SPELL_ID,
} from './definitions/hold-person.js';
import {
  definitionLabel,
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
} from './pending-effect-saves.js';
import { cancelSpellCastForPending, castProofSpell } from '../spells/execution/spell-cast.service.js';
import type { PendingEffectSave } from '@prisma/client';
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
 * A resolução assíncrona (save pelo pipeline de dados) continua aqui porque é
 * ela que produz o estado durável: Effect Group + EffectInstance com
 * `conditions: ['paralyzed']` + nova Concentração ligada ao grupo. Tudo ligado
 * ao `SpellCast` (histórico), que NÃO decide se o efeito está ativo.
 */

export interface HoldPersonResult {
  pending: PendingEffectSaveDto;
  replayed: boolean;
}

export interface HoldPersonResolution {
  pending: PendingEffectSaveDto;
  success: boolean;
  replayed: boolean;
  target: MechanicalEntity | null;
  caster: MechanicalEntity | null;
  effect: EffectDto | null;
  /** Alvos cujas visões derivadas mudaram (publicar depois do commit). */
  affectedTargets: MechanicalEntity[];
  label: string;
  dc: number;
}

/**
 * APLICAÇÃO CONTROLADA (Mestre) — delega ao cast service.
 *
 * Todo detalhe mecânico (atributo do save, CD de magia, Condition, definição de
 * efeito, ordem do lifecycle) é do SERVIDOR; o payload só traz caster, alvo e,
 * no multiclasse, qual fonte de conjuração. Desde a 6.6B a CD sai do perfil de
 * conjuração (personagem) ou do statblock (criatura) — nunca do cliente.
 */
export async function applyHoldPerson(
  actor: EffectActor,
  input: ApplyHoldPersonInput,
): Promise<HoldPersonResult> {
  const result = await castProofSpell(actor, {
    operationId: input.operationId,
    spellId: HOLD_PERSON_SPELL_ID,
    caster: input.caster,
    targets: [input.target],
    ...(input.spellcastingSource ? { spellcastingSource: input.spellcastingSource } : {}),
  });
  if (!result.pending) {
    throw new HttpError('A conjuração não gerou salvaguarda pendente.', 409, 'CONFLICT');
  }
  return { pending: result.pending, replayed: result.replayed };
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
 * Cancela uma pendência antes do save (ferramenta administrativa).
 *
 * O cast vai para `cancelled`/`cancelled` e a Concentração anterior do commit
 * NÃO retorna — cancelar é encerrar uma resolução já iniciada, não desfazer a
 * conjuração.
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
  return {
    pending: toPendingEffectSaveDto(row),
    success: row.result === 'success',
    replayed: true,
    target: { kind: row.targetEntityKind as MechanicalEntity['kind'], id: row.targetEntityId },
    caster: { kind: row.casterEntityKind as MechanicalEntity['kind'], id: row.casterEntityId },
    effect: null,
    affectedTargets: [],
    label: definitionLabel(row.definitionId),
    dc: row.dc,
  };
}

/**
 * Fecha o `SpellCast` ligado à pendência (histórico; nunca restaura estado).
 * Guardado por status: retry/concorrência não reescrevem um cast já finalizado.
 */
async function completeLinkedCast(
  db: Prisma.TransactionClient,
  spellCastId: string | null,
  outcome: 'effect' | 'no-effect',
  effectGroupId?: string,
): Promise<void> {
  if (!spellCastId) return;
  await db.spellCast.updateMany({
    where: { id: spellCastId, status: 'resolving' },
    data: {
      status: 'resolved',
      outcome,
      ...(effectGroupId ? { effectGroupId } : {}),
      resolvedAt: new Date(),
    },
  });
}

/**
 * REGRA GENÉRICA do motor: um caster Incapacitado ou a 0 PV não mantém
 * concentração. Roda depois da resolução (o save pode ficar pendente por tempo
 * real) e encerra o grupo pelo lifecycle — sem regra específica da magia.
 */
async function enforceCasterConcentration(
  caster: MechanicalEntity,
  db: Prisma.TransactionClient,
): Promise<MechanicalEntity[]> {
  const fresh = await loadEntity(caster, db);
  const state = fresh.state;
  if (!state.concentration) return [];
  if (!deriveConditionEffects(state).incapacitated && fresh.hpCurrent > 0) return [];

  const ended = await endEffectsForConcentration(state.concentration, db, {
    entity: fresh.entity,
    state,
  });
  state.concentration = null;
  state.pendingConcentrationSaves = [];
  await saveMechanicalState(fresh, state, db);
  return ended;
}

/**
 * RESOLVE a pendência com o TOTAL já rolado pelo pipeline de salvaguarda.
 *
 * Na FALHA: Effect + Condition + Concentração + cast (`resolved`/`effect`) na
 * MESMA transação. No SUCESSO: pending + cast (`resolved`/`no-effect`), sem
 * Effect e sem Concentração nova. Retry/concorrência usam a transição guardada
 * por status da pendência: nunca duplicam consequência.
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

      if (success) {
        // SUCESSO: nada mecânico nasce; a concentração anterior já terminou no
        // COMMIT e NÃO é restaurada.
        await completeLinkedCast(db, row.spellCastId, 'no-effect');
        const fresh = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
        return {
          pending: toPendingEffectSaveDto(fresh),
          success: true,
          replayed: false,
          target: target.entity,
          caster: caster.entity,
          effect: null,
          affectedTargets: [],
          label: definitionLabel(row.definitionId),
          dc: row.dc,
        } satisfies HoldPersonResolution;
      }

      const groupId = randomUUID();
      const effectRow = await db.effectInstance.create({
        data: {
          groupId,
          definitionId: HOLD_PERSON_DEFINITION_ID,
          label: HOLD_PERSON_LABEL,
          sourceType: 'spell',
          sourceId: HOLD_PERSON_SPELL_ID,
          sourceEntityKind: caster.entity.kind,
          sourceEntityId: caster.entity.id,
          sourceLabel: caster.name,
          modifiers: [] as unknown as Prisma.InputJsonValue,
          conditions: HOLD_PERSON_CONDITIONS as unknown as Prisma.InputJsonValue,
          targetEntityKind: target.entity.kind,
          targetEntityId: target.entity.id,
          visibility: 'public',
          status: 'active',
          createdBy: row.createdBy ?? null,
        },
      });

      // Defensivo: o commit já encerrou a concentração anterior; uma
      // concentração manual aberta depois é substituída pela nova.
      const state = caster.state;
      if (state.concentration) {
        await endEffectsForConcentration(state.concentration, db, {
          entity: caster.entity,
          state,
        });
      }
      state.concentration = {
        id: randomUUID(),
        label: HOLD_PERSON_LABEL,
        sourceType: 'effect',
        sourceId: groupId,
        visibility: 'public',
        startedAt: new Date().toISOString(),
        ...(row.createdBy ? { startedBy: row.createdBy } : {}),
      };
      state.pendingConcentrationSaves = [];
      await saveMechanicalState(caster, state, db);

      const applied = await applyEffectConditions(effectRow, target.entity, db);
      const affectedTargets: MechanicalEntity[] = [];
      if (applied.endedConcentration) {
        affectedTargets.push(
          ...(await endEffectsForConcentration(applied.endedConcentration, db)),
        );
      }
      // Caster incapacitado enquanto o save estava pendente (artefato do tempo
      // real): a concentração recém-criada não pode permanecer.
      affectedTargets.push(...(await enforceCasterConcentration(caster.entity, db)));

      await db.pendingEffectSave.update({
        where: { id: pendingId },
        data: { groupId, effectId: effectRow.id },
      });
      await completeLinkedCast(db, row.spellCastId, 'effect', groupId);

      const freshPending = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
      const freshEffect = await db.effectInstance.findUniqueOrThrow({ where: { id: effectRow.id } });

      return {
        pending: toPendingEffectSaveDto(freshPending),
        success: false,
        replayed: false,
        target: target.entity,
        caster: caster.entity,
        effect: toEffectDto(freshEffect),
        affectedTargets: [
          target.entity,
          ...(caster.entity.kind === target.entity.kind && caster.entity.id === target.entity.id
            ? []
            : [caster.entity]),
          ...affectedTargets,
        ],
        label: definitionLabel(row.definitionId),
        dc: row.dc,
      } satisfies HoldPersonResolution;
    });
  } catch (error) {
    // Entidade removida no meio do caminho: a pendência e o cast são
    // CANCELADOS; nenhum efeito aponta para algo inexistente.
    if (error instanceof HttpError && error.status === 404) {
      await prisma.$transaction(async (db) => {
        const row = await db.pendingEffectSave.findUnique({ where: { id: pendingId } });
        await db.pendingEffectSave.updateMany({
          where: { id: pendingId, status: 'pending' },
          data: { status: 'cancelled', resolvedAt: new Date() },
        });
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
 * Publica o resultado: pendência removida, consequências (se houver) e as
 * visões derivadas. UMA linha de registro por aplicação.
 */
export async function publishHoldPersonResult(
  resolution: HoldPersonResolution,
  actorName: string,
): Promise<void> {
  if (resolution.replayed) return;
  const targets = resolution.affectedTargets.filter(
    (item, index, list) =>
      list.findIndex((other) => other.kind === item.kind && other.id === item.id) === index,
  );
  if (targets.length > 0) {
    await publishEffects(targets);
    for (const target of targets) {
      await appendEffectLog(
        target,
        actorName,
        (name) =>
          resolution.success
            ? `${name} resistiu a ${resolution.label} (salvaguarda de Sabedoria).`
            : `${name} falhou na salvaguarda e ficou Paralisado — ${resolution.label}.`,
        false,
      );
    }
  }
  if (resolution.target) {
    await publishPendingEffectSaves([resolution.target]);
    // Mesmo sem mudança mecânica (SUCESSO), a ficha/combate são republicados
    // para a solicitação sumir sem refresh manual.
    await publishEffects([resolution.target]);
  }
}
