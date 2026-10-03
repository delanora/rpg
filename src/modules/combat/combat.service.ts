import type { CombatStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { inventoryListSchema } from '../characters/characters.schema.js';
import {
  ServerEvents,
  type AttackResolvedPayload,
  type DiceRolledPayload,
} from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { characterArmorClass, characterCritThreshold } from '../characters/armor-class.js';
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
import {
  ammoStacks,
  chooseAmmoStack,
  isWeaponEquipped,
  requiredAmmoType,
  type InventoryLike,
} from '../shared/ammo.js';
import { damageExpression } from '../shared/attacks.js';
import { abilityModifier, type AbilityKey } from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import type { AmmoType } from '../shared/item-details.js';
import { rollD20, rollDice } from '../shared/dice.js';
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

    // A escrita é ATÔMICA no banco (`UPDATE ... SET hpCurrent = ...`): o valor
    // novo é calculado a partir do que está GRAVADO, não do snapshot lido no
    // início do ataque. Sem isso, dois ataques simultâneos no mesmo alvo
    // perdiam dano (last-write-wins).
    //
    // Regras preservadas, agora no SQL:
    //   • dano (delta < 0) consome primeiro os PV temporários; só o excedente
    //     chega aos PV atuais; cura (delta > 0) não mexe nos temporários;
    //   • PV atuais nunca ficam abaixo de 0 nem acima de hpMax.
    const affected = await prisma.$executeRaw`
      UPDATE "characters"
      SET "hpTemp" = GREATEST(0, "hpTemp" - GREATEST(0, -${delta})),
          "hpCurrent" = GREATEST(
            0,
            LEAST(
              GREATEST("hpMax", 0),
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
    const stored = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });

    // Reaproveita o canal da ficha: o jogador vê o próprio HP mudar na hora,
    // e o mestre vê no painel.
    const payload = {
      userId: stored.userId,
      username: character.user.username,
      characterId: stored.id,
      version: stored.version,
      changes: { hpCurrent: stored.hpCurrent, hpTemp: stored.hpTemp },
      character: await toSheetDto(stored, character.user.username),
      at: new Date().toISOString(),
    };

    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(stored.userId, ServerEvents.SHEET_UPDATED, payload);

    return { hpCurrent: stored.hpCurrent, hpMax: stored.hpMax };
  }

  if (combatant.kind === 'CREATURE') {
    // A vida é do próprio combatente (snapshot): várias cópias iguais rastreiam
    // o dano independentemente e o bestiário não é alterado pelo combate.
    // O teto vem do snapshot carregado (não muda durante o combate); o valor
    // novo é calculado a partir do que está gravado, na mesma escrita atômica.
    const hpMax = combatant.hpMax ?? combatant.creature?.hpMax ?? 0;
    const ceiling = Math.max(hpMax, 0);

    const affected = await prisma.$executeRaw`
      UPDATE "combatants"
      SET "hpCurrent" = GREATEST(0, LEAST(${ceiling}, COALESCE("hpCurrent", 0) + ${delta}))
      WHERE "id" = ${combatant.id}
    `;

    if (affected === 0) return null;

    const stored = await prisma.combatant.findUniqueOrThrow({ where: { id: combatant.id } });
    return { hpCurrent: stored.hpCurrent ?? 0, hpMax };
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
  damageType: string | null,
  total: number,
): number {
  if (target.kind !== 'CHARACTER' || !target.character || !damageType) return total;
  const adjustments = characterAdjustments(target.character);
  // A resistência vem da CLASSE (Fúria, ...) ou da RAÇA (`raceResistances`,
  // preenchido no passo 3 do assistente: Draconato, Anão, Tiefling...).
  const raceResistances = target.character.raceResistances ?? [];
  if (!adjustments.resistances.includes(damageType) && !raceResistances.includes(damageType)) {
    return total;
  }
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

/** Bônus que a munição consumida soma ao ATAQUE e ao DANO desta rolagem. */
interface AmmoBonus {
  attackBonus: number;
  damageBonus: number;
}

/** Publica a ficha (inventário) para o dono e os mestres — `sheet:updated`. */
async function publishInventory(characterId: string, inventory: unknown): Promise<void> {
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
    changes: { inventory },
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
  preferredInventoryId?: string,
): Promise<AmmoBonus | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await prisma.character.findUnique({
      where: { id: characterId },
      select: { inventory: true, version: true },
    });
    if (!current) return null;

    const inventory = parseJson<InventoryLike[]>(
      inventoryListSchema,
      current.inventory,
      [],
    );
    const stack = chooseAmmoStack(ammoStacks(inventory, ammoType), preferredInventoryId);
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

    const result = await prisma.character.updateMany({
      where: { id: characterId, version: current.version },
      data: {
        inventory: nextInventory as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    if (result.count === 1) {
      await publishInventory(characterId, nextInventory);
      return bonus;
    }
  }

  return null;
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

  // Ataque derivado de arma que não pode ser empunhada agora (ex.: duas mãos
  // com a outra mão ocupada): recusa com o motivo, em vez de rolar.
  if (attack.blocked) {
    throw new HttpError(attack.blocked, 400);
  }

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
      const consumed = await consumeAmmo(attacker.character.id, ammoType, input.ammoInventoryId);
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

  const attackRoll = rollD20();
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

  announceRoll({
    kind: 'attack',
    actorName: attacker.name,
    expression: '1d20',
    rolls: [attackRoll],
    sides: 20,
    modifier: attack.attackBonus + ammoBonus.attackBonus,
    total: attackTotal,
    crit: critical,
    at: new Date().toISOString(),
  });

  let damageRolled = 0;
  let sneakAttackResult: { expression: string; total: number } | null = null;

  if (hit) {
    // Dano estruturado do ataque: a expressão textual é derivada só para a
    // rolagem (o crítico dobra os DADOS e o modificador entra uma vez).
    const damage = rollDice(damageExpression(attack.damage), { crit: critical });

    if (damage) {
      const attackerAdjustments =
        attacker.kind === 'CHARACTER' && attacker.character
          ? characterAdjustments(attacker.character)
          : null;

      let total = damage.total;

      // Bônus de dano da munição usada (entra uma vez, como qualquer modificador).
      if (ammoBonus.damageBonus !== 0) total += ammoBonus.damageBonus;

      // Crítico Brutal: dados de arma extras no crítico (só corpo a corpo).
      if (critical && attackerAdjustments && attackerAdjustments.critExtraDice > 0) {
        const spec = attack.damage;
        if (spec.count > 0 && spec.sides > 0) {
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
      total = applyDamageResistance(target, attack.damage.type, total);
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
    attackBonus: attack.attackBonus + ammoBonus.attackBonus,
    attackTotal,
    targetArmorClass,
    hit,
    critical,
    damageRolled,
    damageType: attack.damage.type ?? '',
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
