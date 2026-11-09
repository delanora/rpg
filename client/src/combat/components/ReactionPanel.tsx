import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import type { ReactionOpportunity } from '../reactions';

interface ReactionPanelProps {
  opportunity: ReactionOpportunity;
  busy?: boolean;
  reactorName?: string;
  needsVisibility?: boolean;
  onVisibility?: (visible: boolean) => void;
  /** Escolher uma opção válida resolve a janela (execução futura). */
  onChoose: (optionId: string) => void;
  /** \"Não reagir\" fecha a janela sem gastar a Reação. */
  onDecline: () => void;
}

/**
 * PAINEL CONTEXTUAL DE REAÇÃO — pequeno, temporário e por reactor.
 *
 * NÃO é um painel de turno: não devolve Ação, Ação Bônus, Movimento nem
 * Encerrar Turno. Só aparece quando existe uma `ReactionOpportunity` concreta
 * para ESTE usuário e some ao recusar/resolver. Fora do próprio turno, sem
 * oportunidade, nada é renderizado (nada de \"REAÇÃO DISPONÍVEL\" fixo).
 */
export function ReactionPanel({ opportunity, busy = false, onChoose, onDecline, reactorName, needsVisibility = false, onVisibility }: ReactionPanelProps) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => { if(previous?.isConnected) previous.focus(); };
  }, [opportunity.id, needsVisibility]);
  const panel = <div className="combat-reaction-overlay">

    <section ref={root} tabIndex={-1} className="reaction-panel" aria-label={needsVisibility ? 'Confirmar visão da reação' : 'Reação disponível'} role="alertdialog" aria-modal="true"
      onKeyDown={event => {
        if(event.key === 'Tab') {
          const buttons=[...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          if(buttons.length === 0) { event.preventDefault(); return; }
          if(event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === root.current)) {event.preventDefault();buttons.at(-1)?.focus();}
          else if(!event.shiftKey && document.activeElement === buttons.at(-1)) {event.preventDefault();buttons[0]?.focus();}
        }
      }}>
      <p className="reaction-panel-eyebrow">
        <Icon name="bolt" size={13} /> {needsVisibility ? 'Confirmar visão' : 'Reação disponível'}
      </p>
      {reactorName ? <h3>{reactorName}</h3> : null}
      <p className="reaction-panel-trigger">{opportunity.trigger}</p>

      {needsVisibility ? <div className="reaction-visibility">
        <p>A linha de visão ficou indeterminada. O Mestre confirma se a criatura consegue ver o alvo.</p>
        <div className="combat-risk-actions">
          <button className="btn btn-small" disabled={busy} onClick={() => onVisibility?.(false)}>Não consegue ver</button>
          <button className="btn btn-small" disabled={busy} onClick={() => onVisibility?.(true)}>Consegue ver</button>
        </div>
      </div> : null}
      <div className="reaction-panel-options">
        {opportunity.availableReactions.map((option) => (
          <button
            key={option.id}
            type="button"
            className="reaction-option"
            disabled={busy || needsVisibility}
            onClick={() => onChoose(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      {!needsVisibility ? <button type="button" className="btn btn-small reaction-decline" disabled={busy} onClick={onDecline}>
        Não reagir
      </button> : null}
    </section>
  </div>;
  return typeof document === 'undefined' ? panel : createPortal(panel, document.body);
}
