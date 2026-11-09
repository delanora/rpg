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
import {
  attackCountOf,
  spellDefinitionId,
  type SpellExecutionDefinition,
  type SpellValidationContext,
} from './spell-execution-definition.js';
import { cantripScalingLevelOf } from './cantrip-scaling.service.js';
import {
  publishImmediateHealing,
  resolveImmediateHealing,
  type ImmediateHealingResult,
} from './immediate-healing-resolution.js';
import {
  publishAttackDamageResult,
  resolveAttackDamageSpell,
  type AttackDamageResult,
} from './attack-damage-resolution.js';
import {
  validateTargeting,
  type SpellTargetingSnapshot,
} from './spell-targeting.service.js';
import type { AreaPlacement } from './area-targeting.js';
import { isAreaTargeting, isExplicitTargeting } from './spell-targeting.js';
import { resolveAreaTargets } from './area-targeting.service.js';
import type { AreaTargetingSnapshot } from './area-snapshot.js';
import type { AreaSpatialProvider } from './area-spatial.js';
import type { AreaUnknownDecision } from './area-evaluation.js';
import {
  assistedCoverProvider,
  assertCoverAllowsDirectTargeting,
  assertCoverDecisionAllowed,
  coverFor,
  type CoverSpatialProvider,
} from '../../combat/cover.service.js';
import {
  applyCoverConfirmation,
  coverSnapshotOf,
  type CoverConfirmation,
} from '../../combat/cover.js';
import { finalizeSaveDamageCast } from './save-damage-finalizer.js';
import {
  assertCasterControl,
  resolveSpellAuthorization,
} from './spell-authorization.service.js';
import type { SpatialRequirementKind } from './spatial-validation.js';
import {
  combatSpatialIndexById,
  evaluateEntityDistance,
  gridAreaSpatialProvider,
  gridSpatialProvider,
  type CombatSpatialIndex,
} from '../../combat/spatial/spatial-distance.service.js';
import { spatialDistanceSnapshot } from '../../combat/spatial/spatial-distance.js';
import type { SpellcastingProfile } from './spellcasting-source.js';
import {
  resolveCastingResource,
  spendCastingResource,
} from './casting-resource.service.js';
import type { CastingResource } from './casting-resource.js';
import type { SpellCastingTimeKind } from '../../shared/spells/types.js';
import {
  assertCastingEconomy,
  castingEconomyFor,
  castingTurnContext,
  commitCastingEconomy,
  committedCastsOnTurn,
  type CastingTurnContext,
} from './spell-casting-economy.js';
import { toSpellCastDto, type SpellCastDto } from './spell-cast.dto.js';
import {
  assertSpellComponents,
  consumeSpellComponents,
  resolveSpellComponents,
  toComponentsSnapshot,
  type SpellComponentPlan,
} from './spell-components.service.js';
import { buildDurationSnapshot } from './spell-duration.js';
import { publishCharacter } from '../../combat/combat.service.js';
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
  /** Tempo de conjuração (snapshot imutável). */
  castingTimeKind: SpellCastingTimeKind;
  /** Custo de Action Economy derivado do casting time. */
  economyCost: 'action' | 'bonus-action' | 'reaction';
  reactionAuthorized?: boolean;
  /** Contexto de turno em combate ATIVO (`null` = fora de combate). */
  turnContext: CastingTurnContext | null;
  /** Snapshot da validação de alvos (6.6E/6.6J.3) — gravado no COMMIT. */
  targeting: SpellTargetingSnapshot;
  /** 6.6J.3: snapshot derivado da ÁREA (`null` em alvo explícito). */
  area: { snapshot: AreaTargetingSnapshot; requiredDecisions: string[] } | null;
  /** Colocação de área pedida (persistida na INTENÇÃO; `null` em explícito). */
  areaPlacement: AreaPlacement | null;
  /** 6.6J.5 — cobertura: provider (assistido por padrão) e confirmações do Mestre. */
  coverProvider: CoverSpatialProvider;
  coverConfirmations: readonly CoverConfirmation[];
  /** Plano de COMPONENTES V/S/M (6.6G), revalidado no COMMIT. */
  components: SpellComponentPlan;
  /** Requisitos espaciais ainda NÃO confirmados (6.6F: viram intenção). */
  requiredConfirmations: SpatialRequirementKind[];
  /** `operationId` gravado no `SpellCast` (difere do request na aprovação). */
  castOperationId: string;
  /**
   * Disponibilidade por repertório (`prepared`, `known`, `cantrip-known`...).
   * Fica no snapshot do cast para auditoria; nunca vem do cliente.
   */
  availabilityKind: string;
}

export interface SpellCastResult {
  cast: SpellCastDto;
  replayed: boolean;
  effectGroupId: string | null;
  effects: EffectDto[];
  /** Primeira pendência (compatibilidade das rotas de prova de 1 alvo). */
  pending: PendingEffectSaveDto | null;
  /** TODAS as pendências do cast (multi-alvo desde a 6.6E). */
  pendings: PendingEffectSaveDto[];
}

