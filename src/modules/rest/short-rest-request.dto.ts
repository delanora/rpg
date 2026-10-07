import type {
  ShortRestRequest,
  ShortRestRequestParticipant,
  ShortRestSession,
} from '@prisma/client';
import { bardLevel, bestSongOfRestDie, normalizeClassEntries } from '../shared/classes.js';

/**
 * DTO da SOLICITAÇÃO coletiva de Descanso Curto.
 *
 * A solicitação é GLOBAL (uma mesa única) e guarda a lista CONGELADA de
 * participantes com a resposta e o estado de prontidão de cada um. Este DTO é o
 * que o frontend recebe (na resposta HTTP e no evento
 * `short-rest:request-updated`) — só o necessário: nenhuma ficha completa.
 *
 * Ciclo de status: `PENDING → APPROVED → COMPLETED` (ou `PENDING → CANCELLED`).
 * APPROVED = participantes definidos e sessões em andamento; COMPLETED = o
 * descanso coletivo terminou (todas as sessões concluídas).
 *
 * `songOfRestDie` é DERIVADO: o melhor dado de Canção de Descanso entre os
 * participantes ACEITOS, considerando apenas o nível de BARDO de cada um.
 */

export type ShortRestRequestStatusDto = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';
export type ShortRestResponseDto = 'PENDING' | 'ACCEPTED' | 'DECLINED';

/** Referência mínima de um usuário (quem pediu / quem é convidado). */
export interface ShortRestUserRefDto {
  userId: string;
  username: string;
  displayName: string;
}

export interface ShortRestRequestParticipantDto {
  userId: string;
  username: string;
  displayName: string;
  characterId: string;
  response: ShortRestResponseDto;
  respondedAt: string | null;
  /**
   * Verdadeiro quando o MESTRE fechou a resposta no force-approve (PENDING →
   * DECLINED). NUNCA indica aceitação.
   */
  closedByMaster: boolean;
  /** Marcou "pronto para finalizar" (só existe em participante ACCEPTED). */
  ready: boolean;
  readyAt: string | null;
}

export interface ShortRestRequestDto {
  id: string;
  status: ShortRestRequestStatusDto;
  /** Quem solicitou o descanso. */
  requestedBy: ShortRestUserRefDto;
  /** Lista CONGELADA de convidados, com resposta e prontidão atuais. */
  participants: ShortRestRequestParticipantDto[];
  createdAt: string;
  approvedAt: string | null;
  /** Quando o descanso coletivo TERMINOU (todas as sessões concluídas). */
  completedAt: string | null;
  cancelledAt: string | null;
  /** Motivo do cancelamento automático (ex.: `NO_PARTICIPANTS`) ou `null`. */
  cancelReason: string | null;
  /** Mestre que forçou a aprovação (`null` no fluxo normal). */
  forcedByUserId: string | null;
  /**
   * Melhor dado de Canção de Descanso entre os ACCEPTED (`null` quando nenhum
   * Bardo elegível está entre eles).
   */
  songOfRestDie: 6 | 8 | 10 | 12 | null;
}

/** Uma rolagem INDIVIDUAL da Canção de Descanso de um destinatário. */
export interface ShortRestSongRollDto {
  characterId: string;
  die: number;
  /** Resultado natural do dado (sem modificador). */
  value: number;
  hpBefore: number;
  hpAfter: number;
  /** Cura efetivamente aplicada (pode ser menor por causa do teto de PV). */
  actualHealed: number;
}

/** Resultado da conclusão coletiva. */
export interface ShortRestCompletionDto {
  songOfRest: {
    die: 6 | 8 | 10 | 12 | null;
    /** Uma rolagem por personagem elegível (≥ 1 Dado de Vida gasto). */
    rolls: ShortRestSongRollDto[];
  };
  sessions: { id: string; characterId: string; status: 'COMPLETED' }[];
}

/** Forma carregada da solicitação usada para montar o DTO. */
export type ShortRestRequestWithParticipants = ShortRestRequest & {
  requestedBy: { id: string; username: string; displayName: string };
  participants: (ShortRestRequestParticipant & {
    user: { id: string; username: string; displayName: string };
    character: { classes: unknown };
  })[];
  sessions: Pick<ShortRestSession, 'characterId' | 'readyAt'>[];
};

const ISO = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Melhor dado de Canção de Descanso apenas entre os participantes ACEITOS. */
export function songOfRestDieForAccepted(
  participants: readonly { response: string; character: { classes: unknown } }[],
): 6 | 8 | 10 | 12 | null {
  const bardLevels = participants
    .filter((participant) => participant.response === 'ACCEPTED')
    .map((participant) => bardLevel(normalizeClassEntries(participant.character.classes)));
  return bestSongOfRestDie(bardLevels);
}

/**
 * Monta o DTO da solicitação. A prontidão sai da SESSÃO daquele personagem (a
 * fonte real é a sessão; o participante só existe para todos os convidados).
 */
export function toShortRestRequestDto(request: ShortRestRequestWithParticipants): ShortRestRequestDto {
  const readyByCharacter = new Map(
    request.sessions.map((session) => [session.characterId, session.readyAt]),
  );

  const participants = request.participants.map((participant) => {
    const readyAt = participant.response === 'ACCEPTED'
      ? readyByCharacter.get(participant.characterId) ?? null
      : null;
    return {
      userId: participant.userId,
      username: participant.user.username,
      displayName: participant.user.displayName,
      characterId: participant.characterId,
      response: participant.response,
      respondedAt: ISO(participant.respondedAt),
      closedByMaster: participant.closedByMaster,
      ready: readyAt !== null,
      readyAt: ISO(readyAt),
    };
  });
  // Ordem estável para a interface: quem solicitou primeiro, depois por nome.
  participants.sort((a, b) => {
    if (a.userId === request.requestedBy.id) return -1;
    if (b.userId === request.requestedBy.id) return 1;
    return a.username.localeCompare(b.username);
  });

  return {
    id: request.id,
    status: request.status,
    requestedBy: {
      userId: request.requestedBy.id,
      username: request.requestedBy.username,
      displayName: request.requestedBy.displayName,
    },
    participants,
    createdAt: request.createdAt.toISOString(),
    approvedAt: ISO(request.approvedAt),
    completedAt: ISO(request.completedAt),
    cancelledAt: ISO(request.cancelledAt),
    cancelReason: request.cancelReason,
    forcedByUserId: request.forcedByUserId,
    songOfRestDie: songOfRestDieForAccepted(request.participants),
  };
}
