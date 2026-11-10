import { useCallback, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import type { Scene, ScenePatch } from '../../types';
import type { SceneWallMutation } from '../../sceneWallsApi';
import { SceneWallsEditor } from './SceneWallsEditor';
import {
  SceneElevationEditor,
  SceneElevationCells,
} from './SceneElevationEditor';

type Tool = 'select' | 'wall' | 'elevation';
interface Props {
  scene: Scene;
  disabled: boolean;
  onWallMutation: (
    mutation: SceneWallMutation,
    version: number,
    operationId: string,
  ) => Promise<Scene>;
  onSaveElevation: (
    patch: ScenePatch,
    version: number,
    operationId: string,
  ) => Promise<Scene>;
  onReload: () => Promise<Scene>;
  renderCanvas: (overlay: ReactNode, zoom: number) => ReactNode;
}
const TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: 'select', label: 'Selecionar parede', icon: 'cursor' },
  { id: 'wall', label: 'Desenhar parede', icon: 'wall' },
  { id: 'elevation', label: 'Pincel de elevação', icon: 'brush' },
];

/** Uma superfície, uma ferramenta ativa e os mesmos contratos de escrita. */
export function SceneMapEditor({
  scene,
  disabled,
  onWallMutation,
  onSaveElevation,
  onReload,
  renderCanvas,
}: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(1);
  const [sessionLocked, setSessionLocked] = useState(false);
  const reportSession = useCallback(
    (locked: boolean) => setSessionLocked(locked),
    [],
  );
  const config = scene.spatialConfig;
  const editingAllowed = !disabled && config.mode === 'grid-2d';
  const active = TOOLS.find((item) => item.id === tool)!;

  function canvas(overlay: ReactNode, scale: number, options?: ReactNode) {
    const savedLayer = (
      <svg
        className="scene-map-saved-layer"
        aria-hidden="true"
        viewBox={`0 0 ${config.widthFeet} ${config.heightFeet}`}
        preserveAspectRatio="none"
      >
        {tool === 'elevation' ? (
          scene.obstacles.map((wall) => (
            <line
              key={wall.id}
              className={`scene-wall-line ${!wall.blocksMovement ? 'scene-wall-line--passable' : ''}`}
              x1={wall.start.xFeet}
              y1={wall.start.yFeet}
              x2={wall.end.xFeet}
              y2={wall.end.yFeet}
              vectorEffect="non-scaling-stroke"
            />
          ))
        ) : (
          <SceneElevationCells cells={config.elevationCells ?? []} />
        )}
      </svg>
    );
    return (
      <div className="scene-map-canvas">
        {renderCanvas(
          <>
            {savedLayer}
            {overlay}
          </>,
          scale,
        )}
        <div
          className="scene-map-tools"
          role="toolbar"
          aria-label="Ferramentas da cena"
        >
          <span className="scene-map-tools-heading">Cena</span>
          {TOOLS.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-label={item.label}
              title={
                sessionLocked && item.id !== tool
                  ? 'Salve ou cancele a edição antes de trocar a ferramenta.'
                  : item.label
              }
              aria-pressed={tool === item.id}
              disabled={!editingAllowed || (sessionLocked && item.id !== tool)}
              onClick={() => setTool(item.id)}
            >
              <Icon name={item.icon} size={19} />
            </button>
          ))}
          {options ? (
            <details className="scene-map-options">
              <summary
                aria-label="Ajustes da ferramenta"
                title="Ajustes da ferramenta"
              >
                <Icon name="gear" size={18} />
              </summary>
              <div className="scene-map-options-body">{options}</div>
            </details>
          ) : null}
          <span className="scene-map-tools-divider" />
          <button
            type="button"
            aria-label="Diminuir zoom da cena"
            title="Diminuir zoom"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            <Icon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="scene-map-zoom-value"
            aria-label="Restaurar zoom da cena"
            title="Restaurar zoom"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Aumentar zoom da cena"
            title="Aumentar zoom"
            disabled={zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        <span className="scene-map-tool-name" role="status">
          {active.label}
        </span>
      </div>
    );
  }

  return (
    <div className="scene-map-editor">
      {tool === 'elevation' ? (
        <SceneElevationEditor
          embedded
          scene={scene}
          disabled={disabled}
          sharedZoom={zoom}
          onSessionChange={reportSession}
          onSave={onSaveElevation}
          renderCanvas={canvas}
        />
      ) : (
        <SceneWallsEditor
          embedded
          scene={scene}
          disabled={disabled}
          activeTool={tool === 'wall' ? 'draw' : 'select'}
          onToolChange={(next) => setTool(next === 'draw' ? 'wall' : 'select')}
          sharedZoom={zoom}
          onSessionChange={reportSession}
          onMutate={onWallMutation}
          onReload={onReload}
          renderCanvas={canvas}
        />
      )}
      {sessionLocked ? (
        <p className="scene-map-editing-hint">
          Salve ou cancele a edição para alternar a ferramenta.
        </p>
      ) : null}
    </div>
  );
}
