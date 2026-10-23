import { createHash, randomUUID } from 'node:crypto';
import type { Character, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { ServerEvents, type SheetUpdatedPayload } from '../../realtime/events.js';
import { characterMaxHp, characterRacialAdjustments } from '../characters/characters.dto.js';
import { toSheetDto } from '../characters/characters.service.js';
import { hideCreatureStats, orderCombatants, toCombatDto, type CombatSourced } from '../combat/combat.dto.js';
import { mechanicalStateOf, type MechanicalEntity, type MechanicalState } from '../shared/conditions.js';
import {
  addHpZeroUnconscious,
  clearDeathLifecycle,
  damageBreakdown,
  deathBlocksActions,
  deathSaveOutcome,
  deathStateOf,
  hasDeathLifecycle,
  logDeath,
  pendingReasonLabel,
  removeHpZeroUnconscious,
  turnKey,
  type DeathPending,
  type DeathState,
} from '../shared/death.js';
import type {
  DeathMutationInput,
  DeathRelentlessInput,
  DeathResolveInput,
  DeathStabilizeInput,
} from './death.schema.js';

/**
 * Domínio do ciclo de MORTE (Fase 6.3).
 *
 * O sistema NUNCA declara morte sozinho: ele calcula o que o PHB 2014 indicaria
 * (morte instantânea, três falhas, Exaustão 6, 0 PV de NPC) e cria uma DECISÃO
 * PENDENTE do Mestre. `dead` só é gravado pela decisão explícita dele.
 *
 * Todas as escritas são server-authoritative, com `operationId` (idempotência),
 * `expectedVersion` (concorrência) e guard transacional (`updateMany` por
 * versão). O Teste contra a Morte é rolado no SERVIDOR e a trava "uma rolagem
 * por turno" (`saveTurnKey`) impede que um duplo clique gere dois resultados.
 */

/** Autor da operação — sempre carimbado do token pela rota. */
export interface DeathActor {
  userId: string;
  username: string;
  role: 'MASTER' | 'PLAYER';
}

/** Recarga do recurso racial da Resistência Implacável (Meio-Orc). */
const RELENTLESS_RESOURCE_ID = 'relentless-endurance';

interface DeathCombat {
  id: string;
  version: number;
  status: string;
  round: number;
  currentIndex: number;
  currentCombatantId: string | null;
  combatantId: string | null;
  inOwnTurn: boolean;
  key: string | null;
}

interface DeathTarget {
  entity: MechanicalEntity;
  kind: 'character' | 'creature';
  name: string;
  ownerUserId: string | null;
  version: number;
  death: DeathState;
  mechanical: MechanicalState;
  hpCurrent: number;
  hpMax: number;
  /** Linha completa do personagem (para escrever `racialState`/`name`). */
  character: Character | null;
  /** Recurso racial disponível para a Resistência Implacável (Meio-Orc). */
  relentless: { resourceId: string; name: string } | null;
  combat: DeathCombat | null;
}

/** Campos que uma operação de morte pode gravar. */
interface TargetPatch {
  death?: DeathState;
  mechanical?: MechanicalState;
  hpCurrent?: number;
  racialState?: Prisma.InputJsonValue;
}

interface DeathLogEntry {
  id: string;
  actorName: string;
  message: string;
  at: string;
}

/** DTO do ciclo de morte (uma entidade, visão de quem tem permissão). */
export interface DeathDto {
  entity: MechanicalEntity;
  kind: 'character' | 'creature';
  name: string;
  ownerUserId: string | null;
  hpCurrent: number;
  hpMax: number;
  version: number;
  death: DeathState;
  log: DeathLogEntry[];
  pending: DeathPending | null;
  pendingLabel: string | null;
  deathSave: {
    available: boolean;
    reason: string;
    mode: boolean;
    turnKey: string | null;
  };
  relentless: { available: boolean; name: string; resourceId: string } | null;
  combat: { id: string; version: number; status: string; inOwnTurn: boolean } | null;
  at: string;
}

/* -------------------------------------------------------------------------- */
/* Carregamento                                                                */
/* -------------------------------------------------------------------------- */

/** Combate completo (mesmas relações do combate em `combat.service`). */
function findCombatFull(id: string, db: Prisma.TransactionClient = prisma) {
  return db.combat.findUnique({
    where: { id },
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

/** Combatente ATIVO (não encerrado) de um personagem. */
function findCharacterCombatant(characterId: string, db: Prisma.TransactionClient = prisma) {
  return db.combatant.findFirst({
    where: { characterId, combat: { status: { in: ['PENDING_INITIATIVE', 'ACTIVE'] } } },
    include: { combat: true },
  });
}

/**
 * Resolve o estado de combate relevante para o ciclo de morte: a instância, o
 * turno corrente e se é o turno dela. `key` é a chave do turno usada pela trava
 * "uma rolagem por turno".
 */
async function combatContext(
  combat: CombatSourced | null,
  combatantId: string | null,
): Promise<DeathCombat | null> {
  if (!combat || combat.status === 'ENDED') return null;
  // MESMA ordenação do DTO/turno (`orderCombatants`): o índice do turno só faz
  // sentido sobre a ordem de iniciativa, nunca sobre a ordem crua da relação.
  const ordered = orderCombatants(combat.combatants);
  const inOwnTurn =
    combat.status === 'ACTIVE' &&
    combatantId !== null &&
    ordered[combat.currentIndex]?.id === combatantId;
  return {
    id: combat.id,
    version: combat.version,
    status: combat.status,
    round: combat.round,
    currentIndex: combat.currentIndex,
    currentCombatantId: ordered[combat.currentIndex]?.id ?? null,
    combatantId,
    inOwnTurn,
    key: inOwnTurn ? turnKey(combat.id, combat.round, combat.currentIndex) : null,
  };
}

/**
 * Carrega o alvo do ciclo de morte. `combatant` com `characterId` DELEGA para o
 * personagem: o estado canônico de um personagem vive na ficha (mesma regra do
 * motor de condições 6.2).
 */
async function loadTarget(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient = prisma,
): Promise<DeathTarget> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({
      where: { id: entity.id },
      include: { user: { select: { username: true } } },
    });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    const participant = await findCharacterCombatant(row.id, db);
    const combat = participant ? await findCombatFull(participant.combatId, db) : null;
    const racial = characterRacialAdjustments(row).resources.find(
      (resource) => resource.id === RELENTLESS_RESOURCE_ID,
    );
    return {
      entity,
      kind: 'character',
      name: row.name,
      ownerUserId: row.userId,
      version: row.version,
      death: deathStateOf(row.deathState),
      mechanical: mechanicalStateOf(row.mechanicalState),
      hpCurrent: row.hpCurrent,
      hpMax: characterMaxHp(row),
      character: row,
      relentless: racial && racial.remaining > 0 ? { resourceId: racial.id, name: racial.name } : null,
      combat: await combatContext(combat, participant?.id ?? null),
    };
  }

  if (entity.kind === 'creature') {
    // DECISÃO DE PROJETO (Fase 6.3): o ciclo de morte de uma criatura/NPC vive
    // na INSTÂNCIA de combate, nunca no template compartilhado do bestiário.
    // Duas cópias do mesmo Goblin têm ciclos independentes; o template não tem
    // (nem guarda) Testes contra a Morte.
    throw new HttpError(
      'O ciclo de morte de uma criatura vive na instância de combate dela, nunca no cadastro do bestiário.',
      400,
      'VALIDATION_ERROR',
    );
  }

  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    include: { creature: true, combat: true },
  });
  if (!row) throw new HttpError('Instância de combate não encontrada.', 404);
  if (row.characterId) return loadTarget({ kind: 'character', id: row.characterId }, db);
  const combat = await findCombatFull(row.combatId, db);
  return {
    entity,
    kind: 'creature',
    name: row.name,
    ownerUserId: row.ownerUserId,
    version: row.mechanicalVersion,
    death: deathStateOf(row.deathState),
    mechanical: mechanicalStateOf(row.mechanicalState),
    hpCurrent: row.hpCurrent ?? row.creature?.hpCurrent ?? 0,
    hpMax: row.hpMax ?? row.creature?.hpMax ?? 0,
    character: null,
    relentless: null,
    combat: await combatContext(combat, row.id),
  };
}

