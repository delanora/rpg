import type { CombatStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import {
  ServerEvents,
  type AttackResolvedPayload,
  type DiceRolledPayload,
} from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { toCharacterDto } from '../characters/characters.dto.js';
import { toCreatureDto } from '../creatures/creatures.dto.js';
import { abilityModifier } from '../shared/dnd5e.js';
import { rollD20, rollDice } from '../shared/dice.js';
import {
  combatantAttacks,
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

export async function getActiveCombat(): Promise<CombatDto | null> {
  const combat = await findCombat({ status: { in: ACTIVE_STATUSES } });
  return combat ? toCombatDto(combat) : null;
}

/** --- Início ------------------------------------------------------------------ */

export async function startCombat(input: StartCombatInput): Promise<CombatDto> {
  const existing = await findCombat({ status: { in: ACTIVE_STATUSES } });
  if (existing) {
    throw new HttpError('Já existe um combate em andamento.', 409);
  }

  // Entram todos os personagens de jogador (a mesa é única e fixa) e as
  // criaturas escolhidas pelo mestre.
  const characters = await prisma.character.findMany({
    include: { user: { select: { role: true } } },
    orderBy: { name: 'asc' },
  });

  const creatures = input.creatureIds.length
    ? await prisma.creature.findMany({ where: { id: { in: input.creatureIds } } })
    : [];

  const created = await prisma.combat.create({
    data: {
      status: 'PENDING_INITIATIVE',
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
          ...creatures.map((creature) => ({
            kind: 'CREATURE' as const,
            creatureId: creature.id,
            name: creature.name,
            dexterityMod: abilityModifier(creature.dexterity),
          })),
        ],
      },
    },
  });

  const loaded = await loadCombatById(created.id);
  emit(ServerEvents.COMBAT_STARTED, { combat: toCombatDto(loaded) });

  return finalizeInitiative(created.id);
}

/**
 * Verifica se todos já rolaram; quando sim, monta a ordem e ativa o combate.
 * Chamada após cada rolagem de iniciativa.
 */
async function finalizeInitiative(combatId: string): Promise<CombatDto> {
  const combat = await loadCombatById(combatId);

  const everyoneRolled = combat.combatants.every((combatant) => combatant.initiative !== null);

  if (!everyoneRolled || combat.status !== 'PENDING_INITIATIVE') {
    const dto = toCombatDto(combat);
    emit(ServerEvents.COMBAT_UPDATED, { combat: dto });
    return dto;
  }

  await prisma.combat.update({
    where: { id: combatId },
    data: { status: 'ACTIVE', currentIndex: 0, round: 1 },
  });

  const active = await loadCombatById(combatId);
  const dto = toCombatDto(active);
  emit(ServerEvents.COMBAT_UPDATED, { combat: dto });
  emitTurn(dto);
  return dto;
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

  return finalizeInitiative(combat.id);
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

  const dto = toCombatDto(await loadCombatById(combat.id));
  emit(ServerEvents.COMBAT_UPDATED, { combat: dto });
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
    const nextHp = Math.max(0, Math.min(character.hpCurrent + delta, Math.max(character.hpMax, 0)));

    const updated = await prisma.character.update({
      where: { id: character.id },
      data: { hpCurrent: nextHp, version: { increment: 1 } },
    });

    // Reaproveita o canal da ficha: o jogador vê o próprio HP mudar na hora,
    // e o mestre vê no painel.
    const payload = {
      userId: updated.userId,
      username: character.user.username,
      characterId: updated.id,
      version: updated.version,
      changes: { hpCurrent: updated.hpCurrent },
      character: toCharacterDto(updated, character.user.username),
      at: new Date().toISOString(),
    };

    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(updated.userId, ServerEvents.SHEET_UPDATED, payload);

    return { hpCurrent: updated.hpCurrent, hpMax: updated.hpMax };
  }

  if (combatant.kind === 'CREATURE' && combatant.creatureId && combatant.creature) {
    const { creature } = combatant;
    const nextHp = Math.max(0, Math.min(creature.hpCurrent + delta, Math.max(creature.hpMax, 0)));

    const updated = await prisma.creature.update({
      where: { id: creature.id },
      data: { hpCurrent: nextHp, version: { increment: 1 } },
    });

    getBroadcaster().toMasters(ServerEvents.CREATURE_UPDATED, {
      creature: toCreatureDto(updated),
      changes: { hpCurrent: updated.hpCurrent },
    });

    return { hpCurrent: updated.hpCurrent, hpMax: updated.hpMax };
  }

  return null;
}

/** --- Ataque -------------------------------------------------------------------- */

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

  const targetArmorClass = target.character?.armorClass ?? target.creature?.armorClass ?? 10;

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

  if (hit) {
    const damage = rollDice(attack.damage, { crit: critical });

    if (damage) {
      damageRolled = damage.total;

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

      await changeHp(target, -damage.total);
    }
  }

  const dto = toCombatDto(await loadCombatById(combat.id));
  emit(ServerEvents.COMBAT_UPDATED, { combat: dto });

  const targetAfter = dto.combatants.find((item) => item.id === target.id);

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
    targetHpCurrent: targetAfter?.hpCurrent ?? 0,
    targetHpMax: targetAfter?.hpMax ?? 0,
    at: new Date().toISOString(),
  };

  emit(ServerEvents.ATTACK_RESOLVED, result);

  return { combat: dto, result };
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

  const dto = toCombatDto(await loadCombatById(combat.id));
  emit(ServerEvents.COMBAT_UPDATED, { combat: dto });
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
