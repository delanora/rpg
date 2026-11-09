import { api } from './api';
import type { Scene, SpatialObstacle } from './types';

/** Intenção de edição; custo, geometria válida e lock continuam no servidor. */
export type SceneWallShape = Pick<SpatialObstacle, 'start' | 'end' | 'blocksMovement' | 'blocksSight' | 'blocksTargeting' | 'coverLevel'>;
export type SceneWallMutation =
  | { kind: 'create'; wall: SceneWallShape }
  | { kind: 'create-many'; walls: SceneWallShape[] }
  | { kind: 'update'; wallId: string; wall: SceneWallShape }
  | { kind: 'delete'; wallId: string };

/** O chamador mantém versão e id da intenção em retries de resultado incerto. */
export async function mutateSceneWall(
  sceneId: string, mutation: SceneWallMutation, expectedVersion: number, operationId: string,
): Promise<Scene> {
  const base = `/api/scenes/${sceneId}/spatial/obstacles`;
  const shape = ({ start, end, blocksMovement, blocksSight, blocksTargeting, coverLevel }: SceneWallShape) =>
    ({ start, end, blocksMovement, blocksSight, coverLevel: coverLevel ?? ((blocksTargeting ?? blocksMovement) ? 'total' : 'none'), blocksTargeting: coverLevel ? coverLevel === 'total' : blocksTargeting ?? blocksMovement });
  const path = mutation.kind === 'create-many' ? `${base}/batch` :
    mutation.kind === 'create' ? base : `${base}/${mutation.wallId}`;
  const { scene } = await api<{ scene: Scene }>(path, {
    method: mutation.kind === 'create' || mutation.kind === 'create-many' ? 'POST' :
      mutation.kind === 'update' ? 'PATCH' : 'DELETE',
    body: { expectedVersion, operationId,
      ...(mutation.kind === 'create-many' ? { walls: mutation.walls.map(shape) } :
        mutation.kind === 'delete' ? {} : shape(mutation.wall)),
    },
  });
  return scene;
}
