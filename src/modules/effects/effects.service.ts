import { createHash, randomUUID } from 'node:crypto';
import type { EffectInstance, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { ServerEvents } from '../../realtime/events.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import {
  buildEffectModifierSet,
  emptyEffectModifierSet,
  type EffectModifierSet,
} from './effect-modifiers.js';
import { applyEffectConditions, type EffectConditionTarget } from './effect-conditions.js';
import { endEffectInstances, uniqueTargets } from './effect-lifecycle.js';
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

/**
 * RESOLVEDOR CENTRAL (6.5B): resumo de modificadores dos efeitos ATIVOS.
 *
 * É a ÚNICA porta que os pipelines de rolagem/CA/deslocamento consultam — eles
 * nunca leem a tabela de efeitos diretamente nem conhecem `label` de magia.
 *
 * • Uma consulta por LOTE (sem N+1 na iniciativa/ataque): as entidades são
 *   canonicalizadas e agrupadas por (kind, id) antes do `findMany`.
 * • Combatente de PERSONAGEM usa a chave da FICHA (mesma fonte de verdade da
 *   6.5A) — nada é duplicado no combatente.
 * • Só `status = 'active'` entra: encerrado/Efeito acabado de concentração não
 *   modifica mais nada no mesmo instante.
 * • O mapa de retorno é indexado pela chave da entidade PEDIDA
 *   (`kind:id`), inclusive quando ela é um combatente de personagem.
 */
