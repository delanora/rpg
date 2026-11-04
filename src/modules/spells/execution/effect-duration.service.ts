import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import { orderCombatants } from '../../combat/combat.dto.js';
import {
  isDurationDue,
  parseDurationSnapshot,
  type SpellDurationSnapshot,
} from './spell-duration.js';
import {
  cancelOngoingPendingsForEffects,
  endEffectRows,
} from '../../effects/effect-group-lifecycle.js';
import type { EffectActor } from '../../effects/effects.service.js';

/**
 * FASE 6.6H — PROCESSADOR CENTRAL DE DURAÇÃO.
 *
 * Um único lugar decide "esta magia timed venceu nesta posição do clock?".
 * Nada aqui usa `setTimeout`/`setInterval`/wall clock: o clock é
 * `Combat.round` + a ativação corrente, e o snapshot gravado no COMMIT é a
 * autoridade (nunca o catálogo atual).
 *
 * Quando a duração vence:
 *  • o GRUPO inteiro de efeitos termina (`duration`/`duration-expired`);
 *  • Conditions/modificadores saem pelo lifecycle existente;
 *  • pendências CONTÍNUAS daqueles efeitos são canceladas (não bloqueiam turno);
 *  • se o grupo ficou vazio, a Concentração do conjurador termina (idempotente);
 *  • um cast ainda `resolving` (barreira inicial) é fechado como
 *    `resolved`/`no-effect` + `resolutionReason = 'duration-expired'`, com as
 *    pendências iniciais canceladas — nunca fica `resolving` para sempre.
 *
 * Idempotência: processar a mesma ativação duas vezes não reescreve
 * `endedAt`/`endReason` (a guarda `status = 'active'` do lifecycle) nem cria
 * pendências novas.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Clock mínimo + elegibilidade do anchor, lida do combate persistido. */
interface CombatClockContext {
  combatId: string;
  roundNumber: number;
  turnSequence: number;
  currentCombatantId: string | null;
  /** O anchor ainda pode RECEBER um turno válido neste round? */
  anchorEligible: (anchorCombatantId: string) => boolean;
}

/**
 * Lê o clock REAL do combate. Fora de combate ativo não existe duração
 * automática (o acompanhamento é manual) — devolve `null`.
 */
async function combatClock(combatId: string, db: Db): Promise<CombatClockContext | null> {
  const combat = await db.combat.findUnique({
    where: { id: combatId },
    include: { combatants: true },
  });
  if (!combat || combat.status !== 'ACTIVE') return null;
  const ordered = orderCombatants(combat.combatants as never);
  const current = ordered[combat.currentIndex] ?? null;

  /**
   * A regra completa de turno vive no combate; aqui basta a parte que interessa
   * à duração: o combatente existe e não está morto/estabilizado sem pendência.
   * Personagem tem o PV ao vivo na ficha (snapshot nulo), então só o `deathState`
   * decide.
   */
  const anchorEligible = (anchorCombatantId: string): boolean => {
    const combatant = combat.combatants.find((item) => item.id === anchorCombatantId);
    if (!combatant) return false;
    const death = (combatant.deathState ?? {}) as {
      dead?: boolean;
      stabilized?: boolean;
      pending?: boolean;
    };
    if (death.dead) return false;
    if (combatant.characterId) return true;
    const hp = combatant.hpCurrent ?? combatant.hpCurrent ?? 0;
    return !(hp <= 0 && death.stabilized && !death.pending);
  };

  return {
    combatId: combat.id,
    roundNumber: combat.round,
    turnSequence: combat.turnSequence,
    currentCombatantId: current?.id ?? null,
    anchorEligible,
  };
}

export interface DurationProcessingResult {
  /** Alvos cujas visões derivadas mudaram (publicar depois do commit). */
  targets: MechanicalEntity[];
  expiredGroups: number;
  expiredCasts: number;
}

/**
 * Fecha um `SpellCast` que venceu ANTES de produzir qualquer Effect.
 *
 * As pendências iniciais são canceladas e o cast deixa `resolving` com motivo
 * auditável. Espaço/Ação/componentes continuam gastos (§6/§139).
 */
