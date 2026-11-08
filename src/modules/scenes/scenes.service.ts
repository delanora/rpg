import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import {
  obstacleSegmentOf,
  obstacleWithinScene,
  type SpatialObstacleShape,
} from '../combat/spatial/spatial-obstacle.js';
import {
  defaultSpatialScene,
  GRID_CELL_SIZE_FEET,
  spatialSceneOf,
  type SpatialMode,
  type SpatialSceneConfig,
} from '../combat/spatial/spatial.types.js';
import { toSceneDto, type SceneDto, type SceneSource } from './scenes.dto.js';
import type { CreateScenePayload, DeleteScenePayload, UpdateScenePayload } from './scenes.schema.js';

/**
 * FASE 6.6L.4.1.1 — CENAS ESPACIAIS DA LOCALIDADE (MASTER-only).
 *
 * `Locality 1→N Scene 1→N SpatialObstacle`: a geometria estrutural pertence ao
 * AMBIENTE persistente, não ao runtime do encontro. O combate apenas referencia
 * a cena (`Combat.sceneId`) e projeta a configuração dela no read model.
 *
 * Cena usada por combate NÃO terminado é ESTRUTURALMENTE CONGELADA (409
 * `SCENE_IN_USE`): o produto prepara o mapa antes da iniciativa e não edita a
 * estrutura durante o combate. Não existe revision/snapshot branching aqui.
 *
 * Concorrência/idempotência reutilizam a MESMA semântica das operações do
 * combate (`expectedVersion` + `operationId` + fingerprint + snapshot), em
 * `SceneOperation`. É uma tabela própria porque o dono do relógio de versão é a
 * cena, mas o conceito é o mesmo — não há um segundo engine de concorrência.
 */

/** Quem executa a operação. Sempre derivado do TOKEN, nunca do payload. */
export interface SceneActor {
  userId: string;
  role: string;
  username: string;
}

export interface SceneOperationInput {
  sceneId: string;
  expectedVersion: number;
  operationId: string;
  /** Campos do alvo da operação (entram no fingerprint de propósito). */
  name?: string;
  spatialConfig?: { mode: SpatialMode; widthFeet?: number; heightFeet?: number };
  backgroundImageUrl?: string | null;
  obstacleId?: string;
  obstacle?: Partial<SpatialObstacleShape>;
  obstacles?: SpatialObstacleShape[];
}

const withObstacles = { obstacles: { orderBy: { createdAt: 'asc' } } } as const;

/**
 * Cenas são conteúdo de preparação do Mestre (como localidades): todos os
 * eventos vão apenas para a sala dos mestres.
 */
function broadcast(event: ServerEvent, payload: unknown): void {
  try {
    getBroadcaster().toMasters(event, payload);
  } catch (error) {
    console.error('[scenes] falha ao publicar evento em tempo real:', error);
  }
}

function requireMaster(actor: SceneActor): void {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o mestre pode administrar as cenas.', 403);
  }
}

/**
 * Cena carregada com as paredes. Usado pelo serviço e pelos testes: um 404
 * nunca devolve uma cena parcial.
 */
