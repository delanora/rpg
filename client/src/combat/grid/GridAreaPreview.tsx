import { GridAreaShape } from './GridAreaShape';
import { useShareAreaVisual } from './areaVisual';
import { ApiError } from '../../api';
import { createOperationId } from '../../utils';
import { useLegendaryAction, useCreatureAbility } from '../combatApi';
import type { CombatDto } from '../../types';
import type { CreatureAreaPlacement } from '../../../../src/modules/shared/creature-abilities';
import {
  queryGridArea,
  queryCreatureArea,
  type AreaReading,
} from './areaQueryApi';
import type { GridAreaQuery } from '../../../../src/modules/combat/spatial/area-membership';
import {
  PREVIEW_SHAPES,
  previewDirectional,
  previewAngle,
  type PreviewShape,
  type AreaPreviewRequest,
} from './areaPreviewGeometry';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { SpatialPosition } from '../../types';
import { formatSceneMeters } from '../../sceneUnits';
import { type GridCamera } from './gridCamera';

const RADII_FEET = [5, 10, 15, 20, 30, 40, 60] as const;
type AbilityContext = NonNullable<AreaPreviewRequest['ability']>;
type Marker = {
  ability?: AbilityContext;
  center: SpatialPosition;
  radiusFeet: number;
  shape: PreviewShape;
  widthFeet: number;
  heightFeet: number;
  angle: number;
};
interface Props {
  onCombatChange?: (combat: CombatDto) => void;
  assessmentContext?: {
    combatId: string;
    version: number;
    casterCombatantId?: string;
  } | null;
  onTargets?: (targets: AreaReading[]) => void;
  request?: AreaPreviewRequest | null;
  camera: GridCamera;
  geometry: { cellSizeFeet: number; pixelsPerCell: number };
  widthFeet: number;
  heightFeet: number;
  positionAt: (clientX: number, clientY: number) => SpatialPosition | null;
  disabled: boolean;
  panning: boolean;
  pinging: boolean;
}

/** O desenho pode ser compartilhado; a consulta privada de atingidos vem do servidor.
 * Não executa ataques, dano ou consumo de recursos. */
