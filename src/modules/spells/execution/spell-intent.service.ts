import { Prisma, type SpellCastIntent } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { getSpell } from '../../shared/spells/index.js';
import { parseJson } from '../../shared/json.js';
import { z } from 'zod';
import type { EffectActor } from '../../effects/effects.service.js';
import type { SpellCastProofInput } from './spell-cast.schema.js';
import {
  castFingerprint,
  castResultForOperation,
  executeCast,
  validateSpellCast,
  type SpellCastResult,
} from './spell-cast.service.js';
import {
  isConfirmed,
  type SpatialConfirmation,
  type SpatialRequirementKind,
} from './spatial-validation.js';
import { entitySchema } from '../../shared/conditions.js';
import { spellcastingSourceRefSchema } from './spellcasting-source.js';
import { castingResourceRefSchema } from './casting-resource.js';
import { publishSpellIntent } from './spell-intent.broadcast.js';
import { areaPlacementSchema, areaShapeSummary } from './area-targeting.js';
import { isAreaTargeting } from './spell-targeting.js';
import { parseAreaTargetingSnapshot } from './area-snapshot.js';
import type { AreaUnknownDecision } from './area-evaluation.js';
import type { AreaSpatialProvider } from './area-spatial.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';

/**
 * FASE 6.6F — SPELL CAST INTENT (intenção de conjuração, PRÉ-COMMIT).
 *
 * A engine não tem geometria confiável (sem grid, paredes ou linha de visão), então
 * toda checagem espacial é tri-state. Para o MESTRE o `unknown` é confirmado na
 * hora; para o PLAYER não existe esse poder — e gastar espaço/Ação antes da
 * confirmação seria errado. A intenção resolve isso:
 *
 *   PLAYER pede → INTENT `pending` (NENHUM custo: sem slot, sem Ação, sem
 *   Concentração encerrada, sem Effect, sem PendingEffectSave, sem SpellCast)
 *   → o Mestre confirma os requisitos DECLARADOS PELO SERVIDOR
 *   → a APROVAÇÃO revalida TUDO e só então o COMMIT acontece.
 *
 * `SpellCast` significa conjuração REALIZADA: ele NUNCA é criado para
 * representar uma intenção. `pending` não conta para a regra de Ação Bônus (só
 * casts committed contam) e não reserva espaço nem Ação.
 */

export const SPELL_INTENT_STATUSES = [
  'pending',
  'committed',
  'denied',
  'cancelled',
  'invalidated',
] as const;

export type SpellCastIntentStatus = (typeof SPELL_INTENT_STATUSES)[number];

const intentTargetSchema = z.object({
  kind: entitySchema.shape.kind,
  id: z.string().min(1),
  name: z.string().default(''),
});
type IntentTarget = z.infer<typeof intentTargetSchema>;

const targetsSchema = z.array(intentTargetSchema).max(12);
const requirementsSchema = z
  .array(z.enum(['range', 'sight', 'clearPath', 'groupDistance']))
  .max(4);

export interface SpellCastIntentAreaDto {
  placement: unknown;
  shape: unknown;
  origin: unknown;
  includeOrigin: boolean | null;
  spatialMode: string | null;
  requiredDecisions: string[];
  /**
   * Avaliações por candidato: só o MESTRE recebe (pode conter criatura oculta
   * ao conjurador). Para o jogador o campo é `null`.
   */
  candidates: { targetKey: string; affected: string }[] | null;
}

export interface SpellCastIntentDto {
  id: string;
  spellId: string;
  spellName: string;
  status: SpellCastIntentStatus;
  caster: { kind: string; id: string; label: string | null };
  targets: IntentTarget[];
  /** 6.6J.3: dados de ÁREA (nulo em magias de alvo explícito). */
  area: SpellCastIntentAreaDto | null;
  /** Requisitos que o MESTRE precisa confirmar (`[]` = nenhum). */
  requiredConfirmations: SpatialRequirementKind[];
  createdAt: string;
  resolvedAt: string | null;
  reason: string | null;
  spellCastId: string | null;
}

/** Resultado do endpoint genérico de conjuração. */
export type CastOutcome =
  | { kind: 'cast'; result: SpellCastResult }
  | { kind: 'intent'; intent: SpellCastIntentDto };

