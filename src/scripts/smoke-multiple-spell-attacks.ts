import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/prisma.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import {
  attackDamageEventIdOf,
  attackOccurrenceIdOf,
  resolveAttackDamageSpell,
  type AttackDamageOptions,
} from '../modules/spells/execution/attack-damage-resolution.js';
import {
  attackCountOf,
  type SpellExecutionDefinition,
} from '../modules/spells/execution/spell-execution-definition.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { getSpell } from '../modules/shared/spells/index.js';
import { mechanicalStateOf, type MechanicalEntity } from '../modules/shared/conditions.js';
import {
  parseSpellResolutionSnapshot,
  type AttackDamageSnapshot,
} from '../modules/spells/execution/spell-resolution-snapshot.js';
import { toSpellCastDto } from '../modules/spells/execution/spell-cast.dto.js';
import { castFingerprint } from '../modules/spells/execution/spell-cast.service.js';
import { toSpellCastIntentDto } from '../modules/spells/execution/spell-intent.service.js';
import { BLESS_LABEL, blessModifiers } from '../modules/effects/definitions/bless.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6J.4 — SMOKE DE MÚLTIPLAS JOGADAS DE ATAQUE.
 *
 * Prova, com fixtures próprias e definição SINTÉTICA:
 *  • UM `SpellCast` com N ocorrências, cada uma com d20/dano/evento próprios;
 *  • `[A, A, B]` sobrevive inteiro (o conjunto único é só resumo);
 *  • estado mecânico (CA, Esquiva, HP, Concentração) é relido POR JOGADA;
 *  • miss não rola dano e o crítico não vaza para as outras jogadas;
 *  • replay/retry e concorrência não rerrolam nem reaplicam;
 *  • snapshot legado (uma jogada) continua legível (normalização, sem migration);
 *  • a definição sintética não está no catálogo/registry de produção.
 */

const SYNTHETIC_SPELL_ID = 'test.synthetic-multi-attack';

const TARGETING: SpellExecutionDefinition['targeting'] = {
  kind: 'creatures',
  minTargets: 1,
  targetCount: { base: 3, baseSlotLevel: 0, additionalPerSlotLevel: 0 },
  range: { kind: 'distance', feet: 120 },
  allowSelf: true,
  allowRepeatedTarget: true,
  requiresSight: false,
  requiresClearPath: true,
  filters: [],
  groupConstraints: [],
};

function syntheticDefinition(
  count: number,
  components: { type: string; dice?: { count: number; sides: number }; bonus?: number }[] = [
    { type: 'Força', dice: { count: 1, sides: 10 } },
  ],
): SpellExecutionDefinition {
  return {
    spellId: SYNTHETIC_SPELL_ID,
    requiresConcentration: false,
    targeting: TARGETING,
    resolution: {
      kind: 'attack-damage',
      attacks: { count: { kind: 'fixed', count } },
      attack: { kind: 'ranged' },
      damage: { components },
    },
  };
}

const THREE_ATTACKS = syntheticDefinition(3);
const SINGLE_ATTACK = syntheticDefinition(1);
const TWO_ATTACKS = syntheticDefinition(2);

/** Fonte determinística que também registra QUAIS dados foram pedidos. */
function recorder(values: number[]): {
  roll: (sides: number) => number;
  calls: number[];
} {
  let index = 0;
  const calls: number[] = [];
  return {
    calls,
    roll: (sides: number) => {
      calls.push(sides);
      const value = values[index % values.length] ?? 1;
      index += 1;
      return value;
    },
  };
}

