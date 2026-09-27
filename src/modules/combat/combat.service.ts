import type { CombatStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import {
  ServerEvents,
  type AttackResolvedPayload,
  type DiceRolledPayload,
} from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { toSheetDto } from '../characters/characters.service.js';
import {
  computeMulticlassAdjustments,
  featureEffectsOf,
  getMulticlassFeatures,
  multiclassSneakAttack,
  normalizeClassEntries,
  normalizeClassState,
  type ClassAdjustments,
} from '../shared/classes.js';
import { abilityModifier, type AbilityKey } from '../shared/dnd5e.js';
import { parseDiceExpression, rollD20, rollDice } from '../shared/dice.js';
import {
  combatantAttacks,
  hideCreatureStats,
  orderCombatants,
  toCombatDto,
  type CombatDto,
  type CombatSourced,
  type CombatantSourced,
} from './combat.dto.js';
import type { AttackInput, ManualHpInput, StartCombatInput } from './combat.schema.js';

/** Quem está agindo (vem sempre do token). */
export interface CombatActor {
  userId: string;
  username: string;
  role: Role;
}

const ACTIVE_STATUSES: CombatStatus[] = ['PENDING_INITIATIVE', 'ACTIVE'];

/**
 * Carrega um combate já com as fichas/criaturas de cada combatente.
 * O HP é lido dessas relações — o combatente não guarda uma segunda cópia.
 */
function findCombat(where: { id?: string; status?: { in: CombatStatus[] } }) {
  return prisma.combat.findFirst({
    where,
    include: {
      locality: { select: { id: true, name: true } },
      combatants: {
        include: {
          character: { include: { user: { select: { username: true } } } },
          creature: true,
        },
      },
    },
  });
}

async function loadCombatById(id: string): Promise<CombatSourced> {
  const combat = await findCombat({ id });
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  return combat;
}

async function requireActiveCombat(): Promise<CombatSourced> {
  const combat = await findCombat({ status: { in: ACTIVE_STATUSES } });
  if (!combat) throw new HttpError('Nenhum combate em andamento.', 404);
  return combat;
}

function requireMaster(actor: CombatActor): void {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o mestre pode fazer isso.', 403);
  }
}

/** Publica para toda a mesa — jogadores e mestre acompanham o combate. */
function emit(event: (typeof ServerEvents)[keyof typeof ServerEvents], payload: unknown): void {
  try {
    getBroadcaster().toTable(event, payload);
  } catch (error) {
    console.error('[combat] falha ao publicar evento em tempo real:', error);
  }
}

/**
 * Estado do combate com visões distintas: o mestre recebe a vida e a CA das
 * criaturas, os jogadores não. Os personagens continuam visíveis para todos.
 */
function emitCombat(
  event: (typeof ServerEvents)[keyof typeof ServerEvents],
  dto: CombatDto,
): void {
  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(event, { combat: dto });
    broadcaster.toPlayers(event, { combat: hideCreatureStats(dto) });
  } catch (error) {
    console.error('[combat] falha ao publicar o combate em tempo real:', error);
  }
}

/** Oculta CA e vida do alvo no resultado do ataque (usado só para jogadores). */
function hideTargetStats(result: AttackResolvedPayload): AttackResolvedPayload {
  return {
    ...result,
    targetArmorClass: null,
    targetHpCurrent: null,
    targetHpMax: null,
    targetStatsHidden: true,
  };
}

function emitTurn(dto: CombatDto): void {
  if (dto.status !== 'ACTIVE') return;

  const current = dto.combatants[dto.currentIndex];
  if (!current) return;

  emit(ServerEvents.COMBAT_TURN, {
    combatId: dto.id,
    combatantId: current.id,
    combatantName: current.name,
    ownerUserId: current.ownerUserId,
    round: dto.round,
    index: dto.currentIndex,
  });
}

