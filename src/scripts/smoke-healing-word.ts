import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { getSpell } from '../modules/shared/spells/index.js';
import { CLASS_SPELL_LISTS } from '../modules/shared/spells/class-lists.js';
import { slotScaledDiceCount } from '../modules/shared/spells/slot-scaling.js';
import {
  HEALING_WORD_BASE_DICE,
  HEALING_WORD_LABEL,
  HEALING_WORD_NO_EFFECT_ON_TYPES,
  HEALING_WORD_SLOT_SCALING,
  HEALING_WORD_SPELL_ID,
} from '../modules/spells/execution/healing-word.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { emptyDeathState, deathStateOf } from '../modules/shared/death.js';
import { resolveDamage } from '../modules/combat/damage-resolution.js';
import { applyDamageConsequences } from '../modules/death/death.service.js';
import { grantCastingComponents, seedSpellRepertoire } from './spell-slot-fixtures.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const EVIDENCE = { withinRange: true, sight: true, clearPath: true, groupDistance: true };

/**
 * FASE 6.6I.3 — SMOKE DEDICADO DA PALAVRA CURATIVA.
 *
 * Prova, ponta a ponta e com fixtures próprias:
 *  • catálogo PHB 2014, listas Bard/Cleric/Druid, execução `immediate-healing`;
 *  • Ação Bônus + espaço de nível 1+, componentes SÓ V (mãos ocupadas ok);
 *  • atributo da FONTE (SAB/CHA), ambiguidade de multiclasse e snapshot no cast;
 *  • cura 1d4 + modificador UMA vez, upcast 2d4/3d4 pelo ESPAÇO (nunca nível);
 *  • resultado server-side por `resolveHealing`, limitado ao máximo e nunca
 *    negativo (modificador -5 vira 0, nunca dano);
 *  • 0 PV: limpa Testes contra a Morte, preserva Prone e o card deixa de ser
 *    derivado no turno seguinte;
 *  • morto é recusado antes do COMMIT; morto-vivo/constructo é conjurado SEM
 *    efeito (custos pagos, sem refund);
 *  • nenhum Effect, pendência, Concentração ou card interativo;
 *  • idempotência (retry não rola/cura de novo) e a policy de Ação Bônus com
 *    Sacred Flame (permitido) e Bless (proibido nos dois sentidos).
 */

