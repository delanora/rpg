import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ApiError } from '../../api';
import { feetToMeters, formatSceneMeters, SCENE_CELL_FEET, SCENE_METERS_PER_FOOT } from '../../sceneUnits';
import type { SceneWallMutation, SceneWallShape } from '../../sceneWallsApi';
import type { Scene, SpatialObstacle, SpatialPosition } from '../../types';
import { newId } from '../../utils';
import { translateWall, wallDraftError, wallPointerPosition } from './sceneWallGeometry';

interface Props {
  scene: Scene;
  disabled: boolean;
  onMutate: (mutation: SceneWallMutation, expectedVersion: number, operationId: string) => Promise<Scene>;
  onReload: () => Promise<Scene>;
  renderCanvas: (overlay: ReactNode, zoom: number) => ReactNode;
}
interface Draft { wallId: string | null; wall: SceneWallShape; version: number }
interface Intention { mutation: SceneWallMutation; version: number; operationId: string }
interface Drag { part: 'start' | 'end' | 'wall'; origin: SpatialPosition; draft: Draft; pointerId: number }

const shapeOf = ({ start, end, blocksMovement, blocksSight, blocksTargeting, coverLevel }: SceneWallShape): SceneWallShape =>
  ({ start, end, blocksMovement, blocksSight, coverLevel: coverLevel ?? ((blocksTargeting ?? blocksMovement) ? 'total' : 'none'), blocksTargeting: coverLevel ? coverLevel === 'total' : blocksTargeting ?? blocksMovement });