export function GridAreaPreview({
  onCombatChange,
  assessmentContext,
  onTargets,
  request,
  camera,
  geometry,
  widthFeet,
  heightFeet,
  positionAt,
  disabled,
  panning,
  pinging,
}: Props) {
  const [abilityContext, setAbilityContext] = useState<
    AbilityContext | undefined
  >();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pendingUse = useRef<{
    combat: { id: string; version: number };
    context: AbilityContext;
    placement: CreatureAreaPlacement;
    operationId: string;
  } | null>(null);
  const [decisionState, setDecisionState] = useState<{
    key: string;
    items: { targetKey: string; affected: boolean }[];
  }>({ key: '', items: [] });
  const [excludedTargets,setExcludedTargets]=useState<{key:string;ids:string[]}>({key:'',ids:[]});
  const [readings, setReadings] = useState<AreaReading[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Marker | null>(null);
  const [editing, setEditing] = useState(false);
  const [center, setCenter] = useState<SpatialPosition | null>(null);
  const [radiusFeet, setRadiusFeet] = useState(10);
  const [picked, setPicked] = useState(false);
  const [shape, setShape] = useState<PreviewShape>('sphere');
  const [lineWidth, setLineWidth] = useState(5);
  const [height, setHeight] = useState(20);
  const [angle, setAngle] = useState(0);
  const [aiming, setAiming] = useState(false);
  const directional = previewDirectional(shape);
  const radialId = useRef<number | null>(null);
  useEffect(() => {
    if (
      !request ||
      disabled ||
      executing ||
      uncertain ||
      radialId.current === request.id
    )
      return;
    radialId.current = request.id;
    setAbilityContext(request.ability);
    setShape(request.shape);
    setCenter(request.origin);
    const definition = request.ability?.definition.area;
    setRadiusFeet(
      definition
        ? 'radiusFeet' in definition.shape
          ? definition.shape.radiusFeet
          : 'sizeFeet' in definition.shape
            ? definition.shape.sizeFeet
            : definition.shape.lengthFeet
        : 10,
    );
    setLineWidth(
      definition?.shape.kind === 'line' ? definition.shape.widthFeet : 5,
    );
    setHeight(request.shape === 'line' ? 5 : 20);
    setAngle(0);
    setPicked(!previewDirectional(request.shape));
    setAiming(previewDirectional(request.shape));
    setEditing(true);
  }, [request, disabled, executing, uncertain]);
  const panClick = useRef(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  function cancel() {
    setEditing(false);
    setCenter(null);
    returnFocus.current = true;
  }
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      toggle.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (disabled) {
      setEditing(false);
      setCenter(null);
    }
  }, [disabled]);
  useEffect(() => {
    if (!editing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [editing]);

  function start() {
    if (disabled) return;
    setAbilityContext(saved?.ability);
    setCenter(saved?.center ?? null);
    setRadiusFeet(saved?.radiusFeet ?? 10);
    setShape(saved?.shape ?? 'sphere');
    setLineWidth(saved?.widthFeet ?? 5);
    setHeight(saved?.heightFeet ?? 20);
    setAngle(saved?.angle ?? 0);
    setAiming(false);
    setPicked(Boolean(saved));
    setEditing(true);
  }
  function position(event: MouseEvent | PointerEvent): SpatialPosition | null {
    const point = positionAt(event.clientX, event.clientY);
    return point &&
      Number.isFinite(point.xFeet) &&
      Number.isFinite(point.yFeet) &&
      point.xFeet >= 0 &&
      point.yFeet >= 0 &&
      point.xFeet <= widthFeet &&
      point.yFeet <= heightFeet
      ? point
      : null;
  }
  const marker =
    editing && !disabled
      ? center
        ? {
            center,
            radiusFeet,
            shape,
            widthFeet: lineWidth,
            heightFeet: height,
            angle,
            ability: abilityContext,
          }
        : null
      : saved;
  const sharingError=useShareAreaVisual(assessmentContext?.combatId,
    `${assessmentContext?.casterCombatantId}:${request?.id}`,
    marker?.ability && !disabled && assessmentContext?.casterCombatantId===marker.ability.combatantId ? {combatantId:marker.ability.combatantId,abilityId:marker.ability.definition.id,origin:marker.center,angle:marker.angle}:null);

  const decisionKey = `${assessmentContext?.combatId}:${assessmentContext?.version}:${JSON.stringify(saved)}`;
  const decisions =
    decisionState.key === decisionKey ? decisionState.items : [];
  useEffect(() => {
    let alive = true;
    setFingerprint(null);
    setReadings([]);
    setError(null);
    onTargets?.([]);
    if (!saved || editing || disabled || !assessmentContext) {
      setLoading(false);
      return;
    }
    const dimension = saved.radiusFeet;
    const volume: GridAreaQuery['shape'] =
      saved.shape === 'sphere'
        ? { kind: 'sphere', radiusFeet: dimension }
        : saved.shape === 'cylinder'
          ? {
              kind: 'cylinder',
              radiusFeet: dimension,
              heightFeet: saved.heightFeet,
            }
          : saved.shape === 'cube'
            ? { kind: 'cube', sizeFeet: dimension }
            : saved.shape === 'cone'
              ? { kind: 'cone', lengthFeet: dimension }
              : {
                  kind: 'line',
                  lengthFeet: dimension,
                  widthFeet: saved.widthFeet,
                };
    setLoading(true);
    const input = {
      decisions,
      casterCombatantId: assessmentContext.casterCombatantId,
      shape: volume,
      origin: { xFeet: saved.center.xFeet, yFeet: saved.center.yFeet },
      angle: saved.angle,
    };
    const reading = saved.ability
      ? queryCreatureArea(
          assessmentContext.combatId,
          saved.ability.combatantId,
          saved.ability.definition.id,
          { origin: input.origin, angle: input.angle, decisions },
        )
      : queryGridArea(assessmentContext.combatId, input);
    reading
      .then((result) => {
        if (!alive) return;
        if (result.combatVersion !== assessmentContext.version) {
          setError('O combate mudou. Ajuste a área para conferir novamente.');
          return;
        }
        if (
          saved.ability &&
          JSON.stringify(result.area) !==
            JSON.stringify(saved.ability.definition.area)
        ) {
          setError(
            'O cadastro mudou. Atualize o combate antes de preparar a habilidade.',
          );
          return;
        }
        setFingerprint(result.definitionFingerprint ?? null);
        setReadings(result.candidates);
        onTargets?.(result.candidates);
      })
      .catch((cause) => {
        if (alive)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível conferir a área.',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    saved,
    editing,
    disabled,
    assessmentContext?.combatId,
    assessmentContext?.version,
    assessmentContext?.casterCombatantId,
    onTargets,
    decisionState,
  ]);
  useEffect(() => () => onTargets?.([]), [onTargets]);
  async function executeAbility() {
    if (
      executing ||
      !assessmentContext ||
      !saved?.ability ||
      (!fingerprint && !pendingUse.current)
    )
      return;
    const intention = pendingUse.current ?? {
      combat: {
        id: assessmentContext.combatId,
        version: assessmentContext.version,
      },
      context: saved.ability,
      placement: {
        origin: saved.center,
        angle: saved.angle,
        decisions,
        definitionFingerprint: fingerprint!,
        selectedTargetKeys:readings.filter(row=>row.affected==='pass'&&!(excludedTargets.key===decisionKey&&excludedTargets.ids.includes(row.targetKey))).map(row=>row.targetKey),
      },
      operationId: createOperationId(),
    };
    pendingUse.current = intention;
    setExecuting(true);
    setError(null);
    try {
      const legendary=intention.context.definition.cost==='legendary';
      const windowId=intention.context.windowId;
      if(legendary&&!windowId)throw new Error('A janela lendária já terminou.');
      const input = {
        ...(intention.context.multiattackId?{multiattackId:intention.context.multiattackId}:{}),
        combatantId: intention.context.combatantId,
        abilityId: intention.context.definition.id,
        areaPlacement: intention.placement,
        operationId: intention.operationId,
        confirmed: true,
      };
      const combat=legendary?await useLegendaryAction(intention.combat,{...input,windowId:windowId!}):await useCreatureAbility(intention.combat,input);
      pendingUse.current = null;
      setUncertain(false);
      setSaved(null);
      setAbilityContext(undefined);
      onTargets?.([]);
      onCombatChange?.(combat);
    } catch (cause) {
      const rejected =
        cause instanceof ApiError && cause.status >= 400 && cause.status < 500;
      if (rejected) pendingUse.current = null;
      setUncertain(!rejected);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível usar a habilidade.',
      );
    } finally {
      setExecuting(false);
    }
  }
  // O acesso inicial fica no radial; controles só existem com uma prévia.
  if (!saved && (!editing || disabled)) return null;

  return (
    <>
      {marker ? <GridAreaShape marker={marker} camera={camera} geometry={geometry}
        damageType={marker.ability?.definition.area?.damage[0]?.type} draft={editing}/> : null}
      {editing && !disabled && !pinging ? (
        <div
          className={`grid-area-capture${panning ? ' is-pan' : ''}`}
          role="presentation"
          onPointerDown={(event) => {
            panClick.current = panning || event.button !== 0;
            down.current = { x: event.clientX, y: event.clientY };
            if (!panClick.current) event.stopPropagation();
          }}
          onPointerMove={(event) => {
            if (!panning && event.buttons === 0) panClick.current = false;
            if (panning || panClick.current) return;
            event.stopPropagation();
            const next = position(event);
            if (aiming && center && next)
              setAngle(previewAngle(center, next, angle));
            else if (!picked && !aiming) setCenter(next);
          }}
          onPointerLeave={() => {
            if (!picked && !aiming) setCenter(null);
          }}
          onPointerUp={(event) => {
            if (!panClick.current) event.stopPropagation();
          }}
          onPointerCancel={() => {
            panClick.current = true;
            down.current = null;
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (panClick.current || panning || event.altKey || disabled) return;
            // Um arrasto sobre o modelo não vira uma escolha involuntária.
            if (
              down.current &&
              Math.hypot(
                event.clientX - down.current.x,
                event.clientY - down.current.y,
              ) > 5
            )
              return;
            const next = position(event);
            if (next) {
              if (aiming && center) {
                setAngle(previewAngle(center, next, angle));
                setAiming(false);
                setPicked(true);
              } else {
                setCenter(next);
                setPicked(!directional);
                setAiming(directional);
              }
            }
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      ) : null}
      <div
        className={`grid-area-controls${!editing && assessmentContext && saved ? ' has-assessment' : ''}`}
        role="group"
        aria-label="Prévia de áreas"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        {sharingError ? <p className="section-note" role="status">{sharingError}</p> : null}
        {!editing || disabled ? (
          <>
            <button
              ref={toggle}
              className="btn btn-small"
              type="button"
              disabled={disabled || executing || uncertain}
              onClick={start}
              title={
                saved
                  ? 'Ajustar prévia de área'
                  : 'Prévia visual local de uma área'
              }
            >
              {saved
                ? `Área · ${PREVIEW_SHAPES.find((item) => item.kind === saved.shape)?.label}`
                : 'Áreas'}
            </button>
            {saved ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={executing || uncertain}
                aria-label="Remover prévia de área"
                onClick={() => setSaved(null)}
              >
                ×
              </button>
            ) : null}
          </>
        ) : (
          <>
            {abilityContext ? (
              <strong>{abilityContext.definition.name}</strong>
            ) : null}
            <label>
              Forma{' '}
              <select
                disabled={!!abilityContext}
                aria-label="Forma da área"
                value={shape}
                onChange={(event) => {
                  const next = event.target.value as PreviewShape;
                  setShape(next);
                  if (next === 'line') setHeight(lineWidth);
                  setAiming(previewDirectional(next) && !!center);
                  setPicked(!!center && !previewDirectional(next));
                }}
              >
                {PREVIEW_SHAPES.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {shape === 'sphere' || shape === 'cylinder'
                ? 'Raio'
                : shape === 'cube'
                  ? 'Aresta'
                  : 'Comprimento'}{' '}
              <select
                disabled={!!abilityContext}
                aria-label="Dimensão da área"
                value={radiusFeet}
                onChange={(event) => setRadiusFeet(Number(event.target.value))}
              >
                {[...new Set<number>([...RADII_FEET, radiusFeet])]
                  .sort((a, b) => a - b)
                  .map((feet) => (
                    <option key={feet} value={feet}>
                      {formatSceneMeters(feet)}
                    </option>
                  ))}
              </select>
            </label>
            {shape === 'line' ? (
              <label>
                Largura
                <select
                  disabled={!!abilityContext}
                  aria-label="Largura da linha"
                  value={lineWidth}
                  onChange={(event) => setLineWidth(Number(event.target.value))}
                >
                  {[...new Set<number>([...RADII_FEET, lineWidth])]
                    .sort((a, b) => a - b)
                    .map((feet) => (
                      <option key={feet} value={feet}>
                        {formatSceneMeters(feet)}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <button
              className="btn btn-small"
              type="button"
              disabled={!center || !picked}
              onClick={() => {
                if (!center || !picked || disabled) return;
                setSaved({
                  center,
                  radiusFeet,
                  shape,
                  widthFeet: lineWidth,
                  heightFeet: height,
                  angle,
                  ability: abilityContext,
                });
                cancel();
              }}
            >
              Confirmar
            </button>
            <button className="btn btn-small" type="button" onClick={cancel}>
              Cancelar
            </button>
            <span className="grid-area-instruction" role="status">
              {aiming
                ? 'Aponte a direção e clique para fixar · Esc cancela'
                : picked
                  ? 'Clique para ajustar · Esc cancela'
                  : 'Clique no mapa para definir a origem · Esc cancela'}
            </span>
          </>
        )}
        {!editing && assessmentContext ? (
          <div className="grid-area-assessment" aria-live="polite">
            {loading ? <p>Conferindo atingidos…</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {saved?.ability ? (
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={
                  executing ||
                  (!uncertain && (loading || !!error || !fingerprint))
                }
                onClick={() => void executeAbility()}
              >
                {executing
                  ? 'Aplicando…'
                  : uncertain
                    ? 'Repetir envio'
                    : `Usar ${saved.ability.definition.name}`}
              </button>
            ) : null}
            {!loading && !error && saved ? (
              <>
                <strong>
                  {readings.filter((row) => row.affected === 'pass'&&!(excludedTargets.key===decisionKey&&excludedTargets.ids.includes(row.targetKey))).length}{' '}
                  atingido(s)
                </strong>
                <ul>
                  {readings
                    .filter(
                      (row) => row.affected !== 'fail' || row.overrideAllowed,
                    )
                    .map((row) => (
                      <li
                        key={row.combatantId}
                        className={
                          row.affected === 'pass' ? 'is-hit' : 'is-uncertain'
                        }
                      >
                        {saved?.ability&&row.affected==='pass'?<label><input type="checkbox" aria-label={`Incluir ${row.name}`} disabled={executing||uncertain} checked={!(excludedTargets.key===decisionKey&&excludedTargets.ids.includes(row.targetKey))} onChange={event=>setExcludedTargets(previous=>({key:decisionKey,ids:event.target.checked?(previous.key===decisionKey?previous.ids:[]).filter(id=>id!==row.targetKey):[...(previous.key===decisionKey?previous.ids:[]),row.targetKey]}))}/> {row.name}</label>:row.name} ·{' '}

                        {row.affected === 'pass'
                          ? row.decisionSource === 'master-confirmed'
                            ? 'Atingido · decisão do Mestre'
                            : 'Atingido'
                          : row.reasons.includes('different-elevation')
                            ? 'Outra elevação · fora por padrão'
                            : row.reasons.includes('wall-height-unknown')
                              ? 'Mestre: conferir obstáculo e altura'
                              : 'Mestre: conferir posição e altura'}
                        {row.overrideAllowed ? (
                          <span className="grid-area-decisions">
                            <button
                              className="btn btn-small"
                              type="button"
                              disabled={executing || uncertain}
                              onClick={() =>
                                setDecisionState({
                                  key: decisionKey,
                                  items: [
                                    ...decisions.filter(
                                      (item) =>
                                        item.targetKey !== row.targetKey,
                                    ),
                                    {
                                      targetKey: row.targetKey,
                                      affected: true,
                                    },
                                  ],
                                })
                              }
                            >
                              Incluir
                            </button>
                            <button
                              className="btn btn-small"
                              type="button"
                              disabled={executing || uncertain}
                              onClick={() =>
                                setDecisionState({
                                  key: decisionKey,
                                  items: [
                                    ...decisions.filter(
                                      (item) =>
                                        item.targetKey !== row.targetKey,
                                    ),
                                    {
                                      targetKey: row.targetKey,
                                      affected: false,
                                    },
                                  ],
                                })
                              }
                            >
                              Excluir
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
                {decisions.length ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() =>
                      setDecisionState({ key: decisionKey, items: [] })
                    }
                  >
                    Rever confirmações
                  </button>
                ) : null}

                <small>
                  A área usa a elevação de quem a executa. Outro nível fica fora
                  por padrão; o Mestre pode incluir por exceção.
                </small>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
