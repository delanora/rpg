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
 * FASE 6.6L.4.1 — SPATIAL OBSTACLES / WALLS FOUNDATION.
 *
 * Prova a fundação de paredes/obstáculos lineares da cena:
 *  • geometria PURA de segmentos, com política única de epsilon em PÉS;
 *  • classificação `none` / `cross` / `touch` / `overlap` (nunca só boolean);
 *  • primitivas puras (simetria, inversão de endpoints, diagonais, 2,5 pés);
 *  • owner = o COMBATE (cena persistente), endpoints em PÉS, nada de pixels;
 *  • MASTER cria/edita/remove; PLAYER só LÊ a projeção;
 *  • validação server-side (bounds da cena, comprimento zero, NaN/texto);
 *  • versão/idempotência/concorrência e realtime REUTILIZADOS do combate;
 *  • NADA de bloqueio de movimento/LoS nesta fase (provider existe, integração
 *    fica para quando a colisão por footprint tiver semântica fechada).
 */
export async function smokeSpatialWalls(baseUrl: string, check: Check): Promise<void> {
  console.log('\n89W) Fase 6.6L.4.1 — Spatial Obstacles / Walls Foundation');

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
      // Cruzamento real precisa de INTERIORES: começar/terminar em cima da linha
      // é `touch` (junção em T), não `cross`.
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
      // Trecho que passa ANTES do fim da parede não é bloqueado.
      !movementSegmentBlocked({ xFeet: 0, yFeet: 25 }, { xFeet: 20, yFeet: 25 }, [solidWall]) &&
      !movementSegmentBlocked({ xFeet: 5, yFeet: 5 }, { xFeet: 5, yFeet: 5 }, [solidWall]),
  );

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  let combatId: string | null = null;
  const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'] });

  try {
    // ===================================================================
    // FIXTURES (contas e combate PRÓPRIOS; nenhum dado real é tocado)
    // ===================================================================
    const master = await prisma.user.create({
      data: {
        username: `wall_m_${suffix}`,
        displayName: 'Mestre Paredes',
        passwordHash: 'fixture',
        role: 'MASTER',
      },
    });
    const player = await prisma.user.create({
      data: {
        username: `wall_p_${suffix}`,
        displayName: 'Jogador Paredes',
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

    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        round: 1,
        currentIndex: 0,
        turnSequence: 1,
        spatialConfig: { mode: 'grid-2d', widthFeet: 120, heightFeet: 80, cellSizeFeet: 5 },
      },
    });
    combatId = combat.id;

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

    let state = (await request('GET', '/combat/active')).data.combat as Record<string, any>;
    const operation = () => ({ expectedVersion: state.version, operationId: randomUUID() });
    const wallsPath = `/combat/${combat.id}/spatial/obstacles`;
    const axis = (point: unknown) => point as { xFeet: number; yFeet: number };

    async function createWall(
      body: Record<string, unknown>,
      auth: string = masterToken,
      extra: Record<string, unknown> = {},
    ): Promise<HttpResult> {
      const response = await request('POST', wallsPath, { ...operation(), ...body, ...extra }, auth);
      if (response.data.combat) state = response.data.combat;
      return response;
    }

    // ===================================================================
    // N–R — READ MODEL, CREATE, FLAGS e AUTORIZAÇÃO
    // ===================================================================
    check(
      '89W.N) a cena começa SEM paredes, `spatial` continua a CONFIG (4 campos) e as paredes são read model à parte',
      state.id === combat.id &&
        Array.isArray(state.obstacles) &&
        state.obstacles.length === 0 &&
        Object.keys(state.spatial).sort().join(',') === 'cellSizeFeet,heightFeet,mode,widthFeet',
      JSON.stringify({ id: state.id, obstacles: state.obstacles }),
    );
    const created = await createWall({
      start: { xFeet: 10, yFeet: 10 },
      end: { xFeet: 40, yFeet: 10 },
    });
    const firstWall = created.data.obstacle as Record<string, any>;
    check(
      '89W.O) MASTER cria PAREDE em PÉS: endpoints persistidos, comprimento derivado e flags default',
      created.status === 200 &&
        firstWall.kind === 'wall' &&
        axis(firstWall.start).xFeet === 10 &&
        axis(firstWall.end).xFeet === 40 &&
        firstWall.lengthFeet === 30 &&
        firstWall.blocksMovement === true &&
        firstWall.blocksSight === true &&
        created.data.combat.obstacles.some((wall: any) => wall.id === firstWall.id),
      JSON.stringify({ status: created.status, data: created.data }),
    );
    check(
      '89W.P) a projeção da parede tem EXATAMENTE os campos previstos (sem vazar auditoria)',
      JSON.stringify(Object.keys(firstWall).sort()) ===
        JSON.stringify(
          ['blocksMovement', 'blocksSight', 'end', 'id', 'kind', 'lengthFeet', 'start'].sort(),
        ),
      JSON.stringify(firstWall),
    );
    const barrier = await createWall({
      start: { xFeet: 0, yFeet: 40 },
      end: { xFeet: 40, yFeet: 40 },
      blocksMovement: true,
      blocksSight: false,
    });
    check(
      '89W.Q) blocksMovement e blocksSight são INDEPENDENTES (barreira invisível)',
      barrier.status === 200 &&
        barrier.data.obstacle.blocksMovement === true &&
        barrier.data.obstacle.blocksSight === false,
      JSON.stringify(barrier.data.obstacle),
    );
    const wallId = firstWall.id as string;
    const playerCreate = await createWall(
      { start: { xFeet: 0, yFeet: 0 }, end: { xFeet: 5, yFeet: 0 } },
      playerToken,
    );
    const playerUpdate = await request(
      'PATCH',
      `${wallsPath}/${wallId}`,
      { end: { xFeet: 50, yFeet: 10 }, ...operation() },
      playerToken,
    );
    const playerDelete = await request(
      'DELETE',
      `${wallsPath}/${wallId}`,
      operation(),
      playerToken,
    );
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '89W.R) PLAYER não cria, não edita e não remove parede (403 nas três rotas)',
      playerCreate.status === 403 &&
        playerUpdate.status === 403 &&
        playerDelete.status === 403 &&
        state.obstacles.length === 2 &&
        state.obstacles.find((wall: any) => wall.id === wallId).end.xFeet === 40,
      JSON.stringify({ create: playerCreate.status, update: playerUpdate.status, delete: playerDelete.status }),
    );

    // ===================================================================
    // S–V — VALIDAÇÃO SERVER-SIDE: comprimento zero, bounds, payload
    // ===================================================================
    const degenerate = await createWall({
      start: { xFeet: 20, yFeet: 20 },
      end: { xFeet: 20, yFeet: 20 },
    });
    check(
      '89W.S) início = fim é RECUSADO (400 SPATIAL_OBSTACLE_DEGENERATE)',
      degenerate.status === 400 && degenerate.data.error === 'SPATIAL_OBSTACLE_DEGENERATE',
      JSON.stringify({ status: degenerate.status, data: degenerate.data }),
    );
    const outOfBounds = await createWall({
      start: { xFeet: 100, yFeet: 10 },
      end: { xFeet: 120.5, yFeet: 10 },
    });
    const negative = await createWall({
      start: { xFeet: -2.5, yFeet: 10 },
      end: { xFeet: 10, yFeet: 10 },
    });
    check(
      '89W.T) fora dos limites é RECUSADO (400 OUT_OF_BOUNDS) e coordenada negativa é 400 já no Zod — nada é corrigido',
      outOfBounds.status === 400 &&
        outOfBounds.data.error === 'SPATIAL_OBSTACLE_OUT_OF_BOUNDS' &&
        negative.status === 400 &&
        negative.data.error === 'VALIDATION_ERROR',
      JSON.stringify({ outOfBounds: outOfBounds.data, negative: negative.data }),
    );
    const invalidPayloads = await Promise.all([
      createWall({ start: { xFeet: '10', yFeet: 0 }, end: { xFeet: 20, yFeet: 0 } }),
      createWall({
        start: { xFeet: 10, yFeet: 0 },
        end: { xFeet: 20, yFeet: 0 },
        occupiedSpace: { minXFeet: 0 },
      }),
      createWall({ start: { xFeet: 10, yFeet: 0 }, end: { xFeet: 20, yFeet: 0 }, kind: 'door' }),
    ]);
    check(
      '89W.U) payload inválido é 400: texto no lugar de número, campo extra e kind fora do primitive',
      invalidPayloads.every((row) => row.status === 400 && row.data.error === 'VALIDATION_ERROR'),
      JSON.stringify(invalidPayloads.map((row) => [row.status, row.data.error])),
    );
    const unknownOwner = await request('POST', '/combat/combat-inexistente/spatial/obstacles', {
      start: { xFeet: 0, yFeet: 0 },
      end: { xFeet: 10, yFeet: 0 },
      expectedVersion: 0,
      operationId: randomUUID(),
    });
    check(
      '89W.V) owner inexistente responde 404 (nunca cria geometria órfã)',
      unknownOwner.status === 404,
      JSON.stringify({ status: unknownOwner.status, data: unknownOwner.data }),
    );

    // ===================================================================
    // W–Z — BORDAS, DIAGONAL 2,5 PÉS, UPDATE de endpoints e flags
    // ===================================================================
    const borderTop = await createWall({
      start: { xFeet: 0, yFeet: 0 },
      end: { xFeet: 0, yFeet: 80 },
    });
    const borderCorner = await createWall({
      start: { xFeet: 120, yFeet: 80 },
      end: { xFeet: 100, yFeet: 80 },
    });
    check(
      '89W.W) BORDA exata é válida: origem (0,0), altura máxima (80) e canto (120,80)',
      borderTop.status === 200 &&
        borderTop.data.obstacle.lengthFeet === 80 &&
        borderCorner.status === 200 &&
        axis(borderCorner.data.obstacle.start).xFeet === 120 &&
        axis(borderCorner.data.obstacle.start).yFeet === 80,
      JSON.stringify({ borderTop: borderTop.status, borderCorner: borderCorner.status }),
    );
    const diagonal = await createWall({
      start: { xFeet: 2.5, yFeet: 2.5 },
      end: { xFeet: 12.5, yFeet: 7.5 },
    });
    check(
      '89W.X) DIAGONAL com 2,5 pés persiste exatamente (sem arredondar para múltiplos de 5)',
      diagonal.status === 200 &&
        axis(diagonal.data.obstacle.start).xFeet === 2.5 &&
        axis(diagonal.data.obstacle.start).yFeet === 2.5 &&
        axis(diagonal.data.obstacle.end).xFeet === 12.5 &&
        diagonal.data.obstacle.lengthFeet === 11.18,
      JSON.stringify(diagonal.data.obstacle),
    );
    const movedWall = await request('PATCH', `${wallsPath}/${wallId}`, {
      start: { xFeet: 10, yFeet: 20 },
      end: { xFeet: 40, yFeet: 20 },
      ...operation(),
    });
    state = movedWall.data.combat ?? state;
    check(
      '89W.Y) UPDATE de endpoints persiste e o comprimento derivado acompanha',
      movedWall.status === 200 &&
        axis(movedWall.data.obstacle.start).yFeet === 20 &&
        axis(movedWall.data.obstacle.end).yFeet === 20 &&
        movedWall.data.obstacle.lengthFeet === 30 &&
        state.obstacles.find((wall: any) => wall.id === wallId).start.yFeet === 20,
      JSON.stringify({ status: movedWall.status, obstacle: movedWall.data.obstacle }),
    );
    const flagsOnly = await request('PATCH', `${wallsPath}/${wallId}`, {
      blocksMovement: false,
      ...operation(),
    });
    state = flagsOnly.data.combat ?? state;
    check(
      '89W.Z) UPDATE de flags não muda a geometria e mantém as duas flags independentes',
      flagsOnly.status === 200 &&
        flagsOnly.data.obstacle.blocksMovement === false &&
        flagsOnly.data.obstacle.blocksSight === true &&
        axis(flagsOnly.data.obstacle.start).xFeet === 10 &&
        flagsOnly.data.obstacle.lengthFeet === 30,
      JSON.stringify(flagsOnly.data.obstacle),
    );

    // ===================================================================
    // AA–AD — IDEMPOTÊNCIA, CONCORRÊNCIA e VERSÃO (as do combate)
    // ===================================================================
    const createOperation = randomUUID();
    const createBody = {
      start: { xFeet: 60, yFeet: 60 },
      end: { xFeet: 90, yFeet: 60 },
      expectedVersion: state.version,
      operationId: createOperation,
    };
    const createdOnce = await request('POST', wallsPath, createBody);
    const createdAgain = await request('POST', wallsPath, createBody);
    check(
      '89W.AA) retry idêntico devolve a MESMA parede e a MESMA versão (sem duplicar)',
      createdOnce.status === 200 &&
        createdAgain.status === 200 &&
        createdAgain.data.combat.version === createdOnce.data.combat.version &&
        createdOnce.data.obstacle.id === createdAgain.data.obstacle.id &&
        createdOnce.data.combat.obstacles.filter(
          (wall: any) => axis(wall.start).xFeet === 60 && axis(wall.start).yFeet === 60,
        ).length === 1,
      JSON.stringify({
        first: createdOnce.status,
        retry: createdAgain.status,
        versions: [createdOnce.data.combat?.version, createdAgain.data.combat?.version],
      }),
    );
    state = createdOnce.data.combat;
    const reusedKey = await request('POST', wallsPath, {
      ...createBody,
      end: { xFeet: 90, yFeet: 70 },
    });
    check(
      '89W.AB) mesma operationId com outra geometria → 409 IDEMPOTENCY_KEY_REUSED',
      reusedKey.status === 409 && reusedKey.data.error === 'IDEMPOTENCY_KEY_REUSED',
      JSON.stringify({ status: reusedKey.status, data: reusedKey.data }),
    );
    const staleVersion = await request('POST', wallsPath, {
      start: { xFeet: 70, yFeet: 20 },
      end: { xFeet: 80, yFeet: 20 },
      expectedVersion: state.version - 1,
      operationId: randomUUID(),
    });
    check('89W.AC) expectedVersion velho → 409 CONFLICT (nunca last-write-wins)', staleVersion.status === 409);
    const beforeRace = state.obstacles.length;
    const concurrentWalls = await Promise.all([
      request('POST', wallsPath, {
        start: { xFeet: 100, yFeet: 20 },
        end: { xFeet: 110, yFeet: 20 },
        expectedVersion: state.version,
        operationId: randomUUID(),
      }),
      request('POST', wallsPath, {
        start: { xFeet: 100, yFeet: 30 },
        end: { xFeet: 110, yFeet: 30 },
        expectedVersion: state.version,
        operationId: randomUUID(),
      }),
    ]);
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '89W.AD) duas criações concorrentes: UMA vence, a outra recebe 409',
      concurrentWalls.filter((row) => row.status === 200).length === 1 &&
        concurrentWalls.filter((row) => row.status === 409).length === 1 &&
        state.obstacles.length === beforeRace + 1,
      JSON.stringify(concurrentWalls.map((row) => row.status)),
    );

    // ===================================================================
    // AE–AG — RELOAD, RESIZE da cena e REALTIME
    // ===================================================================
    check(
      '89W.AE) RELOAD mantém todas as paredes com endpoints e flags originais',
      state.obstacles.length === beforeRace + 1 &&
        state.obstacles.every(
          (wall: any) =>
            typeof axis(wall.start).xFeet === 'number' &&
            typeof axis(wall.end).yFeet === 'number' &&
            typeof wall.blocksMovement === 'boolean' &&
            typeof wall.blocksSight === 'boolean',
        ),
      JSON.stringify(state.obstacles.map((wall: any) => wall.id)),
    );
    const shrink = await request('PATCH', `/combat/${combat.id}/spatial-config`, {
      mode: 'grid-2d',
      widthFeet: 40,
      heightFeet: 40,
      ...operation(),
    });
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '89W.AF) reduzir a cena com parede fora dos novos limites → 409 e nada muda',
      shrink.status === 409 &&
        shrink.data.error === 'SPATIAL_SCENE_RESIZE_CONFLICT' &&
        state.spatial.widthFeet === 120 &&
        state.obstacles.some((wall: any) => axis(wall.start).xFeet === 100),
      JSON.stringify({ status: shrink.status, data: shrink.data }),
    );
    socket.auth = { token: masterToken };
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    const beforeEvent = state.version;
    const obstaclesBeforeEvent = state.obstacles.length;
    const wallEvent = new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      const handler = (payload: any) => {
        if (payload?.combat?.version > beforeEvent) {
          clearTimeout(timer);
          socket.off('combat:updated', handler);
          resolve(payload);
        }
      };
      socket.on('combat:updated', handler);
    });
    await createWall({ start: { xFeet: 20, yFeet: 60 }, end: { xFeet: 50, yFeet: 60 } });
    const eventPayload = await wallEvent;
    check(
      '89W.AG) mudança de parede publica combat:updated DEPOIS do commit, com a parede nova',
      Boolean(eventPayload) &&
        eventPayload!.combat.obstacles.length === obstaclesBeforeEvent + 1,
      JSON.stringify(eventPayload ? eventPayload.combat.obstacles.length : null),
    );
    let eventCount = 0;
    const countEvent = () => {
      eventCount += 1;
    };
    socket.on('combat:updated', countEvent);
    await createWall({ start: { xFeet: 200, yFeet: 200 }, end: { xFeet: 210, yFeet: 200 } });
    await sleep(900);
    socket.off('combat:updated', countEvent);
    check('89W.AH) requisição inválida NÃO publica realtime', eventCount === 0);

    // ===================================================================
    // AI–AK — DELETE, projeção do JOGADOR e cascade
    // ===================================================================
    const deleteOperation = randomUUID();
    const deleteBody = { expectedVersion: state.version, operationId: deleteOperation };
    const removed = await request('DELETE', `${wallsPath}/${wallId}`, deleteBody);
    state = removed.data.combat ?? state;
    const deleteRetry = await request('DELETE', `${wallsPath}/${wallId}`, deleteBody);
    const deleteMissing = await request('DELETE', `${wallsPath}/${wallId}`, {
      expectedVersion: state.version,
      operationId: randomUUID(),
    });
    check(
      '89W.AI) DELETE remove só a parede alvo; retry é replay (200) e operação nova é 404',
      removed.status === 200 &&
        !state.obstacles.some((wall: any) => wall.id === wallId) &&
        deleteRetry.status === 200 &&
        deleteMissing.status === 404 &&
        state.obstacles.some((wall: any) => wall.id === barrier.data.obstacle.id),
      JSON.stringify({
        removed: removed.status,
        retry: deleteRetry.status,
        missing: deleteMissing.status,
      }),
    );
    const masterWalls = (await request('GET', '/combat/active')).data.combat.obstacles;
    const playerView = (await request('GET', '/combat/active', undefined, playerToken)).data
      .combat as Record<string, any>;
    check(
      '89W.AJ) PLAYER recebe a PROJEÇÃO da cena (paredes visíveis), sem poder mutar',
      Array.isArray(playerView.obstacles) &&
        playerView.obstacles.length === masterWalls.length &&
        JSON.stringify(playerView.obstacles.map((wall: any) => wall.id).sort()) ===
          JSON.stringify(masterWalls.map((wall: any) => wall.id).sort()),
      JSON.stringify({ master: masterWalls.length, player: playerView.obstacles?.length }),
    );
    const wallsInDatabase = await prisma.spatialObstacle.count({ where: { combatId: combat.id } });
    await prisma.combat.delete({ where: { id: combat.id } });
    const orphans = await prisma.spatialObstacle.count({ where: { combatId: combat.id } });
    combatId = null;
    check(
      '89W.AK) apagar o combate remove as paredes junto (FK em cascata, sem órfão)',
      wallsInDatabase > 0 && orphans === 0,
      JSON.stringify({ before: wallsInDatabase, after: orphans }),
    );
  } finally {
    socket.close();
    // Cleanup LIMITADO aos IDs desta execução.
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } }).catch(() => undefined);
      await prisma.combat.delete({ where: { id: combatId } }).catch(() => undefined);
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
