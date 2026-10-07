import type { Character, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { characterClassAdjustments, characterMaxHp } from '../characters/characters.dto.js';
import { publishChange, type SheetOwner } from '../characters/characters.service.js';
import { recordRestSongOfRestRoll } from '../dice/dice.service.js';
import {
  bardLevel,
  bestSongOfRestDie,
  normalizeClassEntries,
  normalizeClassState,
  restoreShortRestResources,
} from '../shared/classes.js';
import { rollDie } from '../shared/dice.js';
import type { ShortRestCompletionDto, ShortRestSongRollDto } from './short-rest-request.dto.js';

/**
 * Conclusão COLETIVA de um Descanso Curto.
 *
 * Roda dentro da transação de quem a dispara (ready do último participante ou
 * force-complete do mestre). Numa operação lógica única:
 *   1. valida TODOS os ACCEPTED com sessão ACTIVE;
 *   2. determina o melhor dado da Canção de Descanso (só Bardos ACCEPTED);
 *   3. rola INDIVIDUALMENTE para cada personagem que gastou ≥ 1 Dado de Vida;
 *   4. aplica a cura (respeitando o PV máximo efetivo);
 *   5. restaura os recursos de recarga CURTA;
 *   6. conclui todas as sessões e a solicitação.
 *
 * ATENÇÃO (não violar): as rolagens são feitas aqui, mas os EFEITOS colaterais
 * (log de DiceRoll e eventos realtime) só acontecem DEPOIS do commit — ver
 * `publishCollectiveCompletion`. Assim nunca há rolagem "fantasma" no log.
 */

/** Código de erro: a conclusão desta sessão pertence ao fluxo coletivo. */
export const SHORT_REST_COLLECTIVE_COMPLETION_REQUIRED = 'SHORT_REST_COLLECTIVE_COMPLETION_REQUIRED';
/** Código de erro: a solicitação não está mais em andamento. */
export const SHORT_REST_REQUEST_CLOSED = 'SHORT_REST_REQUEST_CLOSED';
/** Tipo da operação de gasto de Dado de Vida em `CharacterOperation`. */
const HIT_DIE_TYPE = 'SHORT_REST_HIT_DIE';

/** Rolagem da Song of Rest a registrar no log DEPOIS do commit. */
export interface PendingSongRoll {
  actorUserId: string;
  actorName: string;
  die: number;
  value: number;
}

/** Ficha alterada pela conclusão, para publicar `sheet:updated` DEPOIS do commit. */
export interface ChangedSheet extends SheetOwner {
  character: Character;
  changes: Record<string, unknown>;
}

/** Resultado interno da conclusão (o que persistir + o que publicar). */
export interface CollectiveCompletionOutcome {
  completion: ShortRestCompletionDto;
  diceToRecord: PendingSongRoll[];
  sheets: ChangedSheet[];
}

/**
 * Executa a conclusão coletiva DENTRO da transação `tx`.
 *
 * Lança em qualquer inconsistência — a transação inteira é revertida, sem
 * curas, recursos ou status parciais (atomicidade).
 */
export async function completeCollectiveShortRest(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<CollectiveCompletionOutcome> {
  const request = await tx.shortRestRequest.findUnique({
    where: { id: requestId },
    include: {
      participants: {
        include: {
          character: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  });

  if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
  if (request.status !== 'APPROVED') {
    throw new HttpError(
      'Este descanso coletivo não está em andamento.',
      409,
      SHORT_REST_REQUEST_CLOSED,
    );
  }

  const accepted = request.participants.filter((participant) => participant.response === 'ACCEPTED');
  const sessions = await tx.shortRestSession.findMany({ where: { shortRestRequestId: requestId } });
  const sessionByCharacter = new Map(sessions.map((session) => [session.characterId, session]));

  // TODOS os ACCEPTED precisam de uma sessão ACTIVE.
  for (const participant of accepted) {
    const session = sessionByCharacter.get(participant.characterId);
    if (!session) {
      throw new HttpError('Falta a sessão de descanso de um participante.', 409);
    }
    if (session.status !== 'ACTIVE') {
      throw new HttpError(
        'Uma sessão do descanso coletivo não está mais ativa.',
        409,
        SHORT_REST_REQUEST_CLOSED,
      );
    }
  }

  // Melhor dado considerando SÓ os Bardos ACCEPTED (não acumula).
  const bestDie = bestSongOfRestDie(
    accepted.map((participant) => bardLevel(normalizeClassEntries(participant.character.classes))),
  );

  const now = new Date();
  const rolls: ShortRestSongRollDto[] = [];
  const diceToRecord: PendingSongRoll[] = [];
  const sheets: ChangedSheet[] = [];
  const completedSessions: { id: string; characterId: string; status: 'COMPLETED' }[] = [];

  for (const participant of accepted) {
    const session = sessionByCharacter.get(participant.characterId)!;
    const character = participant.character;

    // Elegibilidade: ≥ 1 gasto REAL naquela sessão (replay idempotente não conta,
    // porque não cria segunda operação).
    const hitDiceSpent = await tx.characterOperation.count({
      where: { shortRestSessionId: session.id, type: HIT_DIE_TYPE },
    });

    // Recursos de recarga CURTA restaurados (long/none/desconhecidos e os
    // toggles ativos do classState são preservados).
    const nextState = restoreShortRestResources(
      normalizeClassState(character.classState),
      characterClassAdjustments(character).resources,
    );

    const hpBefore = character.hpCurrent;
    let hpAfter = hpBefore;
    if (bestDie !== null && hitDiceSpent > 0) {
      const value = rollDie(bestDie);
      hpAfter = Math.min(characterMaxHp(character), hpBefore + value);
      rolls.push({
        characterId: participant.characterId,
        die: bestDie,
        value,
        hpBefore,
        hpAfter,
        actualHealed: hpAfter - hpBefore,
      });
      diceToRecord.push({
        actorUserId: participant.userId,
        actorName: character.name?.trim() || participant.user.username,
        die: bestDie,
        value,
      });
    }

    // Escrita guardada por VERSÃO: uma rolagem de Dado de Vida concorrente
    // derruba a conclusão inteira (não há update parcial).
    const written = await tx.character.updateMany({
      where: { id: character.id, version: character.version },
      data: {
        hpCurrent: hpAfter,
        classState: nextState as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new HttpError('Uma ficha mudou durante a conclusão do descanso; tente novamente.', 409);
    }
    const updated = await tx.character.findUniqueOrThrow({ where: { id: character.id } });

    // ACTIVE → COMPLETED (transição condicional).
    const closed = await tx.shortRestSession.updateMany({
      where: { id: session.id, status: 'ACTIVE' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    if (closed.count === 0) {
      throw new HttpError(
        'Uma sessão do descanso não está mais ativa.',
        409,
        SHORT_REST_REQUEST_CLOSED,
      );
    }

    completedSessions.push({ id: session.id, characterId: participant.characterId, status: 'COMPLETED' });
    sheets.push({
      userId: participant.userId,
      username: participant.user.username,
      character: updated,
      changes: { hpCurrent: hpAfter, classState: nextState },
    });
  }

  // APPROVED → COMPLETED: só uma transição vence.
  const transitioned = await tx.shortRestRequest.updateMany({
    where: { id: requestId, status: 'APPROVED' },
    data: { status: 'COMPLETED', completedAt: now },
  });
  if (transitioned.count === 0) {
    throw new HttpError(
      'Este descanso coletivo não está em andamento.',
      409,
      SHORT_REST_REQUEST_CLOSED,
    );
  }

  return {
    completion: { songOfRest: { die: bestDie, rolls }, sessions: completedSessions },
    diceToRecord,
    sheets,
  };
}

/**
 * Publica os efeitos da conclusão SÓ DEPOIS do commit.
 *
 * Cada ficha alterada recebe `sheet:updated` pelo mecanismo de sempre; cada
 * rolagem da Song of Rest entra no log (`dice:roll`, kind `rest`); e a mesa é
 * avisada com `short-rest:completed` (payload enxuto). O `short-rest:request-updated`
 * com status COMPLETED é emitido pelo chamador, junto das demais operações.
 */
export async function publishCollectiveCompletion(
  requestId: string,
  outcome: CollectiveCompletionOutcome,
): Promise<void> {
  for (const sheet of outcome.sheets) {
    await publishChange(
      { userId: sheet.userId, username: sheet.username },
      sheet.character,
      sheet.changes,
    );
  }

  for (const roll of outcome.diceToRecord) {
    recordRestSongOfRestRoll({ userId: roll.actorUserId }, roll.actorName, {
      die: roll.die,
      value: roll.value,
    });
  }

  try {
    getBroadcaster().toTable(ServerEvents.SHORT_REST_COMPLETED, {
      requestId,
      completion: outcome.completion,
    });
  } catch (error) {
    console.error('[rest] falha ao publicar a conclusão coletiva em tempo real:', error);
  }
}