function requirementListOf(row: SpellCastIntent): SpatialRequirementKind[] {
  return parseJson(requirementsSchema, row.requiredConfirmations, []);
}

function targetsOf(row: SpellCastIntent): IntentTarget[] {
  return parseJson(targetsSchema, row.targets, []);
}

/**
 * Dados de ÁREA da intenção (6.6J.3).
 *
 * O PLAYER recebe a colocação e o que falta decidir, nunca a lista de
 * candidatos: ela pode conter criatura que ele não percebe.
 */
function areaOf(
  row: SpellCastIntent,
  viewer: 'master' | 'player',
): SpellCastIntentAreaDto | null {
  const placement =
    row.areaPlacement === null
      ? null
      : (areaPlacementSchema.safeParse(row.areaPlacement).data ?? null);
  const snapshot = parseAreaTargetingSnapshot(row.areaSnapshot);
  if (!placement && !snapshot) return null;
  return {
    placement,
    shape: snapshot ? areaShapeSummary(snapshot.shape) : null,
    origin: snapshot
      ? {
          requested: snapshot.origin.requested.kind,
          result: snapshot.origin.result,
          obstruction: snapshot.origin.obstruction,
        }
      : null,
    includeOrigin: snapshot?.includeOrigin ?? null,
    spatialMode: snapshot?.spatialMode ?? null,
    requiredDecisions: snapshot?.requiredDecisions ?? [],
    candidates:
      viewer === 'master' && snapshot
        ? snapshot.candidates.map((candidate) => ({
            targetKey: candidate.targetKey,
            affected: candidate.affected,
          }))
        : null,
  };
}

export function toSpellCastIntentDto(
  row: SpellCastIntent,
  viewer: 'master' | 'player' = 'player',
): SpellCastIntentDto {
  const spell = getSpell(row.spellId);
  return {
    id: row.id,
    spellId: row.spellId,
    spellName: spell?.namePt ?? row.spellId,
    status: row.status as SpellCastIntentStatus,
    caster: { kind: row.casterEntityKind, id: row.casterEntityId, label: row.casterLabel },
    targets: targetsOf(row),
    area: areaOf(row, viewer),
    requiredConfirmations: requirementListOf(row),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    reason: row.reason,
    spellCastId: row.spellCastId,
  };
}

function idempotencyError(): never {
  throw new HttpError(
    'operationId reutilizado com outro payload/autor.',
    409,
    'IDEMPOTENCY_KEY_REUSED',
  );
}

function intentInProgress(): never {
  throw new HttpError(
    'Este conjurador já tem uma conjuração aguardando confirmação do Mestre.',
    409,
    'SPELL_CAST_INTENT_PENDING',
  );
}

/** Reconstrói o payload canônico da intenção (a aprovação REVALIDA tudo). */
function intentInputOf(
  row: SpellCastIntent,
  confirmation: SpatialConfirmation | undefined,
): SpellCastProofInput {
  const targets = targetsOf(row).map((target) => ({ kind: target.kind, id: target.id }));
  const source =
    row.spellcastingSourceKind && row.spellcastingSourceId
      ? { kind: row.spellcastingSourceKind, id: row.spellcastingSourceId }
      : null;
  const resource =
    row.castingResourceKind && row.castingResourceLevel
      ? { kind: row.castingResourceKind, level: row.castingResourceLevel }
      : null;

  const placement =
    row.areaPlacement === null
      ? null
      : (areaPlacementSchema.safeParse(row.areaPlacement).data ?? null);

  return {
    operationId: row.castOperationId ?? `intent:${row.id}`,
    spellId: row.spellId,
    ...(placement ? { areaPlacement: placement } : {}),
    caster: { kind: row.casterEntityKind, id: row.casterEntityId } as SpellCastProofInput['caster'],
    targets: targets as SpellCastProofInput['targets'],
    ...(source ? { spellcastingSource: spellcastingSourceRefSchema.parse(source) } : {}),
    ...(resource ? { castingResource: castingResourceRefSchema.parse(resource) } : {}),
    ...(confirmation ? { spatialConfirmation: confirmation } : {}),
  };
}

/** Replay idempotente: devolve o MESMO cast ou o estado atual da intenção. */
async function replayIntent(row: SpellCastIntent): Promise<CastOutcome> {
  if (row.status === 'committed' && row.castOperationId) {
    const result = await castResultForOperation(row.castOperationId);
    if (result) return { kind: 'cast', result };
  }
  return { kind: 'intent', intent: toSpellCastIntentDto(row) };
}

