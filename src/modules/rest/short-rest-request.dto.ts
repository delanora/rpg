import type { ShortRestRequest, ShortRestRequestParticipant } from '@prisma/client';
import { bardLevel, bestSongOfRestDie, normalizeClassEntries } from '../shared/classes.js';

/**
 * DTO da SOLICITAÇÃO coletiva de Descanso Curto.
 *
 * A solicitação é GLOBAL (uma mesa única) e guarda a lista CONGELADA de
 * participantes com a resposta de cada um. Este DTO é o que o frontend recebe
 * (na resposta HTTP e no evento `short-rest:request-updated`) — só o necessário:
 * nenhuma ficha completa, nenhum dado sensível.
 *
 * `songOfRestDie` é DERIVADO: o melhor dado de Canção de Descanso entre os
 * participantes ACEITOS (ACCEPTED), considerando apenas o nível de BARDO de cada
 * um. Nesta etapa ele ainda NÃO cura nada — só é exposto (ver Passo 19/20).
 */

export type ShortRestRequestStatusDto = 'PENDING' | 'APPROVED' | 'CANCELLED';
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
}

export interface ShortRestRequestDto {
  id: string;
  status: ShortRestRequestStatusDto;
  /** Quem solicitou o descanso. */
  requestedBy: ShortRestUserRefDto;
  /** Lista CONGELADA de convidados, com a resposta atual de cada um. */
  participants: ShortRestRequestParticipantDto[];
  createdAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  /** Motivo do cancelamento automático (ex.: `NO_PARTICIPANTS`) ou `null`. */
  cancelReason: string | null;
  /** Mestre que forçou a aprovação (`null` no fluxo normal). */
  forcedByUserId: string | null;
  /**
   * Melhor dado de Canção de Descanso entre os ACCEPTED (`null` quando nenhum
   * Bardo elegível está entre eles). NÃO é rolado nem aplicado nesta etapa.
   */
  songOfRestDie: 6 | 8 | 10 | 12 | null;
}

/** Forma carregada da solicitação usada para montar o DTO. */
export type ShortRestRequestWithParticipants = ShortRestRequest & {
  requestedBy: { id: string; username: string; displayName: string };
  participants: (ShortRestRequestParticipant & {
    user: { id: string; username: string; displayName: string };
    character: { classes: unknown };
  })[];
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
 * Monta o DTO da solicitação. A lista de participantes sai na mesma ordem em que
 * os convidados foram gravados (o solicitante primeiro), para a interface não
 * precisar reordenar.
 */
export function toShortRestRequestDto(request: ShortRestRequestWithParticipants): ShortRestRequestDto {
  const participants = request.participants.map((participant) => ({
    userId: participant.userId,
    username: participant.user.username,
    displayName: participant.user.displayName,
    characterId: participant.characterId,
    response: participant.response,
    respondedAt: ISO(participant.respondedAt),
    closedByMaster: participant.closedByMaster,
  }));
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
    cancelledAt: ISO(request.cancelledAt),
    cancelReason: request.cancelReason,
    forcedByUserId: request.forcedByUserId,
    songOfRestDie: songOfRestDieForAccepted(request.participants),
  };
}
