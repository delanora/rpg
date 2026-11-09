import { createHash } from 'node:crypto';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { allSpells } from '../../shared/spells/index.js';
import { hasWarCaster } from '../../shared/war-caster.js';
import { loadEntity } from '../../mechanical/mechanical.service.js';
import { castingResourcesForEntity } from '../../spells/execution/casting-resource.service.js';
import { evaluateSpellAvailability } from '../../spells/execution/spell-authorization.service.js';
import { spellExecutionDefinition } from '../../spells/execution/spell-execution-registry.js';
import { attackCountOf } from '../../spells/execution/spell-execution-definition.js';
import {
  executeCast,
  validateSpellCast,
  castResultForOperation,
} from '../../spells/execution/spell-cast.service.js';
import type { SpellCastProofInput } from '../../spells/execution/spell-cast.schema.js';
import type { CombatActor } from '../combat.service.js';
import { loadCombatById } from '../combat-load.js';
import {
  toCombatDto,
  type CombatSourced,
  type CombatantSourced,
} from '../combat.dto.js';
import {
  assertOpportunityActionable,
  settleOpportunitySpell,
} from './opportunity-attack.service.js';
import type { OpportunityOption } from './opportunity-attack.js';

function hasFeat(unit: CombatantSourced): boolean {
  return hasWarCaster(unit.character?.features, unit.creature?.abilities);
}
function eligibleDefinition(spellId: string) {
  const spell = allSpells().find((s) => s.id === spellId);
  const execution = spellExecutionDefinition(spellId);
  if (
    !spell ||
    !execution ||
    (execution.castingTime ?? spell.castingTimeKind) !== 'action' ||
    execution.targeting.kind !== 'creatures' ||
    execution.targeting.range.kind === 'self'
  )
    throw new HttpError(
      'Conjurador de Guerra exige magia de 1 Ação dirigida somente à criatura que provocou a oportunidade.',
      409,
      'WAR_CASTER_SPELL_INVALID',
    );
  return { spell, execution };
}
function castInput(
  operationId: string,
  reactor: CombatantSourced,
  mover: CombatantSourced,
  choice: NonNullable<OpportunityOption['spell']>,
): SpellCastProofInput {
  const { execution } = eligibleDefinition(choice.spellId);
  const target = mover.characterId
    ? { kind: 'character' as const, id: mover.characterId }
    : { kind: 'combatant' as const, id: mover.id };
  return {
    operationId,
    spellId: choice.spellId,
    caster: reactor.characterId
      ? { kind: 'character', id: reactor.characterId }
      : { kind: 'combatant', id: reactor.id },
    targets: Array.from(
      {
        length:
          execution.resolution.kind === 'attack-damage'
            ? attackCountOf(execution)
            : 1,
      },
      () => target,
    ),
    spellcastingSource: choice.spellcastingSource,
    castingResource: choice.castingResource,
  };
}