export async function loadSceneById(
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<SceneSource> {
  const scene = await db.scene.findUnique({ where: { id }, include: withObstacles });
  if (!scene) throw new HttpError('Cena não encontrada.', 404);
  return scene;
}

/**
 * LOCK ESTRUTURAL (6.6L.4.1.1): a cena está em uso por combate não terminado?
 *
 * Vale para QUALQUER mutação estrutural da cena — nome/imagem (metadados da
 * mesma linha), dimensões/grid e paredes. "Não terminado" inclui
 * `PENDING_INITIATIVE` de propósito: o Mestre já pode estar posicionando os
 * combatentes nessa cena.
 */
export async function assertSceneNotInUse(
  sceneId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const active = await db.combat.count({
    where: { sceneId, status: { not: 'ENDED' } },
  });
  if (active > 0) {
    throw new HttpError(
      'Esta cena está em uso por um combate em andamento. Encerre o combate antes de alterar a cena.',
      409,
      'SCENE_IN_USE',
    );
  }
}

/**
 * Mescla a configuração pedida com a atual (dimensões omitidas são mantidas).
 * `cellSizeFeet` é FIXO desta fase e nunca vem do cliente.
 */
function mergedSpatialConfig(
  current: SpatialSceneConfig | null,
  patch: { mode: SpatialMode; widthFeet?: number; heightFeet?: number },
): SpatialSceneConfig {
  const base = current ?? defaultSpatialScene();
  return {
    mode: patch.mode,
    widthFeet: patch.widthFeet ?? base.widthFeet,
    heightFeet: patch.heightFeet ?? base.heightFeet,
    cellSizeFeet: GRID_CELL_SIZE_FEET,
  };
}

export async function listScenes(localityId: string): Promise<SceneDto[]> {
  const locality = await prisma.locality.count({ where: { id: localityId } });
  if (locality === 0) throw new HttpError('Localidade não encontrada.', 404);

  const scenes = await prisma.scene.findMany({
    where: { localityId },
    orderBy: { name: 'asc' },
    include: withObstacles,
  });
  return scenes.map(toSceneDto);
}

export async function getScene(sceneId: string): Promise<SceneDto> {
  return toSceneDto(await loadSceneById(sceneId));
}

/**
 * Cria uma cena na localidade. Sem imagem é um estado VÁLIDO: a cena já nasce
 * utilizável para grid, paredes e movimento.
 */
export async function createScene(
  actor: SceneActor,
  localityId: string,
  input: CreateScenePayload,
): Promise<SceneDto> {
  requireMaster(actor);

  const locality = await prisma.locality.count({ where: { id: localityId } });
  if (locality === 0) throw new HttpError('Localidade não encontrada.', 404);

  const config = input.spatialConfig ? mergedSpatialConfig(null, input.spatialConfig) : null;
  const scene = await prisma.scene.create({
    data: {
      localityId,
      name: input.name,
      ...(config ? { spatialConfig: config as unknown as Prisma.InputJsonValue } : {}),
      backgroundImageUrl: input.backgroundImageUrl ?? null,
    },
    include: withObstacles,
  });

  const dto = toSceneDto(scene);
  broadcast(ServerEvents.SCENE_CREATED, { localityId, scene: dto });
  return dto;
}

export async function updateScene(
  actor: SceneActor,
  sceneId: string,
  input: UpdateScenePayload,
): Promise<{ scene: SceneDto }> {
  return runSceneOperation(
    actor,
    {
      sceneId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      name: input.name,
      spatialConfig: input.spatialConfig,
      backgroundImageUrl: input.backgroundImageUrl,
    },
    'scene-update',
    async (db, scene) => {
      const data: Prisma.SceneUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.backgroundImageUrl !== undefined) {
        data.backgroundImageUrl = input.backgroundImageUrl;
      }
      if (input.spatialConfig !== undefined) {
        const next = mergedSpatialConfig(spatialSceneOf(scene.spatialConfig), input.spatialConfig);
        // Reduzir a cena nunca move nem apaga parede: a alteração inteira é
        // recusada se alguma parede sair dos novos limites.
        const orphan = (scene.obstacles ?? []).find(
          (obstacle) => !obstacleWithinScene(obstacleSegmentOf(obstacle), next),
        );
        if (orphan) {
          throw new HttpError(
            'Uma parede ficaria fora da cena com essas dimensões. Ajuste ou remova a parede antes de redimensionar.',
            409,
            'SCENE_RESIZE_CONFLICT',
          );
        }
        data.spatialConfig = next as unknown as Prisma.InputJsonValue;
      }

      const updated = await db.scene.update({ where: { id: scene.id }, data, include: withObstacles });
      return { scene: toSceneDto(updated) };
    },
  );
}

