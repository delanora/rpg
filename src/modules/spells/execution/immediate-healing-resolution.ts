import type { Prisma, SpellCast } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { rollDice } from '../../shared/dice.js';
import { ABILITY_KEYS, abilityModifier, type AbilityKey } from '../../shared/dnd5e.js';
import { creatureTypeMatches, creatureTypeOf } from '../../shared/creature-types.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import { slotScaledDiceCount } from '../../shared/spells/slot-scaling.js';
import { resolveHealing } from '../../combat/damage-resolution.js';
import { damageTargetOf } from '../../combat/damage-target.js';
import { applyHealConsequences, publishDeathUpdated } from '../../death/death.service.js';
import { publishCharacter, refreshCombatForEffects } from '../../combat/combat.service.js';
import { appendCombatJournal } from '../../combat/combat-journal.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { SpellExecutionDefinition } from './spell-execution-definition.js';
import { spellDisplayLabel } from './spell-execution-registry.js';
import {
  immediateHealingSnapshotSchema,
  type ImmediateHealingSnapshot,
} from './spell-resolution-snapshot.js';

/**
 * FASE 6.6I.3 — RESOLUÇÃO IMEDIATA DE CURA (prova: Palavra Curativa).
 *
 * Roda DENTRO da transação do COMMIT: espaço, Ação Bônus, SpellCast, rolagem,
 * HP e consequências de morte entram juntos ou não entram. A rolagem acontece
 * apenas depois das pré-condições, nunca antes — não existe d4 "solto".
 *
 * Invariantes:
 *  • dados, modificador, alvo e cura são derivados no SERVIDOR;
 *  • o modificador de conjuração sai do SNAPSHOT do cast, não de uma nova
 *    leitura da ficha;
 *  • o HP passa SEMPRE por `resolveHealing` (6.6I.1) — nenhuma soma direta;
 *  • a identidade do evento é determinística (`spell-cast:<id>:healing`);
 *  • mortos-vivos/constructos são alvos VÁLIDOS sem efeito (a definição declara
 *    os tipos; o núcleo de cura não vira "imunidade global");
 *  • nada de EffectInstance, PendingEffectSave, Concentração ou card interativo.
 */

export interface ImmediateHealingResult {
  cast: SpellCast;
  snapshot: ImmediateHealingSnapshot;
  publications: string[];
  deathTargets: MechanicalEntity[];
}

interface ImmediateHealingContext {
  caster: LoadedEntity;
  targets: LoadedEntity[];
  actorUserId: string;
}

export function healingEventIdOf(castId: string): string {
  return `spell-cast:${castId}:healing`;
}

function invalidResolution(): never {
  throw new HttpError(
    'Definição de execução inconsistente para cura imediata.',
    409,
    'SPELL_EXECUTION_NOT_IMPLEMENTED',
  );
}

/**
 * Modificador do atributo de conjuração NO COMMIT.
 *
 * Personagens já trazem o snapshot derivado (6.6B). Statblock explícito pode
 * declarar o atributo sem o modificador; aí a leitura é do atributo do
 * statblock — nunca de ND nem de uma fórmula de personagem.
 */
async function abilityModifierOfCast(db: Prisma.TransactionClient, cast: SpellCast): Promise<number> {
  if (cast.spellcastingAbilityModifier !== null) return cast.spellcastingAbilityModifier;
  const ability = cast.spellcastingAbility;
  if (!ability || !ABILITY_KEYS.includes(ability as AbilityKey)) {
    throw new HttpError(
      'Este conjurador não declara o atributo de conjuração exigido pela magia.',
      409,
      'SPELLCASTING_ABILITY_REQUIRED',
    );
  }
  let score: number | null = null;
  if (cast.casterEntityKind === 'character') {
    const row = await db.character.findUnique({ where: { id: cast.casterEntityId } });
    score = row ? ((row as unknown as Record<string, number>)[ability] ?? null) : null;
  } else if (cast.casterEntityKind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: cast.casterEntityId } });
    score = row ? ((row as unknown as Record<string, number>)[ability] ?? null) : null;
  } else {
    const row = await db.combatant.findUnique({
      where: { id: cast.casterEntityId },
      include: { creature: true },
    });
    score = row?.creature
      ? ((row.creature as unknown as Record<string, number>)[ability] ?? null)
      : null;
  }
  if (score === null) {
    throw new HttpError(
      'O statblock não possui o atributo de conjuração exigido pela magia.',
      409,
      'SPELLCASTING_ABILITY_REQUIRED',
    );
  }
  return abilityModifier(score);
}

/** Motivo auditável de uma conjuração válida que não restaurou PV. */
function noEffectReasonOf(result: {
  finalHealing: number;
  hpAfter: number;
  hpMax: number;
}): ImmediateHealingSnapshot['noEffectReason'] {
  if (result.finalHealing > 0) return null;
  if (result.hpAfter >= result.hpMax) return 'target-at-max-hp';
  return 'zero-healing';
}

