/** Somente banco descartável, fixtures próprias e sentinela HTTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart, economyOf } from '../modules/shared/action-economy.js';
import { seedSpellRepertoire } from './spell-slot-fixtures.js';
async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  assert.equal(await prisma.user.count(), 0);
  const base = process.env.PLAYABLE_BASE_URL;
  assert.equal(base, 'http://127.0.0.1:3131');
  const users: string[] = [],
    combats: string[] = [],
    casts: string[] = [];
  let characterId = '',
    creatureId = '',
    regionId = '';
  try {
    const user = async (role: 'MASTER' | 'PLAYER') => {
      const row = await prisma.user.create({
        data: {
          username: 'los_' + randomUUID(),
          displayName: 'Fixture',
          role,
          passwordHash: 'fixture',
        },
      });
      users.push(row.id);
      return row;
    };
    const master = await user('MASTER'),
      owner = await user('PLAYER');
    const request = async (path: string, body?: unknown, actor = master) => {
      const response = await fetch(base + '/api' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Bearer ' +
            signToken({
              sub: actor.id,
              role: actor.role,
              username: actor.username,
              displayName: actor.displayName,
            }),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    const hero = await prisma.character.create({
      data: {
        userId: owner.id,
        name: 'Movente fixture',
        hpCurrent: 100,
        hpMax: 100,
        speed: 9,
        wisdom: 16,
        classes: [{ classKey: 'cleric', level: 5, subclass: '' }],
      },
    });
    characterId = hero.id;
    await seedSpellRepertoire({
      characterId,
      classKey: 'cleric',
      spellIds: ['sacred-flame'],
    });
    assert.equal(
      (await request('/characters/me', undefined, owner)).data.character.id,
      hero.id,
      'Sentinela HTTP/banco',
    );
    const npc = await prisma.creature.create({
      data: {
        name: 'Reator fixture',
        kind: 'NPC',
        hpCurrent: 100,
        hpMax: 100,
        armorClass: 12,
        speed: 9,
        attacks: [
          {
            id: 'lanca',
            name: 'Ataque fixture',
            kind: 'melee',
            actionCost: 'action',
            attackBonus: 2,
            reachFeet: 15,
            damage: { count: 1, sides: 4, bonus: 0, type: 'Perfurante' },
            extraDamages: [],
          },
        ],
      },
    });
    creatureId = npc.id;
    const region = await prisma.region.create({
      data: { name: 'Região fixture' },
    });
    regionId = region.id;
    const locality = await prisma.locality.create({
      data: { name: 'Local fixture', regionId },
    });
    let combatId = '',
      moverId = '',
      reactorId = '';
    const setup = async (
      walls: {
        x: number;
        y1: number;
        y2: number;
        sight?: boolean;
        targeting?: boolean;
        movement?: boolean;
      }[],
      start = { xFeet: 5, yFeet: 5 },
      reactor = { xFeet: 20, yFeet: 5 },
    ) => {
      if (combatId)
        await prisma.combat.update({
          where: { id: combatId },
          data: { status: 'ENDED' },
        });
      const scene = await prisma.scene.create({
        data: {
          name: 'Cena fixture',
          localityId: locality.id,
          spatialConfig: {
            mode: 'grid-2d',
            widthFeet: 100,
            heightFeet: 100,
            cellSizeFeet: 5,
          },
        },
      });
      for (const wall of walls)
        await prisma.spatialObstacle.create({
          data: {
            sceneId: scene.id,
            kind: 'wall',
            startXFeet: wall.x,
            endXFeet: wall.x,
            startYFeet: wall.y1,
            endYFeet: wall.y2,
            blocksSight: wall.sight ?? true,
            blocksTargeting: wall.targeting ?? false,
            blocksMovement: wall.movement ?? false,
          },
        });
      const combat = await prisma.combat.create({
        data: {
          status: 'ACTIVE',
          currentIndex: 0,
          turnSequence: 1,
          sceneId: scene.id,
          localityId: locality.id,
          combatants: {
            create: [
              {
                kind: 'CHARACTER',
                characterId,
                ownerUserId: owner.id,
                name: hero.name,
                initiative: 20,
                dexterityMod: 0,
                sideKey: 'players',
                spatialPosition: start,
                turnEconomy: onTurnStart(9),
              },
              {
                kind: 'NPC',
                creatureId,
                name: npc.name,
                initiative: 10,
                dexterityMod: 0,
                sideKey: 'monsters',
                hpCurrent: 100,
                hpMax: 100,
                armorClass: 12,
                spatialPosition: reactor,
                turnEconomy: onTurnStart(9),
              },
            ],
          },
        },
        include: { combatants: true },
      });
      combatId = combat.id;
      combats.push(combatId);
      moverId = combat.combatants.find((c) => c.characterId)!.id;
      reactorId = combat.combatants.find((c) => c.creatureId)!.id;
    };
    const move = async (path = [{ xFeet: 0, yFeet: 5 }]) => {
      const combat = await prisma.combat.findUniqueOrThrow({
        where: { id: combatId },
      });
      const result = await request(
        `/combat/${combatId}/spatial/movement`,
        {
          combatantId: moverId,
          path,
          expectedVersion: combat.version,
          operationId: randomUUID(),
        },
        owner,
      );
      assert.equal(result.status, 200, JSON.stringify(result));
      return result.data;
    };
    const read = async (actor = master) =>
      (
        await request(
          `/combat/${combatId}/reaction-opportunities`,
          undefined,
          actor,
        )
      ).data;
    await setup([{ x: 70, y1: 70, y2: 90 }]);
    await move();
    let model = await read();
    assert.equal(model.opportunities.length, 1);
    assert.equal(model.opportunities[0].visibilityStatus, 'known-visible');
    assert.equal(model.opportunities[0].responseKind, 'reaction');
    const refreshed = await read();
    assert.equal(
      refreshed.opportunities[0].visibilityStatus,
      'known-visible',
      'Reconexão não volta a perguntar por parede distante',
    );
    assert.equal(
      (await read(owner)).opportunities.length,
      0,
      'Jogador não recebe reação do NPC',
    );
    console.log(
      '✔ Parede distante não pede visão; a escolha de reagir segue diretamente ao Mestre do NPC',
    );
    await prisma.reactionOpportunity.update({
      where: { id: model.opportunities[0].id },
      data: { visibilityStatus: 'unknown' },
    });
    const legacy = await read();
    assert.equal(legacy.opportunities[0].responseKind, 'reaction');
    assert.equal(
      (
        await prisma.reactionOpportunity.findUniqueOrThrow({
          where: { id: model.opportunities[0].id },
        })
      ).visibilityStatus,
      'unknown',
      'GET só deriva: não escreve na janela',
    );
    const act = await request(
      `/combat/${combatId}/reaction-opportunities/${legacy.opportunities[0].id}/attack`,
      {
        combatId,
        expectedVersion: legacy.combatVersion,
        operationId: randomUUID(),
        attackId: legacy.opportunities[0].options[0].attackId,
      },
    );
    assert.equal(act.status, 200, JSON.stringify(act));
    assert.equal(
      economyOf(
        (await prisma.combatant.findUniqueOrThrow({ where: { id: reactorId } }))
          .turnEconomy,
      ).reactionAvailable,
      false,
    );
    console.log(
      '✔ Janela antiga desconhecida pode reagir diretamente quando a geometria atual prova visão livre',
    );

    await setup([{ x: 12.5, y1: 0, y2: 100 }]);
    await move();
    assert.equal((await read()).opportunities.length, 0);
    assert.equal(
      await prisma.movementIntent.count({
        where: { combatId, status: 'pending-reaction' },
      }),
      0,
    );
    assert.deepEqual(
      (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
        .spatialPosition,
      { xFeet: 0, yFeet: 5 },
    );
    assert.equal(
      economyOf(
        (await prisma.combatant.findUniqueOrThrow({ where: { id: reactorId } }))
          .turnEconomy,
      ).reactionAvailable,
      true,
    );
    console.log(
      '✔ Parede opaca completa impede a oportunidade sem pergunta nem consumo de Reação',
    );
    await setup([{ x: 12.5, y1: 0, y2: 100, sight: false, movement: true }]);
    await move();
    assert.equal(
      (await read()).opportunities[0].visibilityStatus,
      'known-visible',
    );
    await setup([{ x: 12.5, y1: 7, y2: 100 }]);
    await move();
    model = await read();
    assert.equal(model.opportunities[0].visibilityStatus, 'unknown');
    assert.equal(model.opportunities[0].responseKind, 'visibility');
    await prisma.combatant.update({
      where: { id: reactorId },
      data: {
        mechanicalState: {
          conditions: [
            {
              id: 'cego',
              condition: 'blinded',
              appliedAt: new Date().toISOString(),
            },
          ],
          exhaustionLevel: 0,
          log: [],
        },
      },
    });
    const denied = await request(
      `/combat/${combatId}/reaction-opportunities/${model.opportunities[0].id}/visibility`,
      {
        combatId,
        expectedVersion: model.combatVersion,
        operationId: randomUUID(),
        visible: true,
      },
    );
    assert.equal(denied.status, 409);
    assert.equal(denied.data.error, 'OPPORTUNITY_NOT_VISIBLE');
    await prisma.combatant.update({
      where: { id: reactorId },
      data: {
        mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] },
      },
    });
    const confirm = await request(
      `/combat/${combatId}/reaction-opportunities/${model.opportunities[0].id}/visibility`,
      {
        combatId,
        expectedVersion: model.combatVersion,
        operationId: randomUUID(),
        visible: true,
      },
    );
    assert.equal(confirm.status, 200, JSON.stringify(confirm));
    assert.equal((await read()).opportunities[0].responseKind, 'reaction');
    console.log(
      '✔ Flags independentes; só obstrução parcial mantém confirmação explícita do Mestre',
    );
    await setup(
      [{ x: 12.5, y1: 0, y2: 24 }],
      { xFeet: 5, yFeet: 15 },
      { xFeet: 20, yFeet: 20 },
    );
    await move([
      { xFeet: 5, yFeet: 20 },
      { xFeet: 5, yFeet: 25 },
      { xFeet: 5, yFeet: 30 },
      { xFeet: 0, yFeet: 30 },
    ]);
    model = await read();
    assert.equal(model.opportunities.length, 1);
    assert.equal(model.opportunities[0].visibilityStatus, 'known-visible');
    assert.deepEqual(
      (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
        .spatialPosition,
      { xFeet: 5, yFeet: 30 },
    );
    await prisma.combatant.update({where: {id: moverId}, data: {spatialPosition: {xFeet: 5, yFeet: 25}}});
    const changed = await read(); assert.equal(changed.opportunities[0].responseKind, 'visibility', 'Reposicionamento que torna a visão parcial exige nova decisão');
    const adjudicateChanged = await request(`/combat/${combatId}/reaction-opportunities/${changed.opportunities[0].id}/visibility`, {combatId, expectedVersion: changed.combatVersion, operationId: randomUUID(), visible: true});
    assert.equal(adjudicateChanged.status, 200, JSON.stringify(adjudicateChanged));
    await setup(
      [{ x: 12.5, y1: 0, y2: 24 }],
      { xFeet: 5, yFeet: 30 },
      { xFeet: 20, yFeet: 20 },
    );
    await move([
      { xFeet: 5, yFeet: 25 },
      { xFeet: 5, yFeet: 20 },
      { xFeet: 5, yFeet: 15 },
      { xFeet: 0, yFeet: 15 },
    ]);
    assert.equal((await read()).opportunities.length, 0);
    console.log(
      '✔ Visão é avaliada no boundary: sair de trás da parede permite reação; esconder-se antes da saída impede',
    );
    for (const blocked of [false, true]) {
      await setup(
        blocked ? [{ x: 12.5, y1: 0, y2: 100 }] : [{ x: 70, y1: 70, y2: 90 }],
      );
      const cast = await request(
        '/spells/cast',
        {
          operationId: randomUUID(),
          spellId: 'sacred-flame',
          caster: { kind: 'character', id: characterId },
          targets: [{ kind: 'combatant', id: reactorId }],
        },
        owner,
      );
      if (blocked) {
        assert.equal(cast.status, 409, JSON.stringify(cast));
        assert.equal(
          cast.data.error,
          'SPELL_TARGET_NOT_VISIBLE',
          JSON.stringify(cast),
        );
        assert.equal(await prisma.spellCast.count({ where: { combatId } }), 0);
        assert.equal(
          economyOf(
            (
              await prisma.combatant.findUniqueOrThrow({
                where: { id: moverId },
              })
            ).turnEconomy,
          ).actionsUsed,
          0,
        );
      } else {
        assert.ok([200, 201].includes(cast.status), JSON.stringify(cast));
        assert.ok(
          cast.data.cast?.id && !cast.data.intent,
          JSON.stringify(cast),
        );
        casts.push(cast.data.cast.id);
      }
    }
    console.log(
      '✔ Magia com visão usa a mesma geometria: livre conjura sem intenção; opaco recusa sem gastar Ação',
    );
  } finally {
    await prisma.spellCast.deleteMany({ where: { id: { in: casts } } });
    await prisma.combat.deleteMany({ where: { id: { in: combats } } });
    if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });
    if (creatureId)
      await prisma.creature.deleteMany({ where: { id: creatureId } });
    if (characterId)
      await prisma.character.deleteMany({ where: { id: characterId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