export async function smokeMultipleSpellAttacks(baseUrl: string, check: Check): Promise<void> {
  console.log('\n84) Fase 6.6J.4 — múltiplas jogadas de ataque em UM SpellCast');
  void baseUrl;

  const sourceOf = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  const effectIds: string[] = [];
  const castIds: string[] = [];
  const intentIds: string[] = [];

  const entity = (kind: MechanicalEntity['kind'], id: string): MechanicalEntity => ({ kind, id });

  try {
    // =====================================================================
    // CONTRATO — quantidade server-side e ausência de campos do cliente
    // =====================================================================
    check(
      '84.A) a quantidade de jogadas vem da DEFINIÇÃO (3), o contrato não aceita `attackCount` do cliente e a definição aceita repetição',
      attackCountOf(THREE_ATTACKS) === 3 &&
        attackCountOf(SINGLE_ATTACK) === 1 &&
        (THREE_ATTACKS.targeting.kind === 'creatures' &&
          THREE_ATTACKS.targeting.allowRepeatedTarget === true),
      JSON.stringify({ three: attackCountOf(THREE_ATTACKS), single: attackCountOf(SINGLE_ATTACK) }),
    );
    const castSchemaSource = sourceOf('../modules/spells/execution/spell-cast.schema.ts');
    const attackSource = sourceOf('../modules/spells/execution/attack-damage-resolution.ts');
    check(
      '84.B) cliente NÃO envia d20/AC/acerto/crítico/dano: o schema do cast não tem esses campos e o resolvedor usa o resolver compartilhado',
      !castSchemaSource.includes('attackCount') &&
        !castSchemaSource.includes('attackBonus') &&
        !castSchemaSource.includes('naturalRoll') &&
        !castSchemaSource.includes('targetAc') &&
        !castSchemaSource.includes('critical') &&
        attackSource.includes("from '../../combat/attack-resolution.js'") &&
        attackSource.includes('selectAttackRoll(') &&
        attackSource.includes('resolveAttackOutcome(') &&
        !attackSource.includes('Math.random'),
      JSON.stringify({ schema: castSchemaSource.length }),
    );

    // =====================================================================
    // FIXTURES PRÓPRIAS (nunca dados reais da campanha)
    // =====================================================================
    const suffix = randomUUID().slice(0, 8);
    let userSeq = 0;
    const makeUser = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          username: `ma_${label}_${(userSeq += 1)}_${suffix}`,
          displayName: `MA ${label}`,
          passwordHash: 'fixture',
          role: 'PLAYER',
        },
      });
      userIds.push(user.id);
      return user;
    };
    const makeCharacter = async (name: string, data: Record<string, unknown> = {}) => {
      const owner = await makeUser(name.slice(0, 6).toLowerCase());
      const character = await prisma.character.create({
        data: {
          userId: owner.id,
          name,
          hpCurrent: 60,
          hpMax: 60,
          speed: 9,
          dexterity: 10,
          wisdom: 16,
          charisma: 12,
          armorClass: 12,
          classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
          ...data,
        } as never,
      });
      characterIds.push(character.id);
      return character;
    };

    const caster = await makeCharacter('Conjurador multi');
    const targetA = await makeCharacter('Alvo A');
    const targetB = await makeCharacter('Alvo B');
    const concentrationTarget = await makeCharacter('Alvo concentrando', {
      mechanicalState: {
        conditions: [],
        concentration: {
          id: `conc-${suffix}`,
          label: 'Bless',
          sourceType: 'manual',
          visibility: 'public',
          startedAt: new Date().toISOString(),
          startedBy: 'fixture',
        },
        pendingConcentrationSaves: [],
      },
    });
    const sequenceTarget = await makeCharacter('Alvo da sequência');
    const parallelTarget = await makeCharacter('Alvo concorrente');

    const creature = await prisma.creature.create({
      data: {
        name: 'Criatura de prova multi',
        type: 'Besta',
        hpCurrent: 40,
        hpMax: 40,
        armorClass: 12,
        speed: 9,
        dexterity: 10,
        wisdom: 10,
      } as never,
    });
    creatureIds.push(creature.id);

    const casterEntity = entity('character', caster.id);
    const aEntity = entity('character', targetA.id);
    const bEntity = entity('character', targetB.id);
    const concEntity = entity('character', concentrationTarget.id);
    const seqEntity = entity('character', sequenceTarget.id);
    const parallelEntity = entity('character', parallelTarget.id);
    const creatureEntity = entity('creature', creature.id);

    const makeCast = async (targetEntities: MechanicalEntity[], bonus = 6) => {
      const unique = new Map(targetEntities.map((item) => [`${item.kind}:${item.id}`, item]));
      const cast = await prisma.spellCast.create({
        data: {
          spellId: SYNTHETIC_SPELL_ID,
          casterEntityKind: 'character',
          casterEntityId: caster.id,
          casterLabel: caster.name,
          targets: [...unique.values()] as never,
          status: 'resolving',
          requiresConcentration: false,
          spellcastingMode: 'derived',
          spellcastingAbility: 'wisdom',
          spellcastingAbilityModifier: 3,
          spellcastingProficiencyBonus: 3,
          spellSaveDc: 14,
          spellAttackBonus: bonus,
          spellLevel: 0,
          castAtLevel: 0,
          operationId: `synthetic-multi-${randomUUID()}`,
          fingerprint: randomUUID(),
          committedAt: new Date(),
        },
      });
      castIds.push(cast.id);
      return cast;
    };

    const run = (
      castId: string,
      assignments: MechanicalEntity[],
      execution: SpellExecutionDefinition,
      options: AttackDamageOptions = {},
    ) =>
      prisma.$transaction(async (tx) => {
        const loadedCaster = await loadEntity(casterEntity, tx);
        const loaded = await Promise.all(assignments.map((item) => loadEntity(item, tx)));
        const row = await tx.spellCast.findUniqueOrThrow({ where: { id: castId } });
        return resolveAttackDamageSpell(
          tx,
          row,
          { caster: loadedCaster, assignments: loaded },
          execution,
          options,
        );
      });

    const snapshotOf = async (castId: string): Promise<AttackDamageSnapshot> => {
      const row = await prisma.spellCast.findUniqueOrThrow({ where: { id: castId } });
      const snapshot = parseSpellResolutionSnapshot(row.resolutionSnapshot);
      if (!snapshot || snapshot.kind !== 'attack-damage') throw new Error('snapshot ausente');
      return snapshot;
    };
    const hpOf = async (characterId: string) =>
      (await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).hpCurrent;

    // =====================================================================
    // SEQUÊNCIA PRINCIPAL — [A, A, B]: acerto, crítico e erro
    // =====================================================================
    const mainCast = await makeCast([aEntity, bEntity]);
    const mainRecorder = recorder([10, 4, 20, 6, 7, 2]);
    const main = await run(mainCast.id, [aEntity, aEntity, bEntity], THREE_ATTACKS, {
      roll: mainRecorder.roll,
    });
    const mainHpA = await hpOf(targetA.id);
    const mainHpB = await hpOf(targetB.id);
    check(
      '84.C) UM cast → TRÊS ocorrências: acerto (4), crítico (6+7=13) e erro; HP de A cai em sequência e B não é tocado',
      main.snapshot.attacks.length === 3 &&
        main.snapshot.attacks[0]?.attack.hit === true &&
        main.snapshot.attacks[0]?.damage?.finalDamage === 4 &&
        main.snapshot.attacks[1]?.attack.critical === true &&
        main.snapshot.attacks[1]?.damage?.finalDamage === 13 &&
        main.snapshot.attacks[2]?.attack.hit === false &&
        main.snapshot.attacks[2]?.damage === null &&
        mainHpA === 43 &&
        mainHpB === 60 &&
        main.cast.outcome === 'effect',
      JSON.stringify({
        attacks: main.snapshot.attacks.map((occurrence) => ({
          index: occurrence.index,
          hit: occurrence.attack.hit,
          critical: occurrence.attack.critical,
          damage: occurrence.damage?.finalDamage ?? null,
        })),
        hpA: mainHpA,
        hpB: mainHpB,
      }),
    );
    check(
      '84.D) ordem de RNG por ocorrência: d20 → dano do acerto → d20 → 2 dados do crítico → d20 do erro (miss NÃO rola dano)',
      mainRecorder.calls.join(',') === '20,10,20,10,10,20',
      JSON.stringify({ calls: mainRecorder.calls }),
    );
    check(
      '84.E) identidades independentes: occurrenceId/damage eventId por índice, e dois hits no MESMO alvo são DOIS eventos',
      main.snapshot.attacks[0]?.occurrenceId === attackOccurrenceIdOf(mainCast.id, 0) &&
        main.snapshot.attacks[1]?.occurrenceId === attackOccurrenceIdOf(mainCast.id, 1) &&
        main.snapshot.attacks[2]?.occurrenceId === attackOccurrenceIdOf(mainCast.id, 2) &&
        main.snapshot.attacks[0]?.damage?.eventId === attackDamageEventIdOf(mainCast.id, 0) &&
        main.snapshot.attacks[1]?.damage?.eventId === attackDamageEventIdOf(mainCast.id, 1) &&
        main.snapshot.attacks[0]?.damage?.eventId !== main.snapshot.attacks[1]?.damage?.eventId,
      JSON.stringify(main.snapshot.attacks.map((occurrence) => occurrence.occurrenceId)),
    );
    check(
      '84.F) HP sequencial: cada ocorrência registra o próprio hpBefore/hpAfter (56→43, nunca 60→43 somado)',
      main.snapshot.attacks[0]?.damage?.hpBefore === 60 &&
        main.snapshot.attacks[0]?.damage?.hpAfter === 56 &&
        main.snapshot.attacks[1]?.damage?.hpBefore === 56 &&
        main.snapshot.attacks[1]?.damage?.hpAfter === 43,
      JSON.stringify({
        first: main.snapshot.attacks[0]?.damage,
        second: main.snapshot.attacks[1]?.damage,
      }),
    );
    check(
      '84.G) o snapshot preserva [A, A, B] nos assignments e o cast guarda só o conjunto ÚNICO [A, B]',
      main.snapshot.attacks.map((occurrence) => occurrence.target.id).join(',') ===
        `${targetA.id},${targetA.id},${targetB.id}` &&
        main.snapshot.targets.length === 2 &&
        (
          (await prisma.spellCast.findUniqueOrThrow({ where: { id: mainCast.id } }))
            .targets as unknown as unknown[]
        ).length === 2,
      JSON.stringify({ targets: main.snapshot.targets }),
    );

    // =====================================================================
    // INDEPENDÊNCIA DOS DADOS — dados de dano não são reutilizados
    // =====================================================================
    check(
      '84.H) dados de dano independentes: 4 e (6+7) saíram de rolagens distintas, nunca de um roll compartilhado',
      main.snapshot.attacks[0]?.damage?.components[0]?.rolls.join(',') === '4' &&
        main.snapshot.attacks[1]?.damage?.components[0]?.rolls.join(',') === '6,7' &&
        main.snapshot.attacks[1]?.damage?.components[0]?.count === 2,
      JSON.stringify(main.snapshot.attacks.map((occurrence) => occurrence.damage?.components)),
    );

    // =====================================================================
    // ESTADO ATUAL POR OCORRÊNCIA — Esquiva por alvo
    // =====================================================================
    const dodgeCombat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 1,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: caster.id,
              name: caster.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 0,
              hpCurrent: 60,
              hpMax: 60,
              turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
            },
            {
              kind: 'CHARACTER',
              characterId: targetA.id,
              name: targetA.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: 0,
              hpCurrent: 43,
              hpMax: 60,
              turnEconomy: {
                actionsGranted: 1,
                actionsUsed: 0,
                movementBudget: 9,
                dodging: true,
              },
            },
          ],
        },
      },
    });
    combatIds.push(dodgeCombat.id);
    const dodgeCast = await makeCast([aEntity, bEntity]);
    const dodgeRun = await run(dodgeCast.id, [aEntity, bEntity], TWO_ATTACKS, {
      roll: recorder([2, 19, 10, 4]).roll,
    });
    check(
      '84.I) Esquiva é POR ALVO: as jogadas contra A têm desvantagem, a jogada contra B é normal',
      dodgeRun.snapshot.attacks[0]?.attack.mode === 'disadvantage' &&
        dodgeRun.snapshot.attacks[0]?.attack.rolls.length === 2 &&
        dodgeRun.snapshot.attacks[1]?.attack.mode === 'normal' &&
        dodgeRun.snapshot.attacks[1]?.attack.naturalRoll === 10,
      JSON.stringify(dodgeRun.snapshot.attacks.map((occurrence) => occurrence.attack.mode)),
    );
    await prisma.combat.delete({ where: { id: dodgeCombat.id } });
    combatIds.splice(combatIds.indexOf(dodgeCombat.id), 1);
    await prisma.character.update({ where: { id: targetA.id }, data: { hpCurrent: 60 } });

    // =====================================================================
    // CONCENTRAÇÃO — um teste por EVENTO, nunca somando os hits
    // =====================================================================
    const concCast = await makeCast([concEntity]);
    const concRun = await run(concCast.id, [concEntity, concEntity], TWO_ATTACKS, {
      roll: recorder([10, 7, 10, 12]).roll,
    });
    const concRow = await prisma.character.findUniqueOrThrow({
      where: { id: concentrationTarget.id },
    });
    const concSaves = mechanicalStateOf(concRow.mechanicalState).pendingConcentrationSaves;
    check(
      '84.J) dois hits no MESMO alvo concentrando geram DOIS testes (eventIds distintos), nunca um save somado',
      concSaves.length === 2 &&
        concSaves[0]?.eventId === attackDamageEventIdOf(concCast.id, 0) &&
        concSaves[1]?.eventId === attackDamageEventIdOf(concCast.id, 1) &&
        concSaves[0]?.dc === 10 &&
        concSaves[1]?.dc === 10 &&
        concRun.snapshot.attacks[1]?.damage?.finalDamage === 12,
      JSON.stringify({ saves: concSaves.map((save) => ({ dc: save.dc, eventId: save.eventId })) }),
    );

    // =====================================================================
    // BLESS POR OCORRÊNCIA — d4 independente e seleção por índice
    // =====================================================================
    const blessEffect = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'spell.bless',
        label: BLESS_LABEL,
        sourceType: 'manual',
        targetEntityKind: 'character',
        targetEntityId: caster.id,
        visibility: 'public',
        status: 'active',
        modifiers: blessModifiers() as never,
        conditions: [],
      },
    });
    effectIds.push(blessEffect.id);
    const blessOptionId = `${blessEffect.id}:attack`;
    const blessCast = await makeCast([aEntity, bEntity]);
    const blessRun = await run(blessCast.id, [aEntity, aEntity, bEntity], THREE_ATTACKS, {
      roll: recorder([10, 3, 4, 20, 6, 7, 2, 1]).roll,
      // Índices 0 e 2 escolhem Bless; o 1 NÃO — cada jogada tem seu d4.
      selectedEffectModifiersByAttack: { 0: [blessOptionId], 2: [blessOptionId] },
    });
    await prisma.effectInstance.update({
      where: { id: blessEffect.id },
      data: { status: 'ended' },
    });
    check(
      '84.K) Bless OPCIONAL por ocorrência: índices 0 e 2 rolam d4 próprio; índice 1 não é modificado',
      blessRun.snapshot.attacks[0]?.attack.effectDice.length === 1 &&
        blessRun.snapshot.attacks[0]?.attack.effectDice[0]?.value === 3 &&
        blessRun.snapshot.attacks[0]?.attack.total === 19 &&
        blessRun.snapshot.attacks[1]?.attack.effectDice.length === 0 &&
        blessRun.snapshot.attacks[2]?.attack.effectDice[0]?.value === 1 &&
        blessRun.snapshot.attacks[0]?.selectedModifiers.join(',') === blessOptionId &&
        blessRun.snapshot.attacks[1]?.selectedModifiers.length === 0,
      JSON.stringify(
        blessRun.snapshot.attacks.map((occurrence) => ({
          dice: occurrence.attack.effectDice,
          total: occurrence.attack.total,
        })),
      ),
    );

    // =====================================================================
    // 0 PV NO MEIO DA SEQUÊNCIA — sem retarget, estado relido
    // =====================================================================
    await prisma.character.update({
      where: { id: sequenceTarget.id },
      data: { hpCurrent: 5, hpMax: 60, mechanicalState: {} as never },
    });
    const midCast = await makeCast([seqEntity]);
    const midRun = await run(midCast.id, [seqEntity, seqEntity, seqEntity], THREE_ATTACKS, {
      roll: recorder([10, 4, 20, 6, 7, 10, 3]).roll,
    });
    const seqRow = await prisma.character.findUniqueOrThrow({ where: { id: sequenceTarget.id } });
    check(
      '84.L) alvo cai a 0 PV no meio: a sequência CONTINUA, o assignment não muda e o lifecycle de morte é o existente',
      midRun.snapshot.attacks.length === 3 &&
        midRun.snapshot.attacks[1]?.damage?.hpAfter === 0 &&
        midRun.snapshot.attacks[2]?.attack.hit === true &&
        midRun.snapshot.attacks.every((occurrence) => occurrence.target.id === sequenceTarget.id) &&
        seqRow.hpCurrent === 0 &&
        (seqRow.deathState as { deathSaves?: boolean } | null)?.deathSaves === true,
      JSON.stringify({ hp: seqRow.hpCurrent, death: seqRow.deathState }),
    );

    // =====================================================================
    // RETRY / REPLAY — nenhum dado novo
    // =====================================================================
    const hpBeforeRetry = await hpOf(targetA.id);
    const retry = await run(mainCast.id, [aEntity, aEntity, bEntity], THREE_ATTACKS, {
      roll: recorder([20, 9, 9]).roll,
    });
    const hpAfterRetry = await hpOf(targetA.id);
    check(
      '84.M) retry devolve o snapshot salvo (replayed), sem rerrolar d20/dano e sem reaplicar HP',
      retry.replayed &&
        retry.snapshot.attacks[0]?.attack.naturalRoll === 10 &&
        retry.snapshot.attacks[1]?.attack.critical === true &&
        retry.snapshot.attacks[2]?.attack.hit === false &&
        hpAfterRetry === hpBeforeRetry,
      JSON.stringify({ hpBeforeRetry, hpAfterRetry }),
    );

    // =====================================================================
    // CONTAGEM INVÁLIDA — recusa ANTES de rolar/gravar
    // =====================================================================
    const invalidCast = await makeCast([aEntity, bEntity]);
    let countError: { code?: string } | null = null;
    try {
      await run(invalidCast.id, [aEntity, bEntity, aEntity], SINGLE_ATTACK);
    } catch (error) {
      countError = error as { code?: string };
    }
    const invalidRow = await prisma.spellCast.findUniqueOrThrow({ where: { id: invalidCast.id } });
    check(
      '84.N) assignments ≠ quantidade da definição recusa o cast inteiro (`SPELL_ATTACK_COUNT_INVALID`) sem dano e sem `resolved`',
      countError !== null &&
        countError.code === 'SPELL_ATTACK_COUNT_INVALID' &&
        invalidRow.status === 'resolving' &&
        invalidRow.resolutionSnapshot === null,
      JSON.stringify({ code: countError?.code, status: invalidRow.status }),
    );
    // O cast recusado ficou `resolving`; encerra para não bloquear o próximo
    // cast do MESMO conjurador (índice parcial "um resolving por caster").
    await prisma.spellCast.update({
      where: { id: invalidCast.id },
      data: { status: 'cancelled', outcome: 'cancelled', resolvedAt: new Date() },
    });

    // =====================================================================
    // CONCORRÊNCIA — exactly once (3 ocorrências, não 6)
    // =====================================================================
    const parallelCast = await makeCast([parallelEntity]);
    const sharedRoll = recorder([10, 4, 10, 4, 10, 4]);
    const [firstRun, secondRun] = await Promise.all([
      run(parallelCast.id, [parallelEntity, parallelEntity, parallelEntity], THREE_ATTACKS, {
        roll: sharedRoll.roll,
      }),
      run(parallelCast.id, [parallelEntity, parallelEntity, parallelEntity], THREE_ATTACKS, {
        roll: sharedRoll.roll,
      }),
    ]);
    const parallelHp = await hpOf(parallelTarget.id);
    const applied = [firstRun, secondRun].filter((result) => !result.replayed);
    check(
      '84.O) duas resoluções concorrentes do MESMO cast: uma aplica, a outra é replay, 3 ocorrências e HP uma única vez',
      applied.length === 1 &&
        firstRun.snapshot.attacks.length === 3 &&
        parallelHp === 48 &&
        announcementSafe(firstRun.snapshot, secondRun.snapshot),
      JSON.stringify({
        applied: applied.length,
        hp: parallelHp,
        rolls: firstRun.snapshot.attacks.length,
      }),
    );

    // =====================================================================
    // DESFECHO — tudo errado é `no-effect`; imunidade também
    // =====================================================================
    const allMissCast = await makeCast([aEntity]);
    const allMiss = await run(allMissCast.id, [aEntity, aEntity, aEntity], THREE_ATTACKS, {
      roll: recorder([2]).roll,
    });
    check(
      '84.P) todas as jogadas erram → `no-effect` com motivo `attack-miss` (cast válido, zero dano)',
      allMiss.cast.outcome === 'no-effect' &&
        allMiss.snapshot.noEffectReason === 'attack-miss' &&
        allMiss.snapshot.attacks.every((occurrence) => occurrence.damage === null),
      JSON.stringify({ outcome: allMiss.cast.outcome, reason: allMiss.snapshot.noEffectReason }),
    );

    // =====================================================================
    // SNAPSHOT LEGADO (6.6I.4) continua legível — SEM migration
    // =====================================================================
    const legacySnapshot = {
      kind: 'attack-damage',
      attack: {
        kind: 'ranged',
        index: 0,
        occurrenceId: 'spell-cast:legacy:attack:0',
        naturalRoll: 15,
        rolls: [15],
        mode: 'normal',
        attackBonus: 6,
        effectBonus: 0,
        effectDice: [],
        sources: [],
        total: 21,
        targetAc: 15,
        hit: true,
        critical: false,
        autoMiss: false,
        autoHit: false,
      },
      damage: null,
      target: { kind: 'character', id: 'legacy-target' },
      casterName: 'Legado',
      noEffectReason: null,
      at: new Date().toISOString(),
    };
    const parsedLegacy = parseSpellResolutionSnapshot(legacySnapshot);
    const parsedInvalid = parseSpellResolutionSnapshot({ kind: 'attack-damage', attacks: [] });
    const legacyAttacks =
      parsedLegacy?.kind === 'attack-damage' ? parsedLegacy.attacks : [];
    const legacyTargets =
      parsedLegacy?.kind === 'attack-damage' ? parsedLegacy.targets : [];
    check(
      '84.Q) snapshot ANTIGO de uma jogada é normalizado para `attacks[0]`; JSON inválido vira `null` (sem inventar dados)',
      parsedLegacy?.kind === 'attack-damage' &&
        legacyAttacks.length === 1 &&
        legacyAttacks[0]?.occurrenceId === 'spell-cast:legacy:attack:0' &&
        legacyAttacks[0]?.attack.naturalRoll === 15 &&
        legacyTargets.length === 1 &&
        parsedInvalid === null,
      JSON.stringify({ legacy: legacyAttacks.length, invalid: parsedInvalid }),
    );

    // =====================================================================
    // FINGERPRINT — repetição preserva a ORDEM do assignment
    // =====================================================================
    const actor = { userId: caster.userId, username: 'fixture', role: 'PLAYER' as const };
    const fingerprintOfTargets = (targets: { kind: 'character'; id: string }[]) =>
      castFingerprint(actor, {
        operationId: `fp-${suffix}`,
        spellId: SYNTHETIC_SPELL_ID,
        caster: casterEntity,
        targets,
      });
    const fpAAB = fingerprintOfTargets([
      { kind: 'character', id: targetA.id },
      { kind: 'character', id: targetA.id },
      { kind: 'character', id: targetB.id },
    ]);
    const fpABB = fingerprintOfTargets([
      { kind: 'character', id: targetA.id },
      { kind: 'character', id: targetB.id },
      { kind: 'character', id: targetB.id },
    ]);
    const fpAB = fingerprintOfTargets([
      { kind: 'character', id: targetA.id },
      { kind: 'character', id: targetB.id },
    ]);
    const fpBA = fingerprintOfTargets([
      { kind: 'character', id: targetB.id },
      { kind: 'character', id: targetA.id },
    ]);
    check(
      '84.R) fingerprint: [A,A,B] ≠ [A,B,B] (ordem é mecânica com repetição) e [A,B] = [B,A] (sem repetição a ordem não importa)',
      fpAAB !== fpABB && fpAB === fpBA,
      JSON.stringify({ sameOrderMatters: fpAAB !== fpABB, setOrderIgnored: fpAB === fpBA }),
    );

    // =====================================================================
    // INTENÇÃO preserva assignments sem gastar nada
    // =====================================================================
    const intent = await prisma.spellCastIntent.create({
      data: {
        operationId: `intent-${suffix}`,
        fingerprint: fpAAB,
        actorUserId: actor.userId,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        spellId: SYNTHETIC_SPELL_ID,
        targets: [
          { kind: 'character', id: targetA.id, name: targetA.name },
          { kind: 'character', id: targetA.id, name: targetA.name },
          { kind: 'character', id: targetB.id, name: targetB.name },
        ] as never,
        requiredConfirmations: [] as never,
        status: 'pending',
        castOperationId: `intent:${suffix}`,
      },
    });
    intentIds.push(intent.id);
    const intentDto = toSpellCastIntentDto(intent, 'master');
    check(
      '84.S) a INTENÇÃO guarda os assignments [A, A, B] na ordem e NÃO cria SpellCast/custo',
      intentDto.targets.length === 3 &&
        intentDto.targets[0]?.id === targetA.id &&
        intentDto.targets[1]?.id === targetA.id &&
        intentDto.targets[2]?.id === targetB.id &&
        (await prisma.spellCast.count({ where: { operationId: `intent:${suffix}` } })) === 0,
      JSON.stringify(intentDto.targets.map((item) => item.id)),
    );

    // =====================================================================
    // PRIVACIDADE NO DTO — CA por ocorrência
    // =====================================================================
    const creatureCast = await makeCast([creatureEntity], 30);
    const creatureRun = await run(creatureCast.id, [creatureEntity], SINGLE_ATTACK, {
      roll: recorder([10, 4]).roll,
    });
    const characterDto = toSpellCastDto(
      await prisma.spellCast.findUniqueOrThrow({ where: { id: mainCast.id } }),
    );
    const creatureDto = toSpellCastDto(
      await prisma.spellCast.findUniqueOrThrow({ where: { id: creatureCast.id } }),
    );
    check(
      '84.T) DTO esconde a CA por OCORRÊNCIA quando o alvo é criatura e mantém a do personagem',
      characterDto.resolution?.kind === 'attack-damage' &&
        characterDto.resolution.attacks[0]?.attack.targetAc === 12 &&
        creatureRun.snapshot.attacks[0]?.attack.hit === true &&
        creatureDto.resolution?.kind === 'attack-damage' &&
        creatureDto.resolution.attacks[0]?.attack.targetAc === null,
      JSON.stringify({
        character: characterDto.resolution?.kind === 'attack-damage'
          ? characterDto.resolution.attacks[0]?.attack.targetAc
          : null,
        creature: creatureDto.resolution?.kind === 'attack-damage'
          ? creatureDto.resolution.attacks[0]?.attack.targetAc
          : null,
      }),
    );

    // =====================================================================
    // ESTRUTURA — nenhuma spell PHB nova, nenhum Effect/pendência, sem card
    // =====================================================================
    const registrySource = sourceOf('../modules/spells/execution/spell-execution-registry.ts');
    check(
      '84.U) a definição sintética NÃO está no catálogo/registry de produção e NENHUMA spell PHB de múltiplos raios foi registrada',
      spellExecutionDefinition(SYNTHETIC_SPELL_ID) === null &&
        !getSpell(SYNTHETIC_SPELL_ID) &&
        !registrySource.includes(SYNTHETIC_SPELL_ID) &&
        spellExecutionDefinition('eldritch-blast') === null &&
        spellExecutionDefinition('scorching-ray') === null &&
        spellExecutionDefinition('fire-bolt') === null &&
        spellExecutionDefinition('ray-of-frost') === null &&
        spellExecutionDefinition('inflict-wounds') === null &&
        spellExecutionDefinition('ice-knife') === null,
      JSON.stringify({ syntheticRegistry: registrySource.includes(SYNTHETIC_SPELL_ID) }),
    );
    check(
      '84.V) nenhum PendingEffectSave/EffectInstance nasceu dos casts de ataque múltiplo e nenhum Resolution Card é usado',
      (await prisma.pendingEffectSave.count({ where: { spellCastId: { in: castIds } } })) === 0 &&
        (await prisma.effectInstance.count({ where: { sourceId: { in: castIds } } })) === 0 &&
        !attackSource.includes('resolution-requests') &&
        !attackSource.includes('CombatResolutionRequest'),
      JSON.stringify({ casts: castIds.length }),
    );
    check(
      '84.W) o smoke de múltiplos ataques integra o runner principal',
      sourceOf('../scripts/smoke-realtime.ts').includes('smokeMultipleSpellAttacks(BASE_URL, check)'),
      JSON.stringify({ runner: true }),
    );

  } finally {
    // Cleanup SÓ do que este smoke criou (AGENTS.md) — nunca dados reais.
    try {
      await prisma.spellCastIntent.deleteMany({ where: { id: { in: intentIds } } });
      await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
      await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
      await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (error) {
      console.error('[smoke-multiple-spell-attacks] falha na limpeza:', error);
    }
  }
}

/** Compara dois snapshots do MESMO cast (replay tem de ser idêntico). */
function announcementSafe(first: AttackDamageSnapshot, second: AttackDamageSnapshot): boolean {
  return (
    first.attacks.length === second.attacks.length &&
    first.attacks.every((occurrence, index) => {
      const other = second.attacks[index];
      return (
        other?.occurrenceId === occurrence.occurrenceId &&
        other?.attack.naturalRoll === occurrence.attack.naturalRoll &&
        other?.damage?.finalDamage === occurrence.damage?.finalDamage
      );
    })
  );
}