function announceRoll(payload: DiceRolledPayload): void {
  emit(ServerEvents.DICE_ROLLED, payload);
}

/** --- Consulta ---------------------------------------------------------------- */

export async function getActiveCombat(viewer: Role): Promise<CombatDto | null> {
  const combat = await findCombat({ status: { in: ACTIVE_STATUSES } });
  return combat ? toCombatDto(combat, viewer) : null;
}

/** --- Início ------------------------------------------------------------------ */

export async function startCombat(actor: CombatActor, input: StartCombatInput): Promise<CombatDto> {
  const existing = await findCombat({ status: { in: ACTIVE_STATUSES } });
  if (existing) {
    throw new HttpError('Já existe um combate em andamento.', 409);
  }

  // Entram todos os personagens de jogador (a mesa é única e fixa) e as
  // criaturas escolhidas pelo mestre, com a quantidade de cópias de cada uma.
  const characters = await prisma.character.findMany({
    include: { user: { select: { role: true } } },
    orderBy: { name: 'asc' },
  });

  const entries = input.entries.filter((entry) => entry.quantity > 0);
  const creatureIds = [...new Set(entries.map((entry) => entry.creatureId))];
  // NPCs são entidades narrativas e não entram em combate.
  const creatures = creatureIds.length
    ? await prisma.creature.findMany({
        where: { id: { in: creatureIds }, kind: 'CREATURE' },
      })
    : [];
  const creatureById = new Map(creatures.map((creature) => [creature.id, creature]));

  const creatureCombatants = entries.flatMap((entry) => {
    const creature = creatureById.get(entry.creatureId);
    if (!creature) return [];

    return Array.from({ length: entry.quantity }, (_, index) => ({
      kind: 'CREATURE' as const,
      creatureId: creature.id,
      // Cópias da mesma criatura recebem um sufixo para se distinguirem.
      name: entry.quantity > 1 ? `${creature.name} ${index + 1}` : creature.name,
      dexterityMod: abilityModifier(creature.dexterity),
      // Snapshot de vitais: cada cópia rastreia a própria vida.
      hpCurrent: creature.hpCurrent,
      hpMax: creature.hpMax,
      armorClass: creature.armorClass,
    }));
  });

  const created = await prisma.combat.create({
    data: {
      status: 'PENDING_INITIATIVE',
      ...(input.localityId ? { localityId: input.localityId } : {}),
      combatants: {
        create: [
          ...characters
            .filter((character) => character.user.role === 'PLAYER')
            .map((character) => ({
              kind: 'CHARACTER' as const,
              characterId: character.id,
              name: character.name,
              ownerUserId: character.userId,
              dexterityMod: abilityModifier(character.dexterity),
            })),
          ...creatureCombatants,
        ],
      },
    },
  });

  const loaded = await loadCombatById(created.id);
  emitCombat(ServerEvents.COMBAT_STARTED, toCombatDto(loaded, 'MASTER'));

  return finalizeInitiative(created.id, actor.role);
}

/**
 * Verifica se todos já rolaram; quando sim, monta a ordem e ativa o combate.
 * Chamada após cada rolagem de iniciativa.
 */
async function finalizeInitiative(combatId: string, viewer: Role): Promise<CombatDto> {
  const combat = await loadCombatById(combatId);

  const everyoneRolled = combat.combatants.every((combatant) => combatant.initiative !== null);

  if (!everyoneRolled || combat.status !== 'PENDING_INITIATIVE') {
    const dto = toCombatDto(combat, 'MASTER');
    emitCombat(ServerEvents.COMBAT_UPDATED, dto);
    return viewer === 'MASTER' ? dto : hideCreatureStats(dto);
  }

  await prisma.combat.update({
    where: { id: combatId },
    data: { status: 'ACTIVE', currentIndex: 0, round: 1 },
  });

  const active = await loadCombatById(combatId);
  const dto = toCombatDto(active, 'MASTER');
  emitCombat(ServerEvents.COMBAT_UPDATED, dto);
  emitTurn(dto);
  return viewer === 'MASTER' ? dto : hideCreatureStats(dto);
}