/** Entidade CANÔNICA: um combatente de personagem resolve para o personagem. */
async function canonicalEntity(entity: MechanicalEntity): Promise<MechanicalEntity> {
  if (entity.kind !== 'combatant') return entity;
  const row = await prisma.combatant.findUnique({
    where: { id: entity.id },
    select: { characterId: true },
  });
  return row?.characterId ? { kind: 'character', id: row.characterId } : entity;
}

/** Escreve o patch com guard de versão. `false` = perdeu a corrida. */
async function writeTarget(
  db: Prisma.TransactionClient,
  target: DeathTarget,
  patch: TargetPatch,
): Promise<boolean> {
  const data: Record<string, unknown> = {};
  if (patch.death) data.deathState = patch.death as unknown as Prisma.InputJsonValue;
  if (patch.mechanical) data.mechanicalState = patch.mechanical as unknown as Prisma.InputJsonValue;
  if (patch.hpCurrent !== undefined) data.hpCurrent = Math.max(0, patch.hpCurrent);
  if (patch.racialState) data.racialState = patch.racialState;
  if (Object.keys(data).length === 0) return true;

  if (target.kind === 'character') {
    const changed = await db.character.updateMany({
      where: { id: target.entity.id, version: target.version },
      data: { ...data, version: { increment: 1 } },
    });
    return changed.count === 1;
  }
  const changed = await db.combatant.updateMany({
    where: { id: target.entity.id, mechanicalVersion: target.version },
    data: { ...data, mechanicalVersion: { increment: 1 } },
  });
  return changed.count === 1;
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Elegibilidade do Teste contra a Morte (PHB 2014): no INÍCIO do próprio turno,
 * com 0 PV, vivo, não estabilizado, sem decisão pendente e sem oferta da
 * Resistência Implacável aguardando resposta. Ninguém rola automaticamente.
 */
export function deathSaveEligibility(
  target: DeathTarget,
  actor: DeathActor,
): { available: boolean; reason: string } {
  const death = target.death;
  if (death.dead) return { available: false, reason: 'O personagem está morto.' };
  if (target.hpCurrent > 0) return { available: false, reason: 'O personagem não está a 0 PV.' };
  if (death.pending) {
    return { available: false, reason: 'Aguardando a resolução do Mestre.' };
  }
  if (death.relentless) {
    return { available: false, reason: 'Resistência Implacável aguardando resposta.' };
  }
  if (death.stabilized) return { available: false, reason: 'O personagem está estabilizado.' };
  if (!death.deathSaves) {
    return { available: false, reason: 'Esta criatura não está no fluxo de Testes contra a Morte.' };
  }
  if (!target.combat || target.combat.status !== 'ACTIVE') {
    return { available: false, reason: 'O Teste contra a Morte acontece no início do próprio turno, em combate.' };
  }
  if (!target.combat.inOwnTurn) {
    return { available: false, reason: 'Aguarde o turno desta criatura.' };
  }
  if (death.saveTurnKey && death.saveTurnKey === target.combat.key) {
    return { available: false, reason: 'O Teste contra a Morte deste turno já foi rolado.' };
  }
  if (actor.role !== 'MASTER' && target.ownerUserId !== actor.userId) {
    return { available: false, reason: 'Apenas o dono do personagem rola o próprio Teste contra a Morte.' };
  }
  return { available: true, reason: '' };
}

function toDeathDto(target: DeathTarget, actor?: DeathActor): DeathDto {
  const eligibility = deathSaveEligibility(target, actor ?? { userId: '', username: '', role: 'MASTER' });
  return {
    entity: target.entity,
    kind: target.kind,
    name: target.name,
    ownerUserId: target.ownerUserId,
    hpCurrent: target.hpCurrent,
    hpMax: target.hpMax,
    version: target.version,
    death: target.death,
    log: actor && actor.role !== 'MASTER' ? [] : target.death.log,
    pending: target.death.pending,
    pendingLabel: target.death.pending ? pendingReasonLabel(target.death.pending) : null,
    deathSave: {
      available: eligibility.available,
      reason: eligibility.reason,
      mode: target.death.deathSaves,
      turnKey: target.combat?.key ?? null,
    },
    relentless: target.relentless
      ? { available: true, name: target.relentless.name, resourceId: target.relentless.resourceId }
      : null,
    combat: target.combat
      ? { id: target.combat.id, version: target.combat.version, status: target.combat.status, inOwnTurn: target.combat.inOwnTurn }
      : null,
    at: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Publicação                                                                  */
/* -------------------------------------------------------------------------- */

/** Publica a ficha (`sheet:updated`) para o dono e os mestres. */
async function publishSheet(characterId: string): Promise<void> {
  const updated = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true } } },
  });
  if (!updated) return;
  const payload: SheetUpdatedPayload = {
    userId: updated.userId,
    username: updated.user.username,
    characterId: updated.id,
    version: updated.version,
    changes: { deathState: updated.deathState, hpCurrent: updated.hpCurrent },
    character: await toSheetDto(updated, updated.user.username),
    at: new Date().toISOString(),
  };
  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(updated.userId, ServerEvents.SHEET_UPDATED, payload);
  } catch (error) {
    console.error('[death] falha ao publicar a ficha em tempo real:', error);
  }
}

