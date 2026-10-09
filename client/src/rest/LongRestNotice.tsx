import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import type { LongRestRequestDto } from '../types';

/**
 * Banner do Descanso Longo coletivo.
 *
 * Cobre os DOIS momentos em que o jogador precisa agir sem procurar o botão:
 *  1. a mesa propôs o descanso e ele ainda não respondeu (PENDING);
 *  2. o descanso começou, ele participa e ainda não marcou "pronto".
 *
 * Some sozinho assim que a ação é tomada (o estado vem do realtime).
 */
export function LongRestNotice({
  request,
  characterId,
  onOpen,
}: {
  request: LongRestRequestDto | null;
  characterId?: string;
  onOpen: () => void;
}): ReactElement | null {
  if (!request || !characterId) return null;

  const me = request.participants.find((participant) => participant.characterId === characterId);
  if (!me) return null;

  // 1. Convite aguardando resposta.
  if (request.status === 'PENDING' && me.response === 'PENDING') {
    return (
      <div className="banner banner-info">
        <span className="banner-line">
          <Icon name="moon" size={15} /> {request.requestedBy.displayName} propôs um Descanso
          Longo — responda se vai participar.
        </span>
        <button type="button" className="btn btn-small" onClick={onOpen}>
          abrir
        </button>
      </div>
    );
  }

  // 2. Descanso em andamento: falta o "pronto" pessoal.
  if (request.status === 'APPROVED' && me.response === 'ACCEPTED' && !me.ready) {
    return (
      <div className="banner banner-info">
        <span className="banner-line">
          <Icon name="moon" size={15} /> O Descanso Longo está em andamento — marque que você está
          pronto para descansar.
        </span>
        <button type="button" className="btn btn-small" onClick={onOpen}>
          abrir
        </button>
      </div>
    );
  }

  return null;
}
