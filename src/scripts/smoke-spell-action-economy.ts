import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { economyOf } from '../modules/shared/action-economy.js';
import {
  assertCastingEconomy,
  bonusActionSpellViolation,
  castingEconomyFor,
  committedCastsOnTurn,
  type CastingTurnContext,
  type PriorSpellCast,
} from '../modules/spells/execution/spell-casting-economy.js';
import { pickCastingResource, withSpatialEvidence } from './spell-slot-fixtures.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/** Economia de turno para fixtures (mesmo shape de `TurnEconomy`). */
function economy(grants: number, used: number) {
  return {
    actionsGranted: grants,
    actionsUsed: used,
    bonusActionUsed: false,
    reactionAvailable: true,
    movementBudget: 9,
    movementUsed: 0,
  };
}

/**
 * FASE 6.6D — CASTING TIME & ACTION ECONOMY.
 *
 * Prova que a conjuração respeita o TURNO REAL do combate: `Combat.turnSequence`
 * identifica a ativação, a Ação é consumida no COMMIT (mesma transação do slot),
 * e a restrição da spell de Ação Bônus é derivada do histórico de SpellCasts,
 * nunca de "uma magia de nível por turno".
 */
export async function smokeSpellActionEconomy(baseUrl: string, check: Check): Promise<void> {
  console.log('\n76.6) Fase 6.6D — Casting time e Action Economy');

  // =====================================================================
  // A — casting time → custo (puro)
  // =====================================================================
  let longRejected = '';
  try {
    castingEconomyFor('minute');
  } catch (error) {
    longRejected = (error as { code?: string }).code ?? '';
  }
  check(
    '76.6.A) casting time traduz para a economia existente e 1 minuto/hora NÃO vira 1 Ação',
    castingEconomyFor('action') === 'action' &&
      castingEconomyFor('bonusAction') === 'bonus-action' &&
      castingEconomyFor('reaction') === 'reaction' &&
      longRejected === 'SPELL_CASTING_TIME_NOT_IMPLEMENTED',
    longRejected,
  );

  // =====================================================================
  // B — matriz da regra de Bonus Action (PHB 2014, pura)
  // =====================================================================
  const actionCantrip: PriorSpellCast = { spellLevel: 0, castingTime: 'action' };
  const actionLeveled: PriorSpellCast = { spellLevel: 2, castingTime: 'action' };
  const bonusLeveled: PriorSpellCast = { spellLevel: 1, castingTime: 'bonus-action' };
  const reactionLeveled: PriorSpellCast = { spellLevel: 1, castingTime: 'reaction' };
  const blocked = (prior: PriorSpellCast[], candidate: PriorSpellCast) =>
    bonusActionSpellViolation(prior, candidate) === 'BONUS_ACTION_SPELL_RESTRICTION';
  check(
    '76.6.B) matriz BA: sem prior e action cantrip permitem; action leveled/reaction bloqueiam',
    bonusActionSpellViolation([], bonusLeveled) === null &&
      bonusActionSpellViolation([actionCantrip], bonusLeveled) === null &&
      blocked([actionLeveled], bonusLeveled) &&
      blocked([reactionLeveled], bonusLeveled) &&
      blocked([bonusLeveled], bonusLeveled),
    JSON.stringify({
      none: bonusActionSpellViolation([], bonusLeveled),
      cantrip: bonusActionSpellViolation([actionCantrip], bonusLeveled),
    }),
  );
  check(
    '76.6.C) DEPOIS de BA spell só Action cantrip passa; Action leveled e Reaction NÃO; Action Surge não libera leveled',
    bonusActionSpellViolation([bonusLeveled], actionCantrip) === null &&
      blocked([bonusLeveled], actionLeveled) &&
      blocked([bonusLeveled], reactionLeveled) &&
      // Sem BA spell, duas Action leveled são permitidas (não existe "1 spell de nível/turno").
      bonusActionSpellViolation([actionLeveled], actionLeveled) === null &&
      bonusActionSpellViolation([reactionLeveled], actionLeveled) === null,
    '',
  );
  const fakeContext: CastingTurnContext = {
    combatId: 'c',
    combatantId: 'x',
    combatantVersion: 0,
    turnSequence: 1,
    activeCombatantId: 'x',
    isCasterTurn: true,
    actionsGranted: 1,
    actionsUsed: 0,
    bonusActionUsed: false,
    reactionAvailable: true,
  };
  const reactionCode = (() => {
    try {
      assertCastingEconomy(null, 'reaction', [], reactionLeveled);
      return '';
    } catch (error) {
      return (error as { code?: string }).code ?? '';
    }
  })();
  const reactionInCombat = (() => {
    try {
      assertCastingEconomy(fakeContext, 'reaction', [], reactionLeveled);
      return '';
    } catch (error) {
      return (error as { code?: string }).code ?? '';
    }
  })();
  check(
    '76.6.D) Reaction sem opportunity server-authoritative é recusada (dentro e fora de combate)',
    reactionCode === 'SPELL_REACTION_NOT_AVAILABLE' &&
      reactionInCombat === 'SPELL_REACTION_NOT_AVAILABLE',
    `${reactionCode}/${reactionInCombat}`,
  );

  // =====================================================================
  // HTTP — fixtures de combate
  // =====================================================================
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const combatIds: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `ae_m_${suffix}`, displayName: 'Mestre Ação', passwordHash: 'fixture', role: 'MASTER' },
    });
    const casterUser = await prisma.user.create({
      data: { username: `ae_c_${suffix}`, displayName: 'Caster Ação', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const targetUser = await prisma.user.create({
      data: { username: `ae_t_${suffix}`, displayName: 'Alvo Ação', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const outUser = await prisma.user.create({
      data: { username: `ae_o_${suffix}`, displayName: 'Fora Combate', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, casterUser.id, targetUser.id, outUser.id);
    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });

    const caster = await prisma.character.create({
      data: {
        userId: casterUser.id,
        name: 'Caster Ação',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        wisdom: 10,
        classes: [{ classKey: 'wizard', subclass: '', level: 5 }],
      },
    });
    const target = await prisma.character.create({
      data: { userId: targetUser.id, name: 'Alvo Ação', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    const outCaster = await prisma.character.create({
      data: {
        userId: outUser.id,
        name: 'Fora Combate',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        intelligence: 16,
        classes: [{ classKey: 'wizard', subclass: '', level: 5 }],
      },
    });
    characterIds.push(caster.id, target.id, outCaster.id);

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
              ownerUserId: casterUser.id,
              name: caster.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 2,
              turnEconomy: economy(1, 0) as never,
            },
            {
              kind: 'CHARACTER',
              characterId: target.id,
              ownerUserId: targetUser.id,
              name: target.name,
              initiative: 5,
              initiativeRoll: 5,
              dexterityMod: 0,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);
    const casterCombatant = combat.combatants.find((item) => item.characterId === caster.id)!;
    const targetCombatant = combat.combatants.find((item) => item.characterId === target.id)!;
    const casterEntity = { kind: 'combatant' as const, id: casterCombatant.id };
    const targetEntity = { kind: 'combatant' as const, id: targetCombatant.id };

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(withSpatialEvidence(path, body)) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    const economyOfCombatant = async (id: string) =>
      economyOf((await prisma.combatant.findUniqueOrThrow({ where: { id } })).turnEconomy);
    const setEconomy = async (id: string, value: ReturnType<typeof economy>) => {
      await prisma.combatant.update({
        where: { id },
        data: { turnEconomy: value as never, mechanicalVersion: { increment: 1 } },
      });
    };
    const slotsUsed = async (characterId: string) => {
      const row = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
      return ((row.spells as { slotsUsed?: Record<string, number> }).slotsUsed ?? {}) as Record<string, number>;
    };

    // =====================================================================
    // C — Action gasta no COMMIT, snapshot de turno e retry
    // =====================================================================
    const slot1 = await pickCastingResource(baseUrl, masterToken, casterEntity, 1);
    const opBless = randomUUID();
    const bless = await request('/effects/bless', {
      operationId: opBless,
      caster: casterEntity,
      targets: [targetEntity],
      ...(slot1 ? { castingResource: slot1 } : {}),
    });
    const afterBlessEconomy = await economyOfCombatant(casterCombatant.id);
    const blessCast = await prisma.spellCast.findUnique({ where: { operationId: opBless } });
    const retryBless = await request('/effects/bless', {
      operationId: opBless,
      caster: casterEntity,
      targets: [targetEntity],
      ...(slot1 ? { castingResource: slot1 } : {}),
    });
    const afterRetryEconomy = await economyOfCombatant(casterCombatant.id);
    check(
      '76.6.E) Bless no próprio turno gasta UMA Ação e o espaço, e grava casting time + combatId/turnSequence',
      bless.status === 201 &&
        afterBlessEconomy.actionsUsed === 1 &&
        blessCast?.castingTimeKind === 'action' &&
        blessCast?.economyCostKind === 'action' &&
        blessCast?.combatId === combat.id &&
        blessCast?.turnSequence === 1 &&
        blessCast?.combatantId === casterCombatant.id &&
        blessCast?.economySpentAt !== null &&
        retryBless.status === 200 &&
        afterRetryEconomy.actionsUsed === 1,
      JSON.stringify({ status: bless.status, economy: afterBlessEconomy, cast: blessCast }),
    );

    // =====================================================================
    // D — sem Ação, alvo inválido e fora do turno NÃO gastam nada
    // =====================================================================
    const slotsBeforeInvalid = await slotsUsed(caster.id);
    const holdSlot = await pickCastingResource(baseUrl, masterToken, casterEntity, 2);
    const noAction = await request('/effects/hold-person', {
      operationId: randomUUID(),
      caster: casterEntity,
      target: targetEntity,
      ...(holdSlot ? { castingResource: holdSlot } : {}),
    });
    const beast = await prisma.creature.create({
      data: { name: 'Besta Ação', kind: 'CREATURE', type: 'Besta', hpCurrent: 10, hpMax: 10, speed: 12 },
    });
    await setEconomy(casterCombatant.id, economy(1, 0));
    const invalidTarget = await request('/effects/hold-person', {
      operationId: randomUUID(),
      caster: casterEntity,
      target: { kind: 'creature', id: beast.id },
      ...(holdSlot ? { castingResource: holdSlot } : {}),
    });
    const economyAfterInvalid = await economyOfCombatant(casterCombatant.id);
    const slotsAfterInvalid = await slotsUsed(caster.id);
    check(
      '76.6.F) Ação já usada → SPELL_ACTION_UNAVAILABLE; alvo não humanoide é rejeitado ANTES do COMMIT (Ação e espaço intactos)',
      noAction.status === 409 &&
        noAction.data.error === 'SPELL_ACTION_UNAVAILABLE' &&
        invalidTarget.status === 409 &&
        invalidTarget.data.error === 'SPELL_TARGET_TYPE_INVALID' &&
        economyAfterInvalid.actionsUsed === 0 &&
        JSON.stringify(slotsBeforeInvalid) === JSON.stringify(slotsAfterInvalid),
      JSON.stringify({ noAction: noAction.data, invalid: invalidTarget.data, economy: economyAfterInvalid }),
    );

    // =====================================================================
    // E — fora do turno (o combate está no turno do ALVO)
    // =====================================================================
    await prisma.combat.update({ where: { id: combat.id }, data: { currentIndex: 1 } });
    const outOfTurn = await request('/effects/hold-person', {
      operationId: randomUUID(),
      caster: casterEntity,
      target: targetEntity,
      ...(holdSlot ? { castingResource: holdSlot } : {}),
    });
    const economyOutOfTurn = await economyOfCombatant(casterCombatant.id);
    check(
      '76.6.G) Action spell fora do turno do conjurador → SPELL_CAST_OUT_OF_TURN, sem consumir Ação/espaço',
      outOfTurn.status === 409 &&
        outOfTurn.data.error === 'SPELL_CAST_OUT_OF_TURN' &&
        economyOutOfTurn.actionsUsed === 0,
      JSON.stringify({ status: outOfTurn.status, error: outOfTurn.data.error }),
    );
    await prisma.combat.update({ where: { id: combat.id }, data: { currentIndex: 0 } });

    // =====================================================================
    // F — Action extra (Action Surge): com 2 Ações e 1 usada, conjura
    // =====================================================================
    await setEconomy(casterCombatant.id, economy(2, 1));
    const slot2 = await pickCastingResource(baseUrl, masterToken, casterEntity, 1);
    const extraAction = await request('/effects/bless', {
      operationId: randomUUID(),
      caster: casterEntity,
      targets: [targetEntity],
      ...(slot2 ? { castingResource: slot2 } : {}),
    });
    const economyExtra = await economyOfCombatant(casterCombatant.id);
    check(
      '76.6.H) com 2 Ações concedidas e 1 já usada a conjuração é permitida (actionsUsed 2)',
      extraAction.status === 201 && economyExtra.actionsUsed === 2,
      JSON.stringify({ status: extraAction.status, economy: economyExtra }),
    );

    // =====================================================================
    // G — corrida pela ÚNICA Ação
    // =====================================================================
    await setEconomy(casterCombatant.id, economy(1, 0));
    const slotRace = await pickCastingResource(baseUrl, masterToken, casterEntity, 1);
    const raceStatuses = await Promise.all([
      request('/effects/bless', {
        operationId: randomUUID(),
        caster: casterEntity,
        targets: [targetEntity],
        ...(slotRace ? { castingResource: slotRace } : {}),
      }),
      request('/effects/bless', {
        operationId: randomUUID(),
        caster: casterEntity,
        targets: [targetEntity],
        ...(slotRace ? { castingResource: slotRace } : {}),
      }),
    ]);
    const economyRace = await economyOfCombatant(casterCombatant.id);
    const raceCodes = raceStatuses.map((item) => item.status).sort();
    check(
      '76.6.I) dois casts simultâneos com UMA Ação: um vence, o outro recebe 409 e actionsUsed nunca passa do limite',
      raceCodes.join(',') === '201,409' &&
        economyRace.actionsUsed === 1 &&
        economyRace.actionsUsed <= economyRace.actionsGranted,
      JSON.stringify({ statuses: raceCodes, economy: economyRace }),
    );

    // =====================================================================
    // H — fora de combate: casting time continua no snapshot, sem economia
    // =====================================================================
    const outSlot = await pickCastingResource(baseUrl, masterToken, { kind: 'character', id: outCaster.id }, 1);
    const opOut = randomUUID();
    const outCast = await request('/effects/bless', {
      operationId: opOut,
      caster: { kind: 'character', id: outCaster.id },
      targets: [{ kind: 'character', id: target.id }],
      ...(outSlot ? { castingResource: outSlot } : {}),
    });
    const outRow = await prisma.spellCast.findUnique({ where: { operationId: opOut } });
    check(
      '76.6.J) fora de combate não há Action Economy: cast resolve e o snapshot fica com combatId/turnSequence nulos',
      outCast.status === 201 &&
        outRow?.castingTimeKind === 'action' &&
        outRow?.combatId === null &&
        outRow?.turnSequence === null &&
        outRow?.economyCostKind === null &&
        outRow?.economySpentAt === null,
      JSON.stringify({ status: outCast.status, cast: outRow }),
    );

    // =====================================================================
    // I — turnSequence monotônico e como fonte do histórico do turno
    // =====================================================================
    const beforeNext = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    const next = await request('/combat/next-turn', {
      combatId: combat.id,
      expectedVersion: beforeNext.version,
      operationId: randomUUID(),
    });
    const afterNext = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    const priorOnTurn1 = await committedCastsOnTurn(prisma, {
      combatId: combat.id,
      turnSequence: 1,
      combatantId: casterCombatant.id,
    });
    const priorOnTurn2 = await committedCastsOnTurn(prisma, {
      combatId: combat.id,
      turnSequence: afterNext.turnSequence,
      combatantId: casterCombatant.id,
    });
    const afterTurnChange = await request('/effects/bless', {
      operationId: randomUUID(),
      caster: casterEntity,
      targets: [targetEntity],
      ...(slotRace ? { castingResource: slotRace } : {}),
    });
    check(
      '76.6.K) next-turn incrementa turnSequence UMA vez (2) e o histórico é por turno: turno 1 tem casts, turno do alvo bloqueia',
      next.status === 200 &&
        afterNext.turnSequence === 2 &&
        priorOnTurn1.length >= 1 &&
        priorOnTurn2.length === 0 &&
        afterTurnChange.status === 409 &&
        afterTurnChange.data.error === 'SPELL_CAST_OUT_OF_TURN',
      JSON.stringify({
        turnSequence: afterNext.turnSequence,
        turn1: priorOnTurn1,
        turn2: priorOnTurn2,
        cast: afterTurnChange.data.error,
      }),
    );

    // =====================================================================
    // J — FAILED/NO-EFFECT: tentativa inválida não entra; no-effect conta
    // =====================================================================
    const failedCasts = await prisma.spellCast.count({
      where: { combatId: combat.id, casterEntityId: beast.id },
    });
    check(
      '76.6.L) tentativa rejeitada (não humanoide) NÃO vira SpellCast e não entra no histórico do turno',
      failedCasts === 0 &&
        priorOnTurn1.every((item) => item.castingTime === 'action'),
      JSON.stringify({ failedCasts, priorOnTurn1 }),
    );
  } finally {
    await prisma.effectInstance.deleteMany({
      where: { OR: [{ targetEntityId: { in: characterIds } }, { sourceEntityId: { in: characterIds } }] },
    });
    await prisma.pendingEffectSave.deleteMany({ where: { targetEntityId: { in: characterIds } } });
    await prisma.spellCast.deleteMany({ where: { casterEntityId: { in: characterIds } } });
    await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.creature.deleteMany({ where: { name: 'Besta Ação' } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