interface CommittedOutcome extends SpellCastResult {
  endedTargets: MechanicalEntity[];
}

/**
 * Chaves de alvo do fingerprint.
 *
 * 6.6E: sem repetição o conjunto é canônico e a ORDEM não tem significado
 * ([A,B] = [B,A]). 6.6J.4: quando há repetição a lista é de ASSIGNMENTS e a
 * ordem É mecânica — "duas jogadas em A, uma em B" ([A,A,B]) não pode ser
 * aceita como retry de "uma em A, duas em B" ([A,B,B]).
 */
function fingerprintTargets(targets: SpellCastProofInput['targets']): string[] {
  const keys = targets.map((target) => `${target.kind}:${target.id}`);
  return new Set(keys).size === keys.length ? [...keys].sort() : keys;
}

function fingerprintOf(actor: EffectActor, input: SpellCastProofInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        type: 'spell-cast',
        actor: actor.userId,
        spellId: input.spellId,
        caster: input.caster,
        targets: fingerprintTargets(input.targets),
        spellcastingSource: input.spellcastingSource ?? null,
        castingResource: input.castingResource ?? null,
        spatialConfirmation: input.spatialConfirmation ?? null,
        // 6.6J.3: a COLOCAÇÃO faz parte da identidade do pedido de área
        // (mesmo operationId com outra origem/direção é outro payload).
        areaPlacement: input.areaPlacement ?? null,
        // 6.6J.5: a confirmação de cobertura faz parte da identidade do pedido.
        coverConfirmation: input.coverConfirmation ?? null,
      }),
    )
    .digest('hex');
}

