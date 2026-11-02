import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  loadConcentrationTarget,
  noteDamageConcentration,
  resolveConcentrationSave,
} from '../modules/concentration/concentration.service.js';
import { endEffectGroup } from '../modules/effects/effects.service.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';
import type { MechanicalEntity } from '../modules/shared/conditions.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.5A — GENERIC EFFECT ENGINE (FUNDAÇÃO).
 *
 * Cobre só o que esta fase promete: criar/encerrar instâncias, grupo, privacidade
 * no servidor, idempotência, ownership Character↔Combatant, isolamento de
 * criaturas do mesmo template e o vínculo EXPLÍCITO com Concentração. Sem
 * modificadores, Conditions automáticas ou duração (6.5B/C/6.7).
 */
export async function smokeEffects(baseUrl: string, check: Check): Promise<void> {
  console.log('\n70) Fase 6.5A — Generic Effect Engine');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatantIds: string[] = [];
  const effectIds: string[] = [];
  const operationIds: string[] = [];
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({ data: { username: `eff_m_${suffix}`, displayName: 'Mestre Efeitos', passwordHash: 'fixture', role: 'MASTER' } });
    const player1 = await prisma.user.create({ data: { username: `eff_p1_${suffix}`, displayName: 'Jogador Um', passwordHash: 'fixture', role: 'PLAYER' } });
    const player2 = await prisma.user.create({ data: { username: `eff_p2_${suffix}`, displayName: 'Jogador Dois', passwordHash: 'fixture', role: 'PLAYER' } });
    userIds.push(master.id, player1.id, player2.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player1.id, username: player1.username, displayName: player1.displayName, role: player1.role });

    const characterA = await prisma.character.create({ data: { userId: player1.id, name: 'Efeito Alvo A', hpCurrent: 60, hpMax: 60, constitution: 14, speed: 9 } });
    const characterB = await prisma.character.create({ data: { userId: player2.id, name: 'Efeito Alvo B', hpCurrent: 60, hpMax: 60, constitution: 14, speed: 9 } });
    characterIds.push(characterA.id, characterB.id);

    const goblin = await prisma.creature.create({ data: { name: 'Goblin de Efeito', kind: 'CREATURE', hpCurrent: 20, hpMax: 20, speed: 9 } });
    creatureIds.push(goblin.id);

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function list(entity: MechanicalEntity, token = masterToken): Promise<EffectDto[]> {
      const res = await request(`/effects/${entity.kind}/${entity.id}`, undefined, token);
      if (res.status !== 200) throw new Error(`Falha ao listar efeitos de ${entity.kind}:${entity.id} — ${res.status} ${JSON.stringify(res.data)}`);
      return res.data.effects as EffectDto[];
    }

    async function create(body: Record<string, unknown>, token = masterToken) {
      const operationId = randomUUID();
      operationIds.push(operationId);
      const res = await request('/effects', {
        operationId,
        label: 'Efeito de teste',
        target: { kind: 'character', id: characterA.id },
        visibility: 'public',
        sourceType: 'manual',
        ...body,
      }, token);
      if (res.status === 201 && res.data.effect) effectIds.push(res.data.effect.id);
      return res;
    }

    async function end(effectId: string, body: Record<string, unknown> = {}) {
      const operationId = randomUUID();
      operationIds.push(operationId);
      return request(`/effects/${effectId}/end`, { operationId, ...body });
    }

    const entityA: MechanicalEntity = { kind: 'character', id: characterA.id };
    const entityB: MechanicalEntity = { kind: 'character', id: characterB.id };

    // --- A/B/C: criação manual, privacidade e permissão ----------------------
    const publicA = await create({ label: 'Efeito de teste' });
    check(
      '70.A) MASTER cria efeito PÚBLICO em personagem — instância ativa',
      publicA.status === 201 && publicA.data.effect.status === 'active' &&
        publicA.data.effect.visibility === 'public' && publicA.data.effect.sourceType === 'manual' &&
        publicA.data.effect.sourceLabel === 'Mestre',
      JSON.stringify(publicA.data),
    );
    const privateA = await create({ label: 'Efeito Secreto', visibility: 'private' });
    check(
      '70.B) MASTER cria efeito PRIVADO e o vê na própria listagem',
      privateA.status === 201 && privateA.data.effect.visibility === 'private' &&
        (await list(entityA)).some((effect) => effect.id === privateA.data.effect.id),
      JSON.stringify(privateA.data),
    );
    check('70.C) PLAYER não cria efeito arbitrário (403)', (await create({ label: 'Hackeado' }, playerToken)).status === 403);

    // --- K/L/M/D: visibilidade e alvo ---------------------------------------
    const playerViewA = await list(entityA, playerToken);
    check(
      '70.K/L) PLAYER recebe o efeito público e NÃO recebe o privado',
      playerViewA.some((effect) => effect.id === publicA.data.effect.id) &&
        !playerViewA.some((effect) => effect.id === privateA.data.effect.id) &&
        !JSON.stringify(playerViewA).includes('Efeito Secreto'),
      JSON.stringify(playerViewA),
    );
    const masterViewA = await list(entityA);
    check(
      '70.M) MASTER vê público E privado',
      masterViewA.some((effect) => effect.id === publicA.data.effect.id) &&
        masterViewA.some((effect) => effect.id === privateA.data.effect.id),
    );
    check('70.D) efeito de um personagem não aparece no outro', (await list(entityB)).length === 0);
    check('70) PLAYER não lê os efeitos de outro personagem (403)', (await request(`/effects/character/${characterB.id}`, undefined, playerToken)).status === 403);

    // --- F/G/N/O: encerrar UMA instância ------------------------------------
    const twin1 = await create({ label: 'Efeito Gêmeo' });
    const twin2 = await create({ label: 'Efeito Gêmeo' });
    const endedTwin = await end(twin1.data.effect.id);
    const afterEnd = await list(entityA);
    check(
      '70.F/G) encerrar marca ended e NÃO remove o outro efeito de mesmo nome',
      endedTwin.status === 200 && endedTwin.data.effect.status === 'ended' &&
        endedTwin.data.effect.endReason === 'manual' &&
        !afterEnd.some((effect) => effect.id === twin1.data.effect.id) &&
        afterEnd.some((effect) => effect.id === twin2.data.effect.id),
      JSON.stringify(endedTwin.data),
    );
    check(
      '70.N/O) releitura (refresh/reconnect) mantém os ativos e omite o encerrado',
      afterEnd.some((effect) => effect.id === publicA.data.effect.id) &&
        !afterEnd.some((effect) => effect.id === twin1.data.effect.id),
    );

    // --- P/Q: idempotência ---------------------------------------------------
    const createOperationId = randomUUID();
    operationIds.push(createOperationId);
    const idempotentBody = {
      operationId: createOperationId,
      label: 'Idempotente',
      target: { kind: 'character', id: characterA.id },
      visibility: 'public',
      sourceType: 'manual',
    };
    const firstCreate = await request('/effects', idempotentBody);
    if (firstCreate.status === 201) effectIds.push(firstCreate.data.effect.id);
    const retryCreate = await request('/effects', idempotentBody);
    check(
      '70.P) o MESMO operationId devolve a mesma instância (sem duplicar)',
      firstCreate.status === 201 && retryCreate.status === 200 && retryCreate.data.replayed === true &&
        retryCreate.data.effect.id === firstCreate.data.effect.id &&
        (await prisma.effectInstance.count({ where: { id: firstCreate.data.effect.id } })) === 1,
      JSON.stringify({ first: firstCreate.data, retry: retryCreate.data }),
    );
    check(
      '70) operationId reutilizado com outro payload é recusado',
      (await request('/effects', { ...idempotentBody, label: 'Outro nome' })).status === 409,
    );
    const endOperationId = randomUUID();
    operationIds.push(endOperationId);
    const endOnce = await end(twin2.data.effect.id, { operationId: endOperationId });
    const endTwice = await end(twin2.data.effect.id, { operationId: endOperationId });
    check(
      '70.Q) encerrar de novo é idempotente (mesmo endedAt, sem corromper)',
      endOnce.status === 200 && endTwice.status === 200 && endTwice.data.replayed === true &&
        endTwice.data.effect.id === endOnce.data.effect.id &&
        endTwice.data.effect.endedAt === endOnce.data.effect.endedAt,
      JSON.stringify({ once: endOnce.data, twice: endTwice.data }),
    );

    // --- H/I/J: grupo --------------------------------------------------------
    const groupId = `grp-${suffix}`;
    const otherGroupId = `grp-outro-${suffix}`;
    const groupA = await create({ label: 'Bless', groupId, definitionId: 'spell.bless' });
    const groupB = await create({ label: 'Bless', groupId, target: { kind: 'character', id: characterB.id } });
    const groupC = await create({ label: 'Bless', groupId, target: { kind: 'creature', id: goblin.id } });
    const outsider = await create({ label: 'Outro grupo', groupId: otherGroupId });
    const groupCreated = [groupA, groupB, groupC].every((res) => res.status === 201);
    check('70.H) três instâncias do mesmo groupId em alvos diferentes', groupCreated);
    const affectedTargets = await endEffectGroup(groupId, 'group');
    const endedGroupRows = await prisma.effectInstance.count({ where: { groupId, status: 'ended' } });
    const outsiderRow = await prisma.effectInstance.findUnique({ where: { id: outsider.data.effect.id } });
    check(
      '70.I/J) endEffectGroup encerra exatamente os três e preserva outro grupo',
      affectedTargets.length === 3 && endedGroupRows === 3 && outsiderRow?.status === 'active',
      JSON.stringify({ affectedTargets, endedGroupRows, outsider: outsiderRow?.status }),
    );

    // --- U/V: concentração MANUAL legada continua funcionando ----------------
    async function mutateCharacterA(extra: Record<string, unknown>) {
      const state = await request(`/mechanical/character/${characterA.id}`);
      const operationId = randomUUID();
      operationIds.push(operationId);
      return request('/mechanical/mutate', {
        entity: entityA,
        expectedVersion: state.data.mechanical.version,
        operationId,
        ...extra,
      });
    }
    await mutateCharacterA({ action: 'concentrate', label: 'Manual legada', visibility: 'public' });
    await noteDamageConcentration(entityA, 22, prisma, { eventId: `eff-${suffix}-legacy`, sourceName: 'Smoke' });
    const legacyTarget = await loadConcentrationTarget(entityA);
    const legacyPending = legacyTarget.state.pendingConcentrationSaves.at(-1)!;
    const legacyFailure = await resolveConcentrationSave(entityA, legacyPending.id, 0, prisma, 'Smoke');
    check(
      '70.U/V) concentração manual sem grupo termina na falha e não consulta efeito',
      legacyPending.concentrationId === legacyTarget.state.concentration?.id &&
        legacyFailure.ended === true && legacyFailure.endedEffectTargets.length === 0 &&
        (await loadConcentrationTarget(entityA)).state.concentration === null,
    );

    // --- R/S/T: ligação EXPLÍCITA concentração → grupo de efeitos -----------
    const concentrationGroup = `grp-conc-${suffix}`;
    const concEffectA = await create({ label: 'Concentrado A', groupId: concentrationGroup, target: entityA });
    const concEffectB = await create({ label: 'Concentrado B', groupId: concentrationGroup, target: entityB });
    const survivingEffect = await create({ label: 'Sobrevivente', groupId: otherGroupId, target: entityA });
    const concentrateWithGroup = await mutateCharacterA({
      action: 'concentrate',
      label: 'Bless',
      sourceType: 'effect',
      sourceId: concentrationGroup,
      visibility: 'public',
    });
    const boundTarget = await loadConcentrationTarget(entityA);
    check(
      '70.R) concentração aceita sourceType effect + sourceId (grupo)',
      concentrateWithGroup.status === 200 &&
        boundTarget.state.concentration?.sourceType === 'effect' &&
        boundTarget.state.concentration?.sourceId === concentrationGroup,
      JSON.stringify(concentrateWithGroup.data),
    );
    await noteDamageConcentration(entityA, 22, prisma, { eventId: `eff-${suffix}-conc`, sourceName: 'Smoke' });
    const boundPending = (await loadConcentrationTarget(entityA)).state.pendingConcentrationSaves.at(-1)!;
    const boundFailure = await resolveConcentrationSave(entityA, boundPending.id, 0, prisma, 'Smoke');
    const groupAfter = await prisma.effectInstance.findMany({
      where: { id: { in: [concEffectA.data.effect.id, concEffectB.data.effect.id, survivingEffect.data.effect.id] } },
      select: { id: true, status: true },
    });
    check(
      '70.S/T) falha no save encerra o grupo ligado e preserva os demais efeitos',
      boundFailure.ended === true && boundFailure.endedEffectTargets.length === 2 &&
        groupAfter.find((row) => row.id === concEffectA.data.effect.id)?.status === 'ended' &&
        groupAfter.find((row) => row.id === concEffectB.data.effect.id)?.status === 'ended' &&
        groupAfter.find((row) => row.id === survivingEffect.data.effect.id)?.status === 'active',
      JSON.stringify({ endedTargets: boundFailure.endedEffectTargets, groupAfter }),
    );

    // --- Combate: Character × Combatant, template × instância, log privado ---
    const combatStarted = await request('/combat', { entries: [{ creatureId: goblin.id, quantity: 2 }] });
    if (combatStarted.status !== 201) throw new Error(`Não iniciou o combate de efeitos: ${JSON.stringify(combatStarted.data)}`);
    const combat = combatStarted.data.combat as CombatDto;
    combatId = combat.id;
    combatantIds.push(...combat.combatants.map((item) => item.id));
    const charCombatant = combat.combatants.find((item) => item.characterId === characterA.id)!;
    const goblins = combat.combatants.filter((item) => item.creatureId === goblin.id);
    const goblinA = goblins[0];
    const goblinB = goblins[1];
    check(
      '70) personagem e duas cópias do mesmo template entram no combate',
      Boolean(charCombatant) && goblins.length === 2,
      JSON.stringify({ combatants: combat.combatants.map((item) => ({ id: item.id, kind: item.kind, name: item.name })) }),
    );

    // X/Y: efeito da FICHA projetado no combatente, sem duplicar linha.
    const projection = await list({ kind: 'combatant', id: charCombatant.id });
    const duplicated = await prisma.effectInstance.count({
      where: { targetEntityKind: 'combatant', targetEntityId: charCombatant.id },
    });
    check(
      '70.X/Y) o combatente do personagem projeta o MESMO efeito, sem duplicar instância',
      projection.some((effect) => effect.id === publicA.data.effect.id) && duplicated === 0,
      JSON.stringify({ projection: projection.map((effect) => effect.id), duplicated }),
    );

    // E/Z: efeito na INSTÂNCIA não contamina a outra cópia nem o template.
    await create({ label: 'Só no Goblin 1', target: { kind: 'combatant', id: goblinA.id } });
    const goblinBEffects = await list({ kind: 'combatant', id: goblinB.id });
    const templateEffects = await list({ kind: 'creature', id: goblin.id });
    check(
      '70.E/Z) efeito numa instância não afeta a outra cópia nem o template',
      goblinBEffects.length === 0 && templateEffects.length === 0,
    );
    check('70) PLAYER não lê efeitos de criatura/NPC (403)', (await request(`/effects/combatant/${goblinA.id}`, undefined, playerToken)).status === 403);

    // W: privacidade do log do combate (efeito privado em NPC).
    const npcSecret = await create({ label: 'Segredo do NPC', target: { kind: 'combatant', id: goblinA.id }, visibility: 'private' });
    const playerCombat = (await request('/combat/active', undefined, playerToken)).data.combat as CombatDto;
    const masterCombat = (await request('/combat/active')).data.combat as CombatDto;
    check(
      '70.W) log de efeito PRIVADO não vaza para o PLAYER e aparece para o MASTER',
      npcSecret.status === 201 &&
        !JSON.stringify(playerCombat.economyLog).includes('Segredo do NPC') &&
        JSON.stringify(masterCombat.economyLog).includes('Segredo do NPC'),
      JSON.stringify({ playerLog: playerCombat.economyLog.slice(-2), masterLog: masterCombat.economyLog.slice(-2) }),
    );

    // 70: efeito sobrevive ao combate (fora → dentro → fora).
    await request('/combat/end', {});
    const afterCombat = await list(entityA);
    check(
      '70) efeito criado fora do combate continua ativo depois que o combate termina',
      afterCombat.some((effect) => effect.id === publicA.data.effect.id),
    );
  } finally {
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    if (effectIds.length > 0) await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
    if (operationIds.length > 0) await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    const entityIds = [...characterIds, ...creatureIds, ...combatantIds];
    if (entityIds.length > 0) {
      await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    if (creatureIds.length > 0) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
