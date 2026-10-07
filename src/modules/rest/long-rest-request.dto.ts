import type { LongRestRequest, LongRestRequestParticipant, LongRestSession } from '@prisma/client';

/**
 * DTO da SOLICITAÇÃO coletiva de Descanso Longo.
 *
 * A solicitação é GLOBAL (uma mesa única) e guarda a lista CONGELADA de
 * participantes com a resposta de cada um. Este DTO é o que o frontend recebe
 * (na resposta HTTP e no evento `long-rest:request-updated`) — só o necessário:
 * nenhuma ficha completa.
 *
 * Ciclo de status: `PENDING → APPROVED` (sessões criadas para os ACCEPTED) ou
 * `PENDING → CANCELLED`. `COMPLETED` existe no enum para a próxima etapa
 * (aplicação dos benefícios), mas NESTA etapa nenhuma solicitação chega lá.
 *
 * NENHUM benefício de descanso é calculado aqui: a sessão só registra que o
 * personagem entrou no descanso.
 */

export type LongRestRequestStatusDto = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';
export type LongRestResponseDto = 'PENDING' | 'ACCEPTED' | 'DECLINED';

/** Referência mínima de um usuário (quem pediu / quem é convidado). */
export interface LongRestUserRefDto {
  userId: string;
  username: string;
  displayName: string;
}

export interface LongRestRequestParticipantDto {
  userId: string;
  username: string;
  displayName: string;
  characterId: string;
  response: LongRestResponseDto;
  respondedAt: string | null;
  /**
   * Verdadeiro quando o MESTRE fechou a resposta no force-approve (PENDING →
   * DECLINED). NUNCA indica aceitação.
   */
  closedByMaster: boolean;
  /**
   * Id da SESSÃO de Descanso Longo deste participante (`null` enquanto a
   * solicitação está PENDING ou quando ele recusou). É o vínculo persistente
   * criado na aprovação — ainda sem benefícios aplicados.
   */
  sessionId: string | null;
}

export interface LongRestRequestDto {
  id: string;
  status: LongRestRequestStatusDto;
  /** Quem solicitou o descanso. */
  requestedBy: LongRestUserRefDto;
  /** Lista CONGELADA de convidados, com a resposta atual de cada um. */
  participants: LongRestRequestParticipantDto[];
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Motivo do cancelamento automático (ex.: `NO_PARTICIPANTS`) ou `null`. */
  cancelReason: string | null;
  /** Mestre que forçou a aprovação (`null` no fluxo normal). */
  forcedByUserId: string | null;
}

/** Forma carregada da solicitação usada para montar o DTO. */
export type LongRestRequestWithParticipants = LongRestRequest & {
  requestedBy: { id: string; username: string; displayName: string };
  participants: (LongRestRequestParticipant & {
    user: { id: string; username: string; displayName: string };
  })[];
  sessions: Pick<LongRestSession, 'id' | 'characterId'>[];
};

const ISO = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Monta o DTO da solicitação. O `sessionId` de cada participante sai da SESSÃO
 * daquele personagem (a fonte real é a sessão; o participante só existe para
 * todos os convidados).
 */
export function toLongRestRequestDto(
  request: LongRestRequestWithParticipants,
): LongRestRequestDto {
  const sessionByCharacter = new Map(
    request.sessions.map((session) => [session.characterId, session]),
  );

  const participants = request.participants.map((participant) => {
    const session =
      participant.response === 'ACCEPTED'
        ? sessionByCharacter.get(participant.characterId) ?? null
        : null;
    return {
      userId: participant.userId,
      username: participant.user.username,
      displayName: participant.user.displayName,
      characterId: participant.characterId,
      response: participant.response,
      respondedAt: ISO(participant.respondedAt),
      closedByMaster: participant.closedByMaster,
      sessionId: session?.id ?? null,
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
  };
}