/** --- Iniciativa -------------------------------------------------------------- */

/**
 * Rola 1d20 + modificador de Destreza.
 *
 * Sem `combatantId`, rola a iniciativa do personagem de quem pediu (fluxo do
 * jogador). Com `combatantId`, só o mestre — serve para rolar pelas criaturas
 * e por jogadores ausentes.
 */
export async function rollInitiative(
  actor: CombatActor,
  combatantId?: string,
): Promise<CombatDto> {
  const combat = await requireActiveCombat();

  if (combat.status !== 'PENDING_INITIATIVE') {
    throw new HttpError('A ordem de iniciativa já foi montada.', 409);
  }

  const combatant = combatantId
    ? combat.combatants.find((item) => item.id === combatantId)
    : combat.combatants.find((item) => item.ownerUserId === actor.userId);

  if (!combatant) {
    if (combatantId) throw new HttpError('Combatente não encontrado.', 404);
    throw new HttpError('Você não tem um personagem neste combate.', 403);
  }

  if (actor.role !== 'MASTER' && combatant.ownerUserId !== actor.userId) {
    throw new HttpError('Você só pode rolar a sua própria iniciativa.', 403);
  }

  if (combatant.initiative !== null) {
    throw new HttpError(`${combatant.name} já rolou a iniciativa.`, 409);
  }

  const roll = rollD20();
  const total = roll + combatant.dexterityMod;

  await prisma.combatant.update({
    where: { id: combatant.id },
    data: { initiative: total, initiativeRoll: roll },
  });

  announceRoll({
    kind: 'initiative',
    actorName: combatant.name,
    expression: '1d20',
    rolls: [roll],
    sides: 20,
    modifier: combatant.dexterityMod,
    total,
    crit: roll === 20,
    at: new Date().toISOString(),
  });

  return finalizeInitiative(combat.id, actor.role);
}

/** --- Turnos ------------------------------------------------------------------- */

/** Avança o turno; ao passar do último, começa uma nova rodada. */
export async function nextTurn(actor: CombatActor): Promise<CombatDto> {
  requireMaster(actor);

  const combat = await requireActiveCombat();
  if (combat.status !== 'ACTIVE') {
    throw new HttpError('A ordem de iniciativa ainda não foi montada.', 409);
  }

  const ordered = orderCombatants(combat.combatants);

  let index = combat.currentIndex + 1;
  let round = combat.round;

  if (index >= ordered.length) {
    index = 0;
    round += 1;
  }

  await prisma.combat.update({
    where: { id: combat.id },
    data: { currentIndex: index, round },
  });

  const dto = toCombatDto(await loadCombatById(combat.id), 'MASTER');
  emitCombat(ServerEvents.COMBAT_UPDATED, dto);
  emitTurn(dto);
  return dto;
}

/** --- Dano e cura --------------------------------------------------------------- */

/**
 * Aplica dano (delta negativo) ou cura (delta positivo) na ficha/criatura de
 * origem, respeitando 0 como piso e o HP máximo como teto.
 *
 * Devolve `null` quando a origem não existe mais (deletada no meio do combate).
 */
