import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { loadCombatById, type CombatActor } from '../combat.service.js';
import { combatSpatialIndex } from './spatial-distance.service.js';
import { areaMembership, type GridAreaQuery } from './area-membership.js';
import {
  areaCandidateEvaluation,
  applyAreaDecisions,
  assertAreaDecisionsValid,
} from '../../spells/execution/area-evaluation.js';
import { wallTouchesAreaRay } from './area-query-walls.js';

/** Leitura privada do Mestre; não gasta recursos, não grava alvos e não publica eventos. */
export async function queryCombatArea(
  actor: CombatActor,
  combatId: string,
  query: GridAreaQuery,
) {
  if (actor.role !== 'MASTER')
    throw new HttpError(
      'Somente o Mestre consulta os atingidos desta área.',
      403,
      'FORBIDDEN',
    );
  const combat = await prisma.$transaction(
    (db) => loadCombatById(combatId, db),
    { isolationLevel: 'RepeatableRead' },
  );
  if (combat.status === 'ENDED')
    throw new HttpError('O combate já terminou.', 409, 'CONFLICT');
  const index = combatSpatialIndex(combat);
  if (index.scene.mode !== 'grid-2d')
    throw new HttpError(
      'Seleção espacial exige uma cena com grade.',
      409,
      'AREA_CONTEXT_UNSUPPORTED',
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
  const candidates = combat.combatants.map((unit) => {
    const body = index.bodies.get(`combatant:${unit.id}`) ?? null;
    const membership = areaMembership(query, index.scene, body);
    // Paredes 2D não informam altura física. Obstrução relevante exige decisão,
    // mas uma parede fora dos raios nunca transforma um caso livre em unknown.
    const propagation =
      body?.position &&
      wallTouchesAreaRay(query.origin, body, index.obstacles ?? [])
        ? 'unknown'
        : 'pass';
    const key = unit.characterId
      ? `character:${unit.characterId}`
      : `combatant:${unit.id}`;
    return {
      combatantId: unit.id,
      name: unit.name,
      ...areaCandidateEvaluation({
        targetKey: key,
        kind: unit.characterId ? 'character' : 'combatant',
        id: unit.characterId ?? unit.id,
        geometry: membership.result,
        propagation,
        reasons: [
          ...(membership.result !== 'pass' && membership.reason
            ? [membership.reason]
            : []),
          ...(propagation === 'unknown' ? ['wall-height-unknown'] : []),
        ],
      }),
    };
  });
  const outcome = applyAreaDecisions(candidates, query.decisions ?? []);
  assertAreaDecisionsValid(outcome);
  const finalCandidates = candidates.map((row) => ({
    ...row,
    affected: outcome.missing.includes(row.targetKey)
      ? ('unknown' as const)
      : outcome.affectedKeys.includes(row.targetKey)
        ? ('pass' as const)
        : ('fail' as const),
    decisionSource: outcome.provenance.get(row.targetKey) ?? null,
  }));
  return {
    combatId: combat.id,
    combatVersion: combat.version,
    candidates: finalCandidates,
  };
}
