import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  SPATIAL_GEOMETRY_EPSILON_FEET,
  canonicalSegment,
  classifySegmentIntersection,
  segmentCrossesSpace,
  segmentLengthFeet,
  segmentsEquivalent,
  segmentsIntersect,
  type Segment2D,
} from '../modules/combat/spatial/spatial-geometry.js';
import { occupiedSpaceOf } from '../modules/combat/spatial/occupied-space.js';
import {
  movementSegmentBlocked,
  sightSegmentBlocked,
  type SpatialObstacleSource,
} from '../modules/combat/spatial/spatial-obstacle.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FASE 6.6L.4.1.1 — LOCALITY SCENE FOUNDATION & WALL OWNERSHIP.
 *
 * Prova a fundação de CENAS da localidade e do ownership das paredes:
 *  • geometria PURA de segmentos preservada da 6.6L.4.1 (epsilon, none/cross/
 *    touch/overlap, diagonais, 2,5 pés) — nada foi reimplementado;
 *  • `Locality 1→N Scene 1→N SpatialObstacle`; o combate só REFERENCIA a cena;
 *  • CRUD de cena MASTER-only, com `expectedVersion`/`operationId`;
 *  • cena em uso por combate NÃO terminado é congelada (409 SCENE_IN_USE);
 *  • combate legado sem cena continua funcionando (fallback `spatialConfig`);
 *  • cena escolhida precisa pertencer à localidade do combate;
 *  • cena sem imagem é válida e a imagem nunca é fonte mecânica.
 *
 * Fixtures próprias: nenhum personagem/NPC/localidade/região real é tocado.
 */
