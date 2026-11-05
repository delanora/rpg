import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { allSpells } from '../modules/shared/spells/index.js';
import { spellDefinitionId } from '../modules/spells/execution/spell-execution-definition.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import {
  areaPlacementSchema,
  areaShapeSchema,
  areaTargetingDefinitionSchema,
  originInclusionPolicyOf,
  shapeRequiresDirection,
  validateAreaPlacement,
  type AreaPlacement,
  type AreaShapeDefinition,
  type AreaTargetingDefinition,
} from '../modules/spells/execution/area-targeting.js';
import {
  applyAreaDecisions,
  areaCandidateEvaluation,
  canonicalTargetKey,
  mergeAreaEvaluation,
  sortAreaCandidates,
  type AreaTriState,
} from '../modules/spells/execution/area-evaluation.js';
import {
  areaTargetingSnapshotSchema,
  parseAreaTargetingSnapshot,
} from '../modules/spells/execution/area-snapshot.js';
import {
  assistedAreaSpatialProvider,
  sameAreaEntity,
  type AreaResolvedOrigin,
  type AreaSpatialProvider,
} from '../modules/spells/execution/area-spatial.js';
import { resolveAreaTargets } from '../modules/spells/execution/area-targeting.service.js';
import {
  SYNTHETIC_AREA_SPELL_ID,
  SYNTHETIC_AREA_LABEL,
} from '../modules/spells/execution/area-synthetic-definition.js';
import { finalizeSaveDamageCast } from '../modules/spells/execution/save-damage-finalizer.js';
import { resolveSaveDamagePending } from '../modules/spells/execution/save-damage-resolution.js';
import { toSpellCastIntentDto } from '../modules/spells/execution/spell-intent.service.js';
import { toSpellCastDto } from '../modules/spells/execution/spell-cast.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const FIRE = 'Fogo';

/**
 * FASE 6.6J.3 — AREA TARGETING FOUNDATION.
 *
 * Prova que uma magia de área NÃO recebe a lista de atingidos: ela declara
 * FORMA + ORIGEM + política, o SERVIDOR enumera os candidatos reais e resolve
 * cada um como `pass`/`fail`/`unknown`, o Mestre decide SOMENTE o `unknown`, e o
 * conjunto derivado alimenta o pipeline da 6.6J.2 (1 cast → N pendências → UM
 * roll de dano compartilhado → consequências por alvo).
 *
 * A definição é SINTÉTICA (`test.synthetic-area-save-damage`): esfera de 20 ft,
 * origem em ponto a 60 ft, todas as criaturas válidas, Destreza, 2d6 Fogo,
 * sucesso = metade e falha = cheio. NENHUMA magia PHB nova (Fireball, Burning
 * Hands, Thunderwave, Cone of Cold, Lightning Bolt) é registrada.
 *
 * Não há grid/coordenadas no projeto: em produção a geometria é ASSISTIDA
 * (`unknown` + Mestre). O provider DETERMINÍSTICO abaixo existe só neste smoke
 * (em processo), nunca em endpoint público.
 */
