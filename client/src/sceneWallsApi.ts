import { api } from './api';
import type { Scene, SpatialObstacle } from './types';

/** Intenção de edição; custo, geometria válida e lock continuam no servidor. */
export type SceneWallShape = Pick<SpatialObstacle, 'start' | 'end' | 'blocksMovement' | 'blocksSight'>;
export type SceneWallMutation =
  | { kind: 'create'; wall: SceneWallShape }
  | { kind: 'update'; wallId: string; wall: SceneWallShape }
  | { kind: 'delete'; wallId: string };

/** O chamador mantém versão e id da intenção em retries de resultado incerto. */
export async function mutateSceneWall(
  sceneId: string, mutation: SceneWallMutation, expectedVersion: number, operationId: string,
): Promise<Scene> {
  const base = `/api/scenes/${sceneId}/spatial/obstacles`;
  const { scene } = await api<{ scene: Scene }>(
    mutation.kind === 'create' ? base : `${base}/${mutation.wallId}`,
    {
      method: mutation.kind === 'create' ? 'POST' : mutation.kind === 'update' ? 'PATCH' : 'DELETE',
      body: {
        expectedVersion, operationId,
        ...(mutation.kind === 'delete' ? {} : {
          start: mutation.wall.start, end: mutation.wall.end,
          blocksMovement: mutation.wall.blocksMovement, blocksSight: mutation.wall.blocksSight,
        }),
      },
    },
  );
  return scene;
}
