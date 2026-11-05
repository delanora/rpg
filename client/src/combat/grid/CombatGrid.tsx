import { useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { CombatDto } from '../../types';
import { GridToken, type GridUnit } from './GridToken';
import { UnplacedCombatantsTray, GRID_DRAG_MIME } from './UnplacedCombatantsTray';
import { SpatialSceneControls } from './SpatialSceneControls';
import { setSpatialPosition, updateSpatialScene } from './gridApi';
import {
  BASE_CELL_SIZE_FEET,
  DEFAULT_PIXELS_PER_CELL,
  MAX_PIXELS_PER_CELL,
  MIN_PIXELS_PER_CELL,
  pixelToPlacementFeet,
  scenePixels,
  splitByPlacement,
} from './gridMath';

export interface CombatGridProps {
  /**
   * Estado AUTORITATIVO vindo do servidor (`Combat.spatial` + `Combatant.spatial`).
   * O grid não mantém segunda fonte de posição: `onCombatChange` recebe o DTO
   * devolvido por cada PATCH.
   */
  combat: Pick<
    CombatDto,
    'id' | 'version' | 'status' | 'currentCombatantId' | 'spatial'
  > & { combatants: GridUnit[] };
  isMaster: boolean;
  busy?: boolean;
  onCombatChange: (combat: CombatDto) => void;
  onError: (message: string) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha ao posicionar a unidade.';
}

/**
 * FASE 6.6M.1 — PRIMEIRO GRID VISUAL DO OBSYRIUM.
 *
 * Desenha a cena a partir do estado espacial autoritativo (6.6L.1):
 *  • `assisted` NÃO finge geometria — só oferece "Ativar grid" ao Mestre;
 *  • `grid-2d` desenha dimensões reais em pés e cada `occupiedSpace` derivado;
 *  • placement é ADMINISTRATIVO (Mestre), nunca Movement: nada de speed, path,
 *    Reação, Opportunity Attack ou terreno;
 *  • placement envia só `{ position, expectedVersion, operationId }` e adota o
 *    estado que o servidor devolver (rejeição = nenhum estado inventado).
 */
export function CombatGrid({
  combat,
  isMaster,
  busy = false,
  onCombatChange,
  onError,
}: CombatGridProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [pixelsPerCell, setPixelsPerCell] = useState(DEFAULT_PIXELS_PER_CELL);

  const scene = combat.spatial;
  const cellSizeFeet = scene.cellSizeFeet || BASE_CELL_SIZE_FEET;
  const { placed, unplaced } = splitByPlacement(combat.combatants);
  const dimensions = scenePixels(scene, cellSizeFeet, pixelsPerCell);
  const locked = busy || sceneBusy;

  async function place(combatantId: string, position: { xFeet: number; yFeet: number }) {
    setPendingId(combatantId);
    setSceneError(null);
    try {
      onCombatChange(await setSpatialPosition(combat, combatantId, position));
      setSelectedId(null);
    } catch (error) {
      // O estado confirmado continua o do servidor: nada de posição fantasma.
      setSceneError(messageOf(error));
      onError(messageOf(error));
    } finally {
      setPendingId(null);
    }
  }

  async function changeScene(input: {
    mode: 'assisted' | 'grid-2d';
    widthFeet?: number;
    heightFeet?: number;
  }) {
    setSceneBusy(true);
    setSceneError(null);
    try {
      onCombatChange(await updateSpatialScene(combat, input));
    } catch (error) {
      setSceneError(messageOf(error));
      onError(messageOf(error));
    } finally {
      setSceneBusy(false);
    }
  }

  if (scene.mode !== 'grid-2d') {
    return (
      <section className="combat-grid-panel" aria-label="Cena de combate">
        <SpatialSceneControls
          mode={scene.mode}
          widthFeet={scene.widthFeet}
          heightFeet={scene.heightFeet}
          isMaster={isMaster}
          busy={locked}
          onActivate={(widthFeet, heightFeet) =>
            void changeScene({ mode: 'grid-2d', widthFeet, heightFeet })
          }
          onResize={() => undefined}
          onAssisted={() => undefined}
        />
        <p className="grid-empty">
          {isMaster
            ? 'Cena assistida: ative o grid para posicionar as unidades.'
            : 'Cena assistida: o Mestre ainda não ativou a grade.'}
        </p>
      </section>
    );
  }

  function placeAt(combatantId: string, offsetX: number, offsetY: number) {
    const unit = combat.combatants.find((item) => item.id === combatantId);
    if (!unit?.spatial) return;
    const size = unit.spatial.effectiveSize;
    void place(combatantId, {
      xFeet: pixelToPlacementFeet(offsetX, cellSizeFeet, pixelsPerCell, size),
      yFeet: pixelToPlacementFeet(offsetY, cellSizeFeet, pixelsPerCell, size),
    });
  }

  function handlePlaneClick(event: MouseEvent<HTMLDivElement>) {
    if (!isMaster || !selectedId || locked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    placeAt(selectedId, event.clientX - rect.left, event.clientY - rect.top);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!isMaster || locked) return;
    event.preventDefault();
    const combatantId =
      event.dataTransfer.getData(GRID_DRAG_MIME) ||
      event.dataTransfer.getData('text/plain');
    if (!combatantId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    placeAt(combatantId, event.clientX - rect.left, event.clientY - rect.top);
  }

  return (
    <section className="combat-grid-panel" aria-label="Cena de combate">
      <SpatialSceneControls
        mode={scene.mode}
        widthFeet={scene.widthFeet}
        heightFeet={scene.heightFeet}
        isMaster={isMaster}
        busy={locked}
        onActivate={() => undefined}
        onResize={(widthFeet, heightFeet) =>
          void changeScene({ mode: 'grid-2d', widthFeet, heightFeet })
        }
        onAssisted={() => void changeScene({ mode: 'assisted' })}
      />

      <div className="grid-toolbar">
        <span className="grid-toolbar-hint">
          {isMaster
            ? 'Selecione uma unidade e clique no mapa — ou arraste da bandeja.'
            : 'Visualização da cena.'}
        </span>
        <div className="grid-zoom" role="group" aria-label="Zoom visual">
          <button
            type="button"
            className="btn btn-small"
            disabled={pixelsPerCell <= MIN_PIXELS_PER_CELL}
            onClick={() =>
              setPixelsPerCell((current) => Math.max(MIN_PIXELS_PER_CELL, current - 8))
            }
            aria-label="Reduzir zoom"
          >
            −
          </button>
          <span aria-label="Zoom atual">{Math.round((pixelsPerCell / DEFAULT_PIXELS_PER_CELL) * 100)}%</span>
          <button
            type="button"
            className="btn btn-small"
            disabled={pixelsPerCell >= MAX_PIXELS_PER_CELL}
            onClick={() =>
              setPixelsPerCell((current) => Math.min(MAX_PIXELS_PER_CELL, current + 8))
            }
            aria-label="Aumentar zoom"
          >
            +
          </button>
        </div>
      </div>

      {sceneError ? (
        <p className="grid-scene-error" role="status">
          {sceneError}
        </p>
      ) : null}

      <div className="grid-viewport">
        <div
          className={`grid-plane${isMaster && selectedId ? ' is-placing' : ''}`}
          style={
            {
              width: `${dimensions.width}px`,
              height: `${dimensions.height}px`,
              '--grid-cell': `${pixelsPerCell}px`,
            } as CSSProperties
          }
          data-scene-mode={scene.mode}
          onClick={handlePlaneClick}
          onDragOver={isMaster ? (event) => event.preventDefault() : undefined}
          onDrop={isMaster ? handleDrop : undefined}
          role="presentation"
        >
          {placed.map((combatant) => (
            <GridToken
              key={combatant.id}
              combatant={combatant}
              cellSizeFeet={cellSizeFeet}
              pixelsPerCell={pixelsPerCell}
              currentTurn={
                combat.status === 'ACTIVE' && combat.currentCombatantId === combatant.id
              }
              selected={selectedId === combatant.id}
              pending={pendingId === combatant.id}
              interactive={isMaster && !locked}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      </div>

      {placed.length === 0 ? (
        <p className="grid-empty">Nenhuma unidade posicionada.</p>
      ) : null}

      {isMaster ? (
        <UnplacedCombatantsTray
          combatants={unplaced}
          selectedId={selectedId}
          pendingId={pendingId}
          interactive={!locked}
          onSelect={setSelectedId}
        />
      ) : null}
    </section>
  );
}
