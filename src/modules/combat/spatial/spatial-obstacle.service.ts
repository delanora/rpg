import type { CoverLevel } from '../cover.js';
import { HttpError } from '../../../lib/http-error.js';
import {
  loadSceneById,
  runSceneOperation,
  type SceneActor,
} from '../../scenes/scenes.service.js';
import { toSceneDto, type SceneDto } from '../../scenes/scenes.dto.js';
import {
  coverLevelOf,
  obstacleDtoOf,
  obstacleWithinScene,
  type SpatialObstacleDto,
  type SpatialObstacleShape,
} from './spatial-obstacle.js';
import { SPATIAL_GEOMETRY_EPSILON_FEET, segmentLengthFeet } from './spatial-geometry.js';
import { spatialSceneOf, type SpatialPosition2D } from './spatial.types.js';

/**
 * FASE 6.6L.4.1 — CRUD DE OBSTÁCULOS ESPACIAIS (paredes). MASTER-only.
 *
 * OWNER (6.6L.4.1.1): a CENA da localidade, não o combate. A geometria criada
 * na 6.6L.4.1 permanece intacta (kind, endpoints em PÉS, flags independentes,
 * bounds e classificação de segmentos); o que mudou foi só o dono estrutural e
 * a rota. A versão/idempotência são as da CENA (`SceneOperation`) — um combate
 * que usa a cena apenas PROJETA essa geometria.
 *
 * Cena em uso por combate não terminado é congelada: qualquer escrita responde
 * 409 `SCENE_IN_USE` (o lock mora em `runSceneOperation`).
 *
 * O que esta camada NÃO faz (intencional): não bloqueia movimento, não bloqueia
 * visão, não resolve ataques e não escolhe alvo de magia. Ela só guarda a
 * geometria autoritativa para que essas engines a consumam depois.
 */

export interface SpatialObstacleCreateInput extends SpatialObstacleShape {
  expectedVersion: number;
  operationId: string;
}

export interface SpatialObstaclePatchInput {
  start?: SpatialPosition2D;
  end?: SpatialPosition2D;
  blocksMovement?: boolean;
  blocksSight?: boolean;
  blocksTargeting?: boolean;
  coverLevel?: CoverLevel;
  expectedVersion: number;
  operationId: string;
}

export interface SpatialObstacleDeleteInput {
  expectedVersion: number;
  operationId: string;
}

/** Evita duas instruções contraditórias na mesma intenção de edição. */
function assertCoverSettings(input: { coverLevel?: CoverLevel; blocksTargeting?: boolean }): void {
  if (input.coverLevel !== undefined && input.blocksTargeting !== undefined &&
      input.blocksTargeting !== (input.coverLevel === 'total')) {
    throw new HttpError('O bloqueio de ataques deve corresponder à cobertura total.', 400, 'VALIDATION_ERROR');
  }
}

/**
 * Validação geométrica AUTORITATIVA de uma parede contra a cena dona.
 *
 * Nunca corrige nem arredonda coordenada: dados inválidos são RECUSADOS (o
 * cliente não tem permissão para inventar uma parede diferente da pedida).
 * `NaN`/`Infinity`/texto já caem antes, na validação Zod do payload.
 */
function assertValidWall(shape: SpatialObstacleShape, scene: ReturnType<typeof spatialSceneOf>): void {
  if (!obstacleWithinScene(shape, scene)) {
    throw new HttpError(
      'A parede precisa ficar dentro dos limites da cena.',
      400,
      'SPATIAL_OBSTACLE_OUT_OF_BOUNDS',
    );
  }
  if (segmentLengthFeet(shape) <= SPATIAL_GEOMETRY_EPSILON_FEET) {
    throw new HttpError(
      'Uma parede não pode começar e terminar no mesmo ponto.',
      400,
      'SPATIAL_OBSTACLE_DEGENERATE',
    );
  }
}

/**
 * Cria UMA parede na cena.
 *
 * Retry idêntico devolve o MESMO snapshot (e a mesma parede); a mesma
 * `operationId` com outra geometria responde 409. O evento `scene:updated`
 * (sala dos mestres) sai somente depois do commit.
 */
export async function createSpatialObstacle(
  actor: SceneActor,
  sceneId: string,
  input: SpatialObstacleCreateInput,
): Promise<{ scene: SceneDto; obstacle: SpatialObstacleDto }> {
  assertCoverSettings(input);
  const shape: SpatialObstacleShape = {
    start: input.start,
    end: input.end,
    blocksMovement: input.blocksMovement,
    blocksSight: input.blocksSight,
    ...(input.blocksTargeting === undefined ? {} : { blocksTargeting: input.blocksTargeting }),
    ...(input.coverLevel === undefined ? {} : { coverLevel: input.coverLevel }),
  };
  return runSceneOperation(
    actor,
    {
      sceneId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      obstacle: shape,
    },
    'spatial-obstacle-create',
    async (db, scene) => {
      assertValidWall(shape, spatialSceneOf(scene.spatialConfig));
      const created = await db.spatialObstacle.create({
        data: {
          sceneId: scene.id,
          kind: 'wall',
          startXFeet: shape.start.xFeet,
          startYFeet: shape.start.yFeet,
          endXFeet: shape.end.xFeet,
          endYFeet: shape.end.yFeet,
          blocksMovement: shape.blocksMovement,
          blocksSight: shape.blocksSight,
          blocksTargeting: coverLevelOf({ ...shape, blocksTargeting: shape.blocksTargeting ?? true }) === 'total',
          coverLevel: coverLevelOf({ ...shape, blocksTargeting: shape.blocksTargeting ?? true }),
        },
      });
      return {
        scene: toSceneDto(await loadSceneById(scene.id, db)),
        obstacle: obstacleDtoOf(created),
      };
    },
  );
}

