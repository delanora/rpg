import type { ShortRestRequestParticipantDto, ShortRestRequestStatus } from '../types';

/**
 * Lista enxuta dos convidados com o estado de cada um, em linguagem de jogo
 * (nunca os termos técnicos PENDING/ACCEPTED/DECLINED). O personagem do próprio
 * jogador ganha o selo "você".
 */
export function ShortRestParticipants({
  participants,
  status,
  myCharacterId,
}: {
  participants: ShortRestRequestParticipantDto[];
  status: ShortRestRequestStatus;
  myCharacterId?: string;
}) {
  if (participants.length === 0) {
    return <p className="section-note">Ninguém foi convidado para este descanso.</p>;
  }

  return (
    <ul className="short-rest-people">
      {participants.map((participant) => {
        const { mark, label } = describe(participant, status);
        const mine = participant.characterId === myCharacterId;
        return (
          <li key={participant.userId} className={`short-rest-person is-${tone(participant, status)}`}>
            <span className="short-rest-person-mark" aria-hidden="true">
              {mark}
            </span>
            <span className="short-rest-person-name">
              {participant.displayName}
              {mine ? <span className="short-rest-you">você</span> : null}
            </span>
            <span className="short-rest-person-state">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function tone(
  participant: ShortRestRequestParticipantDto,
  status: ShortRestRequestStatus,
): string {
  if (participant.response === 'PENDING') return 'waiting';
  if (participant.response === 'DECLINED') return 'out';
  if (participant.ready) return 'ready';
  if (status === 'COMPLETED') return 'done';
  return status === 'APPROVED' ? 'resting' : 'accepted';
}

function describe(
  participant: ShortRestRequestParticipantDto,
  status: ShortRestRequestStatus,
): { mark: string; label: string } {
  if (participant.response === 'PENDING') return { mark: '…', label: 'Aguardando resposta' };
  if (participant.response === 'DECLINED') return { mark: '✕', label: 'Não participa' };
  if (participant.ready) return { mark: '✓', label: 'Pronto' };
  if (status === 'COMPLETED') return { mark: '✓', label: 'Participou' };
  if (status === 'APPROVED') return { mark: '•', label: 'Descansando' };
  return { mark: '✓', label: 'Participa' };
}