interface FixtureUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export async function smokeHealingWord(baseUrl: string, check: Check): Promise<void> {
  console.log('\n82) Fase 6.6I.3 — Palavra Curativa (immediate-healing real PHB 2014)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  const effectIds: string[] = [];

  const request = async (
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; data: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };

  try {
    // =====================================================================
    // A–F — CATÁLOGO, LISTAS, EXECUÇÃO E ESCALONAMENTO (puro)
    // =====================================================================
    const spell = getSpell(HEALING_WORD_SPELL_ID);
    const definition = spellExecutionDefinition(HEALING_WORD_SPELL_ID);
    const resolution = definition?.resolution;
    check(
      '82.A) catálogo PHB 2014: 1º de Evocação, Ação Bônus, 18 m, V (sem S/M), instantânea',
      Boolean(spell) &&
        spell!.level === 1 &&
        spell!.school === 'evocation' &&
        spell!.castingTimeKind === 'bonusAction' &&
        spell!.rangeMeters === 18 &&
        spell!.components.verbal &&
        !spell!.components.somatic &&
        !spell!.components.material &&
        spell!.duration === 'Instantânea' &&
        spell!.concentration === false,
      JSON.stringify(spell),
    );
    const listOf = (key: string): readonly string[] => {
      const value = (CLASS_SPELL_LISTS as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as string[];
      return typeof value === 'string' ? value.split(',') : [];
    };
    const inList = (key: string) => listOf(key).includes(HEALING_WORD_SPELL_ID);
    check(
      '82.B) listas PHB: Bardo, Clérigo e Druida; fora de Mago/Feiticeiro/Bruxo/Paladino/Patrulheiro',
      inList('bard') && inList('cleric') && inList('druid') &&
        !inList('wizard') && !inList('sorcerer') && !inList('warlock') &&
        !inList('paladin') && !inList('ranger'),
      JSON.stringify({
        bard: inList('bard'), cleric: inList('cleric'), druid: inList('druid'),
        wizard: inList('wizard'), sorcerer: inList('sorcerer'), warlock: inList('warlock'),
        paladin: inList('paladin'), ranger: inList('ranger'),
      }),
    );
    check(
      '82.C) execução declarativa `immediate-healing`, sem Effect Definition',
      definition?.spellId === HEALING_WORD_SPELL_ID &&
        resolution?.kind === 'immediate-healing' &&
        resolution.healing.abilityModifier === 'spellcasting' &&
        resolution.healing.dice.count === HEALING_WORD_BASE_DICE.count &&
        resolution.healing.dice.sides === HEALING_WORD_BASE_DICE.sides &&
        definition.requiresConcentration === false &&
        !definition.duration &&
        !('effectDefinitionId' in (resolution ?? {})),
      JSON.stringify(definition),
    );
    check(
      '82.D) alvo: UMA criatura visível a 60 pés, permite self, sem filtro de tipo (undead não é erro)',
      definition?.targeting.targetCount.base === 1 &&
        definition.targeting.targetCount.additionalPerSlotLevel === 0 &&
        definition.targeting.minTargets === 1 &&
        definition.targeting.range.kind === 'distance' &&
        definition.targeting.range.feet === 60 &&
        definition.targeting.requiresSight &&
        definition.targeting.requiresClearPath &&
        definition.targeting.allowSelf &&
        definition.targeting.filters.length === 0 &&
        definition.targeting.groupConstraints.length === 0 &&
        JSON.stringify(resolution?.kind === 'immediate-healing'
          ? resolution.noEffectOnCreatureTypes
          : []) === JSON.stringify([...HEALING_WORD_NO_EFFECT_ON_TYPES]),
      JSON.stringify(definition?.targeting),
    );
    check(
      '82.E) escalonamento pelo ESPAÇO: 1→1d4, 2→2d4, 3→3d4, 9→9d4 (nunca nível de personagem)',
      [1, 2, 3, 9].every(
        (level) => slotScaledDiceCount(HEALING_WORD_SLOT_SCALING, level) === level,
      ) &&
        slotScaledDiceCount(HEALING_WORD_SLOT_SCALING, 0) === 1 &&
        HEALING_WORD_SLOT_SCALING.baseSpellLevel === 1 &&
        HEALING_WORD_SLOT_SCALING.dicePerLevelAboveBase === 1,
      JSON.stringify([1, 2, 3, 9].map((level) => slotScaledDiceCount(HEALING_WORD_SLOT_SCALING, level))),
    );

    // =====================================================================
    // FIXTURES PRÓPRIAS (nunca dados reais)
    // =====================================================================
    const makeUser = (label: string, role: 'MASTER' | 'PLAYER' = 'PLAYER') =>
      prisma.user.create({
        data: {
          username: `hw_${label}_${suffix}`,
          displayName: `HW ${label}`,
          passwordHash: 'fixture',
          role,
        },
      });
    const master = await makeUser('m', 'MASTER');
    const ownerCleric = await makeUser('cleric');
    const ownerBard = await makeUser('bard');
    const ownerMulti = await makeUser('multi');
    const ownerT1 = await makeUser('t1');
    const ownerT2 = await makeUser('t2');
    const ownerT3 = await makeUser('t3');
    const ownerT4 = await makeUser('t4');
    const ownerT5 = await makeUser('t5');
    const ownerT6 = await makeUser('t6');
    const ownerT7 = await makeUser('t7');
    const ownerT8 = await makeUser('t8');
    const ownerPlayer = await makeUser('player');
    const ownerCombat = await makeUser('combat');
    const ownerBlessed = await makeUser('bless');
    const ownerVerbal = await makeUser('verbal');
    const ownerConc = await makeUser('conc');
    const ownerExtraB = await makeUser('extrab');
    const ownerExtraC = await makeUser('extrac');
    const fixtures: FixtureUser[] = [
      master, ownerCleric, ownerBard, ownerMulti, ownerT1, ownerT2, ownerT3,
      ownerT4, ownerT5, ownerT6, ownerT7, ownerT8, ownerPlayer, ownerCombat,
      ownerBlessed, ownerVerbal, ownerConc, ownerExtraB, ownerExtraC,
    ];
    userIds.push(...fixtures.map((user) => user.id));
    const tokenOf = (user: FixtureUser) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'MASTER' | 'PLAYER',
      });
    const masterToken = tokenOf(master);
    const playerToken = tokenOf(ownerPlayer);

    const makeCharacter = (name: string, userId: string, data: Record<string, unknown> = {}) =>
      prisma.character.create({
        data: {
          userId,
          name,
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          dexterity: 10,
          wisdom: 16,
          charisma: 10,
          classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
          ...data,
        } as never,
      });

    const cleric = await makeCharacter('Clérigo SAB 16', ownerCleric.id);
    const clericLow = await makeCharacter('Clérigo SAB 1', ownerVerbal.id, { wisdom: 1 });
    const clericB = await makeCharacter('Clérigo de reserva B', ownerExtraB.id);
    const clericC = await makeCharacter('Clérigo de reserva C', ownerExtraC.id, {
      classes: [{ classKey: 'cleric', subclass: '', level: 3 }],
    });
    const bard = await makeCharacter('Bardo CAR 18', ownerBard.id, {
      charisma: 18,
      wisdom: 10,
      classes: [{ classKey: 'bard', subclass: '', level: 3 }],
    });
    const multi = await makeCharacter('Bardo/Clérigo', ownerMulti.id, {
      charisma: 18,
      wisdom: 16,
      classes: [
        { classKey: 'bard', subclass: '', level: 1 },
        { classKey: 'cleric', subclass: '', level: 1 },
      ],
    });
    const playerCaster = await makeCharacter('Clérigo do jogador', ownerPlayer.id, {
      classes: [{ classKey: 'cleric', subclass: '', level: 3 }],
    });
    const combo = await makeCharacter('Combo Bônus', ownerCombat.id, {
      classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
    });
    const blessFirst = await makeCharacter('Bless primeiro', ownerBlessed.id, {
      classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
    });
    const hands = await makeCharacter('Mãos ocupadas', ownerConc.id, {
      classes: [{ classKey: 'cleric', subclass: '', level: 3 }],
      inventory: [
        {
          id: `hw-sword-${suffix}`, name: 'Espada Longa', description: '', quantity: 1,
          weight: 0, slot: 'hand1', backpackX: null, backpackY: null, imageUrl: '',
          itemId: '', category: 'Arma', rarity: null, requiresAttunement: false,
          attuned: false, details: { properties: [] }, campSupply: { enabled: false, value: 0 },
        },
        {
          id: `hw-shield-${suffix}`, name: 'Escudo', description: '', quantity: 1,
          weight: 0, slot: 'hand2', backpackX: null, backpackY: null, imageUrl: '',
          itemId: '', category: 'Armadura', rarity: null, requiresAttunement: false,
          attuned: false, details: {}, campSupply: { enabled: false, value: 0 },
        },
      ],
    });
    const fullTarget = await makeCharacter('Alvo cheio', ownerT1.id);
    const hurtTarget = await makeCharacter('Alvo ferido', ownerT2.id, {
      hpCurrent: 5,
      hpMax: 30,
    });
    const bigTarget = await makeCharacter('Alvo muito ferido', ownerT3.id, {
      hpCurrent: 1,
      hpMax: 100,
    });
    const retryTarget = await makeCharacter('Alvo do retry', ownerT4.id, {
      hpCurrent: 1,
      hpMax: 100,
    });
    const deadTarget = await makeCharacter('Cadáver', ownerT5.id, { hpCurrent: 0 });
    const concTarget = await makeCharacter('Alvo concentrando', ownerT8.id);
    characterIds.push(
      cleric.id, clericLow.id, clericB.id, clericC.id, bard.id, multi.id,
      playerCaster.id, combo.id, blessFirst.id, hands.id, fullTarget.id,
      hurtTarget.id, bigTarget.id, retryTarget.id, deadTarget.id, concTarget.id,
    );

    const fullTargetRow = await prisma.character.update({
      where: { id: fullTarget.id },
      data: { hpCurrent: 30, hpMax: 30 },
    });
    void fullTargetRow;
    const deadRow = await prisma.character.update({
      where: { id: deadTarget.id },
      data: { hpCurrent: 0, deathState: { ...emptyDeathState(), dead: true } },
    });
    void deadRow;

    const clerics = [
      cleric.id, clericLow.id, clericB.id, clericC.id, playerCaster.id,
      combo.id, blessFirst.id, hands.id, concTarget.id,
    ];
    for (const characterId of clerics) {
      await seedSpellRepertoire({
        characterId,
        classKey: 'cleric',
        spellIds: [HEALING_WORD_SPELL_ID],
      });
    }
    await seedSpellRepertoire({
      characterId: bard.id,
      classKey: 'bard',
      spellIds: [HEALING_WORD_SPELL_ID],
    });
    for (const classKey of ['bard', 'cleric'] as const) {
      await seedSpellRepertoire({
        characterId: multi.id,
        classKey,
        spellIds: [HEALING_WORD_SPELL_ID],
      });
    }
    for (const characterId of [combo.id, blessFirst.id]) {
      await seedSpellRepertoire({
        characterId,
        classKey: 'cleric',
        spellIds: [HEALING_WORD_SPELL_ID, 'bless'],
      });
    }
    await seedSpellRepertoire({
      characterId: combo.id,
      classKey: 'cleric',
      spellIds: ['sacred-flame'],
    });
    await grantCastingComponents({ characters: [combo.id, blessFirst.id] });

    const undead = await prisma.creature.create({
      data: {
        name: 'Morto-vivo de prova',
        type: 'Morto-vivo',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        wisdom: 10,
      },
    });
    const construct = await prisma.creature.create({
      data: {
        name: 'Constructo de prova',
        type: 'Constructo',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        wisdom: 10,
      },
    });
    creatureIds.push(undead.id, construct.id);

    const slotLevel = 1;
    const cast = (
      body: Record<string, unknown>,
      token = masterToken,
      path = '/spells/cast-proof',
      operationId = randomUUID(),
    ) =>
      request(path, token, {
        operationId,
        spellId: HEALING_WORD_SPELL_ID,
        ...(path === '/spells/cast-proof' ? { spatialConfirmation: EVIDENCE } : {}),
        ...body,
      });
    const slotsUsedOf = async (characterId: string): Promise<Record<string, number>> => {
      const row = await prisma.character.findUniqueOrThrow({
        where: { id: characterId },
        select: { spells: true },
      });
      return ((row.spells as { slotsUsed?: Record<string, number> } | null)?.slotsUsed ?? {}) as Record<string, number>;
    };
    const resetHp = async (characterId: string, hpCurrent: number, hpMax = 30) => {
      await prisma.character.update({ where: { id: characterId }, data: { hpCurrent, hpMax } });
    };

    // =====================================================================
    // G–N — SLOT 1/2/3, MODIFICADOR UMA VEZ, MAX HP E NEGATIVO
    // =====================================================================
    const slot1Cast = await cast({
      caster: { kind: 'character', id: cleric.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: slotLevel },
    });
    const slot1 = slot1Cast.data?.cast;
    const slot1Resolution = slot1?.resolution;
    const hurtAfter = await prisma.character.findUniqueOrThrow({ where: { id: hurtTarget.id } });
    check(
      '82.F) espaço 1: 1d4 + SAB (3) UMA vez, cura aplicada e slot1 gasto',
      slot1Cast.status === 201 &&
        slot1?.casting?.castAtLevel === 1 &&
        slot1?.casting?.resourceKind === 'spell-slot' &&
        slot1?.spellcasting?.ability === 'wisdom' &&
        slot1?.spellcasting?.abilityModifier === 3 &&
        slot1Resolution?.dice?.count === 1 &&
        slot1Resolution?.dice?.rolls?.length === 1 &&
        slot1Resolution?.abilityModifier === 3 &&
        slot1Resolution?.requestedHealing ===
          slot1Resolution.dice.rolls.reduce((a: number, b: number) => a + b, 0) + 3 &&
        slot1Resolution?.finalHealing === slot1Resolution.requestedHealing &&
        hurtAfter.hpCurrent === 5 + slot1Resolution.finalHealing &&
        (await slotsUsedOf(cleric.id))['1'] === 1,
      JSON.stringify({ status: slot1Cast.status, error: slot1Cast.data?.error, resolution: slot1Resolution, hp: hurtAfter.hpCurrent }),
    );
    check(
      '82.G) componentes SÓ V: verbal exigido, somático/material ausentes; nenhum Effect/pendência',
      slot1?.components?.verbal === true &&
        slot1?.components?.somatic === false &&
        slot1?.components?.material === false &&
        slot1?.effectGroupId === null &&
        slot1?.requiresConcentration === false &&
        (await prisma.effectInstance.count({ where: { sourceId: slot1?.id } })) === 0 &&
        (await prisma.pendingEffectSave.count({ where: { spellCastId: slot1?.id } })) === 0,
      JSON.stringify({ components: slot1?.components, effectGroupId: slot1?.effectGroupId }),
    );

    const slot2Cast = await cast({
      caster: { kind: 'character', id: cleric.id },
      targets: [{ kind: 'character', id: bigTarget.id }],
      castingResource: { kind: 'spell-slot', level: 2 },
    });
    const slot2 = slot2Cast.data?.cast?.resolution;
    check(
      '82.H) espaço 2: 2d4 + 3 (modificador entra UMA vez, não por dado)',
      slot2Cast.status === 201 &&
        slot2?.castAtLevel === 2 &&
        slot2?.dice?.count === 2 &&
        slot2?.dice?.rolls?.length === 2 &&
        slot2?.requestedHealing === slot2.dice.rolls.reduce((a: number, b: number) => a + b, 0) + 3 &&
        slot2?.finalHealing === slot2.requestedHealing,
      JSON.stringify({ status: slot2Cast.status, error: slot2Cast.data?.error, resolution: slot2 }),
    );

    await resetHp(bigTarget.id, 1, 100);
    const slot3Cast = await cast({
      caster: { kind: 'character', id: cleric.id },
      targets: [{ kind: 'character', id: bigTarget.id }],
      castingResource: { kind: 'spell-slot', level: 3 },
    });
    const slot3 = slot3Cast.data?.cast?.resolution;
    check(
      '82.I) espaço 3: 3d4 + 3; o nível do ESPAÇO escala, não o nível do personagem',
      slot3Cast.status === 201 &&
        slot3?.castAtLevel === 3 &&
        slot3?.dice?.count === 3 &&
        slot3?.dice?.rolls?.length === 3 &&
        slot3?.requestedHealing === slot3.dice.rolls.reduce((a: number, b: number) => a + b, 0) + 3,
      JSON.stringify({ status: slot3Cast.status, resolution: slot3 }),
    );

    const maxCast = await cast({
      caster: { kind: 'character', id: clericB.id },
      targets: [{ kind: 'character', id: fullTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const maxResolution = maxCast.data?.cast?.resolution;
    const maxHpAfter = await prisma.character.findUniqueOrThrow({ where: { id: fullTarget.id } });
    check(
      '82.J) alvo no máximo: conjura, gasta slot, cura efetiva 0 e outcome `no-effect`',
      maxCast.status === 201 &&
        maxResolution?.finalHealing === 0 &&
        maxResolution?.noEffectReason === 'target-at-max-hp' &&
        maxHpAfter.hpCurrent === 30 &&
        maxCast.data?.cast?.outcome === 'no-effect' &&
        maxCast.data?.cast?.status === 'resolved',
      JSON.stringify({ status: maxCast.status, resolution: maxResolution, outcome: maxCast.data?.cast?.outcome }),
    );

    await resetHp(hurtTarget.id, 5, 30);
    const negativeCast = await cast({
      caster: { kind: 'character', id: clericLow.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const negative = negativeCast.data?.cast?.resolution;
    const negativeHp = await prisma.character.findUniqueOrThrow({ where: { id: hurtTarget.id } });
    check(
      '82.K) modificador -5: cura pedida 0, nunca dano, HP intacto e spell committed',
      negativeCast.status === 201 &&
        negative?.abilityModifier === -5 &&
        negative?.requestedHealing === 0 &&
        negative?.finalHealing === 0 &&
        negative?.noEffectReason === 'zero-healing' &&
        negativeHp.hpCurrent === 5 &&
        negativeCast.data?.cast?.outcome === 'no-effect',
      JSON.stringify({ status: negativeCast.status, resolution: negative, hp: negativeHp.hpCurrent }),
    );

    // =====================================================================
    // O–R — FONTE (Bardo/Clérigo), MULTICLASSE E MÃOS OCUPADAS
    // =====================================================================
    await resetHp(hurtTarget.id, 1, 100);
    const bardCast = await cast({
      caster: { kind: 'character', id: bard.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const bardResolution = bardCast.data?.cast?.resolution;
    check(
      '82.L) Bardo usa CAR (18 → +4), nunca SAB: o atributo vem da FONTE',
      bardCast.status === 201 &&
        bardCast.data?.cast?.spellcasting?.ability === 'charisma' &&
        bardResolution?.abilityModifier === 4 &&
        bardResolution?.requestedHealing ===
          bardResolution.dice.rolls.reduce((a: number, b: number) => a + b, 0) + 4,
      JSON.stringify({ status: bardCast.status, error: bardCast.data?.error, resolution: bardResolution }),
    );

    const ambiguous = await cast({
      caster: { kind: 'character', id: multi.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.M) multiclasse com a magia em DUAS fontes exige escolha explícita (SPELLCASTING_SOURCE_REQUIRED)',
      ambiguous.status === 400 && ambiguous.data?.error === 'SPELLCASTING_SOURCE_REQUIRED',
      JSON.stringify({ status: ambiguous.status, data: ambiguous.data }),
    );
    await resetHp(hurtTarget.id, 1, 100);
    const multiBard = await cast({
      caster: { kind: 'character', id: multi.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      spellcastingSource: { kind: 'class', id: 'bard' },
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    await resetHp(hurtTarget.id, 1, 100);
    const multiCleric = await cast({
      caster: { kind: 'character', id: multi.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      spellcastingSource: { kind: 'class', id: 'cleric' },
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.N) fonte Bard → CAR+4; fonte Cleric → SAB+3 (a cura pode diferir; slot ortogonal)',
      multiBard.status === 201 && multiCleric.status === 201 &&
        multiBard.data?.cast?.spellcasting?.ability === 'charisma' &&
        multiBard.data?.cast?.resolution?.abilityModifier === 4 &&
        multiCleric.data?.cast?.spellcasting?.ability === 'wisdom' &&
        multiCleric.data?.cast?.resolution?.abilityModifier === 3,
      JSON.stringify({
        bard: multiBard.data?.cast?.spellcasting,
        cleric: multiCleric.data?.cast?.spellcasting,
        errors: [multiBard.data?.error, multiCleric.data?.error],
      }),
    );

    await resetHp(hurtTarget.id, 1, 100);
    const handsCast = await cast({
      caster: { kind: 'character', id: hands.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.O) V-only continua conjurável com espada + escudo (nenhuma mão livre exigida)',
      handsCast.status === 201 &&
        handsCast.data?.cast?.components?.verbal === true &&
        handsCast.data?.cast?.components?.somatic === false &&
        handsCast.data?.cast?.components?.material === false,
      JSON.stringify({ status: handsCast.status, error: handsCast.data?.error, components: handsCast.data?.cast?.components }),
    );

    const silence = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'fixture.silence',
        label: 'Silêncio (prova)',
        sourceType: 'manual',
        targetEntityKind: 'character',
        targetEntityId: clericLow.id,
        modifiers: [{ kind: 'spell-component-block', components: ['verbal'] }] as never,
        conditions: [] as never,
        turnTriggers: [] as never,
        visibility: 'public',
        status: 'active',
      },
    });
    effectIds.push(silence.id);
    const slotsBeforeSilence = await slotsUsedOf(clericLow.id);
    const silencedCast = await cast({
      caster: { kind: 'character', id: clericLow.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.P) bloqueio VERBAL genérico recusa ANTES do COMMIT (sem slot, sem SpellCast)',
      silencedCast.status === 409 &&
        (String(silencedCast.data?.error ?? '').includes('VERBAL') ||
          String(silencedCast.data?.message ?? '').includes('verbal')) &&
        JSON.stringify(await slotsUsedOf(clericLow.id)) === JSON.stringify(slotsBeforeSilence),
      JSON.stringify({ status: silencedCast.status, data: silencedCast.data }),
    );

    // =====================================================================
    // S–U — MORTO (pré-COMMIT) E MORTO-VIVO/CONSTRUCTO (sem efeito)
    // =====================================================================
    const slotsBeforeDead = await slotsUsedOf(cleric.id);
    const deadCast = await cast({
      caster: { kind: 'character', id: cleric.id },
      targets: [{ kind: 'character', id: deadTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.Q) alvo MORTO é recusado antes do COMMIT: zero slot, zero cura, nenhuma ressurreição',
      deadCast.status === 400 &&
        deadCast.data?.error === 'SPELL_TARGET_DEAD' &&
        JSON.stringify(await slotsUsedOf(cleric.id)) === JSON.stringify(slotsBeforeDead),
      JSON.stringify({ status: deadCast.status, data: deadCast.data }),
    );

    const slotsBeforeUndead = await slotsUsedOf(clericB.id);
    const undeadCast = await cast({
      caster: { kind: 'character', id: clericB.id },
      targets: [{ kind: 'creature', id: undead.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const undeadResolution = undeadCast.data?.cast?.resolution;
    const constructCast = await cast({
      caster: { kind: 'character', id: clericB.id },
      targets: [{ kind: 'creature', id: construct.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const constructResolution = constructCast.data?.cast?.resolution;
    const slotsAfterBoth = await slotsUsedOf(clericB.id);
    check(
      '82.R) morto-vivo/constructo são CONJURADOS sem efeito: slot gasto, sem roll, sem refund',
      undeadCast.status === 201 && constructCast.status === 201 &&
        undeadResolution?.finalHealing === 0 &&
        undeadResolution?.noEffectReason === 'creature-type-immune' &&
        undeadResolution?.dice?.rolls?.length === 0 &&
        constructResolution?.finalHealing === 0 &&
        constructResolution?.noEffectReason === 'creature-type-immune' &&
        undeadCast.data?.cast?.outcome === 'no-effect' &&
        constructCast.data?.cast?.outcome === 'no-effect' &&
        slotsAfterBoth['1'] === (slotsBeforeUndead['1'] ?? 0) + 2,
      JSON.stringify({
        undead: { status: undeadCast.status, resolution: undeadResolution },
        construct: { status: constructCast.status, resolution: constructResolution },
        slots: slotsAfterBoth,
      }),
    );

    // =====================================================================
    // V–X — 0 PV, PRONE, DEATH SAVE CARD E RETRY
    // =====================================================================
    const zero = await makeCharacter('Alvo a 0 PV', ownerT6.id, { hpCurrent: 10, hpMax: 10 });
    characterIds.push(zero.id);
    await prisma.$transaction(async (tx) => {
      const damage = await resolveDamage(tx, {
        eventId: `hw-zero-${zero.id}`,
        source: { kind: 'spell', label: 'Dano de fixture' },
        target: {
          kind: 'CHARACTER',
          id: zero.id,
          character: await tx.character.findUniqueOrThrow({ where: { id: zero.id } }),
        },
        components: [{ type: 'Radiante', rawAmount: 10 }],
      });
      await applyDamageConsequences(
        { kind: 'character', id: zero.id },
        {
          damage: 10,
          hpBefore: damage.hpBefore ?? 10,
          hpTempBefore: damage.hpTempBefore,
          critical: false,
          sourceName: 'Fixture',
        },
        tx,
        'Fixture',
      );
    });
    // Contadores NÃO zerados de propósito: a cura positiva tem de limpá-los.
    await prisma.character.update({
      where: { id: zero.id },
      data: {
        deathState: {
          ...deathStateOf(
            (await prisma.character.findUniqueOrThrow({ where: { id: zero.id } })).deathState,
          ),
          successes: 1,
          failures: 1,
        },
      },
    });
    const zeroBefore = await prisma.character.findUniqueOrThrow({ where: { id: zero.id } });
    const zeroDeathBefore = deathStateOf(zeroBefore.deathState);
    check(
      '82.S) fixture a 0 PV com Testes contra a Morte ativos e Queda derivada',
      zeroBefore.hpCurrent === 0 &&
        zeroDeathBefore.deathSaves &&
        (zeroDeathBefore.successes > 0 || zeroDeathBefore.failures > 0) &&
        JSON.stringify(zeroBefore.mechanicalState).includes('"prone"'),
      JSON.stringify({ hp: zeroBefore.hpCurrent, death: zeroDeathBefore }),
    );
    const zeroHeal = await cast({
      caster: { kind: 'character', id: clericB.id },
      targets: [{ kind: 'character', id: zero.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const zeroAfter = await prisma.character.findUniqueOrThrow({ where: { id: zero.id } });
    const zeroDeathAfter = deathStateOf(zeroAfter.deathState);
    check(
      '82.T) cura > 0 restaura PV, limpa Testes contra a Morte, remove Inconsciente de 0 PV e PRESERVA Prone',
      zeroHeal.status === 201 &&
        zeroHeal.data?.cast?.resolution?.finalHealing > 0 &&
        zeroAfter.hpCurrent > 0 &&
        !zeroDeathAfter.deathSaves &&
        zeroDeathAfter.successes === 0 &&
        zeroDeathAfter.failures === 0 &&
        JSON.stringify(zeroAfter.mechanicalState).includes('"prone"'),
      JSON.stringify({ status: zeroHeal.status, hp: zeroAfter.hpCurrent, death: zeroDeathAfter, prone: JSON.stringify(zeroAfter.mechanicalState).includes('"prone"') }),
    );

    const retryOp = randomUUID();
    await resetHp(retryTarget.id, 1, 100);
    const retryFirst = await cast({
      caster: { kind: 'character', id: clericC.id },
      targets: [{ kind: 'character', id: retryTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    }, masterToken, '/spells/cast-proof', retryOp);
    const retryHp = (await prisma.character.findUniqueOrThrow({ where: { id: retryTarget.id } })).hpCurrent;
    const retrySlots = await slotsUsedOf(clericC.id);
    const retrySecond = await cast({
      caster: { kind: 'character', id: clericC.id },
      targets: [{ kind: 'character', id: retryTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    }, masterToken, '/spells/cast-proof', retryOp);
    check(
      '82.U) retry idempotente: mesmo cast/snapshot, sem novo d4, sem segundo slot nem segunda cura',
      retryFirst.status === 201 && retrySecond.status === 200 &&
        retrySecond.data?.replayed === true &&
        retrySecond.data?.cast?.id === retryFirst.data?.cast?.id &&
        JSON.stringify(retrySecond.data?.cast?.resolution) === JSON.stringify(retryFirst.data?.cast?.resolution) &&
        (await prisma.character.findUniqueOrThrow({ where: { id: retryTarget.id } })).hpCurrent === retryHp &&
        JSON.stringify(await slotsUsedOf(clericC.id)) === JSON.stringify(retrySlots),
      JSON.stringify({ first: retryFirst.status, second: retrySecond.status, retry: retrySecond.data?.replayed }),
    );

    // =====================================================================
    // Y–AC — COMBATE: AÇÃO BÔNUS, POLICY 6.6D, FORA DO TURNO E INTENT
    // =====================================================================
    const makeCombat = async (input: {
      caster: { id: string; name: string; ownerId: string };
      targets: { id: string; name: string; ownerId: string; hp?: number }[];
      casterIndex?: number;
    }) => {
      const combat = await prisma.combat.create({
        data: {
          status: 'ACTIVE',
          currentIndex: input.casterIndex ?? 0,
          round: 1,
          turnSequence: 1,
          combatants: {
            create: [
              {
                kind: 'CHARACTER',
                characterId: input.caster.id,
                ownerUserId: input.caster.ownerId,
                name: input.caster.name,
                initiative: 20,
                initiativeRoll: 20,
                dexterityMod: 0,
                hpCurrent: 30,
                hpMax: 30,
                turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
              },
              ...input.targets.map((target, index) => ({
                kind: 'CHARACTER' as const,
                characterId: target.id,
                ownerUserId: target.ownerId,
                name: target.name,
                initiative: 10 - index,
                initiativeRoll: 10 - index,
                dexterityMod: 0,
                hpCurrent: target.hp ?? 30,
                hpMax: 30,
                turnEconomy: { actionsGranted: 1, actionsUsed: 0, movementBudget: 9 },
              })),
            ],
          },
        },
        include: { combatants: true },
      });
      combatIds.push(combat.id);
      return combat;
    };
    const endCombat = (combatId: string) =>
      prisma.combat.update({ where: { id: combatId }, data: { status: 'ENDED' } });

    await resetHp(hurtTarget.id, 1, 100);
    const comboCombat = await makeCombat({
      caster: { id: combo.id, name: combo.name, ownerId: ownerCombat.id },
      targets: [{ id: hurtTarget.id, name: hurtTarget.name, ownerId: ownerT2.id, hp: 5 }],
    });
    const comboCombatant = comboCombat.combatants.find((item) => item.characterId === combo.id)!;
    const bonusCast = await cast({
      caster: { kind: 'character', id: combo.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const afterBonus = await prisma.combatant.findUniqueOrThrow({ where: { id: comboCombatant.id } });
    const economy = afterBonus.turnEconomy as any;
    check(
      '82.V) em combate gasta AÇÃO BÔNUS (não Ação) e a Ação continua disponível',
      bonusCast.status === 201 &&
        bonusCast.data?.cast?.casting?.timeKind === 'bonusAction' &&
        bonusCast.data?.cast?.casting?.economyCostKind === 'bonus-action' &&
        economy.bonusActionUsed === true &&
        (economy.actionsUsed ?? 0) === 0,
      JSON.stringify({ status: bonusCast.status, error: bonusCast.data?.error, economy }),
    );

    const secondBonus = await cast({
      caster: { kind: 'character', id: combo.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.W) segunda Ação Bônus no mesmo turno é recusada',
      secondBonus.status === 409,
      JSON.stringify({ status: secondBonus.status, data: secondBonus.data }),
    );

    const sacredAfter = await request('/spells/cast-proof', masterToken, {
      operationId: randomUUID(),
      spellId: 'sacred-flame',
      caster: { kind: 'character', id: combo.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      spatialConfirmation: EVIDENCE,
    });
    check(
      '82.X) Palavra Curativa (Bônus) + Chama Sagrada (Ação, cantrip) no MESMO turno é permitido',
      sacredAfter.status === 201,
      JSON.stringify({ status: sacredAfter.status, error: sacredAfter.data?.error }),
    );

    await endCombat(comboCombat.id);

    const blessCombat = await makeCombat({
      caster: { id: blessFirst.id, name: blessFirst.name, ownerId: ownerBlessed.id },
      targets: [{ id: hurtTarget.id, name: hurtTarget.name, ownerId: ownerT2.id }],
    });
    const blessing = await request('/spells/cast-proof', masterToken, {
      operationId: randomUUID(),
      spellId: 'bless',
      caster: { kind: 'character', id: blessFirst.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
      spatialConfirmation: EVIDENCE,
    });
    const afterBless = await cast({
      caster: { kind: 'character', id: blessFirst.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.Y) Bless (Ação de nível) → Palavra Curativa (Bônus) é PROIBIDO pela policy 6.6D',
      blessing.status === 201 && afterBless.status === 409,
      JSON.stringify({ bless: blessing.status, blessError: blessing.data?.error, healingWord: afterBless.status, error: afterBless.data?.error }),
    );

    await endCombat(blessCombat.id);
    // Combate NOVO = turno/identidade novos: o histórico de conjurações do turno
    // anterior não contamina a prova da policy no mesmo turno.
    const hwBlessCombat = await makeCombat({
      caster: { id: blessFirst.id, name: blessFirst.name, ownerId: ownerBlessed.id },
      targets: [{ id: hurtTarget.id, name: hurtTarget.name, ownerId: ownerT2.id }],
    });
    const hwFirst = await cast({
      caster: { kind: 'character', id: blessFirst.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const blessAfterHw = await request('/spells/cast-proof', masterToken, {
      operationId: randomUUID(),
      spellId: 'bless',
      caster: { kind: 'character', id: blessFirst.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
      spatialConfirmation: EVIDENCE,
    });
    check(
      '82.Z) Palavra Curativa (Bônus de nível) → Bless (Ação de nível) é PROIBIDO',
      hwFirst.status === 201 && blessAfterHw.status === 409,
      JSON.stringify({ healingWord: hwFirst.status, bless: blessAfterHw.status, error: blessAfterHw.data?.error }),
    );
    await endCombat(hwBlessCombat.id);

    const outOfTurn = await makeCombat({
      caster: { id: cleric.id, name: cleric.name, ownerId: ownerCleric.id },
      targets: [{ id: concTarget.id, name: concTarget.name, ownerId: ownerT8.id }],
      casterIndex: 1,
    });
    const outOfTurnCast = await cast({
      caster: { kind: 'character', id: cleric.id },
      targets: [{ kind: 'character', id: concTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.AA) fora do próprio turno a conjuração é recusada (SPELL_CAST_OUT_OF_TURN)',
      outOfTurnCast.status === 409 &&
        String(outOfTurnCast.data?.error ?? '').includes('OUT_OF_TURN'),
      JSON.stringify({ status: outOfTurnCast.status, data: outOfTurnCast.data }),
    );
    await endCombat(outOfTurn.id);

    const slotsBeforeIntent = await slotsUsedOf(playerCaster.id);
    const intentCast = await cast({
      caster: { kind: 'character', id: playerCaster.id },
      targets: [{ kind: 'character', id: concTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    }, playerToken, '/spells/cast');
    const intents = intentCast.status === 202
      ? await prisma.spellCastIntent.count({
          where: { casterEntityId: playerCaster.id, status: 'pending' },
        })
      : 0;
    check(
      '82.AB) PLAYER sem confirmação espacial vira INTENT 202: zero slot, zero cast, zero rolagem',
      intentCast.status === 202 &&
        intents === 1 &&
        JSON.stringify(await slotsUsedOf(playerCaster.id)) === JSON.stringify(slotsBeforeIntent) &&
        (await prisma.spellCast.count({
          where: { casterEntityId: playerCaster.id, spellId: HEALING_WORD_SPELL_ID },
        })) === 0,
      JSON.stringify({ status: intentCast.status, data: intentCast.data }),
    );

    // =====================================================================
    // AD–AF — CONCENTRAÇÃO DO CASTER E CARD DE DEATH SAVE
    // =====================================================================
    const concCast = await cast({
      caster: { kind: 'character', id: concTarget.id },
      targets: [{ kind: 'character', id: hurtTarget.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    check(
      '82.AC) Palavra Curativa não cria Concentração nem altera a do conjurador',
      concCast.status === 201 &&
        concCast.data?.cast?.requiresConcentration === false &&
        concCast.data?.cast?.effectGroupId === null &&
        (await prisma.effectInstance.count({ where: { sourceId: concCast.data?.cast?.id } })) === 0,
      JSON.stringify({ status: concCast.status, cast: concCast.data?.cast?.id, error: concCast.data?.error }),
    );

    // Novo alvo a 0 PV, curado no turno do conjurador: no turno seguinte NÃO
    // existe card de Teste contra a Morte (o card é DERIVADO do estado).
    const cardZero = await makeCharacter('Alvo do card', ownerT7.id, { hpCurrent: 10, hpMax: 10 });
    characterIds.push(cardZero.id);
    await prisma.$transaction(async (tx) => {
      const damage = await resolveDamage(tx, {
        eventId: `hw-card-${cardZero.id}`,
        source: { kind: 'spell', label: 'Dano de fixture' },
        target: {
          kind: 'CHARACTER',
          id: cardZero.id,
          character: await tx.character.findUniqueOrThrow({ where: { id: cardZero.id } }),
        },
        components: [{ type: 'Radiante', rawAmount: 10 }],
      });
      await applyDamageConsequences(
        { kind: 'character', id: cardZero.id },
        {
          damage: 10,
          hpBefore: damage.hpBefore ?? 10,
          hpTempBefore: damage.hpTempBefore,
          critical: false,
          sourceName: 'Fixture',
        },
        tx,
        'Fixture',
      );
    });
    await prisma.character.update({
      where: { id: cardZero.id },
      data: {
        deathState: {
          ...deathStateOf(
            (await prisma.character.findUniqueOrThrow({ where: { id: cardZero.id } })).deathState,
          ),
          successes: 1,
          failures: 1,
        },
      },
    });
    const cardCombat = await makeCombat({
      caster: { id: cleric.id, name: cleric.name, ownerId: ownerCleric.id },
      targets: [{ id: cardZero.id, name: cardZero.name, ownerId: ownerT7.id, hp: 0 }],
    });
    const cardHeal = await cast({
      caster: { kind: 'character', id: cleric.id },
      targets: [{ kind: 'character', id: cardZero.id }],
      castingResource: { kind: 'spell-slot', level: 1 },
    });
    const freshCombat = await prisma.combat.findUniqueOrThrow({ where: { id: cardCombat.id } });
    const nextTurn = await request('/combat/next-turn', masterToken, {
      combatId: cardCombat.id,
      expectedVersion: freshCombat.version,
      operationId: randomUUID(),
    });
    const requests = await request(`/combat/${cardCombat.id}/resolution-requests`, masterToken);
    const deathCards = (requests.data?.requests ?? []).filter(
      (card: any) => card.kind === 'death-saving-throw',
    );
    check(
      '82.AD) depois da cura no turno do conjurador, o turno do alvo NÃO deriva card de Death Save',
      cardHeal.status === 201 &&
        cardHeal.data?.cast?.resolution?.finalHealing > 0 &&
        nextTurn.status === 200 &&
        deathCards.length === 0,
      JSON.stringify({ heal: cardHeal.status, next: nextTurn.status, cards: requests.data?.requests?.map((card: any) => card.kind) }),
    );

    const castsOfHealing = await prisma.spellCast.findMany({
      where: { spellId: HEALING_WORD_SPELL_ID, casterEntityId: { in: characterIds } },
      select: { id: true, status: true, outcome: true, resolutionSnapshot: true, effectGroupId: true },
    });
    check(
      '82.AE) todos os casts de Palavra Curativa estão `resolved` (nenhum `resolving` vazado) e com snapshot',
      castsOfHealing.length > 0 &&
        castsOfHealing.every(
          (row) => row.status === 'resolved' && row.resolutionSnapshot !== null && row.effectGroupId === null,
        ),
      JSON.stringify({ total: castsOfHealing.length, statuses: castsOfHealing.map((row) => row.status) }),
    );
    check(
      '82.AF) nenhum EffectInstance/PendingEffectSave nasceu das conjurações de cura',
      (await prisma.effectInstance.count({
        where: { sourceId: { in: castsOfHealing.map((row) => row.id) } },
      })) === 0 &&
        (await prisma.pendingEffectSave.count({
          where: { spellCastId: { in: castsOfHealing.map((row) => row.id) } },
        })) === 0,
      JSON.stringify({ casts: castsOfHealing.length }),
    );
    void HEALING_WORD_LABEL;
  } finally {
    // Cleanup SÓ do que este smoke criou (AGENTS.md): casts primeiro porque
    // referenciam caster/alvo; depois combate, criaturas, fichas e contas.
    try {
      await prisma.spellCastIntent.deleteMany({
        where: { casterEntityId: { in: characterIds } },
      });
      await prisma.pendingEffectSave.deleteMany({
        where: { casterEntityId: { in: characterIds } },
      });
      await prisma.spellCast.deleteMany({
        where: { casterEntityId: { in: characterIds } },
      });
      await prisma.effectInstance.deleteMany({
        where: {
          OR: [
            { id: { in: effectIds } },
            { sourceEntityId: { in: characterIds } },
            { targetEntityId: { in: characterIds } },
          ],
        },
      });
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (error) {
      console.error('[smoke-healing-word] falha na limpeza:', error);
    }
  }
}