/**
 * Atualiza endpoints e/ou FLAGS de UMA parede. Campos ausentes não mudam.
 *
 * A geometria resultante (mesclada) é revalidada por inteiro: mover só um
 * endpoint para fora da cena — ou deixar início = fim — é recusado com 400.
 * `blocksMovement` e `blocksSight` são INDEPENDENTES.
 */
export async function updateSpatialObstacle(
  actor: SceneActor,
  sceneId: string,
  obstacleId: string,
  input: SpatialObstaclePatchInput,
): Promise<{ scene: SceneDto; obstacle: SpatialObstacleDto }> {
  assertCoverSettings(input);
  return runSceneOperation(
    actor,
    {
      sceneId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      obstacleId,
      // Só os campos ENVIADOS entram no fingerprint (`undefined` é descartado).
      obstacle: {
        start: input.start,
        end: input.end,
        blocksMovement: input.blocksMovement,
        blocksSight: input.blocksSight,
        ...(input.blocksTargeting === undefined ? {} : { blocksTargeting: input.blocksTargeting }),
        ...(input.coverLevel === undefined ? {} : { coverLevel: input.coverLevel }),
      },
    },
    'spatial-obstacle-update',
    async (db, scene) => {
      const existing = await db.spatialObstacle.findFirst({
        where: { id: obstacleId, sceneId: scene.id },
      });
      if (!existing) throw new HttpError('Parede não encontrada nesta cena.', 404);
      const merged: SpatialObstacleShape = {
        start: input.start ?? { xFeet: existing.startXFeet, yFeet: existing.startYFeet },
        end: input.end ?? { xFeet: existing.endXFeet, yFeet: existing.endYFeet },
        blocksMovement: input.blocksMovement ?? existing.blocksMovement,
        blocksSight: input.blocksSight ?? existing.blocksSight,
        blocksTargeting: input.blocksTargeting ?? existing.blocksTargeting,
        coverLevel: input.coverLevel ?? (input.blocksTargeting === undefined ? coverLevelOf(existing) : input.blocksTargeting ? 'total' : 'none'),
      };
      assertValidWall(merged, spatialSceneOf(scene.spatialConfig));
      const updated = await db.spatialObstacle.update({
        where: { id: existing.id },
        data: {
          startXFeet: merged.start.xFeet,
          startYFeet: merged.start.yFeet,
          endXFeet: merged.end.xFeet,
          endYFeet: merged.end.yFeet,
          blocksMovement: merged.blocksMovement,
          blocksSight: merged.blocksSight,
          blocksTargeting: coverLevelOf(merged) === 'total',
          coverLevel: coverLevelOf(merged),
        },
      });
      return {
        scene: toSceneDto(await loadSceneById(scene.id, db)),
        obstacle: obstacleDtoOf(updated),
      };
    },
  );
}

/**
 * Remove UMA parede da cena. Idempotência pelo `operationId`: repetir a MESMA
 * operação devolve o snapshot antigo (200); uma operação NOVA numa parede já
 * removida responde 404 — nunca um sucesso silencioso de algo que não existe.
 */
export async function deleteSpatialObstacle(
  actor: SceneActor,
  sceneId: string,
  obstacleId: string,
  input: SpatialObstacleDeleteInput,
): Promise<{ scene: SceneDto }> {
  return runSceneOperation(
    actor,
    {
      sceneId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      obstacleId,
    },
    'spatial-obstacle-delete',
    async (db, scene) => {
      const removed = await db.spatialObstacle.deleteMany({
        where: { id: obstacleId, sceneId: scene.id },
      });
      if (removed.count !== 1) throw new HttpError('Parede não encontrada nesta cena.', 404);
      return { scene: toSceneDto(await loadSceneById(scene.id, db)) };
    },
  );
}


/** Cria todos os segmentos de um traçado com UMA versão e UMA chave de operação. */
export async function createSpatialObstacles(
  actor: SceneActor, sceneId: string,
  input: { walls: SpatialObstacleShape[]; expectedVersion: number; operationId: string },
): Promise<{ scene: SceneDto }> {
  return runSceneOperation(actor, {
    sceneId, expectedVersion: input.expectedVersion, operationId: input.operationId, obstacles: input.walls,
  }, 'spatial-obstacle-batch-create', async (db, scene) => {
    const config = spatialSceneOf(scene.spatialConfig);
    for (const wall of input.walls) { assertCoverSettings(wall); assertValidWall(wall, config); }
    await db.spatialObstacle.createMany({ data: input.walls.map(wall => ({
      sceneId, kind: 'wall', startXFeet: wall.start.xFeet, startYFeet: wall.start.yFeet,
      endXFeet: wall.end.xFeet, endYFeet: wall.end.yFeet,
      blocksMovement: wall.blocksMovement, blocksSight: wall.blocksSight, blocksTargeting: coverLevelOf({ ...wall, blocksTargeting: wall.blocksTargeting ?? true }) === 'total',
      coverLevel: coverLevelOf({ ...wall, blocksTargeting: wall.blocksTargeting ?? true }),
    })) });
    return { scene: toSceneDto(await loadSceneById(sceneId, db)) };
  });
}
