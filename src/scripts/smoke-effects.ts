import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  loadConcentrationTarget,
  noteDamageConcentration,
  resolveConcentrationSave,
} from '../modules/concentration/concentration.service.js';
import { endEffectGroup } from '../modules/effects/effects.service.js';
import {
  buildEffectModifierSet,
  parseEffectModifiers,
  rollModifiersFor,
} from '../modules/effects/effect-modifiers.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';
import { resolveRollMode, type MechanicalEntity } from '../modules/shared/conditions.js';
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
      const mechanical = state.data.mechanical;
      return request('/mechanical/mutate', {
        entity: entityA,
        expectedVersion: mechanical.version,
        // Com combate ativo a mutação exige a versão do combate também — sem
        // ela o servidor recusa (409) e o teste mentiria.
        ...(mechanical.combat ? { expectedCombatVersion: mechanical.combat.version } : {}),
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

    // =====================================================================
    // FASE 6.5B — MODIFICADORES MECÂNICOS GENÉRICOS
    // =====================================================================
    console.log('\n70B) Fase 6.5B — modificadores de efeito');

    // --- Composição PURA (sem DB): stacking, pool de dados, cancelamento ---
    const composed = buildEffectModifierSet([
      { id: 'mod-1', label: 'Um', visibility: 'public', modifiers: [{ kind: 'roll-flat', roll: 'attack', value: 1 }] },
      { id: 'mod-2', label: 'Dois', visibility: 'public', modifiers: [{ kind: 'roll-flat', roll: 'attack', value: 2 }] },
      { id: 'mod-3', label: 'Dados', visibility: 'public', modifiers: [{ kind: 'roll-dice', roll: 'attack', count: 1, sides: 4, sign: 1 }, { kind: 'roll-dice', roll: 'attack', count: 1, sides: 6, sign: 1 }] },
      { id: 'mod-4', label: 'CA', visibility: 'public', modifiers: [{ kind: 'ac-flat', value: 1 }, { kind: 'ac-flat', value: 2 }] },
      { id: 'mod-5', label: 'Vantagens', visibility: 'public', modifiers: [{ kind: 'roll-advantage', roll: 'save' }, { kind: 'roll-advantage', roll: 'save' }] },
      { id: 'mod-6', label: 'Desvantagem', visibility: 'private', modifiers: [{ kind: 'roll-disadvantage', roll: 'save' }] },
    ]);
    const attackMods = rollModifiersFor(composed, 'attack');
    const saveMods = rollModifiersFor(composed, 'save', 'dexterity');
    check(
      '70B) numéricos STACKAM e dados de fontes diferentes formam pool independente',
      attackMods.bonus === 3 && attackMods.dice.length === 2 &&
        attackMods.dice.some((die) => die.sides === 4) && attackMods.dice.some((die) => die.sides === 6) &&
        composed.acBonus === 3,
      JSON.stringify({ attackMods, acBonus: composed.acBonus }),
    );
    check(
      '70B) vantagem/desvantagem são conjuntos de fontes (não "dupla vantagem") e cancelam',
      saveMods.advantage.length >= 2 && saveMods.disadvantage.length === 1 &&
        !resolveRollMode(saveMods.advantage, saveMods.disadvantage).advantage &&
        !resolveRollMode(saveMods.advantage, saveMods.disadvantage).disadvantage,
      JSON.stringify(saveMods),
    );
    check(
      '70B) JSON inválido/absurdo vira lista vazia (nenhuma regra nasce de dado corrompido)',
      parseEffectModifiers([{ kind: 'roll-flat', roll: 'attack', value: 999 }]).length === 0 &&
        parseEffectModifiers('nope').length === 0 &&
        parseEffectModifiers([{ kind: 'roll-dice', roll: 'save', count: 1, sides: 7, sign: 1 }]).length === 0,
    );

    // --- Criação com modificadores e validação SERVER-SIDE ------------------
    const invalidModifier = await create({ label: 'Inválido', modifiers: [{ kind: 'ac-flat', value: 500 }] });
    check('70B) servidor recusa modificador fora do schema (400)', invalidModifier.status === 400, JSON.stringify(invalidModifier.data));
    const unknownKind = await create({ label: 'Inválido', modifiers: [{ kind: 'summon-dragon' }] });
    check('70B) servidor recusa kind desconhecido (400)', unknownKind.status === 400);

    const baseSheet = (await request('/characters/me', undefined, playerToken)).data.character;
    const acEffect = await create({ label: 'Teste +2 AC', modifiers: [{ kind: 'ac-flat', value: 2 }] });
    const speedEffect = await create({ label: 'Teste +3m', modifiers: [{ kind: 'speed-flat', value: 3 }] });
    const withAc = (await request('/characters/me', undefined, playerToken)).data.character;
    check(
      '70B) AC derivada da ficha soma o modificador de efeito e devolve o valor original ao encerrar',
      acEffect.status === 201 && withAc.armorClass === baseSheet.armorClass + 2 &&
        withAc.effectiveSpeed === baseSheet.effectiveSpeed + 3,
      JSON.stringify({ base: baseSheet.armorClass, comEfeito: withAc.armorClass, speed: withAc.effectiveSpeed }),
    );
    await end(acEffect.data.effect.id);
    await end(speedEffect.data.effect.id);
    const afterAcEnd = (await request('/characters/me', undefined, playerToken)).data.character;
    check(
      '70B) encerrar o efeito devolve CA/deslocamento (nada foi gravado na ficha)',
      afterAcEnd.armorClass === baseSheet.armorClass && afterAcEnd.effectiveSpeed === baseSheet.effectiveSpeed,
      JSON.stringify({ armorClass: afterAcEnd.armorClass, speed: afterAcEnd.effectiveSpeed }),
    );

    // --- Rolagem de SALVAGUARDA: bônus fixo + dado extra --------------------
    async function roll(body: Record<string, unknown>, token = playerToken) {
      return request('/dice/roll', { entity: entityA, dice: [{ sides: 20 }], ...body }, token);
    }
    const conEffect = await create({
      label: 'Teste +2 Con',
      modifiers: [{ kind: 'roll-flat', roll: 'save', ability: 'constitution', value: 2 }],
    });
    const saveCon = await roll({ kind: 'save', ability: 'constitution', bonus: 0 });
    const saveDex = await roll({ kind: 'save', ability: 'dexterity', bonus: 0 });
    check(
      '70B) salvaguarda com filtro de atributo: CON recebe +2, DES não',
      conEffect.status === 201 && saveCon.data.roll.effectModifiers?.bonus === 2 &&
        (saveDex.data.roll.effectModifiers?.bonus ?? 0) === 0,
      JSON.stringify({ con: saveCon.data.roll.effectModifiers, dex: saveDex.data.roll.effectModifiers }),
    );
    const diceEffect = await create({
      label: 'Teste +1d4 Save',
      modifiers: [{ kind: 'roll-dice', roll: 'save', count: 1, sides: 4, sign: 1 }],
    });
    const saveDice = await roll({ kind: 'save', ability: 'wisdom', bonus: 0 });
    const rolledDie = saveDice.data.roll.effectModifiers?.dice?.[0];
    check(
      '70B) dado extra do efeito é rolado no SERVIDOR e entra no total',
      diceEffect.status === 201 && rolledDie?.sides === 4 && rolledDie.value >= 1 && rolledDie.value <= 4 &&
        saveDice.data.roll.total ===
          saveDice.data.roll.dice.filter((die: { dropped?: boolean }) => !die.dropped).reduce((sum: number, die: { value: number }) => sum + die.value, 0) +
            saveDice.data.roll.bonus + rolledDie.value,
      JSON.stringify(saveDice.data.roll),
    );
    await end(conEffect.data.effect.id);
    await end(diceEffect.data.effect.id);

    // --- Vantagem/desvantagem e interação com Exaustão/Dodge ---------------
    const advEffect = await create({
      label: 'Teste Vantagem Save',
      modifiers: [{ kind: 'roll-advantage', roll: 'save' }],
    });
    const saveAdv = await roll({ kind: 'save', ability: 'strength', bonus: 0 });
    const disEffect = await create({
      label: 'Teste Desvantagem Save',
      modifiers: [{ kind: 'roll-disadvantage', roll: 'save' }],
    });
    const saveBoth = await roll({ kind: 'save', ability: 'strength', bonus: 0 });
    check(
      '70B) vantagem de efeito vale; vantagem + desvantagem voltam a NORMAL',
      advEffect.status === 201 && saveAdv.data.roll.advantage === true &&
        disEffect.status === 201 && saveBoth.data.roll.advantage === false && saveBoth.data.roll.disadvantage === false,
      JSON.stringify({ adv: saveAdv.data.roll, both: saveBoth.data.roll }),
    );
    await end(disEffect.data.effect.id);
    // Exaustão 3 (desvantagem em saves) + vantagem de efeito = NORMAL: prova a
    // integração entre o motor de Conditions e o de Efeitos.
    await mutateCharacterA({ action: 'exhaustion', exhaustionLevel: 3 });
    const exhaustedWithAdv = await roll({ kind: 'save', ability: 'strength', bonus: 0 });
    check(
      '70B) vantagem de efeito cancela a desvantagem de Exaustão 3 (modo normal)',
      exhaustedWithAdv.data.roll.advantage === false && exhaustedWithAdv.data.roll.disadvantage === false,
      JSON.stringify(exhaustedWithAdv.data.roll),
    );
    await mutateCharacterA({ action: 'exhaustion', exhaustionLevel: 0 });
    await end(advEffect.data.effect.id);

    // --- Teste de habilidade (check) e Poisoned ----------------------------
    const checkEffect = await create({
      label: 'Teste +2 Wisdom',
      modifiers: [{ kind: 'roll-flat', roll: 'check', ability: 'wisdom', value: 2 }],
    });
    const wisdomCheck = await roll({ kind: 'skill', ability: 'wisdom', label: 'Percepção', bonus: 0 });
    const charismaCheck = await roll({ kind: 'skill', ability: 'charisma', label: 'Persuasão', bonus: 0 });
    check(
      '70B) teste de habilidade recebe o benefício só no atributo do modificador',
      checkEffect.status === 201 && wisdomCheck.data.roll.effectModifiers?.bonus === 2 &&
        (charismaCheck.data.roll.effectModifiers?.bonus ?? 0) === 0,
      JSON.stringify({ wis: wisdomCheck.data.roll.effectModifiers, cha: charismaCheck.data.roll.effectModifiers }),
    );
    await mutateCharacterA({ action: 'apply', condition: 'poisoned' });
    const poisonedCheck = await roll({ kind: 'skill', ability: 'wisdom', label: 'Percepção', bonus: 0 });
    check(
      '70B) Poisoned continua dando desvantagem em teste (Conditions preservadas)',
      poisonedCheck.data.roll.disadvantage === true,
      JSON.stringify(poisonedCheck.data.roll),
    );
    const poisonedRows = (await request(`/mechanical/character/${characterA.id}`)).data.mechanical.state.conditions;
    for (const row of poisonedRows) {
      if (row.condition === 'poisoned') await mutateCharacterA({ action: 'remove', instanceId: row.id });
    }
    await end(checkEffect.data.effect.id);

    // --- Concentração: modificador de Constituição vale no Constitution Save ---
    const concBonusEffect = await create({
      label: 'Teste +2 Constitution Save',
      modifiers: [{ kind: 'roll-flat', roll: 'save', ability: 'constitution', value: 2 }],
    });
    await mutateCharacterA({ action: 'concentrate', label: 'Concentração com efeito', visibility: 'public' });
    await noteDamageConcentration(entityA, 22, prisma, { eventId: `eff-${suffix}-mod`, sourceName: 'Smoke' });
    const concPending = (await loadConcentrationTarget(entityA)).state.pendingConcentrationSaves.at(-1)!;
    const concRoll = await roll({
      kind: 'concentration',
      pendingConcentrationSaveId: concPending.id,
      advantage: true,
    });
    check(
      '70B) Concentration Save recebe o bônus de Constituição do efeito e IGNORA advantage do cliente',
      concBonusEffect.status === 201 && concRoll.data.roll.effectModifiers?.bonus === 2 &&
        concRoll.data.roll.advantage === false && concRoll.data.roll.dice.length === 1,
      JSON.stringify(concRoll.data.roll),
    );
    const concState = (await request(`/mechanical/character/${characterA.id}`)).data.mechanical;
    if (concState.state.concentration) {
      await mutateCharacterA({ action: 'concentrate-end', concentrationId: concState.state.concentration.id });
    }
    await end(concBonusEffect.data.effect.id);

    // --- Tabela de combate: CA derivada do personagem e isolamento de NPC ---
    const charEffectAc = await create({ label: 'Teste +2 AC combate', modifiers: [{ kind: 'ac-flat', value: 2 }] });
    const npcEffectAc = await create({
      label: 'Teste +2 AC goblin',
      target: { kind: 'combatant', id: goblinA.id },
      modifiers: [{ kind: 'ac-flat', value: 2 }],
    });
    const combatWithEffects = (await request('/combat/active')).data.combat as CombatDto;
    const charCard = combatWithEffects.combatants.find((item) => item.characterId === characterA.id)!;
    const goblinCardA = combatWithEffects.combatants.find((item) => item.id === goblinA.id)!;
    const goblinCardB = combatWithEffects.combatants.find((item) => item.id === goblinB.id)!;
    check(
      '70B) CA do personagem no combate usa o MESMO efeito da ficha (sem duplicar)',
      charEffectAc.status === 201 && charCard.armorClass === afterAcEnd.armorClass + 2 &&
        (await prisma.effectInstance.count({ where: { targetEntityKind: 'combatant', targetEntityId: charCombatant.id, status: 'active' } })) === 0,
      JSON.stringify({ armorClass: charCard.armorClass, ficha: afterAcEnd.armorClass }),
    );
    check(
      '70B) modificador numa criatura NÃO contamina a outra cópia do mesmo template',
      npcEffectAc.status === 201 && goblinCardA.armorClass === (goblinCardB.armorClass ?? 0) + 2,
      JSON.stringify({ a: goblinCardA.armorClass, b: goblinCardB.armorClass }),
    );
    await end(charEffectAc.data.effect.id);
    await end(npcEffectAc.data.effect.id);

    // --- Efeito PRIVADO: mecânica vale, nome não vaza ----------------------
    const secretSave = await create({
      label: 'Ritual Secreto',
      visibility: 'private',
      modifiers: [{ kind: 'roll-flat', roll: 'save', value: 2 }],
    });
    const secretRoll = await roll({ kind: 'save', ability: 'charisma', bonus: 0 });
    check(
      '70B) efeito PRIVADO aplica a mecânica (bônus +2) e sanitiza o nome no breakdown',
      secretSave.status === 201 && secretRoll.data.roll.effectModifiers?.bonus === 2 &&
        secretRoll.data.roll.effectModifiers.sources.length > 0 &&
        secretRoll.data.roll.effectModifiers.sources.every((label: string | null) => label === null) &&
        !JSON.stringify(secretRoll.data.roll).includes('Ritual Secreto'),
      JSON.stringify(secretRoll.data.roll.effectModifiers),
    );
    await end(secretSave.data.effect.id);
    const afterSecretEnd = await roll({ kind: 'save', ability: 'charisma', bonus: 0 });
    check(
      '70B) efeito ended não modifica mais nenhuma rolagem',
      (afterSecretEnd.data.roll.effectModifiers?.bonus ?? 0) === 0,
      JSON.stringify(afterSecretEnd.data.roll.effectModifiers),
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