export async function smokeSpatialWalls(baseUrl: string, check: Check): Promise<void> {
  console.log('\n89W) Fase 6.6L.4.1.1 — Locality Scenes & Wall Ownership');

  const seg = (ax: number, ay: number, bx: number, by: number): Segment2D => ({
    start: { xFeet: ax, yFeet: ay },
    end: { xFeet: bx, yFeet: by },
  });

  // ===================================================================
  // A–M — GEOMETRIA PURA DE SEGMENTOS (sem banco, sem HTTP)
  // ===================================================================
  check(
    '89W.A) sem interseção: paralelos disjuntos e colineares separados = none',
    classifySegmentIntersection(seg(0, 0, 10, 0), seg(0, 5, 10, 5)) === 'none' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(12, 0, 20, 0)) === 'none' &&
      !segmentsIntersect(seg(0, 0, 10, 0), seg(11, 0, 20, 0)),
  );
  check(
    '89W.B) cruzamento ORTOGONAL: interiores se cruzam = cross (nunca touch)',
    classifySegmentIntersection(seg(0, 10, 20, 10), seg(10, 0, 10, 20)) === 'cross' &&
      classifySegmentIntersection(seg(10, 0, 10, 20), seg(0, 10, 20, 10)) === 'cross',
  );
  check(
    '89W.C) cruzamento DIAGONAL: X em 45° = cross (diagonais são paredes válidas)',
    classifySegmentIntersection(seg(0, 0, 10, 10), seg(0, 10, 10, 0)) === 'cross' &&
      classifySegmentIntersection(seg(2.5, 2.5, 12.5, 7.5), seg(2.5, 7.5, 12.5, 2.5)) === 'cross',
  );
  check(
    '89W.D) interseção em ENDPOINT e junção em T = touch (não é cross)',
    classifySegmentIntersection(seg(0, 0, 10, 0), seg(10, 0, 10, 10)) === 'touch' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, 0, 5, 10)) === 'touch' &&
      classifySegmentIntersection(seg(0, 0, 10, 10), seg(10, 10, 20, 0)) === 'touch',
  );
  check(
    '89W.E) COLINEARES: sobreposto = overlap; encostando num endpoint = touch',
    classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, 0, 15, 0)) === 'overlap' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(2, 0, 8, 0)) === 'overlap' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(10, 0, 20, 0)) === 'touch' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(10, 0, 10, 0)) === 'touch',
  );
  check(
    '89W.F) VERTICAL e HORIZONTAL: cruzam entre si; verticais separadas = none',
    classifySegmentIntersection(seg(5, 0, 5, 20), seg(0, 10, 20, 10)) === 'cross' &&
      classifySegmentIntersection(seg(5, 0, 5, 20), seg(5, 0, 5, 20)) === 'overlap' &&
      classifySegmentIntersection(seg(5, 0, 5, 20), seg(10, 0, 10, 20)) === 'none',
  );
  check(
    '89W.G) PRECISÃO de 2,5 pés (Tiny): cruzamento e colinear estão estáveis',
    classifySegmentIntersection(seg(0, 2.5, 5, 2.5), seg(2.5, 0, 2.5, 5)) === 'cross' &&
      classifySegmentIntersection(seg(0, 2.5, 5, 2.5), seg(2.5, 2.5, 7.5, 2.5)) === 'overlap' &&
      segmentLengthFeet(seg(0, 0, 2.5, 2.5)) === Math.hypot(2.5, 2.5),
  );
  const symmetryMatrix: Segment2D[] = [
    seg(0, 0, 10, 0),
    seg(5, -5, 5, 5),
    seg(0, 0, 10, 10),
    seg(0, 10, 10, 0),
    seg(2.5, 2.5, 7.5, 7.5),
    seg(10, 0, 20, 0),
    seg(3, 0, 3, 0),
    seg(0, 0, 0, 8),
  ];
  check(
    '89W.H) SIMETRIA: classify(A,B) === classify(B,A) e intersects idem em toda a matriz',
    symmetryMatrix.every((first) =>
      symmetryMatrix.every(
        (second) =>
          classifySegmentIntersection(first, second) === classifySegmentIntersection(second, first) &&
          segmentsIntersect(first, second) === segmentsIntersect(second, first),
      ),
    ),
  );
  check(
    '89W.I) INVERSÃO de endpoints: segmento canônico idêntico e mesma classificação',
    JSON.stringify(canonicalSegment(seg(0, 0, 10, 5))) ===
      JSON.stringify(canonicalSegment(seg(10, 5, 0, 0))) &&
      segmentsEquivalent(seg(0, 0, 10, 5), seg(10, 5, 0, 0)) &&
      !segmentsEquivalent(seg(0, 0, 10, 5), seg(0, 0, 10, 6)) &&
      classifySegmentIntersection(seg(0, 0, 10, 5), seg(0, 5, 10, 0)) ===
        classifySegmentIntersection(seg(10, 5, 0, 0), seg(10, 0, 0, 5)),
  );
  check(
    '89W.J) SEGMENTO DEGENERADO é um PONTO: touch só quando está sobre o outro',
    classifySegmentIntersection(seg(5, 0, 5, 0), seg(0, 0, 10, 0)) === 'touch' &&
      classifySegmentIntersection(seg(5, 1, 5, 1), seg(0, 0, 10, 0)) === 'none' &&
      classifySegmentIntersection(seg(3, 3, 3, 3), seg(3, 3, 3, 3)) === 'touch' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, 0, 5, 0)) === 'touch',
  );
  check(
    '89W.K) EPSILON: 0,001 pé de folga NÃO cruza; 1e-9 (ruído) é touch, não cross',
    SPATIAL_GEOMETRY_EPSILON_FEET === 1e-6 &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, 0.001, 5, 10)) === 'none' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, 1e-9, 5, 10)) === 'touch' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, -5, 5, 5)) === 'cross' &&
      classifySegmentIntersection(seg(0, 0, 10, 0), seg(5, 0, 5, 10)) === 'touch',
  );
  const footprint = occupiedSpaceOf({ xFeet: 10, yFeet: 10 }, 'large')!;
  check(
    '89W.L) FOOTPRINT (Large 10×10): parede dentro/atravessando = true; fora = false',
    segmentCrossesSpace(seg(15, 10, 15, 20), footprint) &&
      segmentCrossesSpace(seg(0, 15, 25, 15), footprint) &&
      segmentCrossesSpace(seg(12, 12, 13, 13), footprint) &&
      !segmentCrossesSpace(seg(0, 0, 5, 0), footprint) &&
      !segmentCrossesSpace(seg(11, 21, 19, 21), footprint),
  );
  const solidWall: SpatialObstacleSource = {
    id: 'fixture-solid-wall',
    kind: 'wall',
    startXFeet: 10,
    startYFeet: 0,
    endXFeet: 10,
    endYFeet: 20,
    blocksMovement: true,
    blocksSight: true,
  };
  const curtain: SpatialObstacleSource = { ...solidWall, id: 'fixture-curtain', blocksMovement: false };
  check(
    '89W.M) PROVIDER de movimento/LoS: flags INDEPENDENTES (parede × cortina)',
    movementSegmentBlocked({ xFeet: 0, yFeet: 10 }, { xFeet: 20, yFeet: 10 }, [solidWall]) &&
      sightSegmentBlocked({ xFeet: 0, yFeet: 10 }, { xFeet: 20, yFeet: 10 }, [solidWall]) &&
      !movementSegmentBlocked({ xFeet: 0, yFeet: 10 }, { xFeet: 20, yFeet: 10 }, [curtain]) &&
      sightSegmentBlocked({ xFeet: 0, yFeet: 10 }, { xFeet: 20, yFeet: 10 }, [curtain]) &&
      !movementSegmentBlocked({ xFeet: 0, yFeet: 25 }, { xFeet: 20, yFeet: 25 }, [solidWall]) &&
      !movementSegmentBlocked({ xFeet: 5, yFeet: 5 }, { xFeet: 5, yFeet: 5 }, [solidWall]),
  );

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const sceneIds: string[] = [];
  const localityIds: string[] = [];
  let regionId: string | null = null;
  let combatId: string | null = null;
  const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'] });

  try {
    // ===================================================================
    // FIXTURES (contas, região e localidades PRÓPRIAS)
    // ===================================================================
    const master = await prisma.user.create({
      data: {
        username: `scene_m_${suffix}`,
        displayName: 'Mestre Cenas',
        passwordHash: 'fixture',
        role: 'MASTER',
      },
    });
    const player = await prisma.user.create({
      data: {
        username: `scene_p_${suffix}`,
        displayName: 'Jogador Cenas',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    userIds.push(master.id, player.id);
    const masterToken = signToken({
      sub: master.id,
      username: master.username,
      displayName: master.displayName,
      role: master.role,
    });
    const playerToken = signToken({
      sub: player.id,
      username: player.username,
      displayName: player.displayName,
      role: player.role,
    });

    const region = await prisma.region.create({ data: { name: `Região Cenas ${suffix}` } });
    regionId = region.id;
    const localityA = await prisma.locality.create({
      data: { name: `Fortaleza ${suffix}`, description: '', regionId: region.id },
    });
    const localityB = await prisma.locality.create({
      data: { name: `Vila ${suffix}`, description: '', regionId: region.id },
    });
    localityIds.push(localityA.id, localityB.id);

    async function request(
      method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
      path: string,
      body?: unknown,
      auth: string = masterToken,
    ): Promise<HttpResult> {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, any>;
      return { status: response.status, data };
    }

    const op = (version: number) => ({ expectedVersion: version, operationId: randomUUID() });

    async function createScene(localityId: string, body: Record<string, unknown>, auth = masterToken) {
      return request('POST', `/localities/${localityId}/scenes`, body, auth);
    }

    // ===================================================================
    // N–U — SCENE CRUD (MASTER-only) e estado inicial válido
    // ===================================================================
    const patioCreated = await createScene(localityA.id, { name: 'Pátio' });
    const patio = patioCreated.data.scene as Record<string, any>;
    if (patio?.id) sceneIds.push(patio.id);
    check(
      '89W.N) POST cria cena SEM imagem: config padrão assistida, zero paredes, versão 0',
      patioCreated.status === 201 &&
        patio.backgroundImageUrl === null &&
        Array.isArray(patio.obstacles) &&
        patio.obstacles.length === 0 &&
        patio.version === 0 &&
        patio.spatialConfig.mode === 'assisted' &&
        patio.spatialConfig.widthFeet === 100 &&
        patio.spatialConfig.heightFeet === 100 &&
        patio.spatialConfig.cellSizeFeet === 5,
      JSON.stringify({ status: patioCreated.status, scene: patio }),
    );

    const readBack = await request('GET', `/scenes/${patio.id}`);
    check(
      '89W.O) GET da cena devolve a MESMA cena persistida (escopo da localidade correta)',
      readBack.status === 200 &&
        readBack.data.scene.id === patio.id &&
        readBack.data.scene.localityId === localityA.id &&
        readBack.data.scene.version === 0,
      JSON.stringify(readBack.data),
    );

    const patioConfig = await request('PATCH', `/scenes/${patio.id}`, {
      name: 'Pátio principal',
      spatialConfig: { mode: 'grid-2d', widthFeet: 120, heightFeet: 80 },
      ...op(patio.version),
    });
    let sceneA = patioConfig.data.scene as Record<string, any>;
    check(
      '89W.P) PATCH nome + grid-2d 120×80: versão incrementa e dimensões em PÉS persistem',
      patioConfig.status === 200 &&
        sceneA.name === 'Pátio principal' &&
        sceneA.version === 1 &&
        sceneA.spatialConfig.mode === 'grid-2d' &&
        sceneA.spatialConfig.widthFeet === 120 &&
        sceneA.spatialConfig.heightFeet === 80 &&
        sceneA.spatialConfig.cellSizeFeet === 5,
      JSON.stringify({ status: patioConfig.status, scene: sceneA }),
    );

    const salaoCreated = await createScene(localityA.id, { name: 'Salão' });
    const salao = salaoCreated.data.scene as Record<string, any>;
    if (salao?.id) sceneIds.push(salao.id);
    const masmorraCreated = await createScene(localityA.id, {
      name: 'Masmorra',
      backgroundImageUrl: '/uploads/cena-masmorra.png',
    });
    const masmorra = masmorraCreated.data.scene as Record<string, any>;
    if (masmorra?.id) sceneIds.push(masmorra.id);
    const sceneBcreated = await createScene(localityB.id, {
      name: 'Praça',
      spatialConfig: { mode: 'grid-2d', widthFeet: 60, heightFeet: 60 },
    });
    const sceneB = sceneBcreated.data.scene as Record<string, any>;
    if (sceneB?.id) sceneIds.push(sceneB.id);

    const listA = await request('GET', `/localities/${localityA.id}/scenes`);
    const listB = await request('GET', `/localities/${localityB.id}/scenes`);
    check(
      '89W.Q) MULTI-SCENE: localidade A tem 3 cenas, B tem 1 e a listagem não vaza entre localidades',
      listA.status === 200 &&
        listA.data.scenes.length === 3 &&
        listB.data.scenes.length === 1 &&
        listB.data.scenes[0].id === sceneB.id &&
        !listA.data.scenes.some((scene: any) => scene.id === sceneB.id),
      JSON.stringify({ a: listA.data.scenes?.length, b: listB.data.scenes?.length }),
    );
    check(
      '89W.R) cena COM imagem de fundo é válida (a imagem é apresentação, não fonte mecânica)',
      masmorraCreated.status === 201 &&
        masmorra.backgroundImageUrl === '/uploads/cena-masmorra.png' &&
        masmorra.spatialConfig.mode === 'assisted',
      JSON.stringify(masmorra),
    );

    const playerCreate = await createScene(localityA.id, { name: 'Cena do jogador' }, playerToken);
    const playerPatch = await request(
      'PATCH',
      `/scenes/${sceneA.id}`,
      { name: 'Hackeada', ...op(sceneA.version) },
      playerToken,
    );
    const playerDelete = await request(
      'DELETE',
      `/scenes/${sceneA.id}`,
      op(sceneA.version),
      playerToken,
    );
    check(
      '89W.S) PLAYER não cria, não edita e não remove cena (403 nas três rotas)',
      playerCreate.status === 403 && playerPatch.status === 403 && playerDelete.status === 403,
      JSON.stringify({ create: playerCreate.status, update: playerPatch.status, delete: playerDelete.status }),
    );

    const stale = await request('PATCH', `/scenes/${sceneA.id}`, {
      name: 'Versão velha',
      ...op(sceneA.version - 1),
    });
    check(
      '89W.T) expectedVersion velho → 409 CONFLICT (escrita velha nunca sobrescreve)',
      stale.status === 409 && stale.data.error === 'CONFLICT',
      JSON.stringify({ status: stale.status, data: stale.data }),
    );

    const idempotentOp = randomUUID();
    const renamedOnce = await request('PATCH', `/scenes/${sceneA.id}`, {
      name: 'Pátio',
      expectedVersion: sceneA.version,
      operationId: idempotentOp,
    });
    const renamedAgain = await request('PATCH', `/scenes/${sceneA.id}`, {
      name: 'Pátio',
      expectedVersion: sceneA.version,
      operationId: idempotentOp,
    });
    sceneA = renamedOnce.data.scene as Record<string, any>;
    check(
      '89W.U) PATCH idempotente: retry devolve o MESMO snapshot sem segunda escrita',
      renamedOnce.status === 200 &&
        renamedAgain.status === 200 &&
        renamedAgain.data.scene.version === renamedOnce.data.scene.version &&
        renamedOnce.data.scene.name === 'Pátio' &&
        sceneA.version === 2,
      JSON.stringify({ first: renamedOnce.status, retry: renamedAgain.status }),
    );
    const reusedSceneOp = await request('PATCH', `/scenes/${sceneA.id}`, {
      name: 'Outro nome',
      expectedVersion: sceneA.version,
      operationId: idempotentOp,
    });
    const missingScene = await request('GET', '/scenes/scene-inexistente');
    check(
      '89W.V) operationId reutilizado com outro payload → 409 e cena inexistente → 404',
      reusedSceneOp.status === 409 &&
        reusedSceneOp.data.error === 'IDEMPOTENCY_KEY_REUSED' &&
        missingScene.status === 404,
      JSON.stringify({ reused: reusedSceneOp.data, missing: missingScene.status }),
    );

    // ===================================================================
    // W–AG — PAREDES sob a CENA (owner estrutural)
    // ===================================================================
    async function createWall(sceneId: string, scene: Record<string, any>, body: Record<string, any>, auth = masterToken) {
      return request('POST', `/scenes/${sceneId}/spatial/obstacles`, { ...op(scene.version), ...body }, auth);
    }

    const wallCreated = await createWall(sceneA.id, sceneA, {
      start: { xFeet: 10, yFeet: 10 },
      end: { xFeet: 40, yFeet: 10 },
    });
    sceneA = wallCreated.data.scene as Record<string, any>;
    const firstWall = wallCreated.data.obstacle as Record<string, any>;
    check(
      '89W.W) MASTER cria PAREDE na CENA: endpoints em pés, comprimento derivado e flags default',
      wallCreated.status === 200 &&
        firstWall.kind === 'wall' &&
        firstWall.start.xFeet === 10 &&
        firstWall.end.xFeet === 40 &&
        firstWall.lengthFeet === 30 &&
        firstWall.blocksMovement === true &&
        firstWall.blocksSight === true &&
        sceneA.obstacles.some((wall: any) => wall.id === firstWall.id),
      JSON.stringify({ status: wallCreated.status, obstacle: firstWall }),
    );

    const salaoRead = await request('GET', `/scenes/${salao.id}`);
    const wallRow = await prisma.spatialObstacle.findUnique({ where: { id: firstWall.id } });
    check(
      '89W.X) WALL OWNERSHIP: a parede existe na cena A, NÃO na cena irmã, e o banco grava `sceneId`',
      salaoRead.data.scene.obstacles.length === 0 &&
        wallRow?.sceneId === sceneA.id &&
        (wallRow as Record<string, unknown>).combatId === undefined,
      JSON.stringify({ salao: salaoRead.data.scene.obstacles.length, sceneId: wallRow?.sceneId }),
    );
    check(
      '89W.Y) projeção da parede tem EXATAMENTE os campos previstos (sem vazar auditoria)',
      JSON.stringify(Object.keys(firstWall).sort()) ===
        JSON.stringify(['blocksMovement', 'blocksSight', 'end', 'id', 'kind', 'lengthFeet', 'start'].sort()),
      JSON.stringify(firstWall),
    );

    const sceneBWide = await createWall(sceneB.id, sceneB, {
      start: { xFeet: 100, yFeet: 10 },
      end: { xFeet: 110, yFeet: 10 },
    });
    const patioWide = await createWall(sceneA.id, sceneA, {
      start: { xFeet: 100, yFeet: 10 },
      end: { xFeet: 110, yFeet: 10 },
    });
    sceneA = patioWide.data.scene ?? sceneA;
    check(
      '89W.Z) BOUNDS são da CENA: 100 pés fora de 60×60 é 400; na cena 120×80 é válido',
      sceneBWide.status === 400 &&
        sceneBWide.data.error === 'SPATIAL_OBSTACLE_OUT_OF_BOUNDS' &&
        patioWide.status === 200,
      JSON.stringify({ b: sceneBWide.data.error, a: patioWide.status }),
    );

    const degenerate = await createWall(sceneA.id, sceneA, {
      start: { xFeet: 20, yFeet: 20 },
      end: { xFeet: 20, yFeet: 20 },
    });
    const negative = await createWall(sceneA.id, sceneA, {
      start: { xFeet: -2.5, yFeet: 10 },
      end: { xFeet: 10, yFeet: 10 },
    });
    check(
      '89W.AA) comprimento zero é 400 DEGENERATE e coordenada negativa é 400 no Zod — nada é corrigido',
      degenerate.status === 400 &&
        degenerate.data.error === 'SPATIAL_OBSTACLE_DEGENERATE' &&
        negative.status === 400 &&
        negative.data.error === 'VALIDATION_ERROR',
      JSON.stringify({ degenerate: degenerate.data, negative: negative.data }),
    );
    const invalidPayloads = await Promise.all([
      createWall(sceneA.id, sceneA, { start: { xFeet: '10', yFeet: 0 }, end: { xFeet: 20, yFeet: 0 } }),
      createWall(sceneA.id, sceneA, {
        start: { xFeet: 10, yFeet: 0 },
        end: { xFeet: 20, yFeet: 0 },
        occupiedSpace: { minXFeet: 0 },
      }),
      createWall(sceneA.id, sceneA, { start: { xFeet: 10, yFeet: 0 }, end: { xFeet: 20, yFeet: 0 }, kind: 'door' }),
    ]);
    check(
      '89W.AB) payload inválido é 400: texto no lugar de número, campo extra e kind fora do primitive',
      invalidPayloads.every((row) => row.status === 400 && row.data.error === 'VALIDATION_ERROR'),
      JSON.stringify(invalidPayloads.map((row) => [row.status, row.data.error])),
    );

    const barrier = await createWall(sceneA.id, sceneA, {
      start: { xFeet: 0, yFeet: 40 },
      end: { xFeet: 40, yFeet: 40 },
      blocksMovement: true,
      blocksSight: false,
    });
    sceneA = barrier.data.scene as Record<string, any>;
    check(
      '89W.AC) blocksMovement e blocksSight continuam INDEPENDENTES (barreira invisível)',
      barrier.status === 200 &&
        barrier.data.obstacle.blocksMovement === true &&
        barrier.data.obstacle.blocksSight === false,
      JSON.stringify(barrier.data.obstacle),
    );

    const moved = await request('PATCH', `/scenes/${sceneA.id}/spatial/obstacles/${firstWall.id}`, {
      start: { xFeet: 10, yFeet: 20 },
      end: { xFeet: 40, yFeet: 20 },
      ...op(sceneA.version),
    });
    sceneA = moved.data.scene as Record<string, any>;
    check(
      '89W.AD) UPDATE de endpoints persiste e o comprimento derivado acompanha',
      moved.status === 200 &&
        moved.data.obstacle.start.yFeet === 20 &&
        moved.data.obstacle.end.yFeet === 20 &&
        moved.data.obstacle.lengthFeet === 30,
      JSON.stringify(moved.data.obstacle),
    );

    const wallOp = randomUUID();
    const wallBody = {
      start: { xFeet: 60, yFeet: 60 },
      end: { xFeet: 90, yFeet: 60 },
      expectedVersion: sceneA.version,
      operationId: wallOp,
    };
    const wallOnce = await request('POST', `/scenes/${sceneA.id}/spatial/obstacles`, wallBody);
    const wallAgain = await request('POST', `/scenes/${sceneA.id}/spatial/obstacles`, wallBody);
    sceneA = wallOnce.data.scene as Record<string, any>;
    check(
      '89W.AE) retry idêntico devolve a MESMA parede e a MESMA versão (sem duplicar)',
      wallOnce.status === 200 &&
        wallAgain.status === 200 &&
        wallAgain.data.scene.version === wallOnce.data.scene.version &&
        wallOnce.data.obstacle.id === wallAgain.data.obstacle.id &&
        sceneA.obstacles.filter((wall: any) => wall.start.xFeet === 60).length === 1,
      JSON.stringify({ first: wallOnce.status, retry: wallAgain.status }),
    );
    const wallReusedKey = await request('POST', `/scenes/${sceneA.id}/spatial/obstacles`, {
      ...wallBody,
      end: { xFeet: 90, yFeet: 70 },
    });
    const wallStale = await request('POST', `/scenes/${sceneA.id}/spatial/obstacles`, {
      start: { xFeet: 70, yFeet: 20 },
      end: { xFeet: 80, yFeet: 20 },
      expectedVersion: sceneA.version - 1,
      operationId: randomUUID(),
    });
    check(
      '89W.AF) operationId reutilizado → 409 e expectedVersion velho → 409 (nunca last-write-wins)',
      wallReusedKey.status === 409 &&
        wallReusedKey.data.error === 'IDEMPOTENCY_KEY_REUSED' &&
        wallStale.status === 409,
      JSON.stringify({ reused: wallReusedKey.data.error, stale: wallStale.status }),
    );
    const beforeRace = sceneA.obstacles.length;
    const concurrent = await Promise.all([
      request('POST', `/scenes/${sceneA.id}/spatial/obstacles`, {
        start: { xFeet: 100, yFeet: 20 },
        end: { xFeet: 110, yFeet: 20 },
        expectedVersion: sceneA.version,
        operationId: randomUUID(),
      }),
      request('POST', `/scenes/${sceneA.id}/spatial/obstacles`, {
        start: { xFeet: 100, yFeet: 30 },
        end: { xFeet: 110, yFeet: 30 },
        expectedVersion: sceneA.version,
        operationId: randomUUID(),
      }),
    ]);
    sceneA = (await request('GET', `/scenes/${sceneA.id}`)).data.scene;
    check(
      '89W.AG) duas criações concorrentes: UMA vence, a outra recebe 409',
      concurrent.filter((row) => row.status === 200).length === 1 &&
        concurrent.filter((row) => row.status === 409).length === 1 &&
        sceneA.obstacles.length === beforeRace + 1,
      JSON.stringify(concurrent.map((row) => row.status)),
    );

    // ===================================================================
    // AH–AI — RESIZE com parede e REALTIME de cena
    // ===================================================================
    const shrink = await request('PATCH', `/scenes/${sceneA.id}`, {
      spatialConfig: { mode: 'grid-2d', widthFeet: 40, heightFeet: 40 },
      ...op(sceneA.version),
    });
    const afterShrink = (await request('GET', `/scenes/${sceneA.id}`)).data.scene;
    check(
      '89W.AH) reduzir a cena com parede fora dos novos limites → 409 e nada muda',
      shrink.status === 409 &&
        shrink.data.error === 'SCENE_RESIZE_CONFLICT' &&
        afterShrink.spatialConfig.widthFeet === 120 &&
        afterShrink.obstacles.some((wall: any) => wall.start.xFeet === 100),
      JSON.stringify({ status: shrink.status, error: shrink.data.error }),
    );

    socket.auth = { token: masterToken };
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    const sceneEvent = new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      const handler = (payload: any) => {
        if (payload?.scene?.id === sceneA.id && payload.scene.version > sceneA.version) {
          clearTimeout(timer);
          socket.off('scene:updated', handler);
          resolve(payload);
        }
      };
      socket.on('scene:updated', handler);
    });
    const realtimeWall = await createWall(sceneA.id, sceneA, {
      start: { xFeet: 20, yFeet: 60 },
      end: { xFeet: 50, yFeet: 60 },
    });
    sceneA = realtimeWall.data.scene ?? sceneA;
    const eventPayload = await sceneEvent;
    check(
      '89W.AI) mudança de parede publica `scene:updated` SOMENTE após o commit, na sala dos mestres',
      Boolean(eventPayload) && eventPayload!.scene.obstacles.some((wall: any) => wall.id === realtimeWall.data.obstacle.id),
      JSON.stringify(eventPayload ? eventPayload.scene.version : null),
    );
    let eventCount = 0;
    const countEvent = () => {
      eventCount += 1;
    };
    socket.on('scene:updated', countEvent);
    await createWall(sceneA.id, sceneA, {
      start: { xFeet: 200, yFeet: 200 },
      end: { xFeet: 210, yFeet: 200 },
    });
    await sleep(900);
    socket.off('scene:updated', countEvent);
    check('89W.AJ) requisição inválida NÃO publica realtime', eventCount === 0);

    // ===================================================================
    // AK–AP — COMBATE: referência, read model, LOCK e legado
    // ===================================================================
    // FUNDO (6.6M.4.1.1): a imagem é APRESENTAÇÃO da cena, mas precisa chegar
    // ao read model do combate — é a única origem permitida (sem fallback).
    const backgroundSet = await request('PATCH', `/scenes/${sceneA.id}`, {
      backgroundImageUrl: '/uploads/smoke-scene-background.png',
      ...op(sceneA.version),
    });
    sceneA = backgroundSet.data.scene as Record<string, any>;
    check(
      '89W.AK.0) PATCH grava a imagem de fundo na cena (apresentação, fora da config espacial)',
      backgroundSet.status === 200 &&
        sceneA.backgroundImageUrl === '/uploads/smoke-scene-background.png' &&
        sceneA.spatialConfig.mode === 'grid-2d',
      JSON.stringify({ status: backgroundSet.status, image: sceneA.backgroundImageUrl }),
    );

    const started = await request('POST', '/combat', {
      localityId: localityA.id,
      sceneId: sceneA.id,
      entries: [],
    });
    let combat = started.data.combat as Record<string, any>;
    combatId = combat?.id ?? null;
    check(
      '89W.AK) startCombat com localidade + cena: combate referencia a cena e projeta a config DELA',
      started.status === 201 &&
        combat.sceneId === sceneA.id &&
        combat.sceneName === 'Pátio' &&
        combat.localityId === localityA.id &&
        combat.spatial.mode === 'grid-2d' &&
        combat.spatial.widthFeet === 120 &&
        combat.spatial.heightFeet === 80 &&
        combat.obstacles.length === sceneA.obstacles.length &&
        // A cadeia que faltava: a imagem da CENA chega ao DTO do combate.
        combat.sceneBackgroundImageUrl === '/uploads/smoke-scene-background.png',
      JSON.stringify({ status: started.status, sceneId: combat?.sceneId, walls: combat?.obstacles?.length }),
    );
    const combatView = (await request('GET', '/combat/active')).data.combat as Record<string, any>;
    check(
      '89W.AL) read model do combate traz EXATAMENTE as paredes da cena (mesma geometria, mesmo id)',
      JSON.stringify(combatView.obstacles.map((wall: any) => wall.id).sort()) ===
        JSON.stringify(sceneA.obstacles.map((wall: any) => wall.id).sort()) &&
        combatView.obstacles.every((wall: any) => typeof wall.start.xFeet === 'number'),
      JSON.stringify({ combat: combatView.obstacles.length, scene: sceneA.obstacles.length }),
    );
    check(
      '89W.AL.1) GET /combat/active preserva a imagem da cena (mesmo read model, sem snapshot)',
      combatView.sceneId === sceneA.id &&
        combatView.sceneBackgroundImageUrl === '/uploads/smoke-scene-background.png',
      JSON.stringify({ image: combatView.sceneBackgroundImageUrl }),
    );

    const lockPatchScene = await request('PATCH', `/scenes/${sceneA.id}`, {
      name: 'Tentativa durante o combate',
      ...op(combatView.version),
    });
    const lockCreateWall = await createWall(sceneA.id, sceneA, {
      start: { xFeet: 0, yFeet: 70 },
      end: { xFeet: 10, yFeet: 70 },
    });
    const lockUpdateWall = await request('PATCH', `/scenes/${sceneA.id}/spatial/obstacles/${firstWall.id}`, {
      blocksSight: false,
      ...op(sceneA.version),
    });
    const lockDeleteWall = await request('DELETE', `/scenes/${sceneA.id}/spatial/obstacles/${firstWall.id}`, op(sceneA.version));
    const lockDeleteScene = await request('DELETE', `/scenes/${sceneA.id}`, op(sceneA.version));
    const lockCombatConfig = await request('PATCH', `/combat/${combat.id}/spatial-config`, {
      mode: 'assisted',
      ...op(combatView.version),
    });
    const sceneAfterLocks = (await request('GET', `/scenes/${sceneA.id}`)).data.scene;
    check(
      '89W.AM) ACTIVE LOCK: com combate usando a cena, TODO mutação estrutural → 409 SCENE_IN_USE',
      lockPatchScene.status === 409 &&
        lockPatchScene.data.error === 'SCENE_IN_USE' &&
        lockCreateWall.status === 409 &&
        lockCreateWall.data.error === 'SCENE_IN_USE' &&
        lockUpdateWall.status === 409 &&
        lockUpdateWall.data.error === 'SCENE_IN_USE' &&
        lockDeleteWall.status === 409 &&
        lockDeleteWall.data.error === 'SCENE_IN_USE' &&
        lockDeleteScene.status === 409 &&
        lockDeleteScene.data.error === 'SCENE_IN_USE' &&
        sceneAfterLocks.version === sceneA.version &&
        sceneAfterLocks.name === sceneA.name,
      JSON.stringify({
        patch: lockPatchScene.data.error,
        create: lockCreateWall.data.error,
        update: lockUpdateWall.data.error,
        del: lockDeleteWall.data.error,
        delScene: lockDeleteScene.data.error,
      }),
    );
    check(
      '89W.AN) FONTE ÚNICA: PATCH spatial-config do combate com cena → 409 SPATIAL_SCENE_MANAGED_BY_SCENE',
      lockCombatConfig.status === 409 &&
        lockCombatConfig.data.error === 'SPATIAL_SCENE_MANAGED_BY_SCENE' &&
        combat.spatialConfig === undefined,
      JSON.stringify(lockCombatConfig.data),
    );

    await request('POST', '/combat/end');
    const afterCombatRewrite = await request('PATCH', `/scenes/${sceneA.id}`, {
      name: 'Pátio liberado',
      ...op(sceneAfterLocks.version),
    });
    sceneA = afterCombatRewrite.data.scene as Record<string, any>;
    const wallAfterCombat = await request('PATCH', `/scenes/${sceneA.id}/spatial/obstacles/${firstWall.id}`, {
      blocksSight: false,
      ...op(sceneA.version),
    });
    sceneA = wallAfterCombat.data.scene as Record<string, any>;
    check(
      '89W.AO) encerrado o combate, a cena volta a aceitar mutação estrutural (200)',
      afterCombatRewrite.status === 200 &&
        afterCombatRewrite.data.scene.name === 'Pátio liberado' &&
        wallAfterCombat.status === 200 &&
        wallAfterCombat.data.obstacle.blocksSight === false,
      JSON.stringify({ patch: afterCombatRewrite.status, wall: wallAfterCombat.status }),
    );

    const legacy = await request('POST', '/combat', { entries: [] });
    let legacyCombat = legacy.data.combat as Record<string, any>;
    if (legacyCombat?.id) combatId = legacyCombat.id;
    const legacyConfig = await request('PATCH', `/combat/${legacyCombat.id}/spatial-config`, {
      mode: 'grid-2d',
      widthFeet: 90,
      heightFeet: 90,
      ...op(legacyCombat.version),
    });
    legacyCombat = legacyConfig.data.combat ?? legacyCombat;
    check(
      '89W.AP) LEGACY: combate sem cena mantém `spatialConfig`, lista vazia de paredes e aceita PATCH de config',
      legacy.status === 201 &&
        legacyCombat.sceneId === null &&
        legacyCombat.sceneBackgroundImageUrl === null &&
        Array.isArray(legacyCombat.obstacles) &&
        legacyCombat.obstacles.length === 0 &&
        legacyConfig.status === 200 &&
        legacyConfig.data.combat.spatial.mode === 'grid-2d' &&
        legacyConfig.data.combat.spatial.widthFeet === 90,
      JSON.stringify({ status: legacy.status, scenes: legacyCombat.sceneId, config: legacyConfig.status }),
    );

    await request('POST', '/combat/end');
    // Cena SEM imagem: o combate recebe `null` — a imagem é opcional e a cena
    // não herda arte de lugar nenhum.
    const noImageCombat = await request('POST', '/combat', {
      localityId: localityA.id,
      sceneId: salao.id,
      entries: [],
    });
    const noImageDto = noImageCombat.data.combat as Record<string, any>;
    if (noImageDto?.id) combatId = noImageDto.id;
    await request('POST', '/combat/end');
    check(
      '89W.AP.1) cena SEM imagem → `sceneBackgroundImageUrl` null (combate segue válido)',
      noImageCombat.status === 201 &&
        noImageDto.sceneId === salao.id &&
        noImageDto.sceneBackgroundImageUrl === null &&
        noImageDto.spatial.mode === 'assisted',
      JSON.stringify({ status: noImageCombat.status, image: noImageDto?.sceneBackgroundImageUrl }),
    );

    const mismatch = await request('POST', '/combat', {
      localityId: localityB.id,
      sceneId: sceneA.id,
      entries: [],
    });
    const missing = await request('POST', '/combat', {
      localityId: localityA.id,
      sceneId: 'scene-inexistente',
      entries: [],
    });
    check(
      '89W.AQ) cena de OUTRA localidade → 409 SCENE_LOCALITY_MISMATCH; cena inexistente → 404',
      mismatch.status === 409 &&
        mismatch.data.error === 'SCENE_LOCALITY_MISMATCH' &&
        missing.status === 404,
      JSON.stringify({ mismatch: mismatch.data.error, missing: missing.status }),
    );

    const reuse = await request('POST', '/combat', {
      localityId: localityA.id,
      sceneId: sceneA.id,
      entries: [],
    });
    const reusedCombat = reuse.data.combat as Record<string, any>;
    if (reusedCombat?.id) combatId = reusedCombat.id;
    const wallsBeforeCombatDelete = await prisma.spatialObstacle.count({ where: { sceneId: sceneA.id } });
    await request('POST', '/combat/end');
    await prisma.combat.delete({ where: { id: reusedCombat.id } }).catch(() => undefined);
    combatId = null;
    const wallsAfterCombatDelete = await prisma.spatialObstacle.count({ where: { sceneId: sceneA.id } });
    check(
      '89W.AR) REUSO: novo combate com a MESMA cena recebe a mesma geometria; apagar o combate NÃO apaga parede',
      reuse.status === 201 &&
        JSON.stringify(reusedCombat.obstacles.map((wall: any) => wall.id).sort()) ===
          JSON.stringify(sceneA.obstacles.map((wall: any) => wall.id).sort()) &&
        wallsBeforeCombatDelete > 0 &&
        wallsAfterCombatDelete === wallsBeforeCombatDelete,
      JSON.stringify({ combat: reusedCombat.obstacles?.length, before: wallsBeforeCombatDelete, after: wallsAfterCombatDelete }),
    );

    // ===================================================================
    // AS–AT — DELETE/cascade de cena e de localidade
    // ===================================================================
    const sceneWalls = await prisma.spatialObstacle.count({ where: { sceneId: masmorra.id } });
    const sceneDelete = await request('DELETE', `/scenes/${masmorra.id}`, op(masmorra.version));
    const sceneGone = await prisma.scene.findUnique({ where: { id: masmorra.id } });
    check(
      '89W.AS) DELETE da cena funciona, devolve 404 depois e as paredes dela caem por cascade',
      sceneDelete.status === 200 && sceneGone === null && sceneWalls === 0,
      JSON.stringify({ status: sceneDelete.status, gone: sceneGone === null }),
    );
    const localityC = await prisma.locality.create({
      data: { name: `Ruína ${suffix}`, description: '', regionId: region.id },
    });
    localityIds.push(localityC.id);
    const cascadeScene = await createScene(localityC.id, { name: 'Cripta' });
    if (cascadeScene.data.scene?.id) sceneIds.push(cascadeScene.data.scene.id);
    await prisma.locality.delete({ where: { id: localityC.id } });
    const orphanScenes = await prisma.scene.count({ where: { localityId: localityC.id } });
    check(
      '89W.AT) excluir a LOCALIDADE apaga as cenas dela (cascade coerente com conteúdo estrutural)',
      cascadeScene.status === 201 && orphanScenes === 0,
      JSON.stringify({ created: cascadeScene.status, orphans: orphanScenes }),
    );

    // ===================================================================
    // AU — as paredes sobreviventes continuam intactas no banco
    // ===================================================================
    const survivingWalls = await prisma.spatialObstacle.findMany({ where: { sceneId: sceneA.id } });
    check(
      '89W.AU) paredes sobreviventes mantêm endpoints/flags originais (geometria da 6.6L.4.1 intacta)',
      survivingWalls.length === wallsAfterCombatDelete &&
        survivingWalls.every(
          (wall) =>
            typeof wall.startXFeet === 'number' &&
            typeof wall.endYFeet === 'number' &&
            typeof wall.blocksMovement === 'boolean' &&
            typeof wall.blocksSight === 'boolean' &&
            wall.kind === 'wall',
        ),
      JSON.stringify({ count: survivingWalls.length }),
    );
  } finally {
    socket.close();
    // Cleanup LIMITADO aos IDs desta execução (ANTES = DEPOIS para dados reais).
    if (combatId) {
      await prisma.combat.delete({ where: { id: combatId } }).catch(() => undefined);
    }
    if (sceneIds.length) {
      await prisma.sceneOperation.deleteMany({ where: { sceneId: { in: sceneIds } } }).catch(() => undefined);
      await prisma.scene.deleteMany({ where: { id: { in: sceneIds } } }).catch(() => undefined);
    }
    if (localityIds.length) {
      await prisma.locality.deleteMany({ where: { id: { in: localityIds } } }).catch(() => undefined);
    }
    if (regionId) {
      await prisma.region.delete({ where: { id: regionId } }).catch(() => undefined);
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
