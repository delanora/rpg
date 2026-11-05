import type { DragEvent } from 'react';
import { SIZE_LABELS } from './gridMath';
import type { GridUnit } from './GridToken';

export interface UnplacedCombatantsTrayProps {
  combatants: GridUnit[];
  selectedId?: string | null;
  pendingId?: string | null;
  /** Somente o Mestre recebe a bandeja interativa. */
  interactive?: boolean;
  onSelect?: (combatantId: string) => void;
}

/** Tipos de arraste usados para o placement administrativo (HTML5 DnD). */
export const GRID_DRAG_MIME = 'application/x-obsyrium-combatant';

function dragStart(event: DragEvent<HTMLElement>, combatantId: string): void {
  event.dataTransfer.setData(GRID_DRAG_MIME, combatantId);
  event.dataTransfer.setData('text/plain', combatantId);
  event.dataTransfer.effectAllowed = 'move';
}

/**
 * UNPLACED (`position: null`) nunca vira 0,0 no grid: fica nesta bandeja.
 *
 * O DTO já omite combatentes privados (`spatial: null`), então a bandeja não
 * cria vazamento: ela lista apenas o que o servidor autorizou.
 */
export function UnplacedCombatantsTray({
  combatants,
  selectedId = null,
  pendingId = null,
  interactive = false,
  onSelect,
}: UnplacedCombatantsTrayProps) {
  if (combatants.length === 0) return null;

  return (
    <div className="grid-tray" aria-label="Unidades fora do mapa">
      <span className="grid-tray-title">Fora do mapa</span>
      <ul className="grid-tray-list">
        {combatants.map((combatant) => {
          const pending = combatant.id === pendingId;
          const selected = combatant.id === selectedId;
          const size = combatant.spatial?.effectiveSize ?? 'medium';
          return (
            <li key={combatant.id}>
              <button
                type="button"
                className={`grid-tray-item${selected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}`}
                draggable={interactive && !pending}
                onDragStart={
                  interactive ? (event) => dragStart(event, combatant.id) : undefined
                }
                disabled={!interactive || pending}
                aria-pressed={selected}
                title={`${combatant.name} · ${SIZE_LABELS[size]}`}
                onClick={interactive && onSelect ? () => onSelect(combatant.id) : undefined}
              >
                <span className="grid-tray-art">
                  {combatant.spatial?.tokenImageRef ? (
                    <img src={combatant.spatial.tokenImageRef} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true">?</span>
                  )}
                </span>
                <span className="grid-tray-name">{combatant.name}</span>
                <span className="grid-tray-size">{SIZE_LABELS[size]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
