/** Somente banco/schema descartável, fixtures próprias e sentinela HTTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { loadCombatById } from '../modules/combat/combat-load.js';
import { scanReactionThreats } from '../modules/combat/spatial/opportunity-openers.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { evaluateMovementPath } from '../modules/combat/spatial/spatial-movement.js';
import { walkingMovementTerrain } from '../modules/combat/spatial/movement-terrain.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import { resolveAttackDamageSpell } from '../modules/spells/execution/attack-damage-resolution.js';
import type { SpellExecutionDefinition } from '../modules/spells/execution/spell-execution-definition.js';

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  assert.equal(await prisma.user.count(), 0);
  const base = process.env.PLAYABLE_BASE_URL!;
  assert.equal(base, 'http://127.0.0.1:3131');
  const userIds: string[] = [],
    creatureIds: string[] = [],
    castIds: string[] = [];
  let regionId: string | undefined, combatId: string | undefined;
  const sockets: ReturnType<typeof io>[] = [];
  try {
    const tag = randomUUID();
    const makeUser = async (role: 'MASTER' | 'PLAYER', n: number) => {
      const user = await prisma.user.create({
        data: {
          username: `host_${n}_${tag}`,
          displayName: 'Fixture ' + n,
          passwordHash: 'fixture',
          role,
        },
      });
      userIds.push(user.id);
      return user;
    };
    const master = await makeUser('MASTER', 0),
      alice = await makeUser('PLAYER', 1),
      bob = await makeUser('PLAYER', 2);
    const token = (actor: typeof master) =>
      signToken({
        sub: actor.id,
        username: actor.username,
        displayName: actor.displayName,
        role: actor.role,
      });
    const request = async (
      path: string,
      body?: unknown,
      actor = master,
      method = body ? 'POST' : 'GET',
    ) => {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token(actor),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    const attack = {
      id: 'poke',
      name: 'Ataque fixture',
      attackBonus: 0,
      reachFeet: 5,
      damage: { count: 0, sides: 0, bonus: 0, type: 'Concussão' },
      extraDamages: [],
    };
    const character = async (user: typeof alice) =>
      prisma.character.create({
        data: {
          userId: user.id,
          name: user.displayName,
          raceId: 'human',
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          attacks: [attack],
          classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
        },
      });
    const a = await character(alice),
      b = await character(bob);
    assert.equal(
      (await request('/characters/me', undefined, alice)).data.character.id,
      a.id,
      'Sentinela HTTP/banco',
    );
    const region = await prisma.region.create({
      data: { name: 'Região fixture ' + tag },
    });
    regionId = region.id;
    const locality = await prisma.locality.create({
      data: { name: 'Local fixture', regionId },
    });
    const scene = await prisma.scene.create({
      data: {
        name: 'Cena fixture',
        localityId: locality.id,
        spatialConfig: {
          mode: 'grid-2d',
          widthFeet: 60,
          heightFeet: 40,
          cellSizeFeet: 5,
        },
      },
    });
    const npcs: { id: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const npc = await prisma.creature.create({
        data: {
          name: 'NPC fixture ' + i,
          kind: 'NPC',
          hpCurrent: 30,
          hpMax: 30,
          armorClass: 15,
          speed: 9,
          attacks: [attack],
          localities: { connect: { id: locality.id } },
        },
      });
      npcs.push(npc);
      creatureIds.push(npc.id);
    }
    let combat = (
      await request('/combat', {
        localityId: locality.id,
        sceneId: scene.id,
        characterIds: [a.id, b.id],
        characterPositions: [
          { characterId: a.id, position: { xFeet: 0, yFeet: 0 } },
          { characterId: b.id, position: { xFeet: 0, yFeet: 5 } },
        ],
        entries: npcs.map((npc, i) => ({
          creatureId: npc.id,
          quantity: 1,
          positions: [{ xFeet: 5 + i * 5, yFeet: 0 }],
          spatialVisibilities: [i ? 'master-only' : 'public'],
        })),
      })
    ).data.combat;
    assert.ok(combat?.id);
    combatId = combat.id;
    const ua = combat.combatants.find((unit: any) => unit.characterId === a.id),
      ub = combat.combatants.find((unit: any) => unit.characterId === b.id);
    const n = combat.combatants.find(
        (unit: any) => unit.creatureId === npcs[0].id,
      ),
      hidden = combat.combatants.find(
        (unit: any) => unit.creatureId === npcs[1].id,
      );
    for (const unit of combat.combatants)
      assert.equal(
        (await request('/combat/initiative/' + unit.id, {})).status,
        200,
      );
    const refresh = async () => {
      combat = (await request('/combat/active')).data.combat;
      return combat;
    };
    const setTurn = async (id: string) => {
      const ordered = (await refresh()).combatants;
      await prisma.combatant.update({
        where: { id },
        data: { turnEconomy: onTurnStart(9) },
      });
      await prisma.combat.update({
        where: { id: combatId },
        data: {
          currentIndex: ordered.findIndex((u: any) => u.id === id),
          turnSequence: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await refresh();
    };
    const operation = (extra: Record<string, unknown> = {}) => ({
      combatId,
      expectedVersion: combat.version,
      operationId: randomUUID(),
      ...extra,
    });
    const strike = async (from: string, target: string, actor = master) => {
      const body = operation({
        attackId: 'poke',
        attackerCombatantId: from,
        targetCombatantId: target,
      });
      const result = await request('/combat/attack', body, actor);
      assert.equal(result.status, 200, JSON.stringify(result));
      combat = result.data.combat;
      // Resposta do jogador é deliberadamente filtrada; o Mestre relê a fila.
      await refresh();
      return { body, result };
    };
    const decide = async (
      hostile: boolean,
      ids: string[],
      actor = master,
      overrides = {},
    ) =>
      request(
        '/combat/hostility/decision',
        operation({
          promptId: combat.hostilityPrompts[0]?.id,
          hostile,
          selectedIds: ids,
          ...overrides,
        }),
        actor,
      );
    const resetRelation = async () => {
      const result = await request(
        `/combat/${combatId}/combatants/${n.id}/side`,
        {
          expectedVersion: combat.version,
          operationId: randomUUID(),
          sideKey: 'neutral',
        },
        master,
        'PATCH',
      );
      assert.equal(result.status, 200, JSON.stringify(result));
      combat = result.data.combat;
    };
    const playerEvents: any[] = [],
      masterEvents: any[] = [];
    for (const [actor, output] of [
      [alice, playerEvents],
      [master, masterEvents],
    ] as const) {
      const socket = io(base, {
        auth: { token: token(actor) },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      socket.on('combat:updated', (payload) =>
        output.push(payload.combat ?? payload),
      );
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
    }
    await setTurn(ua.id);
    assert.equal(
      (
        await request(
          '/combat/attack',
          operation({
            attackId: 'poke',
            attackerCombatantId: ua.id,
            targetCombatantId: 'absent',
          }),
          alice,
        )
      ).status,
      404,
    );
    assert.equal(
      await prisma.combatHostilityPrompt.count({ where: { combatId } }),
      0,
    );
    const first = await strike(ua.id, n.id, alice);
    assert.equal(combat.hostilityPrompts.length, 1);
    sockets[1].disconnect();
    await new Promise<void>((resolve, reject) => {
      sockets[1].once('connect', resolve);
      sockets[1].once('connect_error', reject);
      sockets[1].connect();
    });
    await refresh();
    assert.equal(
      combat.hostilityPrompts.length,
      1,
      'Reconexão preserva a decisão',
    );
    assert.deepEqual(
      (await request('/combat/active', undefined, alice)).data.combat
        .hostilityPrompts,
      [],
    );
    const beforeReplay = await prisma.combatHostilityPrompt.count({
      where: { combatId },
    });
    assert.equal(
      (await request('/combat/attack', first.body, alice)).status,
      200,
    );
    assert.equal(
      await prisma.combatHostilityPrompt.count({ where: { combatId } }),
      beforeReplay,
    );
    await setTurn(ua.id);
    await strike(ua.id, n.id, alice);
    assert.equal(
      combat.hostilityPrompts.length,
      1,
      'Ataques repetidos não duplicam pergunta pendente',
    );
    assert.equal((await decide(true, [ua.id], alice)).status, 403);
    assert.equal((await decide(true, [])).status, 400);
    assert.equal((await decide(true, [n.id])).status, 400);
    assert.equal((await decide(true, ['outside'])).status, 400);
    assert.equal(
      (
        await decide(true, [ua.id], master, {
          expectedVersion: combat.version - 1,
        })
      ).status,
      409,
    );
    const keep = await decide(false, []);
    assert.equal(keep.status, 200);
    combat = keep.data.combat;
    assert.equal(combat.hostilityPrompts.length, 0);
    assert.deepEqual(
      combat.combatants.find((u: any) => u.id === n.id).hostileToIds,
      [],
    );
    await setTurn(ua.id);
    await strike(ua.id, n.id, alice);
    const acceptBody = operation({
      promptId: combat.hostilityPrompts[0].id,
      hostile: true,
      selectedIds: [ua.id],
    });
    const accepted = await request('/combat/hostility/decision', acceptBody);
    assert.equal(accepted.status, 200);
    combat = accepted.data.combat;
    assert.equal(
      (await request('/combat/hostility/decision', acceptBody)).data.replayed,
      true,
    );
    assert.equal(
      (
        await request('/combat/hostility/decision', {
          ...acceptBody,
          selectedIds: [ub.id],
        })
      ).status,
      409,
    );
    assert.deepEqual(
      combat.combatants.find((u: any) => u.id === n.id).hostileToIds,
      [ua.id],
    );
    assert.equal(
      combat.combatants.find((u: any) => u.id === n.id).sideKey,
      'neutral',
    );
    assert.deepEqual(
      combat.combatants.find((u: any) => u.id === ub.id).hostileToIds,
      [],
    );
    const loaded = await loadCombatById(combatId!);
    const scan = (id: string) =>
      scanReactionThreats(
        loaded,
        loaded.combatants.find((u) => u.id === id)!,
        onTurnStart(9),
      ).threats.map((t) => t.reactorCombatantId);
    assert.ok(scan(ua.id).includes(n.id));
    assert.ok(!scan(ub.id).includes(n.id));
    assert.ok(scan(n.id).includes(ua.id));
    assert.ok(!scan(n.id).includes(ub.id));
    const movement = (hostile: boolean) =>
      evaluateMovementPath({
        scene: {
          mode: 'grid-2d',
          widthFeet: 60,
          heightFeet: 40,
          cellSizeFeet: 5,
        } as any,
        mover: {
          combatantId: ua.id,
          name: 'A',
          position: { xFeet: 0, yFeet: 0 },
          size: 'medium',
          sideKey: 'players',
          hostileToIds: hostile ? [n.id] : [],
        },
        others: [
          {
            combatantId: n.id,
            name: 'NPC',
            position: { xFeet: 5, yFeet: 0 },
            size: 'medium',
            sideKey: 'neutral',
          },
        ],
        path: [
          { xFeet: 5, yFeet: 0 },
          { xFeet: 10, yFeet: 0 },
        ],
        prone: false,
        movementRemainingFeet: 30,
        terrain: walkingMovementTerrain,
        revealBlockers: true,
      });
    assert.equal(movement(true).legal, false);
    assert.equal(movement(false).legal, true);
    console.log(
      '✔ arma: fila privada, recusa inválida, replay, decisão, seleção específica e ameaça mútua',
    );
    await resetRelation();
    assert.deepEqual(
      combat.combatants.find((u: any) => u.id === ua.id).hostileToIds,
      [],
    );
    await setTurn(n.id);
    await strike(n.id, ua.id);
    assert.equal(
      combat.hostilityPrompts[0].attackerId,
      n.id,
      'NPC atacando jogador também pergunta',
    );
    const all = await decide(true, [ua.id, ub.id]);
    assert.equal(all.status, 200);
    combat = all.data.combat;
    assert.equal(
      combat.combatants.find((u: any) => u.id === n.id).hostileToIds.length,
      2,
    );
    await resetRelation();
    await setTurn(n.id);
    await strike(n.id, hidden.id);
    assert.equal(combat.hostilityPrompts.length, 1, 'Dois NPCs neutros geram somente uma pergunta sobre o par');
    const hiddenPrompt = combat.hostilityPrompts.find(
      (p: any) => p.npcId === n.id,
    );
    const hiddenAccept = await decide(true, [hidden.id], master, {
      promptId: hiddenPrompt.id,
    });
    assert.equal(hiddenAccept.status, 200);
    combat = hiddenAccept.data.combat;
    const publicCombat = (await request('/combat/active', undefined, alice))
      .data.combat;
    assert.ok(
      !JSON.stringify(publicCombat).includes(hidden.id),
      'Nenhum ID oculto vaza em relações ou perguntas',
    );
    await resetRelation();
    // Magia sintética interna: natural 1 determinístico comprova o gatilho mesmo no erro.
    const casterEntity = { kind: 'character' as const, id: a.id },
      targetEntity = { kind: 'combatant' as const, id: n.id };
    const cast = await prisma.spellCast.create({
      data: {
        spellId: 'fixture-hostility',
        casterEntityKind: 'character',
        casterEntityId: a.id,
        casterLabel: a.name,
        targets: [targetEntity],
        status: 'resolving',
        requiresConcentration: false,
        spellcastingMode: 'derived',
        spellAttackBonus: 5,
        spellSaveDc: 12,
        spellLevel: 0,
        castAtLevel: 0,
        operationId: randomUUID(),
        fingerprint: randomUUID(),
        committedAt: new Date(),
        combatId,
      },
    });
    castIds.push(cast.id);
    const definition: SpellExecutionDefinition = {
      spellId: 'fixture-hostility',
      requiresConcentration: false,
      targeting: {
        kind: 'creatures',
        minTargets: 1,
        targetCount: { base: 1, baseSlotLevel: 0, additionalPerSlotLevel: 0 },
        range: { kind: 'distance', feet: 60 },
        allowSelf: false,
        requiresSight: false,
        requiresClearPath: true,
        filters: [],
        groupConstraints: [],
      },
      resolution: {
        kind: 'attack-damage',
        attack: { kind: 'ranged' },
        damage: {
          components: [
            { type: 'Força', dice: { count: 1, sides: 4 }, bonus: 0 },
          ],
        },
      },
    };
    const spellResult = await prisma.$transaction(async (db) =>
      resolveAttackDamageSpell(
        db,
        cast,
        {
          caster: await loadEntity(casterEntity, db),
          assignments: [await loadEntity(targetEntity, db)],
        },
        definition,
        { roll: () => 1 },
      ),
    );
    assert.ok(!spellResult.snapshot.attacks[0].attack.hit);
    await refresh();
    assert.equal(combat.hostilityPrompts.length, 1);
    const pendingId = combat.hostilityPrompts[0].id;
    const raceBase = operation({ promptId: pendingId });
    const race = await Promise.all([
      request('/combat/hostility/decision', {
        ...raceBase,
        hostile: true,
        selectedIds: [ua.id],
      }),
      request('/combat/hostility/decision', {
        ...raceBase,
        operationId: randomUUID(),
        hostile: false,
        selectedIds: [],
      }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    await refresh();
    assert.equal(combat.hostilityPrompts.length, 0);
    const wonHostile = race[0].status === 200;
    assert.deepEqual(
      combat.combatants.find((u: any) => u.id === n.id).hostileToIds,
      wonHostile ? [ua.id] : [],
    );
    await resetRelation();
    await setTurn(ua.id);
    await strike(ua.id, n.id, alice);
    assert.equal(combat.hostilityPrompts.length, 1);
    const removed = await request(
      '/combat/participants/remove',
      operation({ combatantId: n.id }),
    );
    assert.equal(removed.status, 200, JSON.stringify(removed));
    combat = removed.data.combat;
    assert.equal(combat.hostilityPrompts.length, 0);
    // Excluir o cadastro também invalida perguntas, sem deixar escolha sobre entidade ausente.
    await prisma.combatant.update({
      where: { id: ua.id },
      data: { spatialPosition: { xFeet: 5, yFeet: 5 } },
    });
    await setTurn(ua.id);
    await strike(ua.id, hidden.id, alice);
    const absentPrompt = combat.hostilityPrompts[0].id;
    await prisma.creature.delete({ where: { id: npcs[1].id } });
    await refresh();
    assert.equal(combat.hostilityPrompts.length, 0);
    assert.equal(
      (
        await request(
          '/combat/hostility/decision',
          operation({
            promptId: absentPrompt,
            hostile: true,
            selectedIds: [ua.id],
          }),
        )
      ).status,
      409,
    );
    assert.equal((await request('/combat/end', {})).status, 200);
    assert.equal(await prisma.combatHostilityPrompt.count({ where: { combatId, status: 'pending' } }), 0);
    assert.equal((await request('/combat/hostility/decision', operation({ promptId: absentPrompt, hostile: false, selectedIds: [] }))).status, 409);
    // O evento chega antes de a resposta HTTP concluir, sem temporizador arbitrário.
    assert.ok(masterEvents.some((event) => event.hostilityPrompts?.length));
    assert.ok(playerEvents.every((event) => !event.hostilityPrompts?.length));
    console.log(
      '✔ NPC atacante, grupo selecionado, ocultação, magia que erra, corrida e remoção',
    );
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });
    await prisma.character.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
