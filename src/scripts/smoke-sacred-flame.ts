import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { getSpell } from '../modules/shared/spells/index.js';
import { scaledDiceCount } from '../modules/shared/spells/cantrip-scaling.js';
import {
  SACRED_FLAME_BASE_DICE,
  SACRED_FLAME_DAMAGE_TYPE,
  SACRED_FLAME_LABEL,
  SACRED_FLAME_SCALING,
  SACRED_FLAME_SPELL_ID,
} from '../modules/spells/execution/sacred-flame.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { spellDefinitionId } from '../modules/spells/execution/spell-execution-definition.js';
import {
  characterLevelOf,
  creatureSpellcastingProfile,
} from '../modules/spells/execution/spellcasting-source.js';
import { cantripScalingLevelOf } from '../modules/spells/execution/cantrip-scaling.service.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import { grantCastingComponents, seedSpellRepertoire } from './spell-slot-fixtures.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const EVIDENCE = { withinRange: true, sight: true, clearPath: true, groupDistance: true };

/**
 * FASE 6.6I.2 — SMOKE DEDICADO DA CHAMA SAGRADA.
 *
 * A PRIMEIRA magia real de dano por salvaguarda. Prova, ponta a ponta:
 *  • catálogo PHB 2014 + autorização de Clérigo + truque (sem espaço);
 *  • V/S (sem M), Ação, 60 pés, UMA criatura visível, alvo máximo 1;
 *  • PendingEffectSave de Destreza → card GENÉRICO no registro do combate;
 *  • sucesso = zero dano; falha = dano radiante rolado no servidor;
 *  • escalonamento pelo nível TOTAL de personagem (1/5/11/17 e multiclasse),
 *    nunca por nível de classe nem por ND;
 *  • defesas (resistência/imunidade) pelo núcleo compartilhado 6.6I.1;
 *  • Concentração com o MESMO `eventId` determinístico do dano;
 *  • retry não rola de novo, Action Economy recusa o segundo cast e o 0 PV usa
 *    o lifecycle de morte existente;
 *  • NENHUM EffectInstance e NENHUM espaço gasto.
 *
 * Fixtures próprias e descartáveis (regra do AGENTS.md): nenhuma conta/personagem
 * real da campanha é lida ou alterada.
 */
