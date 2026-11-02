import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  loadConcentrationTarget,
  noteDamageConcentration,
  resolveConcentrationSave,
} from '../modules/concentration/concentration.service.js';
import { endEffectGroup } from '../modules/effects/effects.service.js';
import { conditionAttackMode } from '../modules/shared/conditions.js';
import { HP_ZERO_SOURCE } from '../modules/shared/death.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';
import type { MechanicalEntity } from '../modules/shared/conditions.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.5C — EFFECT → CONDITION.
 *
 * Prova que o Effect NÃO tem motor próprio de Conditions: ele cria
 * `ConditionInstance` normais (sourceType `effect` + sourceId do efeito) e todo
 * o resto (Incapacitated, visão, charmers, fearSources...) vem do
 * `deriveConditionEffects` existente. Cobre múltiplas fontes, cleanup seletivo,
 * grupo, Concentração, privacidade, combatente de personagem e isolamento de
 * criaturas.
 */
export async function smokeEffectConditions(baseUrl: string, check: Check): Promise<void> {
  console.log('\n71) Fase 6.5C — Effect → Condition');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatantIds: string[] = [];
  const effectIds: string[] = [];
  const operationIds: string[] = [];
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({ data: { username: `efc_m_${suffix}`, displayName: 'Mestre Cond. Efeito', passwordHash: 'fixture', role: 'MASTER' } });
    const player = await prisma.user.create({ data: { username: `efc_p_${suffix}`, displayName: 'Jogador Cond. Efeito', passwordHash: 'fixture', role: 'PLAYER' } });
    const other = await prisma.user.create({ data: { username: `efc_o_${suffix}`, displayName: 'Outro Jogador', passwordHash: 'fixture', role: 'PLAYER' } });
    userIds.push(master.id, player.id, other.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });

    const hero = await prisma.character.create({ data: { userId: player.id, name: 'Herói Cond Efeito', hpCurrent: 40, hpMax: 40, constitution: 14, speed: 9 } });
    const ally = await prisma.character.create({ data: { userId: other.id, name: 'Aliado Cond Efeito', hpCurrent: 40, hpMax: 40, constitution: 14, speed: 9 } });
    characterIds.push(hero.id, ally.id);

    const goblin = await prisma.creature.create({ data: { name: 'Goblin Cond Efeito', kind: 'CREATURE', hpCurrent: 20, hpMax: 20, speed: 9 } });
    creatureIds.push(goblin.id);

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function create(body: Record<string, unknown>, token = masterToken) {
      const operationId = randomUUID();
      operationIds.push(operationId);
      const res = await request('/effects', {
        operationId,
        label: 'Efeito de teste',
        target: { kind: 'character', id: hero.id },
        visibility: 'public',
        sourceType: 'manual',
        ...body,
      }, token);
      if (res.status === 201 && res.data.effect) effectIds.push(res.data.effect.id);
      return { ...res, operationId };
    }

    async function end(effectId: string) {
      const operationId = randomUUID();
      operationIds.push(operationId);
      return request(`/effects/${effectId}/end`, { operationId });
    }

    async function mechanical(entity: MechanicalEntity, token = masterToken) {
      const res = await request(`/mechanical/${entity.kind}/${entity.id}`, undefined, token);
      return res.data.mechanical;
    }

    /** Conditions ativas do estado mecânico do ALVO (fonte única de verdade). */
    async function conditionsOf(entity: MechanicalEntity) {
      return (await mechanical(entity)).state.conditions as {
        id: string; condition: string; sourceType?: string; sourceId?: string; sourceLabel?: string;
      }[];
    }

    async function setDodging(combatantId: string, value: boolean) {
      const row = await prisma.combatant.findUniqueOrThrow({ where: { id: combatantId } });
      const economy = row.turnEconomy as Record<string, unknown>;
      await prisma.combatant.update({
        where: { id: combatantId },
        data: { turnEconomy: { ...economy, dodging: value } as Prisma.InputJsonValue },
      });
    }

    const heroEntity: MechanicalEntity = { kind: 'character', id: hero.id };
    const allyEntity: MechanicalEntity = { kind: 'character', id: ally.id };

    /** Mutação mecânica do herói SEMPRE com as versões atuais (ficha + combate). */
    async function mutateHero(extra: Record<string, unknown>) {
      const current = await mechanical(heroEntity);
      const operationId = randomUUID();
      operationIds.push(operationId);
      return request('/mechanical/mutate', {
        entity: heroEntity,
        expectedVersion: current.version,
        ...(current.combat ? { expectedCombatVersion: current.combat.version } : {}),
        operationId,
        ...extra,
      });
    }

    // ---------------------------------------------------------------- A/B ----
    const paralyze = await create({ label: 'Paralisia de teste', conditions: ['paralyzed'] });
    const paralyzeState = await conditionsOf(heroEntity);
    const heroEffects = (await mechanical(heroEntity)).effects;
    check(
      '71.A) Effect com Paralyzed cria UMA ConditionInstance com sourceType/sourceId do efeito',
      paralyze.status === 201 && paralyzeState.length === 1 &&
        paralyzeState[0].condition === 'paralyzed' &&
        paralyzeState[0].sourceType === 'effect' &&
        paralyzeState[0].sourceId === paralyze.data.effect.id &&
        paralyzeState[0].sourceLabel === 'Paralisia de teste' &&
        paralyze.data.effect.conditions.includes('paralyzed'),
      JSON.stringify({ paralyze: paralyze.data.effect, paralyzeState }),
    );
    check(
      '71.B) o motor de Conditions existente deriva Incapacitated/speed 0/auto-fail sem código de Effect',
      heroEffects.incapacitated === true && heroEffects.canAct === false &&
        (await mechanical(heroEntity)).effectiveSpeed === 0 &&
        heroEffects.autoFailSaves.includes('strength') && heroEffects.autoFailSaves.includes('dexterity'),
      JSON.stringify({ effects: heroEffects, speed: (await mechanical(heroEntity)).effectiveSpeed }),
    );

    // ------------------------------------------------------------------ C ----
    await end(paralyze.data.effect.id);
    check(
      '71.C) endEffect remove a Condition que ELE criou',
      (await conditionsOf(heroEntity)).length === 0 &&
        !(await mechanical(heroEntity)).effects.incapacitated,
    );

    // ------------------------------------------------------------- D/E/F ----
    const poisonA = await create({ label: 'Veneno A', conditions: ['poisoned'] });
    const poisonB = await create({ label: 'Veneno B', conditions: ['poisoned'] });
    const twoSources = await conditionsOf(heroEntity);
    check(
      '71.D) dois Effects com a MESMA Condition geram DUAS instâncias',
      twoSources.filter((item) => item.condition === 'poisoned').length === 2 &&
        twoSources.some((item) => item.sourceId === poisonA.data.effect.id) &&
        twoSources.some((item) => item.sourceId === poisonB.data.effect.id),
      JSON.stringify(twoSources),
    );
    await end(poisonA.data.effect.id);
    const afterA = await conditionsOf(heroEntity);
    const effectsAfterA = (await mechanical(heroEntity)).effects;
    check(
      '71.E) encerrar A mantém a fonte de B e o alvo continua Envenenado',
      afterA.length === 1 && afterA[0].sourceId === poisonB.data.effect.id &&
        effectsAfterA.attackDisadvantages.includes('poisoned') &&
        effectsAfterA.checkDisadvantage === true,
      JSON.stringify(afterA),
    );
    await end(poisonB.data.effect.id);
    check('71.F) encerrar B deixa de ter Poisoned ativo', (await conditionsOf(heroEntity)).length === 0);

    // ------------------------------------------------------------- G/H/I ----
    const manualPoison = await mutateHero({ action: 'apply', condition: 'poisoned' });
    const effectPoison = await create({ label: 'Veneno do Efeito', conditions: ['poisoned'] });
    check(
      '71.G/H) aplicação MANUAL + Effect coexistem (duas fontes)',
      manualPoison.status === 200 &&
        (await conditionsOf(heroEntity)).filter((item) => item.condition === 'poisoned').length === 2,
    );
    await end(effectPoison.data.effect.id);
    const manualLeft = await conditionsOf(heroEntity);
    check(
      '71.I) encerrar o Effect preserva a Condition MANUAL',
      manualLeft.length === 1 && manualLeft[0].sourceType === 'manual',
      JSON.stringify(manualLeft),
    );
    for (const row of manualLeft) {
      await mutateHero({ action: 'remove', instanceId: row.id });
    }

    // ------------------------------------------------------------- J/K/L ----
    const groupA = `efc-grp-a-${suffix}`;
    const groupB = `efc-grp-b-${suffix}`;
    const groupEffect1 = await create({ label: 'Grupo 1', groupId: groupA, conditions: ['grappled'], target: heroEntity });
    const groupEffect2 = await create({ label: 'Grupo 2', groupId: groupA, conditions: ['blinded'], target: allyEntity });
    const groupEffect3 = await create({ label: 'Grupo 3', groupId: groupA, conditions: ['deafened'], target: { kind: 'creature', id: goblin.id } });
    const outsiderEffect = await create({ label: 'Outro grupo', groupId: groupB, conditions: ['poisoned'], target: heroEntity });
    check(
      '71.J) três instâncias do grupo aplicam Condition no PRÓPRIO alvo',
      [groupEffect1, groupEffect2, groupEffect3].every((res) => res.status === 201) &&
        (await conditionsOf(heroEntity)).some((item) => item.sourceId === groupEffect1.data.effect.id) &&
        (await conditionsOf(allyEntity)).some((item) => item.sourceId === groupEffect2.data.effect.id) &&
        (await conditionsOf({ kind: 'creature', id: goblin.id })).some((item) => item.sourceId === groupEffect3.data.effect.id),
    );
    const touched = await endEffectGroup(groupA, 'group');
    check(
      '71.K/L) endEffectGroup encerra as 3 Conditions e preserva outro grupo',
      touched.length === 3 &&
        (await conditionsOf(heroEntity)).length === 1 &&
        (await conditionsOf(heroEntity))[0].sourceId === outsiderEffect.data.effect.id &&
        (await conditionsOf(allyEntity)).length === 0 &&
        (await conditionsOf({ kind: 'creature', id: goblin.id })).length === 0,
      JSON.stringify({ touched }),
    );
    await end(outsiderEffect.data.effect.id);

    // ----------------------------------------------------------- M/N/O -------
    const concentrationGroup = `efc-conc-${suffix}`;
    await create({ label: 'Concentrado', groupId: concentrationGroup, conditions: ['restrained'], target: heroEntity });
    await mutateHero({
      action: 'concentrate',
      label: 'Efeito concentrado',
      sourceType: 'effect',
      sourceId: concentrationGroup,
      visibility: 'public',
    });
    await noteDamageConcentration(heroEntity, 22, prisma, { eventId: `efc-${suffix}-conc`, sourceName: 'Smoke' });
    const pending = (await loadConcentrationTarget(heroEntity)).state.pendingConcentrationSaves.at(-1)!;
    const failure = await resolveConcentrationSave(heroEntity, pending.id, 0, prisma, 'Smoke');
    check(
      '71.M/N) falha na Concentração encerra o grupo E remove as Conditions dele',
      failure.ended === true && failure.endedEffectTargets.length === 1 &&
        (await conditionsOf(heroEntity)).length === 0 &&
        (await prisma.effectInstance.count({ where: { groupId: concentrationGroup, status: 'ended' } })) === 1,
      JSON.stringify({ failure, conditions: await conditionsOf(heroEntity) }),
    );
    const legacy = await mutateHero({ action: 'concentrate', label: 'Manual legada', visibility: 'public' });
    const legacyEnd = await mutateHero({ action: 'concentrate-end' });
    check(
      '71.O) concentração manual sem grupo continua funcionando igual',
      legacy.status === 200 && legacyEnd.status === 200 && (await mechanical(heroEntity)).state.concentration === null,
    );

    // --------------------------------------------------------------- P -------
    const secret = await create({
      label: 'Segredo Absoluto',
      visibility: 'private',
      conditions: ['paralyzed'],
    });
    const playerView = await mechanical(heroEntity, playerToken);
    const masterView = await mechanical(heroEntity);
    const playerJson = JSON.stringify(playerView);
    check(
      '71.P) Effect privado aplica a Condition; o PLAYER vê Paralyzed sem label/origem secreta',
      secret.status === 201 &&
        playerView.effects.incapacitated === true &&
        playerJson.includes('paralyzed') &&
        !playerJson.includes('Segredo Absoluto') &&
        playerView.state.conditions.every((item: { sourceLabel?: string }) => item.sourceLabel === 'Efeito') &&
        masterView.state.conditions.some((item: { sourceLabel?: string }) => item.sourceLabel === 'Efeito') &&
        (await request(`/effects/character/${hero.id}`, undefined, playerToken)).data.effects.length === 0,
      JSON.stringify({ player: playerView.state.conditions }),
    );
    await end(secret.data.effect.id);

    // --------------------------------------------------------- Q/R/S -------
    const combatStarted = await request('/combat', { entries: [{ creatureId: goblin.id, quantity: 2 }] });
    if (combatStarted.status !== 201) throw new Error(`Não iniciou o combate: ${JSON.stringify(combatStarted.data)}`);
    const combat = combatStarted.data.combat as CombatDto;
    combatId = combat.id;
    combatantIds.push(...combat.combatants.map((item) => item.id));
    const heroCombatant = combat.combatants.find((item) => item.characterId === hero.id)!;
    const goblins = combat.combatants.filter((item) => item.creatureId === goblin.id);
    const [goblinA, goblinB] = goblins;

    const combatCondition = await create({ label: 'Condição em combate', target: heroEntity, conditions: ['poisoned'] });
    const combatAgain = (await request('/combat/active')).data.combat as CombatDto;
    const heroCard = combatAgain.combatants.find((item) => item.id === heroCombatant.id)!;
    check(
      '71.Q) Character em combate: UMA Condition na ficha, projetada no combatente',
      combatCondition.status === 201 &&
        heroCard.mechanicalState.conditions.filter((item) => item.condition === 'poisoned').length === 1 &&
        (await prisma.effectInstance.count({ where: { targetEntityKind: 'combatant', targetEntityId: heroCombatant.id } })) === 0 &&
        (await conditionsOf({ kind: 'combatant', id: heroCombatant.id })).length === 1,
      JSON.stringify({ conditions: heroCard.mechanicalState.conditions }),
    );

    const goblinPoison = await create({
      label: 'Veneno do Goblin',
      target: { kind: 'combatant', id: goblinA.id },
      conditions: ['poisoned'],
    });
    check(
      '71.R) Condition numa INSTÂNCIA de criatura não contamina a outra cópia nem o template',
      goblinPoison.status === 201 &&
        (await conditionsOf({ kind: 'combatant', id: goblinA.id })).some((item) => item.condition === 'poisoned') &&
        (await conditionsOf({ kind: 'combatant', id: goblinB.id })).length === 0 &&
        (await conditionsOf({ kind: 'creature', id: goblin.id })).length === 0,
    );

    // --------------------------------------------------------------- S -------
    await end(combatCondition.data.effect.id);
    const outOfCombat = await create({ label: 'Fora de combate', target: allyEntity, conditions: ['poisoned'] });
    check(
      '71.S) fora de combate a ficha reflete a Condition do Effect',
      outOfCombat.status === 201 &&
        (await conditionsOf(allyEntity)).some((item) => item.condition === 'poisoned') &&
        (await mechanical(allyEntity)).effects.checkDisadvantage === true,
    );
    await end(outOfCombat.data.effect.id);

    // ---------------------------------------------------------- T/U/V -------
    const charmed = await create({
      label: 'Encanto de teste',
      target: heroEntity,
      sourceEntity: { kind: 'creature', id: goblin.id },
      conditions: ['charmed'],
    });
    const charmedEffects = (await mechanical(heroEntity)).effects;
    check(
      '71.T) Charmed do Effect preserva sourceEntity (charmers do motor atual)',
      charmed.status === 201 &&
        charmedEffects.charmers.some((item: MechanicalEntity) => item.kind === 'creature' && item.id === goblin.id) &&
        (await conditionsOf(heroEntity)).some((item) => item.condition === 'charmed' && item.sourceId === charmed.data.effect.id),
      JSON.stringify(charmedEffects.charmers),
    );
    await end(charmed.data.effect.id);

    const frightened = await create({
      label: 'Medo de teste',
      target: heroEntity,
      sourceEntity: { kind: 'creature', id: goblin.id },
      conditions: ['frightened'],
    });
    const fearEffects = (await mechanical(heroEntity)).effects;
    check(
      '71.U) Frightened do Effect alimenta fearSources com a sourceEntity',
      frightened.status === 201 &&
        fearEffects.fearSources.some((item: { source?: MechanicalEntity }) => item.source?.kind === 'creature' && item.source?.id === goblin.id),
      JSON.stringify(fearEffects.fearSources),
    );
    await end(frightened.data.effect.id);

    const invisible = await create({ label: 'Invisibilidade de teste', target: heroEntity, conditions: ['invisible'] });
    const invisibleEffects = (await mechanical(heroEntity)).effects;
    const endInvisible = await end(invisible.data.effect.id);
    check(
      '71.V) Invisible do Effect usa o motor de visão existente e cai ao encerrar',
      invisible.status === 201 && invisibleEffects.active.includes('invisible') &&
        invisibleEffects.attackAdvantages.includes('invisible') &&
        endInvisible.status === 200 &&
        !(await mechanical(heroEntity)).effects.active.includes('invisible'),
    );

    // --------------------------------------------------------------- W -------
    const hpZeroState = {
      conditions: [
        { id: randomUUID(), condition: 'unconscious', sourceType: HP_ZERO_SOURCE, sourceLabel: '0 PV', appliedAt: new Date().toISOString() },
        { id: randomUUID(), condition: 'prone', sourceType: 'posture', sourceLabel: 'Queda por inconsciência', appliedAt: new Date().toISOString() },
      ],
      exhaustionLevel: 0,
      seesInvisible: false,
      concentration: null,
      pendingConcentrationSaves: [],
      log: [],
    };
    await prisma.character.update({
      where: { id: ally.id },
      data: { hpCurrent: 0, mechanicalState: hpZeroState as unknown as Prisma.InputJsonValue },
    });
    const otherEffect = await create({ label: 'Outro efeito em 0 PV', target: allyEntity, conditions: ['poisoned'] });
    await end(otherEffect.data.effect.id);
    const hpZeroAfter = await conditionsOf(allyEntity);
    check(
      '71.W) Effect nunca remove Unconscious/Queda do lifecycle de 0 PV',
      hpZeroAfter.some((item) => item.condition === 'unconscious' && item.sourceType === HP_ZERO_SOURCE) &&
        hpZeroAfter.some((item) => item.condition === 'prone') &&
        !hpZeroAfter.some((item) => item.condition === 'poisoned'),
      JSON.stringify(hpZeroAfter),
    );

    // ------------------------------------------------------------- X/Y -------
    const removable = await create({ label: 'Removível', target: heroEntity, conditions: ['poisoned'] });
    const poisonInstance = (await conditionsOf(heroEntity)).find((item) => item.sourceId === removable.data.effect.id)!;
    const removedManually = await mutateHero({ action: 'remove', instanceId: poisonInstance.id });
    const removedState = await conditionsOf(heroEntity);
    const effectStillActive = await prisma.effectInstance.findUniqueOrThrow({ where: { id: removable.data.effect.id } });
    check(
      '71.X) remover a Condition manualmente mantém o Effect ativo e não reaplica no refresh',
      removedManually.status === 200 &&
        !removedState.some((item) => item.id === poisonInstance.id) &&
        effectStillActive.status === 'active' &&
        !(await conditionsOf(heroEntity)).some((item) => item.sourceId === removable.data.effect.id),
    );
    const endAfterManual = await end(removable.data.effect.id);
    check('71.Y) encerrar o Effect depois da remoção manual funciona normalmente', endAfterManual.status === 200 && endAfterManual.data.effect.status === 'ended');

    // ---------------------------------------------------------------- Z ------
    const retryBody = {
      operationId: randomUUID(),
      label: 'Retry com condição',
      target: heroEntity,
      visibility: 'public',
      sourceType: 'manual',
      conditions: ['grappled'],
    };
    operationIds.push(retryBody.operationId);
    const retryFirst = await request('/effects', retryBody);
    if (retryFirst.status === 201) effectIds.push(retryFirst.data.effect.id);
    const retrySecond = await request('/effects', retryBody);
    check(
      '71.Z) retry do MESMO operationId: um Effect e UMA Condition',
      retryFirst.status === 201 && retrySecond.status === 200 && retrySecond.data.replayed === true &&
        (await prisma.effectInstance.count({ where: { id: retryFirst.data.effect.id } })) === 1 &&
        (await conditionsOf(heroEntity)).filter((item) => item.condition === 'grappled').length === 1,
      JSON.stringify({ first: retryFirst.data.effect?.id, second: retrySecond.data.effect?.id, conditions: await conditionsOf(heroEntity) }),
    );
    await end(retryFirst.data.effect.id);

    // ---------------------------------------------------------------- AA -----
    const concurrent = await create({ label: 'Encerramento duplo', target: heroEntity, conditions: ['blinded'] });
    await Promise.all([end(concurrent.data.effect.id), end(concurrent.data.effect.id)]);
    const concurrentRows = await prisma.effectInstance.findUniqueOrThrow({ where: { id: concurrent.data.effect.id } });
    check(
      '71.AA) dois encerramentos concorrentes: ended uma vez e Condition removida uma vez',
      concurrentRows.status === 'ended' &&
        !(await conditionsOf(heroEntity)).some((item) => item.sourceId === concurrent.data.effect.id),
    );

    // ---------------------------------------------------------------- AB -----
    const groupSelf = `efc-grp-self-${suffix}`;
    const groupOther = `efc-grp-other-${suffix}`;
    await create({ label: 'Concentrado self', groupId: groupSelf, target: heroEntity, conditions: ['restrained'] });
    await create({ label: 'Paralisia externa', groupId: groupOther, target: heroEntity, conditions: ['paralyzed'] });
    await mutateHero({
      action: 'concentrate',
      label: 'Concentração alvo',
      sourceType: 'effect',
      sourceId: groupSelf,
      visibility: 'public',
    });
    // O efeito externo Incapacita o CONCENTRADOR: a concentração A termina e o
    // grupo A (e as Conditions dele) vai junto; o grupo B permanece.
    const selfState = (await mechanical(heroEntity)).state;
    check(
      '71.AB) Effect que Incapacita o concentrador encerra a Concentração e o grupo dela, sem loop',
      selfState.concentration === null &&
        (await prisma.effectInstance.count({ where: { groupId: groupSelf, status: 'ended' } })) === 1 &&
        (await prisma.effectInstance.count({ where: { groupId: groupOther, status: 'active' } })) === 1 &&
        (await conditionsOf(heroEntity)).some((item) => item.condition === 'paralyzed') &&
        !(await conditionsOf(heroEntity)).some((item) => item.condition === 'restrained'),
      JSON.stringify({ state: selfState.concentration, conditions: await conditionsOf(heroEntity) }),
    );
    await endEffectGroup(groupOther, 'group');

    // ------------------------------------------------------------- AB.1 -----
    // Mesmo cenário pelo caminho da MUTAÇÃO MECÂNICA (não do createEffect): a
    // linha do alvo é gravada UMA vez só — o cleanup do grupo não pode competir
    // com a gravação da condição manual (guardas de versão → 409).
    const groupManual = `efc-grp-manual-${suffix}`;
    await create({ label: 'Concentrado via mutação', groupId: groupManual, target: heroEntity, conditions: ['prone'] });
    await mutateHero({
      action: 'concentrate',
      label: 'Concentração alvo (mutação)',
      sourceType: 'effect',
      sourceId: groupManual,
      visibility: 'public',
    });
    const manualIncap = await mutateHero({ action: 'apply', condition: 'paralyzed' });
    const manualIncapState = (await mechanical(heroEntity)).state;
    check(
      '71.AB.1) mutação manual que Incapacita o concentrador encerra o grupo sem conflito de versão',
      manualIncap.status === 200 &&
        manualIncapState.concentration === null &&
        (await prisma.effectInstance.count({ where: { groupId: groupManual, status: 'ended' } })) === 1 &&
        !(await conditionsOf(heroEntity)).some((item) => item.sourceType === 'effect'),
      JSON.stringify({ status: manualIncap.status, data: manualIncap.data }),
    );
    const manualParalysis = (await conditionsOf(heroEntity)).find((item) => item.condition === 'paralyzed');
    if (manualParalysis) await mutateHero({ action: 'remove', instanceId: manualParalysis.id });

    // ---------------------------------------------------------------- AC -----
    const speedEffect = await create({ label: 'Speed +3', target: heroEntity, modifiers: [{ kind: 'speed-flat', value: 3 }] });
    const grappleEffect = await create({ label: 'Agarrado por efeito', target: heroEntity, conditions: ['grappled'] });
    const speedGrappled = (await mechanical(heroEntity)).effectiveSpeed;
    await end(grappleEffect.data.effect.id);
    const speedAfter = (await mechanical(heroEntity)).effectiveSpeed;
    check(
      '71.AC) Condition de Effect + modificador da 6.5B: Grappled zera, encerrar devolve o +3 m',
      speedEffect.status === 201 && speedGrappled === 0 && speedAfter === 12,
      JSON.stringify({ speedGrappled, speedAfter }),
    );

    // ---------------------------------------------------------------- AD -----
    await setDodging(heroCombatant.id, true);
    const dodgeBase = await request('/dice/roll', { entity: heroEntity, dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', bonus: 0 }, playerToken);
    const grappleDodge = await create({ label: 'Agarrado na Esquiva', target: heroEntity, conditions: ['grappled'] });
    const dodgeGrappled = await request('/dice/roll', { entity: heroEntity, dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', bonus: 0 }, playerToken);
    await end(grappleDodge.data.effect.id);
    const dodgeBack = await request('/dice/roll', { entity: heroEntity, dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', bonus: 0 }, playerToken);
    await setDodging(heroCombatant.id, false);
    check(
      '71.AD) Grappled por Effect suspende a Esquiva e o benefício volta ao encerrar',
      dodgeBase.data.roll.advantage === true &&
        dodgeGrappled.data.roll.advantage === false && dodgeGrappled.data.roll.disadvantage === false &&
        dodgeBack.data.roll.advantage === true,
      JSON.stringify({ base: dodgeBase.data.roll.advantage, grappled: dodgeGrappled.data.roll.advantage, back: dodgeBack.data.roll.advantage }),
    );

    // ---------------------------------------------------------------- AE -----
    const heroCondition = (await conditionsOf(heroEntity))[0];
    if (heroCondition) await mutateHero({ action: 'remove', instanceId: heroCondition.id });
    const poisonedEffect = await create({ label: 'Veneno AE', target: heroEntity, conditions: ['poisoned'] });
    const statePoisoned = (await mechanical(heroEntity)).state;
    const withEffectAdvantage = conditionAttackMode(statePoisoned, {}, false, false, {
      effectAdvantages: ['effect:fixture:advantage'],
    });
    const withoutEffect = conditionAttackMode(statePoisoned, {}, false, false, {});
    await end(poisonedEffect.data.effect.id);
    const advantageOnly = conditionAttackMode((await mechanical(heroEntity)).state, {}, false, false, {
      effectAdvantages: ['effect:fixture:advantage'],
    });
    check(
      '71.AE) Poisoned(desvantagem) + vantagem de Effect = normal; encerrar o veneno libera a vantagem',
      !withEffectAdvantage.advantage && !withEffectAdvantage.disadvantage &&
        withoutEffect.disadvantage === true &&
        advantageOnly.advantage === true,
      JSON.stringify({ withEffectAdvantage, withoutEffect, advantageOnly }),
    );

    await end(speedEffect.data.effect.id);
  } finally {
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    if (effectIds.length > 0) await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
    if (operationIds.length > 0) await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    const entityIds = [...characterIds, ...creatureIds, ...combatantIds];
    if (entityIds.length > 0) await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    if (creatureIds.length > 0) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