/**
 * Remove a cena (as paredes caem por cascade). Combate que a referenciava fica
 * com `sceneId = null` (FK `SetNull`) e volta ao comportamento legado.
 *
 * DECISÃO: exclusão NÃO grava `SceneOperation`. A operação referencia a cena
 * por FK (`onDelete: Cascade`), então um registro criado antes do delete seria
 * apagado junto e um criado depois violaria a FK — nos dois casos o snapshot
 * de retry não sobreviveria. Em vez de inventar um segundo mecanismo, o delete
 * mantém a MESMA garantia que importa: `expectedVersion` conferido dentro da
 * transação (versão velha → 409, sem efeito) e retry determinístico → 404 de
 * "cena já removida", nunca reaplicação silenciosa.
 */
export async function deleteScene(
  actor: SceneActor,
  sceneId: string,
  input: DeleteScenePayload,
): Promise<{ scene: SceneDto }> {
  requireMaster(actor);

  const result = await prisma.$transaction(async (db) => {
    // O lock vale também para excluir: cena em uso por combate ativo é 409.
    await assertSceneNotInUse(sceneId, db);
    const scene = await db.scene.findUnique({ where: { id: sceneId }, include: withObstacles });
    if (!scene) throw new HttpError('Cena não encontrada.', 404);
    if (scene.version !== input.expectedVersion) {
      throw new HttpError('A cena mudou. Atualize e tente novamente.', 409, 'CONFLICT');
    }
    await db.scene.delete({ where: { id: scene.id } });
    return { scene: toSceneDto(scene) };
  });

  broadcast(ServerEvents.SCENE_DELETED, {
    localityId: result.scene.localityId,
    sceneId: result.scene.id,
  });
  return result;
}

/**
 * Executa uma mutação de cena com fingerprint + replay, versão esperada e
 * publicação DEPOIS do commit. `apply` recebe a cena já com as paredes.
 */
export async function runSceneOperation<T extends { scene: SceneDto }>(
  actor: SceneActor,
  input: SceneOperationInput,
  type: string,
  apply: (db: Prisma.TransactionClient, scene: SceneSource) => Promise<T>,
  publish: (result: T) => void = (result) =>
    broadcast(ServerEvents.SCENE_UPDATED, { scene: result.scene }),
): Promise<T> {
  requireMaster(actor);

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ type, actor: actor.userId, input }))
    .digest('hex');
  const key = { sceneId_operationId: { sceneId: input.sceneId, operationId: input.operationId } };
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) {
      throw new HttpError('operationId reutilizado com outro payload/autor.', 409, 'IDEMPOTENCY_KEY_REUSED');
    }
    return operation.snapshot as T;
  };

  const existing = await prisma.sceneOperation.findUnique({ where: key });
  if (existing) return replay(existing);

  let result: T;
  try {
    result = await prisma.$transaction(
      async (db) => {
        const previous = await db.sceneOperation.findUnique({ where: key });
        if (previous) return replay(previous);

        // O lock vem ANTES da escrita: cena em uso não muda nem a versão.
        await assertSceneNotInUse(input.sceneId, db);

        const changed = await db.scene.updateMany({
          where: { id: input.sceneId, version: input.expectedVersion },
          data: { version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          const exists = await db.scene.findUnique({
            where: { id: input.sceneId },
            select: { id: true },
          });
          if (!exists) throw new HttpError('Cena não encontrada.', 404);
          throw new HttpError('A cena mudou. Atualize e tente novamente.', 409, 'CONFLICT');
        }

        const scene = await db.scene.findUnique({
          where: { id: input.sceneId },
          include: withObstacles,
        });
        if (!scene) throw new HttpError('Cena não encontrada.', 404);

        const response = await apply(db, scene);
        await db.sceneOperation.create({
          data: {
            sceneId: scene.id,
            operationId: input.operationId,
            fingerprint,
            snapshot: response as unknown as Prisma.InputJsonValue,
          },
        });
        return response;
      },
      { timeout: 15000 },
    );
  } catch (error) {
    // Retry concorrente da MESMA operação: quem perdeu devolve o snapshot.
    const previous = await prisma.sceneOperation.findUnique({ where: key });
    if (previous) return replay(previous);
    throw error;
  }

  publish(result);
  return result;
}
