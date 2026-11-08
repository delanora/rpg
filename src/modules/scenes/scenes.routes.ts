import { Router, type Request, type Response } from 'express';
import { HttpError } from '../../lib/http-error.js';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createSpatialObstacle,
  createSpatialObstacles,
  deleteSpatialObstacle,
  updateSpatialObstacle,
} from '../combat/spatial/spatial-obstacle.service.js';
import {
  createSceneSchema,
  deleteSceneSchema,
  spatialObstacleCreateSchema,
  spatialObstacleBatchSchema,
  spatialObstacleDeleteSchema,
  spatialObstaclePatchSchema,
  updateSceneSchema,
} from './scenes.schema.js';
import {
  createScene,
  deleteScene,
  getScene,
  listScenes,
  updateScene,
  type SceneActor,
} from './scenes.service.js';

/**
 * FASE 6.6L.4.1.1 — API de CENA ESPACIAL (MASTER-only).
 *
 *   GET    /api/localities/:localityId/scenes
 *   POST   /api/localities/:localityId/scenes
 *   GET    /api/scenes/:sceneId
 *   PATCH  /api/scenes/:sceneId
 *   DELETE /api/scenes/:sceneId
 *   POST   /api/scenes/:sceneId/spatial/obstacles
 *   PATCH  /api/scenes/:sceneId/spatial/obstacles/:obstacleId
 *   DELETE /api/scenes/:sceneId/spatial/obstacles/:obstacleId
 *
 * As rotas de parede que existiam sob `/api/combat/:combatId` foram REMOVIDAS
 * (ownership estrutural agora é da cena) — não havia consumidor visual. O
 * combate continua entregando `spatial`/`obstacles` como PROJEÇÃO da cena.
 *
 * PLAYER não administra cena: o `requireRole('MASTER')` está no router, então
 * não existe caminho alternativo de escrita para jogador.
 */

export const scenesRouter = Router();

/** Rotas aninhadas na localidade (montadas em `/api/localities`). */
export const localityScenesRouter = Router();

scenesRouter.use(authenticate, requireRole('MASTER'));
localityScenesRouter.use(authenticate, requireRole('MASTER'));

function actorFrom(req: Request): SceneActor {
  if (!req.user) throw new HttpError('Sessão inválida.', 401, 'UNAUTHORIZED');
  return { userId: req.user.sub, role: req.user.role, username: req.user.username };
}

function rejectInvalid(res: Response, error: { flatten: () => unknown }): void {
  res.status(400).json({ error: 'VALIDATION_ERROR', issues: error.flatten() });
}

/** GET /api/localities/:localityId/scenes — lista as cenas da localidade. */
localityScenesRouter.get('/:localityId/scenes', async (req, res) => {
  res.json({ scenes: await listScenes(String(req.params.localityId)) });
});

/**
 * POST /api/localities/:localityId/scenes — cria uma cena.
 *
 * Sem imagem de fundo é válido: a cena nasce com configuração espacial padrão
 * (assistida) e sem paredes.
 */
localityScenesRouter.post('/:localityId/scenes', async (req, res) => {
  const parsed = createSceneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectInvalid(res, parsed.error);
    return;
  }
  res.status(201).json({
    scene: await createScene(actorFrom(req), String(req.params.localityId), parsed.data),
  });
});

/** GET /api/scenes/:sceneId — cena com configuração e paredes. */
scenesRouter.get('/:sceneId', async (req, res) => {
  res.json({ scene: await getScene(String(req.params.sceneId)) });
});

/**
 * PATCH /api/scenes/:sceneId — nome, configuração espacial e/ou imagem.
 *
 * `expectedVersion` + `operationId` obrigatórios; cena em uso por combate ativo
 * responde 409 `SCENE_IN_USE`.
 */
scenesRouter.patch('/:sceneId', async (req, res) => {
  const parsed = updateSceneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectInvalid(res, parsed.error);
    return;
  }
  res.json(await updateScene(actorFrom(req), String(req.params.sceneId), parsed.data));
});

/** DELETE /api/scenes/:sceneId — remove a cena (paredes em cascata). */
scenesRouter.delete('/:sceneId', async (req, res) => {
  const parsed = deleteSceneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectInvalid(res, parsed.error);
    return;
  }
  res.json(await deleteScene(actorFrom(req), String(req.params.sceneId), parsed.data));
});

/** POST /api/scenes/:sceneId/spatial/obstacles — cria UMA parede na cena. */
scenesRouter.post('/:sceneId/spatial/obstacles', async (req, res) => {
  const parsed = spatialObstacleCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectInvalid(res, parsed.error);
    return;
  }
  const { expectedVersion, operationId, start, end, blocksMovement, blocksSight } = parsed.data;
  res.json(
    await createSpatialObstacle(actorFrom(req), String(req.params.sceneId), {
      expectedVersion,
      operationId,
      start,
      end,
      // Parede sólida por padrão; as flags são independentes.
      blocksMovement: blocksMovement ?? true,
      blocksSight: blocksSight ?? true,
    }),
  );
});

/** PATCH /api/scenes/:sceneId/spatial/obstacles/:obstacleId — altera a parede. */
scenesRouter.patch('/:sceneId/spatial/obstacles/:obstacleId', async (req, res) => {
  const parsed = spatialObstaclePatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectInvalid(res, parsed.error);
    return;
  }
  const { expectedVersion, operationId, ...changes } = parsed.data;
  res.json(
    await updateSpatialObstacle(
      actorFrom(req),
      String(req.params.sceneId),
      String(req.params.obstacleId),
      { expectedVersion, operationId, ...changes },
    ),
  );
});

/** DELETE /api/scenes/:sceneId/spatial/obstacles/:obstacleId — remove a parede. */
scenesRouter.delete('/:sceneId/spatial/obstacles/:obstacleId', async (req, res) => {
  const parsed = spatialObstacleDeleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectInvalid(res, parsed.error);
    return;
  }
  res.json(
    await deleteSpatialObstacle(
      actorFrom(req),
      String(req.params.sceneId),
      String(req.params.obstacleId),
      parsed.data,
    ),
  );
});


/** Salva um traçado completo; autorização, lock e idempotência são os da cena. */
scenesRouter.post('/:sceneId/spatial/obstacles/batch', async (req, res) => {
  const parsed = spatialObstacleBatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) { rejectInvalid(res, parsed.error); return; }
  res.json(await createSpatialObstacles(actorFrom(req), String(req.params.sceneId), parsed.data));
});
