import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { ServerEvents } from '../../realtime/events.js';
import { characterBaseMaxHp } from '../characters/characters.dto.js';
import { toCreatureDto } from '../creatures/creatures.dto.js';
import { emitCombat, loadCombatById, publishCharacter, type CombatActor } from '../combat/combat.service.js';
import { orderCombatants, toCombatDto } from '../combat/combat.dto.js';
import { economyOf, moveDistance } from '../shared/action-economy.js';
import { registerFatalExhaustion } from '../death/death.service.js';
import { HP_ZERO_SOURCE } from '../shared/death.js';
import { CONDITION_LABELS, deriveConditionEffects, effectiveMaxHp, effectiveSpeed, mechanicalStateOf, reconcileMovement, type MechanicalEntity, type MechanicalState } from '../shared/conditions.js';
import type { MechanicalMutationInput } from './mechanical.schema.js';

interface LoadedEntity {
  entity: MechanicalEntity; name: string; version: number; ownerUserId: string | null;
  state: MechanicalState; baseSpeed: number; baseMaxHp: number; hpCurrent: number;
  combat: { id: string; version: number; status: string; combatantId: string } | null;
}

async function loadEntity(entity: MechanicalEntity, db: Prisma.TransactionClient = prisma): Promise<LoadedEntity> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    const participant = await db.combatant.findFirst({ where: { characterId: row.id, combat: { status: { in: ['ACTIVE', 'PENDING_INITIATIVE'] } } }, include: { combat: true } });
    return { entity, name: row.name, version: row.version, ownerUserId: row.userId, state: mechanicalStateOf(row.mechanicalState), baseSpeed: row.speed, baseMaxHp: characterBaseMaxHp(row), hpCurrent: row.hpCurrent,
      combat: participant ? { id: participant.combat.id, version: participant.combat.version, status: participant.combat.status, combatantId: participant.id } : null };
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return { entity, name: row.name, version: row.version, ownerUserId: null, state: mechanicalStateOf(row.mechanicalState), baseSpeed: row.speed, baseMaxHp: row.hpMax, hpCurrent: row.hpCurrent, combat: null };
  }
  const row = await db.combatant.findUnique({ where: { id: entity.id }, include: { creature: true, combat: true } });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  if (row.characterId) return loadEntity({ kind: 'character', id: row.characterId }, db);
  return { entity, name: row.name, version: row.mechanicalVersion, ownerUserId: null, state: mechanicalStateOf(row.mechanicalState), baseSpeed: row.creature?.speed ?? 0, baseMaxHp: row.hpMax ?? row.creature?.hpMax ?? 0, hpCurrent: row.hpCurrent ?? 0,
    combat: row.combat.status !== 'ENDED' ? { id: row.combat.id, version: row.combat.version, status: row.combat.status, combatantId: row.id } : null };
}

/**
 * Instâncias que NÃO podem ser removidas manualmente porque são DERIVADAS de
 * outro estado: a Inconsciência e a Queda do ciclo de 0 PV. Removê-las por aqui
 * deixaria o personagem "acordado" com 0 PV, quebrando a fonte de verdade do
 * lifecycle. A UI usa esta lista para travar o botão e explicar o motivo.
 */
function protectedInstanceIds(state: MechanicalState): string[] {
  const hpZeroUnconscious = state.conditions.some(
    (instance) => instance.condition === 'unconscious' && instance.sourceType === HP_ZERO_SOURCE,
  );
  return state.conditions
    .filter(
      (instance) =>
        (instance.condition === 'unconscious' && instance.sourceType === HP_ZERO_SOURCE) ||
        // A Queda derivada acompanha a inconsciência de 0 PV. Sem ela, uma
        // Queda independente (de um empurrão ou do Mestre) é removível.
        (hpZeroUnconscious && instance.condition === 'prone'),
    )
    .map((instance) => instance.id);
}

