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
import { loadEntity, type LoadedEntity } from '../../mechanical/mechanical.service.js';
import {
  assertCoverAllowsDirectTargeting,
  coverFor,
  type CoverSpatialProvider,
} from '../../combat/cover.service.js';
import {
  applyCoverConfirmation,
  coverSnapshotOf,
  type CoverConfirmation,
} from '../../combat/cover.js';
import {
  attackCountOf,
  type SpellExecutionDefinition,
} from './spell-execution-definition.js';
import {
  attackDamageSnapshotSchema,
  parseSpellResolutionSnapshot,
  type AttackDamageSnapshot,
  type SpellAttackOccurrenceSnapshot,
} from './spell-resolution-snapshot.js';

/**
 * FASE 6.6I.4 / 6.6J.4 — RESOLUÇÃO IMEDIATA DE ATAQUE MÁGICO (`attack-damage`).
 *
 * Estratégia GENÉRICA de execução de magia: o ataque é resolvido no COMMIT, na
 * mesma transação do `SpellCast`. Não há spell real registrada — a prova usa
 * uma definição SINTÉTICA de teste, e a estratégia roda no executor de produção
 * (nenhum `if (spellId)` no caminho).
 *
 * 6.6J.4 — MÚLTIPLAS JOGADAS DE ATAQUE:
 *  • UM `SpellCast` produz N OCORRÊNCIAS (`attacks[]`), cada uma com d20, dano,
 *    DamageEvent e consequências PRÓPRIAS;
 *  • `assignments[index]` diz quem aquela jogada ataca — o MESMO alvo pode
 *    aparecer várias vezes ([A, A, B]) e NUNCA é reduzido a um conjunto único;
 *  • o estado mecânico (CA, Conditions, Esquiva, Effects) é RELIDO antes de
 *    CADA jogada: o ataque 1 vê o alvo como o ataque 0 o deixou;
 *  • a SEQUÊNCIA é resolvida em ordem 0..N-1, dentro da transação: erro no meio
 *    desfaz tudo e retry devolve o snapshot sem rolar de novo.
 *
 * Invariantes que NÃO mudam:
 *  • o resolver é o MESMO dos ataques de arma (`combat/attack-resolution.ts`);
 *  • o bônus de ataque é o SNAPSHOT do `SpellCast` (6.6B) — nunca recalculado;
 *  • dano por hit passa SEMPRE por `resolveDamage` (6.6I.1);
 *  • crítico dobra os dados DAQUELA ocorrência, nunca o bônus fixo;
 *  • miss não rola dano, não mexe em HP e não pede Concentração;
 *  • nenhum EffectInstance/PendingEffectSave/Concentração do conjurador;
 *  • `occurrenceId`/`eventId` são DETERMINÍSTICOS por índice.
 */