/** Publica o combate com as duas visões (jogadores não veem nada de criaturas). */
async function publishCombat(combatId: string): Promise<void> {
  const combat = await findCombatFull(combatId, prisma);
  if (!combat) return;
  try {
    const broadcaster = getBroadcaster();
    const master = toCombatDto(combat, 'MASTER');
    broadcaster.toMasters(ServerEvents.COMBAT_UPDATED, { combat: master });
    broadcaster.toPlayers(ServerEvents.COMBAT_UPDATED, { combat: hideCreatureStats(master) });
  } catch (error) {
    console.error('[death] falha ao publicar o combate em tempo real:', error);
  }
}

/**
 * Publica o ciclo de morte. Personagens vão para o dono e para os mestres;
 * criaturas/NPCs vão SÓ para a sala dos mestres — a privacidade é do SERVIDOR
 * (nada é enviado aos jogadores), nunca escondida por CSS no cliente.
 */
export async function publishDeath(dto: DeathDto): Promise<void> {
  try {
    const broadcaster = getBroadcaster();
    if (dto.kind === 'character' && dto.ownerUserId) {
      broadcaster.toUser(dto.ownerUserId, ServerEvents.DEATH_UPDATED, { death: dto });
    }
    broadcaster.toMasters(ServerEvents.DEATH_UPDATED, { death: dto });
  } catch (error) {
    // Como no resto do projeto, uma falha de tempo real nunca derruba a
    // operação que já foi persistida (o smoke e os scripts rodam sem `io`).
    console.error('[death] falha ao publicar o ciclo de morte em tempo real:', error);
  }
}

/* -------------------------------------------------------------------------- */
/* Regras de dano e cura (chamadas dentro da transação do combate)             */
/* -------------------------------------------------------------------------- */

/** Evento de dano já aplicado no PV (o chamador conhece o antes e o dano). */
export interface DamageEvent {
  damage: number;
  hpBefore: number;
  hpTempBefore: number;
  critical: boolean;
  /** Quem causou (nome), só para o log. */
  sourceName?: string;
}

/** Resultado de um evento de dano/cura para o ciclo de morte. */
export interface DeathEventResult {
  changed: boolean;
  pending: DeathPending | null;
  relentlessOffer: boolean;
  dead: boolean;
  log: string | null;
}

function createPending(
  target: DeathTarget,
  actorName: string,
  kind: DeathPending['kind'],
  reason: string,
  cause: DeathPending['cause'] = null,
): DeathPending {
  const pending: DeathPending = {
    id: randomUUID(),
    kind,
    reason,
    createdAt: new Date().toISOString(),
    cause,
  };
  target.death.pending = pending;
  logDeath(target.death, actorName, `${target.name}: ${reason}. Aguardando a resolução do Mestre.`);
  return pending;
}

/**
 * Consequências do DANO (PHB 2014, p. 197), na ordem do projeto:
 *  1. morte instantânea (dano restante >= PV máximo) → decisão do Mestre;
 *  2. criatura/NPC fora do fluxo de Death Saves → decisão do Mestre (nunca morre
 *     sozinha);
 *  3. queda a 0 PV sem morte instantânea → Resistência Implacável (se houver) ou
 *     início do fluxo de Testes contra a Morte + Inconsciência;
 *  4. dano sofrido JÁ a 0 PV → +1 falha (+2 no crítico); três falhas → decisão.
 */
