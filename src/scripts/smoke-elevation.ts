import { smokeSceneTerrain } from './smoke-scene-terrain.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { signToken } from '../lib/jwt.js';

/** Banco/schema explicitamente descartável; cada fixture possui IDs próprios. */
export async function smokeElevation(base: string) {
  const schema =
    new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '';
  assert.match(schema, /^smoke_[a-z0-9_]+$/);
  assert.equal(
    await prisma.user.count(),
    0,
    'Schema precisa estar vazio antes das fixtures.',
  );
  const users: string[] = [];
  const creatures: string[] = [];
  let combatId: string | undefined;
  let regionId: string | undefined;
  let checks = 0;
  const check = (label: string, ok: unknown) => {
    assert.ok(ok, label);
    checks++;
    console.log(`✔ ${label}`);
  };
  try {
    const suffix = randomUUID().slice(0, 8);
    const actors = await Promise.all(
      ['MASTER', 'PLAYER', 'PLAYER'].map((role, i) =>
        prisma.user.create({
          data: {
            username: `elevation_${suffix}_${i}`,
            displayName: 'Fixture elevação',
            passwordHash: 'fixture',
            role: role as 'MASTER' | 'PLAYER',
          },
        }),
      ),
    );
    users.push(...actors.map((u) => u.id));
    const tokens = actors.map((user) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      }),
    );
    const hero = await prisma.character.create({
      data: {
        userId: users[1]!,
        name: 'Explorador Elevação',
        raceId: 'human',
        hpMax: 10,
        hpCurrent: 10,
        speed: 9,
      },
    });
    async function http(
      path: string,
      method = 'GET',
      body?: unknown,
      token = tokens[0],
    ) {
      const res = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json()) as any };
    }
    check(
      'Sentinela HTTP confirma o banco descartável',
      (await http('/characters/me', 'GET', undefined, tokens[1])).data.character
        ?.id === hero.id,
    );
    const region = await prisma.region.create({
      data: { name: `Elevação ${suffix}` },
    });
    regionId = region.id;
    const locality = await prisma.locality.create({
      data: { name: 'Plataforma isolada', regionId: region.id },
    });
    let response = await http(`/localities/${locality.id}/scenes`, 'POST', {
      name: 'Mapa elevação',
      spatialConfig: { mode: 'grid-2d', widthFeet: 40, heightFeet: 40 },
    });
    check(
      'Cria cena por HTTP',
      response.status === 201 || response.status === 200,
    );
    let scene = response.data.scene;
    scene = await smokeSceneTerrain(http,scene,hero,users[1]!,locality.id,tokens[1]!);
    const cells = [
      { xFeet: 5, yFeet: 0, elevationFeet: 10 },
      { xFeet: 10, yFeet: 0, elevationFeet: 10 },
    ];
    const patch = {
      spatialConfig: { mode: 'grid-2d', elevationCells: cells },
      expectedVersion: scene.version,
      operationId: randomUUID(),
    };
    response = await http(`/scenes/${scene.id}`, 'PATCH', patch);
    check(
      'Persiste pincel em pés',
      response.status === 200 &&
        response.data.scene.spatialConfig.elevationCells[0].elevationFeet ===
          10,
    );
    scene = response.data.scene;
    check(
      'Retry da pintura não duplica nem incrementa versão',
      (await http(`/scenes/${scene.id}`, 'PATCH', patch)).data.scene.version ===
        scene.version,
    );
    check(
      'Jogador não edita terreno',
      (
        await http(
          `/scenes/${scene.id}`,
          'PATCH',
          {
            ...patch,
            expectedVersion: scene.version,
            operationId: randomUUID(),
          },
          tokens[1],
        )
      ).status === 403,
    );
    check(
      'Versão antiga de cena é recusada',
      (
        await http(`/scenes/${scene.id}`, 'PATCH', {
          ...patch,
          operationId: randomUUID(),
        })
      ).status === 409,
    );
    check(
      'Célula duplicada é recusada',
      (
        await http(`/scenes/${scene.id}`, 'PATCH', {
          ...patch,
          spatialConfig: {
            mode: 'grid-2d',
            elevationCells: [cells[0], cells[0]],
          },
          expectedVersion: scene.version,
          operationId: randomUUID(),
        })
      ).status === 400,
    );
    check(
      'Reduzir cena não corta plataforma',
      (
        await http(`/scenes/${scene.id}`, 'PATCH', {
          spatialConfig: { mode: 'grid-2d', widthFeet: 5 },
          expectedVersion: scene.version,
          operationId: randomUUID(),
        })
      ).status === 409,
    );
    response = await http(`/scenes/${scene.id}`, 'PATCH', {
      spatialConfig: { mode: 'grid-2d', widthFeet: 45 },
      expectedVersion: scene.version,
      operationId: randomUUID(),
    });
    scene = response.data.scene;
    check(
      'Editar dimensão preserva pintura',
      scene.spatialConfig.elevationCells.length === 2,
    );
    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        turnSequence: 1,
        sceneId: scene.id,
        localityId: locality.id,
        combatants: {
          create: {
            kind: 'CHARACTER',
            characterId: hero.id,
            ownerUserId: users[1],
            name: hero.name,
            dexterityMod: 0,
            initiative: 10,
            turnEconomy: onTurnStart(9),
            sideKey: 'players',
            spatialPosition: { xFeet: 0, yFeet: 0 },
          },
        },
      },
      include: { combatants: true },
    });
    combatId = combat.id;
    const mover = combat.combatants[0]!;
    const route = `/combat/${combat.id}`;
    const state = async () => (await http('/combat/active')).data.combat;
    let current = await state();
    const heights = {
      elevationFeet: 0,
      bodyHeightFeet: 6,
      expectedVersion: current.version,
      operationId: randomUUID(),
    };
    response = await http(
      `${route}/combatants/${mover.id}/spatial-height`,
      'PATCH',
      heights,
    );
    check(
      'Mestre ajusta altura separada do footprint',
      response.status === 200 &&
        response.data.combat.combatants[0].spatial.bodyHeightFeet === 6,
    );
    current = response.data.combat;
    check(
      'Jogador não altera altura',
      (
        await http(
          `${route}/combatants/${mover.id}/spatial-height`,
          'PATCH',
          {
            ...heights,
            expectedVersion: current.version,
            operationId: randomUUID(),
          },
          tokens[1],
        )
      ).status === 403,
    );
    check(
      'Altura negativa é recusada com 400',
      (
        await http(`${route}/combatants/${mover.id}/spatial-height`, 'PATCH', {
          ...heights,
          bodyHeightFeet: -1,
          expectedVersion: current.version,
          operationId: randomUUID(),
        })
      ).status === 400,
    );
    const path = [{ xFeet: 5, yFeet: 0 }];
    response = await http(
      `${route}/spatial/movement-preview`,
      'POST',
      { combatantId: mover.id, path },
      tokens[1],
    );
    check(
      'Preview detecta subida',
      response.status === 200 &&
        response.data.elevationDecisionRequired === true,
    );
    const move = {
      combatantId: mover.id,
      path,
      expectedVersion: current.version,
      operationId: randomUUID(),
    };
    response = await http(`${route}/spatial/movement`, 'POST', move, tokens[1]);
    check(
      'Commit direto não atravessa borda gratuitamente',
      response.status === 409 &&
        response.data.error === 'MOVEMENT_ELEVATION_DECISION_REQUIRED',
    );
    check(
      'Recusa preserva posição e versão',
      (await state()).version === current.version,
    );
    check(
      'Outro jogador não solicita pelo token alheio',
      (
        await http(
          `${route}/spatial/elevation-requests`,
          'POST',
          move,
          tokens[2],
        )
      ).status === 403,
    );
    response = await http(
      `${route}/spatial/elevation-requests`,
      'POST',
      move,
      tokens[1],
    );
    check(
      'Solicitação não move token',
      response.status === 200 &&
        response.data.combat.combatants[0].spatial.position.xFeet === 0,
    );
    current = response.data.combat;
    const list = await http(`${route}/spatial/elevation-requests`);
    const requestId = list.data.requests[0].id;
    check(
      'Solicitação é privada do Mestre',
      (
        await http(
          `${route}/spatial/elevation-requests`,
          'GET',
          undefined,
          tokens[1],
        )
      ).status === 403,
    );
    check(
      'Pintura de cena em uso é bloqueada',
      (
        await http(`/scenes/${scene.id}`, 'PATCH', {
          ...patch,
          expectedVersion: scene.version,
          operationId: randomUUID(),
        })
      ).data.error === 'SCENE_IN_USE',
    );
    const decision = {
      approve: true,
      additionalCostFeet: 5,
      expectedVersion: current.version,
      operationId: randomUUID(),
    };
    check(
      'Jogador não aprova sua própria travessia',
      (
        await http(
          `${route}/spatial/elevation-requests/${requestId}`,
          'POST',
          decision,
          tokens[1],
        )
      ).status === 403,
    );
    response = await http(
      `${route}/spatial/elevation-requests/${requestId}`,
      'POST',
      decision,
    );
    check(
      'Aprovação move e acompanha nível da plataforma',
      response.status === 200 &&
        response.data.combat.combatants[0].spatial.position.xFeet === 5 &&
        response.data.combat.combatants[0].spatial.elevationFeet === 10,
    );
    current = response.data.combat;
    check(
      'Custo horizontal e adicional são consumidos',
      Math.abs(current.combatants[0].turnEconomy.movementUsed - 3) < 0.001,
    );
    const version = current.version;
    response = await http(
      `${route}/spatial/elevation-requests/${requestId}`,
      'POST',
      decision,
    );
    check(
      'Retry da aprovação não duplica gasto',
      response.status === 200 &&
        response.data.replayed &&
        response.data.combat.version === version,
    );
    const flatPath = [{ xFeet: 10, yFeet: 0 }];
    check(
      'Andar na mesma plataforma não solicita decisão',
      !(
        await http(
          `${route}/spatial/movement-preview`,
          'POST',
          { combatantId: mover.id, path: flatPath },
          tokens[1],
        )
      ).data.elevationDecisionRequired,
    );
    response = await http(
      `${route}/spatial/movement`,
      'POST',
      {
        combatantId: mover.id,
        path: flatPath,
        expectedVersion: version,
        operationId: randomUUID(),
      },
      tokens[1],
    );
    check('Movimento horizontal continua funcionando', response.status === 200);
    current = response.data.combat;
    response = await http(
      `${route}/spatial/elevation-requests`,
      'POST',
      {
        combatantId: mover.id,
        path: [{ xFeet: 15, yFeet: 0 }],
        expectedVersion: current.version,
        operationId: randomUUID(),
      },
      tokens[1],
    );
    current = response.data.combat;
    const staleId = (await http(`${route}/spatial/elevation-requests`)).data
      .requests[0].id;
    await prisma.combat.update({
      where: { id: combat.id },
      data: { turnSequence: { increment: 1 } },
    });
    check(
      'Pedido do turno anterior não pode ser aprovado',
      (
        await http(`${route}/spatial/elevation-requests/${staleId}`, 'POST', {
          approve: true,
          expectedVersion: current.version,
          operationId: randomUUID(),
        })
      ).status === 409,
    );
    check(
      'Fila ignora pedidos expirados',
      (await http(`${route}/spatial/elevation-requests`)).data.requests
        .length === 0,
    );
    // Reação real interrompe uma travessia autorizada; custo extra não pode se repetir na retomada.
    const guard = await prisma.creature.create({
      data: {
        name: 'Guarda de plataforma',
        hpMax: 10,
        hpCurrent: 10,
        attacks: [
          {
            id: 'claw',
            name: 'Garra',
            reachFeet: 5,
            ranged: false,
            attackBonus: 0,
            damage: { count: 0, sides: 0, bonus: 0, type: null },
          },
        ],
      },
    });
    creatures.push(guard.id);
    await prisma.combatant.update({
      where: { id: mover.id },
      data: {
        spatialPosition: { xFeet: 5, yFeet: 0 },
        elevationFeet: 10,
        turnEconomy: onTurnStart(9),
      },
    });
    await prisma.combatant.create({
      data: {
        combatId: combat.id,
        kind: 'CREATURE',
        creatureId: guard.id,
        name: guard.name,
        dexterityMod: 0,
        initiative: 1,
        hpCurrent: 10,
        hpMax: 10,
        sideKey: 'enemies',
        spatialPosition: { xFeet: 5, yFeet: 5 },
        elevationFeet: 10,
        bodyHeightFeet: 6,
        turnEconomy: onTurnStart(9),
      },
    });
    current = await state();
    const crossing = [
      { xFeet: 10, yFeet: 0 },
      { xFeet: 15, yFeet: 0 },
    ];
    response = await http(
      `${route}/spatial/elevation-requests`,
      'POST',
      {
        combatantId: mover.id,
        path: crossing,
        expectedVersion: current.version,
        operationId: randomUUID(),
      },
      tokens[1],
    );
    current = response.data.combat;
    const crossingId = (await http(`${route}/spatial/elevation-requests`)).data
      .requests[0].id;
    response = await http(
      `${route}/spatial/elevation-requests/${crossingId}`,
      'POST',
      {
        approve: true,
        additionalCostFeet: 5,
        expectedVersion: current.version,
        operationId: randomUUID(),
      },
    );
    check(
      'Travessia autorizada preserva a pausa de oportunidade',
      response.status === 200 &&
        response.data.pending &&
        response.data.combat.combatants.find((c: any) => c.id === mover.id)
          .spatial.position.xFeet === 10,
    );
    current = response.data.combat;
    const opportunities = (await http(`${route}/reaction-opportunities`)).data
      .opportunities;
    check('Reação abre uma única janela', opportunities.length === 1);
    check(
      'Altura não muda enquanto reação está pendente',
      (
        await http(`${route}/combatants/${mover.id}/spatial-height`, 'PATCH', {
          elevationFeet: 20,
          bodyHeightFeet: 6,
          expectedVersion: current.version,
          operationId: randomUUID(),
        })
      ).data.error === 'MOVEMENT_PENDING_REACTION',
    );
    response = await http(
      `${route}/reaction-opportunities/${opportunities[0].id}/decline`,
      'POST',
      {
        combatId: combat.id,
        expectedVersion: current.version,
        operationId: randomUUID(),
      },
    );
    check('Recusa da reação retoma a travessia', response.status === 200);
    current = await state();
    const resumed = current.combatants.find((c: any) => c.id === mover.id);
    check(
      'Retomada chega ao nível inferior com custo extra aplicado uma vez',
      resumed.spatial.position.xFeet === 15 &&
        resumed.spatial.elevationFeet === 0 &&
        Math.abs(resumed.turnEconomy.movementUsed - 4.5) < 0.001,
    );
    response = await http(
      `${route}/spatial/elevation-requests`,
      'POST',
      {
        combatantId: mover.id,
        path: [{ xFeet: 10, yFeet: 0 }],
        expectedVersion: current.version,
        operationId: randomUUID(),
      },
      tokens[1],
    );
    current = response.data.combat;
    const denialId = (await http(`${route}/spatial/elevation-requests`)).data
      .requests[0].id;
    const denial = {
      approve: false,
      expectedVersion: current.version,
      operationId: randomUUID(),
    };
    response = await http(
      `${route}/spatial/elevation-requests/${denialId}`,
      'POST',
      denial,
    );
    check(
      'Recusar travessia mantém token no nível atual',
      response.status === 200 &&
        response.data.combat.combatants.find((c: any) => c.id === mover.id)
          .spatial.position.xFeet === 15,
    );
    const deniedVersion = response.data.combat.version;
    check(
      'Retry da recusa é idempotente',
      (
        await http(
          `${route}/spatial/elevation-requests/${denialId}`,
          'POST',
          denial,
        )
      ).data.combat.version === deniedVersion,
    );
    check(
      'Pedido recusado não pode ser aprovado depois',
      (
        await http(`${route}/spatial/elevation-requests/${denialId}`, 'POST', {
          approve: true,
          expectedVersion: deniedVersion,
          operationId: randomUUID(),
        })
      ).status === 409,
    );
    console.log(`${checks} verificações HTTP de elevações aprovadas.`);
  } finally {
    if (combatId) await prisma.combat.delete({ where: { id: combatId } });
    await prisma.creature.deleteMany({ where: { id: { in: creatures } } });
    if (regionId) await prisma.region.delete({ where: { id: regionId } });
    await prisma.character.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
