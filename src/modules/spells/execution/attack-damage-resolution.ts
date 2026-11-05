import type { Prisma, SpellCast } from '@prisma/client';
import { HttpError } from '../../../lib/http-error.js';
import { rollDie } from '../../shared/dice.js';
import { conditionAttackMode, type MechanicalEntity } from '../../shared/conditions.js';
import {
  effectArmorClassBonuses,
  publicEffectLabel,
  rollModifierSourceLabels,
  rollModifiersFor,
  emptyEffectModifierSet,
} from '../../effects/effect-modifiers.js';
import { effectModifierSetsFor, publishEffects } from '../../effects/effects.service.js';
import { rollSelectedOptional } from '../../dice/effect-optional.js';
import { resolveDamage } from '../../combat/damage-resolution.js';
import { damageTargetOf } from '../../combat/damage-target.js';
import {
  resolveAttackOutcome,
  rollAttackDamageComponents,
  selectAttackRoll,
  targetArmorClassOf,
  targetDefenseContextOf,
  type AttackRollSource,
} from '../../combat/attack-resolution.js';
import { applyDamageConsequences, publishDeathUpdated } from '../../death/death.service.js';
import { noteDamageConcentration } from '../../concentration/concentration.service.js';
import { publishCharacter, refreshCombatForEffects } from '../../combat/combat.service.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { SpellExecutionDefinition } from './spell-execution-definition.js';
import {
  attackDamageSnapshotSchema,
  parseSpellResolutionSnapshot,
  type AttackDamageSnapshot,
} from './spell-resolution-snapshot.js';

/**
 * FASE 6.6I.4 — RESOLUÇÃO IMEDIATA DE ATAQUE MÁGICO (`attack-damage`).
 *
 * Estratégia GENÉRICA de execução de magia: o ataque é resolvido no COMMIT, na
 * mesma transação do `SpellCast`. Não há spell real registrada — a prova usa
 * uma definição SINTÉTICA de teste, e a estratégia já roda no executor de
 * produção (nenhum `if (spellId)` no caminho).
 *
 * Invariantes:
 *  • d20, vantagem/desvantagem, 1/20 natural, crítico e dano são do SERVIDOR;
 *  • o resolver é o MESMO dos ataques de arma (`combat/attack-resolution.ts`);
 *  • o bônus de ataque é o SNAPSHOT do `SpellCast` (6.6B) — nunca recalculado;
 *  • a CA é o estado ATUAL do alvo (`computeArmorClass`/statblock), não um
 *    valor congelado no cast;
 *  • o dano passa SEMPRE por `resolveDamage` (6.6I.1): defesas, HP, morte,
 *    Concentração e defesas por tipo não são reimplementados aqui;
 *  • miss não cria evento de dano, não mexe em HP e não pede Concentração;
 *  • nenhum EffectInstance/PendingEffectSave/Concentração do conjurador;
 *  • eventId e occurrenceId são DETERMINÍSTICOS — retry não rola de novo.
 */

export interface AttackDamageContext {
  caster: LoadedEntity;
  targets: LoadedEntity[];
}

export interface AttackDamageOptions {
  /**
   * Fonte de aleatoriedade INJETÁVEL — usada por testes determinísticos de
   * nat 1/nat 20/crítico/advantage. NUNCA vem de HTTP.
   */
  roll?: AttackRollSource;
  /**
   * IDs de modificadores OPCIONAIS oferecidos (`effectId:key`). O cliente só
   * devolve identidades; o servidor revalida (6.5G).
   */
  selectedEffectModifiers?: string[];
}

export interface AttackDamageResult {
  cast: SpellCast;
  snapshot: AttackDamageSnapshot;
  replayed: boolean;
  publications: string[];
  deathTargets: MechanicalEntity[];
  /** Alvo cujo teste de Concentração nasceu (publicar depois do commit). */
  concentrationTarget: MechanicalEntity | null;
  affectedEffects: MechanicalEntity[];
}

/** Identidade do ataque DENTRO do cast (hoje sempre índice 0). */
export function attackOccurrenceIdOf(castId: string, index = 0): string {
  return `spell-cast:${castId}:attack:${index}`;
}

/** Identidade do EVENTO de dano do ataque (Concentração usa esta mesma). */
export function attackDamageEventIdOf(castId: string, index = 0): string {
  return `${attackOccurrenceIdOf(castId, index)}:damage`;
}

function invalidResolution(): never {
  throw new HttpError(
    'Definição de execução inconsistente para ataque mágico.',
    409,
    'SPELL_EXECUTION_NOT_IMPLEMENTED',
  );
}

function replayOf(row: SpellCast): AttackDamageResult {
  const snapshot = parseSpellResolutionSnapshot(row.resolutionSnapshot);
  if (!snapshot || snapshot.kind !== 'attack-damage') invalidResolution();
  return {
    cast: row,
    snapshot,
    replayed: true,
    publications: [],
    deathTargets: [],
    concentrationTarget: null,
    affectedEffects: [],
  };
}