export async function applyDamageConsequences(
  entity: MechanicalEntity,
  event: DamageEvent,
  db: Prisma.TransactionClient,
  actorName = 'Sistema',
): Promise<DeathEventResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const target = await loadTarget(entity, db);
    const death = target.death;
    if (death.dead || death.pending) {
      return { changed: false, pending: death.pending, relentlessOffer: false, dead: death.dead, log: null };
    }
    const absorbed = Math.min(target.hpCurrent === 0 ? event.hpTempBefore : event.hpTempBefore, Math.max(0, event.damage));
    const toHp = Math.max(0, event.damage - absorbed);
    const breakdown = damageBreakdown({ hpBefore: event.hpBefore, toHp, maxHp: target.hpMax });
    if (breakdown.hpAfter > 0) {
      return { changed: false, pending: null, relentlessOffer: false, dead: false, log: null };
    }

    const mechanical = target.mechanical;
    const patch: TargetPatch = { death, mechanical, hpCurrent: 0 };
    const cause = { damage: event.damage, remaining: breakdown.remaining, hpMax: breakdown.maxHp };

    // (2) Criatura/NPC fora do fluxo: QUALQUER dano que a leve a 0 PV abre a
    // decisão do Mestre — nada de "monstro morre automaticamente".
    if (target.kind === 'creature' && !death.deathSaves) {
      if (event.hpBefore > 0) {
        const pending = createPending(
          target,
          actorName,
          'npc-zero',
          breakdown.instantDeath
            ? `0 PV com morte instantânea pelas regras (dano restante ${breakdown.remaining} ≥ PV máximo ${breakdown.maxHp})`
            : 'Chegou a 0 PV',
          cause,
        );
        if (await writeTarget(db, target, patch)) {
          return { changed: true, pending, relentlessOffer: false, dead: false, log: pending.reason };
        }
        continue;
      }
      // Dano já a 0 PV sem fluxo de Death Saves: registra, sem nova decisão.
      logDeath(death, actorName, `${target.name} sofreu ${event.damage} de dano já a 0 PV.`);
      if (await writeTarget(db, target, patch)) {
        return { changed: true, pending: null, relentlessOffer: false, dead: false, log: 'dano a 0 PV' };
      }
      continue;
    }

    // (1) Morte instantânea: as regras indicam morte — o Mestre decide.
    if (breakdown.instantDeath) {
      const pending = createPending(
        target,
        actorName,
        'instant-death',
        `Morte instantânea: dano restante ${breakdown.remaining} ≥ PV máximo ${breakdown.maxHp}`,
        cause,
      );
      if (await writeTarget(db, target, patch)) {
        return { changed: true, pending, relentlessOffer: false, dead: false, log: pending.reason };
      }
      continue;
    }

    // (3) Queda normal a 0 PV.
    if (event.hpBefore > 0) {
      const unconscious = addHpZeroUnconscious(mechanical);
      patch.mechanical = unconscious.state;
      if (target.kind === 'character' && target.relentless) {
        // PHB 2014: a Resistência Implacável só vale quando a criatura SERIA
        // reduzida a 0 PV sem morrer instantaneamente. A escolha é do jogador.
        death.relentless = {
          id: randomUUID(),
          resourceId: target.relentless.resourceId,
          createdAt: new Date().toISOString(),
        };
        logDeath(death, actorName, `${target.name} cairia a 0 PV: Resistência Implacável disponível (aguardando resposta ${target.ownerUserId ? 'do jogador' : 'do Mestre'}).`);
        if (await writeTarget(db, target, patch)) {
          return { changed: true, pending: null, relentlessOffer: true, dead: false, log: 'Resistência Implacável oferecida' };
        }
        continue;
      }
      death.deathSaves = true;
      logDeath(death, actorName, `${target.name} caiu a 0 PV: início dos Testes contra a Morte (Inconsciente).`);
      if (await writeTarget(db, target, patch)) {
        return { changed: true, pending: null, relentlessOffer: false, dead: false, log: '0 PV: Testes contra a Morte' };
      }
      continue;
    }

    // (4) Dano sofrido já a 0 PV: +1 falha (+2 no crítico). Estabilizado deixa
    // de estar estabilizado e volta ao fluxo.
    const unconscious = addHpZeroUnconscious(mechanical);
    patch.mechanical = unconscious.state;
    death.stabilized = false;
    death.deathSaves = true;
    death.failures = Math.min(3, death.failures + (event.critical ? 2 : 1));
    logDeath(death, actorName, `${target.name} sofreu ${event.damage} de dano a 0 PV: +${event.critical ? 2 : 1} falha(s) (${death.failures}/3).`);
    let pending: DeathPending | null = null;
    if (death.failures >= 3) {
      pending = createPending(target, actorName, 'failures', 'Três falhas em Testes contra a Morte', cause);
    }
    if (await writeTarget(db, target, patch)) {
      return { changed: true, pending, relentlessOffer: false, dead: false, log: 'falhas acumuladas' };
    }
  }
  throw new HttpError('Não foi possível registrar o dano no ciclo de morte.', 409, 'CONFLICT');
}

/**
 * Consequências da CURA: HP acima de 0 limpa successes/failures, a
 * estabilização, a pendência e a Inconsciência causada por 0 PV — mas NUNCA
 * remove condições independentes nem ressuscita (morte é decisão do Mestre).
 */
export async function applyHealConsequences(
  entity: MechanicalEntity,
  hpAfter: number,
  db: Prisma.TransactionClient,
  actorName = 'Sistema',
): Promise<DeathEventResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const target = await loadTarget(entity, db);
    if (target.death.dead) {
      throw new HttpError('O personagem está morto: o Mestre precisa reverter a morte explicitamente.', 409, 'CONFLICT');
    }
    if (target.death.pending) {
      throw new HttpError('Há uma decisão de morte pendente: o Mestre precisa resolvê-la antes de qualquer cura.', 409, 'CONFLICT');
    }
    if (hpAfter <= 0) return { changed: false, pending: null, relentlessOffer: false, dead: false, log: null };
    if (!hasDeathLifecycle(target.death)) {
      const cleaned = removeHpZeroUnconscious(target.mechanical);
      if (!cleaned.removed) return { changed: false, pending: null, relentlessOffer: false, dead: false, log: null };
      if (await writeTarget(db, target, { mechanical: cleaned.state })) {
        return { changed: true, pending: null, relentlessOffer: false, dead: false, log: null };
      }
      continue;
    }
    const mechanical = removeHpZeroUnconscious(target.mechanical).state;
    clearDeathLifecycle(target.death);
    logDeath(target.death, actorName, `${target.name} voltou a ter PV (${hpAfter}): o ciclo de morte foi encerrado.`);
    if (await writeTarget(db, target, { death: target.death, mechanical })) {
      return { changed: true, pending: null, relentlessOffer: false, dead: false, log: null };
    }
  }
  throw new HttpError('Não foi possível limpar o ciclo de morte após a cura.', 409, 'CONFLICT');
}

