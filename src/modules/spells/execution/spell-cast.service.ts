import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type EffectInstance, type SpellCast } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { allSpells } from '../../shared/spells/index.js';
import { deriveConditionEffects, type MechanicalEntity } from '../../shared/conditions.js';
import type { ConcentrationState } from '../../shared/concentration.js';
import { loadEntity, type LoadedEntity } from '../../mechanical/mechanical.service.js';
import { applyEffectConditions, saveMechanicalState } from '../../effects/effect-conditions.js';
import {
  appendEffectLog,
  endEffectsForConcentration,
  publishEffects,
  type EffectActor,
} from '../../effects/effects.service.js';
import { findEffectDefinition } from '../../effects/definitions/registry.js';
import { toEffectDto, type EffectDto } from '../../effects/effects.dto.js';
import {
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
} from '../../effects/pending-effect-saves.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import type {
  SpellExecutionDefinition,
  SpellValidationContext,
} from './spell-execution-definition.js';
import { resolveSpellcastingProfile } from './spellcasting-profile.service.js';
import type { SpellcastingProfile } from './spellcasting-source.js';
import {
  resolveCastingResource,
  spendCastingResource,
} from './casting-resource.service.js';
import type { CastingResource } from './casting-resource.js';
import { toSpellCastDto, type SpellCastDto } from './spell-cast.dto.js';
import type { SpellCastProofInput } from './spell-cast.schema.js';

/**
 * FASE 6.6A — SPELL CAST SERVICE (contrato de conjuração).
 *
 * O pipeline é ÚNICO e explícito para toda magia executável:
 *
 *   VALIDATE (reads apenas)
 *     → COMMIT (a conjuração aconteceu; encerra a Concentração anterior)
 *     → RESOLVE (immediate-effect ou save pendente)
 *     → PRODUCE EFFECTS/RESULT
 *     → COMPLETE (status/outcome)
 *
 * O núcleo NÃO conhece Bless/Hold Person: `spellId → definição` vem do registry
 * e o estado durável vem da Effect Definition referenciada.
 *
 * 6.6B: a FONTE de conjuração e o perfil (atributo, proficiência, CD de magia,
 * bônus de ataque mágico) são resolvidos no VALIDATE e SNAPSHOTADOS no commit.
 * O cliente não envia CD/atributo/proficiência — só, no multiclasse, qual fonte
 * canônica usar. O que continua fora: Ação, slot, componentes, alcance,
 * preparação, upcasting, duração, Counterspell e conjuração de PLAYER.
 *
 * Semântica de Concentração (correção da 6.5H): no COMMIT de uma conjuração que
 * exige concentração, a concentração ANTERIOR termina — mesmo que o alvo passe
 * no save. A nova Concentração só nasce se a resolução produzir um Effect
 * durável. Cancelar depois do commit NÃO restaura nada: o custo já foi pago.
 */

export interface SpellCastContext {
  actor: EffectActor;
  input: SpellCastProofInput;
  execution: SpellExecutionDefinition;
  caster: LoadedEntity;
  targets: LoadedEntity[];
  /** Perfil SERVER-SIDE (fonte, atributo, CD, ataque mágico) da conjuração. */
  profile: SpellcastingProfile;
  saveDc: number;
  /** Nível da magia no catálogo (0 = truque). */
  spellLevel: number;
  /** Nível do espaço escolhido (0 = truque). */
  castAtLevel: number;
  /** Espaço que o COMMIT vai gastar (`null` em truque). */
  resource: CastingResource | null;
}

export interface SpellCastResult {
  cast: SpellCastDto;
  replayed: boolean;
  effectGroupId: string | null;
  effects: EffectDto[];
  pending: PendingEffectSaveDto | null;
}

interface CommittedOutcome extends SpellCastResult {
  endedTargets: MechanicalEntity[];
}

function fingerprintOf(actor: EffectActor, input: SpellCastProofInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        type: 'spell-cast',
        actor: actor.userId,
        spellId: input.spellId,
        caster: input.caster,
        targets: input.targets,
        spellcastingSource: input.spellcastingSource ?? null,
        castingResource: input.castingResource ?? null,
      }),
    )
    .digest('hex');
}