export interface AttackDamageContext {
  caster: LoadedEntity;
  /**
   * Assignments na ORDEM do índice. Repetições são legítimas: `[A, A, B]`
   * significa duas jogadas contra A e uma contra B.
   */
  assignments: LoadedEntity[];
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
  /**
   * 6.6J.4: seleção POR OCORRÊNCIA. Usar o mesmo d4 em todos os raios seria
   * rerrolar por acidente; cada jogada tem a própria escolha.
   */
  selectedEffectModifiersByAttack?: Record<number, readonly string[]>;
  /**
   * 6.6J.5 — provider de COBERTURA injetável (assistido por padrão). A cobertura
   * é da RELAÇÃO caster ↔ alvo e é reavaliada em CADA jogada.
   */
  coverProvider?: CoverSpatialProvider;
  /** Confirmações do Mestre por alvo (só preenchem `unknown`/`not-assessed`). */
  coverConfirmations?: readonly CoverConfirmation[];
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

/** Identidade do ataque DENTRO do cast (índice estável, começa em 0). */
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

function uniqueTargets(occurrences: readonly SpellAttackOccurrenceSnapshot[]) {
  const seen = new Set<string>();
  const targets: { kind: string; id: string }[] = [];
  for (const occurrence of occurrences) {
    const key = `${occurrence.target.kind}:${occurrence.target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(occurrence.target);
  }
  return targets;
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

  // Quantidade é da DEFINIÇÃO, nunca do cliente. Divergência recusa ANTES de
  // rolar qualquer coisa (e antes de qualquer consequência): nada de "executar
  // dois raios e ignorar o terceiro".
  const attackCount = attackCountOf(execution);
  if (context.assignments.length !== attackCount) {
    throw new HttpError(
      `Esta conjuração exige exatamente ${attackCount} jogada(s) de ataque.`,
      400,
      'SPELL_ATTACK_COUNT_INVALID',
      { expected: attackCount, received: context.assignments.length },
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

  const roll: AttackRollSource = options.roll ?? ((sides: number) => rollDie(sides));
  const publications = new Set<string>();
  const deathTargets: MechanicalEntity[] = [];
  const affectedEffects: MechanicalEntity[] = [];
  let concentrationTarget: MechanicalEntity | null = null;
  const occurrences: SpellAttackOccurrenceSnapshot[] = [];

  // ORDEM DE RESOLUÇÃO: 0 → 1 → 2. Cada jogada relê o estado ATUAL, porque a
  // anterior pode ter mudado HP/Conditions/Concentração do alvo.
  for (let index = 0; index < attackCount; index += 1) {
    const assignment = context.assignments[index]!;
    const currentCaster = await loadEntity(context.caster.entity, db);
    const currentTarget = await loadEntity(assignment.entity, db);
    // COVER (6.6J.5): total cover recusa a jogada ANTES do d20 (nunca "+999 CA");
    // parcial vira +2/+5 na CA situacional, nunca no valor gravado da ficha.
    const coverEvaluation = applyCoverConfirmation(
      await coverFor(
        {
          origin: currentCaster.entity,
          target: currentTarget.entity,
          interaction: 'attack',
        },
        options.coverProvider,
      ),
      options.coverConfirmations?.find(
        (item) => item.targetKey === `${currentTarget.entity.kind}:${currentTarget.entity.id}`,
      )?.level,
    );
    assertCoverAllowsDirectTargeting(
      coverEvaluation,
      'SPELL_TARGET_TOTAL_COVER',
      'O alvo está em cobertura total e não pode ser escolhido diretamente.',
    );
    const cover = coverSnapshotOf(coverEvaluation);

    // Modificadores de Effect: consulta em lote, canonicalizando combatente de
    // personagem para a FICHA (mesma regra da 6.5A/6.5B). Refeita por ocorrência
    // porque dano pode encerrar Concentração/Effects entre as jogadas.
    const sets = await effectModifierSetsFor(
      [currentCaster.entity, currentTarget.entity],
      db,
    );
    const attackerSet = sets.get(entityKey(currentCaster.entity)) ?? emptyEffectModifierSet();
    const targetSet = sets.get(entityKey(currentTarget.entity)) ?? emptyEffectModifierSet();
    const attackerMods = rollModifiersFor(attackerSet, 'attack');
    const armorBonuses = effectArmorClassBonuses(targetSet);

    // Esquiva/Caído/visão: MESMA derivação dos ataques de arma, com o estado
    // atualizado do alvo NESTA jogada.
    const defense = await targetDefenseContextOf(db, currentTarget, targetSet.speedBonus);
    const { advantage, disadvantage } = conditionAttackMode(
      currentCaster.state,
      currentTarget.state,
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
    const selected =
      options.selectedEffectModifiersByAttack?.[index] ??
      options.selectedEffectModifiers ??
      [];
    // O d4 opcional (ex.: Bless) usa a MESMA fonte de aleatoriedade e é rolado
    // DEPOIS do(s) d20: a ordem dos dados de UMA jogada é sempre d20, dados de
    // efeito, dados de dano.
    const optional = rollSelectedOptional(attackerMods, [...selected], false, roll);

    // Dados de EFEITO no ATAQUE (ex.: Bless +1d4): nunca dobrados no crítico.
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

    // Bônus de ataque = SNAPSHOT do commit, igual em todas as jogadas.
    const total = selection.naturalRoll + attackBonus + effectBonus + effectDiceTotal;
    const baseTargetAc = await targetArmorClassOf(db, currentTarget.entity, armorBonuses);
    // COBERTURA situacional: só a interação deste ataque, nunca a ficha.
    const targetAc = baseTargetAc + cover.acBonus;
    const outcome = resolveAttackOutcome({
      naturalRoll: selection.naturalRoll,
      total,
      targetAc,
      critThreshold: resolution.attack.critThreshold ?? 20,
    });

    const occurrenceId = attackOccurrenceIdOf(fresh.id, index);
    const eventId = attackDamageEventIdOf(fresh.id, index);
    let damageSnapshot: SpellAttackOccurrenceSnapshot['damage'] = null;
    let occurrenceReason: SpellAttackOccurrenceSnapshot['noEffectReason'] = outcome.hit
      ? null
      : 'attack-miss';

    if (outcome.hit) {
      // Crítico: TODOS os dados da jogada rolam duas vezes; bônus fixo, uma vez.
      const rolled = rollAttackDamageComponents(
        resolution.damage.components,
        outcome.critical,
        roll,
      );
      const damage = await resolveDamage(db, {
        eventId,
        source: { kind: 'spell', spellCastId: fresh.id, label: execution.spellId },
        target: await damageTargetOf(db, currentTarget.entity),
        components: rolled.map((component) => ({
          type: component.type,
          rawAmount: component.rawAmount,
        })),
        publications,
      });
      damageSnapshot = {
        eventId,
        components: rolled.map((component, componentIndex) => ({
          type: component.type,
          count: component.count,
          sides: component.sides,
          rolls: component.rolls,
          bonus: component.bonus,
          raw: component.rawAmount,
          applied: damage.components[componentIndex]?.applied ?? 0,
          modifier: damage.components[componentIndex]?.modifier ?? null,
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
        if (currentTarget.entity.kind !== 'creature') {
          const consequence = await applyDamageConsequences(
            currentTarget.entity,
            {
              damage: damage.finalDamage,
              hpBefore: damage.hpBefore ?? 0,
              hpTempBefore: damage.hpTempBefore,
              critical: outcome.critical,
              sourceName: currentCaster.name,
            },
            db,
            currentCaster.name,
          );
          if (consequence.changed) deathTargets.push(currentTarget.entity);
        }

        // UM teste por EVENTO, com o dano FINAL — hits separados no mesmo alvo
        // NUNCA são somados num único save.
        const concentration = await noteDamageConcentration(
          currentTarget.entity,
          damage.finalDamage,
          db,
          { eventId, sourceName: currentCaster.name },
        );
        if (concentration.changed) {
          concentrationTarget = concentrationTarget ?? currentTarget.entity;
        }
        affectedEffects.push(...concentration.endedEffectTargets);
      } else if (damage.finalDamage === 0) {
        // Acertou, mas resistência/imunidade zeraram tudo: sem consequência.
        occurrenceReason = 'zero-damage';
      }
    }

    occurrences.push({
      index,
      occurrenceId,
      target: { kind: currentTarget.entity.kind, id: currentTarget.entity.id },
      attack: {
        kind: resolution.attack.kind,
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
      selectedModifiers: [...selected],
      cover,
      noEffectReason: occurrenceReason,
    });
  }

  const anyEffect = occurrences.some((occurrence) => (occurrence.damage?.finalDamage ?? 0) > 0);
  const anyHit = occurrences.some((occurrence) => occurrence.attack.hit);
  const noEffectReason: AttackDamageSnapshot['noEffectReason'] = anyEffect
    ? null
    : anyHit
      ? 'zero-damage'
      : 'attack-miss';

  const snapshot: AttackDamageSnapshot = {
    kind: 'attack-damage',
    attacks: occurrences,
    // Resumo do conjunto canônico ÚNICO. Nunca reconstrói as ocorrências.
    targets: uniqueTargets(occurrences),
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
      outcome: anyEffect ? 'effect' : 'no-effect',
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
