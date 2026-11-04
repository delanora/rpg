import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { grantCastingComponents, pickCastingResource, seedSpellRepertoire } from './spell-slot-fixtures.js';
import {
  buildDurationSnapshot,
  dueRoundNumber,
  durationToCombatRounds,
  isDurationDue,
  parseDurationSnapshot,
  remainingCombatRounds,
  type SpellDurationSnapshot,
} from '../modules/spells/execution/spell-duration.js';
import {
  manualTriggerOccurrenceId,
  turnTriggerOccurrenceId,
} from '../modules/effects/effect-turn-triggers.js';
import { holdPersonTurnTriggers, HOLD_PERSON_DEFINITION_ID } from '../modules/effects/definitions/hold-person.js';
import { resolvePendingEffectSave } from '../modules/effects/hold-person.service.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const EVIDENCE = { withinRange: true, sight: true, clearPath: true, groupDistance: true };

/**
 * FASE 6.6H — DURAÇÃO, EXPIRAÇÃO E LIFECYCLE POR TURNO.
 *
 * Prova que:
 *  • a duração é dado ESTRUTURADO e converte 1 minuto → 10 rounds (nunca segundos);
 *  • o relógio em combate é `Combat.round` + a ativação, sem `setTimeout`;
 *  • a duração começa no COMMIT e o Effect herda o snapshot (sem ganhar tempo novo);
 *  • fora de combate o acompanhamento é MANUAL (sem wall clock) e o Mestre expira;
 *  • o fim do turno do alvo abre a salvaguarda repetida e BLOQUEIA o avanço;
 *  • recusar é terminal daquela ocorrência, mantém o efeito e não é falha;
 *  • sucesso encerra SÓ aquela instância e o grupo vazio encerra a Concentração;
 *  • a expiração de duração limpa Effects/modifiers/Concentration e cancela
 *    pendências contínuas, sem reescrever o histórico do SpellCast;
 *  • um cast `resolving` vencido NÃO fica eterno (no-effect/duration-expired).
 */
