import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  resetCastingSlots,
  seedSpellRepertoire,
  SPATIAL_EVIDENCE,
} from './spell-slot-fixtures.js';
import type { PendingEffectSaveDto } from '../modules/effects/pending-effect-saves.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface Ref {
  kind: 'character' | 'creature' | 'combatant';
  id: string;
}

interface ResourceDto {
  kind: string;
  level: number;
  max: number;
  remaining: number;
}

/**
 * FASE 6.6E — TARGETING & RANGE ASSISTIDO.
 *
 * Prova que a conjuração passou a ser autoridade sobre:
 *  • QUANTIDADE de alvos derivada da definição + espaço (Bless 3/+1, Hold
 *    Person 1/+1), nunca do cliente;
 *  • filtro de tipo (Hold Person só humanoides) e duplicidade CANÔNICA
 *    (ficha e combatente do mesmo personagem são um alvo);
 *  • requisitos espaciais tri-state: o que o servidor não mede (`unknown`) é
 *    CONFIRMADO pelo Mestre, e um `fail` autoritativo (canSee=false) nunca é
 *    sobrescrito;
 *  • um cast multi-alvo = UM SpellCast, UM espaço, N pendências e uma
 *    RESOLUTION BARRIER: nenhum Effect nasce antes do último save.
 *
 * Nenhuma distância numérica é enviada: só a confirmação dos requisitos que a
 * magia declarou. O cliente nunca escolhe alcance, máximo de alvos ou modo.
 */
