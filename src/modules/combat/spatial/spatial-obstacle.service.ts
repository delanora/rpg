import { HttpError } from '../../../lib/http-error.js';
import { loadCombatById, type CombatActor } from '../combat.service.js';
import { toCombatDto, type CombatDto } from '../combat.dto.js';
import {
  obstacleDtoOf,
  obstacleWithinScene,
  type SpatialObstacleDto,
  type SpatialObstacleShape,
} from './spatial-obstacle.js';
import { SPATIAL_GEOMETRY_EPSILON_FEET, segmentLengthFeet } from './spatial-geometry.js';
import { runSpatialOperation } from './spatial-scene.service.js';
import { spatialSceneOf, type SpatialPosition2D } from './spatial.types.js';

/**
 * FASE 6.6L.4.1 — CRUD DE OBSTÁCULOS ESPACIAIS (paredes). MASTER-only.
 *
 * Owner: o COMBATE (cena persistente). As paredes vivem junto de
 * `Combat.spatialConfig`, na mesma escala (PÉS), na mesma versão e no mesmo
 * `CombatOperation` — não existe segundo sistema de cena nem segundo controle
 * de concorrência.
 *
 * O que esta camada NÃO faz (intencional): não bloqueia movimento, não bloqueia
 * visão, não calcula Cover e não escolhe alvo de magia. Ela só guarda a
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
  expectedVersion: number;
  operationId: string;
}

export interface SpatialObstacleDeleteInput {
  expectedVersion: number;
  operationId: string;
}

function requireMaster(actor: CombatActor): void {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o mestre pode alterar as paredes da cena.', 403);
  }
}

/**
 * Validação geométrica AUTORITATIVA de uma parede contra a cena do combate.
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
 * Cria UMA parede na cena do combate.
 *
 * Reutiliza `runSpatialOperation`: `expectedVersion` + `operationId`, snapshot
 * por operação, versão do combate incrementada e `combat:updated` publicado
 * SOMENTE depois do commit. Retry idêntico devolve o MESMO snapshot (e a mesma
 * parede); a mesma `operationId` com outra geometria responde 409.
 */
export async function createSpatialObstacle(
  actor: CombatActor,
  combatId: string,
  input: SpatialObstacleCreateInput,
): Promise<{ combat: CombatDto; obstacle: SpatialObstacleDto }> {
  requireMaster(actor);
  const shape: SpatialObstacleShape = {
    start: input.start,
    end: input.end,
    blocksMovement: input.blocksMovement,
    blocksSight: input.blocksSight,
  };
  return runSpatialOperation(
    actor,
    {
      combatId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      obstacle: shape,
    },
    'spatial-obstacle-create',
    async (db, combat) => {
      assertValidWall(shape, spatialSceneOf(combat.spatialConfig));
      const created = await db.spatialObstacle.create({
        data: {
          combatId: combat.id,
          kind: 'wall',
          startXFeet: shape.start.xFeet,
          startYFeet: shape.start.yFeet,
          endXFeet: shape.end.xFeet,
          endYFeet: shape.end.yFeet,
          blocksMovement: shape.blocksMovement,
          blocksSight: shape.blocksSight,
        },
      });
      return {
        combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
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
  actor: CombatActor,
  combatId: string,
  obstacleId: string,
  input: SpatialObstaclePatchInput,
): Promise<{ combat: CombatDto; obstacle: SpatialObstacleDto }> {
  requireMaster(actor);
  return runSpatialOperation(
    actor,
    {
      combatId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      obstacleId,
      // Só os campos ENVIADOS entram no fingerprint (`undefined` é descartado).
      obstacle: {
        start: input.start,
        end: input.end,
        blocksMovement: input.blocksMovement,
        blocksSight: input.blocksSight,
      },
    },
    'spatial-obstacle-update',
    async (db, combat) => {
      const existing = await db.spatialObstacle.findFirst({
        where: { id: obstacleId, combatId: combat.id },
      });
      if (!existing) throw new HttpError('Parede não encontrada neste combate.', 404);
      const merged: SpatialObstacleShape = {
        start: input.start ?? { xFeet: existing.startXFeet, yFeet: existing.startYFeet },
        end: input.end ?? { xFeet: existing.endXFeet, yFeet: existing.endYFeet },
        blocksMovement: input.blocksMovement ?? existing.blocksMovement,
        blocksSight: input.blocksSight ?? existing.blocksSight,
      };
      assertValidWall(merged, spatialSceneOf(combat.spatialConfig));
      const updated = await db.spatialObstacle.update({
        where: { id: existing.id },
        data: {
          startXFeet: merged.start.xFeet,
          startYFeet: merged.start.yFeet,
          endXFeet: merged.end.xFeet,
          endYFeet: merged.end.yFeet,
          blocksMovement: merged.blocksMovement,
          blocksSight: merged.blocksSight,
        },
      });
      return {
        combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
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
  actor: CombatActor,
  combatId: string,
  obstacleId: string,
  input: SpatialObstacleDeleteInput,
): Promise<{ combat: CombatDto }> {
  requireMaster(actor);
  return runSpatialOperation(
    actor,
    {
      combatId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      obstacleId,
    },
    'spatial-obstacle-delete',
    async (db, combat) => {
      const removed = await db.spatialObstacle.deleteMany({
        where: { id: obstacleId, combatId: combat.id },
      });
      if (removed.count !== 1) throw new HttpError('Parede não encontrada neste combate.', 404);
      return { combat: toCombatDto(await loadCombatById(combat.id, db), actor.role) };
    },
  );
}