/**
 * Exaustão nível 6 indica morte (PHB 2014): abre a MESMA decisão do Mestre,
 * sem zerar PV e sem marcar morte. Chamado pelo domínio mecânico, na mesma
 * transação da mudança de Exaustão.
 */
export async function registerFatalExhaustion(
  entity: MechanicalEntity,
  actorName: string,
  db: Prisma.TransactionClient,
): Promise<void> {
  const target = await loadTarget(entity, db);
  if (target.death.dead || target.death.pending) return;
  const pending = createPending(
    target,
    actorName,
    'exhaustion',
    'Exaustão nível 6: as regras indicam morte',
  );
  if (!(await writeTarget(db, target, { death: target.death }))) {
    throw new HttpError('Não foi possível registrar a Exaustão fatal.', 409, 'CONFLICT');
  }
  void pending;
}

/** Início do turno: libera o Teste contra a Morte daquele turno. */
export async function onTurnStartDeath(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient,
): Promise<void> {
  const target = await loadTarget(entity, db);
  if (!target.death.saveTurnKey) return;
  target.death.saveTurnKey = null;
  await writeTarget(db, target, { death: target.death });
}

/* -------------------------------------------------------------------------- */
/* Teste contra a Morte (server-authoritative)                                 */
/* -------------------------------------------------------------------------- */

export interface DeathSaveResult {
  entity: MechanicalEntity;
  name: string;
  /** Rola PRIVADO (só o Mestre) quando o alvo é uma criatura/NPC. */
  audience: 'table' | 'masters';
  value: number;
  successes: number;
  failures: number;
  stabilized: boolean;
  dead: boolean;
  revived: boolean;
  pending: DeathPending | null;
  naturalOne: boolean;
  naturalTwenty: boolean;
}

/**
 * Aplica UM Teste contra a Morte com o valor já rolado pelo SERVIDOR.
 *
 * A trava "uma rolagem por turno" (`saveTurnKey`, resolvida DENTRO da
 * transação) é o que impede que um duplo clique produza dois resultados: o
 * segundo pedido encontra a chave do turno gravada e recebe 409. Retry NUNCA
 * soma duas falhas/sucessos.
 */
export async function applyDeathSave(
  actor: DeathActor,
  entity: MechanicalEntity,
  value: number,
): Promise<DeathSaveResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const target = await loadTarget(entity);
    const eligibility = deathSaveEligibility(target, actor);
    if (!eligibility.available) {
      throw new HttpError(eligibility.reason || 'Teste contra a Morte indisponível.', 409, 'CONFLICT');
    }
    const currentKey = target.combat?.key ?? null;
    if (target.death.saveTurnKey && target.death.saveTurnKey === currentKey) {
      throw new HttpError('O Teste contra a Morte deste turno já foi rolado.', 409, 'CONFLICT');
    }
    const outcome = deathSaveOutcome(value);
    const death = target.death;
    const patch: TargetPatch = { death, hpCurrent: target.hpCurrent };
    let revived = false;
    let stabilized = false;

    if (outcome.revived) {
      revived = true;
      clearDeathLifecycle(death);
      patch.mechanical = removeHpZeroUnconscious(target.mechanical).state;
      patch.hpCurrent = 1;
      logDeath(death, actor.username, `${target.name} tirou 20 natural no Teste contra a Morte: volta com 1 PV.`);
    } else {
      death.successes = Math.min(3, death.successes + outcome.successes);
      death.failures = Math.min(3, death.failures + outcome.failures);
      if (death.failures >= 3) {
        createPending(target, actor.username, 'failures', 'Três falhas em Testes contra a Morte');
      } else if (death.successes >= 3) {
        death.stabilized = true;
        death.deathSaves = false;
        stabilized = true;
        logDeath(death, actor.username, `${target.name} alcançou 3 sucessos: ESTABILIZADO a 0 PV (segue Inconsciente).`);
      } else {
        logDeath(
          death,
          actor.username,
          `${target.name} rolou ${value} no Teste contra a Morte: +${outcome.failures || outcome.successes} ${outcome.failures ? 'falha(s)' : 'sucesso(s)'} (${death.successes}/3 sucessos, ${death.failures}/3 falhas).`,
        );
      }
    }
    death.saveTurnKey = currentKey;
    // Guard de versão: se outra escrita venceu a corrida, relê e reavalia — a
    // chave do turno já gravada devolve 409 (nunca dois resultados).
    if (!(await writeTarget(prisma, target, patch))) continue;

    const response: DeathSaveResult = {
      entity: target.entity,
      name: target.name,
      audience: target.kind === 'character' ? 'table' : 'masters',
      value,
      successes: death.successes,
      failures: death.failures,
      stabilized: death.stabilized,
      dead: death.dead,
      revived,
      pending: death.pending,
      naturalOne: outcome.naturalOne,
      naturalTwenty: outcome.naturalTwenty,
    };
    const fresh = await loadTarget(target.entity);
    await publishTarget(toDeathDto(fresh, actor));
    return response;
  }
  throw new HttpError('Não foi possível rolar o Teste contra a Morte.', 409, 'CONFLICT');
}

/* -------------------------------------------------------------------------- */
/* Operações com idempotência (decisão do Mestre, override, estabilizar)        */
/* -------------------------------------------------------------------------- */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002';
}