/** Rascunhos são locais. Só salvar/excluir chama o contrato HTTP da cena. */
export function SceneWallsEditor({ scene, disabled, onMutate, onReload, renderCanvas }: Props) {
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [segments, setSegments] = useState<SceneWallShape[]>([]);
  const [placing, setPlacing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intention = useRef<Intention | null>(null);
  const writing = useRef(false);
  const drag = useRef<Drag | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const config = scene.spatialConfig;
  const stale = Boolean(draft && draft.version !== scene.version);
  const editable = !disabled && !busy && !uncertain && config.mode === 'grid-2d';
  const invalid = segments.length > 0
    ? segments.map(wall => wallDraftError(wall, config)).find(Boolean) ?? null
    : draft ? wallDraftError(draft.wall, config) : null;

  function cancel() {
    if (writing.current || uncertain) return;
    drag.current = null; setSegments([]); setDraft(null); setPlacing(false); setConfirmDelete(false); setError(null);
  }
  function select(wall: SpatialObstacle) {
    if (!editable) return;
    setSegments([]); setTool('select'); setPlacing(false); setConfirmDelete(false); setError(null); setMessage(null);
    setDraft({ wallId: wall.id, wall: shapeOf(wall), version: scene.version });
  }
  function point(event: PointerEvent<SVGElement>) {
    const rect = svg.current?.getBoundingClientRect();
    return rect ? wallPointerPosition({ x: event.clientX, y: event.clientY }, rect, config, snap ? SCENE_CELL_FEET : 0) : null;
  }
  function capture(event: PointerEvent<SVGElement>, part: Drag['part'], current: Draft) {
    if (!editable || stale || event.button !== 0) return;
    const origin = point(event); if (!origin) return;
    event.preventDefault(); event.stopPropagation(); svg.current?.focus();
    drag.current = { part, origin, draft: current, pointerId: event.pointerId };
    svg.current?.setPointerCapture?.(event.pointerId);
  }
  function begin(event: PointerEvent<SVGSVGElement>) {
    if (!editable || event.button !== 0 || tool !== 'draw' || stale) return;
    const position = point(event); if (!position) return;
    event.preventDefault(); svg.current?.focus(); setError(null); setMessage(null);
    if (!placing || !draft) {
      setSegments([]);
      setDraft({ wallId: null, version: scene.version, wall: { start: position, end: position,
        blocksMovement: true, blocksSight: true, blocksTargeting: true } }); setPlacing(true);
    } else {
      if (position.xFeet === draft.wall.start.xFeet && position.yFeet === draft.wall.start.yFeet) return;
      if (segments.length >= 200) { setError('Salve este traçado antes de desenhar mais segmentos.'); return; }
      setSegments(previous => [...previous, { ...draft.wall, end: position }]);
      setDraft({ ...draft, wall: { ...draft.wall, start: position, end: position } });
    }
  }
  function undoPoint() {
    if (!editable || stale || segments.length === 0 || !draft) return;
    const last = segments[segments.length - 1];
    setSegments(previous => previous.slice(0, -1));
    setDraft({ ...draft, wall: { ...last, end: last.start } }); setPlacing(true);
  }
  function changeFlag(flag: 'blocksMovement' | 'blocksSight' | 'blocksTargeting', value: boolean) {
    if (!draft || !editable || stale) return;
    setDraft({ ...draft, wall: { ...draft.wall, [flag]: value } });
    setSegments(previous => previous.map(wall => ({ ...wall, [flag]: value })));
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!editable || stale) return;
    const position = point(event); if (!position) return;
    const current = drag.current;
    if (current && current.pointerId === event.pointerId) {
      const wall = current.part === 'wall' ? translateWall(current.draft.wall, {
        xFeet: position.xFeet - current.origin.xFeet, yFeet: position.yFeet - current.origin.yFeet,
      }, config) : { ...current.draft.wall, [current.part]: position };
      setDraft({ ...current.draft, wall });
    } else if (placing && draft) setDraft({ ...draft, wall: { ...draft.wall, end: position } });
  }
  async function submit(mutation?: SceneWallMutation) {
    if (writing.current || disabled) return;
    const pending = intention.current ?? (mutation ? {
      mutation, version: draft?.version ?? scene.version, operationId: newId(),
    } : null);
    if (!pending) return;
    writing.current = true; intention.current = pending;
    setBusy(true); setError(null); setMessage(null);
    try {
      await onMutate(pending.mutation, pending.version, pending.operationId);
      intention.current = null; setUncertain(false); setSegments([]); setDraft(null); setPlacing(false); setConfirmDelete(false);
      setMessage(pending.mutation.kind === 'delete' ? 'Parede excluída.' :
        pending.mutation.kind === 'create-many' ? 'Traçado salvo.' : 'Parede salva.');
    } catch (cause) {
      // 4xx é recusa confirmada. Rede/5xx pode ter ocorrido DEPOIS do commit:
      // congelar payload, versão e id impede duplicar a parede num retry.
      const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500;
      if (rejected) intention.current = null;
      setUncertain(!rejected);
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a parede.');
    } finally { writing.current = false; setBusy(false); }
  }
  async function reload() {
    if (writing.current || busy || uncertain) return;
    writing.current = true; setBusy(true);
    try {
      await onReload(); intention.current = null; setUncertain(false); setSegments([]); setDraft(null); setPlacing(false);
      setConfirmDelete(false); setError(null); setMessage('Cena recarregada.');
    } catch { setError('Não foi possível recarregar a cena. Tente novamente.'); }
    finally { writing.current = false; setBusy(false); }
  }
  function coordinate(part: 'start' | 'end', axis: 'xFeet' | 'yFeet', value: string) {
    if (!draft || !editable || stale) return;
    const meters = Number(value.replace(',', '.'));
    if (!Number.isFinite(meters)) return;
    setPlacing(false);
    setDraft({ ...draft, wall: { ...draft.wall, [part]: { ...draft.wall[part],
      [axis]: Math.round(meters / SCENE_METERS_PER_FOOT * 100) / 100 } } });
  }

  const overlay = (
    <svg ref={svg} className={`scene-walls-overlay scene-walls-overlay--${tool}`}
      viewBox={`0 0 ${config.widthFeet} ${config.heightFeet}`} preserveAspectRatio="none"
      role="group" aria-label="Mapa de edição de paredes" tabIndex={0}
      onPointerDown={begin} onPointerMove={move}
      onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) {
        drag.current = null; svg.current?.releasePointerCapture?.(event.pointerId);
      } }}
      onPointerCancel={() => { if (drag.current) setDraft(drag.current.draft); drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}>
      {scene.obstacles.map((wall, index) => {
        const selected = draft?.wallId === wall.id;
        const shape = selected ? draft.wall : wall;
        return <g key={wall.id} className={`scene-wall ${selected ? 'scene-wall--selected' : ''}`}>
          <line x1={shape.start.xFeet} y1={shape.start.yFeet} x2={shape.end.xFeet} y2={shape.end.yFeet}
            className={`scene-wall-line ${!shape.blocksMovement ? 'scene-wall-line--passable' : ''}`}
            vectorEffect="non-scaling-stroke" />
          <line x1={shape.start.xFeet} y1={shape.start.yFeet} x2={shape.end.xFeet} y2={shape.end.yFeet}
            className="scene-wall-hit" vectorEffect="non-scaling-stroke"
            pointerEvents={tool === 'select' ? 'stroke' : 'none'}
            aria-label={`Parede ${index + 1}`}
            onPointerDown={(event) => { if (!editable) return; if (!selected) select(wall);
              capture(event, 'wall', selected ? draft : { wallId: wall.id, wall: shapeOf(wall), version: scene.version });
            }} />
        </g>;
      })}
      {segments.map((wall, index) => <line key={`segment-${index}`} className="scene-wall-draft" vectorEffect="non-scaling-stroke"
        x1={wall.start.xFeet} y1={wall.start.yFeet} x2={wall.end.xFeet} y2={wall.end.yFeet} />)}
      {draft && !draft.wallId ? <line className="scene-wall-draft" vectorEffect="non-scaling-stroke"
        x1={draft.wall.start.xFeet} y1={draft.wall.start.yFeet} x2={draft.wall.end.xFeet} y2={draft.wall.end.yFeet} /> : null}
      {draft && !placing && segments.length === 0 ? (['start', 'end'] as const).map((part) => <g key={part}>
        <circle className="scene-wall-handle" cx={draft.wall[part].xFeet} cy={draft.wall[part].yFeet} r={0.4}
          vectorEffect="non-scaling-stroke" />
        <circle className="scene-wall-handle-hit" cx={draft.wall[part].xFeet} cy={draft.wall[part].yFeet} r={0.4}
          vectorEffect="non-scaling-stroke" aria-label={part === 'start' ? 'Início da parede' : 'Fim da parede'}
          onPointerDown={(event) => capture(event, part, draft)} />
      </g>) : null}
    </svg>
  );

  return <div className="scene-walls-editor" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  }}>
    <div className="scene-wall-toolbar" role="group" aria-label="Ferramentas de paredes">
      <button type="button" className="btn btn-small" aria-pressed={tool === 'select'} disabled={!editable}
        onClick={() => { cancel(); setTool('select'); }}>Selecionar</button>
      <button type="button" className="btn btn-small" aria-pressed={tool === 'draw'} disabled={!editable}
        onClick={() => { cancel(); setTool('draw'); }}>Desenhar parede</button>
      <button type="button" className="btn btn-small" disabled={!editable} onClick={() => {
        cancel(); setTool('select'); setDraft({ wallId: null, version: scene.version, wall: {
          start: { xFeet: 0, yFeet: 0 }, end: { xFeet: Math.min(5, config.widthFeet), yFeet: 0 },
          blocksMovement: true, blocksSight: true, blocksTargeting: true,
        } });
      }}>Nova por coordenadas</button>
      <button type="button" className="btn btn-small" disabled={!editable || stale || segments.length === 0}
        onClick={undoPoint}>Desfazer último ponto</button>
      <label className="scene-wall-check"><input type="checkbox" checked={snap} disabled={!editable}
        onChange={(event) => setSnap(event.target.checked)} /> Alinhar à grade</label>
      <label className="scene-wall-zoom">Zoom <select aria-label="Zoom do editor de paredes" value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}>
        {[0.5, 1, 1.5, 2, 3].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
      </select></label>
      <button type="button" className="btn btn-small" disabled={busy || uncertain || disabled && !error}
        onClick={() => void reload()}>Recarregar cena</button>
    </div>
    <p className="scene-hint">{config.mode !== 'grid-2d' ? 'Salve a base como grade 2D para editar paredes.' :
      tool === 'draw' ? 'Clique para adicionar pontos e cantos. Salve o traçado inteiro ao terminar. Esc cancela.' :
      'Selecione uma parede na lista ou no mapa. Arraste a linha ou os extremos e salve.'}</p>
    {renderCanvas(overlay, zoom)}
    {stale && !uncertain ? <p className="scene-lock" role="status">A cena mudou. Cancele o rascunho e selecione a parede novamente.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {message ? <p className="scene-notice" role="status">{message}</p> : null}
    {uncertain ? <div className="scene-confirm" role="status">
      <p>O resultado do envio não foi confirmado. Use “Tentar novamente” para confirmar a mesma operação antes de continuar.</p>
      <button type="button" className="btn btn-small" disabled={disabled || busy}
        onClick={() => void submit()}>Tentar novamente</button>
    </div> : null}
    <div className="scene-wall-details">
      <div className="scene-wall-list" role="group" aria-label="Paredes da cena">
        {scene.obstacles.length === 0 ? <p className="scene-hint">Nenhuma parede nesta cena.</p> : scene.obstacles.map((wall, index) =>
          <button key={wall.id} type="button" className="scene-wall-item" aria-pressed={draft?.wallId === wall.id}
            disabled={!editable} onClick={() => select(wall)}>
            Parede {index + 1} · {formatSceneMeters(wall.lengthFeet)}
          </button>)}
      </div>
      {draft ? <fieldset className="scene-wall-inspector" disabled={!editable || stale}>
        <legend>{draft.wallId ? 'Editar parede' : 'Nova parede'}</legend>
        {segments.length > 0 ? <p className="scene-hint">{segments.length} segmento(s) no traçado. Clique no primeiro ponto para fechar o contorno.</p> :
        <div className="scene-fields">{(['start', 'end'] as const).flatMap((part) => (['xFeet', 'yFeet'] as const).map((axis) =>
          <label key={`${part}-${axis}`}>{part === 'start' ? 'Início' : 'Fim'} {axis === 'xFeet' ? 'X' : 'Y'} (m)
            <input type="number" min={0} step="any" value={feetToMeters(draft.wall[part][axis])}
              onChange={(event) => coordinate(part, axis, event.target.value)} />
          </label>))}</div>}
        <label className="scene-wall-check"><input type="checkbox" checked={draft.wall.blocksMovement}
          onChange={(event) => changeFlag('blocksMovement', event.target.checked)} /> Bloqueia movimento</label>
        <label className="scene-wall-cover">Cobertura do obstáculo
          <select value={draft.wall.coverLevel ?? ((draft.wall.blocksTargeting ?? draft.wall.blocksMovement) ? 'total' : 'none')}
            onChange={(event) => { const coverLevel = event.target.value as NonNullable<SceneWallShape['coverLevel']>;
              setDraft({ ...draft, wall: { ...draft.wall, coverLevel, blocksTargeting: coverLevel === 'total' } });
              setSegments(previous => previous.map(wall => ({ ...wall, coverLevel, blocksTargeting: coverLevel === 'total' }))); }}>
            <option value="none">Sem cobertura</option><option value="half">Meia cobertura (+2)</option>
            <option value="three-quarters">Três quartos (+5)</option><option value="total">Total (impede ataques e magias diretos)</option>
          </select>
        </label>
        <p className="scene-hint">Defina quanto o obstáculo protege o alvo. Cantos e frestas continuam sujeitos à decisão do Mestre.</p>
        <label className="scene-wall-check"><input type="checkbox" checked={draft.wall.blocksSight}
          onChange={(event) => changeFlag('blocksSight', event.target.checked)} /> Bloqueia visão</label>
        {invalid ? <p className="form-error">{invalid}</p> : null}
      </fieldset> : null}
    </div>
    {draft ? <div className="scene-wall-toolbar">
      <button type="button" className="btn btn-primary btn-small" disabled={!editable || stale || (placing && segments.length === 0) || Boolean(invalid)}
        onClick={() => void submit(draft.wallId ? { kind: 'update', wallId: draft.wallId, wall: draft.wall } :
          segments.length > 1 ? { kind: 'create-many', walls: segments } :
          { kind: 'create', wall: segments[0] ?? draft.wall })}>{busy ? 'Salvando...' :
            segments.length > 1 ? `Salvar traçado (${segments.length})` : 'Salvar parede'}</button>
      <button type="button" className="btn btn-small" disabled={busy || uncertain} onClick={cancel}>Cancelar edição</button>
      {draft.wallId ? <button type="button" className="btn btn-danger btn-small" disabled={!editable || stale}
        onClick={() => setConfirmDelete(true)}>Excluir parede</button> : null}
    </div> : null}
    {confirmDelete && draft?.wallId ? <div className="scene-confirm" role="alert">
      <p>Excluir a parede selecionada?</p>
      <div className="scene-wall-toolbar"><button type="button" className="btn btn-danger btn-small" disabled={!editable || stale}
        onClick={() => void submit({ kind: 'delete', wallId: draft.wallId! })}>Confirmar exclusão</button>
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => setConfirmDelete(false)}>Manter parede</button></div>
    </div> : null}
    <p className="scene-hint">Paredes com bloqueio de movimento impedem atravessar no modo Mover. “Posicionar”, do Mestre, é um ajuste livre. Visão e cobertura são automáticas nos casos claros; cantos e frestas continuam assistidos.</p>
  </div>;
}