async function expireResolvingCasts(
  clock: CombatClockContext,
  db: Db,
): Promise<{ targets: MechanicalEntity[]; expired: number }> {
  const casts = await db.spellCast.findMany({
    where: { status: 'resolving', durationSnapshot: { not: Prisma.DbNull } },
    select: { id: true, durationSnapshot: true, combatId: true, targets: true },
  });

  const targets: MechanicalEntity[] = [];
  let expired = 0;
  for (const cast of casts) {
    if (cast.combatId !== clock.combatId) continue;
    const snapshot = parseDurationSnapshot(cast.durationSnapshot);
    if (!snapshot || !snapshot.combat) continue;
    const due = isDurationDue(
      snapshot,
      { roundNumber: clock.roundNumber, currentCombatantId: clock.currentCombatantId },
      clock.anchorEligible(snapshot.combat.anchorCombatantId),
    );
    if (!due) continue;

    await db.pendingEffectSave.updateMany({
      where: { spellCastId: cast.id, status: 'pending' },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    const closed = await db.spellCast.updateMany({
      where: { id: cast.id, status: 'resolving' },
      data: {
        status: 'resolved',
        outcome: 'no-effect',
        resolutionReason: 'duration-expired',
        resolvedAt: new Date(),
      },
    });
    if (!closed.count) continue;
    expired += 1;
    if (Array.isArray(cast.targets)) {
      for (const entry of cast.targets) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as { kind?: unknown; id?: unknown };
        if (typeof item.kind === 'string' && typeof item.id === 'string') {
          targets.push({ kind: item.kind as MechanicalEntity['kind'], id: item.id });
        }
      }
    }
  }
  return { targets, expired };
}

/**
 * Processa as expirações devidas na posição ATUAL do clock.
 *
 * Chamado pelo `nextTurn` DEPOIS de avançar (e depois dos triggers de fim de
 * turno), antes de publicar o novo turno — assim um Bless expirado não concede
 * bônus no turno que está começando.
 */
export async function processDurationExpirations(
  db: Db,
  combatId: string,
): Promise<DurationProcessingResult> {
  const clock = await combatClock(combatId, db);
  if (!clock) return { targets: [], expiredGroups: 0, expiredCasts: 0 };

  const effects = await db.effectInstance.findMany({
    where: { status: 'active', durationSnapshot: { not: Prisma.DbNull } },
    select: {
      id: true,
      groupId: true,
      durationSnapshot: true,
      sourceEntityKind: true,
      sourceEntityId: true,
    },
  });

  // Agrupa por aplicação: a duração de um cast é UMA, então o grupo expira junto.
  const byGroup = new Map<string, { ids: string[]; snapshot: SpellDurationSnapshot }>();
  for (const effect of effects) {
    const snapshot = parseDurationSnapshot(effect.durationSnapshot);
    if (!snapshot || !snapshot.combat) continue;
    if (snapshot.combat.combatId !== clock.combatId) continue;
    const key = effect.groupId ?? `effect:${effect.id}`;
    const entry = byGroup.get(key);
    if (entry) entry.ids.push(effect.id);
    else byGroup.set(key, { ids: [effect.id], snapshot });
  }

  const targets: MechanicalEntity[] = [];
  let expiredGroups = 0;
  for (const [key, entry] of byGroup) {
    const due = isDurationDue(
      entry.snapshot,
      { roundNumber: clock.roundNumber, currentCombatantId: clock.currentCombatantId },
      clock.anchorEligible(entry.snapshot.combat!.anchorCombatantId),
    );
    if (!due) continue;

    // Nenhuma pendência contínua de um efeito que não existe mais pode bloquear
    // o turno (§54/§55).
    await cancelOngoingPendingsForEffects(entry.ids, db);
    const where = key.startsWith('effect:')
      ? { id: entry.ids[0] }
      : { groupId: key };
    const ended = await endEffectRows(where, 'duration-expired', db);
    targets.push(...ended.targets);
    expiredGroups += 1;
  }

  const casts = await expireResolvingCasts(clock, db);
  targets.push(...casts.targets);

  return { targets, expiredGroups, expiredCasts: casts.expired };
}

export interface ManualDurationExpiration {
  targets: MechanicalEntity[];
  effects: {
    id: string;
    label: string;
    definitionId: string | null;
    targetEntity: MechanicalEntity;
  }[];
  concentrationEnded: boolean;
  alreadyEnded: boolean;
}

/**
 * EXPIRAÇÃO MANUAL (fora de combate ou quando o Mestre declara o tempo
 * narrativo — §29/§97). Reutiliza o MESMO lifecycle de encerramento: nenhum
 * segundo Effect engine e nenhum wall clock.
 */
export async function expireEffectByDuration(
  actor: EffectActor,
  effectId: string,
): Promise<ManualDurationExpiration> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre expira a duração de um efeito.', 403);
  }
  const effect = await prisma.effectInstance.findUnique({ where: { id: effectId } });
  if (!effect) throw new HttpError('Efeito não encontrado.', 404);

  if (effect.status !== 'active') {
    return { targets: [], effects: [], concentrationEnded: false, alreadyEnded: true };
  }

  const rows = await prisma.effectInstance.findMany({
    where: effect.groupId
      ? { groupId: effect.groupId, status: 'active' }
      : { id: effect.id, status: 'active' },
    select: {
      id: true,
      label: true,
      definitionId: true,
      targetEntityKind: true,
      targetEntityId: true,
    },
  });
  const snapshot = rows.map((row) => ({
    id: row.id,
    label: row.label,
    definitionId: row.definitionId,
    targetEntity: {
      kind: row.targetEntityKind as MechanicalEntity['kind'],
      id: row.targetEntityId,
    },
  }));

  const ended = await prisma.$transaction(async (db) => {
    await cancelOngoingPendingsForEffects(
      rows.map((row) => row.id),
      db,
    );
    return endEffectRows(
      effect.groupId ? { groupId: effect.groupId } : { id: effect.id },
      'duration-expired',
      db,
    );
  });

  return {
    targets: ended.targets,
    effects: snapshot,
    concentrationEnded: ended.concentrationEnded,
    alreadyEnded: ended.targets.length === 0,
  };
}