async function runDeathOperation(
  actor: DeathActor,
  input: { entity: MechanicalEntity; operationId: string; expectedVersion: number },
  type: string,
  apply: (db: Prisma.TransactionClient, target: DeathTarget) => Promise<TargetPatch | null>,
): Promise<{ death: DeathDto; replayed: boolean }> {
  const canonical = await canonicalEntity(input.entity);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ type, actor: actor.userId, input }))
    .digest('hex');
  const where = {
    entityKind_entityId_operationId: {
      entityKind: canonical.kind,
      entityId: canonical.id,
      operationId: input.operationId,
    },
  };
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) {
      throw new HttpError('operationId reutilizado com outro payload/autor.', 409, 'IDEMPOTENCY_KEY_REUSED');
    }
    return { death: operation.snapshot as DeathDto, replayed: true };
  };
  const existing = await prisma.deathOperation.findUnique({ where });
  if (existing) return replay(existing);

  let result: { death: DeathDto; replayed: boolean };
  try {
    result = await prisma.$transaction(async (db) => {
      const previous = await db.deathOperation.findUnique({ where });
      if (previous) return replay(previous);
      const target = await loadTarget(input.entity, db);
      if (target.version !== input.expectedVersion) {
        throw new HttpError('O ciclo de morte mudou. Atualize e tente novamente.', 409, 'CONFLICT');
      }
      const patch = await apply(db, target);
      if (patch && !(await writeTarget(db, target, patch))) {
        throw new HttpError('O ciclo de morte mudou. Atualize e tente novamente.', 409, 'CONFLICT');
      }
      const fresh = await loadTarget(input.entity, db);
      const response = toDeathDto(fresh, actor);
      await db.deathOperation.create({
        data: {
          entityKind: canonical.kind,
          entityId: canonical.id,
          operationId: input.operationId,
          fingerprint,
          snapshot: response as unknown as Prisma.InputJsonValue,
        },
      });
      return { death: response, replayed: false };
    }, { timeout: 15000 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.deathOperation.findUnique({ where });
      if (raced) return replay(raced);
    }
    throw error;
  }
  if (!result.replayed) await publishTarget(result.death);
  return result;
}

/** Publica tudo que depende do ciclo de morte (ficha, combate e o evento). */
async function publishTarget(dto: DeathDto): Promise<void> {
  await publishDeath(dto);
  if (dto.kind === 'character') await publishSheet(dto.entity.id);
  if (dto.combat) await publishCombat(dto.combat.id);
}

/**
 * Publica SÓ o evento do ciclo de morte (`death:updated`) de uma entidade,
 * DEPOIS do commit.
 *
 * O caminho de COMBATE (ataque e ajuste manual de PV) já publica
 * `combat:updated`/`sheet:updated` por conta própria — mas o contador e o
 * modal de resolução do Mestre dependem deste evento. Sem ele, o backend fica
 * correto no banco e o runtime não mostra a decisão pendente sem refresh.
 */
export async function publishDeathUpdated(entity: MechanicalEntity): Promise<void> {
  try {
    const target = await loadTarget(entity);
    await publishDeath(toDeathDto(target));
  } catch (error) {
    console.error('[death] falha ao publicar o ciclo de morte após o dano:', error);
  }
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                     */
/* -------------------------------------------------------------------------- */

export async function getDeathState(
  actor: DeathActor,
  entity: MechanicalEntity,
): Promise<DeathDto> {
  const target = await loadTarget(entity);
  if (actor.role !== 'MASTER' && target.ownerUserId !== actor.userId) {
    throw new HttpError('Apenas o Mestre ou o dono pode consultar o ciclo de morte.', 403);
  }
  return toDeathDto(target, actor);
}

/**
 * Entidades com DECISÃO DE MORTE PENDENTE — leitura exclusiva do Mestre.
 *
 * Existe para o RECONNECT: `death:updated` é um evento (não sobrevive a um
 * refresh), então ao abrir/recarregar o painel o Mestre recupera daqui as
 * decisões em aberto e o modal pode abrir sem esperar um novo evento.
 */
export async function listPendingDeaths(actor: DeathActor): Promise<DeathDto[]> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre acompanha as decisões de morte.', 403);
  }
  const [characters, combatants] = await Promise.all([
    prisma.character.findMany({ select: { id: true, deathState: true } }),
    prisma.combatant.findMany({
      where: { characterId: null, combat: { status: { in: ['PENDING_INITIATIVE', 'ACTIVE'] } } },
      select: { id: true, deathState: true },
    }),
  ]);
  const entities: MechanicalEntity[] = [
    ...characters
      .filter((row) => deathStateOf(row.deathState).pending !== null)
      .map((row) => ({ kind: 'character' as const, id: row.id })),
    ...combatants
      .filter((row) => deathStateOf(row.deathState).pending !== null)
      .map((row) => ({ kind: 'combatant' as const, id: row.id })),
  ];
  const entries: DeathDto[] = [];
  for (const entity of entities) {
    try {
      entries.push(toDeathDto(await loadTarget(entity), actor));
    } catch {
      // Entidade removida no meio do caminho: só ela fica de fora.
    }
  }
  return entries;
}

/** DTO de leitura usado pela bandeja de dados (autoridade da rolagem). */
export async function deathSaveAvailability(
  actor: DeathActor,
  entity: MechanicalEntity,
): Promise<{ available: boolean; reason: string; audience: 'table' | 'masters'; name: string }> {
  const target = await loadTarget(entity);
  const eligibility = deathSaveEligibility(target, actor);
  return {
    available: eligibility.available,
    reason: eligibility.reason,
    audience: target.kind === 'character' ? 'table' : 'masters',
    name: target.name,
  };
}

/* -------------------------------------------------------------------------- */
/* Decisão do Mestre sobre a pendência                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a decisão pendente. O Mestre escolhe:
 * • `confirm-death` — as regras indicavam morte e ele CONFIRMA;
 * • `narrative-1hp` — recurso narrativo: mantém o personagem vivo com 1 PV;
 * • `fall-to-zero` — ignora a morte e permite o fluxo normal de 0 PV;
 * • `roll-death-saves` — (só criaturas/NPCs) entra no fluxo privado de Testes.
 */
