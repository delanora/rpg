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

/**
 * Avança o turno; ao passar do último, começa uma nova rodada.
 *
 * O mestre avança a qualquer momento. O JOGADOR só encerra o PRÓPRIO turno:
 * é preciso que o combatente atual seja dele (fora do turno, 403). Durante a
 * espera pela iniciativa não há turno corrente, então ninguém além do mestre
 * avança.
 */
export async function nextTurn(actor: CombatActor): Promise<CombatDto> {
  const combat = await requireActiveCombat();

  const ordered = orderCombatants(combat.combatants);

  if (actor.role !== 'MASTER') {
    // Sem turno montado (PENDING_INITIATIVE) não há combatente corrente: só o
    // mestre avançaria. Com o combate ativo, o jogador precisa ser o dono do
    // combatente atual para encerrar o turno.
    const current = combat.status === 'ACTIVE' ? ordered[combat.currentIndex] : undefined;
    if (!current || current.ownerUserId !== actor.userId) {
      throw new HttpError('Só o mestre ou o dono do turno atual pode encerrar o turno.', 403);
    }
  }

  if (combat.status !== 'ACTIVE') {
    throw new HttpError('A ordem de iniciativa ainda não foi montada.', 409);
  }

  let index = combat.currentIndex + 1;
  let round = combat.round;

  if (index >= ordered.length) {
    index = 0;
    round += 1;
  }

  const incoming = ordered[index];

  await prisma.$transaction([
    prisma.combat.update({
      where: { id: combat.id },
      data: { currentIndex: index, round },
    }),
    // O turno do combatente que vai agir começa agora: é aqui que a trava
    // "uma vez por turno" do Ataque Furtivo é zerada (único ponto de avanço
    // de turno do sistema).
    prisma.combatant.update({
      where: { id: incoming.id },
      data: { sneakAttackUsedThisTurn: false },
    }),
  ]);

  const dto = toCombatDto(await loadCombatById(combat.id), 'MASTER');
  emitCombat(ServerEvents.COMBAT_UPDATED, dto);
  emitTurn(dto);
  // O jogador nunca recebe a vida/CA das criaturas na resposta HTTP (a mesma
  // visão que ele já recebe em tempo real pelo `emitCombat`).
  return actor.role === 'MASTER' ? dto : hideCreatureStats(dto);
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
    const affected = await prisma.$executeRaw`
      UPDATE "characters"
      SET "hpTemp" = GREATEST(0, "hpTemp" - GREATEST(0, -${delta})),
          "hpCurrent" = GREATEST(
            0,
            LEAST(
              GREATEST("hpMax" + ${hpBonus}, 0),
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

    return { hpCurrent: stored.hpCurrent, hpMax: stored.hpMax + hpBonus };
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
} {
  if (target.kind === 'CHARACTER' && target.character) {
    const adjustments = characterAdjustments(target.character);
    return {
      resistances: new Set([
        ...adjustments.resistances,
        ...(target.character.raceResistances ?? []),
      ]),
      immunities: new Set(),
      vulnerabilities: new Set(),
    };
  }

  const creature = target.creature;
  return {
    resistances: new Set(damageTypeList(creature?.resistances)),
    immunities: new Set(damageTypeList(creature?.immunities)),
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
  defenses: { resistances: Set<string>; immunities: Set<string>; vulnerabilities: Set<string> },
): { applied: number; modifier: DamageComponentPayload['modifier'] } {
  if (!damageType) return { applied: total, modifier: null };
  if (defenses.immunities.has(damageType)) return { applied: 0, modifier: 'immunity' };
  if (defenses.vulnerabilities.has(damageType)) {
    return { applied: total * 2, modifier: 'vulnerability' };
  }
  if (defenses.resistances.has(damageType)) {
    return { applied: Math.floor(total / 2), modifier: 'resistance' };
  }
  return { applied: total, modifier: null };
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
    // As pilhas RESERVADAS para recursos de acampamento não podem ser gastas:
    // só entram na escolha as que ainda têm quantidade disponível. A leitura é
    // refeita a cada tentativa (o `version` muda se uma reserva concorrente
    // entrar), então duas requisições nunca consomem a mesma unidade reservada.
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
 * Resolve um ataque: rola 1d20 + bônus contra a CA do alvo; se acertar, rola
 * CADA parcela de dano do ataque (o principal + os extras, dobrados no crítico),
 * aplica a defesa do alvo por tipo e debita o total no HP.
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

  // Vantagem e desvantagem são mutuamente exclusivas (se vierem as duas, nenhuma
  // vale) — mesmo critério da janela de dados.
  const advantage = Boolean(input.advantage) && !input.disadvantage;
  const disadvantage = Boolean(input.disadvantage) && !input.advantage;
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

  announceRoll({
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
      announceRoll({
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
        if (component.modifier === 'vulnerability') {
          return `${label} vulnerável (${component.rolled}×2=${component.applied})`;
        }
        return `${label} resistido (${component.rolled}→${component.applied})`;
      });
      announceRoll({
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
      await prisma.combatant.update({
        where: { id: attacker.id },
        data: { sneakAttackUsedThisTurn: true },
      });
    }

    damageRolled = total;
    // Nada a debitar (tudo imune, por exemplo) — não escreve no HP à toa.
    if (total > 0) await changeHp(target, -total);
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