export async function smokeSacredFlame(baseUrl: string, check: Check): Promise<void> {
  console.log('\n81) Fase 6.6I.2 — Chama Sagrada (save-damage real PHB 2014)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
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
    // =====================================================================
    // A–F/M/N — CATÁLOGO, DEFINIÇÃO, COMPONENTES, TARGETING E SCALING (puro)
    // =====================================================================
    const spell = getSpell(SACRED_FLAME_SPELL_ID);
    const definition = spellExecutionDefinition(SACRED_FLAME_SPELL_ID);
    const resolution = definition?.resolution;
    check(
      '81.A) catálogo PHB 2014: truque de Evocação, 1 ação, 18 m, V/S (sem M), instantânea',
      Boolean(spell) &&
        spell!.level === 0 &&
        spell!.school === 'evocation' &&
        spell!.castingTimeKind === 'action' &&
        spell!.rangeMeters === 18 &&
        spell!.components.verbal &&
        spell!.components.somatic &&
        !spell!.components.material &&
        spell!.duration === 'Instantânea' &&
        spell!.concentration === false,
      JSON.stringify(spell),
    );
    check(
      '81.B) execução declarativa `save-damage`, Destreza, sucesso sem dano e sem Effect Definition',
      definition?.spellId === SACRED_FLAME_SPELL_ID &&
        resolution?.kind === 'save-damage' &&
        resolution.ability === 'dexterity' &&
        resolution.onSuccess === 'none' &&
        !('effectDefinitionId' in (resolution ?? {})) &&
        resolution.damage.type === SACRED_FLAME_DAMAGE_TYPE &&
        definition.requiresConcentration === false &&
        !definition.duration,
      JSON.stringify(definition),
    );
    check(
      '81.C) alvo: UMA criatura, 60 pés, exige visão, sem filtro de tipo e sem restrição de grupo',
      definition?.targeting.targetCount.base === 1 &&
        definition.targeting.targetCount.additionalPerSlotLevel === 0 &&
        definition.targeting.minTargets === 1 &&
        definition.targeting.range.kind === 'distance' &&
        definition.targeting.range.feet === 60 &&
        definition.targeting.requiresSight &&
        definition.targeting.filters.length === 0 &&
        definition.targeting.groupConstraints.length === 0,
      JSON.stringify(definition?.targeting),
    );
    check(
      '81.D) cobertura não é inventada: só o metadado PHB `ignoreSaveCover`',
      resolution?.kind === 'save-damage' && resolution.ignoreSaveCover === true,
      JSON.stringify(resolution),
    );
    const scalingCases: Array<[number, number]> = [
      [1, 1], [4, 1], [5, 2], [10, 2], [11, 3], [16, 3], [17, 4], [20, 4],
    ];
    check(
      '81.M) escalonamento por nível TOTAL: 1/4→1d8, 5/10→2d8, 11/16→3d8, 17/20→4d8',
      scalingCases.every(([level, dice]) => scaledDiceCount(SACRED_FLAME_SCALING, level) === dice) &&
        SACRED_FLAME_BASE_DICE.count === 1 &&
        SACRED_FLAME_BASE_DICE.sides === 8,
      JSON.stringify(scalingCases.map(([level]) => scaledDiceCount(SACRED_FLAME_SCALING, level))),
    );
    check(
      '81.N) multiclasse Clérigo 1 / Guerreiro 4 = nível total 5 → 2d8 (não 1d8)',
      characterLevelOf([
        { classKey: 'cleric', subclass: '', level: 1 },
        { classKey: 'fighter', subclass: '', level: 4 },
      ]) === 5 &&
        scaledDiceCount(SACRED_FLAME_SCALING, 5) === 2,
      String(characterLevelOf([
        { classKey: 'cleric', subclass: '', level: 1 },
        { classKey: 'fighter', subclass: '', level: 4 },
      ])),
    );

    // =====================================================================
    // FIXTURES PRÓPRIAS
    // =====================================================================
    const makeUser = (label: string, role: 'MASTER' | 'PLAYER' = 'PLAYER') =>
      prisma.user.create({
        data: {
          username: `sf_${label}_${suffix}`,
          displayName: `SF ${label}`,
          passwordHash: 'fixture',
          role,
        },
      });
    const master = await makeUser('m', 'MASTER');
    const ownerLow = await makeUser('low');
    const ownerHigh = await makeUser('high');
    const ownerDexHigh = await makeUser('dexh');
    const ownerDexLow = await makeUser('dexl');
    const ownerMulti = await makeUser('multi');
    const ownerWizard = await makeUser('wiz');
    const ownerBlocked = await makeUser('block');
    const ownerTarget2 = await makeUser('t2');
    const ownerImm = await makeUser('imm');
    const ownerRes = await makeUser('res');
    userIds.push(
      master.id, ownerLow.id, ownerHigh.id, ownerDexHigh.id,
      ownerDexLow.id, ownerMulti.id, ownerWizard.id, ownerBlocked.id, ownerTarget2.id,
      ownerImm.id, ownerRes.id,
    );
    const tokenOf = (user: { id: string; username: string; displayName: string; role: string }) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'MASTER' | 'PLAYER',
      });
    const masterToken = tokenOf(master);
    const tokenLow = tokenOf(ownerLow);
    const tokenDexHigh = tokenOf(ownerDexHigh);
    const tokenDexLow = tokenOf(ownerDexLow);

    const makeCharacter = (
      name: string,
      userId: string,
      data: Record<string, unknown> = {},
    ) =>
      prisma.character.create({
        data: {
          userId,
          name,
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          dexterity: 10,
          wisdom: 10,
          classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
          ...data,
        } as never,
      });

    const casterLow = await makeCharacter('Clérigo DC baixa', ownerLow.id, { wisdom: 1 });
    const targetHigh = await makeCharacter('Alvo Destreza alta', ownerDexHigh.id, { dexterity: 20 });
    const casterHigh = await makeCharacter('Clérigo DC alta', ownerHigh.id, { wisdom: 20 });
    const targetLow = await makeCharacter('Alvo Destreza baixa', ownerDexLow.id, { dexterity: 1, hpCurrent: 60, hpMax: 60 });
    const multi = await makeCharacter('Clérigo/Guerreiro', ownerMulti.id, {
      wisdom: 20,
      classes: [
        { classKey: 'cleric', subclass: '', level: 1 },
        { classKey: 'fighter', subclass: '', level: 4 },
      ],
    });
    const wizard = await makeCharacter('Mago sem lista', ownerWizard.id, {
      intelligence: 16,
      wisdom: 10,
      classes: [{ classKey: 'wizard', subclass: '', level: 1 }],
    });
    const blocked = await makeCharacter('Mãos ocupadas', ownerBlocked.id, {
      wisdom: 20,
      // DUAS armas ocupam as DUAS mãos: S (sem M) não tem mão livre.
      inventory: [
        {
          id: `sf-sword-a-${suffix}`,
          name: 'Espada Longa',
          description: '',
          quantity: 1,
          weight: 0,
          slot: 'hand1',
          backpackX: null,
          backpackY: null,
          imageUrl: '',
          itemId: '',
          category: 'Arma',
          rarity: null,
          requiresAttunement: false,
          attuned: false,
          details: { properties: [] },
          campSupply: { enabled: false, value: 0 },
        },
        {
          id: `sf-sword-b-${suffix}`,
          name: 'Espada Curta',
          description: '',
          quantity: 1,
          weight: 0,
          slot: 'hand2',
          backpackX: null,
          backpackY: null,
          imageUrl: '',
          itemId: '',
          category: 'Arma',
          rarity: null,
          requiresAttunement: false,
          attuned: false,
          details: { properties: [] },
          campSupply: { enabled: false, value: 0 },
        },
      ],
    });
    const target2 = await makeCharacter('Segundo alvo', ownerTarget2.id, { dexterity: 1 });
    const casterImm = await makeCharacter('Clérigo da imunidade', ownerImm.id, { wisdom: 20 });
    const casterRes = await makeCharacter('Clérigo da resistência', ownerRes.id, { wisdom: 20 });
    characterIds.push(
      casterLow.id, targetHigh.id, casterHigh.id, targetLow.id,
      multi.id, wizard.id, blocked.id, target2.id, casterImm.id, casterRes.id,
    );

    const clericCasters = [casterLow.id, casterHigh.id, multi.id, blocked.id];
    const casters = [...clericCasters, casterImm.id, casterRes.id];
    await grantCastingComponents({ characters: casters });
    for (const characterId of casters) {
      await seedSpellRepertoire({
        characterId,
        classKey: 'cleric',
        spellIds: [SACRED_FLAME_SPELL_ID],
      });
    }

    const resistant = await prisma.creature.create({
      data: {
        name: 'Elemental Resistente',
        type: 'Elemental',
        hpCurrent: 50,
        hpMax: 50,
        speed: 9,
        dexterity: 1,
        resistances: [SACRED_FLAME_DAMAGE_TYPE],
      },
    });
    const immune = await prisma.creature.create({
      data: {
        name: 'Elemental Imune',
        type: 'Elemental',
        hpCurrent: 50,
        hpMax: 50,
        speed: 9,
        dexterity: 1,
        immunities: [SACRED_FLAME_DAMAGE_TYPE],
      },
    });
    const statblock = await prisma.creature.create({
      data: {
        name: 'NPC sem nível de truque',
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        dexterity: 1,
        spellcastingProfile: { ability: 'wisdom', saveDc: 13 },
      },
    });
    creatureIds.push(resistant.id, immune.id, statblock.id);

    const cast = (
      body: Record<string, unknown>,
      token = masterToken,
      path = '/spells/cast-proof',
    ) =>
      request(path, token, {
        operationId: randomUUID(),
        spellId: SACRED_FLAME_SPELL_ID,
        ...body,
      });
    const rollPending = (token: string, pendingId: string) =>
      request('/dice/roll', token, {
        kind: 'save',
        dice: [{ sides: 20 }],
        pendingEffectSaveId: pendingId,
        label: 'Salvaguarda de Destreza',
      });
    const readMechanical = async (kind: string, id: string) =>
      (await request(`/mechanical/${kind}/${id}`, masterToken)).data.mechanical;

    // =====================================================================
    // G–I + J + V — PENDÊNCIA, CARD GENÉRICO E SUCESSO SEM DANO
    // =====================================================================
    const okCast = await cast({
      caster: { kind: 'character', id: casterLow.id },
      targets: [{ kind: 'character', id: targetHigh.id }],
      spatialConfirmation: EVIDENCE,
    });
    const okPendingId = okCast.data?.pendingId as string | null;
    const okPending = okPendingId
      ? await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: okPendingId } })
      : null;
    check(
      '81.E) conjuração de Clérigo cria UM PendingEffectSave de Destreza, com a CD derivada (DC 6)',
      okCast.status === 201 && Boolean(okPendingId) && okCast.data.pendingIds.length === 1 &&
        okPending?.ability === 'dexterity' && okPending?.dc === 6 &&
        okPending?.definitionId === spellDefinitionId(SACRED_FLAME_SPELL_ID),
      JSON.stringify({ status: okCast.status, data: okCast.data }),
    );
    check(
      '81.V) truque NÃO gasta espaço: castAtLevel 0 e nenhum recurso carimbado',
      okCast.data?.cast?.casting?.castAtLevel === 0 &&
        okCast.data?.cast?.casting?.resourceKind === null &&
        okCast.data?.cast?.casting?.spellLevel === 0,
      JSON.stringify(okCast.data?.cast?.casting),
    );
    const okCastRow = okPendingId
      ? await prisma.spellCast.findFirstOrThrow({ where: { spellId: SACRED_FLAME_SPELL_ID } })
      : null;
    check(
      '81.C2) casting time do catálogo = Ação e componentes V/S disponíveis (sem material)',
      okCast.data?.cast?.casting?.timeKind === 'action' &&
        okCast.data?.cast?.casting?.economyCostKind === null &&
        okCast.data?.cast?.components?.material === false &&
        okCast.data?.cast?.components?.somatic === true,
      JSON.stringify(okCast.data?.cast?.components),
    );

    const okRoll = okPendingId ? await rollPending(tokenDexHigh, okPendingId) : null;
    const okAfter = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: okPendingId! } });
    const okSnapshot = okAfter.resolutionSnapshot as any;
    const okHp = await prisma.character.findUniqueOrThrow({ where: { id: targetHigh.id } });
    const okCastAfter = await prisma.spellCast.findUniqueOrThrow({ where: { id: okCastRow!.id } });
    check(
      '81.J) SUCESSO no save: zero dano, HP intacto, sem Effect, cast `no-effect`',
      (okRoll?.status === 200 || okRoll?.status === 201) &&
        okAfter.result === 'success' &&
        okSnapshot?.success === true &&
        okSnapshot?.finalDamage === 0 &&
        okHp.hpCurrent === 30 &&
        okCastAfter.outcome === 'no-effect' &&
        (await prisma.effectInstance.count({ where: { sourceId: SACRED_FLAME_SPELL_ID } })) === 0,
      JSON.stringify({ roll: okRoll?.status, snapshot: okSnapshot, hp: okHp.hpCurrent, outcome: okCastAfter.outcome }),
    );

    // =====================================================================
    // K/L + O/P/Q + R — FALHA, DEFESAS, CONCENTRAÇÃO E RETRY
    // =====================================================================
    await request('/mechanical/mutate', masterToken, {
      entity: { kind: 'character', id: targetLow.id },
      expectedVersion: (await readMechanical('character', targetLow.id)).version,
      operationId: randomUUID(),
      action: 'concentrate',
      label: 'Bless',
      visibility: 'public',
    }).catch(() => undefined);

    const failCast = await cast({
      caster: { kind: 'character', id: casterHigh.id },
      targets: [{ kind: 'character', id: targetLow.id }],
      spatialConfirmation: EVIDENCE,
    });
    const failPendingId = failCast.data?.pendingId as string | null;
    const failPending = failPendingId
      ? await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: failPendingId } })
      : null;
    const failRoll = failPendingId ? await rollPending(tokenDexLow, failPendingId) : null;
    const failAfter = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: failPendingId! } });
    const failSnapshot = failAfter.resolutionSnapshot as any;
    const failHp = await prisma.character.findUniqueOrThrow({ where: { id: targetLow.id } });
    check(
      '81.K) FALHA no save (CD 16 > d20-5 máx. 15): dano radiante rolado UMA vez no servidor',
      failCast.status === 201 && failPending?.dc === 16 &&
        (failRoll?.status === 200 || failRoll?.status === 201) &&
        failAfter.result === 'failure' &&
        failSnapshot?.damageType === SACRED_FLAME_DAMAGE_TYPE &&
        failSnapshot?.finalDamage > 0 &&
        failHp.hpCurrent === 60 - failSnapshot.finalDamage,
      JSON.stringify({ status: failRoll?.status, snapshot: failSnapshot, hp: failHp.hpCurrent }),
    );
    check(
      '81.L) defesas do núcleo compartilhado: sem defesa, `final = raw` e nenhum modificador',
      failSnapshot?.rawDamage === failSnapshot?.finalDamage &&
        failSnapshot?.components[0]?.modifier === null &&
        failSnapshot?.components[0]?.applied === failSnapshot?.rawDamage,
      JSON.stringify(failSnapshot?.components),
    );
    check(
      '81.M2) nível 5 escala para 2d8 no servidor (dados e rolagens persistidos)',
      failSnapshot?.scalingLevel === 5 &&
        failSnapshot?.dice?.count === 2 &&
        failSnapshot?.dice?.sides === 8 &&
        failSnapshot?.dice?.rolls?.length === 2 &&
        failSnapshot?.rawDamage === failSnapshot.dice.rolls.reduce((a: number, b: number) => a + b, 0),
      JSON.stringify(failSnapshot?.dice),
    );
    const concentrationPending = (await readMechanical('character', targetLow.id))
      ?.state?.pendingConcentrationSaves ?? [];
    check(
      '81.Q) dano final > 0 → UM teste de Concentração com o MESMO eventId determinístico do dano',
      concentrationPending.length === 1 &&
        concentrationPending[0].eventId === `spell-save:${failPendingId}:damage` &&
        concentrationPending[0].dc === Math.max(10, Math.floor(failSnapshot.finalDamage / 2)),
      JSON.stringify(concentrationPending),
    );
    const hpBeforeRetry = failHp.hpCurrent;
    const retry = failPendingId ? await rollPending(tokenDexLow, failPendingId) : null;
    const afterRetry = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: failPendingId! } });
    check(
      '81.R) retry não rola nem aplica de novo: 409 e o snapshot/HP permanecem idênticos',
      retry?.status === 409 && afterRetry.status === 'resolved' &&
        JSON.stringify(afterRetry.resolutionSnapshot) === JSON.stringify(failSnapshot) &&
        (await prisma.character.findUniqueOrThrow({ where: { id: targetLow.id } })).hpCurrent === hpBeforeRetry,
      JSON.stringify({ retry: retry?.status, snapshotIgual: JSON.stringify(afterRetry.resolutionSnapshot) === JSON.stringify(failSnapshot) }),
    );

    // Resistência/imunidade são provadas em INSTÂNCIAS de combate: o lifecycle
    // de NPC (dano/morte/Condições) sempre vive na instância, nunca no template.
    const resistCombat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 1,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: casterRes.id,
              ownerUserId: ownerRes.id,
              name: casterRes.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 0,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
            {
              kind: 'NPC',
              creatureId: resistant.id,
              name: resistant.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: -5,
              hpCurrent: 50,
              hpMax: 50,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(resistCombat.id);
    const resistCombatant = resistCombat.combatants.find((item) => item.creatureId === resistant.id)!;
    const resistCast = await cast({
      caster: { kind: 'character', id: casterRes.id },
      targets: [{ kind: 'combatant', id: resistCombatant.id }],
      spatialConfirmation: EVIDENCE,
    });
    const resistPending = resistCast.data?.pendingId as string | null;
    const resistRoll = resistPending ? await rollPending(masterToken, resistPending) : null;
    const resistSnapshot = resistPending
      ? ((await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: resistPending } }))
          .resolutionSnapshot as any)
      : null;
    const resistAfter = await prisma.combatant.findUniqueOrThrow({ where: { id: resistCombatant.id } });
    check(
      '81.O) resistência a Radiante reduz pela metade (piso) pelo core compartilhado',
      resistSnapshot?.finalDamage === Math.floor(resistSnapshot?.rawDamage / 2) &&
        resistSnapshot?.components[0]?.modifier === 'resistance' &&
        resistAfter.hpCurrent === 50 - (resistSnapshot?.finalDamage ?? 0),
      JSON.stringify({ cast: resistCast.status, data: resistCast.data?.error, roll: resistRoll, snapshot: resistSnapshot, hp: resistAfter.hpCurrent }),
    );
    // Um único combate ATIVO por mesa (constraint do projeto): fecha antes do
    // próximo cenário.
    await prisma.combat.update({ where: { id: resistCombat.id }, data: { status: 'ENDED' } });

    const immuneCombat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 1,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: casterImm.id,
              ownerUserId: ownerImm.id,
              name: casterImm.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 0,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
            {
              kind: 'NPC',
              creatureId: immune.id,
              name: immune.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: -5,
              hpCurrent: 50,
              hpMax: 50,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(immuneCombat.id);
    const immuneCombatant = immuneCombat.combatants.find((item) => item.creatureId === immune.id)!;
    const immuneCast = await cast({
      caster: { kind: 'character', id: casterImm.id },
      targets: [{ kind: 'combatant', id: immuneCombatant.id }],
      spatialConfirmation: EVIDENCE,
    });
    const immunePending = immuneCast.data?.pendingId as string | null;
    if (immunePending) await rollPending(masterToken, immunePending);
    const immuneSnapshot = immunePending
      ? ((await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: immunePending } }))
          .resolutionSnapshot as any)
      : null;
    const immuneAfter = await prisma.combatant.findUniqueOrThrow({ where: { id: immuneCombatant.id } });
    await prisma.combat.update({ where: { id: immuneCombat.id }, data: { status: 'ENDED' } });
    check(
      '81.P) imunidade a Radiante zera o dano final, não mexe no HP e não pede Concentração',
      immuneSnapshot?.finalDamage === 0 &&
        immuneSnapshot?.components[0]?.modifier === 'immunity' &&
        immuneAfter.hpCurrent === 50,
      JSON.stringify({ cast: immuneCast.status, data: immuneCast.data?.error, snapshot: immuneSnapshot }),
    );

    // =====================================================================
    // N2 — MULTICLASSE REAL (nível TOTAL 5 → 2d8)
    // =====================================================================
    const multiCast = await cast({
      caster: { kind: 'character', id: multi.id },
      targets: [{ kind: 'character', id: target2.id }],
      spatialConfirmation: EVIDENCE,
    });
    const multiPending = multiCast.data?.pendingId as string | null;
    if (multiPending) await rollPending(tokenOf(ownerTarget2), multiPending);
    const multiSnapshot = multiPending
      ? ((await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: multiPending } }))
          .resolutionSnapshot as any)
      : null;
    check(
      '81.N2) Clérigo 1 / Guerreiro 4 conjura a Chama Sagrada com 2d8 (sem nível de classe)',
      multiCast.status === 201 && multiSnapshot?.scalingLevel === 5 &&
        multiSnapshot?.dice?.count === 2 && multiSnapshot?.dice?.rolls?.length === 2,
      JSON.stringify({ cast: multiCast.status, snapshot: multiSnapshot?.dice }),
    );

    // =====================================================================
    // B/C3 + F2 + E2 — AUTORIZAÇÃO, ALVO E VISÃO
    // =====================================================================
    const wizardOptions = await request(
      `/spells/cast-options/${wizard.id}/${SACRED_FLAME_SPELL_ID}`,
      tokenOf(ownerWizard),
    );
    check(
      '81.B2) Mago não recebe a Chama Sagrada (não está na lista dele) e o cast é recusado',
      wizardOptions.status === 200 && wizardOptions.data.sources?.length === 0,
      JSON.stringify(wizardOptions.data?.sources),
    );
    const wizardCast = await cast(
      { caster: { kind: 'character', id: wizard.id }, targets: [{ kind: 'character', id: targetHigh.id }] },
      tokenOf(ownerWizard),
      '/spells/cast',
    );
    check(
      '81.B3) fonte que não concede a magia → SPELL_NOT_AVAILABLE_FROM_SOURCE antes do commit',
      wizardCast.status === 409 && wizardCast.data?.error === 'SPELL_NOT_AVAILABLE_FROM_SOURCE',
      JSON.stringify(wizardCast.data),
    );

    const clericOptions = await request(
      `/spells/cast-options/${casterHigh.id}/${SACRED_FLAME_SPELL_ID}`,
      tokenOf(ownerHigh),
    );
    const optionTargeting = clericOptions.data.targeting?.[0];
    check(
      '81.C3/D2) cast-options: truque sem espaço, 1 alvo, 60 pés, visão e componentes V/S',
      clericOptions.status === 200 &&
        clericOptions.data.resources?.length === 0 &&
        optionTargeting?.maxTargets === 1 &&
        optionTargeting?.rangeFeet === 60 &&
        optionTargeting?.requiresSight === true &&
        clericOptions.data.components?.material?.required === false,
      JSON.stringify({ targeting: optionTargeting, components: clericOptions.data.components }),
    );

    const twoTargets = await cast({
      caster: { kind: 'character', id: casterHigh.id },
      targets: [
        { kind: 'character', id: targetLow.id },
        { kind: 'character', id: target2.id },
      ],
      spatialConfirmation: EVIDENCE,
    });
    check(
      '81.F) exatamente UM alvo: dois alvos são recusados sem COMMIT',
      twoTargets.status === 400 && twoTargets.data?.error === 'SPELL_TARGET_COUNT_INVALID',
      JSON.stringify(twoTargets.data),
    );

    // Invisibilidade pelo MOTOR de Conditions (nunca escrevendo o JSONB à mão):
    // `canSee` passa a dizer que o caster NÃO vê o alvo.
    await request('/mechanical/mutate', masterToken, {
      entity: { kind: 'character', id: target2.id },
      expectedVersion: (await readMechanical('character', target2.id)).version,
      operationId: randomUUID(),
      action: 'apply',
      condition: 'invisible',
      sourceLabel: 'Mestre',
    });
    const notVisible = await cast({
      caster: { kind: 'character', id: casterHigh.id },
      targets: [{ kind: 'character', id: target2.id }],
      spatialConfirmation: EVIDENCE,
    });
    const notVisibleCode = notVisible.data?.error;
    check(
      '81.E2) alvo que o caster não VÊ é recusado (a confirmação do Mestre não sobrescreve)',
      notVisible.status === 409 &&
        (notVisibleCode === 'SPELL_TARGET_NOT_VISIBLE' || notVisibleCode === 'SPELL_TARGET_SIGHT_CONFIRMATION_REQUIRED'),
      JSON.stringify(notVisible.data),
    );

    // =====================================================================
    // 98/99 — COMPONENTE (sem M, S exige mão livre)
    // =====================================================================
    const castsBeforeBlocked = await prisma.spellCast.count({
      where: { casterEntityId: blocked.id },
    });
    const blockedCast = await cast({
      caster: { kind: 'character', id: blocked.id },
      targets: [{ kind: 'character', id: targetHigh.id }],
      spatialConfirmation: EVIDENCE,
    });
    check(
      '81.E3) S sem M com as mãos ocupadas → recusado ANTES do COMMIT (sem cast/pendência)',
      blockedCast.status === 409 &&
        blockedCast.data?.error === 'SPELL_SOMATIC_COMPONENT_UNAVAILABLE' &&
        (await prisma.spellCast.count({ where: { casterEntityId: blocked.id } })) === castsBeforeBlocked &&
        (await prisma.pendingEffectSave.count({
          where: { casterEntityId: blocked.id, status: 'pending' },
        })) === 0,
      JSON.stringify({ blockedCast, spells: await prisma.spellCast.count({ where: { casterEntityId: blocked.id } }) }),
    );

    // =====================================================================
    // NPC — nível de escalonamento EXPLÍCITO (nunca por ND)
    // =====================================================================
    await prisma.creature.update({
      where: { id: statblock.id },
      data: {
        spellRepertoire: { spellIds: [SACRED_FLAME_SPELL_ID] },
        spellcastingResources: { spellSlots: [] },
      },
    });
    const statblockEntity = await loadEntity({ kind: 'creature', id: statblock.id });
    let missingLevelCode: string | null = null;
    try {
      await cantripScalingLevelOf(statblockEntity);
    } catch (error) {
      missingLevelCode = (error as { code?: string }).code ?? 'unknown';
    }
    check(
      '81.N3) NPC sem `cantripScalingLevel` explícito → erro, sem inferir por ND/dados de vida',
      missingLevelCode === 'SPELL_CANTRIP_SCALING_LEVEL_REQUIRED',
      String(missingLevelCode),
    );
    await prisma.creature.update({
      where: { id: statblock.id },
      data: {
        spellcastingProfile: { ability: 'wisdom', saveDc: 13, cantripScalingLevel: 5 },
        inventory: [],
      },
    });
    const statblockAfter = await prisma.creature.findUniqueOrThrow({ where: { id: statblock.id } });
    check(
      '81.N4) NPC com `cantripScalingLevel: 5` explícito recebe 2d8',
      scaledDiceCount(SACRED_FLAME_SCALING, 5) === 2 &&
        creatureSpellcastingProfile({ spellcastingProfile: statblockAfter.spellcastingProfile })
          ?.spellSaveDc === 13,
      'perfil do statblock',
    );

    // =====================================================================
    // H/I + S/T + J2/Q2 — CARD, ACTION ECONOMY, 0 PV E INTENÇÃO
    // =====================================================================
    await prisma.character.update({
      where: { id: targetLow.id },
      data: { hpCurrent: 60, hpMax: 60, mechanicalState: {} },
    });
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
              characterId: casterHigh.id,
              ownerUserId: ownerHigh.id,
              name: casterHigh.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 0,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
            {
              kind: 'CHARACTER',
              characterId: targetLow.id,
              ownerUserId: ownerDexLow.id,
              name: targetLow.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: -5,
              hpCurrent: 60,
              hpMax: 60,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);

    const combatCast = await cast({
      caster: { kind: 'character', id: casterHigh.id },
      targets: [{ kind: 'character', id: targetLow.id }],
      spatialConfirmation: EVIDENCE,
    });
    const combatPending = combatCast.data?.pendingId as string | null;
    const cards = await request(`/combat/${combat.id}/resolution-requests`, tokenDexLow);
    const card = cards.data?.requests?.find(
      (item: any) => item.reference?.pendingId === combatPending,
    );
    check(
      `81.H) card GENÉRICO de salvaguarda aparece no registro com título do catálogo e prompt curto [${JSON.stringify({ cast: combatCast.status, pending: combatPending, cards: cards.data?.requests, error: combatCast.data?.error })}]`,
      cards.status === 200 && card?.kind === 'spell-saving-throw' &&
      cards.status === 200 && card?.kind === 'spell-saving-throw' &&
        card?.title === SACRED_FLAME_LABEL &&
        card?.shortDescription === 'Uma radiância flamejante desce sobre você.' &&
        card?.ability === 'dexterity' && card?.phase === 'initial',
      JSON.stringify(card),
    );
    check(
      '81.I) o card não expõe CD/bônus/resultado nem campo de dano; só a ação de rolar',
      card && !('dc' in card) && !('saveDc' in card) && !('damage' in card) &&
        card.actions?.length === 1 && card.actions[0]?.kind === 'roll',
      JSON.stringify(card?.actions),
    );

    const secondCast = await cast({
      caster: { kind: 'character', id: casterHigh.id },
      targets: [{ kind: 'character', id: targetLow.id }],
      spatialConfirmation: EVIDENCE,
    });
    check(
      '81.S) Action Economy: a Chama Sagrada gasta a Ação e o segundo cast no turno é recusado',
      secondCast.status === 409 && secondCast.data?.error === 'SPELL_ACTION_UNAVAILABLE',
      JSON.stringify(secondCast.data),
    );

    await prisma.character.update({
      where: { id: targetLow.id },
      data: { hpCurrent: 3, hpMax: 60 },
    });
    await prisma.combatant.updateMany({
      where: { characterId: targetLow.id },
      data: { hpCurrent: 3, hpMax: 60 },
    });
    const lethal = combatPending ? await rollPending(tokenDexLow, combatPending) : null;
    const lethalSnapshot = combatPending
      ? ((await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: combatPending } }))
          .resolutionSnapshot as any)
      : null;
    const lethalMechanical = await readMechanical('character', targetLow.id);
    const lethalDeath = await prisma.character.findUniqueOrThrow({
      where: { id: targetLow.id },
      select: { deathState: true, hpCurrent: true },
    });
    const journal = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    check(
      '81.J2) dano que chega a 0 PV usa o lifecycle de morte (Testes contra a Morte)',
      (lethal?.status === 200 || lethal?.status === 201) &&
        lethalSnapshot?.finalDamage >= 3 &&
        lethalMechanical?.hpCurrent === 0 &&
        (lethalDeath.deathState as any)?.deathSaves === true,
      JSON.stringify({ snapshot: lethalSnapshot, hp: lethalMechanical?.hpCurrent, death: lethalDeath.deathState }),
    );
    check(
      '81.K2) o Registro ganha UMA linha `spell-save` com o dano (sem duplicar internals)',
      JSON.stringify(journal.economyLog ?? []).includes('spell-save') &&
        JSON.stringify(journal.economyLog ?? []).includes('Dano radiante'),
      JSON.stringify(journal.economyLog ?? []).slice(0, 400),
    );

    // Intenção de PLAYER sem geometria confiável: NADA é gasto antes do Mestre.
    const intent = await cast(
      {
        caster: { kind: 'character', id: casterLow.id },
        targets: [{ kind: 'character', id: targetHigh.id }],
      },
      tokenLow,
      '/spells/cast',
    );
    const intents = await prisma.spellCastIntent.findMany({
      where: { casterEntityId: casterLow.id },
      orderBy: { createdAt: 'desc' },
    });
    check(
      '81.E4) PLAYER sem confirmação espacial → INTENÇÃO 202, nenhum cast/pendência e nenhuma Ação',
      intent.status === 202 && intents.length === 1 && intents[0].status === 'pending' &&
        (await prisma.pendingEffectSave.count({
          where: { casterEntityId: casterLow.id, status: 'pending' },
        })) === 0,
      JSON.stringify({ status: intent.status, intents: intents.map((row) => row.status) }),
    );
    const denied = await request(`/spells/intents/${intents[0].id}/deny`, masterToken, { reason: 'prova' });
    check(
      '81.E5) recusa do Mestre é terminal com ZERO custo (nenhum SpellCast novo)',
      denied.status === 200 && denied.data?.intent?.status === 'denied',
      JSON.stringify(denied.data),
    );

    // =====================================================================
    // T2 — bonus action policy (matriz 6.6D preservada; Chama é Ação)
    // =====================================================================
    check(
      '81.T2) Chama Sagrada é candidata AÇÃO (não é magia de Ação Bônus) na política de 6.6D',
      definition?.castingTime === undefined &&
        okCast.data?.cast?.casting?.timeKind === 'action' &&
        okCast.data?.cast?.casting?.economyCostKind === null,
      JSON.stringify(okCast.data?.cast?.casting),
    );
  } finally {
    // Cleanup LIMITADO às fixtures criadas aqui (nada de "delete all test rows").
    if (combatIds.length > 0) {
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } }).catch(() => undefined);
    }
    await prisma.pendingEffectSave
      .deleteMany({
        where: {
          OR: [
            { casterEntityId: { in: [...characterIds, ...creatureIds] } },
            { targetEntityId: { in: [...characterIds, ...creatureIds] } },
          ],
        },
      })
      .catch(() => undefined);
    await prisma.spellCast
      .deleteMany({ where: { casterEntityId: { in: [...characterIds, ...creatureIds] } } })
      .catch(() => undefined);
    await prisma.spellCastIntent
      .deleteMany({ where: { casterEntityId: { in: characterIds } } })
      .catch(() => undefined);
    await prisma.effectInstance
      .deleteMany({ where: { sourceId: SACRED_FLAME_SPELL_ID } })
      .catch(() => undefined);
    if (creatureIds.length > 0) {
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } }).catch(() => undefined);
    }
    if (characterIds.length > 0) {
      await prisma.characterOperation
        .deleteMany({ where: { characterId: { in: characterIds } } })
        .catch(() => undefined);
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }
}