export async function resolveDeathPending(
  actor: DeathActor,
  input: DeathResolveInput,
): Promise<{ death: DeathDto; replayed: boolean }> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre decide o desfecho da morte.', 403);
  }
  return runDeathOperation(actor, input, `resolve:${input.decision}`, async (_db, target) => {
    const death = target.death;
    if (!death.pending) {
      throw new HttpError('Não há decisão de morte pendente.', 409, 'CONFLICT');
    }
    const pending = death.pending;
    const mechanical = target.mechanical;
    if (input.decision === 'roll-death-saves') {
      if (target.kind !== 'creature') {
        throw new HttpError('Personagens entram no fluxo de Testes contra a Morte ao cair a 0 PV.', 400, 'VALIDATION_ERROR');
      }
      death.pending = null;
      death.deathSaves = true;
      death.stabilized = false;
      logDeath(death, actor.username, `Mestre ${actor.username} determinou Testes contra a Morte PRIVADOS para ${target.name}.`);
      return { death, mechanical: addHpZeroUnconscious(mechanical).state, hpCurrent: 0 };
    }
    if (input.decision === 'confirm-death') {
      death.dead = true;
      death.stabilized = false;
      death.pending = null;
      death.relentless = null;
      death.deathSaves = false;
      death.saveTurnKey = null;
      logDeath(death, actor.username, `Mestre ${actor.username} confirmou a morte de ${target.name} (${pending.reason}).`);
      return { death, hpCurrent: 0 };
    }
    if (input.decision === 'narrative-1hp') {
      clearDeathLifecycle(death);
      logDeath(death, actor.username, `Mestre ${actor.username} usou um recurso narrativo: ${target.name} permanece com 1 PV.`);
      return { death, mechanical: removeHpZeroUnconscious(mechanical).state, hpCurrent: 1 };
    }
    // fall-to-zero: vivo a 0 PV, contadores zerados.
    //
    // DECISÃO DE PROJETO (seções 16 e 28 do pedido): um PERSONAGEM reinicia o
    // ciclo de Testes contra a Morte; uma CRIATURA/NPC apenas permanece a 0 PV
    // (Inconsciente quando aplicável) — os Testes privados de NPC só começam
    // quando o Mestre escolhe explicitamente "Rodar Death Saves".
    const wasInDeathSaves = death.deathSaves;
    clearDeathLifecycle(death);
    death.deathSaves = target.kind === 'character' || wasInDeathSaves;
    logDeath(
      death,
      actor.username,
      death.deathSaves
        ? `Mestre ${actor.username} permitiu que ${target.name} permanecesse a 0 PV (novo ciclo de Testes contra a Morte).`
        : `Mestre ${actor.username} permitiu que ${target.name} permanecesse a 0 PV, sem Testes contra a Morte.`,
    );
    return { death, mechanical: addHpZeroUnconscious(mechanical).state, hpCurrent: 0 };
  });
}

/* -------------------------------------------------------------------------- */
/* Override administrativo do Mestre e estabilização                           */
/* -------------------------------------------------------------------------- */

/** Override explícito do Mestre — tudo logado, nada de bypass invisível. */
export async function overrideDeath(
  actor: DeathActor,
  input: DeathMutationInput,
): Promise<{ death: DeathDto; replayed: boolean }> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre administra o ciclo de morte.', 403);
  }
  return runDeathOperation(actor, input, `override:${input.action}`, async (_db, target) => {
    const death = target.death;
    const mechanical = target.mechanical;
    const action = input.action;
    if (action === 'add-success') {
      death.successes = Math.min(3, death.successes + 1);
      logDeath(death, actor.username, `Mestre ${actor.username} adicionou 1 sucesso a ${target.name} (${death.successes}/3)${input.reason ? `: ${input.reason}` : ''}.`);
    } else if (action === 'remove-success') {
      death.successes = Math.max(0, death.successes - 1);
      logDeath(death, actor.username, `Mestre ${actor.username} removeu 1 sucesso de ${target.name} (${death.successes}/3)${input.reason ? `: ${input.reason}` : ''}.`);
    } else if (action === 'add-failure') {
      death.failures = Math.min(3, death.failures + 1);
      logDeath(death, actor.username, `Mestre ${actor.username} adicionou 1 falha a ${target.name} (${death.failures}/3)${input.reason ? `: ${input.reason}` : ''}.`);
    } else if (action === 'remove-failure') {
      death.failures = Math.max(0, death.failures - 1);
      logDeath(death, actor.username, `Mestre ${actor.username} removeu 1 falha de ${target.name} (${death.failures}/3)${input.reason ? `: ${input.reason}` : ''}.`);
    } else if (action === 'stabilize') {
      if (death.dead) throw new HttpError('Um personagem morto não pode ser estabilizado.', 409, 'CONFLICT');
      death.stabilized = true;
      death.deathSaves = false;
      death.pending = null;
      death.relentless = null;
      logDeath(death, actor.username, `Mestre ${actor.username} estabilizou ${target.name}${input.reason ? `: ${input.reason}` : ''}.`);
      return { death, mechanical: addHpZeroUnconscious(mechanical).state, hpCurrent: 0 };
    } else if (action === 'unstabilize') {
      death.stabilized = false;
      death.deathSaves = true;
      logDeath(death, actor.username, `Mestre ${actor.username} removeu a estabilização de ${target.name}.`);
    } else if (action === 'confirm-death') {
      death.dead = true;
      death.stabilized = false;
      death.pending = null;
      death.relentless = null;
      death.deathSaves = false;
      logDeath(death, actor.username, `Mestre ${actor.username} confirmou a morte de ${target.name}${input.reason ? `: ${input.reason}` : ''}.`);
      return { death, hpCurrent: 0 };
    } else if (action === 'narrative-1hp') {
      clearDeathLifecycle(death);
      logDeath(death, actor.username, `Mestre ${actor.username} manteve ${target.name} vivo com 1 PV (recurso narrativo).`);
      return { death, mechanical: removeHpZeroUnconscious(mechanical).state, hpCurrent: 1 };
    } else if (action === 'keep-at-zero') {
      death.dead = false;
      death.pending = null;
      death.relentless = null;
      logDeath(death, actor.username, `Mestre ${actor.username} manteve ${target.name} a 0 PV${input.reason ? `: ${input.reason}` : ''}.`);
      return { death, mechanical: addHpZeroUnconscious(mechanical).state, hpCurrent: 0 };
    } else if (action === 'death-saves') {
      death.deathSaves = true;
      death.dead = false;
      death.pending = null;
      logDeath(death, actor.username, `Mestre ${actor.username} colocou ${target.name} no fluxo de Testes contra a Morte.`);
      return { death, mechanical: addHpZeroUnconscious(mechanical).state, hpCurrent: 0 };
    } else if (action === 'revive') {
      clearDeathLifecycle(death);
      death.dead = false;
      logDeath(death, actor.username, `Mestre ${actor.username} reviveu ${target.name} administrativamente (1 PV)${input.reason ? `: ${input.reason}` : ''}.`);
      return { death, mechanical: removeHpZeroUnconscious(mechanical).state, hpCurrent: 1 };
    } else {
      throw new HttpError('Ação de morte desconhecida.', 400, 'VALIDATION_ERROR');
    }
    return { death };
  });
}