/** Fatos de distância por alvo (sanitizados) para o snapshot do cast. */
function distanceFactsFor(
  index: CombatSpatialIndex,
  caster: LoadedEntity,
  targets: readonly LoadedEntity[],
) {
  return targets.map((target) => {
    const evaluation = evaluateEntityDistance(index, caster.entity, target.entity);
    const snapshot = spatialDistanceSnapshot(evaluation);
    return {
      targetKey: `${target.entity.kind}:${target.entity.id}`,
      status: snapshot.status,
      distanceFeet: snapshot.distanceFeet,
      provenance: snapshot.provenance,
      algorithm: snapshot.algorithm,
    };
  });
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
): Promise<{
  effects: EffectDto[];
  pending: PendingEffectSaveDto | null;
  pendings: PendingEffectSaveDto[];
}> {
  const [effects, pendings] = await Promise.all([
    row.effectGroupId
      ? db.effectInstance.findMany({
          where: { groupId: row.effectGroupId },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([] as EffectInstance[]),
    db.pendingEffectSave.findMany({
      where: { spellCastId: row.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const mapped = pendings.map(toPendingEffectSaveDto);
  return {
    effects: effects.map((row) => toEffectDto(row)),
    pending: mapped[0] ?? null,
    pendings: mapped,
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
  options: {
    reactionAuthorized?: boolean;
    deferUnknown?: boolean;
    operationId?: string;
    /** 6.6J.3: provider espacial injetável (testes determinísticos). */
    areaProvider?: AreaSpatialProvider;
    /** 6.6J.3: decisões do Mestre para os candidatos `unknown`. */
    areaDecisions?: readonly AreaUnknownDecision[];
    /** 6.6J.5: provider de cobertura injetável (testes) e confirmações. */
    coverProvider?: CoverSpatialProvider;
    coverConfirmations?: readonly CoverConfirmation[];
  } = {},
): Promise<SpellCastContext> {
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
  // 6.6J.5 — COBERTURA: o provider padrão é ASSISTIDO (sem geometria, devolve
  // `not-assessed`), então nenhuma jogada comum vira "aguardando o Mestre".
  const coverProvider = options.coverProvider ?? assistedCoverProvider;
  const coverConfirmations = input.coverConfirmation ?? options.coverConfirmations ?? [];
  const coverConfirmationFor = (entity: MechanicalEntity) =>
    coverConfirmations.find((item) => item.targetKey === `${entity.kind}:${entity.id}`)?.level;

  // FASE 6.6I.2: magias `save-damage` exigem um nível EXPLÍCITO de
  // escalonamento (personagem: nível total; NPC: statblock). Sem ele, falha
  // ANTES de qualquer custo. `half` ainda não é executável.
  if (execution.resolution.kind === 'save-damage') {
    // A consequência do save é declarativa (`none`/`half`/`full`) e só age na
    // RESOLUÇÃO da pendência — o COMMIT não precisa de nenhum `if` por magia.
    // O nível de escalonamento, porém, continua exigido ANTES de qualquer custo
    // (truque: nível total; NPC: `cantripScalingLevel` do statblock).
    await cantripScalingLevelOf(caster, db);
    // 6.6J.2: o dano de um efeito simultâneo é COMPARTILHADO (PHB 2014). O
    // contrato já aceita `per-target` para efeitos futuros, mas executá-lo hoje
    // seria inventar regra — recusar ANTES de qualquer custo.
    if (execution.resolution.damageRollScope === 'per-target') {
      throw new HttpError(
        'Dano rolado por alvo ainda não é executável nesta fase.',
        409,
        'SPELL_EXECUTION_NOT_IMPLEMENTED',
      );
    }
  }
  // 6.6J.4: a quantidade de jogadas vem da DEFINIÇÃO (nunca do cliente). Em
  // magias de ataque com repetição permitida a LISTA é de ASSIGNMENTS: a ordem
  // importa e o mesmo alvo pode aparecer várias vezes ([A, A, B]).
  const attackCount =
    execution.resolution.kind === 'attack-damage' ? attackCountOf(execution) : 1;
  const repeatedTargetsAllowed =
    attackCount > 1 &&
    isExplicitTargeting(execution.targeting) &&
    execution.targeting.allowRepeatedTarget === true;

  const targets: LoadedEntity[] = [];
  const seen = new Set<string>();
  for (const reference of input.targets) {
    const loaded = await loadEntity(reference, db);
    const key = `${loaded.entity.kind}:${loaded.entity.id}`;
    if (seen.has(key) && !repeatedTargetsAllowed) {
      // 6.6E: a chave vem do `loadEntity`, que já canonicaliza combatente→ficha;
      // escolher o personagem pela ficha E pelo combatente é o MESMO alvo.
      // 6.6J.4: a recusa continua GLOBAL — só a definição que declara
      // `allowRepeatedTarget` pode repetir, e apenas em ataque múltiplo.
      throw new HttpError(
        'O mesmo alvo não pode ser escolhido duas vezes na mesma conjuração.',
        400,
        'SPELL_TARGET_DUPLICATE',
      );
    }
    seen.add(key);
    targets.push(loaded);
  }
  // Divergência entre assignments e a quantidade da definição recusa ANTES de
  // qualquer custo — nunca "executar o que der".
  if (attackCount > 1 && targets.length !== attackCount) {
    throw new HttpError(
      `Esta conjuração exige exatamente ${attackCount} jogada(s) de ataque.`,
      400,
      'SPELL_ATTACK_COUNT_INVALID',
      { expected: attackCount, received: targets.length },
    );
  }

  // 6.6F: CONTROLE do conjurador (PLAYER só o próprio personagem; NPC é do
  // Mestre) e AUTORIZAÇÃO por repertório, ANTES de qualquer custo. Fonte que não
  // concede a magia rejeita aqui — ter Execution Definition nunca basta, e a
  // fonte pedida nunca é trocada por "a primeira".
  await assertCasterControl(actor, caster.entity, db);
  const authorization = await resolveSpellAuthorization(
    caster,
    input.spellId,
    input.spellcastingSource,
    db,
  );
  const profile = authorization.profile;
  const saveDc = profile.spellSaveDc;

  // 6.6I.3: cura imediata precisa de um atributo de conjuração para o
  // modificador. Statblock que só publica CD (sem `ability`) é recusado ANTES
  // de qualquer custo — nunca inventamos SAB/INT por ND ou pelo maior valor.
  if (execution.resolution.kind === 'immediate-healing' && profile.ability === null) {
    throw new HttpError(
      'Este conjurador não declara o atributo de conjuração exigido pela magia.',
      409,
      'SPELLCASTING_ABILITY_REQUIRED',
    );
  }

  // 6.6I.4: o ATAQUE MÁGICO usa o bônus do PERFIL. Statblock que só publica a CD
  // não tem ataque mágico — recusar antes do COMMIT evita gastar espaço/Ação
  // para descobrir isso só na resolução.
  if (execution.resolution.kind === 'attack-damage' && profile.spellAttackBonus === null) {
    throw new HttpError(
      'Este conjurador não declara bônus de ataque mágico.',
      409,
      'SPELLCASTING_ATTACK_BONUS_REQUIRED',
    );
  }

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

  // 6.6G: COMPONENTES (V/S/M) — mãos, foco compatível com a FONTE, bolsa de
  // componentes e material específico. Falhar aqui é falhar antes de TODO
  // custo. O plano também é revalidado no COMMIT, porque equipamento e Effects
  // podem mudar entre a validação e a escrita (intenção pendente inclusive).
  const components = await resolveSpellComponents({
    db,
    spell,
    source: profile.source,
    entity: caster.entity,
  });
  assertSpellComponents(components);

  // 6.6D: CASTING TIME vem do registry (ou do catálogo) — NUNCA do cliente. O
  // custo é traduzido para a Action Economy existente; tempos não executáveis
  // (1 minuto/1 hora) falham aqui, antes de qualquer consumo. Calculado ANTES
  // do targeting porque a ÁREA (6.6J.3) precisa do combate ativo para enumerar
  // candidatos — e nada disso grava.
  const castingTimeKind = options.reactionAuthorized ? 'reaction' : execution.castingTime ?? spell.castingTimeKind;
  const economyCost = castingEconomyFor(castingTimeKind);
  const turnContext = await castingTurnContext(db, caster);
  // 6.6L.2 — DISTÂNCIA/ALCANCE do SERVIDOR. Com a cena em grid-2d e ambos os
  // corpos colocados, o alcance é FATO; fora disso continua UNKNOWN e o fluxo
  // assistido de sempre (Mestre/confirmação) é preservado.
  const spatialIndex = await combatSpatialIndexById(db, turnContext?.combatId ?? null);
  const priorCasts = turnContext ? await committedCastsOnTurn(db, turnContext) : [];
  assertCastingEconomy(turnContext, economyCost, priorCasts, {
    spellLevel,
    castingTime: economyCost,
  }, options.reactionAuthorized);

  let targeting: SpellTargetingSnapshot;
  let area: SpellCastContext['area'] = null;
  let areaPlacement: AreaPlacement | null = null;
  let requiredConfirmations: SpatialRequirementKind[] = [];

  if (isAreaTargeting(execution.targeting)) {
    // 6.6J.3: o cliente NUNCA envia a lista de atingidos por uma área. Se
    // mandar, é rejeitado em vez de ignorado silenciosamente.
    if (input.targets.length > 0) {
      throw new HttpError(
        'Magias de área derivam os atingidos no servidor; não envie alvos.',
        400,
        'AREA_TARGETS_CLIENT_SUPPLIED',
      );
    }
    if (!input.areaPlacement) {
      throw new HttpError(
        'Informe a colocação da área (origem e direção, quando exigida).',
        400,
        'AREA_PLACEMENT_REQUIRED',
      );
    }
    areaPlacement = input.areaPlacement;
    const resolved = await resolveAreaTargets({
      db,
      targeting: execution.targeting,
      placement: areaPlacement,
      caster,
      combatId: turnContext?.combatId ?? null,
      castAtLevel,
      provider: options.areaProvider ?? gridAreaSpatialProvider(spatialIndex),
      ...(input.spatialConfirmation ? { confirmation: input.spatialConfirmation } : {}),
      ...(options.areaDecisions ? { decisions: options.areaDecisions } : {}),
      deferUnknown: options.deferUnknown === true,
    });
    targets.length = 0;
    targets.push(...resolved.affected);
    targeting = resolved.snapshot;
    area = { snapshot: resolved.snapshot, requiredDecisions: resolved.requiredDecisions };
    requiredConfirmations = resolved.requiredConfirmations;
  } else {
    if (input.areaPlacement) {
      throw new HttpError(
        'Esta magia não usa colocação de área.',
        400,
        'AREA_PLACEMENT_NOT_ALLOWED',
      );
    }
    // 6.6J.5 — TOTAL COVER é falha de TARGETING: recusa aqui (read-only), antes
    // de qualquer custo e de qualquer d20. Cobertura PARCIAL não bloqueia: vira
    // +2/+5 na CA/save, aplicada na resolução.
    const coverInteraction =
      execution.resolution.kind === 'attack-damage'
        ? ('attack' as const)
        : ('dexterity-save' as const);
    for (const target of targets) {
      const confirmed = coverConfirmationFor(target.entity);
      const providerEvaluation = await coverFor(
        { origin: caster.entity, target: target.entity, interaction: coverInteraction },
        coverProvider,
      );
      // 6.6J.5.1: o Mestre só decide o que o servidor não avaliou.
      assertCoverDecisionAllowed(providerEvaluation, confirmed);
      const evaluation = applyCoverConfirmation(providerEvaluation, confirmed);
      assertCoverAllowsDirectTargeting(
        evaluation,
        'SPELL_TARGET_TOTAL_COVER',
        'O alvo está em cobertura total e não pode ser escolhido diretamente.',
      );
    }

    // 6.6E: TARGETING validado com o `castAtLevel` REAL — a quantidade máxima de
    // alvos é derivada da definição + espaço escolhido, nunca do cliente.
    targeting = await validateTargeting({
      db,
      targeting: execution.targeting,
      caster,
      targets,
      castAtLevel,
      deferUnknown: options.deferUnknown === true,
      // A janela de oportunidade já confirmou a visão (ou recebeu adjudicação).
      // canSee mecânico continua revalidado; alcance e caminho mantêm o provider.
      provider: options.reactionAuthorized
        ? {...gridSpatialProvider(spatialIndex), evaluateSightGeometry: () => 'pass' as const}
        : gridSpatialProvider(spatialIndex),
      ...(input.spatialConfirmation ? { confirmation: input.spatialConfirmation } : {}),
    });
    // 6.6L.2 — fatos de DISTÂNCIA entram no snapshot imutável do cast (sem
    // coordenadas): reposicionar depois não reescreve como foi validado.
    if (spatialIndex) {
      targeting = { ...targeting, distances: distanceFactsFor(spatialIndex, caster, targets) };
    }
    requiredConfirmations = targeting.requiredConfirmations;
    // 6.6J.4: os ASSIGNMENTS (ordem + repetição) ficam no snapshot do TARGETING;
    // o conjunto único sozinho não reconstrói "A recebeu duas jogadas".
    if (attackCount > 1 && isExplicitTargeting(execution.targeting)) {
      targeting = {
        ...targeting,
        attackAssignments: targets.map((target, index) => ({
          index,
          target: { kind: target.entity.kind, id: target.entity.id },
        })),
      };
    }
  }

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
    economyCost,
    targeting,
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
    castingTimeKind,
    reactionAuthorized: options.reactionAuthorized,
    economyCost,
    turnContext,
    targeting,
    area,
    areaPlacement,
    coverProvider,
    coverConfirmations,
    components,
    requiredConfirmations,
    castOperationId: options.operationId ?? input.operationId,
    availabilityKind: authorization.availabilityKind,
  };
}

/**
 * COMMIT — fronteira entre validação reversível e conjuração realizada.
 *
 * Grava o `SpellCast` em `resolving` (a constraint parcial do banco garante UM
 * por caster, inclusive sob concorrência). NÃO cria Concentração nova aqui.
 */
/** Conjunto canônico ÚNICO de alvos (ordem/repetição vive no snapshot). */
function uniqueTargetRefs(targets: readonly LoadedEntity[]): { kind: string; id: string }[] {
  const seen = new Set<string>();
  const refs: { kind: string; id: string }[] = [];
  for (const target of targets) {
    const key = `${target.entity.kind}:${target.entity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: target.entity.kind, id: target.entity.id });
  }
  return refs;
}

async function commitSpellCast(
  db: Prisma.TransactionClient,
  context: SpellCastContext,
  fingerprint: string,
): Promise<SpellCast> {
  // 6.6D: a AÇÃO (ou Ação Bônus) é consumida no COMMIT, na MESMA transação, e
  // ANTES do espaço. Falha de qualquer etapa desfaz tudo — nunca fica slot sem
  // Ação nem Ação sem SpellCast.
  const economy = context.turnContext
    ? await commitCastingEconomy(db, context.turnContext, context.economyCost, context.reactionAuthorized)
    : null;

  // O espaço é gasto ANTES da resolução, na MESMA transação do cast committed:
  // passar no save, cancelar a pendência ou perder a Concentração não devolve o
  // espaço, e o retry (que sai por `operationId`) não gasta de novo.
  const spent = context.resource
    ? await spendCastingResource(context.caster.entity, context.resource, db)
    : null;

  // 6.6G: REVALIDA o plano e consome o material na MESMA transação do cast.
  // Material nunca é removido sem `SpellCast`, nem `SpellCast` existe sem o
  // consumo — e o retry (que sai por `operationId`) não consome duas vezes.
  const finalComponents = await resolveSpellComponents({
    db,
    spell: allSpells().find((item) => item.id === context.execution.spellId)!,
    source: context.profile.source,
    entity: context.caster.entity,
  });
  assertSpellComponents(finalComponents);
  await consumeSpellComponents(finalComponents, context.caster.entity, db);

  // 6.6H: a DURAÇÃO começa AQUI, no COMMIT — nunca quando o Effect nasce depois
  // da resolution barrier. Em combate a âncora é o round e a ativação REAIS;
  // fora de combate o acompanhamento é manual (não existe world clock).
  const durationSnapshot = context.execution.duration
    ? buildDurationSnapshot({
        definition: context.execution.duration,
        combat: context.turnContext
          ? {
              combatId: context.turnContext.combatId,
              anchorCombatantId: context.turnContext.combatantId,
              roundNumber:
                (
                  await db.combat.findUnique({
                    where: { id: context.turnContext.combatId },
                    select: { round: true },
                  })
                )?.round ?? 1,
              turnSequence: context.turnContext.turnSequence,
            }
          : null,
      })
    : null;
  return db.spellCast.create({
    data: {
      spellId: context.execution.spellId,
      casterEntityKind: context.caster.entity.kind,
      casterEntityId: context.caster.entity.id,
      casterLabel: context.caster.name,
      targets: uniqueTargetRefs(context.targets) as unknown as Prisma.InputJsonValue,
      // Snapshot IMUTÁVEL do targeting (6.6E): mover alvo, mudar tipo ou ganhar
      // geometria depois NÃO reescreve como este cast foi validado.
      targetingSnapshot: context.targeting as unknown as Prisma.InputJsonValue,
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
      // Snapshot do CASTING TIME/turno (6.6D). Fora de combate os campos de
      // combate ficam nulos; o custo nunca é recalculado depois.
      castingTimeKind: context.castingTimeKind,
      combatId: context.turnContext?.combatId ?? null,
      turnSequence: context.turnContext?.turnSequence ?? null,
      combatantId: context.turnContext?.combatantId ?? null,
      economyCostKind: economy?.cost ?? null,
      economySpentAt: economy?.spentAt ?? null,
      // Snapshot IMUTÁVEL dos componentes/fornecedor usados (6.6G).
      componentsSnapshot: toComponentsSnapshot(finalComponents) as unknown as Prisma.InputJsonValue,
      // Snapshot IMUTÁVEL da duração/âncora do combate (6.6H).
      ...(durationSnapshot
        ? { durationSnapshot: durationSnapshot as unknown as Prisma.InputJsonValue }
        : {}),
      visibility: 'public',
      operationId: context.castOperationId,
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
        // 6.6H: o Effect HERDA a duração do COMMIT (nunca "mais 1 minuto" a
        // partir da criação) e o snapshot dos triggers da definição.
        ...(cast.durationSnapshot
          ? { durationSnapshot: cast.durationSnapshot as Prisma.InputJsonValue }
          : {}),
        turnTriggers: effect.turnTriggers() as unknown as Prisma.InputJsonValue,
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
/**
 * 6.6J.5 — COBERTURA de UMA salvaguarda pendente.
 *
 * Só Destreza recebe +2/+5 (PHB 2014) e a magia pode IGNORAR o benefício
 * (`ignoreSaveCover`, Chama Sagrada). Total Cover NÃO vira bônus: aqui a
 * pendência guarda o nível CONHECIDO e o bônus; `unknown`/`not-assessed` fica
 * de fora (nunca "meia cobertura" por suposição).
 */
async function saveCoverFor(
  context: SpellCastContext,
  target: MechanicalEntity,
): Promise<{ level: string | null; bonus: number; provenance: string | null } | null> {
  const resolution = context.execution.resolution;
  if (resolution.kind !== 'save-effect' && resolution.kind !== 'save-damage') return null;
  // Só DESTREZA recebe o benefício; a magia pode ignorar (Chama Sagrada).
  if (resolution.ability !== 'dexterity') return null;
  if (resolution.kind === 'save-damage' && resolution.ignoreSaveCover) return null;
  // 6.6J.5.1 — em ÁREA a origem da relação é a ORIGEM RESOLVIDA (o ponto
  // efetivo da forma), nunca o caster fixo; em magia direta continua o caster.
  const origin =
    (context.area?.snapshot.origin.resolved as MechanicalEntity | null | undefined) ??
    context.caster.entity;
  const confirmed = context.coverConfirmations.find(
    (item) => item.targetKey === `${target.kind}:${target.id}`,
  )?.level;
  const evaluation = applyCoverConfirmation(
    await (async () => {
      const providerEvaluation = await coverFor(
        { origin, target, interaction: 'dexterity-save' },
        context.coverProvider,
      );
      assertCoverDecisionAllowed(providerEvaluation, confirmed);
      return providerEvaluation;
    })(),
    confirmed,
  );
  const snapshot = coverSnapshotOf(evaluation);
  return snapshot.status === 'known'
    ? { level: snapshot.level, bonus: snapshot.saveBonus, provenance: snapshot.provenance }
    : null;
}

async function beginPendingSaves(
  db: Prisma.TransactionClient,
  cast: SpellCast,
  context: SpellCastContext,
): Promise<PendingEffectSaveDto[]> {
  const resolution = context.execution.resolution;
  if (resolution.kind !== 'save-effect' && resolution.kind !== 'save-damage') {
    throw new HttpError('Definição de execução inconsistente.', 409, 'SPELL_EXECUTION_NOT_IMPLEMENTED');
  }
  // `save-damage` não aponta para Effect Definition: a identidade mecânica é a
  // própria magia (`spell.<id>`). `save-effect` continua usando a definição do
  // efeito durável que nascerá na falha.
  const pendingDefinitionId =
    resolution.kind === 'save-effect'
      ? resolution.effectDefinitionId
      : spellDefinitionId(context.execution.spellId);
  // 6.6E: UM SpellCast com N alvos gera N pendências (uma por alvo). Nunca N
  // casts, nunca N espaços, nunca N Ações. Cada pendência tem sua própria
  // chave idempotente derivada do cast + identidade canônica do alvo.
  const created: PendingEffectSaveDto[] = [];
  for (const target of context.targets) {
    const cover = await saveCoverFor(context, target.entity);
    const pending = await db.pendingEffectSave.create({
      data: {
        definitionId: pendingDefinitionId,
        // Vínculo explícito pendência → conjuração (nunca fundir os conceitos).
        spellCastId: cast.id,
        casterEntityKind: context.caster.entity.kind,
        casterEntityId: context.caster.entity.id,
        casterLabel: context.caster.name,
        targetEntityKind: target.entity.kind,
        targetEntityId: target.entity.id,
        ability: resolution.ability,
        dc: context.saveDc,
        ...(cover ? { cover: cover as unknown as Prisma.InputJsonValue } : {}),
        visibility: 'public',
        status: 'pending',
        operationId: `${cast.id}:${target.entity.kind}:${target.entity.id}`,
        fingerprint: `${cast.fingerprint}:save:${target.entity.kind}:${target.entity.id}`,
        createdBy: context.actor.userId,
      },
    });
    created.push(toPendingEffectSaveDto(pending));
  }
  return created;
}

/**
 * Fecha um cast cuja ÁREA não atingiu ninguém (6.6J.3).
 *
 * `save-damage` usa o MESMO finalizer da 6.6J.2 (zero pendências ⇒ barreira
 * satisfeita ⇒ `resolved`/`no-effect`); as demais resoluções não têm o que
 * aplicar e são fechadas com motivo auditável. Custos do COMMIT não voltam.
 */
async function closeCastWithoutTargets(
  db: Prisma.TransactionClient,
  cast: SpellCast,
  context: SpellCastContext,
): Promise<SpellCast> {
  if (context.execution.resolution.kind === 'save-damage') {
    await finalizeSaveDamageCast(cast.id, db);
  } else {
    await db.spellCast.updateMany({
      where: { id: cast.id, status: 'resolving' },
      data: {
        status: 'resolved',
        outcome: 'no-effect',
        resolutionReason: 'no-affected-targets',
        resolvedAt: new Date(),
      },
    });
  }
  return db.spellCast.findUniqueOrThrow({ where: { id: cast.id } });
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
  return executeCast(actor, input, {
    operationId: input.operationId,
    fingerprint: fingerprintOf(actor, input),
  });
}

/** Chave de idempotência estável do request (usada pela INTENÇÃO, 6.6F). */
export function castFingerprint(actor: EffectActor, input: SpellCastProofInput): string {
  return fingerprintOf(actor, input);
}

/**
 * NÚCLEO ÚNICO de conjuração — prova do Mestre, PLAYER e aprovação de intenção.
 *
 * `operationId`/`fingerprint` são INJETADOS para que a aprovação de uma
 * intenção use a chave da própria intenção (estável entre Mestres diferentes) em
 * vez da chave do request HTTP: retry e aprovação concorrente convergem para o
 * MESMO `SpellCast` (constraint `operationId` único), nunca para dois.
 */
export async function executeCast(
  actor: EffectActor,
  input: SpellCastProofInput,
  castKey: {
    operationId: string;
    fingerprint: string;
    /** Extensão interna: só o Reaction Gate autoriza conjuração fora do turno. */
    reactionAuthorized?: boolean;
    beforeValidate?: (db: Prisma.TransactionClient) => Promise<void>;
    afterResolution?: (db: Prisma.TransactionClient, cast: SpellCastDto) => Promise<void>;
    deferUnknown?: boolean;
    /** 6.6J.3 — provider espacial injetável (teste) e decisões do Mestre. */
    areaProvider?: AreaSpatialProvider;
    areaDecisions?: readonly AreaUnknownDecision[];
    /** 6.6J.5 — provider de cobertura injetável (teste). */
    coverProvider?: CoverSpatialProvider;
  },
): Promise<SpellCastResult> {
  if (castKey.reactionAuthorized && (!castKey.beforeValidate || !castKey.afterResolution)) throw new HttpError('Conjuração de Reação exige o lifecycle de oportunidade.', 409, 'SPELL_REACTION_NOT_AVAILABLE');
  const fingerprint = castKey.fingerprint;

  const existing = await prisma.spellCast.findUnique({
    where: { operationId: castKey.operationId },
  });
  if (existing) {
    if (existing.fingerprint !== fingerprint) idempotencyError();
    return replayResult(existing);
  }

  let outcome: CommittedOutcome;
  // Ficha cujo inventário mudou (material consumido) — publicado só após commit.
  let consumedCharacterId: string | null = null;
  // Resultado de cura imediata (6.6I.3) — publica/loga só depois do commit.
  let immediateHealing: ImmediateHealingResult | null = null;
  // Resultado de ataque mágico (6.6I.4) — idem: publica só depois do commit.
  let attackDamage: AttackDamageResult | null = null;
  try {
    outcome = await prisma.$transaction(async (db) => {
      const prior = await db.spellCast.findUnique({
        where: { operationId: castKey.operationId },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) idempotencyError();
        return { ...(await replayResult(prior, db)), endedTargets: [] };
      }

      if (castKey.beforeValidate) await castKey.beforeValidate(db);
      // VALIDATE (read-only) — falha aqui NÃO encerra concentração anterior.
      const context = await validateSpellCast(actor, input, db, castKey);
      if (context.components.consumptions.length > 0) {
        consumedCharacterId = context.components.characterId;
      }

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

      const resolve = async (): Promise<CommittedOutcome> => {
        // RESOLUTION
        if (context.execution.resolution.kind === 'immediate-effect') {
          const resolved = await resolveImmediateEffect(db, cast, context);
          return {
            cast: toSpellCastDto(resolved.cast),
            replayed: false,
            effectGroupId: resolved.cast.effectGroupId ?? null,
            effects: resolved.effects.map((row) => toEffectDto(row)),
            pending: null,
            pendings: [],
            endedTargets: [...endedTargets, ...resolved.affected],
          };
        }

        // 6.6I.3: cura imediata resolve NA MESMA transação do COMMIT — rolagem,
        // HP, morte e fechamento do cast. Nenhum Effect/pendência é criado.
        if (context.execution.resolution.kind === 'immediate-healing') {
          const healed = await resolveImmediateHealing(db, cast, {
            caster: context.caster,
            targets: context.targets,
            actorUserId: actor.userId,
          }, context.execution);
          immediateHealing = healed;
          return {
            cast: toSpellCastDto(healed.cast),
            replayed: false,
            effectGroupId: null,
            effects: [],
            pending: null,
            pendings: [],
            endedTargets,
          };
        }

        // 6.6I.4: ataque mágico resolve imediatamente, na MESMA transação do
        // COMMIT, com o resolver de ataque compartilhado e o núcleo de dano.
        if (context.execution.resolution.kind === 'attack-damage') {
          const attack = await resolveAttackDamageSpell(
            db,
            cast,
            // Assignments (ordem + repetição), nunca o conjunto deduplicado.
            { caster: context.caster, assignments: context.targets },
            context.execution,
            {
              coverConfirmations: context.coverConfirmations,
              ...(castKey.coverProvider ? { coverProvider: castKey.coverProvider } : {}),
            },
          );
          attackDamage = attack;
          return {
            cast: toSpellCastDto(attack.cast),
            replayed: false,
            effectGroupId: null,
            effects: [],
            pending: null,
            pendings: [],
            endedTargets,
          };
        }

        const pendings = await beginPendingSaves(db, cast, context);
        // 6.6J.3: ÁREA sem ninguém dentro é CAST VÁLIDO (custos pagos, zero
        // salvaguardas). O cast fecha na hora como `no-effect`, nunca "alvo
        // inválido" e nunca eternamente `resolving`.
        if (context.targets.length === 0) {
          const closed = await closeCastWithoutTargets(db, cast, context);
          return {
            cast: toSpellCastDto(closed),
            replayed: false,
            effectGroupId: null,
            effects: [],
            pending: null,
            pendings: [],
            endedTargets,
          };
        }
        return {
          cast: toSpellCastDto(cast),
          replayed: false,
          effectGroupId: null,
          effects: [],
          pending: pendings[0] ?? null,
          pendings,
          endedTargets,
        };
      };
      const resolved = await resolve();
      if (castKey.afterResolution) await castKey.afterResolution(db, resolved.cast);
      return resolved;
    }, {timeout: castKey.reactionAuthorized ? 20000 : 5000});
  } catch (error) {
    // Corrida de retry: o perdedor devolve o snapshot da MESMA conjuração.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const prior = await prisma.spellCast.findUnique({
        where: { operationId: castKey.operationId },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) idempotencyError();
        return replayResult(prior);
      }
      // Colisão do índice parcial: outro cast do mesmo caster ganhou a corrida.
      castInProgress();
    }
    const prior = await prisma.spellCast.findUnique({
      where: { operationId: castKey.operationId },
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint) idempotencyError();
      return replayResult(prior);
    }
    throw error;
  }

  // REALTIME/LOGS depois do commit: superfícies existentes, sem evento novo.
  // 6.6G: material consumido muda o INVENTÁRIO — a ficha é republicada pelo
  // canal de sempre, nunca por decremento otimista do cliente.
  if (consumedCharacterId) await publishCharacter(consumedCharacterId);
  if (immediateHealing) await publishImmediateHealing(immediateHealing);
  if (attackDamage) await publishAttackDamageResult(attackDamage);
  if (outcome.pendings.length > 0) {
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

/** Resultado COMPLETO de um cast já committed (`null` se não existe). */
export async function castResultForOperation(
  operationId: string,
): Promise<SpellCastResult | null> {
  const row = await prisma.spellCast.findUnique({ where: { operationId } });
  return row ? replayResult(row) : null;
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
  if (db === prisma) return prisma.$transaction(tx => cancelSpellCastForPending(spellCastId, tx));
  await db.spellCast.updateMany({
    where: { id: spellCastId, status: 'resolving' },
    data: { status: 'cancelled', outcome: 'cancelled', resolvedAt: new Date() },
  });
  const { settleOpportunitySpell } = await import('../../combat/spatial/opportunity-attack.service.js');
  await settleOpportunitySpell(db, spellCastId);
}
