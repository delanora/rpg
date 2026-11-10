import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useSceneMapCamera, sceneInputTarget } from './useSceneMapCamera';
import {
  SceneEditorRadialMenu,
  type SceneRadialOption,
} from './SceneEditorRadialMenu';
import type { SceneWallSettings } from './SceneWallsEditor';
import { MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM } from '../../combat/grid/gridCamera';
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
  const root = useRef<HTMLDivElement>(null);
  const [radial, setRadial] = useState<{
    point: { x: number; y: number };
    phase: 'tools' | 'wall' | 'cover';
  } | null>(null);
  const [wallSettings, setWallSettings] = useState<SceneWallSettings>({
    blocksMovement: true,
    blocksSight: true,
    blocksTargeting: true,
    coverLevel: 'total',
  });
  const middleDrag = useRef<{ id: number; x: number; y: number } | null>(null);
  const closeRadial = useCallback(() => setRadial(null), []);
  const [sessionLocked, setSessionLocked] = useState(false);
  const reportSession = useCallback(
    (locked: boolean) => setSessionLocked(locked),
    [],
  );
  const config = scene.spatialConfig;
  const editingAllowed = !disabled && config.mode === 'grid-2d';
  const active = TOOLS.find((item) => item.id === tool)!;
  const camera = useSceneMapCamera(
    root,
    `${scene.id}:${config.widthFeet}:${config.heightFeet}`,
    tool,
    config.heightFeet / Math.max(1, config.widthFeet),
    radial !== null,
  );
  const zoom = camera.camera.zoom;
  const openMenu = (
    point: { x: number; y: number },
    phase: 'tools' | 'wall' | 'cover',
  ) => {
    camera.stop();
    root.current
      ?.querySelectorAll('details[open]')
      .forEach((node) => node.removeAttribute('open'));
    setRadial({ point, phase });
  };
  const wallMenu = (point: { x: number; y: number }) => openMenu(point, 'wall');
  const radialOptions: SceneRadialOption[] =
    radial?.phase === 'cover'
      ? (
          [
            ['none', 'Nenhuma'],
            ['half', 'Meia cobertura'],
            ['three-quarters', 'Três quartos'],
            ['total', 'Cobertura total'],
          ] as const
        ).map(([level, label]) => ({
          id: level,
          label,
          caption:
            level === 'three-quarters'
              ? '¾'
              : level === 'half'
                ? '½'
                : level === 'none'
                  ? 'Nenhuma'
                  : 'Total',
          icon: 'shield',
          checked: wallSettings.coverLevel === level,
          action: () => {
            setWallSettings((settings) => ({
              ...settings,
              coverLevel: level,
              blocksTargeting: level === 'total',
            }));
            setRadial((value) => (value ? { ...value, phase: 'wall' } : null));
          },
        }))
      : radial?.phase === 'wall'
        ? [
            {
              id: 'cover',
              label: 'Escolher cobertura',
              caption:
                wallSettings.coverLevel === 'half'
                  ? 'Cobertura ½'
                  : wallSettings.coverLevel === 'three-quarters'
                    ? 'Cobertura ¾'
                    : wallSettings.coverLevel === 'none'
                      ? 'Sem cobertura'
                      : 'Total',
              icon: 'shield',
              action: () =>
                setRadial((value) =>
                  value ? { ...value, phase: 'cover' } : null,
                ),
            },
            {
              id: 'sight',
              label: 'Bloqueia visão',
              caption: wallSettings.blocksSight ? 'Opaca' : 'Transparente',
              icon: wallSettings.blocksSight ? 'eye-off' : 'eye',
              checked: wallSettings.blocksSight,
              action: () =>
                setWallSettings((settings) => ({
                  ...settings,
                  blocksSight: !settings.blocksSight,
                })),
            },
            {
              id: 'movement',
              label: 'Bloqueia movimento',
              caption: wallSettings.blocksMovement ? 'Sólida' : 'Passável',
              icon: 'boots',
              checked: wallSettings.blocksMovement,
              action: () =>
                setWallSettings((settings) => ({
                  ...settings,
                  blocksMovement: !settings.blocksMovement,
                })),
            },
            {
              id: 'draw',
              label: 'Começar a desenhar parede',
              caption: 'Desenhar',
              icon: 'wall',
              action: () => {
                setTool('wall');
                closeRadial();
                root.current?.focus({ preventScroll: true });
              },
            },
          ]
        : [
            {
              id: 'wall',
              label: 'Configurar parede',
              caption: 'Parede',
              icon: 'wall',
              disabled: sessionLocked,
              action: () =>
                setRadial((value) =>
                  value ? { ...value, phase: 'wall' } : null,
                ),
            },
            {
              id: 'elevation',
              label: 'Pincel de elevação',
              caption: 'Altura',
              icon: 'brush',
              disabled: sessionLocked,
              action: () => {
                setTool('elevation');
                closeRadial();
              },
            },
            {
              id: 'select',
              label: 'Selecionar parede',
              caption: 'Selecionar',
              icon: 'cursor',
              disabled: sessionLocked,
              action: () => {
                setTool('select');
                closeRadial();
              },
            },
          ];

  function canvas(overlay: ReactNode, _scale: number, options?: ReactNode) {
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
      <div
        className="scene-map-canvas"
        tabIndex={0}
        aria-label="Área de edição do mapa"
        style={
          {
            '--scene-editor-pan-x': `${camera.camera.panX}px`,
            '--scene-editor-pan-y': `${camera.camera.panY}px`,
            '--scene-editor-zoom': zoom,
          } as CSSProperties
        }
        onPointerDownCapture={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest('.scene-wall-viewport')
          )
            return;
          root.current?.focus({ preventScroll: true });
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            camera.stop();
            middleDrag.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
        }}
        onPointerMoveCapture={(event) => {
          const drag = middleDrag.current;
          if (!drag || drag.id !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          camera.pan(event.clientX - drag.x, event.clientY - drag.y);
          drag.x = event.clientX;
          drag.y = event.clientY;
        }}
        onPointerUpCapture={(event) => {
          if (middleDrag.current?.id !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          middleDrag.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          middleDrag.current = null;
          camera.stop();
        }}
        onLostPointerCapture={() => {
          middleDrag.current = null;
        }}
        onContextMenuCapture={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest('.scene-wall-viewport')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (
            !editingAllowed ||
            event.target.closest('.scene-wall-hit,.scene-wall-handle-hit')
          )
            return;
          const rect = camera.viewport.current
            ?.querySelector('.scene-preview')
            ?.getBoundingClientRect();
          if (
            rect &&
            (event.clientX < rect.left ||
              event.clientY < rect.top ||
              event.clientX > rect.right ||
              event.clientY > rect.bottom)
          )
            return;
          openMenu({ x: event.clientX, y: event.clientY }, 'tools');
        }}
      >
        {renderCanvas(
          <>
            {savedLayer}
            {overlay}
          </>,
          1,
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
              onClick={(event) => {
                if (sessionLocked) return;
                if (item.id === 'wall') {
                  const rect = event.currentTarget.getBoundingClientRect();
                  wallMenu({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 108,
                  });
                } else {
                  setTool(item.id);
                  closeRadial();
                }
              }}
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
            disabled={zoom <= MIN_CAMERA_ZOOM}
            onClick={() => camera.zoom(-0.25)}
          >
            <Icon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="scene-map-zoom-value"
            aria-label="Restaurar zoom da cena"
            title="Restaurar zoom"
            onClick={camera.fit}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Aumentar zoom da cena"
            title="Aumentar zoom"
            disabled={zoom >= MAX_CAMERA_ZOOM}
            onClick={() => camera.zoom(0.25)}
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
    <div
      ref={root}
      className="scene-map-editor"
      tabIndex={-1}
      onFocusCapture={(event) => {
        if (sceneInputTarget(event.target)) camera.stop();
      }}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          camera.stop();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[role="menu"]')
        )
          return;
        if (radial) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          camera.stop();
          root.current
            ?.querySelector<HTMLButtonElement>(
              '[data-scene-cancel-draft]:not(:disabled)',
            )
            ?.click();
          return;
        }
        if (
          event.code === 'Space' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          const target = event.target instanceof Element ? event.target : null;
          if (
            target?.closest('button,summary') ||
            (sceneInputTarget(event.target) &&
              !target?.hasAttribute('data-scene-save-on-space'))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat)
            root.current
              ?.querySelector<HTMLButtonElement>(
                '[data-scene-save-draft]:not(:disabled)',
              )
              ?.click();
          return;
        }
        camera.keyDown(event);
      }}
    >
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
          wallSettings={wallSettings}
          activeTool={tool === 'wall' ? 'draw' : 'select'}
          onToolChange={(next) => setTool(next === 'draw' ? 'wall' : 'select')}
          sharedZoom={zoom}
          onSessionChange={reportSession}
          onMutate={onWallMutation}
          onReload={onReload}
          renderCanvas={canvas}
        />
      )}
      {radial ? (
        <SceneEditorRadialMenu
          point={radial.point}
          menuId={radial.phase}
          title={
            radial.phase === 'tools'
              ? 'Ferramentas do mapa'
              : radial.phase === 'wall'
                ? 'Parede'
                : 'Cobertura'
          }
          options={radialOptions}
          onClose={closeRadial}
          onBack={
            radial.phase === 'tools'
              ? undefined
              : () =>
                  setRadial((value) =>
                    value
                      ? {
                          ...value,
                          phase: value.phase === 'cover' ? 'wall' : 'tools',
                        }
                      : null,
                  )
          }
        />
      ) : null}
      <p className="scene-map-shortcuts">
        WASD: navegar · roda do mouse: zoom · botão do meio: arrastar · botão
        direito: ferramentas · Espaço: salvar · Esc: cancelar
      </p>
      {sessionLocked ? (
        <p className="scene-map-editing-hint">
          Salve ou cancele a edição para alternar a ferramenta.
        </p>
      ) : null}
    </div>
  );
}
