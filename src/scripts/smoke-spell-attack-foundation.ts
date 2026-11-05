import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/prisma.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import {
  attackDamageEventIdOf,
  attackOccurrenceIdOf,
  resolveAttackDamageSpell,
} from '../modules/spells/execution/attack-damage-resolution.js';
import {
  resolveAttackOutcome,
  rollAttackDamageComponents,
  selectAttackRoll,
} from '../modules/combat/attack-resolution.js';
import type { MechanicalEntity } from '../modules/shared/conditions.js';
import type { SpellExecutionDefinition } from '../modules/spells/execution/spell-execution-definition.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { getSpell } from '../modules/shared/spells/index.js';
import { characterSpellcastingProfile } from '../modules/spells/execution/spellcasting-source.js';
import { BLESS_LABEL, blessModifiers } from '../modules/effects/definitions/bless.js';
import { mechanicalStateOf } from '../modules/shared/conditions.js';
import { parseSpellResolutionSnapshot } from '../modules/spells/execution/spell-resolution-snapshot.js';
import { toSpellCastDto } from '../modules/spells/execution/spell-cast.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6I.4 — SMOKE DA FUNDAÇÃO DE SPELL ATTACK.
 *
 * Prova, com fixtures próprias:
 *  • o resolver de ataque é ÚNICO (arma e magia) e o weapon attack passou a usá-lo;
 *  • o d20/nat 1/nat 20/crítico são DETERMINÍSTICOS (helper puro + roll injetado);
 *  • vantagem/desvantagem cancelam e respeitam Esquiva, Caído e Invisibilidade;
 *  • o bônus de ataque vem do SNAPSHOT do `SpellCast` e a CA é o estado ATUAL;
 *  • Effects (CA, bônus fixo, dado opcional, vantagem) entram pelo mesmo motor;
 *  • o dano passa por `resolveDamage` (resistência/imunidade) e compõe morte e
 *    Concentração;
 *  • miss não cria evento de dano e retry não rola de novo;
 *  • a definição SINTÉTICA não está no catálogo nem no registry de produção.
 */

const SYNTHETIC_SPELL_ID = 'test.synthetic-spell-attack';

const TARGETING: SpellExecutionDefinition['targeting'] = {
  kind: 'creatures',
  minTargets: 1,
  targetCount: { base: 1, baseSlotLevel: 0, additionalPerSlotLevel: 0 },
  range: { kind: 'distance', feet: 60 },
  allowSelf: true,
  requiresSight: false,
  requiresClearPath: true,
  filters: [],
  groupConstraints: [],
};

function syntheticDefinition(
  kind: 'melee' | 'ranged',
  components: { type: string; dice?: { count: number; sides: number }; bonus?: number }[],
): SpellExecutionDefinition {
  return {
    spellId: SYNTHETIC_SPELL_ID,
    requiresConcentration: false,
    targeting: TARGETING,
    resolution: { kind: 'attack-damage', attack: { kind }, damage: { components } },
  };
}

const SYNTHETIC_RANGED = syntheticDefinition('ranged', [
  { type: 'Força', dice: { count: 1, sides: 10 }, bonus: 3 },
]);
const SYNTHETIC_MELEE = syntheticDefinition('melee', [
  { type: 'Força', dice: { count: 1, sides: 10 }, bonus: 3 },
]);
const SYNTHETIC_MULTI = syntheticDefinition('ranged', [
  { type: 'Força', dice: { count: 1, sides: 10 }, bonus: 3 },
  { type: 'Radiante', dice: { count: 1, sides: 6 } },
]);