export async function resolveImmediateHealing(
  db: Prisma.TransactionClient,
  cast: SpellCast,
  context: ImmediateHealingContext,
  execution: SpellExecutionDefinition,
): Promise<ImmediateHealingResult> {
  const resolution = execution.resolution;
  if (resolution.kind !== 'immediate-healing') invalidResolution();
  if (context.targets.length !== 1) {
    // A Palavra Curativa tem exatamente UM alvo e o upcast não adiciona alvos.
    // A engine não finge suportar multi-alvo imediato sem contrato próprio.
    throw new HttpError(
      'A resolução imediata de cura com múltiplos alvos ainda não foi implementada.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }
  if (resolution.healing.abilityModifier !== 'spellcasting') invalidResolution();

  const target = context.targets[0];
  const abilityMod = await abilityModifierOfCast(db, cast);
  const count = slotScaledDiceCount(
    resolution.healing.slotScaling,
    cast.castAtLevel ?? resolution.healing.slotScaling.baseSpellLevel,
  );
  if (count < 1) {
    throw new HttpError(
      'O escalonamento desta magia não produz dados de cura.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }

  const eventId = healingEventIdOf(cast.id);
  const publications = new Set<string>();
  const deathTargets: MechanicalEntity[] = [];
  const type = await creatureTypeOf(target.entity, db);
  const immune =
    resolution.noEffectOnCreatureTypes !== undefined &&
    creatureTypeMatches(type, resolution.noEffectOnCreatureTypes);

  let rolls: number[] = [];
  let rolledTotal = 0;
  let requestedHealing = 0;
  let finalHealing = 0;
  let hpBefore = target.hpCurrent;
  let hpAfter = target.hpCurrent;
  let noEffectReason: ImmediateHealingSnapshot['noEffectReason'] = null;

  if (immune) {
    noEffectReason = 'creature-type-immune';
  } else {
    const rolled = rollDice(`${count}d${resolution.healing.dice.sides}`);
    if (!rolled) throw new HttpError('Não foi possível rolar a cura desta magia.', 500);
    rolls = rolled.rolls;
    rolledTotal = rolled.total;
    requestedHealing = Math.max(0, rolledTotal + abilityMod);
    const healed = await resolveHealing(db, {
      eventId,
      source: { kind: 'spell', spellCastId: cast.id, label: execution.spellId },
      target: await damageTargetOf(db, target.entity),
      amount: requestedHealing,
      publications,
    });
    if (!healed) {
      throw new HttpError('O alvo não existe mais neste combate.', 409, 'CONFLICT');
    }
    hpBefore = healed.hpBefore;
    hpAfter = healed.hpAfter;
    finalHealing = healed.finalHealing;
    if (finalHealing > 0) {
      const death = await applyHealConsequences(
        target.entity,
        hpAfter,
        db,
        context.caster.name,
      );
      if (death.changed) deathTargets.push(target.entity);
    }
    noEffectReason = noEffectReasonOf({ finalHealing, hpAfter, hpMax: healed.hpMax });
  }

  const snapshot: ImmediateHealingSnapshot = {
    kind: 'immediate-healing',
    eventId,
    spellId: cast.spellId,
    castAtLevel: cast.castAtLevel ?? 0,
    ability: cast.spellcastingAbility,
    abilityModifier: abilityMod,
    dice: { count, sides: resolution.healing.dice.sides, rolls },
    rolledTotal,
    requestedHealing,
    finalHealing,
    target: { kind: target.entity.kind, id: target.entity.id },
    hpBefore,
    hpAfter,
    noEffectReason,
    at: new Date().toISOString(),
  };
  // Revalida o próprio snapshot antes de persistir: o registro é auditável e
  // nunca recebe um formato que a leitura não reconheça.
  immediateHealingSnapshotSchema.parse(snapshot);

  const updated = await db.spellCast.update({
    where: { id: cast.id },
    data: {
      status: 'resolved',
      outcome: finalHealing > 0 ? 'effect' : 'no-effect',
      resolutionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      resolutionReason: noEffectReason,
      resolvedAt: new Date(),
    },
  });

  return {
    cast: updated,
    snapshot,
    publications: [...publications],
    deathTargets,
  };
}

/**
 * Publica DEPOIS do commit: ficha (HP/Testes contra a Morte), ciclo de morte e
 * o combate (HP de instância), mais UMA linha legível no Registro.
 *
 * Nenhum cliente aplica cura otimista: o servidor é a fonte de verdade.
 */
export async function publishImmediateHealing(result: ImmediateHealingResult): Promise<void> {
  for (const id of result.publications) await publishCharacter(id);
  for (const entity of result.deathTargets) await publishDeathUpdated(entity);
  if (result.cast.combatId) {
    await refreshCombatForEffects();
    const label = spellDisplayLabel(result.cast.spellId) ?? result.cast.spellId;
    const snapshot = result.snapshot;
    const message =
      snapshot.noEffectReason === 'creature-type-immune'
        ? `${label} — sem efeito neste tipo de criatura.`
        : snapshot.noEffectReason === 'target-at-max-hp'
          ? `${label} — o alvo já estava com os PV máximos.`
          : snapshot.finalHealing > 0
            ? `${label} — Cura: ${snapshot.finalHealing} PV restaurados` +
              (snapshot.rolledTotal + snapshot.abilityModifier !== snapshot.finalHealing
                ? ` (${Math.max(0, snapshot.rolledTotal + snapshot.abilityModifier)} curados, limitados pelo máximo).`
                : '.')
            : `${label} — nenhuma cura aplicada.`;
    await appendCombatJournal({
      combatId: result.cast.combatId,
      actorName: result.cast.casterLabel ?? 'Sistema',
      message,
      action: 'spell-heal',
    });
  }
}

void prisma;