/**
 * API genérica de ESTABILIZAÇÃO (PHB 2014): 0 PV, sem Testes contra a Morte,
 * Inconsciente e vivo. Serve ao Mestre hoje e a Medicine/Spare the Dying e
 * outras características no futuro (Spell Execution chega na 6.6).
 */
export async function stabilizeTarget(
  actor: DeathActor,
  input: DeathStabilizeInput,
): Promise<{ death: DeathDto; replayed: boolean }> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre estabiliza nesta fase (Medicine assistida).', 403);
  }
  return runDeathOperation(actor, input, 'stabilize', async (_db, target) => {
    const death = target.death;
    if (death.dead) throw new HttpError('Um personagem morto não pode ser estabilizado.', 409, 'CONFLICT');
    if (death.pending) {
      throw new HttpError('Há uma decisão de morte pendente: resolva-a antes de estabilizar.', 409, 'CONFLICT');
    }
    if (target.hpCurrent > 0) throw new HttpError('Estabilizar exige 0 PV.', 409, 'CONFLICT');
    if (death.stabilized) throw new HttpError('A criatura já está estabilizada.', 409, 'CONFLICT');
    death.stabilized = true;
    death.deathSaves = false;
    death.relentless = null;
    logDeath(death, actor.username, `${target.name} foi ESTABILIZADO a 0 PV${input.reason ? ` — ${input.reason}` : ''}.`);
    return {
      death,
      mechanical: addHpZeroUnconscious(target.mechanical).state,
      hpCurrent: 0,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Resistência Implacável (Meio-Orc)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resposta do jogador à oferta da Resistência Implacável.
 *
 * "Usar" consome o recurso racial (server-authoritative: o máximo nunca vem do
 * cliente), deixa o personagem com 1 PV e NÃO inicia Testes contra a Morte nem
 * a Inconsciência de 0 PV. "Não usar" segue o fluxo normal a 0 PV. A oferta
 * NUNCA existe quando o dano indicaria morte instantânea.
 */
export async function answerRelentless(
  actor: DeathActor,
  input: DeathRelentlessInput,
): Promise<{ death: DeathDto; replayed: boolean }> {
  return runDeathOperation(actor, input, `relentless:${input.answer}`, async (_db, target) => {
    const death = target.death;
    if (!death.relentless) {
      throw new HttpError('Não há oferta de Resistência Implacável pendente.', 409, 'CONFLICT');
    }
    if (actor.role !== 'MASTER' && target.ownerUserId !== actor.userId) {
      throw new HttpError('Apenas o dono do personagem responde à Resistência Implacável.', 403);
    }
    const offer = death.relentless;
    death.relentless = null;
    if (input.answer === 'use') {
      const character = target.character;
      if (!character) throw new HttpError('A Resistência Implacável pertence a um personagem.', 409, 'CONFLICT');
      const racial = characterRacialAdjustments(character).resources.find(
        (resource) => resource.id === offer.resourceId,
      );
      if (!racial || racial.remaining < 1) {
        throw new HttpError('A Resistência Implacável já foi usada; ela volta no descanso longo.', 409, 'INSUFFICIENT_RESOURCE');
      }
      const used = Math.min(racial.max, racial.used + 1);
      logDeath(death, actor.username, `${target.name} usou a Resistência Implacável: fica com 1 PV em vez de cair a 0 PV (recurso consumido).`);
      return {
        death,
        hpCurrent: 1,
        // Ficar com 1 PV desfaz a Inconsciência causada por 0 PV (ela entrou junto
        // com a oferta). Condições independentes permanecem intactas.
        mechanical: removeHpZeroUnconscious(target.mechanical).state,
        racialState: { used: { ...(character.racialState as { used?: Record<string, number> } | null)?.used, [racial.id]: used } } as Prisma.InputJsonValue,
      };
    }
    death.deathSaves = true;
    logDeath(death, actor.username, `${target.name} recusou a Resistência Implacável: cai a 0 PV e entra nos Testes contra a Morte.`);
    return { death, mechanical: addHpZeroUnconscious(target.mechanical).state, hpCurrent: 0 };
  });
}

/**
 * Helpers exportados para o combate: o estado de morte bloqueia Ação, Ação
 * Bônus, Reação e Movimento (integração com a economia da 6.1).
 */
export { deathBlocksActions };
