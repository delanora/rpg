import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';

/** Painel não modal: permanece junto ao ponto clicado e deixa o mapa acessível. */
export function CombatTokenMenu({ name, kind, point, onClose, children, subtitle = 'Ajustes de combate' }: {
  name: string; kind: string; subtitle?: string; point: { x: number; y: number };
  onClose: () => void; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    const node = root.current;
    const measure = () => {
      const rect = node?.getBoundingClientRect();
      if (!rect) return;
      const next = { x: Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8)) };
      setPosition(current => current.x === next.x && current.y === next.y ? current : next);
    };
    measure();
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [point.x, point.y]);
  useEffect(() => {
    const node = root.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Node && root.current?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); onClose(); previous?.focus();
      }
    };
    const resize = () => onClose();
    document.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resize);
      if (document.activeElement instanceof Node && node?.contains(document.activeElement)) previous?.focus();
    };
  }, [onClose, point]);
  return createPortal(<div ref={root} className="combat-token-menu" role="dialog"
    aria-label={`Ajustes de ${name}`} style={{ left: position.x, top: position.y }}
    onContextMenu={event => event.preventDefault()}>
    <header className="combat-token-menu-head">
      <div><span className="combat-token-menu-kind"><Icon name="crown" size={12} /> {kind}</span>
        <h3>{name}</h3><p>{subtitle}</p></div>
      <button ref={closeButton} className="btn btn-small" type="button" aria-label="Fechar ajustes do token" onClick={onClose}>×</button>
    </header>
    {children}
  </div>, document.body);
}
