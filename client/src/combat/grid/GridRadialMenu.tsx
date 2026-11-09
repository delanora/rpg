import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PREVIEW_SHAPES, type PreviewShape } from './areaPreviewGeometry';

type WheelIconName = PreviewShape | 'encounter' | 'areas';
function WheelIcon({ name }: { name: WheelIconName }) {
  if (name === 'encounter' || name === 'areas')
    return <Icon name={name === 'encounter' ? 'sword' : 'sparkle'} size={15} />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'sphere' ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <ellipse cx="12" cy="12" rx="3.5" ry="8" />
          <path d="M4 12h16" />
        </>
      ) : name === 'cone' ? (
        <>
          <path d="M4 19 12 3l8 16" />
          <ellipse cx="12" cy="19" rx="8" ry="2" />
        </>
      ) : name === 'line' ? (
        <>
          <path d="M3 8v8M21 8v8M3 12h18M17 9l4 3-4 3" />
        </>
      ) : name === 'cube' ? (
        <>
          <path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" />
        </>
      ) : (
        <>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 4 16 4 16 0V5M4 17c0 4 16 4 16 0" />
        </>
      )}
    </svg>
  );
}

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
  const [pointerReady, setPointerReady] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const pointerOrigin = useRef(point);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const diameter = Math.min(115, size.width - 16, size.height - 16);
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
        setPointerReady(false);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : current < 0
                ? ['ArrowLeft', 'ArrowUp'].includes(event.key)
                  ? buttons.length - 1
                  : 0
                : (current +
                    (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
        buttons[next]?.focus();
        setHighlight(
          buttons[next]?.classList.contains('grid-radial-item')
            ? buttons[next].getAttribute('aria-label')
            : null,
        );
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
    // O menu recebe foco, sem destacar uma opção antes da escolha.
    root.current?.focus({ preventScroll: true });
    setPointerReady(false);
    setHighlight(null);
  }, [areas]);
  const items = areas
    ? PREVIEW_SHAPES.map((shape) => ({
        label: shape.label,
        icon: shape.kind as WheelIconName,
        disabled: areaDisabled,
        action: () => onArea(shape.kind),
      }))
    : [
        ...(canAdd
          ? [
              {
                label: 'Encontro',
                icon: 'encounter' as WheelIconName,
                disabled: false,
                action: onAdd,
              },
            ]
          : []),
        {
          label: 'Áreas',
          icon: 'areas' as WheelIconName,
          disabled: areaDisabled,
          action: () => setAreas(true),
        },
      ];
  return createPortal(
    <div
      ref={root}
      className={`grid-radial-menu${pointerReady ? ' is-pointer-active' : ''}`}
      tabIndex={-1}
      role="menu"
      aria-label={areas ? 'Formas de área' : 'Menu do tabuleiro'}
      style={{ left, top, width: diameter, height: diameter }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        if (
          Math.hypot(
            event.clientX - pointerOrigin.current.x,
            event.clientY - pointerOrigin.current.y,
          ) > 2
        )
          setPointerReady(true);
      }}
      onPointerLeave={() => {
        setPointerReady(false);
        setHighlight(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
        setPointerReady(false);
        setHighlight(null);
      }}
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
            const a = angle - sweep / 2 + 0.008 + (sweep - 0.016) * phase;
            return `${50 + Math.cos(a) * radius}% ${50 + Math.sin(a) * radius}%`;
          });
        const polygon = [...arc(49), ...arc(24, true)].join(',');
        return (
          <div
            key={item.label}
            className="grid-radial-sector"
            style={
              {
                '--radial-shift-x': `${Math.cos(angle) * 3}px`,
                '--radial-shift-y': `${Math.sin(angle) * 3}px`,
              } as CSSProperties
            }
          >
            <span
              className="grid-radial-face"
              style={{ clipPath: `polygon(${polygon})` }}
              aria-hidden="true"
            >
              <span
                className="grid-radial-caption"
                style={{
                  left: half + Math.cos(angle) * diameter * 0.37,
                  top: half + Math.sin(angle) * diameter * 0.37,
                }}
              >
                <span className="grid-radial-symbol">
                  <WheelIcon name={item.icon} />
                </span>
              </span>
            </span>
            <button
              type="button"
              role="menuitem"
              aria-label={item.label}
              onPointerMove={(event) => {
                if (item.disabled || event.pointerType === 'touch') return;
                if (
                  pointerReady ||
                  Math.hypot(
                    event.clientX - pointerOrigin.current.x,
                    event.clientY - pointerOrigin.current.y,
                  ) > 2
                )
                  setHighlight(item.label);
              }}
              onPointerLeave={() => setHighlight(null)}
              onFocus={(event) => {
                if (event.currentTarget.matches(':focus-visible'))
                  setHighlight(item.label);
              }}
              disabled={item.disabled}
              className="grid-radial-item"
              style={{ clipPath: `polygon(${polygon})` }}
              onClick={item.action}
            />
          </div>
        );
      })}
      {items.length > 1 ? (
        <svg
          className="grid-radial-dividers"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          {items.map((item, index) => {
            const angle =
              -Math.PI / 2 + ((index - 0.5) * 2 * Math.PI) / items.length;
            return (
              <line
                key={item.label}
                x1={50 + Math.cos(angle) * 25}
                y1={50 + Math.sin(angle) * 25}
                x2={50 + Math.cos(angle) * 48.5}
                y2={50 + Math.sin(angle) * 48.5}
              />
            );
          })}
        </svg>
      ) : null}
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
        <span className="grid-radial-title" aria-hidden="true">
          {highlight ?? (areas ? 'Áreas' : 'Mesa')}
        </span>
        <span className="grid-radial-center-hint" aria-hidden="true">
          {areas ? '‹ Voltar' : '× Fechar'}
        </span>
      </button>
    </div>,
    document.body,
  );
}