/** Fonte de "dado" determinística: repete a sequência informada. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 1;
    index += 1;
    return value;
  };
}

export async function smokeSpellAttackFoundation(baseUrl: string, check: Check): Promise<void> {
  console.log('\n83) Fase 6.6I.4 — fundação compartilhada de ataque mágico (d20 vs CA)');
  void baseUrl;

  const sourceOf = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  const effectIds: string[] = [];
  const castIds: string[] = [];

  try {
    // =====================================================================
    // A–C — FUNDAÇÃO COMPARTILHADA (puro + arquitetura)
    // =====================================================================
    const resolvedHit = resolveAttackOutcome({ naturalRoll: 12, total: 15, targetAc: 15 });
    const resolvedMiss = resolveAttackOutcome({ naturalRoll: 12, total: 14, targetAc: 15 });
    check(
      '83.A) resolver compartilhado decide d20 vs CA: total >= CA acerta, total < CA erra',
      resolvedHit.hit && !resolvedHit.critical && !resolvedMiss.hit,
      JSON.stringify({ hit: resolvedHit, miss: resolvedMiss }),
    );

    const weaponService = sourceOf('../modules/combat/combat.service.ts');
    const spellAttackSource = sourceOf('../modules/spells/execution/attack-damage-resolution.ts');
    check(
      '83.B) o ataque de ARMA usa o resolver compartilhado (sem segundo motor d20 vs CA)',
      weaponService.includes("from './attack-resolution.js'") &&
        weaponService.includes('selectAttackRoll(') &&
        weaponService.includes('resolveAttackOutcome(') &&
        !weaponService.includes('attackRoll !== 1'),
      JSON.stringify({
        imports: weaponService.includes("from './attack-resolution.js'"),
        legacyNatOne: weaponService.includes('attackRoll !== 1'),
      }),
    );
    check(
      '83.C) o ataque MÁGICO usa o MESMO resolver e não rola d20 próprio',
      spellAttackSource.includes('selectAttackRoll(') &&
        spellAttackSource.includes('resolveAttackOutcome(') &&
        !spellAttackSource.includes('rollD20(') &&
        !spellAttackSource.includes('critical = attackRoll'),
      JSON.stringify({ resolver: spellAttackSource.includes('resolveAttackOutcome(') }),
    );

    // =====================================================================
    // D–J — REGRAS PURAS: 1/20 natural, modo, crítico e componentes
    // =====================================================================
    const nat1 = resolveAttackOutcome({ naturalRoll: 1, total: 99, targetAc: 10 });
    const nat20 = resolveAttackOutcome({ naturalRoll: 20, total: 5, targetAc: 50 });
    check(
      '83.D) nat 1 é SEMPRE miss (mesmo com total 99) e nat 20 é SEMPRE hit + crítico (mesmo contra CA 50)',
      !nat1.hit && nat1.autoMiss && nat20.hit && nat20.critical && nat20.autoHit,
      JSON.stringify({ nat1, nat20 }),
    );

    const advantageRoll = selectAttackRoll({ advantage: true, disadvantage: false, roll: sequence([3, 18]) });
    const disadvantageRoll = selectAttackRoll({ advantage: false, disadvantage: true, roll: sequence([18, 3]) });
    const cancelledRoll = selectAttackRoll({ advantage: true, disadvantage: true, roll: sequence([7, 19]) });
    const normalRoll = selectAttackRoll({ advantage: false, disadvantage: false, roll: sequence([11, 19]) });
    check(
      '83.E) vantagem pega o MAIOR d20, desvantagem o MENOR, os dois se cancelam e normal rola UM d20',
      advantageRoll.naturalRoll === 18 &&
        disadvantageRoll.naturalRoll === 3 &&
        // Os dois sinalizados ao MESMO tempo (entrada que a engine nunca produz)
        // continuam usando o menor: nenhum stack numérico é inventado.
        cancelledRoll.rolls.length === 2 &&
        cancelledRoll.mode === 'normal' &&
        normalRoll.rolls.length === 1 &&
        normalRoll.naturalRoll === 11,
      JSON.stringify({ advantageRoll, disadvantageRoll, cancelledRoll, normalRoll }),
    );

    const criticalComponents = rollAttackDamageComponents(
      [
        { type: 'Força', dice: { count: 1, sides: 10 }, bonus: 3 },
        { type: 'Radiante', dice: { count: 1, sides: 6 } },
      ],
      true,
      () => 4,
    );
    check(
      '83.F) crítico dobra TODOS os dados (2d10 + 2d6) e o bônus fixo entra UMA vez (não 2d10+6)',
      criticalComponents[0]?.count === 2 &&
        criticalComponents[0]?.rolls.length === 2 &&
        criticalComponents[0]?.bonus === 3 &&
        criticalComponents[0]?.rawAmount === 11 &&
        criticalComponents[1]?.count === 2 &&
        criticalComponents[1]?.rawAmount === 8,
      JSON.stringify(criticalComponents),
    );

    // =====================================================================
    // FIXTURES PRÓPRIAS (nunca dados reais da campanha)
    // =====================================================================
    const suffix = randomUUID().slice(0, 8);
    const makeUser = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          username: `sa_${label}_${suffix}`,
          displayName: `SA ${label}`,
          passwordHash: 'fixture',
          role: 'PLAYER',
        },
      });
      userIds.push(user.id);
      return user;
    };
    const makeCharacter = async (name: string, data: Record<string, unknown> = {}) => {
      const owner = await makeUser(name.slice(0, 8).toLowerCase());
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
          classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
          ...data,
        } as never,
      });
      characterIds.push(character.id);
      return character;
    };

    const caster = await makeCharacter('Conjurador de prova');
    const target = await makeCharacter('Alvo de prova', { armorClass: 15 });
    const concTarget = await makeCharacter('Alvo concentrando', {
      armorClass: 12,
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
    const zeroTarget = await makeCharacter('Alvo a 0 PV', { armorClass: 12, hpCurrent: 5, hpMax: 60 });

    const makeCreature = async (name: string, data: Record<string, unknown> = {}) => {
      const creature = await prisma.creature.create({
        data: {
          name,
          type: 'Besta',
          hpCurrent: 40,
          hpMax: 40,
          armorClass: 12,
          speed: 9,
          dexterity: 10,
          wisdom: 10,
          ...data,
        } as never,
      });
      creatureIds.push(creature.id);
      return creature;
    };
    const resistant = await makeCreature('Criatura resistente', { resistances: ['Força'] });
    const immune = await makeCreature('Criatura imune', { immunities: ['Força'] });
    const npcCaster = await makeCreature('Conjurador NPC', {
      spellcastingProfile: { saveDc: 15, attackBonus: 7, ability: 'charisma' },
    });

    const profile = characterSpellcastingProfile(caster, {
      kind: 'class',
      id: 'cleric',
      label: 'Clérigo',
      ability: 'wisdom',
    });
    const attackBonus = profile.spellAttackBonus ?? 0;
    check(
      '83.G) perfil derivado do personagem: ataque mágico = proficiência + SAB (snapshot +6)',
      attackBonus === 6 && profile.spellSaveDc === 14,
      JSON.stringify({ attackBonus, dc: profile.spellSaveDc }),
    );

    const makeCast = async (input: {
      casterEntity: MechanicalEntity;
      casterLabel: string;
      targetEntity: MechanicalEntity;
      bonus: number;
      ability?: string;
    }) => {
      const cast = await prisma.spellCast.create({
        data: {
          spellId: SYNTHETIC_SPELL_ID,
          casterEntityKind: input.casterEntity.kind,
          casterEntityId: input.casterEntity.id,
          casterLabel: input.casterLabel,
          targets: [{ kind: input.targetEntity.kind, id: input.targetEntity.id }] as never,
          status: 'resolving',
          requiresConcentration: false,
          spellcastingMode: 'derived',
          spellcastingAbility: input.ability ?? 'wisdom',
          spellcastingAbilityModifier: 3,
          spellcastingProficiencyBonus: 3,
          spellSaveDc: 14,
          spellAttackBonus: input.bonus,
          spellLevel: 0,
          castAtLevel: 0,
          operationId: `synthetic-${randomUUID()}`,
          fingerprint: randomUUID(),
          committedAt: new Date(),
        },
      });
      castIds.push(cast.id);
      return cast;
    };

    const runCast = (
      castId: string,
      casterEntity: MechanicalEntity,
      targetEntity: MechanicalEntity,
      execution: SpellExecutionDefinition,
      options: { roll?: (sides: number) => number; selectedEffectModifiers?: string[] } = {},
    ) =>
      prisma.$transaction(async (tx) => {
        const loadedCaster = await loadEntity(casterEntity, tx);
        const loadedTarget = await loadEntity(targetEntity, tx);
        const row = await tx.spellCast.findUniqueOrThrow({ where: { id: castId } });
        return resolveAttackDamageSpell(
          tx,
          row,
          { caster: loadedCaster, targets: [loadedTarget] },
          execution,
          options,
        );
      });

    const makeEffect = async (input: {
      target: MechanicalEntity;
      label?: string;
      modifiers: unknown[];
      visibility?: 'public' | 'private';
      definitionId?: string;
    }) => {
      const effect = await prisma.effectInstance.create({
        data: {
          groupId: randomUUID(),
          definitionId: input.definitionId ?? 'test.effect',
          label: input.label ?? 'Efeito de prova',
          sourceType: 'manual',
          targetEntityKind: input.target.kind,
          targetEntityId: input.target.id,
          visibility: input.visibility ?? 'public',
          status: 'active',
          modifiers: input.modifiers as never,
          conditions: [],
        },
      });
      effectIds.push(effect.id);
      return effect;
    };

    const snapshotOf = async (castId: string) => {
      const row = await prisma.spellCast.findUniqueOrThrow({ where: { id: castId } });
      const snapshot = parseSpellResolutionSnapshot(row.resolutionSnapshot);
      if (!snapshot || snapshot.kind !== 'attack-damage') throw new Error('snapshot ausente');
      return { row, snapshot };
    };
    const hpOf = async (characterId: string) =>
      (await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).hpCurrent;

    // =====================================================================
    // H–J — SNAPSHOT DO BÔNUS E CA ATUAL
    // =====================================================================
    const casterEntity: MechanicalEntity = { kind: 'character', id: caster.id };
    const targetEntity: MechanicalEntity = { kind: 'character', id: target.id };
    const snapshotCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    // Muda o atributo DEPOIS do commit: o ataque continua com o bônus snapshotado.
    await prisma.character.update({ where: { id: caster.id }, data: { wisdom: 20 } });
    const snapshotRun = await runCast(snapshotCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([15]),
    });
    check(
      '83.H) bônus de ataque vem do SNAPSHOT do cast (+6) e NÃO de uma nova leitura da ficha (SAB 20 daria +8)',
      snapshotRun.snapshot.attack.attackBonus === 6 &&
        snapshotRun.snapshot.attack.total === 15 + 6 &&
        snapshotRun.snapshot.attack.naturalRoll === 15,
      JSON.stringify(snapshotRun.snapshot.attack),
    );

    const missCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    await prisma.character.update({ where: { id: target.id }, data: { armorClass: 30 } });
    const missRun = await runCast(missCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([2]),
    });
    check(
      '83.I) CA usada é o estado ATUAL do alvo (30 no momento da resolução) e o miss não rola dano',
      missRun.snapshot.attack.targetAc === 30 &&
        !missRun.snapshot.attack.hit &&
        missRun.snapshot.damage === null &&
        missRun.snapshot.noEffectReason === 'attack-miss' &&
        missRun.cast.status === 'resolved' &&
        missRun.cast.outcome === 'no-effect',
      JSON.stringify({ attack: missRun.snapshot.attack, damage: missRun.snapshot.damage }),
    );
    await prisma.character.update({ where: { id: target.id }, data: { armorClass: 15 } });

    const hitCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const hpBeforeHit = await hpOf(target.id);
    const hitRun = await runCast(hitCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([15]),
    });
    const hpAfterHit = await hpOf(target.id);
    check(
      '83.J) acerto normal: 15+6=21 vs CA 15, dano rolado no servidor e HP via `resolveDamage`',
      hitRun.snapshot.attack.hit &&
        hitRun.snapshot.attack.total === 21 &&
        (hitRun.snapshot.damage?.finalDamage ?? 0) > 0 &&
        hpAfterHit === hpBeforeHit - (hitRun.snapshot.damage?.finalDamage ?? 0) &&
        hitRun.cast.outcome === 'effect',
      JSON.stringify({ attack: hitRun.snapshot.attack, damage: hitRun.snapshot.damage, hpBeforeHit, hpAfterHit }),
    );

    // nat 1 com bônus enorme e nat 20 contra CA inalcançável (funcional).
    const natOneCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: 40,
    });
    const natOneRun = await runCast(natOneCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([1]),
    });
    const natTwentyCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: 1,
    });
    await prisma.character.update({ where: { id: target.id }, data: { armorClass: 40 } });
    const natTwentyRun = await runCast(natTwentyCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([20]),
    });
    await prisma.character.update({ where: { id: target.id }, data: { armorClass: 15 } });
    check(
      '83.K) funcional: nat 1 com +40 é miss e nat 20 com +1 contra CA 40 é hit + crítico',
      !natOneRun.snapshot.attack.hit &&
        natOneRun.snapshot.attack.autoMiss &&
        natOneRun.snapshot.damage === null &&
        natTwentyRun.snapshot.attack.hit &&
        natTwentyRun.snapshot.attack.critical &&
        natTwentyRun.snapshot.attack.autoHit,
      JSON.stringify({
        nat1: natOneRun.snapshot.attack,
        nat20: natTwentyRun.snapshot.attack,
      }),
    );

    const critCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const critRun = await runCast(critCast.id, casterEntity, targetEntity, SYNTHETIC_MULTI, {
      roll: sequence([20, 4, 4, 4, 4]),
    });
    const critDamage = critRun.snapshot.damage;
    check(
      '83.L) crítico funcional: 1d10+3 Força + 1d6 Radiante vira 2d10+3 + 2d6 (bônus NÃO dobrado)',
      critRun.snapshot.attack.critical &&
        critDamage?.critical === true &&
        critDamage.components.length === 2 &&
        critDamage.components[0]?.count === 2 &&
        critDamage.components[0]?.rolls.length === 2 &&
        critDamage.components[0]?.bonus === 3 &&
        critDamage.components[0]?.raw === 11 &&
        critDamage.components[1]?.count === 2 &&
        critDamage.components[1]?.raw === 8,
      JSON.stringify(critDamage),
    );

    // =====================================================================
    // MODO DE ATAQUE — EFFECTS, ESQUIVA, CAÍDO E INVISIBILIDADE
    // =====================================================================
    // Os testes de dano anteriores podem ter deixado o alvo inconsciente/Caído
    // (0 PV) — estado que zera o deslocamento e suspende a Esquiva. Volta ao
    // estado NEUTRO para medir só o modo de ataque.
    await prisma.character.update({
      where: { id: target.id },
      data: { hpCurrent: 60, mechanicalState: {} as never },
    });

    const advantageEffect = await makeEffect({
      target: casterEntity,
      label: 'Vantagem de prova',
      modifiers: [{ kind: 'roll-advantage', roll: 'attack' }],
    });
    const advantageCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const advantageRun = await runCast(advantageCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([3, 18]),
    });
    await prisma.effectInstance.update({ where: { id: advantageEffect.id }, data: { status: 'ended' } });
    check(
      '83.M) Effect `roll-advantage` no atacante: 2d20 e o ataque usa o MAIOR',
      advantageRun.snapshot.attack.mode === 'advantage' &&
        advantageRun.snapshot.attack.rolls.length === 2 &&
        advantageRun.snapshot.attack.naturalRoll === 18,
      JSON.stringify(advantageRun.snapshot.attack),
    );

    const disadvantageEffect = await makeEffect({
      target: casterEntity,
      label: 'Desvantagem de prova',
      modifiers: [{ kind: 'roll-disadvantage', roll: 'attack' }],
    });
    const disadvantageCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const disadvantageRun = await runCast(
      disadvantageCast.id,
      casterEntity,
      targetEntity,
      SYNTHETIC_RANGED,
      { roll: sequence([18, 3]) },
    );
    await prisma.effectInstance.update({ where: { id: disadvantageEffect.id }, data: { status: 'ended' } });
    check(
      '83.N) Effect `roll-disadvantage`: 2d20 e o ataque usa o MENOR',
      disadvantageRun.snapshot.attack.mode === 'disadvantage' &&
        disadvantageRun.snapshot.attack.naturalRoll === 3,
      JSON.stringify(disadvantageRun.snapshot.attack),
    );

    const cancelAdv = await makeEffect({
      target: casterEntity,
      label: 'Vantagem',
      modifiers: [{ kind: 'roll-advantage', roll: 'attack' }],
    });
    const cancelDis = await makeEffect({
      target: casterEntity,
      label: 'Desvantagem',
      modifiers: [{ kind: 'roll-disadvantage', roll: 'attack' }],
    });
    const cancelCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const cancelRun = await runCast(cancelCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([9]),
    });
    await prisma.effectInstance.updateMany({
      where: { id: { in: [cancelAdv.id, cancelDis.id] } },
      data: { status: 'ended' },
    });
    check(
      '83.O) vantagem + desvantagem se CANCELAM (modo normal, um d20) — nunca somam stacks',
      cancelRun.snapshot.attack.mode === 'normal' &&
        cancelRun.snapshot.attack.rolls.length === 1 &&
        cancelRun.snapshot.attack.naturalRoll === 9,
      JSON.stringify(cancelRun.snapshot.attack),
    );

    // Esquiva: combatente com `dodging` verdadeiro no turno.
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
              characterId: target.id,
              name: target.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: 0,
              hpCurrent: 60,
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
    const dodgeCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const dodgeRun = await runCast(dodgeCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([2, 19]),
    });
    check(
      '83.P) Esquiva do alvo (em combate, vendo o atacante, deslocamento > 0) impõe DESVANTAGEM',
      dodgeRun.snapshot.attack.mode === 'disadvantage' &&
        dodgeRun.snapshot.attack.naturalRoll === 2,
      JSON.stringify(dodgeRun.snapshot.attack),
    );
    await prisma.combat.delete({ where: { id: dodgeCombat.id } });
    combatIds.splice(combatIds.indexOf(dodgeCombat.id), 1);

    // Caído: ranged fora de 5 ft = desvantagem; melee = vantagem.
    await prisma.character.update({
      where: { id: target.id },
      data: {
        mechanicalState: {
          conditions: [
            {
              id: `prone-${suffix}`,
              condition: 'prone',
              sourceType: 'manual',
              appliedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });
    const proneRangedCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const proneRangedRun = await runCast(
      proneRangedCast.id,
      casterEntity,
      targetEntity,
      SYNTHETIC_RANGED,
      { roll: sequence([17, 2]) },
    );
    const proneMeleeCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const proneMeleeRun = await runCast(proneMeleeCast.id, casterEntity, targetEntity, SYNTHETIC_MELEE, {
      roll: sequence([2, 17]),
    });
    await prisma.character.update({ where: { id: target.id }, data: { mechanicalState: {} } });
    check(
      '83.Q) Caído: ataque mágico À DISTÂNCIA tem desvantagem e CORPO A CORPO tem vantagem (mesma regra da arma)',
      proneRangedRun.snapshot.attack.mode === 'disadvantage' &&
        proneRangedRun.snapshot.attack.kind === 'ranged' &&
        proneMeleeRun.snapshot.attack.mode === 'advantage' &&
        proneMeleeRun.snapshot.attack.kind === 'melee',
      JSON.stringify({ ranged: proneRangedRun.snapshot.attack, melee: proneMeleeRun.snapshot.attack }),
    );

    // Invisibilidade: relação de visão, nos dois sentidos, e cancelamento.
    const invisible = (id: string) =>
      prisma.character.update({
        where: { id },
        data: {
          mechanicalState: {
            conditions: [
              {
                id: `invisible-${id}`,
                condition: 'invisible',
                sourceType: 'manual',
                appliedAt: new Date().toISOString(),
              },
            ],
          },
        },
      });
    await invisible(caster.id);
    const unseenAttackerCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const unseenAttackerRun = await runCast(
      unseenAttackerCast.id,
      casterEntity,
      targetEntity,
      SYNTHETIC_RANGED,
      { roll: sequence([4, 16]) },
    );
    await prisma.character.update({ where: { id: caster.id }, data: { mechanicalState: {} } });
    await invisible(target.id);
    const unseenTargetCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const unseenTargetRun = await runCast(
      unseenTargetCast.id,
      casterEntity,
      targetEntity,
      SYNTHETIC_RANGED,
      { roll: sequence([16, 4]) },
    );
    await invisible(caster.id);
    const bothUnseenCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const bothUnseenRun = await runCast(bothUnseenCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([5]),
    });
    await prisma.character.update({ where: { id: caster.id }, data: { mechanicalState: {} } });
    await prisma.character.update({ where: { id: target.id }, data: { mechanicalState: {} } });
    check(
      '83.R) Invisibilidade: atacante invisível = vantagem; alvo invisível = desvantagem; ambos = normal',
      unseenAttackerRun.snapshot.attack.mode === 'advantage' &&
        unseenTargetRun.snapshot.attack.mode === 'disadvantage' &&
        bothUnseenRun.snapshot.attack.mode === 'normal',
      JSON.stringify({
        attacker: unseenAttackerRun.snapshot.attack.mode,
        target: unseenTargetRun.snapshot.attack.mode,
        both: bothUnseenRun.snapshot.attack.mode,
      }),
    );

    // =====================================================================
    // S–T — EFFECTS DE ATAQUE: CA, BÔNUS FIXO, DADO OPCIONAL (BLESS)
    // =====================================================================
    const acEffect = await makeEffect({
      target: targetEntity,
      label: 'Defesa de prova',
      modifiers: [{ kind: 'ac-flat', value: 2 }],
    });
    await prisma.character.update({ where: { id: target.id }, data: { armorClass: 12 } });
    const acEffectCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const acEffectRun = await runCast(acEffectCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([4]),
    });
    await prisma.effectInstance.update({ where: { id: acEffect.id }, data: { status: 'ended' } });
    check(
      '83.S) Effect `ac-flat +2` no alvo entra na CA ATUAL usada pelo resolver (12 + 2 = 14)',
      acEffectRun.snapshot.attack.targetAc === 14,
      JSON.stringify(acEffectRun.snapshot.attack),
    );

    const flatEffect = await makeEffect({
      target: casterEntity,
      label: 'Precisão de prova',
      modifiers: [{ kind: 'roll-flat', roll: 'attack', value: 2 }],
    });
    const flatCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const flatRun = await runCast(flatCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([12]),
    });
    await prisma.effectInstance.update({ where: { id: flatEffect.id }, data: { status: 'ended' } });
    check(
      '83.T) Effect `roll-flat +2` de ataque entra no total do ATAQUE MÁGICO (12+6+2)',
      flatRun.snapshot.attack.effectBonus === 2 &&
        flatRun.snapshot.attack.total === 20 &&
        flatRun.snapshot.attack.sources.includes('Precisão de prova'),
      JSON.stringify(flatRun.snapshot.attack),
    );

    // Bless: o MESMO +1d4 opcional dos ataques de arma.
    const blessEffect = await makeEffect({
      target: casterEntity,
      label: BLESS_LABEL,
      definitionId: 'spell.bless',
      modifiers: blessModifiers(),
    });
    const blessOptionId = `${blessEffect.id}:attack`;
    const blessCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const blessRun = await runCast(blessCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([10, 3]),
      selectedEffectModifiers: [blessOptionId],
    });
    const blessWithoutCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const blessWithoutRun = await runCast(
      blessWithoutCast.id,
      casterEntity,
      targetEntity,
      SYNTHETIC_RANGED,
      { roll: sequence([10]) },
    );
    await prisma.effectInstance.update({ where: { id: blessEffect.id }, data: { status: 'ended' } });
    check(
      '83.U) Bless (+1d4 OPCIONAL) entra no ataque mágico só quando escolhido, rolado no SERVIDOR',
      blessRun.snapshot.attack.effectDice.length === 1 &&
        blessRun.snapshot.attack.effectDice[0]?.sides === 4 &&
        blessRun.snapshot.attack.effectDice[0]?.value === 3 &&
        blessRun.snapshot.attack.total === 10 + 6 + 3 &&
        blessWithoutRun.snapshot.attack.effectDice.length === 0 &&
        blessWithoutRun.snapshot.attack.total === 16,
      JSON.stringify({
        withBless: blessRun.snapshot.attack,
        withoutBless: blessWithoutRun.snapshot.attack,
      }),
    );

    const privateEffect = await makeEffect({
      target: casterEntity,
      label: 'Segredo do Mestre',
      visibility: 'private',
      modifiers: [{ kind: 'roll-flat', roll: 'attack', value: 3 }],
    });
    const privateCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity,
      bonus: attackBonus,
    });
    const privateRun = await runCast(privateCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([9]),
    });
    await prisma.effectInstance.update({ where: { id: privateEffect.id }, data: { status: 'ended' } });
    check(
      '83.V) Effect PRIVADO continua modificando o ataque (mecânica vale) sem vazar o nome no breakdown',
      privateRun.snapshot.attack.effectBonus === 3 &&
        privateRun.snapshot.attack.sources.every((label) => label === null) &&
        !JSON.stringify(privateRun.snapshot).includes('Segredo do Mestre'),
      JSON.stringify(privateRun.snapshot.attack),
    );

    // =====================================================================
    // W–Z — NÚCLEO DE DANO: RESISTÊNCIA, IMUNIDADE, CONCENTRAÇÃO, 0 PV
    // =====================================================================
    const resistedCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity: { kind: 'creature', id: resistant.id },
      bonus: 30,
    });
    const resistedRun = await runCast(
      resistedCast.id,
      casterEntity,
      { kind: 'creature', id: resistant.id },
      SYNTHETIC_RANGED,
      { roll: sequence([10, 6]) },
    );
    const resistedComponent = resistedRun.snapshot.damage?.components[0];
    check(
      '83.W) resistência ao tipo do ataque usa o núcleo compartilhado (dano pela metade)',
      resistedComponent?.modifier === 'resistance' &&
        resistedComponent.raw === 9 &&
        resistedComponent.applied === 4 &&
        resistedRun.snapshot.damage?.finalDamage === 4,
      JSON.stringify(resistedRun.snapshot.damage),
    );

    const immuneCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity: { kind: 'creature', id: immune.id },
      bonus: 30,
    });
    const immuneRun = await runCast(
      immuneCast.id,
      casterEntity,
      { kind: 'creature', id: immune.id },
      SYNTHETIC_RANGED,
      { roll: sequence([10, 6]) },
    );
    check(
      '83.X) imunidade zera o dano: nenhum evento de consequência e outcome `no-effect`',
      immuneRun.snapshot.attack.hit &&
        immuneRun.snapshot.damage?.finalDamage === 0 &&
        immuneRun.snapshot.noEffectReason === 'zero-damage' &&
        immuneRun.cast.outcome === 'no-effect' &&
        immuneRun.concentrationTarget === null,
      JSON.stringify({ damage: immuneRun.snapshot.damage, cast: immuneRun.cast.outcome }),
    );

    const concCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity: { kind: 'character', id: concTarget.id },
      bonus: attackBonus,
    });
    const concRun = await runCast(
      concCast.id,
      casterEntity,
      { kind: 'character', id: concTarget.id },
      SYNTHETIC_RANGED,
      { roll: sequence([15, 7]) },
    );
    const concRow = await prisma.character.findUniqueOrThrow({ where: { id: concTarget.id } });
    const concState = mechanicalStateOf(concRow.mechanicalState);
    const concSave = concState.pendingConcentrationSaves[0];
    check(
      '83.Y) dano final > 0 gera UM teste de Concentração com CD max(10, floor(dano/2)) e o MESMO eventId',
      concRun.snapshot.damage !== null &&
        concSave !== undefined &&
        concSave.dc === Math.max(10, Math.floor(concRun.snapshot.damage.finalDamage / 2)) &&
        concSave.eventId === attackDamageEventIdOf(concCast.id) &&
        concState.concentration !== null,
      JSON.stringify({ damage: concRun.snapshot.damage, saves: concState.pendingConcentrationSaves }),
    );

    const zeroCast = await makeCast({
      casterEntity,
      casterLabel: caster.name,
      targetEntity: { kind: 'character', id: zeroTarget.id },
      bonus: 30,
    });
    const zeroRun = await runCast(
      zeroCast.id,
      casterEntity,
      { kind: 'character', id: zeroTarget.id },
      SYNTHETIC_RANGED,
      { roll: sequence([20, 9, 9, 9, 9]) },
    );
    const zeroRow = await prisma.character.findUniqueOrThrow({ where: { id: zeroTarget.id } });
    check(
      '83.Z) dano que leva a 0 PV usa o lifecycle de morte existente (HP 0 + Testes contra a Morte)',
      zeroRow.hpCurrent === 0 &&
        zeroRun.snapshot.damage?.hpAfter === 0 &&
        (zeroRow.deathState as { deathSaves?: boolean } | null)?.deathSaves === true,
      JSON.stringify({ hp: zeroRow.hpCurrent, death: zeroRow.deathState }),
    );

    // =====================================================================
    // AA–AD — IDs, SNAPSHOT, RETRY, PRIVACIDADE E AUSÊNCIA NO CATÁLOGO
    // =====================================================================
    const { row: storedCast, snapshot: storedSnapshot } = await snapshotOf(hitCast.id);
    check(
      '83.AA) identidades determinísticas: occurrenceId e eventId derivados do cast (ataque 0)',
      storedSnapshot.attack.occurrenceId === `spell-cast:${hitCast.id}:attack:0` &&
        storedSnapshot.attack.occurrenceId === attackOccurrenceIdOf(hitCast.id) &&
        storedSnapshot.damage?.eventId === `spell-cast:${hitCast.id}:attack:0:damage` &&
        storedSnapshot.damage?.eventId === attackDamageEventIdOf(hitCast.id),
      JSON.stringify({ occurrenceId: storedSnapshot.attack.occurrenceId, eventId: storedSnapshot.damage?.eventId }),
    );
    check(
      '83.AB) `resolutionSnapshot` persistido (`attack-damage`), cast `resolved` e sem Concentração do conjurador',
      storedCast.status === 'resolved' &&
        storedCast.resolutionSnapshot !== null &&
        storedSnapshot.kind === 'attack-damage' &&
        storedCast.requiresConcentration === false &&
        storedCast.effectGroupId === null,
      JSON.stringify({ status: storedCast.status, outcome: storedCast.outcome }),
    );

    const hpBeforeRetry = await hpOf(target.id);
    const retryRun = await runCast(hitCast.id, casterEntity, targetEntity, SYNTHETIC_RANGED, {
      roll: sequence([20]),
    });
    const hpAfterRetry = await hpOf(target.id);
    check(
      '83.AC) retry devolve o snapshot salvo (replayed) sem rolar d20 nem aplicar dano de novo',
      retryRun.replayed &&
        // A resolução original forçou 15; o retry pediu 20 e NÃO rolou de novo.
        retryRun.snapshot.attack.naturalRoll === 15 &&
        retryRun.snapshot.damage?.finalDamage === storedSnapshot.damage?.finalDamage &&
        hpAfterRetry === hpBeforeRetry,
      JSON.stringify({ retry: retryRun.snapshot.attack, hpBeforeRetry, hpAfterRetry }),
    );

    const resistantDto = toSpellCastDto(
      await prisma.spellCast.findUniqueOrThrow({ where: { id: resistedCast.id } }),
    );
    const characterDto = toSpellCastDto(
      await prisma.spellCast.findUniqueOrThrow({ where: { id: hitCast.id } }),
    );
    check(
      '83.AD) DTO esconde a CA do alvo quando é criatura/NPC e mantém a do personagem; nada de bônus/d20 do cliente',
      characterDto.resolution?.kind === 'attack-damage' &&
        characterDto.resolution.attack.targetAc === 15 &&
        resistantDto.resolution?.kind === 'attack-damage' &&
        resistantDto.resolution.attack.targetAc === null &&
        !sourceOf('../modules/spells/execution/spell-cast.schema.ts').includes('attackBonus') &&
        !sourceOf('../modules/spells/execution/spell-cast.schema.ts').includes('naturalRoll'),
      JSON.stringify({
        character: characterDto.resolution,
        creature: resistantDto.resolution,
      }),
    );

    const npcCast = await makeCast({
      casterEntity: { kind: 'creature', id: npcCaster.id },
      casterLabel: npcCaster.name,
      targetEntity,
      bonus: 7,
    });
    const npcRun = await runCast(
      npcCast.id,
      { kind: 'creature', id: npcCaster.id },
      targetEntity,
      SYNTHETIC_RANGED,
      { roll: sequence([10]) },
    );
    check(
      '83.AE) NPC usa o bônus EXPLÍCITO do statblock (+7), sem recalcular por ND',
      npcRun.snapshot.attack.attackBonus === 7 && npcRun.snapshot.attack.total === 17,
      JSON.stringify(npcRun.snapshot.attack),
    );

    const registrySource = sourceOf('../modules/spells/execution/spell-execution-registry.ts');
    check(
      '83.AF) a definição SINTÉTICA não está no catálogo nem no registry de produção',
      spellExecutionDefinition(SYNTHETIC_SPELL_ID) === null &&
        !getSpell(SYNTHETIC_SPELL_ID) &&
        !registrySource.includes(SYNTHETIC_SPELL_ID) &&
        !registrySource.includes("kind: 'attack-damage'") &&
        !registrySource.includes('fire-bolt') &&
        !registrySource.includes('eldritch-blast') &&
        !registrySource.includes('inflict-wounds'),
      JSON.stringify({ registryHasSynthetic: registrySource.includes(SYNTHETIC_SPELL_ID) }),
    );

    check(
      '83.AG) nenhum EffectInstance/PendingEffectSave nasceu dos casts sintéticos (ataque instantâneo)',
      (await prisma.effectInstance.count({
        where: { sourceId: { in: castIds } },
      })) === 0 &&
        (await prisma.pendingEffectSave.count({
          where: { spellCastId: { in: castIds } },
        })) === 0,
      JSON.stringify({ casts: castIds.length }),
    );

  } finally {
    // Cleanup SÓ do que este smoke criou (AGENTS.md) — nunca dados reais.
    try {
      await prisma.spellCastIntent.deleteMany({ where: { casterEntityId: { in: characterIds } } });
      await prisma.pendingEffectSave.deleteMany({
        where: { spellCastId: { in: castIds } },
      });
      await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
      await prisma.effectInstance.deleteMany({
        where: {
          OR: [
            { id: { in: effectIds } },
            { targetEntityId: { in: [...characterIds, ...creatureIds] } },
          ],
        },
      });
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (error) {
      console.error('[smoke-spell-attack-foundation] falha na limpeza:', error);
    }
  }
}
