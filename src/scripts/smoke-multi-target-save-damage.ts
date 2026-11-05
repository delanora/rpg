import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { allSpells } from '../modules/shared/spells/index.js';
import { spellDefinitionId } from '../modules/spells/execution/spell-execution-definition.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { resolveSaveDamagePending } from '../modules/spells/execution/save-damage-resolution.js';
import {
  SYNTHETIC_MULTI_SAVE_SPELL_ID,
  SYNTHETIC_MULTI_SAVE_TARGETS,
} from '../modules/spells/execution/multi-save-test-definition.js';
import { BLESS_LABEL, blessModifiers } from '../modules/effects/definitions/bless.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6J.2 — MULTI-TARGET INDEPENDENT SAVE/DAMAGE.
 *
 * Prova a regra do PHB 2014 que esta fundação implementa:
 *
 *   UM SpellCast → N alvos → N saves INDEPENDENTES
 *                → UM roll de dano COMPARTILHADO
 *                → defenses/HP/Concentração/morte POR ALVO.
 *
 * O ponto crítico é a BARREIRA: nenhum dano é aplicado enquanto qualquer save
 * inicial obrigatório estiver aberto. Só o save que fecha a barreira rola o dano
 * (UMA vez) e finaliza o cast — sob lock transacional, então dois últimos saves
 * concorrentes produzem um único roll e uma única finalização.
 *
 * A definição é SINTÉTICA (`test.synthetic-multi-save-damage`): exatamente 3
 * alvos explícitos, Destreza, 2d6 Fogo + 1d6 Frio, sucesso = metade e falha =
 * cheio. NÃO há área/geometria e NENHUMA magia PHB nova (Fireball, Burning
 * Hands, Thunderwave e Chain Lightning continuam fora do escopo).
 */