/**
 * COMMIT de uma intenção (aprovação ou caminho direto, sem `unknown`).
 *
 * Falha de revalidação NÃO deixa custo: `executeCast` não commitou nada. A
 * intenção vira `invalidated` com o motivo, para o jogador saber o que mudou.
 */
async function commitIntent(
  row: SpellCastIntent,
  approver: EffectActor,
  confirmation: SpatialConfirmation | undefined,
  decisions: readonly AreaUnknownDecision[] = [],
): Promise<CastOutcome> {
  const input = intentInputOf(row, confirmation);
  try {
    const result = await executeCast(approver, input, {
      operationId: row.castOperationId ?? `intent:${row.id}`,
      fingerprint: row.fingerprint,
      ...(decisions.length > 0 ? { areaDecisions: decisions } : {}),
    });
    await prisma.spellCastIntent.updateMany({
      where: { id: row.id, status: 'pending' },
      data: {
        status: 'committed',
        spellCastId: result.cast.id,
        approvedBy: approver.userId,
        approvedAt: new Date(),
        resolvedAt: new Date(),
      },
    });
    const fresh = await prisma.spellCastIntent.findUnique({ where: { id: row.id } });
    if (fresh) await publishSpellIntent(fresh);
    return { kind: 'cast', result };
  } catch (error) {
    await invalidateIntent(row.id, error instanceof Error ? error.message : 'Conjuração inválida.');
    throw error;
  }
}

async function invalidateIntent(id: string, reason: string): Promise<void> {
  const written = await prisma.spellCastIntent.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'invalidated', resolvedAt: new Date(), reason },
  });
  if (written.count > 0) {
    const fresh = await prisma.spellCastIntent.findUnique({ where: { id } });
    if (fresh) await publishSpellIntent(fresh);
  }
}

/**
 * Ponto de entrada do endpoint genérico `POST /api/spells/cast`.
 *
 * MASTER: mesma pipeline, sem intenção — ele próprio confirma o que for `unknown`.
 * PLAYER: pré-check read-only; sem `unknown` o commit é imediato (a intenção
 * nasce e morre committed na mesma operação, mantendo a raiz única de request);
 * com `unknown`, vira fila do Mestre e NADA é gasto.
 */
