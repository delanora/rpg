/** Duelo consentido: somente fixtures em banco/schema descartável com sentinela HTTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { loadCombatById } from '../modules/combat/combat-load.js';
import { scanReactionThreats } from '../modules/combat/spatial/opportunity-openers.js';
import { onTurnStart } from '../modules/shared/action-economy.js';

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  assert.equal(process.env.PLAYABLE_BASE_URL, 'http://127.0.0.1:3131');
  assert.equal(await prisma.user.count(), 0);
  const userIds: string[] = [],
    creatureIds: string[] = [];
  let combatId: string | undefined, regionId: string | undefined;
  let socket: ReturnType<typeof io> | undefined;
  try {
    const tag = randomUUID();
    const user = async (role: 'MASTER' | 'PLAYER', n: number) => {
      const row = await prisma.user.create({
        data: {
          username: `duel_${n}_${tag}`,
          displayName: `Pessoa ${n}`,
          passwordHash: 'fixture',
          role,
        },
      });
      userIds.push(row.id);
      return row;
    };
    const master = await user('MASTER', 0),
      alice = await user('PLAYER', 1),
      bob = await user('PLAYER', 2),
      charlie = await user('PLAYER', 3);
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
      const response = await fetch(
        process.env.PLAYABLE_BASE_URL + '/api' + path,
        {
          method,
          headers: {
            Authorization: 'Bearer ' + token(actor),
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return {
        status: response.status,
        data: response.status === 204 ? null : ((await response.json()) as any),
      };
    };
    const attack = {
      id: 'poke',
      name: 'Ataque fixture',
      attackBonus: 0,
      reachFeet: 5,
      damage: { count: 0, sides: 0, bonus: 0, type: 'Concussão' },
      extraDamages: [],
    };
    const characters = [];
    for (const owner of [alice, bob, charlie])
      characters.push(
        await prisma.character.create({
          data: {
            userId: owner.id,
            name: owner.displayName,
            raceId: 'human',
            hpCurrent: 30,
            hpMax: 30,
            speed: 9,
            attacks: [attack],
            classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
          },
        }),
      );
    assert.equal(
      (await request('/characters/me', undefined, alice)).data.character.id,
      characters[0].id,
      'Sentinela HTTP/banco',
    );
    const region = await prisma.region.create({
      data: { name: 'Região duelo ' + tag },
    });
    regionId = region.id;
    const locality = await prisma.locality.create({
      data: { name: 'Local duelo', regionId },
    });
    const scene = await prisma.scene.create({
      data: {
        name: 'Cena duelo',
        localityId: locality.id,
        spatialConfig: {
          mode: 'grid-2d',
          widthFeet: 60,
          heightFeet: 40,
          cellSizeFeet: 5,
        },
      },
    });
    const npc = await prisma.creature.create({
      data: {
        name: 'NPC hostil fixture',
        kind: 'NPC',
        hpCurrent: 30,
        hpMax: 30,
        armorClass: 12,
        speed: 9,
        attacks: [attack],
        localities: { connect: { id: locality.id } },
      },
    });
    creatureIds.push(npc.id);
    const started = await request('/combat', {
      localityId: locality.id,
      sceneId: scene.id,
      characterIds: characters.map((c) => c.id),
      characterPositions: characters.map((c, i) => ({
        characterId: c.id,
        position: { xFeet: 5 + i * 5, yFeet: 5 },
      })),
      entries: [
        {
          creatureId: npc.id,
          quantity: 1,
          positions: [{ xFeet: 5, yFeet: 10 }],
        },
      ],
    });
    assert.equal(started.status, 201, JSON.stringify(started));
    let combat = started.data.combat;
    combatId = combat.id;
    const [a, b, c] = characters.map((character) =>
      combat.combatants.find((u: any) => u.characterId === character.id),
    );
    const n = combat.combatants.find((u: any) => u.creatureId === npc.id);
    for (const unit of combat.combatants)
      assert.equal(
        (await request('/combat/initiative/' + unit.id, {})).status,
        200,
      );
    const refresh = async () => {
      combat = (await request('/combat/active')).data.combat;
      return combat;
    };
    const op = (extra: Record<string, unknown> = {}) => ({
      combatId,
      expectedVersion: combat.version,
      operationId: randomUUID(),
      ...extra,
    });
    const list = async (actor = master) =>
      (await request(`/combat/${combatId}/duels`, undefined, actor)).data.duels;
    const setTurn = async () => {
      await refresh();
      await prisma.combatant.update({
        where: { id: a.id },
        data: {
          turnEconomy: onTurnStart(9),
          spatialPosition: { xFeet: 5, yFeet: 5 },
        },
      });
      await prisma.combat.update({
        where: { id: combatId },
        data: {
          currentIndex: combat.combatants.findIndex((u: any) => u.id === a.id),
          turnSequence: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await refresh();
    };
    const ask = async (from = a.id, to = b.id, actor = alice) => {
      const body = op({ requesterId: from, challengedId: to });
      const response = await request('/combat/duels/request', body, actor);
      assert.equal(response.status, 200, JSON.stringify(response));
      await refresh();
      const duel = (await list(actor)).find(
        (d: any) => d.requesterId === from && d.challengedId === to,
      );
      return { body, duel };
    };
    const decide = async (
      duelId: string,
      decision: string,
      actor = bob,
      extra = {},
    ) => {
      const response = await request(
        '/combat/duels/decision',
        op({ duelId, decision, ...extra }),
        actor,
      );
      if (response.status === 200) await refresh();
      return response;
    };
    await refresh();
    // Nem lados diferentes transformam dois jogadores em adversários sem consentimento.
    await prisma.combatant.update({
      where: { id: b.id },
      data: { sideKey: 'enemies' },
    });
    await prisma.combatant.update({
      where: { id: n.id },
      data: { sideKey: 'enemies' },
    });
    const threats = async (id: string) => {
      const state = await loadCombatById(combatId!);
      return scanReactionThreats(
        state,
        state.combatants.find((u) => u.id === id)!,
        onTurnStart(9),
      ).threats.map((t) => t.reactorCombatantId);
    };
    assert.ok(!(await threats(a.id)).includes(b.id));
    assert.ok((await threats(a.id)).includes(n.id));
    await setTurn();
    const manual = await request(
      '/combat/attack',
      op({
        attackId: 'poke',
        attackerCombatantId: a.id,
        targetCombatantId: b.id,
      }),
      alice,
    );
    assert.equal(
      manual.status,
      200,
      'Ataque manual continua permitido sem duelo',
    );
    await refresh();
    const before = combat.combatants.find(
      (u: any) => u.id === a.id,
    ).turnEconomy;
    assert.equal(
      (
        await request(
          '/combat/duels/request',
          op({ requesterId: a.id, challengedId: a.id }),
          alice,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/combat/duels/request',
          op({ requesterId: a.id, challengedId: n.id }),
          alice,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/combat/duels/request',
          op({ requesterId: b.id, challengedId: a.id }),
          alice,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/combat/duels/request',
          op({ requesterId: a.id, challengedId: b.id }),
        )
      ).status,
      403,
    );
    const publicEvents: any[] = [];
    socket = io(process.env.PLAYABLE_BASE_URL!, {
      auth: { token: token(charlie) },
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('combat:updated', (payload) => publicEvents.push(payload.combat));
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve);
      socket!.once('connect_error', reject);
    });
    const first = await ask();
    assert.equal((await list(alice)).length, 1);
    assert.equal((await list(bob)).length, 1);
    assert.equal((await list(charlie)).length, 0);
    assert.deepEqual(
      (await request('/combat/active', undefined, bob)).data.combat.duels,
      [],
    );
    assert.equal(
      (await request('/combat/duels/request', first.body, alice)).data.replayed,
      true,
    );
    assert.equal(await prisma.combatDuel.count({ where: { combatId } }), 1);
    assert.equal(
      (
        await request(
          '/combat/duels/request',
          op({ requesterId: b.id, challengedId: a.id }),
          bob,
        )
      ).status,
      409,
    );
    assert.ok(
      !(await threats(a.id)).includes(b.id),
      'Convite pendente não habilita oportunidade',
    );
    assert.equal((await decide(first.duel.id, 'accept', alice)).status, 403);
    assert.equal((await decide(first.duel.id, 'accept', master)).status, 403);
    assert.equal((await decide(first.duel.id, 'accept', charlie)).status, 403);
    const acceptance = op({ duelId: first.duel.id, decision: 'accept' });
    const accepted = await request('/combat/duels/decision', acceptance, bob);
    assert.equal(accepted.status, 200);
    await refresh();
    assert.equal(
      (await request('/combat/duels/decision', acceptance, bob)).data.replayed,
      true,
    );
    assert.equal(
      (
        await request(
          '/combat/duels/decision',
          { ...acceptance, decision: 'decline' },
          bob,
        )
      ).status,
      409,
    );
    assert.ok((await threats(a.id)).includes(b.id));
    assert.ok((await threats(b.id)).includes(a.id));
    assert.ok(!(await threats(c.id)).includes(b.id));
    assert.ok((await threats(a.id)).includes(n.id));
    assert.deepEqual(
      combat.combatants.find((u: any) => u.id === a.id).turnEconomy,
      before,
      'Consentir não gasta nem recupera economia',
    );
    assert.deepEqual(
      (await prisma.combatant.findUniqueOrThrow({ where: { id: a.id } }))
        .hostileToIds,
      [],
      'Duelo não contamina hostilidades persistidas',
    );
    assert.equal((await decide(first.duel.id, 'end', charlie)).status, 403);
    console.log(
      '✔ consentimento: donos corretos, privacidade, replay, lados diferentes e ameaça só entre os dois',
    );
    const pauseMovement = async () => {
      await prisma.combatant.update({
        where: { id: n.id },
        data: { spatialPosition: { xFeet: 30, yFeet: 30 } },
      });
      await setTurn();
      const moved = await request(
        `/combat/${combatId}/spatial/movement`,
        {
          combatantId: a.id,
          path: [
            { xFeet: 5, yFeet: 0 },
            { xFeet: 0, yFeet: 0 },
          ],
          expectedVersion: combat.version,
          operationId: randomUUID(),
        },
        alice,
      );
      assert.equal(moved.status, 200, JSON.stringify(moved));
      await refresh();
      const opportunity = await prisma.reactionOpportunity.findFirst({
        where: {
          combatId,
          reactorCombatantId: b.id,
          moverCombatantId: a.id,
          status: 'pending',
        },
      });
      assert.ok(opportunity, 'Saída do alcance abriu reação real do duelo');
      assert.equal(
        combat.combatants.find((u: any) => u.id === a.id).turnEconomy
          .movementUsed,
        1.5,
      );
      return opportunity;
    };
    const paused = await pauseMovement();
    assert.equal((await decide(first.duel.id, 'end', alice)).status, 200);
    assert.equal(
      (
        await prisma.reactionOpportunity.findUniqueOrThrow({
          where: { id: paused.id },
        })
      ).status,
      'cancelled',
    );
    assert.equal(
      (
        await prisma.movementIntent.findUniqueOrThrow({
          where: { id: paused.movementIntentId! },
        })
      ).status,
      'committed',
    );
    const afterEnd = combat.combatants.find((u: any) => u.id === a.id);
    assert.deepEqual(afterEnd.spatial.position, { xFeet: 0, yFeet: 0 });
    assert.equal(afterEnd.turnEconomy.movementUsed, 3);
    assert.equal(
      combat.combatants.find((u: any) => u.id === b.id).turnEconomy
        .reactionAvailable,
      true,
    );
    assert.ok(!(await threats(a.id)).includes(b.id));
    assert.ok(
      combat.economyLog.some(
        (entry: any) =>
          entry.action === 'duel-decision' &&
          entry.message.includes('encerrado'),
      ),
    );
    const reverse = await ask(b.id, a.id, bob);
    assert.equal((await decide(reverse.duel.id, 'cancel', alice)).status, 403);
    assert.equal((await decide(reverse.duel.id, 'cancel', bob)).status, 200);
    const declined = await ask();
    assert.equal((await decide(declined.duel.id, 'decline', bob)).status, 200);
    const another = await ask();
    assert.equal((await decide(another.duel.id, 'cancel', master)).status, 200);
    const raceDuel = await ask();
    const version = combat.version;
    const race = await Promise.all([
      request(
        '/combat/duels/decision',
        {
          combatId,
          expectedVersion: version,
          operationId: randomUUID(),
          duelId: raceDuel.duel.id,
          decision: 'accept',
        },
        bob,
      ),
      request(
        '/combat/duels/decision',
        {
          combatId,
          expectedVersion: version,
          operationId: randomUUID(),
          duelId: raceDuel.duel.id,
          decision: 'cancel',
        },
        alice,
      ),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    await refresh();
    if (combat.duels.some((d: any) => d.id === raceDuel.duel.id))
      assert.equal((await decide(raceDuel.duel.id, 'end', master)).status, 200);
    console.log(
      '✔ encerrar cancela a oportunidade e retoma o movimento sem gastar reação; recusa, cancelamento e corrida',
    );
    const deletion = await ask();
    assert.equal((await decide(deletion.duel.id, 'accept', bob)).status, 200);
    await pauseMovement();
    const removed = await request(
      '/characters/' + characters[1].id,
      undefined,
      master,
      'DELETE',
    );
    assert.equal(removed.status, 204, JSON.stringify(removed));
    await refresh();
    assert.equal(
      await prisma.combatDuel.count({ where: { id: deletion.duel.id } }),
      0,
      'Saída elimina o consentimento por FK',
    );
    assert.equal(
      await prisma.reactionOpportunity.count({
        where: { combatId, reactorCombatantId: b.id, status: 'pending' },
      }),
      0,
    );
    const pendingEnd = await ask(a.id, c.id, alice);
    assert.equal((await request('/combat/end', {})).status, 200);
    assert.equal(
      await prisma.combatDuel.count({
        where: { combatId, status: { in: ['pending', 'active'] } },
      }),
      0,
    );
    assert.equal(
      (await decide(pendingEnd.duel.id, 'accept', charlie)).status,
      409,
    );
    assert.ok(
      publicEvents.length > 0 &&
        publicEvents.every(
          (event) =>
            !(event.duels ?? []).some((d: any) => d.status === 'pending'),
        ),
      'WebSocket público nunca revela convites',
    );
    console.log(
      '✔ remoção do participante e fim do combate encerram consentimento; convites não vazam no realtime',
    );
  } finally {
    socket?.disconnect();
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
