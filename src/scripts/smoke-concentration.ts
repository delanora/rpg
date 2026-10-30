import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { mechanicalStateOf, type MechanicalEntity } from '../modules/shared/conditions.js';
import { concentrationDc } from '../modules/shared/concentration.js';
import {
  loadConcentrationTarget,
  noteDamageConcentration,
  resolveConcentrationSave,
} from '../modules/concentration/concentration.service.js';
import { deriveConditionEffects } from '../modules/shared/conditions.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import type { MechanicalDto } from '../modules/mechanical/mechanical.service.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.4 — CONCENTRAÇÃO (PHB 2014).
 *
 * Cobre o domínio puro (CD/DC, fila de pendências, save antigo) e o caminho
 * REAL: `POST /mechanical/mutate` (iniciar/encerrar), dano por ataque e por
 * ajuste do Mestre, bandeja de dados (`POST /dice/roll` com `kind:
 * 'concentration'`), DTO do combate para jogador e Mestre.
 */
export async function smokeConcentration(baseUrl: string, check: Check): Promise<void> {
  console.log('\n69) Fase 6.4 — Concentração');

  // --- CD do teste (PHB 2014): max(10, floor(dano / 2)) --------------------
  check('69.J) 1 de dano → CD 10', concentrationDc(1) === 10);
  check('69.K) 19 de dano → CD 10', concentrationDc(19) === 10);
  check('69.L) 20 de dano → CD 10', concentrationDc(20) === 10);
  check('69.M) 21 de dano → CD 10', concentrationDc(21) === 10);
  check('69.N) 22 de dano → CD 11', concentrationDc(22) === 11);
  check('69.O) 40 de dano → CD 20', concentrationDc(40) === 20);

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const entityIds: string[] = [];
  let characterId: string | undefined;
  let creatureId: string | undefined;
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({ data: { username: `conc_m_${suffix}`, displayName: 'Mestre Concentração', passwordHash: 'fixture', role: 'MASTER' } });
    userIds.push(master.id);
    const player = await prisma.user.create({ data: { username: `conc_p_${suffix}`, displayName: 'Jogador Concentração', passwordHash: 'fixture', role: 'PLAYER' } });
    userIds.push(player.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });

    const inventory = inventoryListSchema.parse([]);
    // CON 14 + Guerreiro nível 5: salvaguarda de Constituição com proficiência
    // → bônus final +5 (modificador +2, proficiência +3). É a MESMA conta da ficha.
    const character = await prisma.character.create({
      data: {
        userId: player.id,
        name: 'Concentração Jogador',
        hpCurrent: 101,
        hpMax: 101,
        speed: 30,
        constitution: 14,
        classes: [{ classKey: 'fighter', level: 5, subclass: '' }],
        inventory,
        attacks: [
          { id: 'two', name: 'Dois tipos de dano', attackBonus: 30, damage: { count: 0, sides: 0, bonus: 9, type: 'Fogo' }, extraDamages: [{ count: 0, sides: 0, bonus: 3, type: 'Radiante' }], finesse: false, ranged: false, notes: '' },
          { id: 'heavy', name: 'Dano fixo grande', attackBonus: 30, damage: { count: 0, sides: 0, bonus: 40, type: 'Fogo' }, extraDamages: [], finesse: false, ranged: false, notes: '' },
        ],
      },
    });
    characterId = character.id;
    entityIds.push(character.id);
    const ownEntity: MechanicalEntity = { kind: 'character', id: character.id };

    const creature = await prisma.creature.create({ data: { name: 'Cultista Concentração', hpCurrent: 200, hpMax: 200, speed: 9, constitution: 14 } });
    creatureId = creature.id;
    entityIds.push(creature.id);

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json()) as any };
    }
    const read = async (entity: MechanicalEntity = ownEntity, token = masterToken) => {
      const res = await request(`/mechanical/${entity.kind}/${entity.id}`, undefined, token);
      const mechanical = res.data.mechanical as MechanicalDto | undefined;
      if (!mechanical) throw new Error(`Falha ao ler ${entity.kind}:${entity.id} — ${res.status} ${JSON.stringify(res.data)}`);
      return mechanical;
    };
    async function mutation(entity: MechanicalEntity, extra: Record<string, unknown>, token = masterToken) {
      const current = await read(entity, token);
      return request('/mechanical/mutate', {
        entity: current.entity,
        expectedVersion: current.version,
        expectedCombatVersion: current.combat?.version,
        operationId: randomUUID(),
        ...extra,
      }, token);
    }
    const concentrate = async (entity: MechanicalEntity = ownEntity, label = 'Bless', visibility = 'public', token = masterToken) =>
      mutation(entity, { action: 'concentrate', label, visibility }, token);
    const concentrationOf = (mechanical: MechanicalDto) => mechanical.state.concentration;

    // --- A/B/C: iniciar, badge e label --------------------------------------
    const started = await concentrate();
    let own = await read();
    check('69.A) Mestre inicia concentração manual', started.status === 200, JSON.stringify(started.data));
    check('69.B/C) etiqueta e nome do efeito aparecem no estado', own.state.concentration?.label === 'Bless' && own.state.concentration?.sourceType === 'manual');

    // --- D/E: encerrar voluntariamente (o próprio jogador) -------------------
    const current = own.state.concentration!;
    const ended = await mutation(ownEntity, { action: 'concentrate-end', concentrationId: current.id }, playerToken);
    check('69.D/E) jogador encerra a própria concentração e a etiqueta some', ended.status === 200 && (await read()).state.concentration === null);

    // --- F–I: uma por criatura; a nova SUBSTITUI a anterior -----------------
    await concentrate(ownEntity, 'Bless');
    const first = (await read()).state.concentration!;
    await concentrate(ownEntity, 'Segurar Pessoa');
    own = await read();
    check(
      '69.F–I) iniciar B encerra A e mantém UMA concentração',
      own.state.concentration?.label === 'Segurar Pessoa' && own.state.concentration?.id !== first.id &&
        own.state.log.some((entry) => entry.message.includes('encerrou a concentração em Bless')),
    );

    // --- Filas, save antigo e dano 0 (domínio) -------------------------------
    const queueTarget = await loadConcentrationTarget(ownEntity);
    const queueState = queueTarget.state;
    // Dois eventos de dano ANTES de resolver o primeiro: duas pendências.
    await noteDamageConcentration(ownEntity, 22, prisma, 'Fonte A');
    await noteDamageConcentration(ownEntity, 44, prisma, 'Fonte B');
    let queued = (await loadConcentrationTarget(ownEntity)).state;
    check(
      '69.AF) dois eventos de dano geram DUAS pendências (sem sobrescrever)',
      queued.pendingConcentrationSaves.length === 2 &&
        queued.pendingConcentrationSaves[0].dc === 11 &&
        queued.pendingConcentrationSaves[1].dc === 22,
      JSON.stringify(queued.pendingConcentrationSaves),
    );
    check('69.P) dano efetivo 0 não gera teste', (await noteDamageConcentration(ownEntity, 0, prisma, 'Fonte nula')).changed === false);

    // Sucesso mantém a concentração e remove SÓ a pendência resolvida.
    const firstPending = queued.pendingConcentrationSaves[0];
    const success = await resolveConcentrationSave(ownEntity, firstPending.id, firstPending.dc, prisma, 'Teste');
    queued = (await loadConcentrationTarget(ownEntity)).state;
    check(
      '69.T) save >= CD mantém a concentração e limpa a pendência',
      success.success && queued.concentration !== null && queued.pendingConcentrationSaves.length === 1,
    );
    // Falha encerra e descarta as pendências restantes da MESMA concentração.
    const second = queued.pendingConcentrationSaves[0];
    const failure = await resolveConcentrationSave(ownEntity, second.id, second.dc - 1, prisma, 'Teste');
    queued = (await loadConcentrationTarget(ownEntity)).state;
    check(
      '69.AG/AH/U) falha encerra a concentração e invalida as pendências seguintes',
      !failure.success && failure.ended && queued.concentration === null && queued.pendingConcentrationSaves.length === 0,
    );

    // Save pendente de A não pode quebrar a concentração B: a troca invalida a
    // pendência antiga, e uma rolagem atrasada é recusada sem tocar em B.
    await concentrate(ownEntity, 'A');
    await noteDamageConcentration(ownEntity, 22, prisma, 'Fonte antiga');
    const stalePending = (await read()).state.pendingConcentrationSaves[0];
    await concentrate(ownEntity, 'B');
    const staleRoll = await request('/dice/roll', {
      kind: 'concentration',
      entity: ownEntity,
      pendingConcentrationSaveId: stalePending.id,
      dice: [{ sides: 20 }],
    }, playerToken);
    own = await read();
    check(
      '69.AI–AL) save antigo de A é recusado e NÃO quebra B',
      staleRoll.status === 409 && own.state.concentration?.label === 'B',
      JSON.stringify({ status: staleRoll.status, label: own.state.concentration?.label }),
    );
    await mutation(ownEntity, { action: 'concentrate-end' });

    // --- Combate real: dano, pendência, bandeja, condições ------------------
    const combatStarted = await request('/combat', { entries: [{ creatureId: creature.id, quantity: 1 }] });
    if (combatStarted.status !== 201) throw new Error(`Não iniciou o combate de concentração: ${JSON.stringify(combatStarted.data)}`);
    let combat = combatStarted.data.combat as CombatDto;
    combatId = combat.id;
    const playerCombatant = combat.combatants.find((item) => item.characterId === character.id)!;
    const npcCombatant = combat.combatants.find((item) => item.creatureId === creature.id)!;
    const refreshCombat = async (token = masterToken) => {
      combat = (await request('/combat/active', undefined, token)).data.combat as CombatDto;
      return combat;
    };
    // Iniciativa de todos → combate ACTIVE (o ataque exige o turno do atacante).
    for (const participant of combat.combatants) await request(`/combat/initiative/${participant.id}`, {});
    await refreshCombat();
    for (let i = 0; combat.status === 'ACTIVE' && combat.currentCombatantId !== playerCombatant.id && i < combat.combatants.length + 1; i += 1) {
      const next = await request('/combat/next-turn', { combatId, expectedVersion: combat.version, operationId: randomUUID() });
      if (next.status !== 200) throw new Error(`Falha no avanço de turno: ${JSON.stringify(next.data)}`);
      combat = next.data.combat as CombatDto;
    }
    check('69) combate ativo no turno do jogador para os testes de dano', combat.status === 'ACTIVE' && combat.currentCombatantId === playerCombatant.id, JSON.stringify({ status: combat.status, current: combat.currentCombatantId, player: playerCombatant.id }));
    const damage = async (combatantId: string, amount: number) => {
      await refreshCombat();
      return request('/combat/hp', { combatantId, amount, mode: 'damage' });
    };

    await concentrate();
    // Dano manual do Mestre (5) num personagem CONCENTRANDO → CD 10 pendente.
    const hit = await damage(playerCombatant.id, 5);
    own = await read();
    check(
      '69) dano efetivo gera UM teste pendente com o CD correto',
      hit.status === 200 && own.state.pendingConcentrationSaves.length === 1 && own.state.pendingConcentrationSaves[0].dc === 10 && own.state.pendingConcentrationSaves[0].damage === 5,
      JSON.stringify({ status: hit.status, pendings: own.state.pendingConcentrationSaves }),
    );
    check('69.AM/AP) o teste do jogador aparece público no card', (await refreshCombat(playerToken)).combatants.find((item) => item.id === playerCombatant.id)!.mechanicalState.pendingConcentrationSaves.length === 1);

    const pendingId = own.state.pendingConcentrationSaves[0].id;
    const roll = await request('/dice/roll', { kind: 'concentration', entity: ownEntity, pendingConcentrationSaveId: pendingId, dice: [{ sides: 20 }] }, playerToken);
    own = await read();
    const rollTotal = roll.data.roll?.total ?? 0;
    check(
      '69.L/AQ–AT) bandeja rola a salvaguarda de Constituição com proficiência (bônus +5) e resolve a pendência',
      roll.status === 201 && roll.data.roll.bonus === 5 && roll.data.roll.kind === 'concentration' &&
        roll.data.roll.label.includes('CD 10') && own.state.pendingConcentrationSaves.length === 0 &&
        (rollTotal >= 10 ? own.state.concentration !== null : own.state.concentration === null),
      JSON.stringify({ roll: roll.data.roll, concentration: own.state.concentration?.label }),
    );

    // Repetir o mesmo teste não é possível (pendência resolvida = idempotência).
    check('69) teste já resolvido não é rolado de novo', (await request('/dice/roll', { kind: 'concentration', entity: ownEntity, pendingConcentrationSaveId: pendingId, dice: [{ sides: 20 }] }, playerToken)).status === 409);

    // Vantagem/desvantagem passam pelo MESMO pipeline de salvaguarda.
    await mutation(ownEntity, { action: 'concentrate-end' });
    await concentrate();
    await damage(playerCombatant.id, 5);
    let nextPending = (await read()).state.pendingConcentrationSaves.at(-1)!;
    const advRoll = await request('/dice/roll', { kind: 'concentration', entity: ownEntity, pendingConcentrationSaveId: nextPending.id, advantage: true, dice: [{ sides: 20 }] }, playerToken);
    check('69) vantagem declarada soma 2d20 e mantém o maior', advRoll.status === 201 && advRoll.data.roll.advantage === true && advRoll.data.roll.dice.length === 2);

    await mutation(ownEntity, { action: 'concentrate-end' });
    await concentrate();
    await damage(playerCombatant.id, 5);
    nextPending = (await read()).state.pendingConcentrationSaves.at(-1)!;
    const mixRoll = await request('/dice/roll', { kind: 'concentration', entity: ownEntity, pendingConcentrationSaveId: nextPending.id, advantage: true, disadvantage: true, dice: [{ sides: 20 }] }, playerToken);
    check('69) vantagem + desvantagem cancelam (rolagem normal)', mixRoll.status === 201 && !mixRoll.data.roll.advantage && !mixRoll.data.roll.disadvantage && mixRoll.data.roll.dice.length === 1);

    // --- Incapacitated encerra SEM save / remover não reativa ---------------
    await mutation(ownEntity, { action: 'concentrate-end' });
    await concentrate();
    await mutation(ownEntity, { action: 'apply', condition: 'stunned' });
    own = await read();
    check(
      '69.X/Y/AB) Atordoado (Incapacitado) encerra a concentração na hora, sem pendência',
      own.state.concentration === null && own.state.pendingConcentrationSaves.length === 0,
    );
    await mutation(ownEntity, { action: 'remove', instanceId: own.state.conditions.find((instance) => instance.condition === 'stunned')!.id });
    own = await read();
    check('69.AD/AE) remover a condição NÃO reativa a concentração', own.state.concentration === null && !deriveConditionEffects(own.state).incapacitated);

    // --- 0 PV / Inconsciente encerra e não pede save -------------------------
    await concentrate();
    // 120 > 101 PV (chega a 0) mas o dano restante (19) é menor que o PV máximo:
    // é queda normal, sem morte instantânea — a cura depois é permitida.
    const lethal = await damage(playerCombatant.id, 120);
    own = await read();
    check(
      '69.Z/AA) dano que leva a 0 PV encerra a concentração e NÃO cria teste',
      lethal.status === 200 && own.hpCurrent === 0 &&
        own.state.concentration === null && own.state.pendingConcentrationSaves.length === 0,
      JSON.stringify({ hp: own.hpCurrent, concentration: own.state.concentration, pendings: own.state.pendingConcentrationSaves.length }),
    );
    // O Mestre devolve o personagem para seguir o teste.
    await request('/combat/hp', { combatantId: playerCombatant.id, amount: 500, mode: 'heal' });

    // --- Q/R/S: multi-componente = UM teste; hits separados = testes distintos
    const npcStarted = await concentrate({ kind: 'combatant', id: npcCombatant.id }, 'Maldição do Cultista');
    // 1 natural sempre erra: repete (devolvendo a Ação) até um acerto real.
    async function attackNpc(attackId: string) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        // Devolve a Ação antes de cada tentativa (1 natural sempre erra).
        await refreshCombat();
        await request('/combat/economy/override', {
          combatId,
          expectedVersion: combat.version,
          operationId: randomUUID(),
          combatantId: playerCombatant.id,
          adjustment: 'restore-action',
          reason: 'Ataques do smoke de concentração',
        });
        await refreshCombat();
        const res = await request('/combat/attack', {
          combatId: combat.id,
          expectedVersion: combat.version,
          operationId: randomUUID(),
          attackId,
          targetCombatantId: npcCombatant.id,
        }, playerToken);
        if (res.status !== 200 || res.data.result.hit) return res;
      }
      throw new Error(`Não obteve acerto com ${attackId}.`);
    }
    const attack = await attackNpc('two');
    const npcState = (await read({ kind: 'combatant', id: npcCombatant.id })).state;
    check(
      '69.Q/R) ataque com 2 componentes gera UM único teste, com o dano TOTAL',
      attack.status === 200 && npcState.pendingConcentrationSaves.length === 1 &&
        npcState.pendingConcentrationSaves[0].damage === attack.data.result.damageRolled &&
        npcState.pendingConcentrationSaves[0].dc === concentrationDc(attack.data.result.damageRolled),
      JSON.stringify({ start: npcStarted.status, attack: attack.status, message: attack.data.message, version: combat.version, current: combat.currentCombatantId, player: playerCombatant.id, result: attack.data.result?.damageRolled, pendings: npcState.pendingConcentrationSaves }),
    );
    const secondAttack = await attackNpc('heavy');
    const npcState2 = (await read({ kind: 'combatant', id: npcCombatant.id })).state;
    check(
      '69.S) hit separado NÃO sobrescreve o teste anterior',
      secondAttack.status === 200 && npcState2.pendingConcentrationSaves.length === 2 &&
        npcState2.pendingConcentrationSaves[1].damage === secondAttack.data.result.damageRolled,
      JSON.stringify({ status: secondAttack.status, message: secondAttack.data.message, result: secondAttack.data.result && { hit: secondAttack.data.result.hit, damage: secondAttack.data.result.damageRolled, roll: secondAttack.data.result.attackRoll }, pendings: npcState2.pendingConcentrationSaves }),
    );

    // --- NPC: público × privado ---------------------------------------------
    const npcEntity: MechanicalEntity = { kind: 'combatant', id: npcCombatant.id };
    await concentrate(npcEntity, 'Ritual Secreto', 'private');
    const npcPlayerView = (await refreshCombat(playerToken)).combatants.find((item) => item.id === npcCombatant.id)!;
    const npcMasterView = (await refreshCombat()).combatants.find((item) => item.id === npcCombatant.id)!;
    check(
      '69.AY) concentração PRIVADA do NPC não vaza o nome para o jogador',
      npcPlayerView.mechanicalState.concentration === null &&
        npcPlayerView.mechanicalState.pendingConcentrationSaves.length === 0 &&
        npcMasterView.mechanicalState.concentration?.label === 'Ritual Secreto',
    );
    await concentrate(npcEntity, 'Maldição Pública', 'public');
    const npcPublicView = (await refreshCombat(playerToken)).combatants.find((item) => item.id === npcCombatant.id)!;
    check('69) concentração PÚBLICA do NPC mostra a etiqueta ao jogador', npcPublicView.mechanicalState.concentration?.label === 'Maldição Pública');

    // Dano no NPC → pendência da concentração pública atual.
    await damage(npcCombatant.id, 5);
    const npcPending = (await read(npcEntity)).state.pendingConcentrationSaves.at(-1)!;
    const privateRoll = await request('/dice/roll', { kind: 'concentration', entity: npcEntity, pendingConcentrationSaveId: npcPending.id, visibility: 'private', dice: [{ sides: 20 }] });
    check(
      '69.AN/AO) teste de NPC privado vai SÓ para os Mestres (audience masters)',
      privateRoll.status === 201 && privateRoll.data.roll.audience === 'masters' && privateRoll.data.roll.isPrivate === true,
      JSON.stringify(privateRoll.data.roll),
    );
    // Se a falha encerrou a concentração, começa outra para testar o público.
    if ((await read(npcEntity)).state.concentration === null) await concentrate(npcEntity, 'Maldição Pública', 'public');
    await damage(npcCombatant.id, 5);
    const npcPending2 = (await read(npcEntity)).state.pendingConcentrationSaves.at(-1);
    const publicRoll = npcPending2
      ? await request('/dice/roll', { kind: 'concentration', entity: npcEntity, pendingConcentrationSaveId: npcPending2.id, visibility: 'public', dice: [{ sides: 20 }] })
      : { status: 0, data: {} as any };
    check(
      '69.AN) teste de NPC público vai para a mesa',
      publicRoll.status === 201 && publicRoll.data.roll.audience === undefined && publicRoll.data.roll.isPrivate === false,
      JSON.stringify(publicRoll.data.roll ?? publicRoll.status),
    );

    // --- Reconnect: estado e pendência persistem ----------------------------
    await concentrate();
    await damage(playerCombatant.id, 5);
    own = await read();
    check(
      '69.AU–AX) refresh mantém concentração ativa E a pendência',
      own.state.concentration !== null && own.state.pendingConcentrationSaves.length === 1,
    );

    await request('/combat/end', {});
    check('69) encerrar o combate preserva a concentração (não é exclusiva de combate)', (await read()).state.concentration !== null);
  } finally {
    if (combatId) {
      const participants = await prisma.combatant.findMany({ where: { combatId }, select: { id: true } });
      entityIds.push(...participants.map((item) => item.id));
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    if (creatureId) await prisma.creature.deleteMany({ where: { id: creatureId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
