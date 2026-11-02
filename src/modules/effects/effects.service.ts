import { createHash, randomUUID } from 'node:crypto';
import type { EffectInstance, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { ServerEvents } from '../../realtime/events.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { effectsVisibleTo, toEffectDto, type EffectDto } from './effects.dto.js';
import type { CreateEffectInput, EffectEndReason } from './effects.schema.js';

/**
 * FASE 6.5A — Generic Effect Engine (FUNDAÇÃO).
 *
 * Só lifecycle: criar, encerrar (individual/grupo) e LER por alvo/fonte.
 * Nada aqui aplica bônus, Conditions, dano, duração ou dispel — essas fases
 * (6.5B/C/D/E) consumirão esta API.
 *
 * Duas decisões de arquitetura:
 *
 * 1. **Tabela própria** (`effect_instances`), não JSON no `mechanicalState`:
 *    as consultas são por alvo, por fonte e por grupo, e o volume cresce com
 *    magias/auras. O `mechanicalState` continua dono de Conditions,
 *    Exaustão, Concentração e do log mecânico — Effect NÃO é Condition.
 *
 * 2. **Chave polimórfica canônica** (`kind + id`) igual ao resto do domínio.
 *    Um combatente que representa PERSONAGEM é sempre gravado/lido na FICHA
 *    (`character`): o combatente apenas projeta o mesmo estado, nunca uma
 *    segunda instância. Criatura/NPC em combate usa o id da INSTÂNCIA, então
 *    dois Goblins do mesmo template não compartilham efeitos.
 */

export interface EffectActor {
  userId: string;
  username: string;
  role: 'MASTER' | 'PLAYER';
}

/** Alvo resolvido (chave canônica + nome/owner lidos do servidor). */
interface ResolvedEntity {
  entity: MechanicalEntity;
  name: string;
  ownerUserId: string | null;
}

const ACTIVE_COMBAT_STATUSES = ['ACTIVE', 'PENDING_INITIATIVE'] as const;

/**
 * Resolve a chave e canonicaliza:
 *  • combatente de PERSONAGEM → `character` (fonte de verdade da ficha);
 *  • criatura/NPC → a própria INSTÂNCIA (nunca o template).
 *
 * Nomes e dono vêm do banco — o cliente só manda ids.
 */
async function resolveEntity(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ResolvedEntity> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id }, select: { name: true, userId: true } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return { entity, name: row.name, ownerUserId: row.userId };
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id }, select: { name: true } });
    if (!row) throw new HttpError('Criatura não encontrada.', 404);
    return { entity, name: row.name, ownerUserId: null };
  }
  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    select: { name: true, characterId: true, creatureId: true },
  });
  if (!row) throw new HttpError('Combatente não encontrado.', 404);
  // Personagem em combate: a ficha é a fonte de verdade.
  if (row.characterId) return resolveEntity({ kind: 'character', id: row.characterId }, db);
  return { entity, name: row.name, ownerUserId: null };
}

function isMaster(actor: EffectActor): boolean {
  return actor.role === 'MASTER';
}