/** Opções derivadas dos MESMOS validadores de repertório, componentes, espaço e alvos. */
export async function warCasterOptions(
  actor: CombatActor,
  combat: CombatSourced,
  reactorId: string,
  moverId: string,
): Promise<OpportunityOption[]> {
  const reactor = combat.combatants.find((c) => c.id === reactorId),
    mover = combat.combatants.find((c) => c.id === moverId);
  if (!reactor || !mover || !hasFeat(reactor)) return [];
  const entity = reactor.characterId
    ? { kind: 'character' as const, id: reactor.characterId }
    : { kind: 'combatant' as const, id: reactor.id };
  const caster = await loadEntity(entity);
  const resources = await castingResourcesForEntity(entity);
  const result: OpportunityOption[] = [];
  for (const spell of allSpells()) {
    if (!spellExecutionDefinition(spell.id)) continue;
    try {
      eligibleDefinition(spell.id);
      const available = await evaluateSpellAvailability(caster, spell.id);
      for (const source of available.authorized) {
        const slots =
          spell.level === 0
            ? [undefined]
            : resources.filter(
                (r) => r.remaining > 0 && r.level >= spell.level,
              );
        for (const slot of slots) {
          const choice = {
            spellId: spell.id,
            spellcastingSource: {
              kind: source.view.source.kind,
              id: source.view.source.id,
            },
            ...(slot
              ? { castingResource: { kind: slot.kind, level: slot.level } }
              : {}),
          };
          try {
            await validateSpellCast(
              actor,
              castInput('war-caster-options', reactor, mover, choice),
              prisma,
              { reactionAuthorized: true },
            );
            result.push({
              id: `spell:${spell.id}:${source.view.source.kind}:${source.view.source.id}:${slot?.kind ?? 'cantrip'}:${slot?.level ?? 0}`,
              attackId: '',
              label: `${spell.namePt}${slot ? ` · ${slot.level}º círculo` : ' · truque'} — ${source.view.source.label}`,
              description:
                'Conjurador de Guerra · usa Reação e atinge somente quem provocou a oportunidade.',
              reachFeet: 0,
              spell: choice,
            });
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  return result;
}

export async function castOpportunitySpell(
  actor: CombatActor,
  combatId: string,
  opportunityId: string,
  input: {
    operationId: string;
    expectedVersion: number;
    spell: NonNullable<OpportunityOption['spell']>;
  },
) {
  const window = await prisma.reactionOpportunity.findUnique({
    where: { id: opportunityId },
  });
  if (!window || window.combatId !== combatId)
    throw new HttpError('Oportunidade não encontrada.', 404);
  const combat = await loadCombatById(combatId);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        type: 'war-caster',
        actor: actor.userId,
        combatId,
        opportunityId,
        input,
      }),
    )
    .digest('hex');
  const previous = await prisma.spellCast.findUnique({
    where: { operationId: input.operationId },
  });
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new HttpError(
        'operationId reutilizado com outro pedido.',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    return {
      combat: toCombatDto(combat, actor.role),
      cast: (await castResultForOperation(input.operationId))!,
    };
  }
  const reactor = combat.combatants.find(
      (c) => c.id === window.reactorCombatantId,
    ),
    mover = combat.combatants.find((c) => c.id === window.moverCombatantId);
  if (!reactor || !mover)
    throw new HttpError('Participante não encontrado.', 409);

  const cast = await executeCast(
    actor,
    castInput(input.operationId, reactor, mover, input.spell),
    {
      operationId: input.operationId,
      fingerprint,
      reactionAuthorized: true,
      beforeValidate: async (db) => {
        const previous = await db.combatOperation.findUnique({
          where: {
            combatId_operationId: { combatId, operationId: input.operationId },
          },
        });
        if (previous)
          throw new HttpError(
            'operationId reutilizado em outra operação.',
            409,
            'IDEMPOTENCY_KEY_REUSED',
          );
        const locked = await db.combat.updateMany({
          where: {
            id: combatId,
            status: 'ACTIVE',
            version: input.expectedVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (!locked.count)
          throw new HttpError(
            'O combate mudou. Atualize e tente novamente.',
            409,
            'CONFLICT',
          );
        const latest = await loadCombatById(combatId, db);
        const { reactor: current } = await assertOpportunityActionable(
          db,
          latest,
          actor,
          opportunityId,
        );
        if (!hasFeat(current))
          throw new HttpError(
            'Este participante não possui Conjurador de Guerra.',
            409,
            'WAR_CASTER_REQUIRED',
          );
        eligibleDefinition(input.spell.spellId);
      },
      afterResolution: async (db, resolved) => {
        await db.combatOperation.create({
          data: {
            combatId,
            operationId: input.operationId,
            fingerprint,
            snapshot: { spellCastId: resolved.id },
          },
        });
        await db.reactionOpportunity.update({
          where: { id: opportunityId },
          data: { spellCastId: resolved.id },
        });
        await settleOpportunitySpell(db, resolved.id);
      },
    },
  );
  return {
    combat: toCombatDto(await loadCombatById(combatId), actor.role),
    cast,
  };
}
