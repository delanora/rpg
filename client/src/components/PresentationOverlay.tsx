import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Presentation } from '../types';
import { Icon } from './Icon';

interface PresentationOverlayProps {
  presentation: Presentation | null;
  /** O mestre vê o botão de fechar; o jogador só assiste. */
  isMaster: boolean;
  onClose: () => void;
}

/**
 * Imagem que o mestre está mostrando para a mesa: cobre a tela inteira, no
 * centro, com o fundo escurecido. Só o mestre consegue fechar — é ele quem
 * decide por quanto tempo a imagem fica no ar.
 */
export function PresentationOverlay({ presentation, isMaster, onClose }: PresentationOverlayProps) {
  useEffect(() => {
    if (!presentation) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // O mestre também pode fechar com Esc; para o jogador, Esc não faz nada.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isMaster && event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [presentation, isMaster, onClose]);

  if (!presentation) return null;

  return createPortal(
    <div className="presentation-screen" role="dialog" aria-modal="true">
      <div className="presentation-frame">
        <img
          className="presentation-image"
          src={presentation.imageUrl}
          alt={presentation.alt || 'Imagem mostrada pelo mestre'}
        />
        {presentation.alt ? <p className="presentation-caption">{presentation.alt}</p> : null}
      </div>

      <div className="presentation-bar">
        <span className="presentation-hint">
          {isMaster
            ? `mostrando para os jogadores · ${presentation.presentedBy}`
            : 'o mestre está mostrando esta imagem'}
        </span>

        {isMaster ? (
          <button type="button" className="btn btn-small" onClick={onClose}>
            <Icon name="x" size={14} /> fechar imagem
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
