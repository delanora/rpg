import { COVER_LEVELS, knownCover, type CoverEvaluation } from '../cover.js';
import type { CoverSpatialProvider } from '../cover.service.js';
import type { CombatSpatialIndex } from './spatial-distance.service.js';
import type { SpatialBody } from './spatial-distance.js';
import type { SpatialSceneConfig } from './spatial.types.js';
import { coverLevelOf, type SpatialObstacleShape } from './spatial-obstacle.js';
import { evaluateWallPath } from './targeting-walls.js';

/** O grau é adjudicado no cadastro pelo Mestre; a geometria só prova a
 * interposição. Não inferimos altura, fração do corpo nem cobertura pela arte.
 * A mesma convenção se aplica a todos os tamanhos de token. */
export function evaluateObstacleCover(
  scene: SpatialSceneConfig,
  source: SpatialBody | null,
  target: SpatialBody | null,
  walls: readonly SpatialObstacleShape[] | null | undefined,
): CoverEvaluation {
  let uncertain = false;
  let highest = 0;
  // Agrupamos por limiar: segmentos contíguos com graus diferentes podem
  // garantir apenas o menor grau que cobre o corredor inteiro. Nunca somamos.
  for (let rank = 1; rank < COVER_LEVELS.length; rank++) {
    const relevant = walls
      ?.filter((wall) => COVER_LEVELS.indexOf(coverLevelOf(wall)) >= rank)
      .map((wall) => ({ ...wall, blocksTargeting: true }));
    const result = evaluateWallPath(scene, source, target, relevant);
    if (result.result === 'fail') highest = rank;
    else if (result.result === 'unknown') uncertain = true;
  }
  // Quando um grau maior só cobre parte do corredor, o grau final continua
  // indeterminado: não o promovemos silenciosamente para o maior.
  if (uncertain && highest < COVER_LEVELS.length - 1) {
    return {
      status: 'unknown',
      reason:
        'cobertura em canto, fresta ou geometria indisponível; requer adjudicação do Mestre',
    };
  }
  return knownCover(COVER_LEVELS[highest]!, 'authoritative');
}

export function obstacleCoverProvider(
  index: CombatSpatialIndex | null,
): CoverSpatialProvider {
  return {
    mode: 'authoritative',
    evaluate({ origin, target }) {
      if (!index)
        return {
          status: 'not-assessed',
          reason: 'sem cena de combate para avaliar cobertura',
        };
      return evaluateObstacleCover(
        index.scene,
        index.bodies.get(`${origin.kind}:${origin.id}`) ?? null,
        index.bodies.get(`${target.kind}:${target.id}`) ?? null,
        index.obstacles,
      );
    },
  };
}
