import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TipPosition = { top: number; left: number; above: boolean };

/**
 * TOOLTIP FLUTUANTE — compartilhado por CONDIÇÕES e ESTADOS DE TURNO.
 *
 * O popup nasce em PORTAL no `body` e é posicionado em `fixed` a partir do
 * retângulo da etiqueta: nunca é recortado por um ancestral com `overflow` (o
 * painel da iniciativa), não alarga a área rolável dele (era a piscada de barra
 * horizontal) e fica acima de tudo.
 *
 * Ele existe SÓ enquanto o ponteiro/foco está na etiqueta. A cópia inline de
 * cada etiqueta continua no markup (SSR), mas o CSS a mantém oculta — o portal é
 * a única descrição visível.
 */
export function useFloatingTip() {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPosition | null>(null);

  const place = useCallback(() => {
    const anchor = ref.current;
    if (!anchor || typeof window === 'undefined') return;
    const rect = anchor.getBoundingClientRect();
    // Alinhado à esquerda da etiqueta; o ajuste da borda direita depende da
    // largura REAL do popup e é feito depois de montar (ver `FloatingTip`).
    const left = Math.max(8, rect.left);
    const above = rect.bottom + 200 > window.innerHeight;
    setPos({ top: above ? rect.top - 6 : rect.bottom + 6, left, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onMove = (): void => place();
    // `capture` pega a rolagem de qualquer ancestral (o painel da iniciativa).
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  return {
    ref,
    open,
    pos,
    show: (): void => setOpen(true),
    hide: (): void => setOpen(false),
  };
}

/**
 * O popup em si. `data` leva o TOM (condição/estado) até o CSS, já que o portal
 * mora fora da etiqueta e não herdaria `--condition-accent`/`--combat-state-*`.
 */
export function FloatingTip({ pos, className, data, children }: {
  pos: TipPosition | null;
  className: string;
  data?: Record<string, string>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  // A largura acompanha o CONTEÚDO, então só dá para saber se ele cabe à
  // direita depois de montar: aqui o popup é preso à viewport, sem cortar.
  useEffect(() => {
    const element = ref.current;
    if (!element || !pos || typeof window === 'undefined') return;
    setLeft(Math.max(8, Math.min(pos.left, window.innerWidth - element.offsetWidth - 8)));
  }, [pos, children]);

  if (!pos) return null;
  return createPortal(
    <span
      ref={ref}
      className={className}
      role="tooltip"
      {...(data ?? {})}
      style={{
        top: `${pos.top}px`,
        left: `${left ?? pos.left}px`,
        transform: pos.above ? 'translateY(-100%)' : undefined,
      }}
    >
      {children}
    </span>,
    document.body,
  );
}