function entityKey(entity: MechanicalEntity): string {
  return `${entity.kind}:${entity.id}`;
}

export async function resolveAttackDamageSpell(
  db: Prisma.TransactionClient,
  cast: SpellCast,
  context: AttackDamageContext,
  execution: SpellExecutionDefinition,
  options: AttackDamageOptions = {},
): Promise<AttackDamageResult> {
  const resolution = execution.resolution;
  if (resolution.kind !== 'attack-damage') invalidResolution();
  if (context.targets.length !== 1) {
    // Um cast = um ataque nesta fase. Eldritch Blast/Scorching Ray (múltiplos
    // raios) exigem `attacks[]` no snapshot — o contrato atual é 1 ataque.
    throw new HttpError(
      'Ataque mágico com múltiplos alvos ainda não foi implementado.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }
  if (cast.status !== 'resolving') return replayOf(cast);

  // Serializa a resolução do MESMO cast (retry concorrente não rola duas vezes).
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cast.id}))`;
  const fresh = await db.spellCast.findUniqueOrThrow({ where: { id: cast.id } });
  if (fresh.status !== 'resolving') return replayOf(fresh);

  const attackBonus = fresh.spellAttackBonus;
  if (attackBonus === null || attackBonus === undefined) {
    throw new HttpError(
      'Esta conjuração não tem bônus de ataque mágico no snapshot.',
      409,
      'SPELLCASTING_ATTACK_BONUS_REQUIRED',
    );
  }

  const target = context.targets[0];
  const roll: AttackRollSource = options.roll ?? ((sides: number) => rollDie(sides));

  // Modificadores de Effect: UMA consulta em lote, canonicalizando combatente
  // de personagem para a FICHA (mesma regra da 6.5A/6.5B).
  const sets = await effectModifierSetsFor([context.caster.entity, target.entity], db);
  const attackerSet = sets.get(entityKey(context.caster.entity)) ?? emptyEffectModifierSet();
  const targetSet = sets.get(entityKey(target.entity)) ?? emptyEffectModifierSet();
  const attackerMods = rollModifiersFor(attackerSet, 'attack');
  const armorBonuses = effectArmorClassBonuses(targetSet);

  // Esquiva/Caído/visão: MESMA derivação dos ataques de arma. Nada específico
  // de magia aqui — só o `attackRanged` do MODO declarado pela definição.
  const defense = await targetDefenseContextOf(db, target, targetSet.speedBonus);
  const { advantage, disadvantage } = conditionAttackMode(
    context.caster.state,
    target.state,
    false,
    false,
    {
      targetDodging: defense.targetDodging,
      targetSpeed: defense.targetSpeed,
      attackRanged: resolution.attack.kind === 'ranged',
      effectAdvantages: attackerMods.advantage,
      effectDisadvantages: attackerMods.disadvantage,
    },
  );

  const selection = selectAttackRoll({ advantage, disadvantage, roll });
  // O d4 opcional (ex.: Bless) usa a MESMA fonte de aleatoriedade do ataque e é
  // rolado DEPOIS do(s) d20 — a ordem dos dados de um ataque é sempre: d20,
  // dados de efeito, dados de dano. Assim retry/teste não dependem do RNG.
  const optional = rollSelectedOptional(attackerMods, options.selectedEffectModifiers, false, roll);

  // Dados de EFEITO no ATAQUE (ex.: Bless +1d4): rolados aqui, no servidor, e
  // NUNCA dobrados no crítico — eles modificam o ataque, não o dano.
  const effectDice = [
    ...attackerMods.dice.flatMap((modifier) =>
      Array.from({ length: modifier.count }, () => ({
        sides: modifier.sides,
        value: roll(modifier.sides),
        sign: modifier.sign,
        label: publicEffectLabel(modifier.source),
      })),
    ),
    ...optional.dice.map((die) => ({
      sides: die.sides,
      value: die.value,
      sign: die.sign,
      label: die.label,
    })),
  ];
  const effectBonus = attackerMods.bonus + optional.bonus;
  const effectDiceTotal = effectDice.reduce((sum, die) => sum + die.value * die.sign, 0);

  // Bônus de ataque = SNAPSHOT do commit. Mudar o atributo da ficha depois NÃO
  // reescreve este ataque.
  const total = selection.naturalRoll + attackBonus + effectBonus + effectDiceTotal;
  const targetAc = await targetArmorClassOf(db, target.entity, armorBonuses);
  const outcome = resolveAttackOutcome({
    naturalRoll: selection.naturalRoll,
    total,
    targetAc,
    critThreshold: resolution.attack.critThreshold ?? 20,
  });

  const occurrenceId = attackOccurrenceIdOf(fresh.id);
  const eventId = attackDamageEventIdOf(fresh.id);
  const publications = new Set<string>();
  const deathTargets: MechanicalEntity[] = [];
  const affectedEffects: MechanicalEntity[] = [];
  let concentrationTarget: MechanicalEntity | null = null;
  let damageSnapshot: AttackDamageSnapshot['damage'] = null;
  let noEffectReason: AttackDamageSnapshot['noEffectReason'] = outcome.hit
    ? null
    : 'attack-miss';

  if (outcome.hit) {
    // Crítico: TODOS os dados do ataque rolam duas vezes; bônus fixo, uma vez.
    const rolled = rollAttackDamageComponents(resolution.damage.components, outcome.critical, roll);
    const damage = await resolveDamage(db, {
      eventId,
      source: { kind: 'spell', spellCastId: fresh.id, label: execution.spellId },
      target: await damageTargetOf(db, target.entity),
      components: rolled.map((component) => ({ type: component.type, rawAmount: component.rawAmount })),
      publications,
    });
    damageSnapshot = {
      eventId,
      components: rolled.map((component, index) => ({
        type: component.type,
        count: component.count,
        sides: component.sides,
        rolls: component.rolls,
        bonus: component.bonus,
        raw: component.rawAmount,
        applied: damage.components[index]?.applied ?? 0,
        modifier: damage.components[index]?.modifier ?? null,
      })),
      rawDamage: damage.rawDamage,
      finalDamage: damage.finalDamage,
      hpBefore: damage.hpBefore,
      hpAfter: damage.hpAfter,
      critical: outcome.critical,
    };

    if (damage.finalDamage > 0 && damage.hpAfter !== null) {
      // Ciclo de morte: criatura SOLTA do bestiário não abre Testes contra a
      // Morte (a instância de combate abre) — mesma regra da 6.6I.2.
      if (target.entity.kind !== 'creature') {
        const consequence = await applyDamageConsequences(
          target.entity,
          {
            damage: damage.finalDamage,
            hpBefore: damage.hpBefore ?? 0,
            hpTempBefore: damage.hpTempBefore,
            critical: outcome.critical,
            sourceName: context.caster.name,
          },
          db,
          context.caster.name,
        );
        if (consequence.changed) deathTargets.push(target.entity);
      }

      // UM teste por EVENTO, com o dano FINAL — a identidade é o mesmo eventId.
      const concentration = await noteDamageConcentration(target.entity, damage.finalDamage, db, {
        eventId,
        sourceName: context.caster.name,
      });
      if (concentration.changed) concentrationTarget = target.entity;
      affectedEffects.push(...concentration.endedEffectTargets);
    } else if (damage.finalDamage === 0) {
      // Acertou, mas resistência/imunidade zeraram tudo: sem consequência.
      noEffectReason = 'zero-damage';
    }
  }

  const snapshot: AttackDamageSnapshot = {
    kind: 'attack-damage',
    attack: {
      kind: resolution.attack.kind,
      index: 0,
      occurrenceId,
      naturalRoll: selection.naturalRoll,
      rolls: selection.rolls,
      mode: selection.mode,
      attackBonus,
      effectBonus,
      effectDice,
      sources: rollModifierSourceLabels(attackerMods),
      total,
      targetAc,
      hit: outcome.hit,
      critical: outcome.critical,
      autoMiss: outcome.autoMiss,
      autoHit: outcome.autoHit,
    },
    damage: damageSnapshot,
    target: { kind: target.entity.kind, id: target.entity.id },
    casterName: context.caster.name,
    noEffectReason,
    at: new Date().toISOString(),
  };
  // Revalida antes de persistir: leitura e escrita usam o mesmo contrato.
  attackDamageSnapshotSchema.parse(snapshot);

  const updated = await db.spellCast.update({
    where: { id: fresh.id },
    data: {
      status: 'resolved',
      outcome: (damageSnapshot?.finalDamage ?? 0) > 0 ? 'effect' : 'no-effect',
      resolutionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      resolutionReason: noEffectReason,
      resolvedAt: new Date(),
    },
  });

  return {
    cast: updated,
    snapshot,
    replayed: false,
    publications: [...publications],
    deathTargets,
    concentrationTarget,
    affectedEffects,
  };
}

/**
 * Publica DEPOIS do commit: HP/concentração/Effects do alvo e o combate (HP da
 * instância). Nenhum cliente aplica dano otimista.
 */
export async function publishAttackDamageResult(result: AttackDamageResult): Promise<void> {
  if (result.replayed) return;
  for (const id of result.publications) await publishCharacter(id);
  for (const entity of result.deathTargets) await publishDeathUpdated(entity);
  if (result.concentrationTarget?.kind === 'character') {
    await publishCharacter(result.concentrationTarget.id);
  }
  if (result.affectedEffects.length > 0) {
    await publishEffects([
      ...result.affectedEffects,
      ...(result.concentrationTarget ? [result.concentrationTarget] : []),
    ]);
  }
  if (result.cast.combatId) await refreshCombatForEffects();
}