async function changeHp(
  combatant: CombatantSourced,
  delta: number,
): Promise<{ hpCurrent: number; hpMax: number } | null> {
  if (combatant.kind === 'CHARACTER' && combatant.characterId && combatant.character) {
    const { character } = combatant;

    // Dano consome primeiro os PV temporários; só o excedente chega aos PV
    // atuais. Cura (delta positivo) não mexe nos temporários.
    let remaining = delta;
    let hpTemp = character.hpTemp;
    if (delta < 0) {
      const absorbed = Math.min(hpTemp, -delta);
      hpTemp -= absorbed;
      remaining = delta + absorbed;
    }

    const nextHp = Math.max(
      0,
      Math.min(character.hpCurrent + remaining, Math.max(character.hpMax, 0)),
    );

    const updated = await prisma.character.update({
      where: { id: character.id },
      data: { hpCurrent: nextHp, hpTemp, version: { increment: 1 } },
    });

    // Reaproveita o canal da ficha: o jogador vê o próprio HP mudar na hora,
    // e o mestre vê no painel.
    const payload = {
      userId: updated.userId,
      username: character.user.username,
      characterId: updated.id,
      version: updated.version,
      changes: { hpCurrent: updated.hpCurrent, hpTemp: updated.hpTemp },
      character: await toSheetDto(updated, character.user.username),
      at: new Date().toISOString(),
    };

    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(updated.userId, ServerEvents.SHEET_UPDATED, payload);

    return { hpCurrent: updated.hpCurrent, hpMax: updated.hpMax };
  }

  if (combatant.kind === 'CREATURE') {
    // A vida é do próprio combatente (snapshot): várias cópias iguais rastreiam
    // o dano independentemente e o bestiário não é alterado pelo combate.
    const hpMax = combatant.hpMax ?? combatant.creature?.hpMax ?? 0;
    const hpCurrent = combatant.hpCurrent ?? combatant.creature?.hpCurrent ?? 0;
    const nextHp = Math.max(0, Math.min(hpCurrent + delta, Math.max(hpMax, 0)));

    const updated = await prisma.combatant.update({
      where: { id: combatant.id },
      data: { hpCurrent: nextHp },
    });

    return { hpCurrent: updated.hpCurrent ?? nextHp, hpMax };
  }

  return null;
}

/** --- Ataque -------------------------------------------------------------------- */

/** Ajustes de features (Fúria, resistências...) de um personagem multiclasse. */
function characterAdjustments(character: {
  classes: unknown;
  classState: unknown;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}): ClassAdjustments {
  const entries = normalizeClassEntries(character.classes);
  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
  return computeMulticlassAdjustments(entries, normalizeClassState(character.classState), abilities);
}

/** Aplica a resistência do alvo a um tipo de dano (ex.: Fúria do bárbaro). */
function applyDamageResistance(
  target: CombatantSourced,
  damageType: string,
  total: number,
): number {
  if (target.kind !== 'CHARACTER' || !target.character || !damageType) return total;
  const adjustments = characterAdjustments(target.character);
  if (!adjustments.resistances.includes(damageType)) return total;
  return Math.floor(total / 2);
}

/**
 * Calcula o dano extra de Ataque Furtivo, quando aplicável.
 *
 * Requer que o atacante seja um personagem com a feature de Ataque Furtivo e
 * que a arma seja sutil ou à distância. As condições táticas (vantagem ou
 * aliado adjacente ao alvo) não são rastreadas pelo sistema: o jogador rola o
 * ataque somente quando elas valem.
 */
function rollSneakAttack(
  attacker: CombatantSourced,
  attack: { finesse: boolean; ranged: boolean },
  critical: boolean,
): { expression: string; total: number; rolls: number[] } | null {
  if (attacker.kind !== 'CHARACTER') return null;
  const character = attacker.character;
  if (!character) return null;
  if (!attack.finesse && !attack.ranged) return null;

  const entries = normalizeClassEntries(character.classes);
  const features = getMulticlassFeatures(entries);
  if (!features.some((feature) => featureEffectsOf(feature).some((effect) => effect.type === 'sneakAttack'))) {
    return null;
  }

  const dice = multiclassSneakAttack(entries);
  if (dice <= 0) return null;
  const expression = `${dice}d6`;
  const roll = rollDice(expression, { crit: critical });
  if (!roll) return null;

  return { expression, total: roll.total, rolls: roll.rolls };
}

/**
 * Resolve um ataque: rola 1d20 + bônus contra a CA do alvo; se acertar, rola o
 * dano (dobrado no crítico) e aplica no HP do alvo.
 */
