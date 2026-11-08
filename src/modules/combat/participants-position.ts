import { HttpError } from '../../lib/http-error.js';
import type { loadCombatById } from './combat.service.js';
import {
  occupiedSpaceOf,
  parseStoredPosition,
  spaceWithinScene,
  occupiedSpacesOverlap,
} from './spatial/occupied-space.js';
import { effectiveSceneConfigOf } from './spatial/spatial.types.js';
import { isGridAligned } from './spatial/spatial-distance.js';

/** Preparação e reforços compartilham os mesmos limites e footprints do combate. */
export async function validateParticipantPositions(
  combat: Awaited<ReturnType<typeof loadCombatById>>,
  onlyIds?: string[],
) {
  const scene = effectiveSceneConfigOf(combat);
  for (const unit of combat.combatants) {
    if (onlyIds && !onlyIds.includes(unit.id)) continue;
    const position = parseStoredPosition(unit.spatialPosition);
    if (!position) continue;
    const size = unit.baseSize ?? 'medium';
    const space = occupiedSpaceOf(position, size)!;
    if (
      scene.mode !== 'grid-2d' ||
      !isGridAligned(position, size) ||
      !spaceWithinScene(space, scene)
    ) {
      throw new HttpError(
        `Posição de ${unit.name} inválida para esta cena.`,
        409,
        'SPATIAL_POSITION_INVALID',
      );
    }
    if (
      combat.combatants.some(
        (other) =>
          other.id !== unit.id &&
          (() => {
            const occupied = occupiedSpaceOf(
              parseStoredPosition(other.spatialPosition),
              other.baseSize ?? 'medium',
            );
            return occupied && occupiedSpacesOverlap(space, occupied);
          })(),
      )
    )
      throw new HttpError(
        `A posição de ${unit.name} já está ocupada.`,
        409,
        'SPATIAL_POSITION_OCCUPIED',
      );
  }
}