function dto(entity: LoadedEntity) {
  const state = entity.state;
  return { entity: entity.entity, name: entity.name, version: entity.version, state,
    effects: deriveConditionEffects(state), effectiveSpeed: effectiveSpeed(entity.baseSpeed, state),
    effectiveMaxHp: effectiveMaxHp(entity.baseMaxHp, state), hpCurrent: entity.hpCurrent,
    /** Derivadas do lifecycle de 0 PV: sem remoção manual (ver acima). */
    protectedInstanceIds: protectedInstanceIds(state),
    combat: entity.combat ? { id: entity.combat.id, version: entity.combat.version, status: entity.combat.status } : null };
}
export type MechanicalDto = ReturnType<typeof dto>;

export async function getMechanicalState(actor: CombatActor, entity: MechanicalEntity): Promise<MechanicalDto> {
  const loaded = await loadEntity(entity);
  if (actor.role !== 'MASTER' && loaded.ownerUserId !== actor.userId) {
    throw new HttpError('Apenas o Mestre ou o dono pode consultar este estado.', 403);
  }
  return dto(loaded);
}

function log(state: MechanicalState, actor: CombatActor, message: string): void {
  state.log = [...state.log, { id: randomUUID(), actorName: actor.username, message, at: new Date().toISOString() }].slice(-100);
}