export async function castSpell(
  actor: EffectActor,
  input: SpellCastProofInput,
  options: {
    /** 6.6J.3: provider/decisões injetados (smoke determinístico). */
    areaProvider?: AreaSpatialProvider;
    areaDecisions?: readonly AreaUnknownDecision[];
  } = {},
): Promise<CastOutcome> {
  const existing = await prisma.spellCastIntent.findUnique({
    where: { operationId: input.operationId },
  });
  if (existing) {
    if (existing.fingerprint !== castFingerprint(actor, input)) idempotencyError();
    return replayIntent(existing);
  }

  // Confirmação espacial é do MESTRE. Um PLAYER que mandar o campo não ganha
  // poder nenhum — é recusado em vez de ignorado em silêncio.
  if (actor.role !== 'MASTER' && input.spatialConfirmation) {
    throw new HttpError(
      'A confirmação de requisitos espaciais é exclusiva do Mestre.',
      403,
      'SPELL_SPATIAL_CONFIRMATION_FORBIDDEN',
    );
  }

  // 6.6J.3: com ÁREA, o desconhecido exige decisão POR ALVO. Mesmo o Mestre
  // passa pela intenção nesse caso — nunca um commit adivinhado. No caminho de
  // prova injetada (provider/decisões), o commit é direto.
  const execution = spellExecutionDefinition(input.spellId);
  const areaSpell = execution !== null && isAreaTargeting(execution.targeting);
  if (
    actor.role === 'MASTER' &&
    (!areaSpell || options.areaProvider !== undefined || options.areaDecisions !== undefined)
  ) {
    const result = await executeCast(actor, input, {
      operationId: input.operationId,
      fingerprint: castFingerprint(actor, input),
      ...(options.areaProvider !== undefined ? { areaProvider: options.areaProvider } : {}),
      ...(options.areaDecisions !== undefined ? { areaDecisions: options.areaDecisions } : {}),
    });
    return { kind: 'cast', result };
  }

  const fingerprint = castFingerprint(actor, input);

  // PRÉ-CHECK (read-only): `fail` autoritativo rejeita JÁ; impossibilidade
  // mecânica (slot/Ação/repertório) também. Nunca pedimos aprovação para um
  // cast que não poderia acontecer.
  const precheck = await prisma.$transaction((db) =>
    validateSpellCast(actor, input, db, {
      deferUnknown: true,
      ...(options.areaProvider !== undefined ? { areaProvider: options.areaProvider } : {}),
    }),
  );
  const requiredConfirmations = precheck.requiredConfirmations;
  const requiredDecisions = precheck.area?.requiredDecisions ?? [];

  let row: SpellCastIntent;
  try {
    row = await prisma.spellCastIntent.create({
      data: {
        operationId: input.operationId,
        fingerprint,
        actorUserId: actor.userId,
        casterEntityKind: precheck.caster.entity.kind,
        casterEntityId: precheck.caster.entity.id,
        casterLabel: precheck.caster.name,
        spellId: precheck.execution.spellId,
        spellcastingSourceKind: precheck.profile.source.kind,
        spellcastingSourceId: precheck.profile.source.id,
        castingResourceKind: precheck.resource?.kind ?? null,
        castingResourceLevel: precheck.resource?.level ?? null,
        targets: precheck.targets.map((target) => ({
          kind: target.entity.kind,
          id: target.entity.id,
          name: target.name,
        })) as unknown as Prisma.InputJsonValue,
        // 6.6J.3: a colocação/a avaliação da área ficam na intenção; a lista de
        // atingidos NÃO é persistida como autoridade antes da aprovação.
        ...(precheck.areaPlacement
          ? { areaPlacement: precheck.areaPlacement as unknown as Prisma.InputJsonValue }
          : {}),
        ...(precheck.area
          ? { areaSnapshot: precheck.area.snapshot as unknown as Prisma.InputJsonValue }
          : {}),
        requiredConfirmations: requiredConfirmations as unknown as Prisma.InputJsonValue,
        status: 'pending',
        // Chave do `SpellCast` derivada da INTENÇÃO: única e estável.
        castOperationId: `intent:${input.operationId}`,
        combatId: precheck.turnContext?.combatId ?? null,
        turnSequence: precheck.turnContext?.turnSequence ?? null,
        combatantId: precheck.turnContext?.combatantId ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const prior = await prisma.spellCastIntent.findUnique({
        where: { operationId: input.operationId },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) idempotencyError();
        return replayIntent(prior);
      }
      intentInProgress();
    }
    throw error;
  }

  if (requiredConfirmations.length > 0 || requiredDecisions.length > 0) {
    const viewer = actor.role === 'MASTER' ? 'master' : 'player';
    await publishSpellIntent(row);
    return { kind: 'intent', intent: toSpellCastIntentDto(row, viewer) };
  }

  // Sem dependência espacial: commit imediato pela MESMA raiz de request.
  await publishSpellIntent(row);
  return commitIntent(row, actor, undefined);
}

async function findIntentOrThrow(id: string): Promise<SpellCastIntent> {
  const row = await prisma.spellCastIntent.findUnique({ where: { id } });
  if (!row) throw new HttpError('Solicitação de conjuração não encontrada.', 404);
  return row;
}

/**
 * APROVAÇÃO do Mestre. Reexecuta a validação COMPLETA antes do COMMIT: turno,
 * Ação, espaço, fonte, repertório, alvos, visão autoritativa e concentração.
 *
 * Concorrência: o `SpellCast` usa a chave da intenção (única), então dois
 * aprovadores simultâneos produzem UM cast; o segundo lê o mesmo snapshot. Não
 * existe mutex de processo.
 */
export async function approveSpellCastIntent(
  actor: EffectActor,
  id: string,
  confirmation: SpatialConfirmation | undefined,
  decisions: readonly AreaUnknownDecision[] = [],
): Promise<CastOutcome> {
  const row = await findIntentOrThrow(id);
  if (row.status !== 'pending') return replayIntent(row);

  const required = requirementListOf(row);
  const missing = required.filter((kind) => !isConfirmed(confirmation, kind));
  if (missing.length > 0) {
    throw new HttpError(
      'Confirme os requisitos espaciais desta conjuração.',
      400,
      'SPELL_SPATIAL_CONFIRMATION_REQUIRED',
      { required: missing },
    );
  }

  // 6.6J.3: o Mestre decide SÓ os `unknown` avaliados pelo SERVIDOR. Decisão
  // para um alvo conhecido é recusada; `unknown` sem decisão não commita.
  const areaSnapshot = parseAreaTargetingSnapshot(row.areaSnapshot);
  if (areaSnapshot) {
    const requiredKeys = new Set(areaSnapshot.requiredDecisions);
    const invalid = decisions.filter((decision) => !requiredKeys.has(decision.targetKey));
    if (invalid.length > 0) {
      throw new HttpError(
        'O Mestre só pode decidir alvos cuja área é desconhecida.',
        409,
        'AREA_DECISION_NOT_UNKNOWN',
        { targetKeys: invalid.map((decision) => decision.targetKey) },
      );
    }
    const decided = new Set(decisions.map((decision) => decision.targetKey));
    const undecided = [...requiredKeys].filter((key) => !decided.has(key));
    if (undecided.length > 0) {
      throw new HttpError(
        'Ainda há alvos com posição desconhecida aguardando decisão do Mestre.',
        409,
        'AREA_RESOLUTION_INCOMPLETE',
        { targetKeys: undecided },
      );
    }
  }

  return commitIntent(row, actor, confirmation, decisions);
}

/** NEGAÇÃO do Mestre: terminal, ZERO custo e nenhum `SpellCast`. */
export async function denySpellCastIntent(
  actor: EffectActor,
  id: string,
  reason: string | null,
): Promise<SpellCastIntentDto> {
  const row = await findIntentOrThrow(id);
  if (row.status !== 'pending') return toSpellCastIntentDto(row);

  await prisma.spellCastIntent.updateMany({
    where: { id, status: 'pending' },
    data: {
      status: 'denied',
      deniedBy: actor.userId,
      resolvedAt: new Date(),
      reason: reason ?? null,
    },
  });
  const fresh = await findIntentOrThrow(id);
  await publishSpellIntent(fresh);
  return toSpellCastIntentDto(fresh);
}

/** CANCELAMENTO pelo próprio jogador (só enquanto `pending`). */
export async function cancelSpellCastIntent(
  actor: EffectActor,
  id: string,
): Promise<SpellCastIntentDto> {
  const row = await findIntentOrThrow(id);
  if (actor.role !== 'MASTER' && row.actorUserId !== actor.userId) {
    throw new HttpError(
      'Você só pode cancelar as suas próprias solicitações.',
      403,
      'SPELL_INTENT_FORBIDDEN',
    );
  }
  if (row.status !== 'pending') return toSpellCastIntentDto(row);

  await prisma.spellCastIntent.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'cancelled', cancelledBy: actor.userId, resolvedAt: new Date() },
  });
  const fresh = await findIntentOrThrow(id);
  await publishSpellIntent(fresh);
  return toSpellCastIntentDto(fresh);
}