export async function resolveAttack(
  actor: CombatActor,
  input: AttackInput,
): Promise<{ combat: CombatDto; result: AttackResolvedPayload }> {
  const combat = await requireActiveCombat();

  if (combat.status !== 'ACTIVE') {
    throw new HttpError('O combate não está em andamento.', 409);
  }

  const attacker = input.attackerCombatantId
    ? combat.combatants.find((item) => item.id === input.attackerCombatantId)
    : combat.combatants.find(
        (item) => item.kind === 'CHARACTER' && item.ownerUserId === actor.userId,
      );

  if (!attacker) {
    throw new HttpError('Você não tem um combatente neste combate.', 403);
  }

  if (actor.role !== 'MASTER' && attacker.ownerUserId !== actor.userId) {
    throw new HttpError('Você só pode atacar com o seu próprio personagem.', 403);
  }

  const target = combat.combatants.find((item) => item.id === input.targetCombatantId);
  if (!target) throw new HttpError('Alvo não encontrado neste combate.', 404);
  if (target.id === attacker.id) throw new HttpError('Escolha outro alvo.', 400);

  const attack = combatantAttacks(attacker).find((item) => item.id === input.attackId);
  if (!attack) {
    throw new HttpError('Ataque não encontrado nesta ficha ou criatura.', 404);
  }

  const targetArmorClass =
    target.armorClass ?? target.character?.armorClass ?? target.creature?.armorClass ?? 10;

  const attackRoll = rollD20();
  const attackTotal = attackRoll + attack.attackBonus;
  const critical = attackRoll === 20;
  // 20 natural sempre acerta; 1 natural sempre erra.
  const hit = critical || (attackRoll !== 1 && attackTotal >= targetArmorClass);

  announceRoll({
    kind: 'attack',
    actorName: attacker.name,
    expression: '1d20',
    rolls: [attackRoll],
    sides: 20,
    modifier: attack.attackBonus,
    total: attackTotal,
    crit: critical,
    at: new Date().toISOString(),
  });

  let damageRolled = 0;
  let sneakAttackResult: { expression: string; total: number } | null = null;

  if (hit) {
    const damage = rollDice(attack.damage, { crit: critical });

    if (damage) {
      const attackerAdjustments =
        attacker.kind === 'CHARACTER' && attacker.character
          ? characterAdjustments(attacker.character)
          : null;

      let total = damage.total;

      // Crítico Brutal: dados de arma extras no crítico (só corpo a corpo).
      if (critical && attackerAdjustments && attackerAdjustments.critExtraDice > 0) {
        const spec = parseDiceExpression(attack.damage);
        if (spec && spec.count > 0) {
          const extra = rollDice(
            `${spec.count * attackerAdjustments.critExtraDice}d${spec.sides}`,
            { crit: false },
          );
          if (extra && extra.total > 0) {
            total += extra.total;
            announceRoll({
              kind: 'damage',
              actorName: `${attacker.name} — Crítico Brutal`,
              expression: extra.expression,
              rolls: extra.rolls,
              sides: extra.sides,
              modifier: 0,
              total: extra.total,
              crit: true,
              at: new Date().toISOString(),
            });
          }
        }
      }

      // Bônus de dano corpo a corpo (Fúria) — não vale para armas à distância.
      if (!attack.ranged && attackerAdjustments && attackerAdjustments.meleeDamageBonus > 0) {
        total += attackerAdjustments.meleeDamageBonus;
        announceRoll({
          kind: 'damage',
          actorName: `${attacker.name} — Fúria`,
          expression: `+${attackerAdjustments.meleeDamageBonus}`,
          rolls: [],
          sides: 0,
          modifier: attackerAdjustments.meleeDamageBonus,
          total: attackerAdjustments.meleeDamageBonus,
          crit: false,
          at: new Date().toISOString(),
        });
      }

      // Ataque Furtivo: entra automaticamente em armas sutis ou à distância
      // quando a classe concede a feature. O jogador rola o ataque justamente
      // nas situações em que ele se aplica (vantagem ou aliado adjacente).
      const sneak = rollSneakAttack(attacker, attack, critical);
      if (sneak) {
        total += sneak.total;
        sneakAttackResult = { expression: sneak.expression, total: sneak.total };

        announceRoll({
          kind: 'damage',
          actorName: `${attacker.name} — Ataque Furtivo`,
          expression: sneak.expression,
          rolls: sneak.rolls,
          sides: 6,
          modifier: 0,
          total: sneak.total,
          crit: critical,
          at: new Date().toISOString(),
        });
      }

      announceRoll({
        kind: 'damage',
        actorName: attacker.name,
        expression: damage.expression,
        rolls: damage.rolls,
        sides: damage.sides,
        modifier: damage.modifier,
        total: damage.total,
        crit: critical,
        at: new Date().toISOString(),
      });

      // Resistência do alvo (ex.: Fúria do bárbaro halva dano físico).
      total = applyDamageResistance(target, attack.damageType, total);
      damageRolled = total;

      await changeHp(target, -total);
    }
  }

  const dto = toCombatDto(await loadCombatById(combat.id), 'MASTER');
  emitCombat(ServerEvents.COMBAT_UPDATED, dto);

  const targetAfter = dto.combatants.find((item) => item.id === target.id);
  const targetIsCreature = target.kind === 'CREATURE';

  const result: AttackResolvedPayload = {
    attackerName: attacker.name,
    attackName: attack.name,
    targetName: target.name,
    attackRoll,
    attackBonus: attack.attackBonus,
    attackTotal,
    targetArmorClass,
    hit,
    critical,
    damageRolled,
    damageType: attack.damageType,
    sneakAttack: sneakAttackResult,
    targetHpCurrent: targetAfter?.hpCurrent ?? 0,
    targetHpMax: targetAfter?.hpMax ?? 0,
    targetStatsHidden: false,
    at: new Date().toISOString(),
  };

  // Jogador atacando criatura não vê a CA nem a vida dela; o mestre vê tudo.
  const resultForPlayers = targetIsCreature ? hideTargetStats(result) : result;

  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.ATTACK_RESOLVED, result);
    broadcaster.toPlayers(ServerEvents.ATTACK_RESOLVED, resultForPlayers);
  } catch (error) {
    console.error('[combat] falha ao publicar o ataque em tempo real:', error);
  }

  return actor.role === 'MASTER'
    ? { combat: dto, result }
    : { combat: hideCreatureStats(dto), result: resultForPlayers };
}

/** Ajuste manual de HP pelo mestre (dano ou cura). */
export async function applyManualHp(
  actor: CombatActor,
  input: ManualHpInput,
): Promise<CombatDto> {
  requireMaster(actor);

  const combat = await requireActiveCombat();

  const combatant = combat.combatants.find((item) => item.id === input.combatantId);
  if (!combatant) throw new HttpError('Combatente não encontrado.', 404);

  const delta = input.mode === 'damage' ? -input.amount : input.amount;
  const applied = await changeHp(combatant, delta);

  if (!applied) {
    throw new HttpError('A ficha ou criatura deste combatente não existe mais.', 409);
  }

  const dto = toCombatDto(await loadCombatById(combat.id), 'MASTER');
  emitCombat(ServerEvents.COMBAT_UPDATED, dto);
  return dto;
}

/** --- Encerramento --------------------------------------------------------------- */

export async function endCombat(actor: CombatActor): Promise<{ combatId: string }> {
  requireMaster(actor);

  const combat = await requireActiveCombat();

  await prisma.combat.update({
    where: { id: combat.id },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  emit(ServerEvents.COMBAT_ENDED, { combatId: combat.id });

  return { combatId: combat.id };
}
