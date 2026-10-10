import type { Character, LongRestRequestDto } from '../types';

/**
 * Lista dos convidados do Descanso Longo, em linguagem de jogo (nunca os termos
 * técnicos PENDING/ACCEPTED/DECLINED). Diferente do Descanso Curto, o Long Rest
 * tem etapas: enquanto a solicitação está aberta vale a resposta de cada um;
 * depois de aprovada, só os que aceitaram são participantes EFETIVOS e quem
 * recusou vai para uma nota secundária (nunca é listado como beneficiado).
 *
 * O personagem do próprio jogador ganha o selo "você".
 *
 * 5.2.7B (só apresentação): quando a ficha é conhecida (`characters`), o
 * participante ganha retrato e a linha de classe — dando presença aos
 * personagens em vez de só o nome. Sem a ficha, cai nas iniciais do nome. A
 * `contributions` (characterId → recursos) é opcional e só aparece na visão
 * coletiva que já tem esse dado.
 */
export function LongRestParticipants({
  request,
  myCharacterId,
  characters,
  contributions,
}: {
  request: LongRestRequestDto;
  myCharacterId?: string;
  /** Fichas conhecidas (Mestre: mesa inteira; jogador: a própria). Opcional. */
  characters?: Character[];
  /** characterId → recursos de acampamento contribuídos (visão coletiva). */
  contributions?: Record<string, number>;
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

  const byId = new Map((characters ?? []).map((entry) => [entry.id, entry]));

  return (
    <>
      <ul className="short-rest-people">
        {effective.map((participant) => {
          const { mark, label } = describe(participant, status);
          const mine = participant.characterId === myCharacterId;
          const known = byId.get(participant.characterId);
          const classLine = known ? formatClasses(known) : '';
          const points = contributions?.[participant.characterId];
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
                {points !== undefined ? (
                  <span className="short-rest-person-contrib">
                    Contribuição: {points} recurso{points === 1 ? '' : 's'}
                  </span>
                ) : null}
              </span>
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