/**
 * Intenção PENDENTE de um personagem (a ficha restaura "aguardando o Mestre"
 * depois de refresh/reconnect). Combatente de personagem cai na mesma ficha.
 */
export async function pendingIntentOfCharacter(characterId: string): Promise<SpellCastIntent | null> {
  const rows = await prisma.spellCastIntent.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  for (const row of rows) {
    if (row.casterEntityKind === 'character' && row.casterEntityId === characterId) return row;
    if (row.casterEntityKind !== 'combatant') continue;
    const combatant = await prisma.combatant.findUnique({
      where: { id: row.casterEntityId },
      select: { characterId: true },
    });
    if (combatant?.characterId === characterId) return row;
  }
  return null;
}

/**
 * Fila de confirmação: o Mestre vê TODAS as pendentes; o jogador só as dele.
 * Depois de `pending`, a lista lateral não mostra histórico (o cast committed
 * já se apresenta pelos canais normais).
 */
export async function listPendingSpellCastIntents(
  actor: EffectActor,
): Promise<SpellCastIntentDto[]> {
  const rows = await prisma.spellCastIntent.findMany({
    where:
      actor.role === 'MASTER'
        ? { status: 'pending' }
        : { status: 'pending', actorUserId: actor.userId },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  const viewer = actor.role === 'MASTER' ? 'master' : 'player';
  return rows.map((row) => toSpellCastIntentDto(row, viewer));
}