export async function smokeAreaTargetingFoundation(
  baseUrl: string,
  check: Check,
): Promise<void> {
  console.log('\n86) Fase 6.6J.3 — area targeting foundation');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  const castIds: string[] = [];
  const pendingIds: string[] = [];
  const intentIds: string[] = [];

  const request = async (path: string, token: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };

  try {
    // =====================================================================
    // A — CONTRATO PURO: FORMAS, ORIGEM, COLOCAÇÃO, TRI-STATE
    // =====================================================================
    const shapes: AreaShapeDefinition[] = [
      { kind: 'sphere', radiusFeet: 20 },
      { kind: 'cone', lengthFeet: 15 },
      { kind: 'cube', sizeFeet: 10 },
      { kind: 'cylinder', radiusFeet: 10, heightFeet: 40 },
      { kind: 'line', lengthFeet: 30, widthFeet: 5 },
    ];
    check(
      '86.A) as CINCO formas do PHB 2014 são tipadas (sem `emanation`, que é 2024)',
      shapes.every((shape) => areaShapeSchema.safeParse(shape).success) &&
        !areaShapeSchema.safeParse({ kind: 'emanation', radiusFeet: 10 }).success &&
        !areaShapeSchema.safeParse({ kind: 'sphere', radiusFeet: 0 }).success &&
        !areaShapeSchema.safeParse({ kind: 'sphere', radiusFeet: -5 }).success &&
        !areaShapeSchema.safeParse({ kind: 'line', lengthFeet: 30 }).success,
      JSON.stringify(shapes),
    );
    check(
      '86.B) inclusão da origem: esfera/cilindro INCLUEM; cone/cubo/linha são escolha do caster',
      originInclusionPolicyOf(shapes[0]!) === 'included' &&
        originInclusionPolicyOf(shapes[3]!) === 'included' &&
        originInclusionPolicyOf(shapes[1]!) === 'caster-choice' &&
        originInclusionPolicyOf(shapes[2]!) === 'caster-choice' &&
        originInclusionPolicyOf(shapes[4]!) === 'caster-choice',
      JSON.stringify(shapes.map((shape) => originInclusionPolicyOf(shape))),
    );
    check(
      '86.C) direção: só cone e linha EXIGEM; esfera/cubo/cilindro não inventam requisito',
      shapeRequiresDirection(shapes[1]!) &&
        shapeRequiresDirection(shapes[4]!) &&
        !shapeRequiresDirection(shapes[0]!) &&
        !shapeRequiresDirection(shapes[2]!) &&
        !shapeRequiresDirection(shapes[3]!),
    );

    const sphereDefinition = areaTargetingDefinitionSchema.parse({
      kind: 'area',
      origin: { kind: 'point', rangeFeet: 60, requiresSight: false },
      area: { shape: { kind: 'sphere', radiusFeet: 20 }, affects: { kind: 'all-valid-creatures' } },
    }) as AreaTargetingDefinition;
    const coneDefinition = areaTargetingDefinitionSchema.parse({
      kind: 'area',
      origin: { kind: 'self' },
      area: { shape: { kind: 'cone', lengthFeet: 15 }, affects: { kind: 'all-valid-creatures' } },
    }) as AreaTargetingDefinition;

    const placementError = (targeting: AreaTargetingDefinition, placement: unknown) => {
      try {
        validateAreaPlacement(targeting, areaPlacementSchema.parse(placement));
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'UNKNOWN';
      }
    };
    check(
      '86.D) colocação: cone sem direção falha; esfera NÃO aceita `includeOrigin` (nem false nem true)',
      placementError(coneDefinition, { requestedOrigin: { kind: 'self' } }) ===
        'AREA_DIRECTION_REQUIRED' &&
        placementError(sphereDefinition, {
          requestedOrigin: { kind: 'self' },
          includeOrigin: false,
        }) === 'AREA_ORIGIN_INCLUSION_INVALID' &&
        placementError(sphereDefinition, {
          requestedOrigin: { kind: 'self' },
          includeOrigin: true,
        }) === 'AREA_ORIGIN_INCLUSION_INVALID' &&
        placementError(sphereDefinition, { requestedOrigin: { kind: 'self' } }) === null,
      JSON.stringify({ cone: coneDefinition.area.shape, sphere: sphereDefinition.area.shape }),
    );
    check(
      '86.E) cliente não altera tamanho/forma/alcance: campos desconhecidos são RECUSADOS',
      !areaPlacementSchema.safeParse({
        requestedOrigin: { kind: 'self' },
        radiusFeet: 1000,
      }).success &&
        !areaPlacementSchema.safeParse({
          requestedOrigin: { kind: 'self' },
          shape: { kind: 'cone', lengthFeet: 60 },
        }).success &&
        !areaPlacementSchema.safeParse({
          requestedOrigin: { kind: 'self' },
          affectedTargetIds: ['character:x'],
        }).success,
    );

    const merge = (geometry: AreaTriState, propagation: AreaTriState) =>
      mergeAreaEvaluation(geometry, propagation, 'pass');
    check(
      '86.F) tri-state: fail vence, unknown antes de pass; propagação bloqueada = NÃO afetado',
      merge('pass', 'pass') === 'pass' &&
        merge('fail', 'pass') === 'fail' &&
        merge('pass', 'fail') === 'fail' &&
        merge('unknown', 'pass') === 'unknown' &&
        merge('pass', 'unknown') === 'unknown' &&
        merge('unknown', 'fail') === 'fail' &&
        mergeAreaEvaluation('pass', 'pass', 'fail') === 'fail',
    );

    const sampleEvaluations = sortAreaCandidates([
      areaCandidateEvaluation({
        targetKey: 'character:b',
        kind: 'character',
        id: 'b',
        geometry: 'pass',
        propagation: 'pass',
      }),
      areaCandidateEvaluation({
        targetKey: 'character:a',
        kind: 'character',
        id: 'a',
        geometry: 'pass',
        propagation: 'pass',
      }),
      areaCandidateEvaluation({
        targetKey: 'character:e',
        kind: 'character',
        id: 'e',
        geometry: 'unknown',
        propagation: 'pass',
      }),
      areaCandidateEvaluation({
        targetKey: 'character:c',
        kind: 'character',
        id: 'c',
        geometry: 'fail',
        propagation: 'pass',
      }),
    ]);
    const decisions = applyAreaDecisions(sampleEvaluations, [
      { targetKey: 'character:e', affected: true },
    ]);
    check(
      '86.G) ordem canônica + decisão do Mestre: pass entra, fail sai, unknown confirmado entra',
      sampleEvaluations.map((item) => item.targetKey).join(',') ===
        'character:a,character:b,character:c,character:e' &&
        decisions.affectedKeys.join(',') === 'character:a,character:b,character:e' &&
        decisions.provenance.get('character:a') === 'authoritative' &&
        decisions.provenance.get('character:e') === 'master-confirmed' &&
        decisions.missing.length === 0,
      JSON.stringify(decisions),
    );
    const invalidDecision = applyAreaDecisions(sampleEvaluations, [
      { targetKey: 'character:c', affected: true },
    ]);
    const missingDecision = applyAreaDecisions(sampleEvaluations, []);
    check(
      '86.H) Mestre NÃO sobrescreve pass/fail e `unknown` sem decisão deixa a resolução incompleta',
      invalidDecision.invalid.join(',') === 'character:c' &&
        missingDecision.missing.join(',') === 'character:e',
      JSON.stringify({ invalid: invalidDecision.invalid, missing: missingDecision.missing }),
    );

    // =====================================================================
    // B — DEFINIÇÃO SINTÉTICA FORA DE PRODUÇÃO
    // =====================================================================
    const synthetic = spellExecutionDefinition(SYNTHETIC_AREA_SPELL_ID);
    check(
      '86.I) definição sintética: esfera 20 ft, origem em ponto a 60 ft, todas as criaturas, 2d6 Fogo half/full',
      synthetic?.targeting.kind === 'area' &&
        synthetic.targeting.area.shape.kind === 'sphere' &&
        synthetic.targeting.area.shape.radiusFeet === 20 &&
        synthetic.targeting.origin.kind === 'point' &&
        synthetic.targeting.origin.rangeFeet === 60 &&
        synthetic.targeting.area.affects.kind === 'all-valid-creatures' &&
        synthetic.resolution.kind === 'save-damage' &&
        synthetic.resolution.damageRollScope === 'shared' &&
        synthetic.resolution.damage.components[0]?.type === FIRE &&
        synthetic.resolution.damage.components[0]?.dice.count === 2 &&
        synthetic.resolution.damage.components[0]?.dice.sides === 6 &&
        synthetic.requiresConcentration === false,
      JSON.stringify(synthetic),
    );
    check(
      '86.J) a prova NÃO está no catálogo e nenhuma magia PHB de área foi registrada',
      !allSpells().some((spell) => spell.id === SYNTHETIC_AREA_SPELL_ID) &&
        ['fireball', 'burning-hands', 'thunderwave', 'cone-of-cold', 'lightning-bolt', 'cloudkill'].every(
          (id) => spellExecutionDefinition(id) === null,
        ) &&
        SYNTHETIC_AREA_LABEL.length > 0,
    );

    // =====================================================================
    // CENA — usuários, personagens, combate ativo, candidatos
    // =====================================================================
    const makeUser = (label: string, role: 'MASTER' | 'PLAYER' = 'PLAYER') =>
      prisma.user.create({
        data: {
          username: `ar_${label}_${suffix}`,
          displayName: `AR ${label}`,
          passwordHash: 'fixture',
          role,
        },
      });
    const master = await makeUser('m', 'MASTER');
    userIds.push(master.id);
    const tokenOf = (user: { id: string; username: string; displayName: string; role: string }) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'MASTER' | 'PLAYER',
      });
    const masterToken = tokenOf(master);

    const makeCharacter = async (
      label: string,
      owner: { id: string },
      data: Record<string, unknown> = {},
    ) => {
      const character = await prisma.character.create({
        data: {
          userId: owner.id,
          name: `AR ${label}`,
          hpCurrent: 40,
          hpMax: 40,
          speed: 9,
          dexterity: 10,
          wisdom: 10,
          ...data,
        } as never,
      });
      characterIds.push(character.id);
      return character;
    };

    const ownerA = await makeUser('a');
    const ownerB = await makeUser('b');
    const ownerC = await makeUser('c');
    const ownerD = await makeUser('d');
    const ownerE = await makeUser('e');
    const ownerF = await makeUser('f');
    userIds.push(ownerA.id, ownerB.id, ownerC.id, ownerD.id, ownerE.id, ownerF.id);
    const tokenA = tokenOf(ownerA);

    const targetA = await makeCharacter('A', ownerA, { raceResistances: [FIRE] });
    const targetB = await makeCharacter('B', ownerB);
    const targetC = await makeCharacter('C', ownerC);
    const targetD = await makeCharacter('D', ownerD);
    const targetE = await makeCharacter('E', ownerE);
    const targetF = await makeCharacter('F', ownerF);
    const caster = await makeCharacter('Conjurador', master, {
      classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      mechanicalState: {
        conditions: [],
        exhaustionLevel: 0,
        log: [],
        concentration: {
          id: randomUUID(),
          label: 'Prova de área',
          sourceType: 'manual',
          visibility: 'public',
          startedAt: new Date().toISOString(),
        },
        pendingConcentrationSaves: [],
      },
    });
    // NPC: a INSTÂNCIA do combate é o alvo (nunca o template do bestiário).
    const npcTemplate = await prisma.creature.create({
      data: {
        name: `AR Goblin ${suffix}`,
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        dexterity: 14,
      } as never,
    });
    creatureIds.push(npcTemplate.id);

    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 1,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: caster.id,
              ownerUserId: master.id,
              name: caster.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: targetA.id,
              ownerUserId: ownerA.id,
              name: targetA.name,
              initiative: 18,
              initiativeRoll: 18,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: targetB.id,
              ownerUserId: ownerB.id,
              name: targetB.name,
              initiative: 16,
              initiativeRoll: 16,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: targetC.id,
              ownerUserId: ownerC.id,
              name: targetC.name,
              initiative: 14,
              initiativeRoll: 14,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: targetD.id,
              ownerUserId: ownerD.id,
              name: targetD.name,
              initiative: 12,
              initiativeRoll: 12,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: targetE.id,
              ownerUserId: ownerE.id,
              name: targetE.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: targetF.id,
              ownerUserId: ownerF.id,
              name: targetF.name,
              initiative: 8,
              initiativeRoll: 8,
              dexterityMod: 0,
            },
            {
              kind: 'NPC',
              creatureId: npcTemplate.id,
              name: `${npcTemplate.name} (instância)`,
              initiative: 6,
              initiativeRoll: 6,
              dexterityMod: 2,
              hpCurrent: 20,
              hpMax: 20,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);

    const loadedCaster = await loadEntity({ kind: 'character', id: caster.id });
    const loadedA = await loadEntity({ kind: 'character', id: targetA.id });
    const loadedB = await loadEntity({ kind: 'character', id: targetB.id });
    const loadedC = await loadEntity({ kind: 'character', id: targetC.id });
    const loadedD = await loadEntity({ kind: 'character', id: targetD.id });
    const loadedE = await loadEntity({ kind: 'character', id: targetE.id });
    const loadedF = await loadEntity({ kind: 'character', id: targetF.id });
    const npcCombatant = combat.combatants.find((row) => row.kind === 'NPC')!;
    const loadedNpc = await loadEntity({ kind: 'combatant', id: npcCombatant.id });

    const keyOf = (entity: { kind: string; id: string }) => canonicalTargetKey(entity.kind, entity.id);
    type Fact = { membership: AreaTriState; propagation: AreaTriState };
    const facts = new Map<string, Fact>();
    const setFact = (entity: { kind: string; id: string }, fact: Fact) =>
      facts.set(keyOf(entity), fact);

    const syntheticProvider = (
      overrides: Partial<AreaSpatialProvider> = {},
    ): AreaSpatialProvider => ({
      mode: 'authoritative',
      resolveOrigin: ({ caster: originCaster, requested }) => ({
        requested,
        resolved: requested.kind === 'self' ? originCaster : requested.entity,
        result: 'pass',
        obstruction: 'none',
      }),
      evaluateOriginRange: () => 'pass',
      evaluateOriginSight: () => 'pass',
      evaluateMembership: ({ origin, target, includeOrigin }) => {
        if (sameAreaEntity(origin, target)) return includeOrigin ? 'pass' : 'fail';
        return facts.get(keyOf(target))?.membership ?? 'unknown';
      },
      evaluatePropagation: (origin, target) =>
        sameAreaEntity(origin, target) ? 'pass' : (facts.get(keyOf(target))?.propagation ?? 'pass'),
      ...overrides,
    });

    const resolveWith = (
      targeting: AreaTargetingDefinition,
      placement: AreaPlacement,
      options: {
        provider?: AreaSpatialProvider;
        decisions?: { targetKey: string; affected: boolean }[];
        confirmation?: { origin?: boolean; withinRange?: boolean; sight?: boolean };
        deferUnknown?: boolean;
      } = {},
    ) =>
      resolveAreaTargets({
        db: prisma,
        targeting,
        placement,
        caster: loadedCaster,
        combatId: combat.id,
        castAtLevel: 1,
        ...options,
      });

    // =====================================================================
    // C — DERIVAÇÃO AUTORITATIVA (PASS/FAIL/UNKNOWN) E MISTURA
    // =====================================================================
    setFact(loadedA.entity, { membership: 'pass', propagation: 'pass' });
    setFact(loadedB.entity, { membership: 'pass', propagation: 'pass' });
    setFact(loadedC.entity, { membership: 'fail', propagation: 'pass' });
    setFact(loadedD.entity, { membership: 'pass', propagation: 'fail' });
    setFact(loadedE.entity, { membership: 'pass', propagation: 'unknown' });
    setFact(loadedF.entity, { membership: 'pass', propagation: 'pass' });
    // O próprio conjurador e o NPC ficam FORA nesta cena: o caster é incluído
    // no teste de origem `self` (86.W) e o NPC prova a identidade de INSTÂNCIA
    // (86.M) sem participar do dano compartilhado.
    setFact(loadedCaster.entity, { membership: 'fail', propagation: 'pass' });
    setFact(loadedNpc.entity, { membership: 'fail', propagation: 'pass' });

    const spherePlacement: AreaPlacement = {
      requestedOrigin: { kind: 'entity', entity: { kind: 'character', id: targetA.id } },
    };
    const baseResolution = await resolveWith(sphereDefinition, spherePlacement, {
      provider: syntheticProvider(),
      deferUnknown: true,
    });
    const evaluationOf = (key: string) =>
      baseResolution.snapshot.candidates.find((candidate) => candidate.targetKey === key);
    check(
      '86.K) servidor deriva os candidatos: PASS dentro, FAIL fora, FAIL por cobertura total',
      evaluationOf(keyOf(loadedA.entity))?.affected === 'pass' &&
        evaluationOf(keyOf(loadedB.entity))?.affected === 'pass' &&
        evaluationOf(keyOf(loadedC.entity))?.affected === 'fail' &&
        evaluationOf(keyOf(loadedD.entity))?.affected === 'fail' &&
        evaluationOf(keyOf(loadedD.entity))?.geometry === 'pass' &&
        evaluationOf(keyOf(loadedD.entity))?.propagation === 'fail' &&
        evaluationOf(keyOf(loadedNpc.entity))?.affected === 'fail',
      JSON.stringify(baseResolution.snapshot.candidates),
    );
    check(
      '86.L) propagação desconhecida (E) vira UNKNOWN e pede decisão do Mestre — sem dano presumido',
      evaluationOf(keyOf(loadedE.entity))?.affected === 'unknown' &&
        baseResolution.requiredDecisions.join(',') === keyOf(loadedE.entity) &&
        baseResolution.affected.every((item) => keyOf(item.entity) !== keyOf(loadedE.entity)),
      JSON.stringify({ required: baseResolution.requiredDecisions }),
    );
    check(
      '86.M) INSTÂNCIA do combate (NPC) é o alvo — o template do bestiário nunca entra sozinho',
      baseResolution.snapshot.candidates.some(
        (candidate) => candidate.targetKey === keyOf(loadedNpc.entity),
      ) &&
        !baseResolution.snapshot.candidates.some(
          (candidate) => candidate.targetKey === keyOf({ kind: 'creature', id: npcTemplate.id }),
        ) &&
        loadedNpc.entity.kind === 'combatant',
    );

    const mixed = await resolveWith(sphereDefinition, spherePlacement, {
      provider: syntheticProvider(),
      decisions: [{ targetKey: keyOf(loadedE.entity), affected: true }],
    });
    const affectedKeys = mixed.snapshot.affected.map((item) => canonicalTargetKey(item.kind, item.id));
    check(
      '86.N) mistura: PASS entram, FAIL ficam fora, UNKNOWN confirmado entra — só ele é master-confirmed',
      affectedKeys.includes(keyOf(loadedA.entity)) &&
        affectedKeys.includes(keyOf(loadedB.entity)) &&
        affectedKeys.includes(keyOf(loadedE.entity)) &&
        affectedKeys.includes(keyOf(loadedF.entity)) &&
        !affectedKeys.includes(keyOf(loadedC.entity)) &&
        !affectedKeys.includes(keyOf(loadedD.entity)) &&
        mixed.snapshot.affected.find((item) => canonicalTargetKey(item.kind, item.id) === keyOf(loadedE.entity))
          ?.provenance === 'master-confirmed' &&
        mixed.snapshot.affected.find((item) => canonicalTargetKey(item.kind, item.id) === keyOf(loadedA.entity))
          ?.provenance === 'authoritative' &&
        mixed.snapshot.spatialMode === 'master-assisted',
      JSON.stringify(mixed.snapshot.affected),
    );
    check(
      '86.O) o snapshot deriva a quantidade de afetados (nunca um `targetCount` escolhido)',
      mixed.snapshot.affected.length === 4 &&
        mixed.snapshot.candidates.length === 8 &&
        !('maxTargets' in mixed.snapshot) &&
        !('targetCount' in mixed.snapshot),
      JSON.stringify({ affected: mixed.snapshot.affected.length }),
    );

    const decisionError = async (key: string) => {
      try {
        await resolveWith(sphereDefinition, spherePlacement, {
          provider: syntheticProvider(),
          decisions: [{ targetKey: key, affected: true }],
        });
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'UNKNOWN';
      }
    };
    check(
      '86.P) Mestre NÃO inclui alvo autoritativamente fora nem por cobertura total',
      (await decisionError(keyOf(loadedC.entity))) === 'AREA_DECISION_NOT_UNKNOWN' &&
        (await decisionError(keyOf(loadedD.entity))) === 'AREA_DECISION_NOT_UNKNOWN',
    );
    check(
      '86.Q) Mestre NÃO remove/exclui alvo autoritativamente dentro (all-valid-creatures)',
      (await decisionError(keyOf(loadedA.entity))) === 'AREA_DECISION_NOT_UNKNOWN',
    );
    const incomplete = await (async () => {
      try {
        await resolveWith(sphereDefinition, spherePlacement, { provider: syntheticProvider() });
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'UNKNOWN';
      }
    })();
    check(
      '86.R) sem decisão para o UNKNOWN a aprovação NÃO prossegue (`AREA_RESOLUTION_INCOMPLETE`)',
      incomplete === 'AREA_RESOLUTION_INCOMPLETE',
      JSON.stringify(incomplete),
    );

    // =====================================================================
    // D — ORIGEM: ALCANCE, VISÃO, OBSTRUÇÃO, SELF, INCLUSÃO
    // =====================================================================
    const rangeFail = await (async () => {
      try {
        await resolveWith(
          sphereDefinition,
          spherePlacement,
          { provider: syntheticProvider({ evaluateOriginRange: () => 'fail' }) },
        );
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'UNKNOWN';
      }
    })();
    check(
      '86.S) origem fora do alcance é FAIL autoritativo (não vira intenção)',
      rangeFail === 'AREA_ORIGIN_OUT_OF_RANGE',
      JSON.stringify(rangeFail),
    );
    const rangeUnknown = await resolveWith(sphereDefinition, spherePlacement, {
      provider: syntheticProvider({ evaluateOriginRange: () => 'unknown' }),
      deferUnknown: true,
    });
    const rangeConfirmed = await resolveWith(sphereDefinition, spherePlacement, {
      provider: syntheticProvider({ evaluateOriginRange: () => 'unknown' }),
      confirmation: { withinRange: true },
      decisions: [{ targetKey: keyOf(loadedE.entity), affected: true }],
    });
    check(
      '86.T) alcance desconhecido pede confirmação do Mestre (`range`) e só commita confirmado',
      rangeUnknown.requiredConfirmations.includes('range') &&
        rangeConfirmed.snapshot.origin.rangeResult === 'unknown' &&
        rangeConfirmed.snapshot.affected.length > 0,
      JSON.stringify({ required: rangeUnknown.requiredConfirmations }),
    );

    const sightDefinition: AreaTargetingDefinition = {
      ...sphereDefinition,
      origin: { kind: 'point', rangeFeet: 60, requiresSight: true },
    };
    const sightFail = await (async () => {
      try {
        await resolveWith(sightDefinition, spherePlacement, {
          provider: syntheticProvider({ evaluateOriginSight: () => 'fail' }),
        });
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'UNKNOWN';
      }
    })();
    const sightNotRequired = await resolveWith(sphereDefinition, spherePlacement, {
      provider: syntheticProvider({ evaluateOriginSight: () => 'fail' }),
      deferUnknown: true,
    });
    check(
      '86.U) `requiresSight` é da DEFINIÇÃO: true falha; false nem consulta a visão do ponto',
      sightFail === 'AREA_ORIGIN_NOT_VISIBLE' &&
        sightNotRequired.snapshot.origin.sightResult === 'pass' &&
        !sightNotRequired.requiredConfirmations.includes('sight'),
      JSON.stringify({ sightFail, sight: sightNotRequired.snapshot.origin.sightResult }),
    );

    // Origem resolvida no LADO PRÓXIMO da obstrução (requested ≠ resolved).
    const nearSideProvider = syntheticProvider({
      resolveOrigin: ({ caster: originCaster, requested }) =>
        ({
          requested,
          resolved: loadedA.entity,
          result: 'pass',
          obstruction: 'resolved',
        }) as AreaResolvedOrigin,
    });
    const obstructed = await resolveWith(sphereDefinition, spherePlacement, {
      provider: nearSideProvider,
      decisions: [{ targetKey: keyOf(loadedE.entity), affected: true }],
    });
    check(
      '86.V) requestedOrigin ≠ resolvedOrigin: a propagação parte da origem RESOLVIDA',
      obstructed.snapshot.origin.requested.kind === 'entity' &&
        obstructed.snapshot.origin.requested.entity?.id === targetA.id &&
        obstructed.snapshot.origin.resolved?.id === targetA.id &&
        obstructed.snapshot.origin.obstruction === 'resolved' &&
        evaluationOf(keyOf(loadedA.entity)) !== undefined &&
        obstructed.snapshot.affected.some((item) => item.id === targetA.id),
      JSON.stringify(obstructed.snapshot.origin),
    );

    // Provider ASSISTIDO (produção): só prova a própria âncora da origem.
    const selfSphere = await resolveAreaTargets({
      db: prisma,
      targeting: { ...sphereDefinition, origin: { kind: 'self' } },
      placement: { requestedOrigin: { kind: 'self' } },
      caster: loadedCaster,
      combatId: combat.id,
      castAtLevel: 1,
      provider: assistedAreaSpatialProvider,
      deferUnknown: true,
    });
    check(
      '86.W) origem SELF: o conjurador dentro da esfera é PASS autoritativo; NUNCA excluído por ser caster',
      selfSphere.snapshot.candidates.find((item) => item.targetKey === keyOf(loadedCaster.entity))
        ?.affected === 'pass' &&
        selfSphere.affected.some((item) => keyOf(item.entity) === keyOf(loadedCaster.entity)),
      JSON.stringify(selfSphere.snapshot.candidates.filter((item) => item.affected !== 'unknown')),
    );
    const selfCone = await resolveAreaTargets({
      db: prisma,
      targeting: coneDefinition,
      placement: {
        requestedOrigin: { kind: 'self' },
        direction: { kind: 'toward-entity', entity: { kind: 'character', id: targetB.id } },
        includeOrigin: false,
      },
      caster: loadedCaster,
      combatId: combat.id,
      castAtLevel: 1,
      provider: assistedAreaSpatialProvider,
      deferUnknown: true,
    });
    check(
      '86.X) cone com `includeOrigin: false` exclui a origem de forma AUTORITATIVA (policy caster-choice)',
      selfCone.snapshot.includeOrigin === false &&
        selfCone.snapshot.candidates.find((item) => item.targetKey === keyOf(loadedCaster.entity))
          ?.affected === 'fail',
      JSON.stringify(selfCone.snapshot.candidates.find((item) => item.targetKey === keyOf(loadedCaster.entity))),
    );

    // =====================================================================
    // E — INTENÇÃO: PRIVACIDADE, DECISÕES, ZERO CUSTO
    // =====================================================================
    const snapshotJson = baseResolution.snapshot as unknown as object;
    const fakeIntentRow = {
        id: 'intent-test',
        operationId: `ar-intent-${suffix}`,
        fingerprint: 'fp',
        actorUserId: ownerA.id,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        spellId: SYNTHETIC_AREA_SPELL_ID,
        spellcastingSourceKind: null,
        spellcastingSourceId: null,
        castingResourceKind: null,
        castingResourceLevel: null,
        targets: [],
        areaPlacement: spherePlacement as never,
        areaSnapshot: snapshotJson as never,
        requiredConfirmations: [],
        status: 'pending',
        castOperationId: null,
        combatId: combat.id,
        turnSequence: 1,
        combatantId: null,
        createdAt: new Date(),
        resolvedAt: null,
        approvedBy: null,
        approvedAt: null,
        deniedBy: null,
        cancelledBy: null,
        spellCastId: null,
        reason: null,
    } as never;
    const playerView = toSpellCastIntentDto(fakeIntentRow, 'player');
    const masterView = toSpellCastIntentDto(fakeIntentRow, 'master');
    check(
      '86.Y) DTO do jogador NÃO expõe a lista de candidatos; o Mestre recebe o que precisa decidir',
      playerView.area !== null &&
        playerView.area.candidates === null &&
        playerView.area.requiredDecisions.length === 1,
      JSON.stringify({ area: playerView.area }),
    );
    check(
      '86.Z) o Mestre vê as avaliações por candidato (incluindo criatura que o caster não percebe)',
      Array.isArray(masterView.area?.candidates) &&
        (masterView.area?.candidates ?? []).some((item) => item.targetKey === keyOf(loadedF.entity)),
      JSON.stringify(masterView.area?.candidates),
    );

    const areaPlacementJson = spherePlacement as never;
    const intentRow = await prisma.spellCastIntent.create({
      data: {
        operationId: `ar-intent-${suffix}`,
        fingerprint: `ar-intent-fp-${suffix}`,
        actorUserId: ownerA.id,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        spellId: SYNTHETIC_AREA_SPELL_ID,
        targets: [],
        areaPlacement: areaPlacementJson,
        areaSnapshot: snapshotJson as never,
        requiredConfirmations: [],
        status: 'pending',
        combatId: combat.id,
        turnSequence: 1,
      },
    });
    intentIds.push(intentRow.id);
    const approvalMissing = await request(
      `/spells/intents/${intentRow.id}/approve`,
      masterToken,
      {},
    );
    const approvalInvalid = await request(`/spells/intents/${intentRow.id}/approve`, masterToken, {
      unknownTargetDecisions: [{ targetKey: keyOf(loadedA.entity), affected: false }],
    });
    const intentAfter = await prisma.spellCastIntent.findUniqueOrThrow({ where: { id: intentRow.id } });
    check(
      '86.AA) aprovação sem decisão é recusada (`AREA_RESOLUTION_INCOMPLETE`) e decidir um PASS é recusado (`AREA_DECISION_NOT_UNKNOWN`) — intenção continua `pending`, zero cast',
      approvalMissing.status === 409 &&
        approvalMissing.data?.error === 'AREA_RESOLUTION_INCOMPLETE' &&
        approvalInvalid.status === 409 &&
        approvalInvalid.data?.error === 'AREA_DECISION_NOT_UNKNOWN' &&
        intentAfter.status === 'pending' &&
        intentAfter.spellCastId === null &&
        (await prisma.spellCast.count({ where: { casterEntityId: caster.id } })) === 0,
      JSON.stringify({
        missing: approvalMissing.data?.error,
        invalid: approvalInvalid.data?.error,
        status: intentAfter.status,
      }),
    );
    const zeroCostCaster = await prisma.character.findUniqueOrThrow({ where: { id: caster.id } });
    check(
      '86.AB) INTENÇÃO não gasta nada: nenhum SpellCast, nenhum espaço, nenhuma Ação, nenhuma Concentração encerrada',
      zeroCostCaster.version === 1 &&
        (await prisma.spellCast.count({ where: { casterEntityId: caster.id } })) === 0 &&
        intentAfter.spellCastId === null,
      JSON.stringify({ version: zeroCostCaster.version }),
    );
    const denied = await request(`/spells/intents/${intentRow.id}/deny`, masterToken, {
      reason: 'prova de área',
    });
    check(
      '86.AC) NEGAR é terminal, sem custo e sem cast',
      denied.status === 200 &&
        denied.data?.intent?.status === 'denied' &&
        (await prisma.spellCast.count({ where: { casterEntityId: caster.id } })) === 0,
      JSON.stringify({ status: denied.data?.intent?.status, error: denied.data?.error }),
    );

    // =====================================================================
    // F — PIPELINE 6.6J.2 COM OS ALVOS DERIVADOS
    // =====================================================================
    const areaTargets = [targetA, targetB, targetE, targetF].map((character) => ({
      kind: 'character' as const,
      id: character.id,
    }));
    const areaCast = await prisma.spellCast.create({
      data: {
        spellId: SYNTHETIC_AREA_SPELL_ID,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targets: areaTargets as never,
        targetingSnapshot: mixed.snapshot as never,
        status: 'resolving',
        requiresConcentration: false,
        spellcastingMode: 'derived',
        spellcastingAbility: 'wisdom',
        spellcastingAbilityModifier: 0,
        spellcastingProficiencyBonus: 3,
        spellSaveDc: 15,
        spellLevel: 1,
        castAtLevel: 1,
        combatId: combat.id,
        turnSequence: 1,
        operationId: `ar-cast-${suffix}`,
        fingerprint: `ar-cast-fp-${suffix}`,
        createdBy: master.id,
      },
    });
    castIds.push(areaCast.id);
    const pendings = new Map<string, { id: string; targetId: string }>();
    for (const target of areaTargets) {
      const pending = await prisma.pendingEffectSave.create({
        data: {
          definitionId: spellDefinitionId(SYNTHETIC_AREA_SPELL_ID),
          spellCastId: areaCast.id,
          casterEntityKind: 'character',
          casterEntityId: caster.id,
          casterLabel: caster.name,
          targetEntityKind: target.kind,
          targetEntityId: target.id,
          ability: 'dexterity',
          dc: 15,
          visibility: 'public',
          status: 'pending',
          phase: 'initial',
          operationId: `${areaCast.id}:${target.kind}:${target.id}`,
          fingerprint: randomUUID(),
          createdBy: master.id,
        },
      });
      pendingIds.push(pending.id);
      pendings.set(`${target.kind}:${target.id}`, { id: pending.id, targetId: target.id });
    }
    check(
      '86.AD) UM SpellCast com os alvos DERIVADOS da área e N pendências (nunca N casts)',
      areaCast.targets !== null &&
        (await prisma.spellCast.count({ where: { id: areaCast.id } })) === 1 &&
        (await prisma.pendingEffectSave.count({ where: { spellCastId: areaCast.id } })) === 4,
      JSON.stringify({ targets: areaTargets.length }),
    );
    check(
      '86.AE) `SpellCast.targets` é o conjunto do servidor — não uma lista enviada pelo cliente',
      (areaCast.targets as unknown as { id: string }[]).map((item) => item.id).join(',') ===
        areaTargets.map((item) => item.id).join(','),
    );

    const cards = await request(`/combat/${combat.id}/resolution-requests`, tokenA);
    const areaCard = (cards.data?.requests ?? []).find(
      (item: any) => item.reference?.pendingId === pendings.get(keyOf(loadedA.entity))!.id,
    );
    check(
      '86.AF) cada afetado recebe o PRÓPRIO card de salvaguarda (sem revelar a lista)',
      cards.status === 200 &&
        areaCard?.kind === 'spell-saving-throw' &&
        !('dc' in (areaCard ?? {})),
      JSON.stringify(areaCard),
    );

    const nextTurnOf = async () =>
      request('/combat/next-turn', masterToken, {
        combatId: combat.id,
        expectedVersion: (await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } })).version,
        operationId: randomUUID(),
      });
    const turnBlocked = await nextTurnOf();
    check(
      '86.AG) saves INICIAIS de área bloqueiam o turno (`SPELL_RESOLUTION_PENDING`, distinto de fim de turno)',
      turnBlocked.status === 409 && turnBlocked.data?.error === 'SPELL_RESOLUTION_PENDING',
      JSON.stringify({ status: turnBlocked.status, error: turnBlocked.data?.error }),
    );

    const rollCounter = { n: 0 };
    const resolveOne = (key: string, total: number, values: number[]) => {
      let index = 0;
      return resolveSaveDamagePending(pendings.get(key)!.id, total, 'Smoke AR', {
        roll: () => {
          rollCounter.n += 1;
          return values[index++] ?? 1;
        },
      });
    };
    // A concentrava numa magia própria: o dano da área deve pedir o save DELE.
    const beforeCastA = await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } });
    await prisma.character.update({
      where: { id: targetA.id },
      data: {
        mechanicalState: {
          ...(beforeCastA.mechanicalState as Record<string, unknown>),
          concentration: {
            id: randomUUID(),
            label: 'Prova de área',
            sourceType: 'manual',
            visibility: 'public',
            startedAt: new Date().toISOString(),
            startedBy: master.id,
          },
        } as never,
      },
    });
    const first = await resolveOne(keyOf(loadedA.entity), 20, [4, 6]);
    check(
      '86.AH) BARREIRA: o primeiro save da área NÃO aplica dano e o cast continua `resolving`',
      first.castCompleted === false &&
        first.snapshot === null &&
        (await prisma.spellCast.findUniqueOrThrow({ where: { id: areaCast.id } })).status ===
          'resolving' &&
        (await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } })).hpCurrent === 40,
      JSON.stringify({ castCompleted: first.castCompleted }),
    );
    await resolveOne(keyOf(loadedB.entity), 5, []);
    await resolveOne(keyOf(loadedE.entity), 5, []);
    const last = await resolveOne(keyOf(loadedF.entity), 5, [5, 5]);
    const finalCast = await prisma.spellCast.findUniqueOrThrow({ where: { id: areaCast.id } });
    const snapshot = parseAreaTargetingSnapshot(finalCast.targetingSnapshot);
    const damageSnapshot = finalCast.resolutionSnapshot as any;
    check(
      '86.AI) último save finaliza: cast `resolved`/`effect` e snapshot com os 4 alvos derivados',
      finalCast.status === 'resolved' &&
        finalCast.outcome === 'effect' &&
        snapshot?.affected.length === 4 &&
        damageSnapshot?.targets?.length === 4,
      JSON.stringify({ status: finalCast.status, outcome: finalCast.outcome }),
    );
    check(
      '86.AJ) dano rolado UMA vez para a área: 2d6 uma única vez (nunca por alvo) e bruto igual para todos',
      rollCounter.n === 2 &&
        damageSnapshot?.damageRoll?.components?.[0]?.rolls?.length === 2 &&
        new Set(damageSnapshot?.targets?.map((item: any) => item.rawDamage)).size === 1,
      JSON.stringify({ rolls: rollCounter.n, raw: damageSnapshot?.targets?.[0]?.rawDamage }),
    );
    const hpOf = async (id: string) =>
      (await prisma.character.findUniqueOrThrow({ where: { id } })).hpCurrent;
    const damageOf = (id: string) =>
      damageSnapshot?.targets?.find((item: any) => item.target.id === id);
    check(
      '86.AK) consequências POR ALVO: resistência de A reduz só o dano de A; B/E/F seguem cheios',
      damageOf(targetA.id)?.save?.success === true &&
        damageOf(targetA.id)?.damageAfterSave === 5 &&
        damageOf(targetA.id)?.finalDamage === 2 &&
        damageOf(targetB.id)?.finalDamage === 10 &&
        (await hpOf(targetA.id)) === 38 &&
        (await hpOf(targetB.id)) === 30,
      JSON.stringify({
        a: damageOf(targetA.id),
        b: damageOf(targetB.id),
        hp: { a: await hpOf(targetA.id), b: await hpOf(targetB.id) },
      }),
    );
    const concentrationOfA = await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } });
    const concentrationOfB = await prisma.character.findUniqueOrThrow({ where: { id: targetB.id } });
    check(
      '86.AL) Concentração é INDIVIDUAL: só o alvo que concentrava recebe o teste (mesmo evento dele)',
      (concentrationOfA.mechanicalState as any)?.pendingConcentrationSaves?.length === 1 &&
        (concentrationOfA.mechanicalState as any)?.concentration?.label === 'Prova de área' &&
        ((concentrationOfB.mechanicalState as any)?.pendingConcentrationSaves ?? []).length === 0,
      JSON.stringify({
        a: (concentrationOfA.mechanicalState as any)?.pendingConcentrationSaves,
        b: (concentrationOfB.mechanicalState as any)?.pendingConcentrationSaves,
      }),
    );

    const turnAfter = await nextTurnOf();
    check(
      '86.AM) com todos os saves terminais a barreira libera o turno',
      turnAfter.status === 200,
      JSON.stringify({ status: turnAfter.status, error: turnAfter.data?.error }),
    );

    // Imutabilidade: mudar a cena depois do COMMIT não reescreve quem foi atingido.
    await prisma.character.update({ where: { id: targetC.id }, data: { name: 'AR C renomeado' } });
    await prisma.combatant.update({
      where: { id: npcCombatant.id },
      data: { hpCurrent: 1 },
    });
    const castLater = await prisma.spellCast.findUniqueOrThrow({ where: { id: areaCast.id } });
    const dto = toSpellCastDto(castLater);
    check(
      '86.AN) snapshot/targets são IMUTÁVEIS depois do COMMIT (mudar a cena não reescreve o cast)',
      (castLater.targets as unknown as { id: string }[])
        .map((item) => item.id)
        .join(',') === areaTargets.map((item) => item.id).join(',') &&
        dto.targeting?.targetCount === 4 &&
        dto.targeting?.validationMode === 'master-assisted',
      JSON.stringify({ targets: castLater.targets, dto: dto.targeting }),
    );

    // ZERO alvos: cast válido, sem pendências, fechado como `no-effect`.
    const zeroFacts = syntheticProvider();
    const zeroCast = await prisma.spellCast.create({
      data: {
        spellId: SYNTHETIC_AREA_SPELL_ID,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targets: [] as never,
        targetingSnapshot: mixed.snapshot as never,
        status: 'resolving',
        requiresConcentration: false,
        spellLevel: 1,
        castAtLevel: 1,
        combatId: combat.id,
        operationId: `ar-zero-${suffix}`,
        fingerprint: `ar-zero-fp-${suffix}`,
        createdBy: master.id,
      },
    });
    castIds.push(zeroCast.id);
    const zeroResult = await finalizeSaveDamageCast(zeroCast.id, prisma);
    const zeroAfter = await prisma.spellCast.findUniqueOrThrow({ where: { id: zeroCast.id } });
    check(
      '86.AO) área sem ninguém dentro é CAST VÁLIDO: zero pendências, `resolved`/`no-effect`, custos não voltam',
      zeroResult.completed &&
        zeroAfter.status === 'resolved' &&
        zeroAfter.outcome === 'no-effect' &&
        (await prisma.pendingEffectSave.count({ where: { spellCastId: zeroCast.id } })) === 0 &&
        zeroFacts !== null,
      JSON.stringify({ status: zeroAfter.status, outcome: zeroAfter.outcome }),
    );

    // =====================================================================
    // G — CONTRATO HTTP: O CLIENTE NÃO É AUTORIDADE
    // =====================================================================
    const baseCast = {
      operationId: `ar-http-${suffix}`,
      spellId: 'sacred-flame',
      caster: { kind: 'character', id: caster.id },
      targets: [],
    };
    const rejected = async (extra: Record<string, unknown>) =>
      (await request('/spells/cast-proof', masterToken, { ...baseCast, ...extra })).status;
    const statusOf = async (extra: Record<string, unknown>) => {
      const response = await request('/spells/cast-proof', masterToken, { ...baseCast, ...extra });
      return { status: response.status, error: response.data?.error };
    };
    const radiusAttempt = await statusOf({ radiusFeet: 1000 });
    const targetsAttempt = await statusOf({
      targets: [{ kind: 'character', id: targetC.id }],
      areaPlacement: { requestedOrigin: { kind: 'self' } },
    });
    const affectedAttempt = await statusOf({
      affectedTargetIds: [targetA.id, targetB.id],
      areaPlacement: { requestedOrigin: { kind: 'self' } },
    });
    const shapeAttempt = await statusOf({
      areaPlacement: { requestedOrigin: { kind: 'self' }, shape: { kind: 'cone', lengthFeet: 60 } },
    });
    check(
      '86.AP) cliente não envia raio, forma nem lista de atingidos (schema estrito, 400)',
      radiusAttempt.status === 400 &&
        affectedAttempt.status === 400 &&
        shapeAttempt.status === 400 &&
        (await rejected({ spatialResult: { inside: true } })) === 400,
      JSON.stringify({ radius: radiusAttempt, affected: affectedAttempt, shape: shapeAttempt }),
    );
    const syntheticcast = await request('/spells/cast', masterToken, {
      operationId: `ar-http-syn-${suffix}`,
      spellId: SYNTHETIC_AREA_SPELL_ID,
      caster: { kind: 'character', id: caster.id },
      targets: [],
      areaPlacement: { requestedOrigin: { kind: 'self' } },
    });
    check(
      '86.AQ) a definição sintética NÃO é conjurável por rota de produção (não está no catálogo)',
      syntheticcast.status === 404 && syntheticcast.data?.error === 'SPELL_NOT_FOUND',
      JSON.stringify(syntheticcast.data?.error),
    );
    check(
      '86.AR) área não declara `maxTargets`: não existe limite inventado nem contagem do cliente',
      !('maxTargets' in mixed.snapshot) &&
        mixed.snapshot.affected.length !== 3 &&
        targetsAttempt.status >= 400,
      JSON.stringify({
        maxTargets: 'maxTargets' in mixed.snapshot,
        affected: mixed.snapshot.affected.length,
        targets: targetsAttempt,
      }),
    );

    // Garantia de que o snapshot persistido continua válido no Zod.
    check(
      '86.AS) snapshot de área é revalidado por Zod na leitura (nunca `as`)',
      areaTargetingSnapshotSchema.safeParse(mixed.snapshot).success &&
        areaTargetingSnapshotSchema.safeParse({ kind: 'area' }).success === false &&
        areaTargetingSnapshotSchema.safeParse({ kind: 'area', shape: { kind: 'emanation' } })
          .success === false,
    );
  } finally {
    // =====================================================================
    // LIMPEZA — somente IDs criados por ESTE smoke
    // =====================================================================
    await prisma.pendingEffectSave.deleteMany({ where: { id: { in: pendingIds } } });
    await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
    await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
    await prisma.spellCastIntent.deleteMany({ where: { id: { in: intentIds } } });
    await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
