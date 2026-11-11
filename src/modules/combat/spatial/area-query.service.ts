import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { loadCombatById, type CombatActor } from '../combat.service.js';
import { orderCombatants, type CombatSourced } from '../combat.dto.js';
import { combatSpatialIndex } from './spatial-distance.service.js';
import { surfaceElevation } from './elevation.js';
import { areaMembership, type GridAreaQuery } from './area-membership.js';
import {
  areaCandidateEvaluation,
  applyAreaDecisions,
  assertAreaDecisionsValid,
} from '../../spells/execution/area-evaluation.js';
import { wallTouchesAreaRay } from './area-query-walls.js';

/** A mesma avaliação serve à consulta e ao commit da habilidade, dentro de sua transação. */
export function evaluateCombatArea(
  combat: CombatSourced,
  query: GridAreaQuery,
  excludeIds: readonly string[] = [],
) {
  if (combat.status === 'ENDED')
    throw new HttpError('O combate já terminou.', 409, 'CONFLICT');
  const index = combatSpatialIndex(combat);
  if (index.scene.mode !== 'grid-2d')
    throw new HttpError(
      'Seleção espacial exige uma cena com grade.',
      409,
      'AREA_CONTEXT_UNSUPPORTED',
    );
  const sourceId =
    query.casterCombatantId ??
    orderCombatants(combat.combatants)[combat.currentIndex]?.id;
  const source = combat.combatants.find((unit) => unit.id === sourceId);
  const sourceBody = source && index.bodies.get(`combatant:${source.id}`);
  if (!source || !sourceBody?.position)
    throw new HttpError(
      'Posicione no grid quem usará a área.',
      409,
      'AREA_SOURCE_REQUIRED',
    );
  const level =
    sourceBody.elevationFeet ??
    surfaceElevation(index.scene, sourceBody.position, sourceBody.size);
  if (level === null)
    throw new HttpError(
      'Defina a elevação da base do token de origem.',
      409,
      'AREA_SOURCE_ELEVATION_REQUIRED',
    );
  if (
    query.origin.xFeet < 0 ||
    query.origin.yFeet < 0 ||
    query.origin.xFeet > index.scene.widthFeet ||
    query.origin.yFeet > index.scene.heightFeet
  )
    throw new HttpError(
      'A origem precisa ficar dentro do mapa.',
      400,
      'VALIDATION_ERROR',
    );
  const candidates = combat.combatants
    .filter((unit) => !excludeIds.includes(unit.id))
    .map((unit) => {
      const body = index.bodies.get(`combatant:${unit.id}`) ?? null;
      const horizontal = areaMembership(query, index.scene, body);
      const targetLevel = body?.position
        ? (body.elevationFeet ??
          surfaceElevation(index.scene, body.position, body.size))
        : null;
      const different =
        targetLevel === null || Math.abs(targetLevel - level) > 1e-6;
      const blocked =
        body?.position &&
        wallTouchesAreaRay(query.origin, body, index.obstacles ?? []);
      const geometry =
        horizontal.result === 'pass' && different
          ? 'unknown'
          : horizontal.result;
      const propagation = blocked ? ('fail' as const) : ('pass' as const);
      const key = unit.characterId
        ? `character:${unit.characterId}`
        : `combatant:${unit.id}`;
      const evaluated = areaCandidateEvaluation({
        targetKey: key,
        kind: unit.characterId ? 'character' : 'combatant',
        id: unit.characterId ?? unit.id,
        geometry,
        propagation,
        reasons: [
          ...(horizontal.result === 'fail'
            ? [horizontal.reason ?? 'outside-area']
            : []),
          ...(different ? ['different-elevation'] : []),
          ...(blocked ? ['attack-blocking-wall'] : []),
        ],
      });
      return {
        combatantId: unit.id,
        name: unit.name,
        elevationFeet: targetLevel,
        overrideAllowed:
          horizontal.result === 'pass' &&
          evaluated.affected === 'unknown' &&
          different,
        ...evaluated,
      };
    });
  const explicit = query.decisions ?? [];
  if (
    explicit.some(
      (decision) =>
        !candidates.some(
          (row) => row.targetKey === decision.targetKey && row.overrideAllowed,
        ),
    )
  )
    throw new HttpError(
      'A exceção só pode incluir ou excluir um alvo em outra elevação, dentro da área e sem parede bloqueando.',
      409,
      'AREA_DECISION_INVALID',
    );
  // Outra elevação fica FORA sem exigir pop-up; o Mestre só modifica a ocorrência.
  const defaults = candidates
    .filter(
      (row) =>
        row.affected === 'unknown' &&
        !explicit.some((item) => item.targetKey === row.targetKey),
    )
    .map((row) => ({ targetKey: row.targetKey, affected: false }));
  const outcome = applyAreaDecisions(candidates, [...defaults, ...explicit]);
  assertAreaDecisionsValid(outcome);
  return {
    combatId: combat.id,
    combatVersion: combat.version,
    source: { combatantId: source.id, name: source.name, elevationFeet: level },
    candidates: candidates.map((row) => ({
      ...row,
      affected: outcome.affectedKeys.includes(row.targetKey)
        ? ('pass' as const)
        : ('fail' as const),
      decisionSource: explicit.some((item) => item.targetKey === row.targetKey)
        ? 'master-confirmed'
        : row.overrideAllowed
          ? 'default-elevation'
          : 'authoritative',
    })),
  };
}
export async function queryCombatArea(
  actor: CombatActor,
  combatId: string,
  query: GridAreaQuery,
) {
  if (actor.role !== 'MASTER')
    throw new HttpError(
      'Somente o Mestre consulta esta área.',
      403,
      'FORBIDDEN',
    );
  return prisma.$transaction(
    async (db) => evaluateCombatArea(await loadCombatById(combatId, db), query),
    { isolationLevel: 'RepeatableRead' },
  );
}
