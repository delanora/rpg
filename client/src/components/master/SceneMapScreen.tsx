import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { formatSceneMeters } from '../../sceneUnits';
import type { Scene } from '../../types';

/** Tela exclusiva do mapa; a câmera e os rascunhos continuam no editor existente. */
export function SceneMapScreen({
  scene,
  locked,
  onClose,
  children,
}: {
  scene: Scene;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current
      ?.querySelector<HTMLElement>('.scene-map-canvas')
      ?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={root}
      className="scene-map-screen"
      role="dialog"
      aria-modal="true"
      aria-label={`Editor do mapa — ${scene.name}`}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab') return;
        const menu =
          event.target instanceof Element
            ? event.target.closest('[role="menu"]')
            : null;
        const scope = menu ?? root.current;
        const items = [
          ...(scope?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
          ) ?? []),
        ].filter((node) => node.getClientRects().length > 0);
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (
          current < 0 ||
          (event.shiftKey && current === 0) ||
          (!event.shiftKey && current === items.length - 1)
        ) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0]?.focus({
            preventScroll: true,
          });
        }
      }}
    >
      <header className="scene-map-screen-header">
        <div>
          <span className="scene-map-screen-kicker">Editor de mapa</span>
          <h2>{scene.name}</h2>
        </div>
        <span className="scene-map-screen-dimensions">
          {formatSceneMeters(scene.spatialConfig.widthFeet)} ×{' '}
          {formatSceneMeters(scene.spatialConfig.heightFeet)}
        </span>
        <button
          type="button"
          className="btn btn-small"
          disabled={locked}
          onClick={onClose}
          title={
            locked
              ? 'Salve ou cancele a edição antes de voltar.'
              : 'Voltar às configurações da cena'
          }
        >
          <Icon name="x" size={15} /> Voltar às configurações
        </button>
      </header>
      <div className="scene-map-screen-body">{children}</div>
    </div>,
    document.body,
  );
}
