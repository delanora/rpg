import { deriveConditionEffects, effectiveSpeed, effectiveMaxHp, reconcileMovement, conditionAttackMode, mechanicalStateOf } from '../shared/conditions.js';
import { createHash, randomUUID } from 'node:crypto';
import { COMBAT_ACTIONS, deriveAttackActionLimit, economyOf, moveDistance, onTurnEnd, onTurnStart, recordAttack, spendEconomy } from '../shared/action-economy.js';
import type { CombatOperationInput, EconomyActionInput, EconomyOverrideInput } from './combat.schema.js';
import type { CombatStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { inventoryListSchema } from '../characters/characters.schema.js';
import {
  ServerEvents,
  type AttackResolvedPayload,
  type DamageBreakdownPayload,
  type DamageComponentPayload,
  type DamagePartPayload,
  type DiceRolledPayload,
} from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { characterArmorClass, characterCritThreshold } from '../characters/armor-class.js';
import { toSheetDto } from '../characters/characters.service.js';
import { characterClassAdjustments } from '../characters/characters.dto.js';
import { availableQuantity, reservedQuantities } from '../rest/camp-supply-reservations.js';
import {
  computeMulticlassAdjustments,
  featureEffectsOf,
  getMulticlassFeatures,
  multiclassSneakAttack,
  normalizeClassEntries,
  normalizeClassState,
  type ClassAdjustments,
} from '../shared/classes.js';
import {
  ammoStacks,
  chooseAmmoStack,
  isWeaponEquipped,
  requiredAmmoType,
  type InventoryLike,
} from '../shared/ammo.js';
import { attackDamages, damageExpression, damageIsEmpty } from '../shared/attacks.js';
import { ABILITY_LABELS, abilityModifier, type AbilityKey } from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import type { AmmoType } from '../shared/item-details.js';
import { rollD20, rollDice } from '../shared/dice.js';
import {
  combatantAttacks,
  combatantMechanicalState,
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
function findCombat(where: { id?: string; status?: { in: CombatStatus[] } }, db: Prisma.TransactionClient = prisma) {
  return db.combat.findFirst({
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

export async function loadCombatById(id: string, db: Prisma.TransactionClient = prisma): Promise<CombatSourced> {
  const combat = await findCombat({ id }, db);
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

/**
 * Verdadeiro quando o erro é uma violação de índice único do Prisma (P2002).
 * Usado para transformar a corrida do índice parcial de combate ativo em 409.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
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
export function emitCombat(
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

/** A unidade canônica já exposta pela ficha e pelas criaturas é metros. */
function combatantSpeed(combatant: CombatantSourced): number {
  return Math.max(0, combatant.character?.speed ?? combatant.creature?.speed ?? 0);
}

function requireOwnTurn(combat: CombatSourced, combatant: CombatantSourced): void {
  if (orderCombatants(combat.combatants)[combat.currentIndex]?.id !== combatant.id) {
    throw new HttpError('Esta ação exige o turno do combatente. O Mestre pode corrigir a ordem explicitamente.', 403);
  }
}

function actingCombatant(combat: CombatSourced, actor: CombatActor, id: string): CombatantSourced {
  const combatant = combat.combatants.find((item) => item.id === id);
  if (!combatant) throw new HttpError('Combatente não encontrado.', 404);
  if (actor.role !== 'MASTER' && combatant.ownerUserId !== actor.userId) {
    throw new HttpError('Você só pode agir com seu combatente.', 403);
  }
  return combatant;
}

function equippedLightWeapons(combatant: CombatantSourced) {
  if (!combatant.character) return [];
  return inventoryListSchema.parse(combatant.character.inventory).filter((item) =>
    isWeaponEquipped(item) && (item.slot === 'hand1' || item.slot === 'hand2') &&
    item.details.weaponType === 'melee' && item.details.properties?.includes('light'),
  );
}

function isLightEquippedWeapon(combatant: CombatantSourced, id: string): boolean {
  return equippedLightWeapons(combatant).some((item) => item.id === id);
}

function validateOffhand(combatant: CombatantSourced, id: string | undefined, attacked: string[]): void {
  const weapons = equippedLightWeapons(combatant);
  const offhand = weapons.find((item) => item.id === id);
  if (!offhand || !weapons.some((other) => other.id !== id && other.slot !== offhand.slot && attacked.includes(other.id))) {
    throw new HttpError('Mão secundária exige Attack Action com outra arma corpo a corpo leve empunhada na outra mão.', 409, 'CONFLICT');
  }
}

async function appendEconomyLog(db: Prisma.TransactionClient, combat: CombatSourced, combatant: CombatantSourced, message: string, action?: string): Promise<void> {
  const log = toCombatDto(combat, 'MASTER').economyLog;
  const entry = { id: randomUUID(), actorName: combatant.name, message, at: new Date().toISOString(), ...(action ? { action } : {}) };
  combat.economyLog = [...log, entry].slice(-100);
  await db.combat.update({ where: { id: combat.id }, data: { economyLog: combat.economyLog as Prisma.InputJsonValue } });
}

/** Uma única versão serializa turno, consumo, ataques e overrides no combate. */
async function runCombatOperation<T extends { combat: CombatDto }>(
  actor: CombatActor, input: CombatOperationInput, type: string,
  apply: (db: Prisma.TransactionClient, combat: CombatSourced) => Promise<T>,
): Promise<T & { replayed: boolean }> {
  const fingerprint = createHash('sha256').update(JSON.stringify({ type, actor: actor.userId, input })).digest('hex');
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) throw new HttpError('operationId reutilizado com outro payload/autor.', 409, 'IDEMPOTENCY_KEY_REUSED');
    return { ...(operation.snapshot as T), replayed: true };
  };
  const key = { combatId_operationId: { combatId: input.combatId, operationId: input.operationId } };
  const existing = await prisma.combatOperation.findUnique({ where: key });
  if (existing) return replay(existing);
  let result: T;
  try {
    result = await prisma.$transaction(async (db) => {
      const previous = await db.combatOperation.findUnique({ where: key });
      if (previous) return replay(previous);
      const changed = await db.combat.updateMany({
        where: { id: input.combatId, status: 'ACTIVE', version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new HttpError('Combate mudou ou não está ativo. Atualize e tente novamente.', 409, 'CONFLICT');
      const combat = await loadCombatById(input.combatId, db);
      const response = await apply(db, combat);
      await db.combatOperation.create({ data: {
        combatId: combat.id, operationId: input.operationId, fingerprint,
        snapshot: response as unknown as Prisma.InputJsonValue,
      } });
      return response;
    }, { timeout: 15000 });
  } catch (error) {
    // Dois retries simultâneos da MESMA operação: o perdedor devolve o snapshot.
    const previous = await prisma.combatOperation.findUnique({ where: key });
    if (previous) return replay(previous);
    throw error;
  }
  if ('replayed' in result && result.replayed) return result as T & { replayed: boolean };
  const latest = toCombatDto(await loadCombatById(input.combatId), 'MASTER');
  emitCombat(ServerEvents.COMBAT_UPDATED, latest);
  return { ...result, replayed: false };
}

export async function executeEconomyAction(actor: CombatActor, input: EconomyActionInput) {
  return runCombatOperation(actor, input, 'economy-action', async (db, combat) => {
    const combatant = actingCombatant(combat, actor, input.combatantId);
    const economy = economyOf(combatant.turnEconomy);
    if (input.targetCombatantId && !combat.combatants.some((item) => item.id === input.targetCombatantId)) {
      throw new HttpError('Alvo não encontrado neste combate.', 404);
    }
    const effects = deriveConditionEffects(combatantMechanicalState(combatant));
    if (input.action !== 'move' && !effects.canAct) throw new HttpError('Condição impede Ações, Ações Bônus e Reações.', 409, 'CONFLICT');
    if (input.action === 'execute-ready') {
      if (!economy.ready) throw new HttpError('Nenhuma ação preparada.', 409, 'CONFLICT');
      spendEconomy(economy, 'reaction');
      await appendEconomyLog(db, combat, combatant, `Executou ação preparada: ${economy.ready.intent}. Gatilho confirmado manualmente.`, input.action);
      economy.ready = null;
    } else {
      requireOwnTurn(combat, combatant);
      if (input.action === 'move') {
        const available = reconcileMovement(economy, combatantSpeed(combatant), effectiveSpeed(combatantSpeed(combatant), combatantMechanicalState(combatant)));
        moveDistance(available, input.distance! * effects.movementCostMultiplier);
        economy.movementUsed = available.movementUsed;
      }
      else {
        spendEconomy(economy, COMBAT_ACTIONS[input.action].economy);
        if (input.action === 'dash' && !effects.speedZero) {
          if (economy.movementOverrideBudget !== null) economy.movementOverrideBudget += effectiveSpeed(combatantSpeed(combatant), combatantMechanicalState(combatant));
          else economy.movementBudget += combatantSpeed(combatant);
        }
        if (input.action === 'ready') economy.ready = { trigger: input.trigger!, intent: input.intent! };
        const context = input.action === 'ready' ? `${input.trigger} → ${input.intent}` : input.description;
        const target = input.targetCombatantId ? combat.combatants.find((item) => item.id === input.targetCombatantId)?.name : null;
        await appendEconomyLog(db, combat, combatant, `${COMBAT_ACTIONS[input.action].name}${target ? ` → ${target}` : ''}${context ? `: ${context}` : ''}.`, input.action);
      }
    }
    await db.combatant.update({ where: { id: combatant.id }, data: { turnEconomy: economy } });
    return { combat: toCombatDto(await loadCombatById(combat.id, db), actor.role) };
  });
}

export async function overrideEconomy(actor: CombatActor, input: EconomyOverrideInput) {
  requireMaster(actor);
  return runCombatOperation(actor, input, 'economy-override', async (db, combat) => {
    const combatant = actingCombatant(combat, actor, input.combatantId);
    const economy = economyOf(combatant.turnEconomy);
    const messages = {
      'grant-action': 'concedeu +1 Ação', 'restore-action': 'recuperou as Ações',
      'restore-bonus': 'recuperou a Ação Bônus', 'restore-reaction': 'recuperou a Reação',
      'set-movement': `ajustou Movimento restante para ${input.remaining} m`,
    };
    if (input.adjustment === 'grant-action') economy.actionsGranted += 1;
    if (input.adjustment === 'restore-action') economy.actionsUsed = 0;
    if (input.adjustment === 'restore-bonus') economy.bonusActionUsed = false;
    if (input.adjustment === 'restore-reaction') economy.reactionAvailable = true;
    if (input.adjustment === 'set-movement') {
      const base = combatantSpeed(combatant), speed = effectiveSpeed(base, combatantMechanicalState(combatant));
      if (speed <= 0 && input.remaining! > 0) throw new HttpError('Deslocamento efetivo zero; remova a condição explicitamente antes de conceder movimento.', 409, 'CONFLICT');
      economy.movementOverrideBudget = economy.movementUsed + input.remaining!;
    }
    await db.combatant.update({ where: { id: combatant.id }, data: { turnEconomy: economy } });
    await appendEconomyLog(db, combat, combatant, `Mestre ${actor.username} ${messages[input.adjustment]} para ${combatant.name}: ${input.reason}.`, `override:${input.adjustment}`);
    return { combat: toCombatDto(await loadCombatById(combat.id, db), 'MASTER') };
  });
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
  // NPCs e criaturas usam o mesmo combatente e a mesma economia quando escolhidos.
  const creatures = creatureIds.length
    ? await prisma.creature.findMany({
        where: { id: { in: creatureIds } },
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
      mechanicalState: { ...mechanicalStateOf(creature.mechanicalState), conditions: mechanicalStateOf(creature.mechanicalState).conditions.map(instance => ({ ...instance, id: randomUUID() })), log: [] } as unknown as Prisma.InputJsonValue,
    }));
  });

  let created;
  try {
    created = await prisma.combat.create({
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
  } catch (error) {
    // O índice único PARCIAL `combats_one_active_key` garante no banco que só
    // exista um combate com status <> 'ENDED'. A checagem acima (findCombat) é
    // só o caminho rápido; numa corrida de dois cliques, o segundo INSERT
    // esbarra no índice (P2002) e vira o mesmo 409.
    if (isUniqueViolation(error)) {
      throw new HttpError('Já existe um combate em andamento.', 409);
    }
    throw error;
  }

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

  await prisma.$transaction(async (db) => {
    const changed = await db.combat.updateMany({
      where: { id: combatId, status: 'PENDING_INITIATIVE' },
      data: { status: 'ACTIVE', currentIndex: 0, round: 1, version: { increment: 1 } },
    });
    if (!changed.count) return;
    const first = orderCombatants(combat.combatants)[0];
    if (first) await db.combatant.update({
      where: { id: first.id }, data: { turnEconomy: onTurnStart(combatantSpeed(first)), sneakAttackUsedThisTurn: false },
    });
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
export async function rollInitiative(actor: CombatActor, combatantId?: string): Promise<CombatDto> {
  const selectedCombat = await requireActiveCombat();
  const payload = await prisma.$transaction(async db => {
    // A rolagem existente não recebe expectedVersion; o lock do combate ordena
    // participantes diferentes e impede usar condições de um snapshot antigo.
    const locked = await db.combat.updateMany({ where: { id: selectedCombat.id, status: 'PENDING_INITIATIVE' }, data: { version: { increment: 1 } } });
    if (!locked.count) throw new HttpError('A ordem de iniciativa já foi montada.', 409);
    const combat = await loadCombatById(selectedCombat.id, db);
    const combatant = combatantId ? combat.combatants.find(item => item.id === combatantId) : combat.combatants.find(item => item.ownerUserId === actor.userId);
    if (!combatant) throw new HttpError('Combatente não encontrado.', combatantId ? 404 : 403);
    if (actor.role !== 'MASTER' && combatant.ownerUserId !== actor.userId) throw new HttpError('Você só pode rolar a sua própria iniciativa.', 403);
    if (combatant.initiative !== null) throw new HttpError(`${combatant.name} já rolou a iniciativa.`, 409);
    const disadvantage = deriveConditionEffects(combatantMechanicalState(combatant)).checkDisadvantage;
    const first = rollD20(), second = disadvantage ? rollD20() : null;
    const roll = second === null ? first : Math.min(first, second), total = roll + combatant.dexterityMod;
    await db.combatant.update({ where: { id: combatant.id }, data: { initiative: total, initiativeRoll: roll } });
    return { kind: 'initiative' as const, actorName: combatant.name, expression: disadvantage ? '1d20 (desvantagem)' : '1d20', rolls: second === null ? [roll] : [first, second], sides: 20, modifier: combatant.dexterityMod, total, crit: roll === 20, at: new Date().toISOString() };
  });
  announceRoll(payload);
  return finalizeInitiative(selectedCombat.id, actor.role);
}

/** --- Turnos ------------------------------------------------------------------- */

/**
 * Avança o turno; ao passar do último, começa uma nova rodada.
 *
 * O mestre avança a qualquer momento. O JOGADOR só encerra o PRÓPRIO turno:
 * é preciso que o combatente atual seja dele (fora do turno, 403). Durante a
 * espera pela iniciativa não há turno corrente, então ninguém além do mestre
 * avança.
 */
export async function nextTurn(actor: CombatActor, input: CombatOperationInput): Promise<CombatDto> {
  const pending = await prisma.combat.findUnique({ where: { id: input.combatId }, select: { status: true } });
  if (pending?.status === 'PENDING_INITIATIVE' && actor.role !== 'MASTER') throw new HttpError('Só o mestre ou o dono do turno atual pode encerrar o turno.', 403);
  const response = await runCombatOperation(actor, input, 'next-turn', async (db, combat) => {
    const ordered = orderCombatants(combat.combatants);
    const outgoing = ordered[combat.currentIndex];
    if (actor.role !== 'MASTER' && outgoing?.ownerUserId !== actor.userId) {
      throw new HttpError('Só o mestre ou o dono do turno atual pode encerrar o turno.', 403);
    }
    const index = (combat.currentIndex + 1) % ordered.length;
    const round = combat.round + (index === 0 ? 1 : 0);
    await db.combatant.update({ where: { id: outgoing.id }, data: { turnEconomy: onTurnEnd(economyOf(outgoing.turnEconomy)) } });
    const incoming = ordered[index];
    await db.combat.update({ where: { id: combat.id }, data: { currentIndex: index, round } });
    await db.combatant.update({ where: { id: incoming.id }, data: {
      sneakAttackUsedThisTurn: false, turnEconomy: onTurnStart(combatantSpeed(incoming)),
    } });
    return { combat: toCombatDto(await loadCombatById(combat.id, db), actor.role) };
  });
  if (!response.replayed) emitTurn(response.combat);
  return response.combat;
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
  db: Prisma.TransactionClient = prisma,
  publications?: Set<string>,
): Promise<{ hpCurrent: number; hpMax: number } | null> {
  if (combatant.kind === 'CHARACTER' && combatant.characterId && combatant.character) {
    const { character } = combatant;
    // O teto de PV de um personagem é DERIVADO: o gravado + o `hpBonus` de
    // features/talentos (Resiliência Dracônica, Vigoroso), como na ficha.
    const hpBonus = characterClassAdjustments(character).hpBonus;

    // A escrita é ATÔMICA no banco (`UPDATE ... SET hpCurrent = ...`): o valor
    // novo é calculado a partir do que está GRAVADO, não do snapshot lido no
    // início do ataque. Sem isso, dois ataques simultâneos no mesmo alvo
    // perdiam dano (last-write-wins).
    //
    // Regras preservadas, agora no SQL:
    //   • dano (delta < 0) consome primeiro os PV temporários; só o excedente
    //     chega aos PV atuais; cura (delta > 0) não mexe nos temporários;
    //   • PV atuais nunca ficam abaixo de 0 nem acima de hpMax.
    const affected = await db.$executeRaw`
      UPDATE "characters"
      SET "hpTemp" = GREATEST(0, "hpTemp" - GREATEST(0, -${delta})),
          "hpCurrent" = GREATEST(
            0,
            LEAST(
              GREATEST(FLOOR(("hpMax" + ${hpBonus}) * CASE WHEN COALESCE(("mechanicalState"->>'exhaustionLevel')::int, 0) >= 4 THEN 0.5 ELSE 1 END), 0),
              "hpCurrent" + ${delta} + LEAST("hpTemp", GREATEST(0, -${delta}))
            )
          ),
          "version" = "version" + 1
      WHERE "id" = ${character.id}
    `;

    // A origem foi deletada no meio do combate.
    if (affected === 0) return null;

    // Relê o estado REALMENTE gravado para montar o DTO e publicar — nunca o
    // valor calculado em memória.
    const stored = await db.character.findUniqueOrThrow({ where: { id: character.id } });

    if (publications) publications.add(stored.id);
    else await publishCharacter(stored.id);

    return { hpCurrent: stored.hpCurrent, hpMax: effectiveMaxHp(stored.hpMax + hpBonus, stored.mechanicalState) };
  }

  if (combatant.kind === 'CREATURE') {
    // A vida é do próprio combatente (snapshot): várias cópias iguais rastreiam
    // o dano independentemente e o bestiário não é alterado pelo combate.
    // O teto vem do snapshot carregado (não muda durante o combate); o valor
    // novo é calculado a partir do que está gravado, na mesma escrita atômica.
    const hpMax = combatant.hpMax ?? combatant.creature?.hpMax ?? 0;
    const ceiling = effectiveMaxHp(hpMax, combatant.mechanicalState);

    const affected = await db.$executeRaw`
      UPDATE "combatants"
      SET "hpCurrent" = GREATEST(0, LEAST(${ceiling}, COALESCE("hpCurrent", 0) + ${delta}))
      WHERE "id" = ${combatant.id}
    `;

    if (affected === 0) return null;

    const stored = await db.combatant.findUniqueOrThrow({ where: { id: combatant.id } });
    return { hpCurrent: stored.hpCurrent ?? 0, hpMax: ceiling };
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

/**
 * Tipos de dano FÍSICOS — é neles que entram os bônus corpo a corpo (Fúria) e
 * os dados extras do Crítico Brutal. Uma parcela de outro tipo (fogo, necrótico
 * ...) nunca recebe esses bônus.
 */
const PHYSICAL_DAMAGE_TYPES = new Set(['Cortante', 'Perfurante', 'Concussão']);

/** Coage um JSONB de defesa de criatura para lista de tipos (strings). */
function damageTypeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Listas de defesa do alvo contra dano, por tipo canônico.
 *
 * Personagem: resistências de CLASSE (Fúria, ...) e de RAÇA (`raceResistances`,
 * preenchido no passo 3 do assistente: Draconato, Anão, Tiefling...).
 * Criatura: `resistances` / `immunities` / `vulnerabilities` do bestiário.
 */
function damageDefensesOf(target: CombatantSourced): {
  resistances: Set<string>;
  immunities: Set<string>;
  vulnerabilities: Set<string>;
  allResistance?: boolean;
} {
  if (target.kind === 'CHARACTER' && target.character) {
    const adjustments = characterAdjustments(target.character);
    const effects = deriveConditionEffects(combatantMechanicalState(target));
    return {
      resistances: new Set([
        ...adjustments.resistances,
        ...(target.character.raceResistances ?? []),
      ]),
      allResistance: effects.allDamageResistance,
      immunities: new Set(effects.poisonImmune ? ['Veneno'] : []),
      vulnerabilities: new Set(),
    };
  }

  const creature = target.creature;
  const effects = deriveConditionEffects(combatantMechanicalState(target));
  return {
    allResistance: effects.allDamageResistance,
    resistances: new Set(damageTypeList(creature?.resistances)),
    immunities: new Set([...damageTypeList(creature?.immunities), ...(effects.poisonImmune ? ['Veneno'] : [])]),
    vulnerabilities: new Set(damageTypeList(creature?.vulnerabilities)),
  };
}

/**
 * Aplica a defesa do alvo a UMA parcela de dano, por tipo.
 *
 * Imunidade zera a parcela; vulnerabilidade dobra; resistência reduz pela
 * metade (arredondando para baixo); sem defesa, a parcela passa inteira. Dano
 * SEM tipo (`null`) nunca aciona defesa.
 */
function applyDamageDefense(
  damageType: string | null,
  total: number,
  defenses: { resistances: Set<string>; immunities: Set<string>; vulnerabilities: Set<string>; allResistance?: boolean },
): { applied: number; modifier: DamageComponentPayload['modifier'] } {
  if (damageType && defenses.immunities.has(damageType)) return { applied: 0, modifier: 'immunity' };
  const resistance = defenses.allResistance || Boolean(damageType && defenses.resistances.has(damageType));
  const vulnerability = Boolean(damageType && defenses.vulnerabilities.has(damageType));
  // PHB 2014: resistência primeiro (arredonda para baixo), depois vulnerabilidade.
  const resisted = resistance ? Math.floor(total / 2) : total;
  return { applied: vulnerability ? resisted * 2 : resisted, modifier: resistance && vulnerability ? 'resistance-vulnerability' : resistance ? 'resistance' : vulnerability ? 'vulnerability' : null };
}

/**
 * Contexto tático da rolagem de ataque, usado para decidir o Ataque Furtivo.
 *
 * `advantage` é um dado da própria rolagem; `adjacentAlly` é a confirmação
 * manual do jogador, porque o sistema não rastreia posição/adjacência (Fase 10
 * — grid/VTT); `usedThisTurn` implementa a trava "uma vez por turno".
 */
interface SneakAttackOptions {
  advantage: boolean;
  disadvantage: boolean;
  adjacentAlly: boolean;
  usedThisTurn: boolean;
}

/**
 * Calcula o dano extra de Ataque Furtivo, quando as condições do PHB 2014 são
 * atendidas:
 *  • o atacante tem a feature de Ataque Furtivo;
 *  • a arma é sutil ou à distância;
 *  • o ataque teve vantagem OU o jogador confirmou um aliado adjacente ao alvo;
 *  • o ataque NÃO teve desvantagem (desvantagem impede, mesmo com aliado);
 *  • o Ataque Furtivo ainda não foi usado neste turno.
 */
function rollSneakAttack(
  attacker: CombatantSourced,
  attack: { finesse: boolean; ranged: boolean },
  critical: boolean,
  options: SneakAttackOptions,
): { expression: string; total: number; rolls: number[]; sides: number; reason: string } | null {
  if (attacker.kind !== 'CHARACTER') return null;
  const character = attacker.character;
  if (!character) return null;
  if (!attack.finesse && !attack.ranged) return null;

  // Uma vez por turno: já usado, não repete neste turno.
  if (options.usedThisTurn) return null;
  // Desvantagem no ataque impede o Ataque Furtivo (mesmo com aliado adjacente).
  if (options.disadvantage) return null;
  // Exige vantagem no ataque OU um aliado adjacente ao alvo confirmado.
  if (!options.advantage && !options.adjacentAlly) return null;

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

  // Origem da condição, para o log do mestre poder auditar.
  const reasons: string[] = [];
  if (options.advantage) reasons.push('vantagem');
  if (options.adjacentAlly) reasons.push('aliado adjacente');
  const reason = reasons.join(' + ');

  return { expression, total: roll.total, rolls: roll.rolls, sides: roll.sides, reason };
}

/** Bônus que a munição consumida soma ao ATAQUE e ao DANO desta rolagem. */
interface AmmoBonus {
  attackBonus: number;
  damageBonus: number;
}

/** Publica a ficha (inventário) para o dono e os mestres — `sheet:updated`. */
export async function publishCharacter(characterId: string): Promise<void> {
  const updated = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true } } },
  });
  if (!updated) return;

  const payload = {
    userId: updated.userId,
    username: updated.user.username,
    characterId: updated.id,
    version: updated.version,
    changes: { inventory: updated.inventory, hpCurrent: updated.hpCurrent, hpTemp: updated.hpTemp },
    character: await toSheetDto(updated, updated.user.username),
    at: new Date().toISOString(),
  };

  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(updated.userId, ServerEvents.SHEET_UPDATED, payload);
  } catch (error) {
    console.error('[combat] falha ao publicar a ficha em tempo real:', error);
  }
}

/**
 * Gasta 1 unidade de munição do tipo pedido e devolve os bônus que ela concede.
 *
 * Seguro contra duas requisições simultâneas: a gravação só acontece se o
 * `version` da ficha não mudou desde a leitura (mesmo cuidado do Level Up); se
 * mudou, relê e tenta de novo. Devolve `null` quando não há pilha compatível.
 */
async function consumeAmmo(
  characterId: string,
  ammoType: AmmoType,
  preferredInventoryId: string | undefined,
  db: Prisma.TransactionClient,
  publications: Set<string>,
): Promise<AmmoBonus | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await db.character.findUnique({
      where: { id: characterId },
      select: { inventory: true, version: true },
    });
    if (!current) return null;

    const inventory = parseJson<InventoryLike[]>(
      inventoryListSchema,
      current.inventory,
      [],
    );
    // As pilhas RESERVADAS para recursos de acampamento não podem ser gastas:
    // só entram na escolha as que ainda têm quantidade disponível. A leitura é
    // refeita a cada tentativa (o `version` muda se uma reserva concorrente
    // entrar), então duas requisições nunca consomem a mesma unidade reservada.
    // Com a mecânica desligada, `reservedQuantities` devolve zero: munição de
    // contribuições antigas volta a ser gastável normalmente.
    const stacks = ammoStacks(inventory, ammoType);
    const reserved = await reservedQuantities(stacks.map((item) => item.id));
    const usable = stacks.filter(
      (item) => availableQuantity(item.quantity, reserved.get(item.id) ?? 0) >= 1,
    );
    const stack = chooseAmmoStack(usable, preferredInventoryId);
    if (!stack) return null;

    const bonus: AmmoBonus = {
      attackBonus: stack.details.attackBonus ?? 0,
      damageBonus: stack.details.damageBonus ?? 0,
    };

    // Pilha que chega a 0 sai do inventário.
    const remaining = stack.quantity - 1;
    const nextInventory =
      remaining > 0
        ? inventory.map((item) =>
            item.id === stack.id ? { ...item, quantity: remaining } : item,
          )
        : inventory.filter((item) => item.id !== stack.id);

    const result = await db.character.updateMany({
      where: { id: characterId, version: current.version },
      data: {
        inventory: nextInventory as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    if (result.count === 1) {
      publications.add(characterId);
      return bonus;
    }
  }

  return null;
}

/**
 * Resolve um ataque: rola 1d20 + bônus contra a CA do alvo; se acertar, rola
 * CADA parcela de dano do ataque (o principal + os extras, dobrados no crítico),
 * aplica a defesa do alvo por tipo e debita o total no HP.
 */
export async function resolveAttack(
  actor: CombatActor,
  input: AttackInput,
): Promise<{ combat: CombatDto; result: AttackResolvedPayload }> {
  const publications = new Set<string>();
  const rolls: DiceRolledPayload[] = [];
  const response = await runCombatOperation(actor, input, 'attack', async (db, combat) => {
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

    // Ataque derivado de arma que não pode ser empunhada agora (ex.: duas mãos
    // com a outra mão ocupada): recusa com o motivo, em vez de rolar.
    if (attack.blocked) {
      throw new HttpError(attack.blocked, 400);
    }

    const effects = deriveConditionEffects(combatantMechanicalState(attacker));
    if (!effects.canAct) throw new HttpError('Condição impede realizar ataques ou Reações.', 409, 'CONFLICT');
    const targetIdentities = [`combatant:${target.id}`, ...(target.characterId ? [`character:${target.characterId}`] : []), ...(target.creature?.kind === 'NPC' && combat.combatants.filter(item => item.creatureId === target.creatureId).length === 1 ? [`creature:${target.creatureId}`] : [])];
    if (effects.charmers.some(source => targetIdentities.includes(`${source.kind}:${source.id}`))) throw new HttpError('Enfeitiçado: você não pode atacar quem o enfeitiçou.', 409, 'CONFLICT');
    const economy = economyOf(attacker.turnEconomy);
    if (input.prepared) {
      if (!economy.ready) throw new HttpError('Nenhuma ação preparada.', 409, 'CONFLICT');
      if (input.attackActionId || attack.id.startsWith('offhand:')) throw new HttpError('Ataque preparado não é continuação nem mão secundária.', 400);
      spendEconomy(economy, 'reaction');
      economy.ready = null;
      await appendEconomyLog(db, combat, attacker, 'Executou ataque preparado usando Reação; gatilho confirmado manualmente.', 'prepared-attack');
    } else {
      requireOwnTurn(combat, attacker);
      if (attack.id.startsWith('offhand:')) {
        if (input.attackActionId) throw new HttpError('Mão secundária não integra o contador da Attack Action.', 400);
        validateOffhand(attacker, attack.inventoryItemId, economy.lightWeaponsAttacked);
        spendEconomy(economy, 'bonus-action');
      } else {
        const limit = attacker.character ? deriveAttackActionLimit(normalizeClassEntries(attacker.character.classes)) : 1;
        recordAttack(economy, limit, randomUUID(), input.attackActionId);
        if (attack.inventoryItemId && isLightEquippedWeapon(attacker, attack.inventoryItemId)) {
          economy.lightWeaponsAttacked = [...new Set([...economy.lightWeaponsAttacked, attack.inventoryItemId])];
        }
      }
    }
    await db.combatant.update({ where: { id: attacker.id }, data: { turnEconomy: economy } });

    // Munição: só para PERSONAGENS e só quando o ataque aponta para uma arma do
    // inventário. A arma precisa estar EQUIPADA numa das mãos; se ela exigir
    // munição (propriedade `ammunition`), 1 unidade é gasta ANTES de rolar —
    // sem munição, nada é rolado (409). Criaturas nunca consomem.
    let ammoBonus: AmmoBonus = { attackBonus: 0, damageBonus: 0 };
    if (attacker.kind === 'CHARACTER' && attacker.character && attack.inventoryItemId) {
      const inventory = parseJson<InventoryLike[]>(
        inventoryListSchema,
        attacker.character.inventory,
        [],
      );
      const weapon = inventory.find((item) => item.id === attack.inventoryItemId);
      if (!isWeaponEquipped(weapon)) {
        throw new HttpError('Equipe a arma deste ataque para usá-lo.', 409);
      }
      const ammoType = requiredAmmoType(weapon);
      if (ammoType) {
        const consumed = await consumeAmmo(attacker.character.id, ammoType, input.ammoInventoryId, db, publications);
        if (!consumed) throw new HttpError('Sem munição para esta arma.', 409);
        ammoBonus = consumed;
      }
    }

    // Personagem não tem CA gravada: ela é calculada da ficha (atributos +
    // equipamento + override do mestre), igual à que aparece no tabuleiro.
    const targetArmorClass =
      target.character !== null
        ? characterArmorClass(target.character).value
        : (target.armorClass ?? target.creature?.armorClass ?? 10);

    // Vantagem e desvantagem são mutuamente exclusivas (se vierem as duas, nenhuma
    // vale) — mesmo critério da janela de dados.
    const { advantage, disadvantage } = conditionAttackMode(combatantMechanicalState(attacker), combatantMechanicalState(target), Boolean(input.advantage), Boolean(input.disadvantage));
    // Com vantagem/desvantagem o d20 rola duas vezes e o mantido é o maior/menor.
    const firstRoll = rollD20();
    const secondRoll = advantage || disadvantage ? rollD20() : null;
    const attackRoll =
      secondRoll === null
        ? firstRoll
        : advantage
          ? Math.max(firstRoll, secondRoll)
          : Math.min(firstRoll, secondRoll);
    const attackDice = secondRoll === null ? [attackRoll] : [firstRoll, secondRoll];
    // A munição usada soma o próprio bônus de acerto à rolagem.
    const attackTotal = attackRoll + attack.attackBonus + ammoBonus.attackBonus;
    // Limiar de crítico: 20 por padrão, 19/18 com o Crítico Aprimorado/Superior
    // do Campeão (o MENOR limiar prevalece entre as classes). Criaturas não têm
    // features: ficam no 20 natural.
    const critThreshold =
      attacker.character !== null ? characterCritThreshold(attacker.character) : 20;
    const critical = attackRoll >= critThreshold;
    // Crítico sempre acerta; 1 natural sempre erra.
    const hit = critical || (attackRoll !== 1 && attackTotal >= targetArmorClass);

    rolls.push({
      kind: 'attack',
      actorName: attacker.name,
      expression: advantage ? '1d20 (vantagem)' : disadvantage ? '1d20 (desvantagem)' : '1d20',
      rolls: attackDice,
      sides: 20,
      modifier: attack.attackBonus + ammoBonus.attackBonus,
      total: attackTotal,
      crit: critical,
      at: new Date().toISOString(),
    });

    let damageRolled = 0;
    let sneakAttackResult: { expression: string; total: number; reason: string } | null = null;
    // Cada parcela do ataque (principal + `extraDamages`), com o que foi rolado e
    // o efeito da defesa do alvo — é o que explica o dano final ao mestre.
    const components: DamageComponentPayload[] = [];

    if (hit) {
      const attackerAdjustments =
        attacker.kind === 'CHARACTER' && attacker.character
          ? characterAdjustments(attacker.character)
          : null;

      // Bônus de dano corpo a corpo (Fúria): só na parcela FÍSICA — não bonifica
      // (nem reduz) uma parcela de outro tipo, como o fogo de uma arma flamejante.
      const meleeBonus =
        !attack.ranged && attackerAdjustments && attackerAdjustments.meleeDamageBonus > 0
          ? attackerAdjustments.meleeDamageBonus
          : 0;

      // Ataque Furtivo: só entra com as condições táticas do PHB (vantagem no
      // ataque OU aliado adjacente confirmado), sem desvantagem e uma vez por
      // turno. É dano físico, então vai na 1ª parcela física.
      const sneak = rollSneakAttack(attacker, attack, critical, {
        advantage,
        disadvantage,
        adjacentAlly: Boolean(input.adjacentAlly),
        usedThisTurn: attacker.sneakAttackUsedThisTurn,
      });
      const sneakRoll = sneak && sneak.total > 0 ? sneak : null;

      const defenses = damageDefensesOf(target);
      const specs = attackDamages(attack);
      let total = 0;
      // A Fúria entra UMA vez, na primeira parcela FÍSICA. O Ataque Furtivo
      // acompanha o dano da ARMA, então entra UMA vez na primeira parcela — sem
      // depender do tipo (amarrá-lo à parcela física o descartava em armas sem
      // tipo de dano).
      let physicalBonusApplied = false;
      let sneakApplied = false;
      // Atributo que alimenta o dano: ataques derivados da arma sabem qual é
      // (FOR/DES); os gravados à mão não, então a parcela sai como "Bônus".
      const abilityLabel = attack.ability ? ABILITY_LABELS[attack.ability] : null;
      const abilityModifier = attack.abilityModifier ?? 0;

      for (let index = 0; index < specs.length; index += 1) {
        const spec = specs[index];
        // Parcela vazia (sem dados e sem bônus) não entra no log nem no dano.
        if (damageIsEmpty(spec)) continue;

        // A expressão textual é derivada só para a rolagem (o crítico dobra os
        // DADOS da parcela e o modificador entra uma vez).
        const damage = rollDice(damageExpression(spec), { crit: critical });
        if (!damage) continue;

        let componentTotal = damage.total;

        // Quebra legível da parcela: cada dado/bônus vira uma parte. É o que o
        // registro exibe como `1d8(4)+1d6(2)+DES(+3)=9`.
        // A parcela principal é o golpe/arma; as seguintes são danos extras de
        // outro tipo (ex.: fogo). O rótulo é montado aqui, não no frontend.
        const isPrimary = index === 0;
        const breakdownParts: DamagePartPayload[] = [];
        if (spec.count > 0 && spec.sides > 0) {
          breakdownParts.push({
            source: isPrimary ? 'weapon' : 'extra',
            label: isPrimary ? 'Arma' : 'Dano extra',
            // O número de dados reflete o crítico (o dado dobrado sai como 2d8).
            dice: `${damage.rolls.length}d${spec.sides}`,
            rolls: damage.rolls,
            value: damage.total - spec.bonus,
          });
        }

        const isPhysical = spec.type !== null && PHYSICAL_DAMAGE_TYPES.has(spec.type);

        // Crítico Brutal: dados de arma extras no crítico (só corpo a corpo),
        // somados à parcela FÍSICA.
        if (
          isPhysical &&
          critical &&
          attackerAdjustments &&
          attackerAdjustments.critExtraDice > 0 &&
          spec.count > 0 &&
          spec.sides > 0
        ) {
          const extra = rollDice(
            `${spec.count * attackerAdjustments.critExtraDice}d${spec.sides}`,
            { crit: false },
          );
          if (extra && extra.total > 0) {
            componentTotal += extra.total;
            breakdownParts.push({
              source: 'critical',
              label: 'Crítico Brutal',
              dice: extra.expression,
              rolls: extra.rolls,
              value: extra.total,
            });
          }
        }

        // Fúria: bônus FÍSICO, UMA vez, na primeira parcela física.
        if (isPhysical && !physicalBonusApplied) {
          if (meleeBonus > 0) {
            componentTotal += meleeBonus;
            breakdownParts.push({ source: 'rage', label: 'Fúria', dice: '', rolls: [], value: meleeBonus });
          }
          physicalBonusApplied = true;
        }

        // Ataque Furtivo: acompanha o dano da ARMA. Entra UMA vez, na primeira
        // parcela — inclusive quando ela não tem tipo de dano.
        if (sneakRoll && !sneakApplied) {
          componentTotal += sneakRoll.total;
          sneakAttackResult = {
            expression: sneakRoll.expression,
            total: sneakRoll.total,
            reason: sneakRoll.reason,
          };
          breakdownParts.push({
            source: 'sneakAttack',
            label: 'Ataque Furtivo',
            // No crítico os dados dobram: sai como 4d6, com os 4 resultados.
            dice: `${sneakRoll.rolls.length}d${sneakRoll.sides}`,
            rolls: sneakRoll.rolls,
            value: sneakRoll.total,
          });
          sneakApplied = true;
        }

        // Atributo + o resto do bônus fixo (mágico etc.): só na parcela PRINCIPAL
        // o ataque sabe qual atributo o alimenta.
        if (index === 0 && abilityLabel && abilityModifier !== 0) {
          breakdownParts.push({
            source: 'attribute',
            label: abilityLabel,
            dice: '',
            rolls: [],
            value: abilityModifier,
          });
        }
        const flatBonus = spec.bonus - (index === 0 && abilityLabel ? abilityModifier : 0);
        if (flatBonus !== 0) {
          // Na parcela principal de um ataque derivado da arma, o bônus fixo é o
          // bônus estruturado da arma (mágico). Nos demais, é um bônus genérico.
          const weaponBonus = index === 0 && abilityLabel !== null;
          breakdownParts.push({
            source: weaponBonus ? 'weaponBonus' : 'flat',
            label: weaponBonus ? 'Bônus da arma' : 'Bônus',
            dice: '',
            rolls: [],
            value: flatBonus,
          });
        }

        // Bônus de dano da munição: entra UMA vez, na parcela PRINCIPAL.
        if (index === 0 && ammoBonus.damageBonus !== 0) {
          componentTotal += ammoBonus.damageBonus;
          breakdownParts.push({
            source: 'ammo',
            label: 'Munição',
            dice: '',
            rolls: [],
            value: ammoBonus.damageBonus,
          });
        }

        const breakdown: DamageBreakdownPayload = { parts: breakdownParts, total: componentTotal };

        // Log da PARCELA, já com os bônus dela (por tipo), para o mestre ver cada
        // tipo separadamente — agora com a quebra parte a parte.
        rolls.push({
          kind: 'damage',
          actorName: spec.type ? `${attacker.name} — ${spec.type}` : attacker.name,
          expression: damage.expression,
          rolls: damage.rolls,
          sides: damage.sides,
          modifier: componentTotal - damage.total,
          total: componentTotal,
          crit: critical,
          at: new Date().toISOString(),
          breakdown,
        });

        // Defesa do alvo POR TIPO e POR PARCELA: imunidade zera, vulnerabilidade
        // dobra, resistência halva. Cada parcela é resolvida independentemente.
        const { applied, modifier } = applyDamageDefense(spec.type, componentTotal, defenses);
        components.push({
          type: spec.type ?? '',
          expression: damage.expression,
          rolled: componentTotal,
          applied,
          modifier,
          breakdown,
        });
        total += applied;
      }

      // Aviso quando alguma defesa mexeu no dano — sem ele o total não bate com a
      // soma crua das rolagens e o mestre não entende o porquê.
      const defended = components.filter((component) => component.modifier !== null);
      if (defended.length > 0) {
        const parts = defended.map((component) => {
          const label = component.type || 'sem tipo';
          if (component.modifier === 'immunity') return `${label} imune (0)`;
          if (component.modifier === 'resistance-vulnerability') return `${label} resistência seguida de vulnerabilidade (${component.applied})`;
        if (component.modifier === 'vulnerability') {
            return `${label} vulnerável (${component.rolled}×2=${component.applied})`;
          }
          return `${label} resistido (${component.rolled}→${component.applied})`;
        });
        rolls.push({
          kind: 'damage',
          actorName: `${attacker.name} — Defesas de ${target.name}`,
          expression: parts.join(' · '),
          rolls: [],
          sides: 0,
          modifier: 0,
          total,
          crit: false,
          at: new Date().toISOString(),
        });
      }

      // Trava "uma vez por turno": só marca quando o Ataque Furtivo realmente
      // entrou neste ataque.
      if (sneakRoll) {
        await db.combatant.update({
          where: { id: attacker.id },
          data: { sneakAttackUsedThisTurn: true },
        });
      }

      damageRolled = total;
      // Nada a debitar (tudo imune, por exemplo) — não escreve no HP à toa.
      if (total > 0) await changeHp(target, -total, db, publications);
    }

    const dto = toCombatDto(await loadCombatById(combat.id, db), 'MASTER');

    const targetAfter = dto.combatants.find((item) => item.id === target.id);

    const result: AttackResolvedPayload = {
      attackerName: attacker.name,
      attackName: attack.name,
      targetName: target.name,
      attackRoll,
      attackRolls: attackDice,
      advantage,
      disadvantage,
      attackBonus: attack.attackBonus + ammoBonus.attackBonus,
      attackTotal,
      targetArmorClass,
      hit,
      critical,
      damageRolled,
      damageType: attack.damage.type ?? '',
      components,
      sneakAttack: sneakAttackResult,
      targetHpCurrent: targetAfter?.hpCurrent ?? 0,
      targetHpMax: targetAfter?.hpMax ?? 0,
      targetStatsHidden: false,
      at: new Date().toISOString(),
    };

    return { combat: actor.role === 'MASTER' ? dto : hideCreatureStats(dto), result };
  });
  if (!response.replayed) {
    for (const id of publications) await publishCharacter(id);
    for (const roll of rolls) announceRoll(roll);
    const result = response.result;
    const targetIsCreature = response.combat.combatants.find((item) => item.id === input.targetCombatantId)?.kind === 'CREATURE';
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.ATTACK_RESOLVED, result);
    broadcaster.toPlayers(ServerEvents.ATTACK_RESOLVED, targetIsCreature ? hideTargetStats(result) : result);
  }
  return { ...response, result: actor.role !== 'MASTER' && response.result.targetStatsHidden === false && response.combat.combatants.find((item) => item.id === input.targetCombatantId)?.kind === 'CREATURE' ? hideTargetStats(response.result) : response.result };
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
  const publications = new Set<string>();
  const applied = await prisma.$transaction(async (db) => {
    const active = await db.combat.updateMany({ where: { id: combat.id, status: { in: ACTIVE_STATUSES } }, data: { version: { increment: 1 } } });
    if (!active.count) throw new HttpError('Combate encerrado.', 409, 'CONFLICT');
    return changeHp(combatant, delta, db, publications);
  });
  for (const id of publications) await publishCharacter(id);

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
    data: { status: 'ENDED', endedAt: new Date(), version: { increment: 1 } },
  });

  emit(ServerEvents.COMBAT_ENDED, { combatId: combat.id });

  return { combatId: combat.id };
}