export async function effectModifierSetsFor(
  entities: readonly MechanicalEntity[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, EffectModifierSet>> {
  const result = new Map<string, EffectModifierSet>();
  if (entities.length === 0) return result;

  // 1) Combatentes: descobre quais representam um PERSONAGEM (chave canônica).
  const combatantIds = [...new Set(entities.filter((e) => e.kind === 'combatant').map((e) => e.id))];
  const combatants = combatantIds.length
    ? await db.combatant.findMany({
        where: { id: { in: combatantIds } },
        select: { id: true, characterId: true },
      })
    : [];
  const characterOfCombatant = new Map(combatants.map((row) => [row.id, row.characterId]));

  const canonicalOf = (entity: MechanicalEntity): MechanicalEntity => {
    if (entity.kind !== 'combatant') return entity;
    const characterId = characterOfCombatant.get(entity.id);
    return characterId ? { kind: 'character', id: characterId } : entity;
  };

  // 2) Chaves canônicas únicas → uma consulta agrupada por tipo.
  const canonicalKeys = new Map<string, MechanicalEntity>();
  for (const entity of entities) {
    const canonical = canonicalOf(entity);
    canonicalKeys.set(`${canonical.kind}:${canonical.id}`, canonical);
  }
  const byKind = new Map<string, string[]>();
  for (const canonical of canonicalKeys.values()) {
    byKind.set(canonical.kind, [...(byKind.get(canonical.kind) ?? []), canonical.id]);
  }
  const rows = await db.effectInstance.findMany({
    where: {
      status: 'active',
      OR: [...byKind.entries()].map(([kind, ids]) => ({ targetEntityKind: kind, targetEntityId: { in: ids } })),
    },
    select: { id: true, label: true, visibility: true, modifiers: true, targetEntityKind: true, targetEntityId: true },
  });

  // 3) Compõe o resumo por alvo canônico e projeta para cada chave pedida.
  const setsByCanonical = new Map<string, ReturnType<typeof buildEffectModifierSet>>();
  const rowsByCanonical = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.targetEntityKind}:${row.targetEntityId}`;
    rowsByCanonical.set(key, [...(rowsByCanonical.get(key) ?? []), row]);
  }
  for (const [key, targetRows] of rowsByCanonical) {
    setsByCanonical.set(key, buildEffectModifierSet(targetRows));
  }
  for (const entity of entities) {
    const canonical = canonicalOf(entity);
    const key = `${canonical.kind}:${canonical.id}`;
    result.set(`${entity.kind}:${entity.id}`, setsByCanonical.get(key) ?? emptyEffectModifierSet());
  }
  return result;
}

/** Atalho para UM alvo (rolagem de dados, teste de concentração). */
export async function effectModifierSetFor(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EffectModifierSet> {
  const sets = await effectModifierSetsFor([entity], db);
  return sets.get(`${entity.kind}:${entity.id}`) ?? emptyEffectModifierSet();
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
 * A instância é gravada com os MODIFICADORES (6.5B) e com as CONDITIONS
 * (6.5C) que ela aplica. As Conditions viram `ConditionInstance` reais no
 * `mechanicalState` do alvo DENTRO da mesma transação — nunca existe efeito
 * gravado sem a Condition que ele declara. `operationId` torna o retry
 * idempotente: o snapshot devolvido NÃO reaplica Condition.
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

  // Alvos de grupos encerrados pelo cascade de Concentração (publicados depois
  // do commit, como no resto do domínio).
  const endedEffectTargets: MechanicalEntity[] = [];
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
          modifiers: input.modifiers as unknown as Prisma.InputJsonValue,
          conditions: input.conditions as unknown as Prisma.InputJsonValue,
          targetEntityKind: target.entity.kind,
          targetEntityId: target.entity.id,
          visibility: input.visibility,
          status: 'active',
          createdBy: actor.userId,
        },
      });

      // CONDITIONS (6.5C) na MESMA transação: nunca existe efeito sem a
      // Condition que ele declara, nem Condition sem o efeito. O alvo é a
      // chave CANÔNICA (combatente de personagem → ficha).
      const applied = await applyEffectConditions(row, target.entity, db);
      // Incapacitou o ALVO que estava concentrando: encerra a concentração dele
      // e, se ela mantinha um grupo, encerra o grupo (e as Conditions dele).
      // Pode ser o MESMO efeito recém-criado (auto-incapacitação) — o fluxo
      // termina aqui, sem recursão.
      if (applied.endedConcentration) {
        endedEffectTargets.push(
          ...(await endEffectsForConcentration(applied.endedConcentration, db)),
        );
      }
      // Relê: o cascade acima pode ter encerrado este próprio efeito.
      const fresh = await getEffectById(row.id, db);
      const effect = toEffectDto(fresh);
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

  await publishEffects([result.effect.targetEntity, ...endedEffectTargets]);
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
      if (prior) return { ...replay(prior), changed: false };
    }
    await getEffectById(effectId, db);
    // LIFECYCLE CENTRAL (6.5D): MESMO pipeline do endEffectGroup. A guarda
    // `status = 'active'` preserva o primeiro `endedAt`/`endReason` e evita
    // cleanup/log duplicados em retry ou encerramento concorrente.
    const ended = await endEffectInstances({ id: effectId }, reason, db);
    const current = await getEffectById(effectId, db);
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
    return { effect, replayed: false, changed: ended.length > 0 };
  });

  await publishEffects([result.effect.targetEntity]);
  if (result.changed) {
    await appendEffectLog(
      result.effect.targetEntity,
      actor.username,
      (name) => `${actor.username} encerrou ${result.effect.label} de ${name}.`,
      result.effect.visibility === 'private',
    );
  }
  return { effect: result.effect, replayed: result.replayed };
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
  /** Alvo já carregado pelo chamador (ver `removeEffectConditions`). */
  context?: EffectConditionTarget,
): Promise<MechanicalEntity[]> {
  // Mesmo lifecycle do `endEffect`, aplicado em LOTE: a transição de status e
  // a remoção das Conditions de cada instância acontecem num pipeline único.
  const ended = await endEffectInstances({ groupId }, reason, db, context);
  return uniqueTargets(ended);
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
  context?: EffectConditionTarget,
): Promise<MechanicalEntity[]> {
  if (!concentration || concentration.sourceType !== 'effect' || !concentration.sourceId) return [];
  return endEffectGroup(concentration.sourceId, 'concentration', db, context);
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
  // CA/deslocamento derivados da ficha/combate dependem dos efeitos: depois de
  // publicar a lista, republica quem exibe esses valores.
  await refreshDerivedViews(targets);
}

/**
 * Republica as VISÕES DERIVADAS que dependem de efeitos (6.5B).
 *
 * CA/deslocamento da ficha e do tabuleiro são calculados a partir dos efeitos
 * ativos, mas o efeito NÃO incrementa a versão da ficha/combate. Sem esta
 * reemissão o valor exibido ficaria velho até o próximo evento.
 *
 * Os imports são DINÂMICOS de propósito: `combat` e `characters` importam este
 * módulo, então uma importação estática criaria ciclo.
 */
async function refreshDerivedViews(targets: readonly MechanicalEntity[]): Promise<void> {
  try {
    const combat = await import('../combat/combat.service.js');
    await combat.refreshCombatForEffects();
  } catch (error) {
    console.error('[effects] falha ao republicar o combate:', error);
  }

  for (const target of targets) {
    try {
      if (target.kind === 'character') {
        const row = await prisma.character.findUnique({
          where: { id: target.id },
          include: { user: { select: { username: true } } },
        });
        if (!row) continue;
        const { publishChange } = await import('../characters/characters.service.js');
        await publishChange(
          { userId: row.userId, username: row.user.username },
          row,
          { effects: 'updated' },
        );
      } else if (target.kind === 'creature') {
        const row = await prisma.creature.findUnique({ where: { id: target.id } });
        if (!row) continue;
        const [{ toCreatureDto }, { getBroadcaster }] = await Promise.all([
          import('../creatures/creatures.dto.js'),
          import('../../realtime/hub.js'),
        ]);
        getBroadcaster().toMasters(ServerEvents.CREATURE_UPDATED, {
          creature: toCreatureDto(row, await effectModifierSetFor(target)),
          changes: { effects: 'updated' },
        });
      }
    } catch (error) {
      console.error('[effects] falha ao republicar a visão derivada:', error);
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