function idempotencyError(): never {
  throw new HttpError(
    'operationId reutilizado com outro payload/autor.',
    409,
    'IDEMPOTENCY_KEY_REUSED',
  );
}

function castInProgress(): never {
  throw new HttpError(
    'Este conjurador já tem uma conjuração em resolução.',
    409,
    'SPELL_CAST_IN_PROGRESS',
  );
}

async function castArtifacts(
  row: SpellCast,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ effects: EffectDto[]; pending: PendingEffectSaveDto | null }> {
  const [effects, pending] = await Promise.all([
    row.effectGroupId
      ? db.effectInstance.findMany({
          where: { groupId: row.effectGroupId },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([] as EffectInstance[]),
    db.pendingEffectSave.findFirst({
      where: { spellCastId: row.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    effects: effects.map(toEffectDto),
    pending: pending ? toPendingEffectSaveDto(pending) : null,
  };
}

/** Replay idempotente: devolve o MESMO cast e os artefatos já produzidos. */
async function replayResult(
  row: SpellCast,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<SpellCastResult> {
  const artifacts = await castArtifacts(row, db);
  return {
    cast: toSpellCastDto(row),
    replayed: true,
    effectGroupId: row.effectGroupId ?? null,
    ...artifacts,
  };
}

/**
 * VALIDATE — fase read-only.
 *
 * Primeiro as regras GENÉRICAS (permissão, catálogo, execução, existência,
 * duplicidade, limite de alvos, CD) e só depois o hook específico da definição
 * (humanoide, por exemplo). Nada é gravado: se algo falhar aqui, nenhuma
 * Concentração anterior é encerrada e nenhum cast/pending/Effect nasce.
 */
export async function validateSpellCast(
  actor: EffectActor,
  input: SpellCastProofInput,
  db: Prisma.TransactionClient,
): Promise<SpellCastContext> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre inicia conjurações de prova.', 403);
  }

  const spell = allSpells().find((item) => item.id === input.spellId);
  if (!spell) {
    throw new HttpError('Magia não encontrada no catálogo.', 404, 'SPELL_NOT_FOUND');
  }
  const execution = spellExecutionDefinition(input.spellId);
  if (!execution) {
    // Existir no catálogo NÃO significa ser executável: nunca adivinhar.
    throw new HttpError(
      'A execução mecânica desta magia ainda não foi implementada.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }

  const caster = await loadEntity(input.caster, db);
  const targets: LoadedEntity[] = [];
  const seen = new Set<string>();
  for (const reference of input.targets) {
    const loaded = await loadEntity(reference, db);
    const key = `${loaded.entity.kind}:${loaded.entity.id}`;
    if (seen.has(key)) {
      throw new HttpError(
        'O mesmo alvo não pode ser escolhido duas vezes na mesma conjuração.',
        400,
        'VALIDATION_ERROR',
      );
    }
    seen.add(key);
    targets.push(loaded);
  }

  if (targets.length > execution.maxTargets) {
    throw new HttpError(
      `Esta conjuração aceita no máximo ${execution.maxTargets} alvo(s).`,
      400,
      'VALIDATION_ERROR',
    );
  }

  // 6.6B: fonte + perfil SEMPRE resolvidos antes do commit. Fonte inexistente,
  // ambígua ou de outro personagem rejeita o cast sem encerrar concentração.
  const profile = await resolveSpellcastingProfile(caster, input.spellcastingSource, db);
  const saveDc = profile.spellSaveDc;

  // 6.6C: o ESPAÇO é resolvido no VALIDATE, também antes do commit. Recurso
  // inválido/vazio/estrangeiro rejeita o cast sem gastar nada e sem encerrar a
  // Concentração anterior. O nível da magia vem do CATÁLOGO (nunca do cliente) e
  // o `castAtLevel` vem do espaço escolhido — não são campos independentes.
  const spellLevel = Math.max(0, spell.level);
  const resource = await resolveCastingResource(
    caster.entity,
    spellLevel,
    input.castingResource,
    db,
  );
  const castAtLevel = resource ? resource.level : 0;

  const context: SpellValidationContext = {
    db,
    spellId: input.spellId,
    caster,
    targets,
    profile,
    saveDc,
    spellLevel,
    castAtLevel,
    castingResource: resource,
  };
  await execution.validateTargets?.(context);

  return {
    actor,
    input,
    execution,
    caster,
    targets,
    profile,
    saveDc,
    spellLevel,
    castAtLevel,
    resource,
  };
}

/**
 * COMMIT — fronteira entre validação reversível e conjuração realizada.
 *
 * Grava o `SpellCast` em `resolving` (a constraint parcial do banco garante UM
 * por caster, inclusive sob concorrência). NÃO cria Concentração nova aqui.
 */
async function commitSpellCast(
  db: Prisma.TransactionClient,
  context: SpellCastContext,
  fingerprint: string,
): Promise<SpellCast> {
  // O espaço é gasto ANTES da resolução, na MESMA transação do cast committed:
  // passar no save, cancelar a pendência ou perder a Concentração não devolve o
  // espaço, e o retry (que sai por `operationId`) não gasta de novo.
  const spent = context.resource
    ? await spendCastingResource(context.caster.entity, context.resource, db)
    : null;
  return db.spellCast.create({
    data: {
      spellId: context.execution.spellId,
      casterEntityKind: context.caster.entity.kind,
      casterEntityId: context.caster.entity.id,
      casterLabel: context.caster.name,
      targets: context.targets.map((target) => ({
        kind: target.entity.kind,
        id: target.entity.id,
      })) as unknown as Prisma.InputJsonValue,
      status: 'resolving',
      requiresConcentration: context.execution.requiresConcentration,
      // SNAPSHOT IMUTÁVEL do perfil: mudar a ficha/statblock depois NÃO
      // recalcula este cast nem a pendência que nasceu dele.
      spellcastingSourceKind: context.profile.source.kind,
      spellcastingSourceId: context.profile.source.id,
      spellcastingSourceLabel: context.profile.source.label,
      spellcastingMode: context.profile.mode,
      spellcastingAbility: context.profile.ability,
      spellcastingAbilityScore: context.profile.abilityScore,
      spellcastingAbilityModifier: context.profile.abilityModifier,
      spellcastingProficiencyBonus: context.profile.proficiencyBonus,
      saveDc: context.saveDc,
      spellSaveDc: context.saveDc,
      spellAttackBonus: context.profile.spellAttackBonus,
      // Snapshot do RECURSO: derivar de novo depois (nível novo/descanso) nunca
      // reescreve este registro histórico.
      spellLevel: context.spellLevel,
      castAtLevel: context.castAtLevel,
      castingResourceKind: spent?.kind ?? null,
      castingResourceLevel: spent?.level ?? null,
      castingResourceSourceId: spent?.sourceId ?? null,
      resourceSpentAt: spent ? new Date() : null,
      visibility: 'public',
      operationId: context.input.operationId,
      fingerprint,
      createdBy: context.actor.userId,
      committedAt: new Date(),
    },
  });
}

/**
 * COMMIT (efeito colateral): encerra a Concentração ANTERIOR.
 *
 * Um caster não mantém duas concentrações. Isso acontece ANTES da resolução e
 * não é desfeito se o alvo passar no save ou se a aplicação for cancelada.
 */
async function releasePreviousConcentration(
  db: Prisma.TransactionClient,
  context: SpellCastContext,
): Promise<MechanicalEntity[]> {
  const state = context.caster.state;
  if (!state.concentration) return [];
  const previous = state.concentration;
  const ended = await endEffectsForConcentration(previous, db, {
    entity: context.caster.entity,
    state,
  });
  state.concentration = null;
  state.pendingConcentrationSaves = [];
  await saveMechanicalState(context.caster, state, db);
  return ended;
}

/**
 * RESOLVE — immediate-effect.
 *
 * Cria UM grupo + uma instância por alvo a partir da Effect Definition. A nova
 * Concentração só é iniciada depois de existir Effect durável e somente se o
 * caster ainda puder concentrar (regra do motor, não da magia).
 */
async function resolveImmediateEffect(
  db: Prisma.TransactionClient,
  cast: SpellCast,
  context: SpellCastContext,
): Promise<{ cast: SpellCast; effects: EffectInstance[]; affected: MechanicalEntity[] }> {
  const resolution = context.execution.resolution;
  if (resolution.kind !== 'immediate-effect') {
    throw new HttpError('Definição de execução inconsistente.', 409, 'SPELL_EXECUTION_NOT_IMPLEMENTED');
  }
  const effect = findEffectDefinition(resolution.effectDefinitionId);
  if (!effect) {
    throw new HttpError(
      'A execução referencia uma definição de efeito inexistente.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }

  const groupId = randomUUID();
  const created: EffectInstance[] = [];
  const cascades: ConcentrationState[] = [];
  for (const target of context.targets) {
    const row = await db.effectInstance.create({
      data: {
        groupId,
        definitionId: effect.definitionId,
        label: effect.label,
        sourceType: 'spell',
        sourceId: context.execution.spellId,
        sourceEntityKind: context.caster.entity.kind,
        sourceEntityId: context.caster.entity.id,
        sourceLabel: context.caster.name,
        modifiers: effect.modifiers() as unknown as Prisma.InputJsonValue,
        conditions: effect.conditions() as unknown as Prisma.InputJsonValue,
        targetEntityKind: target.entity.kind,
        targetEntityId: target.entity.id,
        visibility: 'public',
        status: 'active',
        createdBy: context.actor.userId,
      },
    });
    created.push(row);
    const applied = await applyEffectConditions(row, target.entity, db);
    if (applied.endedConcentration) cascades.push(applied.endedConcentration);
  }

  const affected: MechanicalEntity[] = [];
  for (const cascade of cascades) {
    affected.push(...(await endEffectsForConcentration(cascade, db)));
  }

  if (context.execution.requiresConcentration) {
    const fresh = await loadEntity(context.caster.entity, db);
    if (!deriveConditionEffects(fresh.state).incapacitated && fresh.hpCurrent > 0) {
      fresh.state.concentration = {
        id: randomUUID(),
        label: effect.label,
        sourceType: 'effect',
        sourceId: groupId,
        visibility: 'public',
        startedAt: new Date().toISOString(),
        startedBy: context.actor.userId,
      };
      fresh.state.pendingConcentrationSaves = [];
      await saveMechanicalState(fresh, fresh.state, db);
    }
  }

  await db.spellCast.updateMany({
    where: { id: cast.id, status: 'resolving' },
    data: {
      status: 'resolved',
      outcome: 'effect',
      effectGroupId: groupId,
      resolvedAt: new Date(),
    },
  });
  const resolvedCast = await db.spellCast.findUniqueOrThrow({ where: { id: cast.id } });
  return { cast: resolvedCast, effects: created, affected };
}

/**
 * RESOLVE — save-effect: a conjuração fica RESOLVING com uma pendência
 * persistente. O Effect/Concentração só nascem na falha, quando o save é
 * resolvido pelo pipeline de dados.
 */
async function beginPendingSave(
  db: Prisma.TransactionClient,
  cast: SpellCast,
  context: SpellCastContext,
): Promise<PendingEffectSaveDto> {
  const resolution = context.execution.resolution;
  if (resolution.kind !== 'save-effect') {
    throw new HttpError('Definição de execução inconsistente.', 409, 'SPELL_EXECUTION_NOT_IMPLEMENTED');
  }
  const target = context.targets[0];
  const pending = await db.pendingEffectSave.create({
    data: {
      definitionId: resolution.effectDefinitionId,
      // Vínculo explícito pendência → conjuração (nunca fundir os conceitos).
      spellCastId: cast.id,
      casterEntityKind: context.caster.entity.kind,
      casterEntityId: context.caster.entity.id,
      casterLabel: context.caster.name,
      targetEntityKind: target.entity.kind,
      targetEntityId: target.entity.id,
      ability: resolution.ability,
      dc: context.saveDc,
      visibility: 'public',
      status: 'pending',
      // Um cast = uma pendência nesta fase; o id do cast é a chave idempotente.
      operationId: cast.id,
      fingerprint: `${cast.fingerprint}:save`,
      createdBy: context.actor.userId,
    },
  });
  return toPendingEffectSaveDto(pending);
}

/**
 * PIPELINE ÚNICO de conjuração de prova.
 *
 * Replay é verificado ANTES do lock (retry legítimo do mesmo `operationId` não
 * recebe "já está conjurando"). Validação, commit e resolução acontecem na
 * MESMA transação: erro de resolução não deixa cast/pending parcial.
 */
export async function castProofSpell(
  actor: EffectActor,
  input: SpellCastProofInput,
): Promise<SpellCastResult> {
  const fingerprint = fingerprintOf(actor, input);

  const existing = await prisma.spellCast.findUnique({
    where: { operationId: input.operationId },
  });
  if (existing) {
    if (existing.fingerprint !== fingerprint) idempotencyError();
    return replayResult(existing);
  }

  let outcome: CommittedOutcome;
  try {
    outcome = await prisma.$transaction(async (db) => {
      const prior = await db.spellCast.findUnique({
        where: { operationId: input.operationId },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) idempotencyError();
        return { ...(await replayResult(prior, db)), endedTargets: [] };
      }

      // VALIDATE (read-only) — falha aqui NÃO encerra concentração anterior.
      const context = await validateSpellCast(actor, input, db);

      // LOCK: um caster, um cast RESOLVING. A constraint parcial do banco é a
      // barreira final contra corrida; esta leitura dá o erro claro no caso comum.
      const resolving = await db.spellCast.findFirst({
        where: {
          casterEntityKind: context.caster.entity.kind,
          casterEntityId: context.caster.entity.id,
          status: 'resolving',
        },
        select: { id: true },
      });
      if (resolving) castInProgress();

      // COMMIT
      const cast = await commitSpellCast(db, context, fingerprint);
      const endedTargets = context.execution.requiresConcentration
        ? await releasePreviousConcentration(db, context)
        : [];

      // RESOLUTION
      if (context.execution.resolution.kind === 'immediate-effect') {
        const resolved = await resolveImmediateEffect(db, cast, context);
        return {
          cast: toSpellCastDto(resolved.cast),
          replayed: false,
          effectGroupId: resolved.cast.effectGroupId ?? null,
          effects: resolved.effects.map(toEffectDto),
          pending: null,
          endedTargets: [...endedTargets, ...resolved.affected],
        };
      }

      const pending = await beginPendingSave(db, cast, context);
      return {
        cast: toSpellCastDto(cast),
        replayed: false,
        effectGroupId: null,
        effects: [],
        pending,
        endedTargets,
      };
    });
  } catch (error) {
    // Corrida de retry: o perdedor devolve o snapshot da MESMA conjuração.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const prior = await prisma.spellCast.findUnique({
        where: { operationId: input.operationId },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) idempotencyError();
        return replayResult(prior);
      }
      // Colisão do índice parcial: outro cast do mesmo caster ganhou a corrida.
      castInProgress();
    }
    const prior = await prisma.spellCast.findUnique({
      where: { operationId: input.operationId },
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint) idempotencyError();
      return replayResult(prior);
    }
    throw error;
  }

  // REALTIME/LOGS depois do commit: superfícies existentes, sem evento novo.
  if (outcome.pending) {
    await publishPendingEffectSaves(outcome.cast.targetEntities);
  }
  await publishEffects([
    ...outcome.cast.targetEntities,
    outcome.cast.casterEntity,
    ...outcome.endedTargets,
  ]);
  for (const effect of outcome.effects) {
    await appendEffectLog(
      effect.targetEntity,
      actor.username,
      (name) => `${actor.username} aplicou ${effect.label} em ${name}.`,
      false,
    );
  }

  const { endedTargets: _endedTargets, ...result } = outcome;
  return result;
}

/**
 * Cancela o cast de uma pendência administrativamente encerrada.
 *
 * `cancelled` NÃO significa "a conjuração nunca aconteceu": o commit já
 * ocorreu e a concentração anterior NÃO volta.
 */
export async function cancelSpellCastForPending(
  spellCastId: string | null | undefined,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (!spellCastId) return;
  await db.spellCast.updateMany({
    where: { id: spellCastId, status: 'resolving' },
    data: { status: 'cancelled', outcome: 'cancelled', resolvedAt: new Date() },
  });
}