export async function getEffectById(
  effectId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EffectInstance> {
  const row = await db.effectInstance.findUnique({ where: { id: effectId } });
  if (!row) throw new HttpError('Efeito não encontrado.', 404);
  return row;
}

/** Instâncias ATIVAS de um alvo — sem filtro de privacidade (uso interno). */
export async function activeEffectsFor(
  target: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EffectDto[]> {
  const resolved = await resolveEntity(target, db);
  const rows = await db.effectInstance.findMany({
    where: {
      targetEntityKind: resolved.entity.kind,
      targetEntityId: resolved.entity.id,
      status: 'active',
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toEffectDto);
}

/** Instâncias ATIVAS produzidas por uma entidade (Concentração/aura/limpeza). */
export async function activeEffectsFrom(
  source: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EffectDto[]> {
  const resolved = await resolveEntity(source, db);
  const rows = await db.effectInstance.findMany({
    where: {
      sourceEntityKind: resolved.entity.kind,
      sourceEntityId: resolved.entity.id,
      status: 'active',
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toEffectDto);
}

/**
 * GET de efeitos de um alvo, com a privacidade aplicada NO SERVIDOR.
 * • MASTER: vê tudo;
 * • PLAYER: só o PRÓPRIO personagem (combatente dele é canonicalizado) e só
 *   efeitos `public`.
 */
export async function listEffectsForTarget(
  actor: EffectActor,
  target: MechanicalEntity,
): Promise<EffectDto[]> {
  const resolved = await resolveEntity(target);
  if (!isMaster(actor)) {
    if (resolved.entity.kind !== 'character' || resolved.ownerUserId !== actor.userId) {
      throw new HttpError('Você só pode consultar os efeitos do seu personagem.', 403);
    }
  }
  const rows = await prisma.effectInstance.findMany({
    where: {
      targetEntityKind: resolved.entity.kind,
      targetEntityId: resolved.entity.id,
      status: 'active',
    },
    orderBy: { createdAt: 'asc' },
  });
  return effectsVisibleTo(rows, isMaster(actor));
}

/** Lista crua por fonte, com privacidade (usada por Concentração/aura futura). */
export async function listEffectsFromSource(
  actor: EffectActor,
  source: MechanicalEntity,
): Promise<EffectDto[]> {
  const resolved = await resolveEntity(source);
  if (!isMaster(actor) && (resolved.entity.kind !== 'character' || resolved.ownerUserId !== actor.userId)) {
    throw new HttpError('Você só pode consultar os efeitos do seu personagem.', 403);
  }
  const rows = await prisma.effectInstance.findMany({
    where: {
      sourceEntityKind: resolved.entity.kind,
      sourceEntityId: resolved.entity.id,
      status: 'active',
    },
    orderBy: { createdAt: 'asc' },
  });
  return effectsVisibleTo(rows, isMaster(actor));
}

function fingerprintOf(actor: EffectActor, input: CreateEffectInput): string {
  return createHash('sha256')
    .update(JSON.stringify({ type: 'effect-create', actor: actor.userId, input }))
    .digest('hex');
}

function replayError(): never {
  throw new HttpError('operationId reutilizado com outro payload/autor.', 409, 'IDEMPOTENCY_KEY_REUSED');
}

/**
 * CRIA um efeito manual. Só o Mestre (validado também na rota).
 *
 * Não aplica modificador, Condition, dano, save nem inicia Concentração: só
 * registra a instância. `operationId` torna o retry idempotente — o segundo
 * pedido devolve o snapshot da MESMA instância.
 */
export async function createEffect(
  actor: EffectActor,
  input: CreateEffectInput,
): Promise<{ effect: EffectDto; replayed: boolean }> {
  if (!isMaster(actor)) throw new HttpError('Apenas o Mestre cria efeitos.', 403);

  const fingerprint = fingerprintOf(actor, input);
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) replayError();
    return { ...(operation.snapshot as { effect: EffectDto }), replayed: true };
  };

  const existing = await prisma.effectOperation.findUnique({ where: { operationId: input.operationId } });
  if (existing) return replay(existing);

  let result: { effect: EffectDto; replayed: boolean };
  try {
    result = await prisma.$transaction(async (db) => {
      const prior = await db.effectOperation.findUnique({ where: { operationId: input.operationId } });
      if (prior) return replay(prior);

      const target = await resolveEntity(input.target, db);
      const source = input.sourceEntity ? await resolveEntity(input.sourceEntity, db) : null;
      // Origem legível: sempre do SERVIDOR. Sem entidade-fonte, o carimbo é o
      // Mestre (a criação manual é administração dele).
      const sourceLabel = source ? source.name : 'Mestre';

      const row = await db.effectInstance.create({
        data: {
          groupId: input.groupId ?? null,
          definitionId: input.definitionId ?? null,
          label: input.label,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          ...(source ? { sourceEntityKind: source.entity.kind, sourceEntityId: source.entity.id } : {}),
          sourceLabel,
          targetEntityKind: target.entity.kind,
          targetEntityId: target.entity.id,
          visibility: input.visibility,
          status: 'active',
          createdBy: actor.userId,
        },
      });
      const effect = toEffectDto(row);
      await db.effectOperation.create({
        data: {
          operationId: input.operationId,
          kind: 'create',
          fingerprint,
          snapshot: { effect } as unknown as Prisma.InputJsonValue,
        },
      });
      return { effect, replayed: false };
    });
  } catch (error) {
    // Corrida de dois retries simultâneos: o perdedor devolve o snapshot.
    const previous = await prisma.effectOperation.findUnique({ where: { operationId: input.operationId } });
    if (previous) return replay(previous);
    throw error;
  }

  await publishEffects([result.effect.targetEntity]);
  await appendEffectLog(
    result.effect.targetEntity,
    actor.username,
    (name) => `${actor.username} aplicou ${result.effect.label} em ${name}.`,
    result.effect.visibility === 'private',
  );
  return result;
}

/**
 * ENCERRA uma instância. Só o Mestre nesta fase.
 *
 * Idempotente por estado: encerrar o mesmo efeito outra vez devolve o mesmo
 * DTO (o PRIMEIRO `endedAt`/`endReason` prevalece) — nunca corrompe e nunca
 * afeta outro efeito, mesmo com o mesmo label.
 */
export async function endEffect(
  actor: EffectActor,
  effectId: string,
  input: { operationId?: string; reason?: EffectEndReason } = {},
): Promise<{ effect: EffectDto; replayed: boolean }> {
  if (!isMaster(actor)) throw new HttpError('Apenas o Mestre encerra efeitos.', 403);

  const reason: EffectEndReason = input.reason ?? 'manual';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ type: 'effect-end', actor: actor.userId, effectId, reason }))
    .digest('hex');

  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) replayError();
    return { ...(operation.snapshot as { effect: EffectDto }), replayed: true };
  };

  if (input.operationId) {
    const existing = await prisma.effectOperation.findUnique({ where: { operationId: input.operationId } });
    if (existing) return replay(existing);
  }

  const result = await prisma.$transaction(async (db) => {
    if (input.operationId) {
      const prior = await db.effectOperation.findUnique({ where: { operationId: input.operationId } });
      if (prior) return replay(prior);
    }
    const row = await getEffectById(effectId, db);
    const changed = await db.effectInstance.updateMany({
      where: { id: effectId, status: 'active' },
      data: { status: 'ended', endedAt: new Date(), endReason: reason },
    });
    const current = changed.count
      ? await getEffectById(effectId, db)
      : row;
    const effect = toEffectDto(current);
    if (input.operationId) {
      await db.effectOperation.create({
        data: {
          operationId: input.operationId,
          kind: 'end',
          fingerprint,
          snapshot: { effect } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return { effect, replayed: false };
  });

  await publishEffects([result.effect.targetEntity]);
  if (result.effect.status === 'ended') {
    await appendEffectLog(
      result.effect.targetEntity,
      actor.username,
      (name) => `${actor.username} encerrou ${result.effect.label} de ${name}.`,
      result.effect.visibility === 'private',
    );
  }
  return result;
}

/**
 * ENCERRA todos os efeitos ATIVOS de um grupo (ex.: Concentração que mantém a
 * aplicação inteira). Devolve os alvos afetados para publicação em tempo real.
 *
 * Não encerra nada fora do grupo: dois efeitos com o mesmo `label` em grupos
 * diferentes continuam independentes.
 */
export async function endEffectGroup(
  groupId: string,
  reason: EffectEndReason = 'group',
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<MechanicalEntity[]> {
  const rows = await db.effectInstance.findMany({
    where: { groupId, status: 'active' },
    select: { targetEntityKind: true, targetEntityId: true },
  });
  if (rows.length === 0) return [];
  await db.effectInstance.updateMany({
    where: { groupId, status: 'active' },
    data: { status: 'ended', endedAt: new Date(), endReason: reason },
  });
  const seen = new Set<string>();
  const targets: MechanicalEntity[] = [];
  for (const row of rows) {
    const key = `${row.targetEntityKind}:${row.targetEntityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      kind: row.targetEntityKind as MechanicalEntity['kind'],
      id: row.targetEntityId,
    });
  }
  return targets;
}

/**
 * Ligação EXPLÍCITA Concentração → Grupo de efeitos.
 *
 * Só age quando a concentração declara `sourceType: 'effect'` e um `sourceId`
 * (= `groupId`). Concentração manual legada (sem grupo) continua seguindo o
 * caminho de sempre, sem consultar efeito nenhum.
 */
export async function endEffectsForConcentration(
  concentration: { sourceType?: string; sourceId?: string } | null | undefined,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<MechanicalEntity[]> {
  if (!concentration || concentration.sourceType !== 'effect' || !concentration.sourceId) return [];
  return endEffectGroup(concentration.sourceId, 'concentration', db);
}

/**
 * Publica o estado ATIVO de cada alvo afetado.
 *
 * Mestres recebem tudo (público + privado); o DONO do personagem recebe só o
 * que é público. Criaturas/NPCs só são publicados para os Mestres. O filtro é
 * do servidor — o cliente nunca recebe o efeito privado para esconder.
 */
export async function publishEffects(targets: readonly MechanicalEntity[]): Promise<void> {
  const seen = new Set<string>();
  for (const target of targets) {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const rows = await prisma.effectInstance.findMany({
        where: {
          targetEntityKind: target.kind,
          targetEntityId: target.id,
          status: 'active',
        },
        orderBy: { createdAt: 'asc' },
      });
      const broadcaster = getBroadcaster();
      broadcaster.toMasters(ServerEvents.EFFECTS_UPDATED, {
        entity: target,
        effects: rows.map(toEffectDto),
      });
      if (target.kind === 'character') {
        const owner = await prisma.character.findUnique({ where: { id: target.id }, select: { userId: true } });
        if (owner) {
          broadcaster.toUser(owner.userId, ServerEvents.EFFECTS_UPDATED, {
            entity: target,
            effects: effectsVisibleTo(rows, false),
          });
        }
      }
    } catch (error) {
      console.error('[effects] falha ao publicar efeitos:', error);
    }
  }
}

/**
 * Log mínimo no Registro do combate (mesmo `economyLog`): efeito PRIVADO entra
 * como entrada privada e o DTO do jogador a descarta. Fora de combate não há
 * Registro persistente (a entrada só aparece na próxima leitura do combate —
 * este hook não incrementa a versão do combate).
 */
async function appendEffectLog(
  target: MechanicalEntity,
  actorName: string,
  makeMessage: (targetName: string) => string,
  isPrivate: boolean,
): Promise<void> {
  try {
    const resolved = await resolveEntity(target);
    let combatId: string | null = null;
    if (resolved.entity.kind === 'character') {
      const combatant = await prisma.combatant.findFirst({
        where: { characterId: resolved.entity.id, combat: { status: { in: [...ACTIVE_COMBAT_STATUSES] } } },
        select: { combatId: true },
      });
      combatId = combatant?.combatId ?? null;
    } else if (resolved.entity.kind === 'combatant') {
      const row = await prisma.combatant.findUnique({
        where: { id: resolved.entity.id },
        select: { combatId: true, combat: { select: { status: true } } },
      });
      combatId = row && ACTIVE_COMBAT_STATUSES.includes(row.combat.status as (typeof ACTIVE_COMBAT_STATUSES)[number])
        ? row.combatId
        : null;
    }
    if (!combatId) return;

    const combat = await prisma.combat.findUnique({ where: { id: combatId }, select: { economyLog: true } });
    const log = Array.isArray(combat?.economyLog) ? combat.economyLog : [];
    const entry = {
      id: randomUUID(),
      actorName,
      message: makeMessage(resolved.name),
      at: new Date().toISOString(),
      action: 'effect',
      ...(isPrivate ? { private: true } : {}),
    };
    await prisma.combat.update({
      where: { id: combatId },
      data: { economyLog: [...log, entry].slice(-100) as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    console.error('[effects] falha ao registrar o efeito no log do combate:', error);
  }
}