export async function smokeMultiTargetSaveDamage(baseUrl: string, check: Check): Promise<void> {
  console.log('\n85) Fase 6.6J.2 — multi-target independent save/damage');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const castIds: string[] = [];
  const pendingIds: string[] = [];
  const effectIds: string[] = [];
  const combatIds: string[] = [];

  const request = async (
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; data: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };

  try {
    const makeUser = (label: string, role: 'MASTER' | 'PLAYER' = 'PLAYER') =>
      prisma.user.create({
        data: {
          username: `mt_${label}_${suffix}`,
          displayName: `MT ${label}`,
          passwordHash: 'fixture',
          role,
        },
      });
    const master = await makeUser('m', 'MASTER');
    const ownerA = await makeUser('a');
    const ownerB = await makeUser('b');
    userIds.push(master.id, ownerA.id, ownerB.id);
    const tokenOf = (user: { id: string; username: string; displayName: string; role: string }) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'MASTER' | 'PLAYER',
      });
    const masterToken = tokenOf(master);
    const tokenA = tokenOf(ownerA);
    const tokenB = tokenOf(ownerB);

    const concentrationState = (id: string) => ({
      concentration: {
        id,
        label: 'Prova MT',
        sourceType: 'manual',
        visibility: 'public',
        startedAt: new Date().toISOString(),
      },
    });
    const makeCharacter = async (
      name: string,
      data: Record<string, unknown> = {},
      owner?: { id: string },
    ) => {
      const user = owner ?? (await makeUser(`u${characterIds.length}`));
      if (!owner) userIds.push(user.id);
      const character = await prisma.character.create({
        data: {
          userId: user.id,
          name,
          hpCurrent: 60,
          hpMax: 60,
          speed: 9,
          dexterity: 10,
          wisdom: 10,
          ...data,
        } as never,
      });
      characterIds.push(character.id);
      return character;
    };
    const makeCreature = async (name: string, data: Record<string, unknown> = {}) => {
      const creature = await prisma.creature.create({
        data: {
          name,
          type: 'Elemental',
          hpCurrent: 50,
          hpMax: 50,
          speed: 9,
          dexterity: 1,
          ...data,
        } as never,
      });
      creatureIds.push(creature.id);
      return creature;
    };
    const caster = await prisma.character.create({
      data: {
        userId: master.id,
        name: 'Conjurador MT',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
        classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      } as never,
    });
    characterIds.push(caster.id);

    // =====================================================================
    // A–C — DEFINIÇÃO SINTÉTICA E CONTRATO
    // =====================================================================
    const synthetic = spellExecutionDefinition(SYNTHETIC_MULTI_SAVE_SPELL_ID);
    const resolution = synthetic?.resolution;
    check(
      '85.A) definição sintética: 3 alvos exatos, DEX, 2d6 Fogo + 1d6 Frio, half/full e `damageRollScope: shared`',
      resolution?.kind === 'save-damage' &&
        resolution.ability === 'dexterity' &&
        resolution.outcome.success === 'half' &&
        resolution.outcome.failure === 'full' &&
        resolution.damageRollScope === 'shared' &&
        resolution.damage.components.length === 2 &&
        resolution.damage.components[0]?.type === 'Fogo' &&
        resolution.damage.components[0]?.dice.count === 2 &&
        resolution.damage.components[1]?.type === 'Frio' &&
        resolution.damage.components[1]?.dice.count === 1 &&
        synthetic?.targeting?.minTargets === SYNTHETIC_MULTI_SAVE_TARGETS &&
        synthetic?.targeting?.targetCount.base === SYNTHETIC_MULTI_SAVE_TARGETS &&
        synthetic?.requiresConcentration === false &&
        synthetic?.duration === undefined,
      JSON.stringify(resolution),
    );
    check(
      '85.B) a definição NÃO está no catálogo (nem em repertório, cast-options ou UI)',
      !allSpells().some((spell) => spell.id === SYNTHETIC_MULTI_SAVE_SPELL_ID),
      String(allSpells().length),
    );
    const castOptions = await request(
      `/spells/cast-options/${caster.id}/${SYNTHETIC_MULTI_SAVE_SPELL_ID}`,
      masterToken,
    );
    check(
      '85.C) a magia sintética não é conjurável por rota de produção',
      castOptions.status === 404 || castOptions.status === 409,
      JSON.stringify({ status: castOptions.status, error: castOptions.data?.error }),
    );

    // =====================================================================
    // FIXTURE: UM cast + N pendências (nunca N casts)
    // =====================================================================
    const makeMultiCast = async (
      targets: { kind: 'character' | 'creature'; id: string; dc?: number }[],
      options: { combatId?: string; phase?: 'initial' | 'ongoing' } = {},
    ) => {
      const cast = await prisma.spellCast.create({
        data: {
          spellId: SYNTHETIC_MULTI_SAVE_SPELL_ID,
          casterEntityKind: 'character',
          casterEntityId: caster.id,
          casterLabel: caster.name,
          targets: targets.map((target) => ({ kind: target.kind, id: target.id })) as never,
          targetingSnapshot: {
            maxTargets: SYNTHETIC_MULTI_SAVE_TARGETS,
            targetCount: targets.length,
            rangeFeet: 60,
            validationMode: 'assisted',
            requiresSight: false,
            requiresClearPath: false,
            constraints: [],
          } as never,
          status: 'resolving',
          requiresConcentration: false,
          spellcastingMode: 'derived',
          spellcastingAbility: 'wisdom',
          spellcastingAbilityModifier: 0,
          spellcastingProficiencyBonus: 3,
          spellSaveDc: 15,
          spellLevel: 1,
          castAtLevel: 1,
          ...(options.combatId ? { combatId: options.combatId } : {}),
          operationId: `mt-${randomUUID()}`,
          fingerprint: randomUUID(),
          createdBy: master.id,
        },
      });
      castIds.push(cast.id);
      const pendings = new Map<string, any>();
      for (const target of targets) {
        const key = `${target.kind}:${target.id}`;
        // Alvo repetido no payload canônico = UMA pendência (nunca duas).
        if (pendings.has(key)) continue;
        const pending = await prisma.pendingEffectSave.create({
          data: {
            definitionId: spellDefinitionId(SYNTHETIC_MULTI_SAVE_SPELL_ID),
            spellCastId: cast.id,
            casterEntityKind: 'character',
            casterEntityId: caster.id,
            casterLabel: caster.name,
            targetEntityKind: target.kind,
            targetEntityId: target.id,
            ability: 'dexterity',
            dc: target.dc ?? 15,
            visibility: 'public',
            status: 'pending',
            phase: options.phase ?? 'initial',
            operationId: `${cast.id}:${target.kind}:${target.id}`,
            fingerprint: randomUUID(),
            createdBy: master.id,
          },
        });
        pendingIds.push(pending.id);
        pendings.set(key, pending);
      }
      return { cast, pendings };
    };
    const snapshotOf = async (castId: string) =>
      ((await prisma.spellCast.findUniqueOrThrow({ where: { id: castId } })).resolutionSnapshot ??
        null) as any;
    const resolveWithRolls = (
      pendingId: string,
      total: number,
      values: number[],
      counter?: { n: number },
    ) => {
      let index = 0;
      return resolveSaveDamagePending(pendingId, total, 'Smoke MT', {
        roll: () => {
          if (counter) counter.n += 1;
          return values[index++] ?? 1;
        },
      });
    };
    const rollPending = (token: string, pendingId: string, extra: Record<string, unknown> = {}) =>
      request('/dice/roll', token, {
        kind: 'save',
        dice: [{ sides: 20 }],
        pendingEffectSaveId: pendingId,
        ...extra,
      });

    // =====================================================================
    // D–H — UM CAST, N PENDÊNCIAS, CUSTOS ÚNICOS
    // =====================================================================
    const targetA = await makeCharacter(
      'MT Alvo A',
      {
        dexterity: 30,
        raceResistances: ['Fogo'],
        mechanicalState: concentrationState('mt-a-conc'),
      },
      ownerA,
    );
    const targetB = await makeCharacter(
      'MT Alvo B',
      { dexterity: 1, mechanicalState: concentrationState('mt-b-conc') },
      ownerB,
    );
    const targetC = await makeCreature('MT Alvo NPC', { immunities: ['Fogo'] });
    const main = await makeMultiCast([
      { kind: 'character', id: targetA.id, dc: 1 },
      { kind: 'character', id: targetB.id, dc: 20 },
      { kind: 'creature', id: targetC.id, dc: 20 },
    ]);
    const pendingA = main.pendings.get(`character:${targetA.id}`)!;
    const pendingB = main.pendings.get(`character:${targetB.id}`)!;
    const pendingC = main.pendings.get(`creature:${targetC.id}`)!;

    const mainCastRow = await prisma.spellCast.findUniqueOrThrow({ where: { id: main.cast.id } });
    const mainPendings = await prisma.pendingEffectSave.findMany({
      where: { spellCastId: main.cast.id },
    });
    check(
      '85.D) UM SpellCast e N PendingEffectSaves iniciais (mesmo cast, alvos distintos)',
      (await prisma.spellCast.count({ where: { id: main.cast.id } })) === 1 &&
        mainPendings.length === 3 &&
        mainPendings.every((row) => row.spellCastId === main.cast.id) &&
        mainPendings.every((row) => row.phase === 'initial') &&
        mainPendings.every((row) => row.optional === false) &&
        new Set(mainPendings.map((row) => `${row.targetEntityKind}:${row.targetEntityId}`)).size === 3 &&
        (mainCastRow.targets as any[]).length === 3,
      JSON.stringify(mainPendings.map((row) => row.targetEntityId)),
    );
    check(
      '85.E) custos ÚNICOS: sem slot, sem Ação, sem componentes e sem Concentração do conjurador',
      mainCastRow.castingResourceKind === null &&
        mainCastRow.economyCostKind === null &&
        mainCastRow.requiresConcentration === false &&
        mainCastRow.effectGroupId === null,
      JSON.stringify({
        resource: mainCastRow.castingResourceKind,
        economy: mainCastRow.economyCostKind,
      }),
    );
    check(
      '85.F) a ordem canônica do cast é a ordem do targeting (não a dos cliques)',
      (mainCastRow.targets as any[]).map((item) => item.id).join(',') ===
        [targetA.id, targetB.id, targetC.id].join(','),
      JSON.stringify(mainCastRow.targets),
    );

    // =====================================================================
    // I–L — PRIMEIRO/SEGUNDO SAVE NÃO APLICAM DANO
    // =====================================================================
    const hpA0 = targetA.hpCurrent;
    const hpB0 = targetB.hpCurrent;
    const saveA = await rollPending(tokenA, pendingA.id);
    const afterA = await snapshotOf(main.cast.id);
    const rowA = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingA.id } });
    const staleHpA = await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } });
    check(
      '85.G) primeiro save: resultado persistido, card deixa de pendente, NENHUM dano e cast continua resolving',
      saveA.status === 201 &&
        rowA.status === 'resolved' &&
        rowA.result === 'success' &&
        afterA === null &&
        staleHpA.hpCurrent === hpA0 &&
        (await prisma.spellCast.findUniqueOrThrow({ where: { id: main.cast.id } })).status ===
          'resolving',
      JSON.stringify({ roll: saveA.data?.roll?.total, snapshot: afterA }),
    );
    check(
      '85.H) a pendência guarda SÓ o save (nenhum roll de dano por alvo)',
      JSON.stringify(rowA.resolutionSnapshot ?? {}).includes('"kind":"save-result"') &&
        !JSON.stringify(rowA.resolutionSnapshot ?? {}).includes('"components"'),
      JSON.stringify(rowA.resolutionSnapshot),
    );

    const saveB = await rollPending(tokenB, pendingB.id);
    const rowB = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingB.id } });
    check(
      '85.I) segundo save: falha persistida, ainda SEM dano em A ou B e cast resolving',
      saveB.status === 201 &&
        rowB.status === 'resolved' &&
        rowB.result === 'failure' &&
        (await snapshotOf(main.cast.id)) === null &&
        (await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } })).hpCurrent === hpA0 &&
        (await prisma.character.findUniqueOrThrow({ where: { id: targetB.id } })).hpCurrent === hpB0 &&
        (await prisma.spellCast.findUniqueOrThrow({ where: { id: main.cast.id } })).status ===
          'resolving',
      JSON.stringify({ result: rowB.result }),
    );


    // =====================================================================
    // M–S — ÚLTIMO SAVE FINALIZA: UM ROLL PARA TODOS
    // =====================================================================
    const saveC = await rollPending(masterToken, pendingC.id);
    const mainSnapshot = await snapshotOf(main.cast.id);
    const mainCastAfter = await prisma.spellCast.findUniqueOrThrow({ where: { id: main.cast.id } });
    const fireRoll = mainSnapshot?.damageRoll?.components?.[0];
    const coldRoll = mainSnapshot?.damageRoll?.components?.[1];
    const resultOf = (kind: string, id: string) =>
      (mainSnapshot?.targets ?? []).find(
        (item: any) => item.target.kind === kind && item.target.id === id,
      );
    const resultA = resultOf('character', targetA.id);
    const resultB = resultOf('character', targetB.id);
    const resultC = resultOf('creature', targetC.id);
    check(
      '85.J) último save dispara a finalização: cast `resolved`, resultado `effect` e snapshot com 3 alvos',
      saveC.status === 201 &&
        mainCastAfter.status === 'resolved' &&
        mainCastAfter.outcome === 'effect' &&
        mainSnapshot?.kind === 'save-damage' &&
        (mainSnapshot?.targets ?? []).length === 3 &&
        [resultA, resultB, resultC].every((item) => Boolean(item)),
      JSON.stringify({ outcome: mainCastAfter.outcome, targets: mainSnapshot?.targets?.length }),
    );
    check(
      '85.K) dano rolado UMA vez: 2d6 Fogo + 1d6 Frio = 3 dados no total (nunca 9)',
      fireRoll?.count === 2 &&
        fireRoll?.sides === 6 &&
        fireRoll?.rolls?.length === 2 &&
        coldRoll?.count === 1 &&
        coldRoll?.rolls?.length === 1 &&
        mainSnapshot?.damageRoll?.id === `spell-cast:${main.cast.id}:damage-roll:0` &&
        mainSnapshot?.damageRoll?.rawDamage ===
          [...(fireRoll?.rolls ?? []), ...(coldRoll?.rolls ?? [])].reduce(
            (sum: number, value: number) => sum + value,
            0,
          ),
      JSON.stringify({ fire: fireRoll, cold: coldRoll }),
    );
    check(
      '85.L) TODOS os alvos partem do MESMO dano bruto compartilhado',
      resultA?.rawDamage === mainSnapshot?.damageRoll?.rawDamage &&
        resultB?.rawDamage === mainSnapshot?.damageRoll?.rawDamage &&
        resultC?.rawDamage === mainSnapshot?.damageRoll?.rawDamage,
      JSON.stringify([resultA?.rawDamage, resultB?.rawDamage, resultC?.rawDamage]),
    );
    check(
      '85.M) sucesso = metade (por componente) só em A; falha = cheio em B e C',
      resultA?.save?.success === true &&
        resultA.damageAfterSave ===
          Math.floor((fireRoll?.raw ?? 0) / 2) + Math.floor((coldRoll?.raw ?? 0) / 2) &&
        resultB?.save?.success === false &&
        resultB.damageAfterSave === resultB.rawDamage &&
        resultC?.save?.success === false &&
        resultC.damageAfterSave === resultC.rawDamage,
      JSON.stringify([resultA?.damageAfterSave, resultB?.damageAfterSave, resultC?.damageAfterSave]),
    );
    check(
      '85.N) defenses INDIVIDUAIS depois do save: resistência em A e imunidade em C não afetam B',
      resultA?.components?.[0]?.modifier === 'resistance' &&
        resultA.finalDamage < resultA.damageAfterSave &&
        resultB?.components?.[0]?.modifier === null &&
        resultB?.components?.[1]?.modifier === null &&
        resultB.finalDamage === resultB.damageAfterSave &&
        resultC?.components?.[0]?.modifier === 'immunity' &&
        resultC.components[0]?.applied === 0 &&
        resultC.finalDamage === resultC.components[1]?.afterSave,
      JSON.stringify({
        a: resultA,
        b: resultB?.finalDamage,
        c: resultC,
      }),
    );
    const hpA1 = (await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } })).hpCurrent;
    const hpB1 = (await prisma.character.findUniqueOrThrow({ where: { id: targetB.id } })).hpCurrent;
    const hpC1 = (await prisma.creature.findUniqueOrThrow({ where: { id: targetC.id } })).hpCurrent;
    check(
      '85.O) HP por ALVO: cada um desce pelo SEU dano final (A resistência, B cheio, C imunidade)',
      hpA1 === hpA0 - resultA.finalDamage &&
        hpB1 === hpB0 - resultB.finalDamage &&
        hpC1 === 50 - resultC.finalDamage &&
        new Set([resultA.finalDamage, resultB.finalDamage, resultC.finalDamage]).size > 1,
      JSON.stringify({ a: hpA1, b: hpB1, c: hpC1 }),
    );
    const eventIds = [resultA?.eventId, resultB?.eventId, resultC?.eventId];
    check(
      '85.P) eventId de dano por ALVO (nunca o id do roll compartilhado) e todos distintos',
      resultA?.eventId ===
        `spell-cast:${main.cast.id}:target:character:${targetA.id}:damage` &&
        resultB?.eventId ===
          `spell-cast:${main.cast.id}:target:character:${targetB.id}:damage` &&
        resultC?.eventId ===
          `spell-cast:${main.cast.id}:target:creature:${targetC.id}:damage` &&
        new Set(eventIds).size === 3 &&
        !eventIds.includes(mainSnapshot?.damageRoll?.id),
      JSON.stringify(eventIds),
    );

    const stateA = (await prisma.character.findUniqueOrThrow({ where: { id: targetA.id } }))
      .mechanicalState as any;
    const stateB = (await prisma.character.findUniqueOrThrow({ where: { id: targetB.id } }))
      .mechanicalState as any;
    const concA = stateA?.pendingConcentrationSaves ?? [];
    const concB = stateB?.pendingConcentrationSaves ?? [];
    check(
      '85.Q) Concentração POR ALVO: CD do dano final de cada um e eventId do próprio evento',
      concA.length === 1 &&
        concA[0]?.dc === Math.max(10, Math.floor(resultA.finalDamage / 2)) &&
        concA[0]?.eventId === resultA.eventId &&
        concB.length >= 1 &&
        concB[0]?.dc === Math.max(10, Math.floor(resultB.finalDamage / 2)) &&
        concB[0]?.eventId === resultB.eventId,
      JSON.stringify({ a: concA, b: concB }),
    );
    check(
      '85.R) nenhum EffectInstance, nenhuma duração e nenhuma Concentração do conjurador',
      (await prisma.effectInstance.count({ where: { sourceId: SYNTHETIC_MULTI_SAVE_SPELL_ID } })) ===
        0 &&
        mainCastAfter.effectGroupId === null &&
        mainCastAfter.durationSnapshot === null &&
        (((await prisma.character.findUniqueOrThrow({ where: { id: caster.id } }))
          .mechanicalState as any)?.concentration ?? null) === null,
      String(mainCastAfter.effectGroupId),
    );

    // =====================================================================
    // T–W — RETRY, ORDEM ESTÁVEL, SNAPSHOT IMUTÁVEL
    // =====================================================================
    const retryC = await resolveWithRolls(pendingC.id, 1, [6, 6, 6]);
    check(
      '85.S) retry: `replayed`, ZERO reroll e ZERO dano adicional',
      retryC.replayed === true &&
        retryC.snapshot?.finalDamage === resultC.finalDamage &&
        (await prisma.creature.findUniqueOrThrow({ where: { id: targetC.id } })).hpCurrent === hpC1,
      JSON.stringify({ replayed: retryC.replayed, hp: hpC1 }),
    );
    // Dedupe: o MESMO alvo duas vezes no payload não vira dois eventos de dano.
    const dupTarget = await makeCharacter('MT Duplicado');
    const dupOther = await makeCharacter('MT Duplicado B');
    const dup = await makeMultiCast([
      { kind: 'character', id: dupTarget.id, dc: 1 },
      { kind: 'character', id: dupTarget.id, dc: 1 },
      { kind: 'character', id: dupOther.id, dc: 20 },
    ]);
    await resolveWithRolls(dup.pendings.get(`character:${dupTarget.id}`)!.id, 20, [1, 1, 1]);
    await resolveWithRolls(dup.pendings.get(`character:${dupOther.id}`)!.id, 1, [1, 1, 1]);
    const dupSnapshot = await snapshotOf(dup.cast.id);
    check(
      '85.T1) alvo duplicado no payload: UM resultado por entidade canônica (nunca dois eventos)',
      (dupSnapshot?.targets ?? []).length === 2 &&
        (dupSnapshot?.targets ?? []).map((item: any) => item.target.id).join(',') ===
          [dupTarget.id, dupOther.id].join(','),
      JSON.stringify((dupSnapshot?.targets ?? []).map((item: any) => item.target.id)),
    );
    check(
      '85.T) snapshot ordenado pela ordem canônica do targeting e imutável depois da finalização',
      (mainSnapshot?.targets ?? []).map((item: any) => item.target.id).join(',') ===
        [targetA.id, targetB.id, targetC.id].join(',') &&
        JSON.stringify(await snapshotOf(main.cast.id)) === JSON.stringify(mainSnapshot),
      JSON.stringify((mainSnapshot?.targets ?? []).map((item: any) => item.target.id)),
    );

    // =====================================================================
    // X–Z — NÚMEROS EXATOS (RNG injetado), MULTI-COMPONENTE E VULNERABILIDADE
    // =====================================================================
    const exactA = await makeCharacter('MT Exato A', { raceResistances: ['Fogo'] });
    const exactB = await makeCharacter('MT Exato B');
    const exactC = await makeCreature('MT Exato C', { immunities: ['Fogo'] });
    const exact = await makeMultiCast([
      { kind: 'character', id: exactA.id, dc: 1 },
      { kind: 'character', id: exactB.id, dc: 20 },
      { kind: 'creature', id: exactC.id, dc: 20 },
    ]);
    await resolveWithRolls(exact.pendings.get(`character:${exactA.id}`)!.id, 20, [5, 5, 5]);
    await resolveWithRolls(exact.pendings.get(`character:${exactB.id}`)!.id, 1, [5, 5, 5]);
    await resolveWithRolls(exact.pendings.get(`creature:${exactC.id}`)!.id, 1, [5, 5, 5]);
    const exactSnapshot = await snapshotOf(exact.cast.id);
    const exactResult = (id: string) =>
      (exactSnapshot?.targets ?? []).find((item: any) => item.target.id === id);
    const eA = exactResult(exactA.id);
    const eB = exactResult(exactB.id);
    const eC = exactResult(exactC.id);
    check(
      '85.U) números exatos com RNG injetado: bruto 15 (10 Fogo + 5 Frio) igual para os três',
      exactSnapshot?.damageRoll?.components?.[0]?.rolls?.join(',') === '5,5' &&
        exactSnapshot?.damageRoll?.components?.[1]?.rolls?.join(',') === '5' &&
        eA?.rawDamage === 15 &&
        eB?.rawDamage === 15 &&
        eC?.rawDamage === 15,
      JSON.stringify(exactSnapshot?.damageRoll),
    );
    check(
      '85.V) A (sucesso + resistência Fogo) = 4, B (falha) = 15 e C (falha + imunidade Fogo) = 5',
      eA?.damageAfterSave === 7 &&
        eA?.finalDamage === 4 &&
        eB?.damageAfterSave === 15 &&
        eB?.finalDamage === 15 &&
        eC?.damageAfterSave === 15 &&
        eC?.finalDamage === 5,
      JSON.stringify([eA?.finalDamage, eB?.finalDamage, eC?.finalDamage]),
    );

    const vulnTarget = await makeCreature('MT Vulnerável', { vulnerabilities: ['Fogo'] });
    const vulnB = await makeCreature('MT Comum');
    const vulnC = await makeCreature('MT Comum 2');
    const vuln = await makeMultiCast([
      { kind: 'creature', id: vulnTarget.id, dc: 1 },
      { kind: 'creature', id: vulnB.id, dc: 20 },
      { kind: 'creature', id: vulnC.id, dc: 20 },
    ]);
    await resolveWithRolls(vuln.pendings.get(`creature:${vulnTarget.id}`)!.id, 20, [5, 5, 5]);
    await resolveWithRolls(vuln.pendings.get(`creature:${vulnB.id}`)!.id, 1, [5, 5, 5]);
    await resolveWithRolls(vuln.pendings.get(`creature:${vulnC.id}`)!.id, 1, [5, 5, 5]);
    const vulnSnapshot = await snapshotOf(vuln.cast.id);
    const vulnResult = (vulnSnapshot?.targets ?? []).find(
      (item: any) => item.target.id === vulnTarget.id,
    );
    check(
      '85.W) vulnerabilidade por alvo: sucesso (5 Fogo → 5 → 10) + 2 Frio = 12 final, sem tocar nos outros',
      vulnResult?.components?.[0]?.modifier === 'vulnerability' &&
        vulnResult?.finalDamage === 12 &&
        (vulnSnapshot?.targets ?? []).find((item: any) => item.target.id === vulnB.id)
          ?.finalDamage === 15,
      JSON.stringify(vulnResult),
    );

    // =====================================================================
    // AA–AC — CONCORRÊNCIA DOS DOIS ÚLTIMOS SAVES
    // =====================================================================
    const raceA = await makeCharacter('MT Corrida A');
    const raceB = await makeCharacter('MT Corrida B');
    const raceC = await makeCharacter('MT Corrida C');
    const race = await makeMultiCast([
      { kind: 'character', id: raceA.id, dc: 1 },
      { kind: 'character', id: raceB.id, dc: 20 },
      { kind: 'character', id: raceC.id, dc: 20 },
    ]);
    const hpRace0 = [raceA.hpCurrent, raceB.hpCurrent, raceC.hpCurrent];
    await resolveWithRolls(race.pendings.get(`character:${raceA.id}`)!.id, 20, [1, 1, 1]);
    const counter = { n: 0 };
    const [raceLeft, raceRight] = await Promise.all([
      resolveWithRolls(race.pendings.get(`character:${raceB.id}`)!.id, 1, [5, 5, 5], counter),
      resolveWithRolls(race.pendings.get(`character:${raceC.id}`)!.id, 1, [5, 5, 5], counter),
    ]);
    const raceSnapshot = await snapshotOf(race.cast.id);
    const raceCastRow = await prisma.spellCast.findUniqueOrThrow({ where: { id: race.cast.id } });
    const hpRace = await Promise.all(
      [raceA.id, raceB.id, raceC.id].map(
        async (id) =>
          (await prisma.character.findUniqueOrThrow({ where: { id }, select: { hpCurrent: true } }))
            .hpCurrent,
      ),
    );
    check(
      '85.X) dois últimos saves CONCORRENTES: UM roll compartilhado (3 dados), UMA finalização',
      counter.n === 3 &&
        [raceLeft, raceRight].some((item) => item.castCompleted) &&
        raceCastRow.status === 'resolved' &&
        (raceSnapshot?.targets ?? []).length === 3 &&
        raceSnapshot?.damageRoll?.components?.flatMap((item: any) => item.rolls).length === 3,
      JSON.stringify({ rolled: counter.n, snapshotRolls: raceSnapshot?.damageRoll }),
    );
    check(
      '85.Y) cada alvo recebeu dano UMA vez (nenhum HP aplicado em dobro)',
      hpRace[0] === hpRace0[0]! - (raceSnapshot?.targets?.[0]?.finalDamage ?? 0) &&
        hpRace[1] === hpRace0[1]! - (raceSnapshot?.targets?.[1]?.finalDamage ?? 0) &&
        hpRace[2] === hpRace0[2]! - (raceSnapshot?.targets?.[2]?.finalDamage ?? 0),
      JSON.stringify({ before: hpRace0, after: hpRace }),
    );

    // =====================================================================
    // AD–AE — ALVO INDISPONÍVEL NÃO TRAVA OS DEMAIS
    // =====================================================================
    const goneA = await makeCharacter('MT Sumido A');
    const goneB = await makeCharacter('MT Sumido B');
    const goneC = await makeCharacter('MT Sumido C');
    const gone = await makeMultiCast([
      { kind: 'character', id: goneA.id, dc: 1 },
      { kind: 'character', id: goneB.id, dc: 20 },
      { kind: 'character', id: goneC.id, dc: 20 },
    ]);
    await resolveWithRolls(gone.pendings.get(`character:${goneA.id}`)!.id, 20, [4, 4, 4]);
    // Cancelamento administrativo da pendência do C (não é morte nem refund).
    await prisma.pendingEffectSave.update({
      where: { id: gone.pendings.get(`character:${goneC.id}`)!.id },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    const goneResult = await resolveWithRolls(
      gone.pendings.get(`character:${goneB.id}`)!.id,
      1,
      [4, 4, 4],
    );
    const goneSnapshot = await snapshotOf(gone.cast.id);
    const goneCResult = (goneSnapshot?.targets ?? []).find(
      (item: any) => item.target.id === goneC.id,
    );
    check(
      '85.Z) pendência cancelada é TERMINAL para a barreira: C fica `unavailable` e A/B recebem normalmente',
      goneResult.castCompleted &&
        goneCResult?.status === 'unavailable' &&
        goneCResult?.finalDamage === 0 &&
        (goneSnapshot?.targets ?? []).find((item: any) => item.target.id === goneB.id)
          ?.finalDamage > 0,
      JSON.stringify(goneSnapshot?.targets),
    );
    const goneCastRow = await prisma.spellCast.findUniqueOrThrow({ where: { id: gone.cast.id } });
    check(
      '85.AA) o cast com um alvo indisponível ainda fecha (nunca fica eternamente `resolving`)',
      goneCastRow.status === 'resolved' &&
        goneCastRow.outcome === 'effect' &&
        goneCastRow.resolutionSnapshot !== null,
      JSON.stringify({ status: goneCastRow.status, outcome: goneCastRow.outcome }),
    );

    // 0 PV por ALVO: só quem chega a 0 abre Testes contra a Morte.
    const deathA = await makeCharacter('MT Morte A');
    const deathB = await makeCharacter('MT Morte B', { hpCurrent: 3, hpMax: 60 });
    const deathC = await makeCharacter('MT Morte C');
    const deathCast = await makeMultiCast([
      { kind: 'character', id: deathA.id, dc: 1 },
      { kind: 'character', id: deathB.id, dc: 20 },
      { kind: 'character', id: deathC.id, dc: 20 },
    ]);
    await resolveWithRolls(deathCast.pendings.get(`character:${deathA.id}`)!.id, 20, [5, 5, 5]);
    await resolveWithRolls(deathCast.pendings.get(`character:${deathB.id}`)!.id, 1, [5, 5, 5]);
    await resolveWithRolls(deathCast.pendings.get(`character:${deathC.id}`)!.id, 1, [5, 5, 5]);
    const deathRows = await prisma.character.findMany({
      where: { id: { in: [deathA.id, deathB.id, deathC.id] } },
    });
    const deathRow = (id: string) => deathRows.find((row) => row.id === id);
    check(
      '85.AA1) a 0 PV/Testes contra a Morte só no alvo que chegou a 0 (A e C seguem de pé)',
      deathRow(deathB.id)?.hpCurrent === 0 &&
        (deathRow(deathB.id)?.deathState as any)?.deathSaves === true &&
        (deathRow(deathA.id)?.hpCurrent ?? 0) > 0 &&
        (deathRow(deathC.id)?.hpCurrent ?? 0) > 0 &&
        (deathRow(deathA.id)?.deathState as any)?.deathSaves !== true &&
        (deathRow(deathC.id)?.deathState as any)?.deathSaves !== true,
      JSON.stringify({
        a: deathRow(deathA.id)?.hpCurrent,
        b: deathRow(deathB.id)?.hpCurrent,
        c: deathRow(deathC.id)?.hpCurrent,
      }),
    );

    // =====================================================================
    // AB–AD — BLESS, DODGE E PARALYZED INDIVIDUAIS
    // =====================================================================
    const blessA = await makeCharacter('MT Bless A');
    const blessB = await makeCharacter('MT Bless B');
    const blessC = await makeCharacter('MT Bless C');
    const blessEffect = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'spell.bless',
        label: BLESS_LABEL,
        sourceType: 'spell',
        sourceId: 'bless',
        sourceEntityKind: 'character',
        sourceEntityId: caster.id,
        sourceLabel: caster.name,
        modifiers: blessModifiers() as never,
        conditions: [] as never,
        targetEntityKind: 'character',
        targetEntityId: blessA.id,
        visibility: 'public',
        status: 'active',
      },
    });
    effectIds.push(blessEffect.id);
    const bless = await makeMultiCast([
      { kind: 'character', id: blessA.id, dc: 12 },
      { kind: 'character', id: blessB.id, dc: 12 },
      { kind: 'character', id: blessC.id, dc: 12 },
    ]);
    // Mestre rola as três (é ferramenta de prova); a diferença é SÓ o modificador
    // opcional escolhido no save de A.
    const blessRollA = await rollPending(masterToken, bless.pendings.get(`character:${blessA.id}`)!.id, {
      selectedEffectModifiers: [`${blessEffect.id}:save`],
    });
    const blessRollB = await rollPending(masterToken, bless.pendings.get(`character:${blessB.id}`)!.id);
    const blessRollC = await rollPending(masterToken, bless.pendings.get(`character:${blessC.id}`)!.id);
    check(
      '85.AB) Bless é INDIVIDUAL: só o save de A recebe o +1d4 opcional',
      (blessRollA.data?.roll?.effectModifiers?.dice ?? []).length === 1 &&
        (blessRollB.data?.roll?.effectModifiers?.dice ?? []).length === 0 &&
        (blessRollC.data?.roll?.effectModifiers?.dice ?? []).length === 0,
      JSON.stringify({
        a: blessRollA.data?.roll?.effectModifiers,
        b: blessRollB.data?.roll?.effectModifiers,
      }),
    );

    const parA = await makeCharacter('MT Paral A');
    const parB = await makeCharacter('MT Paral B', {
      mechanicalState: {
        conditions: [
          {
            id: 'mt-paralyzed',
            condition: 'paralyzed',
            sourceType: 'manual',
            sourceLabel: 'Smoke',
            appliedAt: new Date().toISOString(),
          },
        ],
      },
    });
    const parC = await makeCharacter('MT Paral C');
    const par = await makeMultiCast([
      { kind: 'character', id: parA.id, dc: 20 },
      { kind: 'character', id: parB.id, dc: 20 },
      { kind: 'character', id: parC.id, dc: 20 },
    ]);
    const parRollA = await rollPending(masterToken, par.pendings.get(`character:${parA.id}`)!.id);
    const parRollB = await rollPending(masterToken, par.pendings.get(`character:${parB.id}`)!.id);
    const parRollC = await rollPending(masterToken, par.pendings.get(`character:${parC.id}`)!.id);
    const parSnapshot = await snapshotOf(par.cast.id);
    const parResultB = (parSnapshot?.targets ?? []).find((item: any) => item.target.id === parB.id);
    check(
      '85.AC) Paralyzed é INDIVIDUAL: só o save de B auto-falha (A e C rolam normalmente)',
      parRollB.data?.roll?.autoFail === true &&
        parRollA.data?.roll?.autoFail !== true &&
        parRollC.data?.roll?.autoFail !== true &&
        parResultB?.save?.success === false,
      JSON.stringify({ a: parRollA.data?.roll?.autoFail, b: parRollB.data?.roll?.autoFail }),
    );

    // =====================================================================
    // AE–AG — PRIVACIDADE DE EFFECT PRIVADO
    // =====================================================================
    const secretTarget = await makeCharacter('MT Segredo', { dexterity: 10 });
    const secretB = await makeCharacter('MT Segredo B');
    const secretC = await makeCharacter('MT Segredo C');
    const secretEffect = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'test.private-save-bonus',
        label: 'Segredo do Mestre',
        sourceType: 'manual',
        sourceId: 'test',
        sourceEntityKind: 'character',
        sourceEntityId: caster.id,
        sourceLabel: 'Segredo do Mestre',
        modifiers: [
          { kind: 'roll-flat', roll: 'save', value: 2, key: 'secret' },
        ] as never,
        conditions: [] as never,
        targetEntityKind: 'character',
        targetEntityId: secretTarget.id,
        visibility: 'private',
        status: 'active',
      },
    });
    effectIds.push(secretEffect.id);
    const secret = await makeMultiCast([
      { kind: 'character', id: secretTarget.id, dc: 30 },
      { kind: 'character', id: secretB.id, dc: 30 },
      { kind: 'character', id: secretC.id, dc: 30 },
    ]);
    const secretRoll = await rollPending(masterToken, secret.pendings.get(`character:${secretTarget.id}`)!.id);
    // Fecha a barreira do cast de privacidade (e o banco libera o conjurador).
    await rollPending(masterToken, secret.pendings.get(`character:${secretB.id}`)!.id);
    await rollPending(masterToken, secret.pendings.get(`character:${secretC.id}`)!.id);
    check(
      '85.AD) Effect privado aplica a mecânica sem vazar rótulo (o servidor filtra, não o CSS)',
      secretRoll.status === 201 &&
        !JSON.stringify(secretRoll.data?.roll ?? {}).includes('Segredo do Mestre') &&
        (await prisma.effectInstance.findUniqueOrThrow({ where: { id: secretEffect.id } })).status ===
          'active',
      JSON.stringify(secretRoll.data?.roll?.effectModifiers),
    );

    // =====================================================================
    // AH–AL — CARDS, OWNERSHIP E PRIVACIDADE EM COMBATE
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
              ownerUserId: master.id,
              name: caster.name,
              initiative: 30,
              initiativeRoll: 20,
              dexterityMod: 0,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
            {
              kind: 'CHARACTER',
              characterId: targetA.id,
              ownerUserId: ownerA.id,
              name: targetA.name,
              initiative: 20,
              initiativeRoll: 15,
              dexterityMod: 10,
            },
            {
              kind: 'CHARACTER',
              characterId: targetB.id,
              ownerUserId: ownerB.id,
              name: targetB.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: -5,
            },
            {
              kind: 'NPC',
              creatureId: targetC.id,
              name: targetC.name,
              initiative: 5,
              initiativeRoll: 5,
              dexterityMod: -5,
              hpCurrent: 50,
              hpMax: 50,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);
    const combatCast = await makeMultiCast(
      [
        { kind: 'character', id: targetA.id, dc: 12 },
        { kind: 'character', id: targetB.id, dc: 12 },
        { kind: 'combatant', id: combat.combatants.find((item) => item.creatureId === targetC.id)!.id, dc: 12 } as never,
      ],
      { combatId: combat.id },
    );
    const cardsA = await request(`/combat/${combat.id}/resolution-requests`, tokenA);
    const cardsB = await request(`/combat/${combat.id}/resolution-requests`, tokenB);
    const cardsMaster = await request(`/combat/${combat.id}/resolution-requests`, masterToken);
    const spellCards = (payload: any) =>
      (payload?.requests ?? []).filter((item: any) => item.kind === 'spell-saving-throw');
    check(
      '85.AE) um card por pendência: cada PLAYER recebe só o PRÓPRIO e o Mestre recebe NPC + personagens',
      spellCards(cardsA.data).length === 1 &&
        spellCards(cardsA.data)[0]?.reference?.pendingId ===
          combatCast.pendings.get(`character:${targetA.id}`)!.id &&
        spellCards(cardsB.data).length === 1 &&
        spellCards(cardsB.data)[0]?.reference?.pendingId ===
          combatCast.pendings.get(`character:${targetB.id}`)!.id &&
        spellCards(cardsMaster.data).length === 3,
      JSON.stringify({
        a: spellCards(cardsA.data).length,
        b: spellCards(cardsB.data).length,
        m: spellCards(cardsMaster.data).length,
      }),
    );

    const combatVersion = async () =>
      (await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } })).version;
    const nextTurn = async () =>
      request('/combat/next-turn', masterToken, {
        combatId: combat.id,
        expectedVersion: await combatVersion(),
        operationId: randomUUID(),
      });
    const blockOne = await nextTurn();
    await rollPending(tokenA, combatCast.pendings.get(`character:${targetA.id}`)!.id);
    const blockTwo = await nextTurn();
    await rollPending(tokenB, combatCast.pendings.get(`character:${targetB.id}`)!.id);
    await rollPending(masterToken, combatCast.pendings.get('combatant:' + combat.combatants.find((item) => item.creatureId === targetC.id)!.id)!.id);
    const released = await nextTurn();
    check(
      '85.AF) `SPELL_RESOLUTION_PENDING`: 3/3 e 1/3 saves iniciais bloqueiam o turno; 3/3 resolvidos liberam',
      blockOne.status === 409 &&
        blockOne.data?.error === 'SPELL_RESOLUTION_PENDING' &&
        blockTwo.status === 409 &&
        blockTwo.data?.error === 'SPELL_RESOLUTION_PENDING' &&
        released.status === 200,
      JSON.stringify({
        one: blockOne.data?.error,
        two: blockTwo.data?.error,
        released: released.status,
      }),
    );

    // Um save REPETIDO (`ongoing`) não pode ser confundido com a resolução inicial.
    const ongoingCast = await makeMultiCast(
      [{ kind: 'character', id: targetA.id, dc: 12 }],
      { combatId: combat.id, phase: 'ongoing' },
    );    const ongoingTurn = await nextTurn();
    check(
      '85.AG) pendência `ongoing` NÃO usa `SPELL_RESOLUTION_PENDING` (o blocker de fim de turno continua separado)',
      ongoingTurn.data?.error !== 'SPELL_RESOLUTION_PENDING',
      JSON.stringify(ongoingTurn.data?.error),
    );
    // Encerra a conjuração de prova antes de abrir a próxima (o banco garante UM
    // cast `resolving` por conjurador).
    await prisma.pendingEffectSave.updateMany({
      where: { spellCastId: ongoingCast.cast.id },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    await prisma.spellCast.update({
      where: { id: ongoingCast.cast.id },
      data: { status: 'cancelled', outcome: 'cancelled', resolvedAt: new Date() },
    });

    // Esquiva é INDIVIDUAL: só o alvo que está dodging ganha vantagem no save.
    const dodgingCombatant = combat.combatants.find((item) => item.characterId === targetA.id)!;
    await prisma.combatant.update({
      where: { id: dodgingCombatant.id },
      data: { turnEconomy: { dodging: true } as never },
    });
    const dodgeCast = await makeMultiCast(
      [
        { kind: 'character', id: targetA.id, dc: 20 },
        { kind: 'character', id: targetB.id, dc: 20 },
        { kind: 'character', id: exactA.id, dc: 20 },
      ],
      { combatId: combat.id },
    );
    const dodgeRollA = await rollPending(
      masterToken,
      dodgeCast.pendings.get(`character:${targetA.id}`)!.id,
    );
    const dodgeRollB = await rollPending(
      masterToken,
      dodgeCast.pendings.get(`character:${targetB.id}`)!.id,
    );
    await rollPending(masterToken, dodgeCast.pendings.get(`character:${exactA.id}`)!.id);
    check(
      '85.AG1) Esquiva é INDIVIDUAL: só o save de A ganha vantagem (B e C rolam normal)',
      dodgeRollA.data?.roll?.advantage === true &&
        dodgeRollA.data?.roll?.dice?.length === 2 &&
        dodgeRollB.data?.roll?.advantage !== true,
      JSON.stringify({
        a: dodgeRollA.data?.roll?.advantage,
        b: dodgeRollB.data?.roll?.advantage,
      }),
    );

    // =====================================================================
    // AM–AN — NENHUMA SPELL REAL, NENHUMA ÁREA, LIMPEZA
    // =====================================================================
    check(
      '85.AH) nenhuma magia PHB nova nem área/geometria entraram com esta prova',
      ['fireball', 'burning-hands', 'thunderwave', 'chain-lightning', 'ice-knife'].every(
        (id) => spellExecutionDefinition(id) === null,
      ) &&
        spellExecutionDefinition(SYNTHETIC_MULTI_SAVE_SPELL_ID) !== null &&
        !allSpells().some((spell) => spell.id === SYNTHETIC_MULTI_SAVE_SPELL_ID),
      String(SYNTHETIC_MULTI_SAVE_SPELL_ID),
    );
    check(
      '85.AI) todos os casts da prova usaram a MESMA definição sintética (nada de N casts por alvo)',
      (await prisma.spellCast.count({ where: { id: { in: castIds } } })) === castIds.length &&
        (await prisma.spellCast.count({
          where: { id: { in: castIds }, spellId: SYNTHETIC_MULTI_SAVE_SPELL_ID },
        })) === castIds.length,
      String(castIds.length),
    );
  } finally {
    // Cleanup SOMENTE do que esta execução criou.
    try {
      if (pendingIds.length > 0) {
        await prisma.pendingEffectSave.deleteMany({ where: { id: { in: pendingIds } } });
      }
      if (castIds.length > 0) {
        await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
        await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
      }
      if (effectIds.length > 0) {
        await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
      }
      if (combatIds.length > 0) {
        await prisma.combatOperation.deleteMany({ where: { combatId: { in: combatIds } } });
        await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
      }
      if (creatureIds.length > 0) {
        await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
      }
      if (characterIds.length > 0) {
        await prisma.effectInstance.deleteMany({
          where: {
            OR: [
              { targetEntityId: { in: characterIds } },
              { sourceEntityId: { in: characterIds } },
            ],
          },
        });
        await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      }
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      const residue = await prisma.spellCast.count({ where: { id: { in: castIds } } });
      console.log(`[smoke-multi-target-save-damage] resíduo de casts: ${residue}`);
    } catch (error) {
      console.error('[smoke-multi-target-save-damage] falha na limpeza:', error);
    }
  }
}
