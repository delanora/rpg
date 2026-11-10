import { smokeAreaQuery } from './smoke-area-query.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { onTurnStart } from '../modules/shared/action-economy.js';

/** Executado apenas pela fixture isolada de elevação, depois da sentinela HTTP. */
export async function smokeSceneTerrain(
  http: (
    path: string,
    method?: string,
    body?: unknown,
    token?: string,
  ) => Promise<{ status: number; data: any }>,
  initial: any,
  hero: { id: string; name: string },
  ownerUserId: string,
  localityId: string,
  playerToken: string,
) {
  assert.match(
    new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  let scene = initial;
  const route = `/scenes/${scene.id}`;
  let checks = 0;
  const check = (label: string, ok: unknown) => {
    assert.ok(ok, label);
    checks++;
    console.log(`✔ ${label}`);
  };
  const update = async (patch: object) =>
    http(route, 'PATCH', {
      ...patch,
      expectedVersion: scene.version,
      operationId: randomUUID(),
    });
  let result = await update({
    spatialConfig: {
      mode: 'grid-2d',
      difficultTerrainCells: [
        { xFeet: 5, yFeet: 0 },
        { xFeet: 30, yFeet: 30 },
      ],
      elevationCells: [{ xFeet: 30, yFeet: 30, elevationFeet: 5 }],
    },
  });
  check(
    'Cena persiste terreno difícil sem perder elevação',
    result.status === 200 &&
      result.data.scene.spatialConfig.difficultTerrainCells.length === 2,
  );
  scene = result.data.scene;
  const wall = await http(`${route}/spatial/obstacles`, 'POST', {
    start: { xFeet: 30, yFeet: 0 },
    end: { xFeet: 30, yFeet: 10 },
    expectedVersion: scene.version,
    operationId: randomUUID(),
  });
  scene = wall.data.scene;
  assert.equal(wall.status, 200);
  const id = scene.obstacles[0].id;
  result = await update({
    removeObstacleIds: [id, 'parede-alheia'],
    spatialConfig: {
      mode: 'grid-2d',
      difficultTerrainCells: [],
      elevationCells: [],
    },
  });
  check(
    'Parede alheia recusa a operação inteira',
    result.status === 400 &&
      (await http(route)).data.scene.version === scene.version &&
      (await http(route)).data.scene.obstacles.length === 1,
  );
  const intention = {
    removeObstacleIds: [id],
    spatialConfig: {
      mode: 'grid-2d',
      difficultTerrainCells: [{ xFeet: 5, yFeet: 0 }],
      elevationCells: [],
    },
    expectedVersion: scene.version,
    operationId: randomUUID(),
  };
  result = await http(route, 'PATCH', intention);
  check(
    'Borracha salva paredes e camadas numa só versão',
    result.status === 200 &&
      result.data.scene.version === scene.version + 1 &&
      result.data.scene.obstacles.length === 0 &&
      result.data.scene.spatialConfig.elevationCells.length === 0,
  );
  scene = result.data.scene;
  check(
    'Retry da borracha retorna snapshot sem reaplicar',
    (await http(route, 'PATCH', intention)).data.scene.version ===
      scene.version,
  );
  check(
    'Fingerprint inclui IDs de paredes',
    (await http(route, 'PATCH', { ...intention, removeObstacleIds: [] }))
      .status === 409,
  );
  check(
    'Versão velha não pinta terreno',
    (await http(route, 'PATCH', { ...intention, operationId: randomUUID() }))
      .status === 409,
  );
  check(
    'Jogador não edita camadas',
    (
      await http(
        route,
        'PATCH',
        {
          ...intention,
          expectedVersion: scene.version,
          operationId: randomUUID(),
        },
        playerToken,
      )
    ).status === 403,
  );
  check(
    'Quadrado fora do mapa recusado',
    (
      await update({
        spatialConfig: {
          mode: 'grid-2d',
          difficultTerrainCells: [{ xFeet: 40, yFeet: 0 }],
        },
      })
    ).status === 409,
  );
  check(
    'Quadrados duplicados recusados',
    (
      await update({
        spatialConfig: {
          mode: 'grid-2d',
          difficultTerrainCells: [
            { xFeet: 5, yFeet: 0 },
            { xFeet: 5, yFeet: 0 },
          ],
        },
      })
    ).status === 400,
  );
  const combat = await prisma.combat.create({
    data: {
      status: 'ACTIVE',
      turnSequence: 1,
      sceneId: scene.id,
      localityId,
      combatants: {
        create: {
          kind: 'CHARACTER',
          characterId: hero.id,
          ownerUserId,
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
  try {
    const mover = combat.combatants[0]!;
    const path = [{ xFeet: 5, yFeet: 0 }];
    const preview = await http(
      `/combat/${combat.id}/spatial/movement-preview`,
      'POST',
      { combatantId: mover.id, path },
      playerToken,
    );
    check(
      'Preview real cobra 10 pés por passo de 5 pés difícil',
      preview.status === 200 &&
        preview.data.movement.totalCostFeet === 10 &&
        preview.data.movement.steps[0].difficultTerrainSources.includes(
          'environmental',
        ),
    );
    const move = {
      combatantId: mover.id,
      path,
      expectedVersion: combat.version,
      operationId: randomUUID(),
    };
    result = await http(
      `/combat/${combat.id}/spatial/movement`,
      'POST',
      move,
      playerToken,
    );
    const stored = await prisma.combatant.findUniqueOrThrow({
      where: { id: mover.id },
    });
    check(
      'Commit real gasta 3 metros de movimento',
      result.status === 200 &&
        (stored.turnEconomy as { movementUsed: number }).movementUsed === 3,
    );
    await http(
      `/combat/${combat.id}/spatial/movement`,
      'POST',
      move,
      playerToken,
    );
    check(
      'Retry de movimento não duplica custo',
      (
        (await prisma.combatant.findUniqueOrThrow({ where: { id: mover.id } }))
          .turnEconomy as { movementUsed: number }
      ).movementUsed === 3,
    );
    await smokeAreaQuery(http,combat.id,mover.id,playerToken);
    check(
      'Cena em combate não aceita borracha',
      (
        await update({
          removeObstacleIds: [],
          spatialConfig: { mode: 'grid-2d', difficultTerrainCells: [] },
        })
      ).status === 409,
    );
  } finally {
    await prisma.combat.delete({ where: { id: combat.id } });
  }
  result = await update({
    spatialConfig: {
      mode: 'grid-2d',
      difficultTerrainCells: [],
      elevationCells: [],
    },
  });
  assert.equal(result.status, 200);
  console.log(`${checks} verificações HTTP de terreno e borracha aprovadas.`);
  return result.data.scene;
}
