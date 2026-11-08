import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Confirma apenas a intenção; o commit volta a validar caminho e reações no servidor. */
export function MovementRiskDialog({ onAnswer }: { onAnswer: (continueMoving: boolean) => void }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if(previous?.isConnected) previous.focus(); };
  }, []);
  const panel = <div className="combat-reaction-overlay">
    <section ref={root} className="combat-risk-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="movement-risk-title" aria-describedby="movement-risk-description"
      onKeyDown={event => {
        if(event.key === 'Escape') {event.stopPropagation(); onAnswer(false);}
        if(event.key === 'Tab') {
          const buttons=[...root.current!.querySelectorAll('button')];
          if(event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
          if(!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
      <h3 id="movement-risk-title">Sair da área de ameaça?</h3>
      <p id="movement-risk-description">Este movimento pode provocar ataque de oportunidade.</p>
      <div className="combat-risk-actions">
        <button className="btn btn-small" onClick={() => onAnswer(false)}>Rever caminho</button>
        <button className="btn btn-small" onClick={() => onAnswer(true)}>Continuar</button>
      </div>
    </section>
  </div>;
  return typeof document === 'undefined' ? panel : createPortal(panel, document.body);
}
