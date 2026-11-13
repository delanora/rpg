import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { CombatActor } from './combat.service.js';
import { loadCombatById } from './combat-load.js';
import type { CombatSourced, CombatantSourced } from './combat.dto.js';
import {
  creatureAbilitiesOf,
  type CreatureAbility,
  type CreatureAreaPlacement,
} from '../shared/creature-abilities.js';
import { evaluateCombatArea } from './spatial/area-query.service.js';
import { gridAreaQuerySchema } from './spatial/area-membership.js';
import { combatSpatialIndex } from './spatial/spatial-distance.service.js';
import { occupiedSpaceOf } from './spatial/occupied-space.js';
import { publishPendingEffectSaves } from '../effects/pending-effect-saves.js';
import { finalizeSaveDamageCast } from '../spells/execution/save-damage-finalizer.js';
import { obstacleCoverProvider } from './spatial/obstacle-cover.js';
import { coverFor } from './cover.service.js';
import { coverSnapshotOf } from './cover.js';

export function creatureAreaPlan(
  combat: CombatSourced,
  combatantId: string,
  abilityId: string,
  placement: CreatureAreaPlacement,
) {
  const unit = combat.combatants.find((item) => item.id === combatantId);
  const ability =
    unit?.creature &&
    creatureAbilitiesOf(unit.creature.abilities).find(
      (item) => item.id === abilityId,
    );
  if (
    !unit ||
    !ability ||
    ability.execution !== 'area-save-damage' ||
    !ability.area
  )
    throw new HttpError(
      'Escolha uma habilidade em área cadastrada no bestiário.',
      400,
      'CREATURE_AREA_REQUIRED',
    );
  const index = combatSpatialIndex(combat),
    source = index.bodies.get(`combatant:${unit.id}`);
  const box = source && occupiedSpaceOf(source.position, source.size);
  if (!box)
    throw new HttpError(
      'Posicione a criatura no grid.',
      409,
      'AREA_SOURCE_REQUIRED',
    );
  const dx = Math.max(
      box.minXFeet - placement.origin.xFeet,
      placement.origin.xFeet - box.maxXFeet,
      0,
    ),
    dy = Math.max(
      box.minYFeet - placement.origin.yFeet,
      placement.origin.yFeet - box.maxYFeet,
      0,
    );
  const fromSelf = ['cone', 'line'].includes(ability.area.shape.kind);
  if (Math.max(dx, dy) > (fromSelf ? 0 : ability.area.rangeFeet) + 1e-6)
    throw new HttpError(
      'A origem está fora do alcance desta habilidade.',
      400,
      'AREA_ORIGIN_OUT_OF_RANGE',
    );
  const query = gridAreaQuerySchema.parse({
    origin: placement.origin,
    angle: placement.angle,
    decisions: placement.decisions,
    shape: ability.area.shape,
    casterCombatantId: unit.id,
  });
  const reading = evaluateCombatArea(combat, query, fromSelf ? [unit.id] : []);
  return {
    unit,
    ability,
    index,
    reading: {
      ...reading,
      area: ability.area,
      definitionFingerprint: createHash('sha256')
        .update(JSON.stringify(ability))
        .digest('hex'),
    },
  };
}
export async function previewCreatureArea(
  actor: CombatActor,
  combatId: string,
  combatantId: string,
  abilityId: string,
  placement: CreatureAreaPlacement,
) {
  if (actor.role !== 'MASTER')
    throw new HttpError(
      'Somente o Mestre usa habilidades do bestiário.',
      403,
      'FORBIDDEN',
    );
  return prisma.$transaction(
    async (db) =>
      creatureAreaPlan(
        await loadCombatById(combatId, db),
        combatantId,
        abilityId,
        placement,
      ).reading,
    { isolationLevel: 'RepeatableRead' },
  );
}
/** Uma execução, uma barreira e N salvaguardas; custo é aplicado na mesma transação pelo chamador. */
export async function beginCreatureAreaUse(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  unit: CombatantSourced,
  ability: CreatureAbility,
  placement: CreatureAreaPlacement,
) {
  const plan = creatureAreaPlan(combat, unit.id, ability.id, placement);
  const area = ability.area!;
  if (placement.definitionFingerprint !== plan.reading.definitionFingerprint)
    throw new HttpError(
      'O cadastro da habilidade mudou. Confira a área novamente.',
      409,
      'CONFLICT',
    );
  const targets = [
    ...new Map(
      plan.reading.candidates
        .filter((row) => row.affected === 'pass')
        .map((row) => [row.targetKey, { kind: row.kind, id: row.id }]),
    ).values(),
  ];
  if(placement.selectedTargetKeys?.some(key=>!targets.some(target=>`${target.kind}:${target.id}`===key)))throw new HttpError('A seleção inclui um alvo fora da área válida.',400,'AREA_TARGET_INVALID');
  const selectedTargets=placement.selectedTargetKeys?targets.filter(target=>placement.selectedTargetKeys!.includes(`${target.kind}:${target.id}`)):targets;
  const hidden = unit.spatialVisibility === 'master-only';
  const use = await db.creatureAreaUse.create({
    data: {
      combatId: combat.id,
      casterEntityKind: 'combatant',
      casterEntityId: unit.id,
      casterLabel: unit.name,
      abilityId: ability.id,
      label: ability.name,
      definition: area as Prisma.InputJsonValue,
      placement: placement as Prisma.InputJsonValue,
      targets:selectedTargets,
      visibility: hidden ? 'private' : 'public',
    },
  });
  for (const target of selectedTargets) {
    const targetUnit = combat.combatants.find((item) =>
      target.kind === 'character'
        ? item.characterId === target.id
        : item.id === target.id,
    );
    let cover: Prisma.InputJsonValue | undefined;
    if (area.saveAbility === 'dexterity') {
      const evaluation = await coverFor(
        {
          origin: { kind: 'combatant', id: unit.id },
          target: {
            kind: target.kind as 'character' | 'combatant',
            id: target.id,
          },
          interaction: 'dexterity-save',
        },
        obstacleCoverProvider(plan.index),
      );
      const snapshot = coverSnapshotOf(evaluation);
      if (snapshot.status === 'known')
        cover = {
          level: snapshot.level,
          bonus: snapshot.saveBonus,
          provenance: snapshot.provenance,
        };
    }
    const publicTarget = target.kind === 'character';
    await db.pendingEffectSave.create({
      data: {
        definitionId: `creature-ability.${ability.id}`,
        creatureAreaUseId: use.id,
        sourceLabel: hidden && publicTarget ? 'Efeito em área' : ability.name,
        casterEntityKind: 'combatant',
        casterEntityId: unit.id,
        casterLabel: hidden && publicTarget ? 'Origem oculta' : unit.name,
        targetEntityKind: target.kind,
        targetEntityId: target.id,
        ability: area.saveAbility,
        dc: area.dc,
        visibility: publicTarget
          ? 'public'
          : targetUnit?.spatialVisibility === 'master-only'
            ? 'private'
            : 'public',
        operationId: `${use.id}:${target.kind}:${target.id}`,
        fingerprint: createHash('sha256')
          .update(`${use.id}:${target.kind}:${target.id}`)
          .digest('hex'),
        ...(cover ? { cover } : {}),
      },
    });
  }
  if (!selectedTargets.length)
    await finalizeSaveDamageCast(use.id, db, {
      sourceKind: 'creature-ability',
    });
  return use.id;
}
export async function publishCreatureAreaUse(id: string) {
  const use = await prisma.creatureAreaUse.findUnique({ where: { id } });
  if (use)
    await publishPendingEffectSaves(
      (use.targets as { kind: 'character' | 'combatant'; id: string }[]) ?? [],
    );
}
