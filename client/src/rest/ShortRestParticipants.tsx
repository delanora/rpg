import type { Character, ShortRestRequestParticipantDto, ShortRestRequestStatus } from '../types';

/**
 * Lista enxuta dos convidados com o estado de cada um, em linguagem de jogo
 * (nunca os termos técnicos PENDING/ACCEPTED/DECLINED). O personagem do próprio
 * jogador ganha o selo "você".
 *
 * 5.2.7B (só apresentação): mesma família visual do Descanso Longo, porém mais
 * compacta — retrato e badge de situação, sem a linha de contribuição.
 */
export function ShortRestParticipants({
  participants,
  status,
  myCharacterId,
  characters,
}: {
  participants: ShortRestRequestParticipantDto[];
  status: ShortRestRequestStatus;
  myCharacterId?: string;
  /** Fichas conhecidas (Mestre: mesa inteira; jogador: a própria). Opcional. */
  characters?: Character[];
}) {
  if (participants.length === 0) {
    return <p className="section-note">Ninguém foi convidado para este descanso.</p>;
  }

  const byId = new Map((characters ?? []).map((entry) => [entry.id, entry]));

  return (
    <ul className="short-rest-people">
      {participants.map((participant) => {
        const { mark, label } = describe(participant, status);
        const mine = participant.characterId === myCharacterId;
        const known = byId.get(participant.characterId);
        const classLine = known ? formatClasses(known) : '';
        return (
          <li key={participant.userId} className={`short-rest-person is-${tone(participant, status)}`}>
            <span className="short-rest-person-avatar" aria-hidden="true">
              {known?.avatarUrl ? (
                <img src={known.avatarUrl} alt="" />
              ) : (
                initialsOf(participant.displayName)
              )}
            </span>
            <span className="short-rest-person-id">
              <span className="short-rest-person-name">
                {participant.displayName}
                {mine ? <span className="short-rest-you">você</span> : null}
              </span>
              {classLine ? <span className="short-rest-person-sub">{classLine}</span> : null}
            </span>
            <span className="short-rest-person-side">
              <span className="short-rest-person-badge">
                <span aria-hidden="true">{mark}</span> {label}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Iniciais do nome (até 2 letras) para o retrato quando não há avatar. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

/** Linha de classe no formato "Guerreiro 6 / Mago 1" (multiclasse incluído). */
function formatClasses(character: Character): string {
  if (character.classes.length > 0) {
    return character.classes.map((entry) => `${entry.className} ${entry.level}`).join(' / ');
  }
  return character.className || '';
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
