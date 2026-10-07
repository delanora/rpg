import { Icon } from '../components/Icon';
import type { ShortRestRequestDto } from '../types';

/**
 * Banner de decisão pendente (Passo 5): quando a mesa abre um Descanso Curto e
 * este jogador ainda não respondeu, ele percebe sem precisar procurar o botão.
 * Some sozinho assim que a resposta é dada (o estado vem do realtime).
 */
export function ShortRestNotice({
  request,
  characterId,
  onOpen,
}: {
  request: ShortRestRequestDto | null;
  characterId?: string;
  onOpen: () => void;
}) {
  if (!request || request.status !== 'PENDING') return null;
  const me = request.participants.find((participant) => participant.characterId === characterId);
  if (!me || me.response !== 'PENDING') return null;

  return (
    <div className="banner banner-info">
      <span className="banner-line">
        <Icon name="flame" size={15} /> {request.requestedBy.displayName} propôs um Descanso Curto —
        responda se vai participar.
      </span>
      <button type="button" className="btn btn-small" onClick={onOpen}>
        abrir
      </button>
    </div>
  );
}