export async function smokeSpellDuration(baseUrl: string, check: Check): Promise<void> {
  console.log('\n78) Fase 6.6H — duração, expiração e lifecycle por turno');

  // =====================================================================
  // A — regras PURAS da duração (sem I/O)
  // =====================================================================
  const minute: SpellDurationSnapshot = buildDurationSnapshot({
    definition: { kind: 'timed', amount: 1, unit: 'minute' },
    combat: { combatId: 'c1', anchorCombatantId: 'a', roundNumber: 1, turnSequence: 1 },
  });
  check(
    '78.A) 1 minuto = 10 rounds e a duração vence no round 11 (âncora round 1)',
    durationToCombatRounds({ kind: 'timed', amount: 1, unit: 'minute' }) === 10 &&
      durationToCombatRounds({ kind: 'timed', amount: 1, unit: 'hour' }) === 600 &&
      durationToCombatRounds({ kind: 'timed', amount: 3, unit: 'round' }) === 3 &&
      dueRoundNumber(1, 10) === 11 &&
      minute.combat?.dueRoundNumber === 11 &&
      minute.tracking === 'combat',
    JSON.stringify(minute),
  );
  check(
    '78.B) a expiração é determinística: antes do round devido não vence; no round devido vence na ativação do anchor',
    !isDurationDue(minute, { roundNumber: 10, currentCombatantId: 'a' }, true) &&
      !isDurationDue(minute, { roundNumber: 11, currentCombatantId: 'outro' }, true) &&
      isDurationDue(minute, { roundNumber: 11, currentCombatantId: 'a' }, true)
  );
  check(
    '78.C) anchor sem turno válido não segura a magia até o fim do round (fallback do round devido)',
    isDurationDue(minute, { roundNumber: 11, currentCombatantId: 'outro' }, false) &&
      isDurationDue(minute, { roundNumber: 12, currentCombatantId: 'outro' }, true) &&
      remainingCombatRounds(minute, { roundNumber: 4 }) === 7
  );
  check(
    '78.D) snapshot inválido na leitura vira `null` (nunca inventa duração)',
    parseDurationSnapshot({ tracking: 'combat' }) === null &&
      parseDurationSnapshot({ definition: { kind: 'timed', amount: 1, unit: 'day' } }) === null &&
      parseDurationSnapshot('1 minute') === null
  );
  const occurrence = turnTriggerOccurrenceId({
    combatId: 'c1',
    turnSequence: 3,
    effectInstanceId: 'e1',
    triggerKey: 'repeat-save',
  });
  check(
    '78.E) identidade da ocorrência é determinística e muda por turno/efeito (sem timestamp)',
    occurrence ===
      turnTriggerOccurrenceId({
        combatId: 'c1',
        turnSequence: 3,
        effectInstanceId: 'e1',
        triggerKey: 'repeat-save',
      }) &&
      occurrence !==
        turnTriggerOccurrenceId({
          combatId: 'c1',
          turnSequence: 4,
          effectInstanceId: 'e1',
          triggerKey: 'repeat-save',
        }) &&
      manualTriggerOccurrenceId({ effectInstanceId: 'e1', triggerKey: 'repeat-save', operationId: 'op' }) ===
        'manual:e1:trigger:repeat-save:op:op'
  );

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const combatIds: string[] = [];
  const effectIds: string[] = [];
  const castIds: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `dur_m_${suffix}`, displayName: 'Mestre DUR', passwordHash: 'fixture', role: 'MASTER' },
    });
    const casterUser = await prisma.user.create({
      data: { username: `dur_c_${suffix}`, displayName: 'Caster DUR', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const targetUser = await prisma.user.create({
      data: { username: `dur_t_${suffix}`, displayName: 'Alvo DUR', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const secondUser = await prisma.user.create({
      data: { username: `dur_s_${suffix}`, displayName: 'Alvo Dois DUR', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, casterUser.id, targetUser.id, secondUser.id);
    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });

    const caster = await prisma.character.create({
      data: {
        userId: casterUser.id,
        name: 'Caster DUR',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 16,
        constitution: 20,
        classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      },
    });
    const target = await prisma.character.create({
      data: { userId: targetUser.id, name: 'Alvo DUR', hpCurrent: 30, hpMax: 30, speed: 9, wisdom: 10 },
    });
    const second = await prisma.character.create({
      data: { userId: secondUser.id, name: 'Alvo Dois DUR', hpCurrent: 30, hpMax: 30, speed: 9, wisdom: 10 },
    });
    characterIds.push(caster.id, target.id, second.id);
    await grantCastingComponents({ characters: characterIds });
    await seedSpellRepertoire({
      characterId: caster.id,
      classKey: 'cleric',
      spellIds: ['bless', 'hold-person'],
    });

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    const nextTurn = async (combatId: string) => {
      const fresh = await prisma.combat.findUniqueOrThrow({ where: { id: combatId } });
      return request('/combat/next-turn', {
        combatId,
        expectedVersion: fresh.version,
        operationId: randomUUID(),
      });
    };

    // =====================================================================
    // B — FORA DE COMBATE: acompanhamento MANUAL, sem wall clock
    // =====================================================================
    const outSlot = await pickCastingResource(baseUrl, masterToken, { kind: 'character', id: caster.id }, 1);
    const outCast = await request('/spells/cast', {
      operationId: randomUUID(),
      spellId: 'bless',
      caster: { kind: 'character', id: caster.id },
      targets: [{ kind: 'character', id: target.id }],
      spatialConfirmation: EVIDENCE,
      ...(outSlot ? { castingResource: outSlot } : {}),
    });
    const outCastRow = await prisma.spellCast.findFirst({
      where: { casterEntityId: caster.id, spellId: 'bless' },
      orderBy: { committedAt: 'desc' },
    });
    if (outCastRow) castIds.push(outCastRow.id);
    const outSnapshot = parseDurationSnapshot(outCastRow?.durationSnapshot);
    check(
      '78.F) fora de combate a duração é MANUAL (sem 60 segundos reais) e o cast grava o snapshot',
      outCast.status === 201 &&
        outCast.data?.cast?.duration?.tracking === 'manual' &&
        outSnapshot?.tracking === 'manual' &&
        outSnapshot?.combat === null,
      JSON.stringify({ status: outCast.status, duration: outCast.data?.cast?.duration }),
    );
    const outEffect = await prisma.effectInstance.findFirst({
      where: { groupId: outCast.data?.cast?.effectGroupId ?? '' },
    });
    if (outEffect) effectIds.push(outEffect.id);
    const outConcentration = (
      await prisma.character.findUniqueOrThrow({ where: { id: caster.id } })
    ).mechanicalState as { concentration?: { sourceId?: string } | null };
    check(
      '78.G) o Effect herda o snapshot MANUAL do COMMIT e a Concentração aponta para o grupo',
      Boolean(outEffect) &&
        parseDurationSnapshot(outEffect?.durationSnapshot)?.tracking === 'manual' &&
        outConcentration.concentration?.sourceId === outEffect?.groupId,
      JSON.stringify({ effect: outEffect?.id, concentration: outConcentration.concentration }),
    );

    const manualExpire = await request(`/effects/${outEffect?.id}/expire`, {});
    const expiredRow = await prisma.effectInstance.findUnique({ where: { id: outEffect!.id } });
    const casterStateAfterExpire = (await prisma.character.findUniqueOrThrow({ where: { id: caster.id } }))
      .mechanicalState as { concentration?: unknown };
    check(
      '78.H) o Mestre expira a duração manualmente: Effect encerrado, Concentration removida',
      manualExpire.status === 200 &&
        expiredRow?.status === 'ended' &&
        expiredRow?.endReason === 'duration-expired' &&
        !casterStateAfterExpire.concentration,
      JSON.stringify({ status: manualExpire.status, reason: expiredRow?.endReason }),
    );

    // =====================================================================
    // C — COMBATE 1: snapshot do COMMIT + triggers de fim de turno
    // =====================================================================
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
              turnEconomy: {
                actionsGranted: 1,
                actionsUsed: 0,
                bonusActionUsed: false,
                reactionAvailable: true,
                movementBudget: 9,
                movementUsed: 0,
              } as never,
            },
            {
              kind: 'CHARACTER',
              characterId: target.id,
              ownerUserId: targetUser.id,
              name: target.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: 0,
            },
            {
              kind: 'CHARACTER',
              characterId: second.id,
              ownerUserId: secondUser.id,
              name: second.name,
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
    const secondCombatant = combat.combatants.find((item) => item.characterId === second.id)!;
    const casterEntity = { kind: 'combatant' as const, id: casterCombatant.id };
    const targetEntity = { kind: 'combatant' as const, id: targetCombatant.id };
    const secondEntity = { kind: 'combatant' as const, id: secondCombatant.id };

    const combatSlot = await pickCastingResource(baseUrl, masterToken, casterEntity, 1);
    const blessCast = await request('/effects/bless', {
      operationId: randomUUID(),
      caster: casterEntity,
      targets: [targetEntity],
      spatialConfirmation: EVIDENCE,
      ...(combatSlot ? { castingResource: combatSlot } : {}),
    });
    const blessRow = await prisma.spellCast.findFirst({
      where: { casterEntityId: caster.id, combatId: combat.id },
      orderBy: { committedAt: 'desc' },
    });
    if (blessRow) castIds.push(blessRow.id);
    const blessSnapshot = parseDurationSnapshot(blessRow?.durationSnapshot);
    const blessEffect = await prisma.effectInstance.findFirst({ where: { groupId: blessRow?.effectGroupId ?? '' } });
    if (blessEffect) effectIds.push(blessEffect.id);
    check(
      '78.I) em combate a duração ancora no round/ativação do COMMIT: 10 rounds, vence no round 11',
      blessCast.status === 201 &&
        blessSnapshot?.tracking === 'combat' &&
        blessSnapshot?.combat?.anchorCombatantId === casterCombatant.id &&
        blessSnapshot?.combat?.startedRoundNumber === 1 &&
        blessSnapshot?.combat?.rounds === 10 &&
        blessSnapshot?.combat?.dueRoundNumber === 11 &&
        parseDurationSnapshot(blessEffect?.durationSnapshot)?.combat?.dueRoundNumber === 11,
      JSON.stringify({ status: blessCast.status, snapshot: blessSnapshot }),
    );

    // Efeito contínuo de Hold Person montado como FIXTURE (a barreira inicial é
    // provada nos smokes de conjuração); aqui o alvo é o lifecycle por turno.
    const groupId = randomUUID();
    const triggerCast = await prisma.spellCast.create({
      data: {
        spellId: 'hold-person',
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targets: [] as never,
        status: 'resolved',
        outcome: 'effect',
        requiresConcentration: true,
        effectGroupId: groupId,
        saveDc: 14,
        spellSaveDc: 14,
        spellLevel: 2,
        castAtLevel: 2,
        combatId: combat.id,
        turnSequence: 1,
        combatantId: casterCombatant.id,
        durationSnapshot: buildDurationSnapshot({
          definition: { kind: 'timed', amount: 1, unit: 'minute' },
          combat: {
            combatId: combat.id,
            anchorCombatantId: casterCombatant.id,
            roundNumber: 1,
            turnSequence: 1,
          },
        }) as never,
        operationId: `dur-fixture-${suffix}`,
        fingerprint: `dur-fixture-${suffix}`,
      },
    });
    castIds.push(triggerCast.id);
    const durationPayload = triggerCast.durationSnapshot as never;
    const holdEffects = await Promise.all(
      [targetCombatant.id, secondCombatant.id].map(async (combatantId, index) =>
        prisma.effectInstance.create({
          data: {
            groupId,
            definitionId: HOLD_PERSON_DEFINITION_ID,
            label: 'Imobilizar Pessoa',
            sourceType: 'spell',
            sourceId: 'hold-person',
            sourceEntityKind: 'character',
            sourceEntityId: caster.id,
            sourceLabel: caster.name,
            targetEntityKind: 'character',
            targetEntityId: index === 0 ? target.id : second.id,
            visibility: 'public',
            status: 'active',
            conditions: ['paralyzed'] as never,
            durationSnapshot: durationPayload,
            turnTriggers: holdPersonTurnTriggers() as never,
          },
        }),
      ),
    );
    effectIds.push(...holdEffects.map((row) => row.id));
    // FIXTURE: a Concentração que a resolução real teria criado para o grupo
    // (substituindo a anterior, como no COMMIT de uma magia concentrada).
    {
      const current = await prisma.character.findUniqueOrThrow({ where: { id: caster.id } });
      const state = (current.mechanicalState ?? {}) as Record<string, unknown>;
      await prisma.character.update({
        where: { id: caster.id },
        data: {
          mechanicalState: {
            ...state,
            concentration: {
              id: randomUUID(),
              label: 'Imobilizar Pessoa',
              sourceType: 'effect',
              sourceId: groupId,
              visibility: 'public',
              startedAt: new Date().toISOString(),
            },
          } as never,
          version: { increment: 1 },
        },
      });
    }

    // Avança do caster para o ALVO (sem triggers nele ainda? Bless está no alvo
    // e NÃO tem trigger, então o turno avança normalmente).
    const toTarget = await nextTurn(combat.id);
    const afterToTarget = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    check(
      '78.J) Bless não tem trigger: o fim do turno do conjurador avança normalmente',
      toTarget.status === 200 && afterToTarget.currentIndex === 1 && afterToTarget.turnSequence === 2,
      JSON.stringify({ status: toTarget.status, currentIndex: afterToTarget.currentIndex }),
    );

    // Fim do turno do ALVO: cria a oportunidade e NÃO avança.
    const blocked = await nextTurn(combat.id);
    const pendingAfterBlock = await prisma.pendingEffectSave.findMany({
      where: { effectInstanceId: holdEffects[0].id },
    });
    const combatAfterBlock = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    check(
      '78.K) fim do turno do alvo cria a salvaguarda repetida e BLOQUEIA o avanço (turnSequence intacto)',
      blocked.status === 409 &&
        blocked.data?.error === 'TURN_END_TRIGGER_PENDING' &&
        pendingAfterBlock.length === 1 &&
        pendingAfterBlock[0].phase === 'ongoing' &&
        pendingAfterBlock[0].optional === true &&
        pendingAfterBlock[0].dc === 14 &&
        pendingAfterBlock[0].spellCastId === null &&
        combatAfterBlock.turnSequence === 2 &&
        combatAfterBlock.round === 1,
      JSON.stringify({ status: blocked.status, error: blocked.data?.error, pending: pendingAfterBlock }),
    );

    const retryBlocked = await nextTurn(combat.id);
    const pendingAfterRetry = await prisma.pendingEffectSave.count({
      where: { effectInstanceId: holdEffects[0].id },
    });
    check(
      '78.L) retry de `nextTurn` NÃO duplica a pendência e continua bloqueado',
      retryBlocked.status === 409 && pendingAfterRetry === 1,
      JSON.stringify({ status: retryBlocked.status, count: pendingAfterRetry }),
    );

    const declined = await request(`/effects/pending-saves/${pendingAfterBlock[0].id}/decline`, {});
    const declinedRow = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: pendingAfterBlock[0].id },
    });
    const effectAfterDecline = await prisma.effectInstance.findUniqueOrThrow({
      where: { id: holdEffects[0].id },
    });
    check(
      '78.M) recusar é terminal daquela ocorrência, NÃO é falha e mantém o efeito ativo',
      declined.status === 200 &&
        declined.data?.pending?.status === 'declined' &&
        declinedRow.result === null &&
        declinedRow.declinedAt !== null &&
        effectAfterDecline.status === 'active',
      JSON.stringify({ status: declined.status, row: declinedRow.status }),
    );

    const afterDecline = await nextTurn(combat.id);
    const combatAfterDecline = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    check(
      '78.N) depois de recusar, o turno avança exatamente uma vez (turnSequence +1)',
      afterDecline.status === 200 && combatAfterDecline.turnSequence === 3,
      JSON.stringify({ status: afterDecline.status, turnSequence: combatAfterDecline.turnSequence }),
    );

    // Sucesso em UM alvo: encerra só aquela instância e mantém a Concentração.
    const fireOperation = randomUUID();
    const manualPending = await request(`/effects/${holdEffects[0].id}/triggers/repeat-save/fire`, {
      operationId: fireOperation,
    });
    // MESMO `operationId` = retry: devolve a pendência existente, nunca cria outra.
    const manualRetry = await request(`/effects/${holdEffects[0].id}/triggers/repeat-save/fire`, {
      operationId: fireOperation,
    });
    const successOne = await resolvePendingEffectSave(manualPending.data?.pending?.id ?? '', 999, 'Smoke');
    const firstEnded = await prisma.effectInstance.findUniqueOrThrow({ where: { id: holdEffects[0].id } });
    const secondStill = await prisma.effectInstance.findUniqueOrThrow({ where: { id: holdEffects[1].id } });
    const concentrationAfterOne = (await prisma.character.findUniqueOrThrow({ where: { id: caster.id } }))
      .mechanicalState as { concentration?: { sourceId?: string } | null };
    check(
      '78.O) sucesso encerra SÓ a instância daquele alvo; outro alvo e a Concentração continuam',
      successOne.success &&
        firstEnded.status === 'ended' &&
        firstEnded.endReason === 'repeat-save-success' &&
        secondStill.status === 'active' &&
        concentrationAfterOne.concentration?.sourceId === groupId &&
        manualRetry.status === 200 &&
        manualPending.data?.pending?.id === manualRetry.data?.pending?.id,
      JSON.stringify({ success: successOne.success, ended: firstEnded.status }),
    );

    const secondPending = await request(`/effects/${holdEffects[1].id}/triggers/repeat-save/fire`, {
      operationId: randomUUID(),
    });
    const successLast = await resolvePendingEffectSave(secondPending.data?.pending?.id ?? '', 999, 'Smoke');
    const concentrationAfterLast = (await prisma.character.findUniqueOrThrow({ where: { id: caster.id } }))
      .mechanicalState as { concentration?: unknown };
    check(
      '78.P) último Effect do grupo termina → Concentração termina (uma vez, sem loop)',
      successLast.success && !concentrationAfterLast.concentration,
      JSON.stringify({ concentration: concentrationAfterLast.concentration }),
    );

    // =====================================================================
    // D — COMBATE 2: expiração de duração e cast `resolving` vencido
    // =====================================================================
    await prisma.combat.update({
      where: { id: combat.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });

    const combat2 = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 5,
        turnSequence: 9,
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
              turnEconomy: {
                actionsGranted: 1,
                actionsUsed: 0,
                bonusActionUsed: false,
                reactionAvailable: true,
                movementBudget: 9,
                movementUsed: 0,
              } as never,
            },
            {
              kind: 'CHARACTER',
              characterId: target.id,
              ownerUserId: targetUser.id,
              name: target.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: 0,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat2.id);
    const caster2 = combat2.combatants.find((item) => item.characterId === caster.id)!;
    const target2 = combat2.combatants.find((item) => item.characterId === target.id)!;

    // Duração que vence AO INÍCIO da ativação do ALVO neste mesmo round.
    const expiringGroup = randomUUID();
    const expiring = await prisma.effectInstance.create({
      data: {
        groupId: expiringGroup,
        definitionId: HOLD_PERSON_DEFINITION_ID,
        label: 'Imobilizar Pessoa',
        sourceType: 'spell',
        sourceId: 'hold-person',
        sourceEntityKind: 'character',
        sourceEntityId: caster.id,
        sourceLabel: caster.name,
        targetEntityKind: 'character',
        targetEntityId: target.id,
        visibility: 'public',
        status: 'active',
        conditions: ['paralyzed'] as never,
        // Duração que vence EXATAMENTE na ativação do alvo neste round.
        durationSnapshot: {
          definition: { kind: 'timed', amount: 3, unit: 'round' },
          tracking: 'combat',
          combat: {
            combatId: combat2.id,
            anchorCombatantId: target2.id,
            startedRoundNumber: 5,
            startedTurnSequence: 9,
            rounds: 3,
            dueRoundNumber: 5,
          },
        } as never,
        turnTriggers: holdPersonTurnTriggers() as never,
      },
    });
    effectIds.push(expiring.id);
    const expiringCast = await prisma.spellCast.create({
      data: {
        spellId: 'hold-person',
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targets: [] as never,
        status: 'resolving',
        requiresConcentration: true,
        saveDc: 14,
        spellSaveDc: 14,
        spellLevel: 2,
        castAtLevel: 2,
        combatId: combat2.id,
        turnSequence: 9,
        combatantId: caster2.id,
        durationSnapshot: {
          definition: { kind: 'timed', amount: 3, unit: 'round' },
          tracking: 'combat',
          combat: {
            combatId: combat2.id,
            anchorCombatantId: target2.id,
            startedRoundNumber: 5,
            startedTurnSequence: 9,
            rounds: 3,
            dueRoundNumber: 5,
          },
        } as never,
        operationId: `dur-resolving-${suffix}`,
        fingerprint: `dur-resolving-${suffix}`,
      },
    });
    castIds.push(expiringCast.id);
    const initialPending = await prisma.pendingEffectSave.create({
      data: {
        definitionId: HOLD_PERSON_DEFINITION_ID,
        spellCastId: expiringCast.id,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targetEntityKind: 'character',
        targetEntityId: target.id,
        ability: 'wisdom',
        dc: 14,
        visibility: 'public',
        status: 'pending',
        phase: 'initial',
        operationId: `dur-initial-${suffix}`,
        fingerprint: `dur-initial-${suffix}`,
      },
    });

    const expiryTurn = await nextTurn(combat2.id);
    const expiringAfter = await prisma.effectInstance.findUniqueOrThrow({ where: { id: expiring.id } });
    const expiringPending = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: initialPending.id },
    });
    const expiringCastAfter = await prisma.spellCast.findUniqueOrThrow({ where: { id: expiringCast.id } });
    const combat2After = await prisma.combat.findUniqueOrThrow({ where: { id: combat2.id } });
    check(
      '78.Q) duração vencida no início do turno do anchor encerra Effects e cancela a pendência contínua',
      expiryTurn.status === 200 &&
        expiringAfter.status === 'ended' &&
        expiringAfter.endReason === 'duration-expired' &&
        expiringPending.status === 'cancelled' &&
        combat2After.currentIndex === 1,
      JSON.stringify({ status: expiryTurn.status, effect: expiringAfter.endReason, pending: expiringPending.status }),
    );
    check(
      '78.R) cast ainda `resolving` vencido NÃO fica eterno: no-effect + motivo auditável',
      expiringCastAfter.status === 'resolved' &&
        expiringCastAfter.outcome === 'no-effect' &&
        expiringCastAfter.resolutionReason === 'duration-expired',
      JSON.stringify({ status: expiringCastAfter.status, reason: expiringCastAfter.resolutionReason }),
    );

    // Fim do combate NÃO encerra uma magia que ainda poderia durar (§30).
    const lastingEffect = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'spell.bless',
        label: 'Bless',
        sourceType: 'spell',
        sourceId: 'bless',
        sourceEntityKind: 'character',
        sourceEntityId: caster.id,
        sourceLabel: caster.name,
        targetEntityKind: 'character',
        targetEntityId: second.id,
        visibility: 'public',
        status: 'active',
        modifiers: [] as never,
        durationSnapshot: buildDurationSnapshot({
          definition: { kind: 'timed', amount: 1, unit: 'minute' },
          combat: {
            combatId: combat2.id,
            anchorCombatantId: caster2.id,
            roundNumber: 5,
            turnSequence: 9,
          },
        }) as never,
      },
    });
    effectIds.push(lastingEffect.id);
    const endCombat = await request('/combat/end', {});
    const lastingAfter = await prisma.effectInstance.findUniqueOrThrow({ where: { id: lastingEffect.id } });
    check(
      '78.S) combate encerrado NÃO encerra automaticamente a magia (o tempo restante fica assistido)',
      endCombat.status === 200 && lastingAfter.status === 'active',
      JSON.stringify({ status: endCombat.status, effect: lastingAfter.status }),
    );
  } finally {
    // Limpeza ESCOPADA: só as entidades criadas por esta execução.
    if (combatIds.length) await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
    await prisma.pendingEffectSave.deleteMany({
      where: {
        OR: [{ spellCastId: { in: castIds } }, { effectInstanceId: { in: effectIds } }],
      },
    });
    await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
    if (effectIds.length) await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
    if (characterIds.length) await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
