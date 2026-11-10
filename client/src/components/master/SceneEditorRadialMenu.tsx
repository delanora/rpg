import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon';

export interface SceneRadialOption {
  id: string;
  label: string;
  caption: string;
  icon: IconName;
  checked?: boolean;
  disabled?: boolean;
  action: () => void;
}

/** Menu de comandos em pixels de tela; o zoom do mapa nunca muda a área de clique. */
export function SceneEditorRadialMenu({
  point,
  menuId,
  title,
  options,
  onBack,
  onClose,
}: {
  point: { x: number; y: number };
  menuId: string;
  title: string;
  options: SceneRadialOption[];
  onBack?: () => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const pointerOrigin = useRef(point);
  const pointerReady = useRef(false);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const diameter = Math.min(212, viewport.width - 16, viewport.height - 16);
  const left = Math.max(
    8,
    Math.min(point.x - diameter / 2, viewport.width - diameter - 8),
  );
  const top = Math.max(
    8,
    Math.min(point.y - diameter / 2, viewport.height - diameter - 8),
  );
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        previous?.focus({ preventScroll: true });
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        previous?.focus({ preventScroll: true });
        return;
      }
      if (
        !(event.target instanceof Node) ||
        !root.current?.contains(event.target)
      )
        return;
      if (
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      pointerReady.current = false;
      const buttons = [
        ...root.current.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        ),
      ];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const backwards = ['ArrowLeft', 'ArrowUp'].includes(event.key);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : index < 0
              ? backwards
                ? buttons.length - 1
                : 0
              : (index + (backwards ? -1 : 1) + buttons.length) %
                buttons.length;
      buttons[next]?.focus();
      setHighlight(buttons[next]?.dataset.optionId ?? null);
    };
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
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
    root.current?.focus({ preventScroll: true });
    pointerReady.current = false;
    setHighlight(null);
  }, [menuId]);

  const polar = (radius: number, angle: number) =>
    `${50 + Math.cos(angle) * radius}% ${50 + Math.sin(angle) * radius}%`;
  return createPortal(
    <div
      key={menuId}
      ref={root}
      role="menu"
      aria-label={title}
      tabIndex={-1}
      className="scene-editor-radial"
      style={{ left, top, width: diameter, height: diameter }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => {
        if (
          event.pointerType !== 'touch' &&
          Math.hypot(
            event.clientX - pointerOrigin.current.x,
            event.clientY - pointerOrigin.current.y,
          ) > 3
        )
          pointerReady.current = true;
      }}
      onPointerLeave={() => {
        pointerReady.current = false;
        setHighlight(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
        pointerReady.current = false;
        setHighlight(null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {options.map((option, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / options.length;
        const sweep = (Math.PI * 2) / options.length;
        const points: string[] = [];
        const count = Math.max(10, Math.ceil(sweep * 16));
        for (let step = 0; step <= count; step++)
          points.push(polar(49, angle - sweep / 2 + (step / count) * sweep));
        for (let step = count; step >= 0; step--)
          points.push(polar(22, angle - sweep / 2 + (step / count) * sweep));
        const style = {
          '--sector-x': `${Math.cos(angle) * 3}px`,
          '--sector-y': `${Math.sin(angle) * 3}px`,
        } as CSSProperties;
        return (
          <div
            key={option.id}
            className={`scene-editor-radial-sector${highlight === option.id ? ' is-highlighted' : ''}${option.checked ? ' is-checked' : ''}${option.disabled ? ' is-disabled' : ''}`}
            style={style}
          >
            <span
              className="scene-editor-radial-face"
              style={{ clipPath: `polygon(${points.join(',')})` }}
              aria-hidden="true"
            >
              <span
                className="scene-editor-radial-caption"
                aria-hidden="true"
                style={{
                  left: `${50 + Math.cos(angle) * 35}%`,
                  top: `${50 + Math.sin(angle) * 35}%`,
                }}
              >
                <Icon name={option.icon} size={19} />
                <small>{option.caption}</small>
                {option.checked ? (
                  <span className="scene-editor-radial-tick">✓</span>
                ) : null}
              </span>
            </span>
            <button
              type="button"
              role={
                option.checked === undefined ? 'menuitem' : 'menuitemcheckbox'
              }
              aria-label={option.label}
              aria-checked={option.checked}
              disabled={option.disabled}
              data-option-id={option.id}
              style={{ clipPath: `polygon(${points.join(',')})` }}
              onPointerMove={(event) => {
                if (
                  !option.disabled &&
                  event.pointerType !== 'touch' &&
                  (pointerReady.current ||
                    Math.hypot(
                      event.clientX - pointerOrigin.current.x,
                      event.clientY - pointerOrigin.current.y,
                    ) > 3)
                )
                  setHighlight(option.id);
              }}
              onPointerLeave={() => setHighlight(null)}
              onFocus={(event) => {
                if (event.currentTarget.matches(':focus-visible'))
                  setHighlight(option.id);
              }}
              onClick={option.action}
            />
          </div>
        );
      })}
      <svg
        className="scene-editor-radial-dividers"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        {options.map((option, index) => {
          const angle =
            -Math.PI / 2 + ((index - 0.5) * Math.PI * 2) / options.length;
          return (
            <line
              key={option.id}
              x1={50 + Math.cos(angle) * 22.5}
              y1={50 + Math.sin(angle) * 22.5}
              x2={50 + Math.cos(angle) * 48.5}
              y2={50 + Math.sin(angle) * 48.5}
            />
          );
        })}
      </svg>
      <button
        type="button"
        role="menuitem"
        className="scene-editor-radial-center"
        aria-label={onBack ? 'Voltar no menu da cena' : 'Fechar menu da cena'}
        onClick={onBack ?? onClose}
      >
        <strong>
          {options.find((option) => option.id === highlight)?.label ?? title}
        </strong>
        <small>{onBack ? '‹ Voltar' : '× Fechar'}</small>
      </button>
    </div>,
    document.body,
  );
}
