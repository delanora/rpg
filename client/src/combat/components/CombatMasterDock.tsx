import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';

type Panel = 'actions' | 'adjustments';

/** Apresentação do Mestre; preserva os mesmos formulários, callbacks e permissões. */
export function CombatMasterDock({ action, masterTools, tools, resourceBar, inventory, turnKey }: {
  action: ReactNode; masterTools?: ReactNode; tools?: ReactNode;
  resourceBar?: ReactNode; inventory?: ReactNode; turnKey?: string;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const adjustmentsButton = useRef<HTMLButtonElement>(null);
  const previousTurn = useRef(turnKey);
  const id = useId();

  function close(restoreFocus: boolean) {
    setPanel(null);
    if (restoreFocus) (panel === 'actions' ? actionsButton : adjustmentsButton).current?.focus();
  }

  useEffect(() => {
    if (previousTurn.current !== turnKey) { previousTurn.current = turnKey; setPanel(null); }
  }, [turnKey]);

  useEffect(() => {
    if (!panel) return;
    surface.current?.querySelector<HTMLButtonElement>('.combat-master-panel-close')?.focus();
    const pointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setPanel(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Node && surface.current?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); close(true);
      }
    };
    document.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [panel]);

  return <div className="combat-master-dock" ref={root}>
    {resourceBar ? <div className="combat-master-resources">{resourceBar}</div> : null}
    <div className="combat-master-toolbar" aria-label="Controles do Mestre">
      <span className="combat-master-label"><Icon name="crown" size={14} /> Mestre</span>
      <button ref={actionsButton} type="button" className="btn btn-small"
        aria-expanded={panel === 'actions'} aria-controls={`${id}-actions`}
        onClick={() => setPanel(current => current === 'actions' ? null : 'actions')}>
        <Icon name="sword" size={14} /> Ações do turno
      </button>
      <button ref={adjustmentsButton} type="button" className="btn btn-small"
        aria-expanded={panel === 'adjustments'} aria-controls={`${id}-adjustments`}
        onClick={() => setPanel(current => current === 'adjustments' ? null : 'adjustments')}>
        <Icon name="gear" size={14} /> Ajustes
      </button>
      {inventory ? <div className="combat-master-inventory">{inventory}</div> : null}
      <span className="combat-master-hint">Alt + clique para sinalizar no mapa</span>
    </div>
    {/* Mantidos montados: fechar a superfície não perde escolhas nem interrompe requisições. */}
    <div ref={surface} className="combat-master-panel" hidden={!panel}>
      <div className="combat-master-panel-heading">
        <strong>{panel === 'actions' ? 'Ações do turno' : 'Ajustes do Mestre'}</strong>
        <button className="btn btn-small combat-master-panel-close" type="button"
          aria-label="Fechar painel do Mestre" onClick={() => close(true)}>Fechar ×</button>
      </div>
      <div id={`${id}-actions`} role="region" aria-label="Ações do turno" hidden={panel !== 'actions'}>
        {action}
      </div>
      <div id={`${id}-adjustments`} role="region" aria-label="Ajustes do Mestre" hidden={panel !== 'adjustments'}>
        {masterTools}
        {tools}
      </div>
    </div>
  </div>;
}
