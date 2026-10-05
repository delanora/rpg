import type { ReactNode } from 'react';

interface CombatDashboardProps {
  /** Esquerda: linha de iniciativa. */
  left: ReactNode;
  /** Centro: turno atual, estado e ações. */
  center: ReactNode;
  /** Direita: log/eventos. */
  right: ReactNode;
  /** Rodapé persistente (barra de recursos do turno). */
  bottom?: ReactNode;
}

/**
 * Apenas o arranjo visual do combate: iniciativa à esquerda, turno/ações no
 * centro, log à direita e a barra de recursos abaixo. Não guarda estado nem
 * conhece as regras — toda a orquestração continua no CombatTracker.
 */
export function CombatDashboard({ left, center, right, bottom }: CombatDashboardProps) {
  return (
    <>
      <div className="combat-dashboard">
        <div className="combat-col combat-col-left">{left}</div>
        <div className="combat-col combat-col-center">{center}</div>
        <div className="combat-col combat-col-right">{right}</div>
      </div>
      {bottom ? <div className="combat-bottom">{bottom}</div> : null}
    </>
  );
}