/** Mesma transação de estado, PV e economia; aplicação futura deve usar este domínio. */
export async function mutateMechanicalState(actor: CombatActor, input: MechanicalMutationInput, authority?: { ruleId: string }) {
  // Apenas handlers internos podem conceder autoridade de regra após validá-la.
  // A rota HTTP nunca lê/transmite este terceiro argumento do payload.
  if (actor.role !== 'MASTER' && !authority && input.action !== 'stand') throw new HttpError('Apenas o Mestre administra condições e Exaustão.', 403);
  const fingerprint = createHash('sha256').update(JSON.stringify({ actor: actor.userId, rule: authority?.ruleId, input })).digest('hex');
  const canonical = (await loadEntity(input.entity)).entity;
  const where = { entityKind_entityId_operationId: { entityKind: canonical.kind, entityId: canonical.id, operationId: input.operationId } };
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) throw new HttpError('operationId reutilizado com outro payload/autor.', 409, 'IDEMPOTENCY_KEY_REUSED');
    return { mechanical: operation.snapshot as MechanicalDto, replayed: true };
  };
  const existing = await prisma.mechanicalOperation.findUnique({ where });
  if (existing) return replay(existing);
  let result: MechanicalDto;
  try {
    result = await prisma.$transaction(async db => {
      const loaded = await loadEntity(input.entity, db);
      if (actor.role !== 'MASTER' && !authority && loaded.ownerUserId !== actor.userId) throw new HttpError('Você só pode levantar seu personagem.', 403);
      if (loaded.version !== input.expectedVersion) throw new HttpError('Estado mecânico mudou. Atualize e tente novamente.', 409, 'CONFLICT');
      if (loaded.combat) {
        const guarded = await db.combat.updateMany({ where: { id: loaded.combat.id, version: input.expectedCombatVersion ?? -1, status: { in: ['ACTIVE', 'PENDING_INITIATIVE'] } }, data: { version: { increment: 1 } } });
        if (!guarded.count) throw new HttpError('Combate mudou. Informe a versão atual do combate.', 409, 'CONFLICT');
        // Relê após o lock: não compõe economia/condições de um snapshot anterior.
        const fresh = await loadEntity(input.entity, db);
        if (fresh.version !== input.expectedVersion) throw new HttpError('Estado mecânico mudou.', 409, 'CONFLICT');
        Object.assign(loaded, fresh);
      }
      const state = loaded.state;
      if (input.action === 'apply') {
        if (input.condition === 'poisoned' && deriveConditionEffects(state).poisonImmune) throw new HttpError('Petrificado: imune a novo envenenamento.', 409, 'CONDITION_IMMUNE');
        let sourceLabel = input.sourceLabel;
        if (input.sourceEntity) sourceLabel = (await loadEntity(input.sourceEntity, db)).name;
        // Aplicação MANUAL do Mestre sem fonte escolhida: a instância continua
        // rastreável ("Mestre" + operationId), em vez de ficar órfã. Regras
        // internas (`authority`) não recebem esse carimbo.
        const manual = actor.role === 'MASTER' && !authority;
        if (manual && !sourceLabel) sourceLabel = 'Mestre';
        const sourceType = input.sourceType ?? (manual ? 'manual' : undefined);
        const sourceId = input.sourceId ?? (input.sourceEntity ? input.sourceEntity.id : manual ? input.operationId : undefined);
        state.conditions.push({ id: randomUUID(), condition: input.condition!, appliedBy: actor.userId, appliedAt: new Date().toISOString(),
          ...(input.sourceEntity ? { sourceEntity: input.sourceEntity } : {}), ...(sourceLabel ? { sourceLabel } : {}),
          ...(sourceType ? { sourceType } : {}), ...(sourceId ? { sourceId } : {}) });
        log(state, actor, `${loaded.name} ficou ${CONDITION_LABELS[input.condition!]}${sourceLabel ? ` — ${sourceLabel}` : ''}.`);
        if (input.condition === 'unconscious') {
          // Queda é postura física independente: continua caído depois de acordar.
          if (!state.conditions.some(instance => instance.condition === 'prone')) state.conditions.push({ id: randomUUID(), condition: 'prone', sourceType: 'posture', sourceLabel: 'Queda por inconsciência', appliedBy: actor.userId, appliedAt: new Date().toISOString() });
          log(state, actor, `${loaded.name} cai e larga o que estiver segurando. Colocação/manuseio dos objetos devem ser resolvidos manualmente pelo Mestre; inventário não foi movido.`);
        }
      } else if (input.action === 'remove') {
        const instance = state.conditions.find(item => item.id === input.instanceId);
        if (!instance) throw new HttpError('Instância de condição não encontrada.', 404);
        // Condição DERIVADA (0 PV): remover por aqui quebraria o lifecycle — a
        // saída é resolver PV/estado de morte, que é quem mantém a instância.
        if (protectedInstanceIds(state).includes(instance.id)) {
          throw new HttpError(
            'Esta condição é mantida por outro estado e não pode ser removida diretamente.',
            409,
            'CONDITION_DERIVED',
          );
        }
        state.conditions = state.conditions.filter(item => item.id !== instance.id);
        log(state, actor, `${CONDITION_LABELS[instance.condition]} removido de ${loaded.name}${instance.sourceLabel ? ` — ${instance.sourceLabel}` : ''}.`);
      } else if (input.action === 'exhaustion') {
        const level = input.exhaustionLevel ?? state.exhaustionLevel + input.exhaustionDelta!;
        if (level < 0 || level > 6) throw new HttpError('Exaustão deve ficar entre 0 e 6.', 400, 'VALIDATION_ERROR');
        state.exhaustionLevel = level;
        // A regra é OPCIONAL: desligada, o nível é SALVO mas permanece inerte,
        // então nem o log anuncia fatalidade. `fatalByExhaustion` já respeita a
        // configuração da mesa.
        const fatal = deriveConditionEffects(state).fatalByExhaustion;
        log(state, actor, `Exaustão de ${loaded.name} ajustada para ${level}${input.reason ? `: ${input.reason}` : ''}.${fatal ? ' Exaustão fatal: morte pela regra; resolução assistida pelo Mestre.' : ''}`);
      } else {
        const effects = deriveConditionEffects(state), speed = effectiveSpeed(loaded.baseSpeed, state);
        if (!effects.prone) throw new HttpError('A criatura não está caída.', 409, 'CONFLICT');
        if (speed <= 0) {
          throw new HttpError(
            'Você não pode se levantar enquanto seu deslocamento efetivo for 0.',
            409,
            'CONFLICT',
          );
        }
        if (loaded.combat) {
          if (loaded.combat.status !== 'ACTIVE') throw new HttpError('Aguarde o início do combate para levantar com movimento.', 409, 'CONFLICT');
          const combat = await loadCombatById(loaded.combat.id, db);
          if (orderCombatants(combat.combatants)[combat.currentIndex]?.id !== loaded.combat.combatantId) throw new HttpError('Levantar exige o próprio turno.', 403);
          const participant = combat.combatants.find(item => item.id === loaded.combat!.combatantId)!;
          const budget = economyOf(participant.turnEconomy), available = reconcileMovement(budget, loaded.baseSpeed, speed);
          const cost = speed / 2;
          if (available.movementBudget - available.movementUsed + 1e-8 < cost) {
            throw new HttpError(
              `Movimento insuficiente para levantar-se: custa ${cost} m (metade do deslocamento efetivo).`,
              409,
              'CONFLICT',
            );
          }
          moveDistance(available, cost);
          budget.movementUsed = available.movementUsed;
          await db.combatant.update({ where: { id: participant.id }, data: { turnEconomy: budget } });
        }
        state.conditions = state.conditions.filter(item => item.condition !== 'prone');
        log(state, actor, `${loaded.name} levantou${loaded.combat ? `, gastando ${speed / 2} m de Movimento` : ''}.`);
      }
      // Validação integral antes da escrita: limita fontes e valida estrutura.
      mechanicalStateOf(state);
      const hpCurrent = Math.min(loaded.hpCurrent, effectiveMaxHp(loaded.baseMaxHp, state));
      const data = { mechanicalState: state as unknown as Prisma.InputJsonValue, hpCurrent };
      const changed = loaded.entity.kind === 'character'
        ? await db.character.updateMany({ where: { id: loaded.entity.id, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } })
        : loaded.entity.kind === 'creature'
          ? await db.creature.updateMany({ where: { id: loaded.entity.id, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } })
          : await db.combatant.updateMany({ where: { id: loaded.entity.id, mechanicalVersion: input.expectedVersion }, data: { ...data, mechanicalVersion: { increment: 1 } } });
      if (!changed.count) throw new HttpError('Estado mecânico mudou.', 409, 'CONFLICT');
      // Fase 6.3: Exaustão nível 6 indica morte pelas regras — abre a MESMA
      // decisão do Mestre usada pela morte instantânea. Nada de marcar morte
      // automaticamente; a Exaustão continua no nível 6 até o Mestre mexer.
      // Regra OPCIONAL da mesa (hotfix de Exaustão): com a regra DESLIGADA, o
      // nível 6 continua salvo, mas NÃO abre a decisão de morte.
      if (input.action === 'exhaustion' && deriveConditionEffects(state).fatalByExhaustion) {
        await registerFatalExhaustion(input.entity, actor.username, db);
      }
      const response = dto(await loadEntity(input.entity, db));
      await db.mechanicalOperation.create({ data: { entityKind: canonical.kind, entityId: canonical.id, operationId: input.operationId, fingerprint, snapshot: response as unknown as Prisma.InputJsonValue } });
      return response;
    }, { timeout: 15000 });
  } catch (error) {
    const previous = await prisma.mechanicalOperation.findUnique({ where });
    if (previous) return replay(previous);
    throw error;
  }
  const broadcaster = getBroadcaster();
  if (result.entity.kind === 'character') {
    await publishCharacter(result.entity.id);
    const owner = await prisma.character.findUniqueOrThrow({ where: { id: result.entity.id }, select: { userId: true } });
    broadcaster.toUser(owner.userId, ServerEvents.MECHANICAL_UPDATED, { mechanical: result });
  }
  broadcaster.toMasters(ServerEvents.MECHANICAL_UPDATED, { mechanical: result });
  if (result.entity.kind === 'creature') {
    const creature = await prisma.creature.findUniqueOrThrow({ where: { id: result.entity.id }, include: { localities: { select: { id: true, name: true } } } });
    broadcaster.toMasters(ServerEvents.CREATURE_UPDATED, { creature: toCreatureDto(creature), changes: {} });
  }
  if (result.combat) emitCombat(ServerEvents.COMBAT_UPDATED, toCombatDto(await loadCombatById(result.combat.id), 'MASTER'));
  return { mechanical: result, replayed: false };
}