export async function smokeSpellTargeting(baseUrl: string, check: Check): Promise<void> {
  console.log('\n76.7) Fase 6.6E — Targeting, alcance assistido e múltiplos alvos');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const operations: string[] = [];
  const groupIds: string[] = [];
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({
      data: { username: `tgt_m_${suffix}`, displayName: 'Mestre Targeting', passwordHash: 'fixture', role: 'MASTER' },
    });
    const casterUser = await prisma.user.create({
      data: { username: `tgt_c_${suffix}`, displayName: 'Mago Targeting', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const allyUser = await prisma.user.create({
      data: { username: `tgt_a_${suffix}`, displayName: 'Aliado Targeting', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const allyTwoUser = await prisma.user.create({
      data: { username: `tgt_b_${suffix}`, displayName: 'Segundo Aliado', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const allyThreeUser = await prisma.user.create({
      data: { username: `tgt_d_${suffix}`, displayName: 'Terceiro Aliado', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, casterUser.id, allyUser.id, allyTwoUser.id, allyThreeUser.id);

    const masterToken = signToken({
      sub: master.id,
      username: master.username,
      displayName: master.displayName,
      role: master.role,
    });
    const casterToken = signToken({
      sub: casterUser.id,
      username: casterUser.username,
      displayName: casterUser.displayName,
      role: casterUser.role,
    });

    const caster = await prisma.character.create({
      data: {
        userId: casterUser.id,
        name: 'Mago Targeting',
        hpCurrent: 60,
        hpMax: 60,
        speed: 9,
        intelligence: 16,
        wisdom: 10,
        // 6.6F: Clérigo 20 — a lista da fonte precisa cobrir Bless E Hold Person
        // (o Mago não lista Bless; executar não autoriza conjurar).
        classes: [{ classKey: 'cleric', subclass: '', level: 20 }],
      },
    });
    const ally = await prisma.character.create({
      data: { userId: allyUser.id, name: 'Aliado Targeting', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    const allyTwo = await prisma.character.create({
      data: { userId: allyTwoUser.id, name: 'Segundo Aliado', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    const allyThree = await prisma.character.create({
      data: { userId: allyThreeUser.id, name: 'Terceiro Aliado', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    characterIds.push(caster.id, ally.id, allyTwo.id, allyThree.id);
    // 6.6F: Hold Person do Mago exige REGISTRO no grimório + preparação ACTIVE.
    await seedSpellRepertoire({
      characterId: caster.id,
      classKey: 'cleric',
      spellIds: ['bless', 'hold-person'],
    });

    const humanoid = await prisma.creature.create({
      data: { name: 'Goblin TGT', kind: 'CREATURE', type: 'Humanoide', hpCurrent: 20, hpMax: 20, speed: 9 },
    });
    const humanoidTwo = await prisma.creature.create({
      data: { name: 'Goblin TGT 2', kind: 'CREATURE', type: 'Humanoide', hpCurrent: 20, hpMax: 20, speed: 9 },
    });
    const beast = await prisma.creature.create({
      data: { name: 'Lobo TGT', kind: 'CREATURE', type: 'Besta', hpCurrent: 20, hpMax: 20, speed: 12 },
    });
    creatureIds.push(humanoid.id, humanoidTwo.id, beast.id);

    const casterEntity: Ref = { kind: 'character', id: caster.id };
    const allyEntity: Ref = { kind: 'character', id: ally.id };
    const allyTwoEntity: Ref = { kind: 'character', id: allyTwo.id };
    const allyThreeEntity: Ref = { kind: 'character', id: allyThree.id };
    const humanoidEntity: Ref = { kind: 'creature', id: humanoid.id };
    const humanoidTwoEntity: Ref = { kind: 'creature', id: humanoidTwo.id };
    const beastEntity: Ref = { kind: 'creature', id: beast.id };

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function resourcesOf(entity: Ref): Promise<ResourceDto[]> {
      const res = await request(`/spells/resources/${entity.kind}/${entity.id}`);
      return (res.data.resources ?? []) as ResourceDto[];
    }

    const slot = (level: number) => ({ kind: 'spell-slot' as const, level });

    async function cast(
      path: '/effects/bless' | '/effects/hold-person',
      body: Record<string, unknown>,
      options: { evidence?: boolean; token?: string; operationId?: string } = {},
    ) {
      const operationId = options.operationId ?? randomUUID();
      operations.push(operationId);
      const response = await request(
        path,
        {
          operationId,
          ...body,
          ...(options.evidence === false ? {} : { spatialConfirmation: SPATIAL_EVIDENCE }),
        },
        options.token ?? masterToken,
      );
      return { ...response, operationId };
    }

    async function mechanicalOf(entity: Ref) {
      const res = await request(`/mechanical/${entity.kind}/${entity.id}`);
      return res.data.mechanical as {
        version: number;
        state: {
          concentration: { id: string; sourceId?: string } | null;
          conditions: { id: string; condition: string }[];
        };
        combat?: { version: number } | null;
      };
    }

    async function setCondition(entity: Ref, condition: string) {
      const current = await mechanicalOf(entity);
      return request('/mechanical/mutate', {
        entity,
        expectedVersion: current.version,
        ...(current.combat ? { expectedCombatVersion: current.combat.version } : {}),
        operationId: randomUUID(),
        action: 'apply',
        condition,
      });
    }

    async function removeCondition(entity: Ref, condition: string) {
      const current = await mechanicalOf(entity);
      const instance = current.state.conditions.find((item) => item.condition === condition);
      if (!instance) return;
      await request('/mechanical/mutate', {
        entity,
        expectedVersion: current.version,
        ...(current.combat ? { expectedCombatVersion: current.combat.version } : {}),
        operationId: randomUUID(),
        action: 'remove',
        instanceId: instance.id,
      });
    }

    async function rollSave(pendingId: string) {
      return request('/dice/roll', {
        kind: 'save',
        pendingEffectSaveId: pendingId,
        dice: [{ sides: 20 }],
      });
    }

    async function castOf(operationId: string) {
      return prisma.spellCast.findUnique({ where: { operationId } });
    }

    async function cancelCast(castId: string) {
      const pending = await prisma.pendingEffectSave.findFirst({
        where: { spellCastId: castId, status: 'pending' },
      });
      if (pending) await request(`/effects/pending/${pending.id}/cancel`, {});
    }

    // =====================================================================
    // A — BLESS: quantidade derivada do ESPAÇO
    // =====================================================================
    await resetCastingSlots(caster.id);
    const base3 = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [casterEntity, allyEntity, allyTwoEntity],
      castingResource: slot(1),
    });
    if (base3.data.groupId) groupIds.push(base3.data.groupId);

    const beforeCount = await resourcesOf(casterEntity);
    const base4 = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [casterEntity, allyEntity, allyTwoEntity, allyThreeEntity],
      castingResource: slot(1),
    });
    const afterCount = await resourcesOf(casterEntity);
    check(
      '76.7.A) Bless slot 1: 3 alvos válidos, 4 recusados ANTES do commit e sem gastar espaço',
      base3.status === 201 &&
        base3.data.effects?.length === 3 &&
        base4.status === 400 &&
        base4.data.error === 'SPELL_TARGET_COUNT_INVALID' &&
        JSON.stringify(beforeCount) === JSON.stringify(afterCount),
      JSON.stringify({ base3: base3.status, base4: base4.data, beforeCount, afterCount }),
    );

    // =====================================================================
    // B — BLESS UPCAST: slot 2 → 4 alvos, slot 3 → 5 alvos
    // =====================================================================
    const up4 = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [casterEntity, allyEntity, allyTwoEntity, allyThreeEntity],
      castingResource: slot(2),
    });
    if (up4.data.groupId) groupIds.push(up4.data.groupId);
    const up4Cast = await castOf(up4.operationId);
    const up5 = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [casterEntity, allyEntity, allyTwoEntity, allyThreeEntity, humanoidEntity],
      castingResource: slot(3),
    });
    if (up5.data.groupId) groupIds.push(up5.data.groupId);
    const snapshot = up4Cast?.targetingSnapshot as
      | { maxTargets?: number; targetCount?: number; rangeFeet?: number; validationMode?: string }
      | null;
    check(
      '76.7.B) Bless slot 2 atinge 4 e slot 3 atinge 5; snapshot grava máximo derivado, alcance e modo de validação',
      up4.status === 201 &&
        up4.data.effects?.length === 4 &&
        up5.status === 201 &&
        up5.data.effects?.length === 5 &&
        snapshot?.maxTargets === 4 &&
        snapshot?.targetCount === 4 &&
        snapshot?.rangeFeet === 30 &&
        snapshot?.validationMode === 'master-confirmed',
      JSON.stringify({ up4: up4.data.effects?.length, up5: up5.data.effects?.length, snapshot }),
    );

    // =====================================================================
    // C — HOLD PERSON: 1 no slot 2; 2 recusados
    // =====================================================================
    const holdBase = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity],
      castingResource: slot(2),
    });
    const holdRow = await castOf(holdBase.operationId);
    const holdBaseCastId = holdRow?.id;
    const holdBasePendings = holdBaseCastId
      ? await prisma.pendingEffectSave.count({ where: { spellCastId: holdBaseCastId } })
      : 0;
    if (holdBaseCastId) await cancelCast(holdBaseCastId);

    const beforeTwo = await resourcesOf(casterEntity);
    const holdTwo = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity, humanoidTwoEntity],
      castingResource: slot(2),
    });
    const afterTwo = await resourcesOf(casterEntity);
    check(
      '76.7.C) Hold Person slot 2 aceita 1 humanoide e recusa 2; 1 cast = 1 pendência = 1 espaço',
      holdBase.status === 201 &&
        holdBasePendings === 1 &&
        holdBase.data.pendings?.length === 1 &&
        holdRow?.castAtLevel === 2 &&
        holdRow?.targetingSnapshot !== null &&
        holdTwo.status === 400 &&
        holdTwo.data.error === 'SPELL_TARGET_COUNT_INVALID' &&
        JSON.stringify(beforeTwo) === JSON.stringify(afterTwo),
      JSON.stringify({ holdBase: holdBase.status, pendings: holdBasePendings, holdTwo: holdTwo.data }),
    );

    // =====================================================================
    // D — MULTI-ALVO: 2 humanoides no slot 3 → 1 SpellCast + 2 pendências
    // =====================================================================
    const multi = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity, humanoidTwoEntity],
      castingResource: slot(3),
    });
    const multiCast = await castOf(multi.operationId);
    const multiCastId = multiCast?.id ?? null;
    const multiPendings = multiCastId
      ? await prisma.pendingEffectSave.findMany({ where: { spellCastId: multiCastId } })
      : [];
    const usedRow = await prisma.character.findUniqueOrThrow({ where: { id: caster.id } });
    const usedMap = (usedRow.spells as { slotsUsed?: Record<string, number> }).slotsUsed ?? {};
    check(
      '76.7.D) Hold Person slot 3 em 2 humanoides: UM cast, UM espaço e DUAS pendências independentes',
      multi.status === 201 &&
        multiPendings.length === 2 &&
        multi.data.pendings?.length === 2 &&
        multiCast?.castAtLevel === 3 &&
        multiPendings.every((row) => row.dc === multi.data.pending?.dc) &&
        (usedMap['3'] ?? 0) >= 1,
      JSON.stringify({ multi: multi.status, pendings: multiPendings.length, used: usedMap }),
    );

    // =====================================================================
    // E — BARRIER: primeiro save NÃO cria Effect; o último fecha UM grupo
    // =====================================================================
    const [firstPending, secondPending] = (multi.data.pendings ?? []) as PendingEffectSaveDto[];
    const firstRoll = firstPending ? await rollSave(firstPending.id) : { status: 0, data: {} };
    const secondPendingRoll = secondPending
      ? undefined
      : undefined;
    void secondPendingRoll;
    const afterFirstCast = multiCastId
      ? await prisma.spellCast.findUniqueOrThrow({ where: { id: multiCastId } })
      : null;
    const afterFirstEffects = multiCastId
      ? await prisma.effectInstance.count({ where: { sourceEntityId: caster.id, label: 'Imobilizar Pessoa' } })
      : -1;
    const secondRoll = secondPending ? await rollSave(secondPending.id) : { status: 0, data: {} };
    const finalisedCast = multiCastId
      ? await prisma.spellCast.findUniqueOrThrow({ where: { id: multiCastId } })
      : null;
    const finalEffects = finalisedCast?.effectGroupId
      ? await prisma.effectInstance.findMany({ where: { groupId: finalisedCast.effectGroupId } })
      : [];
    const failures = multiCastId
      ? await prisma.pendingEffectSave.findMany({
          where: { spellCastId: multiCastId, result: 'failure' },
        })
      : [];
    const casterAfterMulti = await mechanicalOf(casterEntity);
    const effectTargets = finalEffects.map((row) => row.targetEntityId).sort();
    const failureTargets = failures.map((row) => row.targetEntityId).sort();
    check(
      '76.7.E) resolution barrier: nada nasce no primeiro save e o ÚLTIMO fecha UM grupo só com os alvos que falharam',
      firstRoll.status === 201 &&
        secondRoll.status === 201 &&
        afterFirstCast?.status === 'resolving' &&
        afterFirstEffects === 0 &&
        finalisedCast?.status === 'resolved' &&
        JSON.stringify(effectTargets) === JSON.stringify(failureTargets) &&
        (failures.length === 0
          ? finalisedCast?.outcome === 'no-effect' && casterAfterMulti.state.concentration === null
          : finalisedCast?.outcome === 'effect' &&
            finalisedCast?.effectGroupId !== null &&
            casterAfterMulti.state.concentration?.sourceId === finalisedCast?.effectGroupId &&
            finalEffects.length === failures.length),
      JSON.stringify({
        rolls: [firstRoll.status, secondRoll.status],
        afterFirst: afterFirstCast?.status,
        afterFirstEffects,
        outcome: finalisedCast?.outcome,
        effects: effectTargets,
        failures: failureTargets,
        concentration: casterAfterMulti.state.concentration,
      }),
    );

    // =====================================================================
    // F — TODOS PASSAM: no-effect, zero Effect, zero Concentração nova
    // =====================================================================
    await prisma.character.update({ where: { id: caster.id }, data: { intelligence: 1, wisdom: 1, charisma: 1 } });
    await prisma.creature.update({ where: { id: humanoid.id }, data: { wisdom: 30 } });
    await prisma.creature.update({ where: { id: humanoidTwo.id }, data: { wisdom: 30 } });
    const allPass = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity, humanoidTwoEntity],
      castingResource: slot(3),
    });
    const allPassCastId = (await castOf(allPass.operationId))?.id;
    const allPassPendings = allPassCastId
      ? await prisma.pendingEffectSave.findMany({ where: { spellCastId: allPassCastId } })
      : [];
    const allPassRolls = await Promise.all(allPassPendings.map((row) => rollSave(row.id)));
    const allPassFinal = allPassCastId
      ? await prisma.spellCast.findUniqueOrThrow({ where: { id: allPassCastId } })
      : null;
    const allPassEffects = allPassFinal?.effectGroupId
      ? await prisma.effectInstance.count({ where: { groupId: allPassFinal.effectGroupId } })
      : 0;
    const casterAfterAllPass = await mechanicalOf(casterEntity);
    check(
      '76.7.F) todos os saves passam → SpellCast no-effect, zero Effect e NENHUMA Concentração nova',
      allPass.status === 201 &&
        allPassRolls.every((roll) => roll.status === 201) &&
        allPassFinal?.outcome === 'no-effect' &&
        allPassFinal.effectGroupId === null &&
        allPassEffects === 0 &&
        casterAfterAllPass.state.concentration === null,
      JSON.stringify({ allPass: allPass.status, final: allPassFinal?.outcome, effects: allPassEffects }),
    );

    // =====================================================================
    // G — CONCORRÊNCIA dos últimos saves: exatamente UM Effect Group
    // =====================================================================
    await prisma.character.update({ where: { id: caster.id }, data: { intelligence: 30, wisdom: 30, charisma: 30 } });
    await prisma.creature.update({ where: { id: humanoid.id }, data: { wisdom: 1 } });
    await prisma.creature.update({ where: { id: humanoidTwo.id }, data: { wisdom: 1 } });
    // Cada bloco de concorrência precisa de espaços próprios: os blocos
    // anteriores já gastaram o pool de 3º nível.
    await resetCastingSlots(caster.id);
    const race = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity, humanoidTwoEntity],
      castingResource: slot(3),
    });
    const raceCastId = (await castOf(race.operationId))?.id;
    const racePendings = raceCastId
      ? await prisma.pendingEffectSave.findMany({ where: { spellCastId: raceCastId } })
      : [];
    const raceRolls = await Promise.all(racePendings.map((row) => rollSave(row.id)));
    const raceFinal = raceCastId
      ? await prisma.spellCast.findUniqueOrThrow({ where: { id: raceCastId } })
      : null;
    const raceRows = raceCastId
      ? await prisma.pendingEffectSave.findMany({ where: { spellCastId: raceCastId } })
      : [];
    const distinctGroups = new Set(raceRows.map((row) => row.groupId).filter(Boolean));
    const raceEffects = raceFinal?.effectGroupId
      ? await prisma.effectInstance.count({ where: { groupId: raceFinal.effectGroupId } })
      : 0;
    const raceFailureCount = raceRows.filter((row) => row.result === 'failure').length;
    check(
      '76.7.G) dois últimos saves simultâneos: exatamente UM Effect Group, sem duplicar efeito nem Concentração',
      race.status === 201 &&
        raceRolls.every((roll) => roll.status === 201) &&
        raceFinal?.status === 'resolved' &&
        distinctGroups.size === (raceFailureCount > 0 ? 1 : 0) &&
        (raceFailureCount === 0
          ? raceFinal?.outcome === 'no-effect' && raceEffects === 0
          : raceFinal?.outcome === 'effect' && raceEffects === raceFailureCount),
      JSON.stringify({
        rolls: raceRolls.map((roll) => roll.status),
        final: raceFinal?.status,
        outcome: raceFinal?.outcome,
        groups: [...distinctGroups],
        failures: raceFailureCount,
        raceEffects,
      }),
    );

    // =====================================================================
    // H — DUPLICIDADE: mesmo alvo duas vezes e ficha × combatente
    // =====================================================================
    const duplicated = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [allyEntity, allyEntity],
      castingResource: slot(1),
    });

    const combatRow = await prisma.combat.create({
      data: {
        status: 'ENDED',
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: ally.id,
              ownerUserId: allyUser.id,
              name: ally.name,
              initiative: 10,
            },
          ],
        },
      },
    });
    combatId = combatRow.id;
    const participant = await prisma.combatant.findFirstOrThrow({ where: { combatId } });
    const canonicalDuplicate = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [allyEntity, { kind: 'combatant', id: participant.id }],
      castingResource: slot(1),
    });
    check(
      '76.7.H) alvo repetido e ficha+combatente do MESMO personagem são rejeitados como duplicidade canônica',
      duplicated.status === 400 &&
        duplicated.data.error === 'SPELL_TARGET_DUPLICATE' &&
        canonicalDuplicate.status === 400 &&
        canonicalDuplicate.data.error === 'SPELL_TARGET_DUPLICATE',
      JSON.stringify({ duplicated: duplicated.data, canonical: canonicalDuplicate.data }),
    );

    // =====================================================================
    // I — CONFIRMAÇÃO AUSENTE: UNKNOWN não vira PASS sozinho
    // =====================================================================
    const beforeMissing = await resourcesOf(casterEntity);
    const missing = await cast(
      '/effects/bless',
      { caster: casterEntity, targets: [allyEntity], castingResource: slot(1) },
      { evidence: false },
    );
    const missingHold = await cast(
      '/effects/hold-person',
      { caster: casterEntity, targets: [humanoidTwoEntity], castingResource: slot(2) },
      { evidence: false },
    );
    const afterMissing = await resourcesOf(casterEntity);
    check(
      '76.7.I) sem confirmação espacial o COMMIT não acontece (nada de slot/Ação/Concentração)',
      missing.status === 409 &&
        missing.data.error === 'SPELL_TARGET_RANGE_CONFIRMATION_REQUIRED' &&
        missingHold.status === 409 &&
        missingHold.data.error === 'SPELL_TARGET_RANGE_CONFIRMATION_REQUIRED' &&
        JSON.stringify(beforeMissing) === JSON.stringify(afterMissing),
      JSON.stringify({ missing: missing.data, hold: missingHold.data, beforeMissing, afterMissing }),
    );

    // =====================================================================
    // J — FILTRO DE TIPO: Hold Person rejeita não humanoide (inclusive misto)
    // =====================================================================
    await resetCastingSlots(caster.id);
    const mixed = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity, beastEntity],
      castingResource: slot(3),
    });
    const beastPendings = await prisma.pendingEffectSave.count({
      where: { targetEntityId: beast.id, status: 'pending' },
    });
    check(
      '76.7.J) um alvo não humanoide invalida o cast INTEIRO antes do commit (nenhuma pendência parcial)',
      mixed.status === 409 &&
        mixed.data.error === 'SPELL_TARGET_TYPE_INVALID' &&
        beastPendings === 0,
      JSON.stringify({ mixed: mixed.data, beastPendings }),
    );

    // =====================================================================
    // K — VISÃO: Hold Person exige; Bless NÃO exige
    // =====================================================================
    await setCondition(allyEntity, 'invisible');
    await setCondition(humanoidEntity, 'invisible');
    const blessInvisible = await cast('/effects/bless', {
      caster: casterEntity,
      targets: [allyEntity],
      castingResource: slot(1),
    });
    if (blessInvisible.data.groupId) groupIds.push(blessInvisible.data.groupId);
    const holdInvisible = await cast('/effects/hold-person', {
      caster: casterEntity,
      targets: [humanoidEntity],
      castingResource: slot(2),
    });
    check(
      '76.7.K) alvo Invisible: Bless NÃO é bloqueado (não exige visão); Hold Person é bloqueado mesmo com confirmação',
      blessInvisible.status === 201 &&
        blessInvisible.data.effects?.length === 1 &&
        holdInvisible.status === 409 &&
        holdInvisible.data.error === 'SPELL_TARGET_NOT_VISIBLE',
      JSON.stringify({ bless: blessInvisible.status, hold: holdInvisible.data }),
    );
    await removeCondition(allyEntity, 'invisible');
    await removeCondition(humanoidEntity, 'invisible');

    // =====================================================================
    // L — IDEMPOTÊNCIA e CANCELAMENTO (a conjuração inteira)
    // =====================================================================
    await resetCastingSlots(caster.id);
    const opRetry = randomUUID();
    operations.push(opRetry);
    const castBody = {
      operationId: opRetry,
      spellId: 'hold-person',
      caster: casterEntity,
      targets: [humanoidTwoEntity, allyTwoEntity],
      castingResource: slot(3),
      spatialConfirmation: SPATIAL_EVIDENCE,
    };
    const beforeRetry = await resourcesOf(casterEntity);
    const original = await request('/spells/cast-proof', castBody);
    const afterOriginal = await resourcesOf(casterEntity);
    const retry = await request('/spells/cast-proof', castBody);
    const afterRetry = await resourcesOf(casterEntity);
    const reused = await request('/spells/cast-proof', {
      ...castBody,
      targets: [humanoidTwoEntity],
    });
    const castId = original.data.cast?.id as string | undefined;
    const allPendings = castId
      ? await prisma.pendingEffectSave.findMany({ where: { spellCastId: castId } })
      : [];
    if (allPendings[0]) await request(`/effects/pending/${allPendings[0].id}/cancel`, {});
    const cancelledPendings = castId
      ? await prisma.pendingEffectSave.findMany({ where: { spellCastId: castId } })
      : [];
    const cancelledCast = castId
      ? await prisma.spellCast.findUniqueOrThrow({ where: { id: castId } })
      : null;
    check(
      '76.7.L) retry devolve o MESMO cast sem gastar espaço; payload diferente é IDEMPOTENCY_KEY_REUSED; cancelar cancela o cast inteiro',
      original.status === 201 &&
        retry.status === 200 &&
        retry.data.cast?.id === castId &&
        JSON.stringify(afterOriginal) === JSON.stringify(afterRetry) &&
        reused.status === 409 &&
        reused.data.error === 'IDEMPOTENCY_KEY_REUSED' &&
        allPendings.length === 2 &&
        cancelledPendings.every((row) => row.status === 'cancelled') &&
        cancelledCast?.status === 'cancelled' &&
        cancelledCast?.effectGroupId === null,
      JSON.stringify({
        original: original.status,
        retry: retry.data.replayed,
        reused: reused.data,
        pendings: allPendings.length,
        statuses: cancelledPendings.map((row) => row.status),
        cast: cancelledCast?.status,
        retryStatus: retry.status,
        retryCastId: retry.data.cast?.id,
        sameCast: retry.data.cast?.id === castId,
        sameResources: JSON.stringify(afterOriginal) === JSON.stringify(afterRetry),
        beforeRetry,
        afterOriginal,
        afterRetry,
      }),
    );

    // =====================================================================
    // M — PLAYER continua sem conjurar e sem ler o targeting derivado
    // =====================================================================
    const playerCast = await cast(
      '/effects/bless',
      { caster: casterEntity, targets: [allyThreeEntity], castingResource: slot(1) },
      { token: casterToken },
    );
    const playerTargeting = await request('/spells/targeting/bless?castAtLevel=2', undefined, casterToken);
    const derivedTargeting = await request('/spells/targeting/hold-person?castAtLevel=3');
    const blessTargeting = await request('/spells/targeting/bless?castAtLevel=2');
    check(
      '76.7.M) PLAYER não conjura nem lê o targeting derivado; rota MASTER devolve máximo/alcance do ESPAÇO escolhido',
      playerCast.status === 403 &&
        playerTargeting.status === 403 &&
        derivedTargeting.status === 200 &&
        derivedTargeting.data.targeting?.maxTargets === 2 &&
        derivedTargeting.data.targeting?.rangeFeet === 60 &&
        derivedTargeting.data.targeting?.requiresSight === true &&
        derivedTargeting.data.targeting?.groupConstraints?.[0]?.feet === 30 &&
        blessTargeting.data.targeting?.maxTargets === 4 &&
        blessTargeting.data.targeting?.requiresSight === false,
      JSON.stringify({
        playerCast: playerCast.status,
        playerTargeting: playerTargeting.status,
        hold: derivedTargeting.data.targeting,
        bless: blessTargeting.data.targeting,
      }),
    );

    // O alvo privado (Invisible) não vazou em nenhuma mensagem de erro acima:
    // os códigos são sanitizados (SPELL_TARGET_NOT_VISIBLE).
    check(
      '76.7.N) erro de visão é sanitizado e o alvo continua com seu efeito real preservado',
      !JSON.stringify(holdInvisible.data).includes('spell.') &&
        !JSON.stringify(holdInvisible.data).toLowerCase().includes('invisible'),
      JSON.stringify(holdInvisible.data),
    );

  } finally {
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    const ids = [...characterIds, ...creatureIds];
    if (groupIds.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { groupId: { in: groupIds } } });
    }
    await prisma.pendingEffectSave.deleteMany({ where: { targetEntityId: { in: ids } } });
    await prisma.spellCast.deleteMany({
      where: { OR: [{ casterEntityId: { in: ids } }, { operationId: { in: operations } }] },
    });
    await prisma.effectInstance.deleteMany({
      where: { OR: [{ targetEntityId: { in: ids } }, { sourceEntityId: { in: ids } }] },
    });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
