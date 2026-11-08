/** Encontros e participantes: executar somente em banco/schema descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { turnKey } from '../modules/shared/death.js';
async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  assert.ok(process.env.PLAYABLE_BASE_URL?.endsWith(':3131'));
  assert.equal(
    await prisma.user.count(),
    0,
    'Schema deve estar vazio de usuários',
  );
  const effects: string[] = [];
  const users: string[] = [],
    characters: string[] = [],
    creatures: string[] = [],
    encounters: string[] = [];
  let combatId: string | undefined, regionId: string | undefined;
  try {
    const suffix = randomUUID();
    const user = async (role: 'MASTER' | 'PLAYER') => {
      const u = await prisma.user.create({
        data: {
          username: role + randomUUID(),
          displayName: role,
          passwordHash: 'fixture',
          role,
        },
      });
      users.push(u.id);
      return u;
    };
    const master = await user('MASTER'),
      owner = await user('PLAYER'),
      outsider = await user('PLAYER');
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
            Authorization:
              'Bearer ' +
              signToken({
                sub: actor.id,
                username: actor.username,
                displayName: actor.displayName,
                role: actor.role,
              }),
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return { status: response.status, data: (await response.json()) as any };
    };
    for (const actor of [owner, outsider]) {
      const c = await prisma.character.create({
        data: {
          userId: actor.id,
          name: 'Jogador fixture',
          raceId: 'human',
          hpMax: 20,
          hpCurrent: 20,
          speed: 9,
          classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
        },
      });
      characters.push(c.id);
    }
    assert.equal(
      (await request('/characters/me', undefined, owner)).data.character.id,
      characters[0],
      'Sentinela HTTP deve usar o mesmo banco',
    );
    const region = await prisma.region.create({
      data: { name: 'Região ' + suffix },
    });
    regionId = region.id;
    const locality = await prisma.locality.create({
      data: { name: 'Local fixture', regionId: region.id },
    });
    const scene = await prisma.scene.create({
      data: {
        name: 'Cena fixture',
        localityId: locality.id,
        spatialConfig: {
          mode: 'grid-2d',
          widthFeet: 60,
          heightFeet: 60,
          cellSizeFeet: 5,
        },
      },
    });
    for (const kind of ['CREATURE', 'NPC'] as const) {
      const c = await prisma.creature.create({
        data: {
          name: kind + ' fixture',
          kind,
          size: kind === 'CREATURE' ? 'Huge' : 'Medium',
          dexterity: 20,
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          armorClass: 12,
        },
      });
      creatures.push(c.id);
    }
    const prep = {
      localityId: locality.id,
      sceneId: scene.id,
      characterIds: [characters[0]],
      characterPositions: [
        { characterId: characters[0], position: { xFeet: 0, yFeet: 0 } },
      ],
      entries: [
        {
          creatureId: creatures[0],
          quantity: 1,
          positions: [{ xFeet: 20, yFeet: 20 }],
          disposition: 'hostile',
        },
      ],
    };
    const encounterId = randomUUID();
    encounters.push(encounterId);
    const save = {
      name: 'Encontro fixture',
      preparation: prep,
      expectedVersion: 0,
      operationId: randomUUID(),
    };
    assert.equal(
      (await request(`/encounters/${encounterId}`, save, owner, 'PUT')).status,
      403,
    );
    const stored = await request(
      `/encounters/${encounterId}`,
      save,
      master,
      'PUT',
    );
    assert.equal(stored.status, 200, JSON.stringify(stored));
    assert.equal(
      (await request(`/encounters/${encounterId}`, save, master, 'PUT')).data
        .encounter.id,
      encounterId,
    );
    assert.equal(
      (
        await request(
          `/encounters/${encounterId}`,
          { ...save, name: 'Outro' },
          master,
          'PUT',
        )
      ).status,
      409,
    );
    assert.equal((await request('/encounters', undefined, owner)).status, 403);
    assert.equal(
      (
        await request(
          `/encounters/${encounterId}`,
          { ...save, operationId: randomUUID(), name: 'Revisado' },
          master,
          'PUT',
        )
      ).data.encounter.version,
      1,
    );
    assert.equal(
      (
        await request(
          `/encounters/${encounterId}`,
          { ...save, operationId: randomUUID() },
          master,
          'PUT',
        )
      ).status,
      409,
    );
    console.log(
      '✔ Biblioteca privada: gravação, replay, concorrência e autoria',
    );
    const overlap = await request('/combat', {
      ...prep,
      entries: [{ ...prep.entries[0], positions: [{ xFeet: 0, yFeet: 0 }] }],
    });
    assert.equal(overlap.status, 409);
    assert.equal(
      await prisma.combat.count(),
      0,
      'Início inválido não deixa combate parcial',
    );
    const started = await request('/combat', prep);
    assert.equal(started.status, 201, JSON.stringify(started));
    let combat = started.data.combat;
    combatId = combat.id;
    assert.deepEqual(
      combat.combatants
        .filter((c: any) => c.kind === 'CHARACTER')
        .map((c: any) => c.characterId),
      [characters[0]],
    );
    const hero = combat.combatants.find(
      (c: any) => c.characterId === characters[0],
    );
    const original = combat.combatants.find(
      (c: any) => c.creatureId === creatures[0],
    );
    assert.equal(original.spatial.position.xFeet, 20);
    assert.equal(original.spatial.occupiedSpace.widthFeet, 15);
    const op = () => ({
      combatId: combat.id,
      expectedVersion: combat.version,
      operationId: randomUUID(),
    });
    const add = {
      ...op(),
      entries: [
        {
          creatureId: creatures[1],
          quantity: 1,
          positions: [{ xFeet: 5, yFeet: 0 }],
          disposition: 'neutral',
        },
      ],
    };
    assert.equal(
      (await request('/combat/participants/add', add, owner)).status,
      403,
    );
    const race = await Promise.all([
      request('/combat/participants/add', add),
      request('/combat/participants/add', add),
    ]);
    assert.ok(
      race.every((r) => r.status === 200),
      JSON.stringify(race),
    );
    combat = race[0].data.combat;
    assert.equal(combat.combatants.length, 3);
    assert.equal(
      (
        await request('/combat/participants/add', {
          ...op(),
          entries: add.entries,
        })
      ).status,
      409,
      'NPC único',
    );
    assert.equal(
      (
        await request('/combat/participants/add', {
          ...op(),
          entries: [
            {
              creatureId: creatures[0],
              quantity: 1,
              positions: [{ xFeet: 55, yFeet: 55 }],
            },
          ],
        })
      ).status,
      409,
      'Footprint enorme deve caber inteiro',
    );
    for (const unit of combat.combatants) {
      const result = await request('/combat/initiative/' + unit.id, {});
      assert.equal(result.status, 200);
      combat = result.data.combat;
    }
    assert.equal(combat.status, 'ACTIVE');
    // Turno determinístico da própria fixture: adicionar antes do atual não concede outro teste.
    await prisma.combatant.updateMany({
      where: { combatId },
      data: { initiative: 100 },
    });
    await prisma.combatant.update({
      where: { id: hero.id },
      data: { initiative: -100, turnEconomy: onTurnStart(9) },
    });
    await prisma.combat.update({
      where: { id: combatId },
      data: { currentIndex: 2 },
    });
    await prisma.character.update({
      where: { id: characters[0] },
      data: {
        hpCurrent: 0,
        deathState: {
          deathSaves: true,
          successes: 1,
          failures: 0,
          saveTurnKey: turnKey(combat.id, combat.round, 2),
        },
      },
    });
    combat = (await request('/combat/active')).data.combat;
    const sequence = (
      await prisma.combat.findUniqueOrThrow({ where: { id: combatId } })
    ).turnSequence;
    const reinforced = await request('/combat/participants/add', {
      ...op(),
      entries: [
        {
          creatureId: creatures[0],
          quantity: 1,
          positions: [{ xFeet: 40, yFeet: 40 }],
        },
      ],
    });
    assert.equal(reinforced.status, 200, JSON.stringify(reinforced));
    combat = reinforced.data.combat;
    assert.equal(combat.currentCombatantId, hero.id);
    assert.equal(
      (await prisma.combat.findUniqueOrThrow({ where: { id: combatId } }))
        .turnSequence,
      sequence,
    );
    const death = (
      await prisma.character.findUniqueOrThrow({ where: { id: characters[0] } })
    ).deathState as any;
    assert.equal(
      death.saveTurnKey,
      turnKey(combat.id, combat.round, combat.currentIndex),
    );
    assert.equal(
      (
        await request('/dice/roll', {
          kind: 'death-save',
          entity: { kind: 'character', id: characters[0] },
          dice: [{ sides: 20 }],
        })
      ).status,
      409,
    );
    console.log(
      '✔ Início seleciona jogadores/posições; reforços têm footprint e preservam turno e teste de morte',
    );
    await prisma.character.update({where:{id:characters[0]},data:{hpCurrent:0,deathState:{deathSaves:true,successes:0,failures:0}}});
    const simultaneous = await Promise.all([
      request('/combat/participants/add',{...op(),entries:[{creatureId:creatures[0],quantity:1}]}),
      request('/dice/roll',{kind:'death-save',entity:{kind:'character',id:characters[0]},dice:[{sides:20}]}),
    ]);
    assert.equal(simultaneous[0].status,200,JSON.stringify(simultaneous));
    assert.equal(simultaneous[1].status,201,JSON.stringify(simultaneous));
    combat=(await request('/combat/active')).data.combat;
    assert.equal((await request('/dice/roll',{kind:'death-save',entity:{kind:'character',id:characters[0]},dice:[{sides:20}]})).status,409,'Reindexação concorrente não permite segundo teste');
    const npc = combat.combatants.find((c: any) => c.kind === 'NPC');
    const sourceEffect = await prisma.effectInstance.create({
      data: {
        label: 'Fonte fixture',
        sourceEntityKind: 'combatant',
        sourceEntityId: original.id,
        targetEntityKind: 'character',
        targetEntityId: characters[0],
      },
    });
    effects.push(sourceEffect.id);
    const targetEffect = await prisma.effectInstance.create({
      data: {
        label: 'Alvo fixture',
        targetEntityKind: 'combatant',
        targetEntityId: original.id,
      },
    });
    effects.push(targetEffect.id);
    const otherCopy = combat.combatants.find(
      (c: any) => c.kind === 'CREATURE' && c.id !== original.id,
    );
    const preservedEffect = await prisma.effectInstance.create({
      data: {
        label: 'Outra cópia fixture',
        targetEntityKind: 'combatant',
        targetEntityId: otherCopy.id,
      },
    });
    effects.push(preservedEffect.id);
    const remove = { ...op(), combatantId: original.id };
    assert.equal(
      (await request('/combat/participants/remove', remove, owner)).status,
      403,
    );
    const removed = await request('/combat/participants/remove', remove);
    assert.equal(removed.status, 200, JSON.stringify(removed));
    combat = removed.data.combat;
    assert.equal(
      (
        await prisma.effectInstance.findUniqueOrThrow({
          where: { id: sourceEffect.id },
        })
      ).status,
      'ended',
    );
    assert.equal(
      (
        await prisma.effectInstance.findUniqueOrThrow({
          where: { id: targetEffect.id },
        })
      ).status,
      'ended',
    );
    assert.equal(
      (
        await prisma.effectInstance.findUniqueOrThrow({
          where: { id: preservedEffect.id },
        })
      ).status,
      'active',
    );
    assert.equal(combat.currentCombatantId, hero.id);
    assert.ok(
      await prisma.creature.findUnique({ where: { id: creatures[0] } }),
    );
    assert.equal(
      (await request('/combat/participants/remove', remove)).status,
      200,
      'Retry não remove outra instância',
    );
    assert.equal(
      (
        await request('/combat/participants/remove', {
          ...op(),
          combatantId: hero.id,
        })
      ).status,
      400,
      'Não apaga ficha de jogador',
    );
    // Remoção do turno corrente abre exatamente o próximo, cancelando janelas antigas.
    await prisma.character.update({
      where: { id: characters[0] },
      data: { hpCurrent: 20, deathState: {} },
    });
    combat = (await request('/combat/active')).data.combat;
    const npcIndex = combat.combatants.findIndex((c: any) => c.id === npc.id);
    await prisma.combat.update({
      where: { id: combatId },
      data: { currentIndex: npcIndex },
    });
    const beforeSequence = (
      await prisma.combat.findUniqueOrThrow({ where: { id: combatId } })
    ).turnSequence;
    const intent = await prisma.movementIntent.create({
      data: {
        combatId: combatId!,
        combatantId: hero.id,
        operationId: randomUUID(),
        fingerprint: 'fixture',
      },
    });
    await prisma.reactionOpportunity.create({
      data: {
        combatId: combatId!,
        movementIntentId: intent.id,
        moverCombatantId: hero.id,
        reactorCombatantId: npc.id,
        reachFeet: 5,
      },
    });
    const removing = await request('/combat/participants/remove', {
      ...op(),
      combatantId: npc.id,
    });
    assert.equal(removing.status, 200, JSON.stringify(removing));
    combat = removing.data.combat;
    assert.notEqual(combat.currentCombatantId, npc.id);
    assert.equal(
      (await prisma.combat.findUniqueOrThrow({ where: { id: combatId } }))
        .turnSequence,
      beforeSequence + 1,
    );
    assert.equal(
      (
        await prisma.movementIntent.findUniqueOrThrow({
          where: { id: intent.id },
        })
      ).status,
      'cancelled',
    );
    assert.equal(
      await prisma.reactionOpportunity.count({
        where: { combatId, status: 'pending' },
      }),
      0,
    );
    assert.ok(
      await prisma.creature.findUnique({ where: { id: creatures[1] } }),
    );
    assert.equal(
      (
        await request(
          `/encounters/${encounterId}`,
          { expectedVersion: 1, operationId: randomUUID() },
          master,
          'DELETE',
        )
      ).status,
      200,
    );
    assert.equal((await request('/encounters')).data.encounters.length, 0);
    console.log(
      '✔ Remoção preserva cadastros, cancela reações e avança só quando retira o turno corrente',
    );
  } finally {
    await prisma.effectInstance.deleteMany({ where: { id: { in: effects } } });
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    await prisma.preparedEncounter.deleteMany({
      where: { id: { in: encounters } },
    });
    await prisma.creature.deleteMany({ where: { id: { in: creatures } } });
    if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });
    await prisma.character.deleteMany({ where: { id: { in: characters } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
