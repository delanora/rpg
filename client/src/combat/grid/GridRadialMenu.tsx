import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PREVIEW_SHAPES, type PreviewShape } from './areaPreviewGeometry';

/** Somente navegação: inclusão de participantes continua no fluxo autorizado. */
export function GridRadialMenu({
  point,
  canAdd,
  areaDisabled,
  onClose,
  onAdd,
  onArea,
}: {
  point: { x: number; y: number };
  canAdd: boolean;
  areaDisabled: boolean;
  onClose: () => void;
  onAdd: () => void;
  onArea: (shape: PreviewShape) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [areas, setAreas] = useState(false);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const diameter = Math.min(200, size.width - 16, size.height - 16);
  const half = diameter / 2;
  const left = Math.max(8, Math.min(point.x - half, size.width - diameter - 8));
  const top = Math.max(8, Math.min(point.y - half, size.height - diameter - 8));
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        previous?.focus();
        return;
      }
      if (
        !(event.target instanceof Node) ||
        !root.current?.contains(event.target)
      )
        return;
      const buttons = [
        ...root.current.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        ),
      ];
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (
        [
          'ArrowRight',
          'ArrowDown',
          'ArrowLeft',
          'ArrowUp',
          'Home',
          'End',
        ].includes(event.key)
      ) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current +
                  (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }
    };
    const resize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resize);
    };
  }, [onClose]);
  useEffect(() => {
    root.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
  }, [areas]);
  const items = areas
    ? PREVIEW_SHAPES.map((shape) => ({
        label: shape.label,
        symbol: shape.symbol,
        disabled: areaDisabled,
        action: () => onArea(shape.kind),
      }))
    : [
        ...(canAdd
          ? [{ label: 'Encontro', symbol: '⚔', disabled: false, action: onAdd }]
          : []),
        {
          label: 'Áreas',
          symbol: '◎',
          disabled: areaDisabled,
          action: () => setAreas(true),
        },
      ];
  return createPortal(
    <div
      ref={root}
      className="grid-radial-menu"
      role="menu"
      aria-label={areas ? 'Formas de área' : 'Menu do tabuleiro'}
      style={{ left, top, width: diameter, height: diameter }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="grid-radial-ring" aria-hidden="true" />
      {items.map((item, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / items.length;
        const sweep = (2 * Math.PI) / items.length;
        // Fatias reais: toda a superfície entre os raios recebe o clique.
        const arc = (radius: number, reverse = false) =>
          Array.from({ length: 33 }, (_, step) => {
            const phase = reverse ? 1 - step / 32 : step / 32;
            const a = angle - sweep / 2 + sweep * phase;
            return `${50 + Math.cos(a) * radius}% ${50 + Math.sin(a) * radius}%`;
          });
        const polygon = [...arc(49), ...arc(11, true)].join(',');
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="grid-radial-item"
            style={{
              clipPath: `polygon(${polygon})`,
            }}
            onClick={item.action}
          >
            <span
              className="grid-radial-caption"
              style={{
                left: half + Math.cos(angle) * diameter * 0.32,
                top: half + Math.sin(angle) * diameter * 0.32,
              }}
            >
              <span className="grid-radial-symbol" aria-hidden="true">
                {item.symbol}
              </span>
              <span>{item.label}</span>
            </span>
          </button>
        );
      })}
      {items.length > 1 ? <svg className="grid-radial-dividers" viewBox="0 0 100 100" aria-hidden="true">
        {items.map((item, index) => {
          const angle = -Math.PI / 2 + (index - .5) * 2 * Math.PI / items.length;
          return <line key={item.label} x1={50 + Math.cos(angle) * 12} y1={50 + Math.sin(angle) * 12}
            x2={50 + Math.cos(angle) * 48.5} y2={50 + Math.sin(angle) * 48.5} />;
        })}
      </svg> : null}
      <button
        className="grid-radial-center"
        type="button"
        role="menuitem"
        aria-label={
          areas ? 'Voltar ao menu do tabuleiro' : 'Fechar menu do tabuleiro'
        }
        title={areas ? 'Voltar' : 'Fechar'}
        onClick={() => (areas ? setAreas(false) : onClose())}
      >
        <span aria-hidden="true">{areas ? '‹' : '×'}</span>
      </button>
    </div>,
    document.body,
  );
}
