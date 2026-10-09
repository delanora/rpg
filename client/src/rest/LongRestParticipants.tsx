import type { LongRestRequestDto } from '../types';

/**
 * Lista enxuta dos convidados do Descanso Longo, em linguagem de jogo (nunca os
 * termos técnicos PENDING/ACCEPTED/DECLINED). Diferente do Descanso Curto, o
 * Long Rest tem etapas: enquanto a solicitação está aberta vale a resposta de
 * cada um; depois de aprovada, só os que aceitaram são participantes EFETIVOS e
 * quem recusou vai para uma nota secundária (nunca é listado como beneficiado).
 *
 * O personagem do próprio jogador ganha o selo "você".
 */
export function LongRestParticipants({
  request,
  myCharacterId,
}: {
  request: LongRestRequestDto;
  myCharacterId?: string;
}) {
  const { participants, status } = request;

  if (participants.length === 0) {
    return <p className="section-note">Ninguém foi convidado para este descanso.</p>;
  }

  // Depois de aprovado, quem não aceitou deixa de ser participante efetivo.
  const effective =
    status === 'APPROVED' || status === 'COMPLETED'
      ? participants.filter((participant) => participant.response === 'ACCEPTED')
      : participants;
  const declined = participants.filter((participant) => participant.response === 'DECLINED');

  return (
    <>
      <ul className="short-rest-people">
        {effective.map((participant) => {
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

      {/* Fora do descanso: nem benefício, nem lista de efetivos. */}
      {(status === 'APPROVED' || status === 'COMPLETED') && declined.length > 0 ? (
        <p className="section-note">
          Não participam deste descanso: {declined.map((participant) => participant.displayName).join(', ')}.
        </p>
      ) : null}
    </>
  );
}

function tone(
  participant: LongRestRequestDto['participants'][number],
  status: LongRestRequestDto['status'],
): string {
  if (participant.response === 'PENDING') return 'waiting';
  if (participant.response === 'DECLINED') return 'out';
  if (status === 'CANCELLED') return 'out';
  if (participant.ready) return 'ready';
  if (status === 'COMPLETED') return 'done';
  return status === 'APPROVED' ? 'resting' : 'accepted';
}

function describe(
  participant: LongRestRequestDto['participants'][number],
  status: LongRestRequestDto['status'],
): { mark: string; label: string } {
  if (status === 'CANCELLED') {
    return participant.response === 'ACCEPTED'
      ? { mark: '✓', label: 'Participava' }
      : { mark: '✕', label: 'Não participa' };
  }
  if (participant.response === 'PENDING') return { mark: '…', label: 'Aguardando resposta' };
  if (participant.response === 'DECLINED') return { mark: '✕', label: 'Não participa' };
  if (participant.ready) return { mark: '✓', label: 'Pronto' };
  if (status === 'COMPLETED') return { mark: '✓', label: 'Participou' };
  if (status === 'APPROVED') return { mark: '•', label: 'Preparando-se' };
  return { mark: '✓', label: 'Participando' };
}
