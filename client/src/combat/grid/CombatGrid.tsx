import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from 'react';
import type {
  CombatDto,
  MovementPreviewResponse,
  SpatialDistanceReading,
  SpatialMeasureEndpoint,
  SpatialPosition,
  SpatialSize,
} from '../../types';
import { createOperationId } from '../../utils';
import { GridToken, type GridUnit } from './GridToken';
import { UnplacedCombatantsTray, GRID_DRAG_MIME } from './UnplacedCombatantsTray';
import { SpatialSceneControls } from './SpatialSceneControls';
import { GridMovementOverlay } from './GridMovementOverlay';
import { GridMovementTrace } from './GridMovementTrace';
import { GridRuler } from './GridRuler';
import { MovementHud, type MovementPreviewState } from './MovementHud';
import { commitMovement, previewMovement } from './movementApi';
import { anchorStepFeet, appendAnchor, pointerAnchor } from './movementPath';
import {
  measureSpatial,
  setSpatialPosition,
  setSpatialVisibility,
  updateSpatialScene,
} from './gridApi';
import {
  CAMERA_FIT_MARGIN_PX,
  centerCamera,
  clampCamera,
  edgePanSpeed,
  fitCamera,
  panBy,
  sceneToScreen,
  screenToFeet,
  zoomAt,
  cameraPercent,
  type GridCamera,
  type Point2D,
} from './gridCamera';
import { rulerEndpointKey, rulerSameEndpoint, type RulerRequestState } from './gridRuler';
import {
  BASE_CELL_SIZE_FEET,
  DEFAULT_PIXELS_PER_CELL,
  SIZE_FOOTPRINT_FEET,
  occupiedSpacePixels,
  scenePixels,
  splitByPlacement,
} from './gridMath';
import type { MovementAuthority } from '../turnControl';

export interface CombatGridProps {
  /**
   * Estado AUTORITATIVO vindo do servidor (`Combat.spatial` + `Combatant.spatial`).
   * O grid não mantém segunda fonte de posição: `onCombatChange` recebe o DTO
   * devolvido por cada requisição.
   */
  combat: Pick<
    CombatDto,
    'id' | 'version' | 'status' | 'currentCombatantId' | 'spatial'
  > & { combatants: GridUnit[] };
  isMaster: boolean;
  busy?: boolean;
  /**
   * 6.6M.3 — quem pode mover MECANICAMENTE agora (derivação única em
   * `turnControl.movementAuthorityOf`). Sem isso o modo Mover apenas explica o
   * motivo; nenhum gesto inicia draft.
   */
  movement?: MovementAuthority;
  onCombatChange: (combat: CombatDto) => void;
  onError: (message: string) => void;
}

/**
 * Ferramenta ATIVA do grid — estado SÓ de UI (nunca vai ao banco nem ao DTO).
 *
 * MOVIMENTO NÃO É MODO. Arrastar um token com autoridade inicia o Movement
 * direto; não existe botão "Mover" nem confirmação manual. As ferramentas
 * explícitas são mutuamente exclusivas e `none` é a superfície livre:
 * • `none`      = gesto direto (pan no fundo, arrasto do token, régua com F);
 * • `placement` = organização administrativa da cena (Mestre);
 * • `measure`   = régua espacial.
 */
type InteractionMode = 'none' | 'placement' | 'measure';

/** Trajeto pretendido LOCAL (nunca persistido, nunca fonte de posição). */
interface MovementDraft {
  combatantId: string;
  /** Âncora autoritativa no início do draft — base da invalidação por realtime. */
  startPosition: SpatialPosition;
  /** Âncoras pretendidas, passo a passo (vazio = draft recém-iniciado). */
  path: SpatialPosition[];
  /** Ponto de pega dentro do footprint (pés) para o token não "pular". */
  grab: SpatialPosition;
}

/**
 * GESTO armado no token (pointerdown), antes de virar draft.
 *
 * Existe para separar CLIQUE de ARRASTO sem long press artificial: o draft só
 * nasce quando o ponteiro ultrapassa `DRAG_THRESHOLD_PX`. Guarda a posição
 * AUTORITATIVA do início, que é a base da contiguidade do path.
 */
interface TokenGesture {
  pointerId: number;
  combatantId: string;
  startX: number;
  startY: number;
  grab: SpatialPosition;
  position: SpatialPosition;
}

/** Régua: origem + destino opcionais (ponto no grid ou combatente). */
interface RulerState {
  from: SpatialMeasureEndpoint;
  to: SpatialMeasureEndpoint | null;
  locked: boolean;
}

interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  camera: GridCamera;
  moved: boolean;
}

/** Limiar (px) entre clique e arrasto: pan nunca dispara ação acidental. */
const PAN_THRESHOLD_PX = 4;
/** Limiar (px) do GESTO do token: abaixo disso é clique, acima é Movement. */
const DRAG_THRESHOLD_PX = 4;
/** Zona de borda (px) que ativa o auto-pan durante o movimento. */
const AUTO_PAN_EDGE_PX = 52;
/** Velocidade máxima do auto-pan (px/frame). */
const AUTO_PAN_MAX_SPEED = 14;
/** Passo do zoom dos botões (mesma câmera do Ctrl+wheel). */
const ZOOM_STEP = 1.18;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha ao posicionar a unidade.';
}

function clampFeet(value: number, max: number): number {
  return Math.min(Math.max(0, value), Math.max(0, max));
}

/** Campo de texto/editor: atalhos do grid NÃO disparam ali. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * GRID DE COMBATE — superfície tática do Obsyrium.
 *
 * FASE 6.6M.1 — desenho da cena a partir do estado espacial autoritativo.
 * FASE 6.6M.2 — modo Medir (leitura do servidor, linha decorativa).
 * FASE 6.6L.3.2 — o grid NÃO decide quem aparece (DTO filtra `master-only`).
 * FASE 6.6M.3 — movimento voluntário server-authoritative (preview + commit).
 * FASE 6.6M.3.1 — CÂMERA (pan/zoom/fit/center), RÉGUA (ponto↔ponto em metros),
 *                 HUD compacto e correção do Drag & Drop real.
 *
 * Invariantes:
 *  • a câmera é CLIENT-ONLY e nunca altera pés/distância/footprint;
 *  • toda ferramenta converte ponteiro por `screenToFeet` (nunca pixel de tela
 *    como coordenada mecânica);
 *  • placement é administrativo; movimento gasta saldo; medir é leitura pura;
 *  • nada de posição otimista: o token real só anda com o `CombatDto` devolvido.
 */
export function CombatGrid({
  combat,
  isMaster,
  busy = false,
  movement,
  onCombatChange,
  onError,
}: CombatGridProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  // --- 6.6M.3.1: câmera (estado APENAS local) -------------------------------
  const [camera, setCamera] = useState<GridCamera>({ panX: 0, panY: 0, zoom: 1 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [spacePan, setSpacePan] = useState(false);
  // --- modos e régua --------------------------------------------------------
  const [mode, setMode] = useState<InteractionMode>('none');
  const [ruler, setRuler] = useState<RulerState | null>(null);
  const [quickRuler, setQuickRuler] = useState(false);
  const [hoverTokenId, setHoverTokenId] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<SpatialPosition | null>(null);
  const [distance, setDistance] = useState<SpatialDistanceReading | null>(null);
  const [rulerState, setRulerState] = useState<RulerRequestState>('idle');
  const [rulerRetry, setRulerRetry] = useState(0);
  /** Sequência das leituras: resposta atrasada de um extremo antigo é IGNORADA. */
  const rulerSequence = useRef(0);
  // --- 6.6M.3: draft de movimento (estado APENAS local) --------------------
  const [draft, setDraft] = useState<MovementDraft | null>(null);
  const [preview, setPreview] = useState<MovementPreviewResponse | null>(null);
  const [previewState, setPreviewState] = useState<MovementPreviewState>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [movementBusy, setMovementBusy] = useState(false);
  const previewSequence = useRef(0);
  const operationRef = useRef<string | null>(null);
  const dragMoved = useRef(false);
  const suppressClick = useRef(false);
  const gestureRef = useRef<TokenGesture | null>(null);
  const [grabGesture, setGrabGesture] = useState<TokenGesture | null>(null);
  /** O ponteiro já soltou: `lostpointercapture` tardio não pode cancelar. */
  const released = useRef(false);

  const planeRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  const draftRef = useRef<MovementDraft | null>(draft);
  const rulerRef = useRef<{ from: SpatialMeasureEndpoint | null; to: SpatialMeasureEndpoint | null }>({
    from: null,
    to: null,
  });
  const lastPointer = useRef<Point2D | null>(null);
  const panGesture = useRef<PanGesture | null>(null);
  const spaceDown = useRef(false);
  const fittedKey = useRef<string | null>(null);

  const scene = combat.spatial;
  const cellSizeFeet = scene.cellSizeFeet || BASE_CELL_SIZE_FEET;
  const geometry = { pixelsPerCell: DEFAULT_PIXELS_PER_CELL, cellSizeFeet };
  const { placed, unplaced } = useMemo(() => splitByPlacement(combat.combatants), [combat.combatants]);
  const dimensions = useMemo(
    () => scenePixels(scene, cellSizeFeet, DEFAULT_PIXELS_PER_CELL),
    [scene, cellSizeFeet],
  );
  const locked = busy || sceneBusy || movementBusy;

  const movableUnitId = movement?.combatantId ?? null;
  const movableUnit = placed.find((item) => item.id === movableUnitId) ?? null;
  const draftUnit = draft ? (placed.find((item) => item.id === draft.combatantId) ?? null) : null;
  const currentUnit =
    combat.status === 'ACTIVE'
      ? (placed.find((item) => item.id === combat.currentCombatantId) ?? null)
      : null;

  const selectedUnit = mode === 'placement' ? (combat.combatants.find((item) => item.id === selectedId) ?? null) : null;
  const draftLast = draft && draft.path.length > 0 ? draft.path[draft.path.length - 1] : null;

  cameraRef.current = camera;
  draftRef.current = draft;

  /* ---------------------------------------------------------------------- */
  /* CÂMERA                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Enquadramento inicial: a cena NUNCA nasce colada no canto. */
  useEffect(() => {
    if (!viewport.width || !viewport.height) return;
    const key = `${combat.id}:${dimensions.width.toFixed(1)}x${dimensions.height.toFixed(1)}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    setCamera(fitCamera({ scene: dimensions, viewport, margin: CAMERA_FIT_MARGIN_PX }));
  }, [combat.id, dimensions, viewport]);

  /** ResizeObserver: pan/zoom continuam válidos em qualquer largura. */
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    setViewport({ width: node.clientWidth, height: node.clientHeight });
    return () => observer.disconnect();
  }, []);

  function applyCamera(next: GridCamera): void {
    cameraRef.current = next;
    setCamera(next);
  }

  function bounded(next: GridCamera): GridCamera {
    return clampCamera(next, dimensions, viewport);
  }

  function fitScene(): void {
    applyCamera(fitCamera({ scene: dimensions, viewport, margin: CAMERA_FIT_MARGIN_PX }));
  }

  function centerOn(scenePoint: Point2D): void {
    applyCamera(bounded(centerCamera(cameraRef.current, scenePoint, viewport)));
  }

  function centerOnCombatant(combatantId: string): void {
    const unit = placed.find((item) => item.id === combatantId);
    const center = unit ? footprintCenterPx(unit) : null;
    if (center) centerOn(center);
  }

  function zoomStep(factor: number): void {
    const anchor = { x: viewport.width / 2, y: viewport.height / 2 };
    applyCamera(bounded(zoomAt(cameraRef.current, factor, anchor)));
  }

  /**
   * Ctrl+roda = ZOOM DO GRID (nunca da página); roda = pan vertical;
   * Shift+roda = pan horizontal. Listener NATIVO com `passive: false`, porque o
   * handler de wheel do React não permite `preventDefault`.
   */
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const rect = node!.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0016);
        applyCamera(bounded(zoomAt(cameraRef.current, factor, point)));
        return;
      }
      const horizontal = event.shiftKey ? -event.deltaY : -event.deltaX;
      const vertical = event.shiftKey ? 0 : -event.deltaY;
      applyCamera(bounded(panBy(cameraRef.current, horizontal, vertical)));
    }
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
    // `applyCamera`/`bounded` só tocam a câmera local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.width, dimensions.height, viewport.width, viewport.height]);

  /* ---------------------------------------------------------------------- */
  /* CONVERSÕES (toda ferramenta passa por aqui)                             */
  /* ---------------------------------------------------------------------- */

  /** Ponteiro (cliente) → px relativos ao VIEWPORT (sem transformação). */
  function viewportPoint(clientX: number, clientY: number): Point2D | null {
    const node = viewportRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Ponteiro (cliente) → PÉS na cena, com pan/zoom aplicados. */
  function feetAt(clientX: number, clientY: number): SpatialPosition | null {
    const point = viewportPoint(clientX, clientY);
    if (!point) return null;
    return screenToFeet(cameraRef.current, point, geometry);
  }

  /** Âncora (canto mínimo do footprint) a partir do ponteiro. */
  function anchorAt(
    clientX: number,
    clientY: number,
    size: SpatialSize,
    grab: SpatialPosition,
  ): SpatialPosition | null {
    const feet = feetAt(clientX, clientY);
    if (!feet) return null;
    return pointerAnchor({
      xFeet: feet.xFeet - grab.xFeet,
      yFeet: feet.yFeet - grab.yFeet,
      size,
      scene,
    });
  }

  /** Centro visual da ÂNCORA (px de TELA) — traço/label do movimento. */
  function anchorScreen(anchor: SpatialPosition): Point2D | null {
    const box = occupiedSpacePixels(
      {
        minXFeet: anchor.xFeet,
        minYFeet: anchor.yFeet,
        maxXFeet: anchor.xFeet,
        maxYFeet: anchor.yFeet,
        widthFeet: 0,
        heightFeet: 0,
      },
      cellSizeFeet,
      DEFAULT_PIXELS_PER_CELL,
    );
    const half = DEFAULT_PIXELS_PER_CELL / 2;
    return sceneToScreen(camera, { x: box.left + half, y: box.top + half });
  }

  /** Centro do footprint (px de CENA) — só para desenho/centralização. */
  function footprintCenterPx(unit: GridUnit): Point2D | null {
    if (!unit.spatial) return null;
    const box = occupiedSpacePixels(unit.spatial.occupiedSpace ?? {
      minXFeet: 0,
      minYFeet: 0,
      maxXFeet: 0,
      maxYFeet: 0,
      widthFeet: 0,
      heightFeet: 0,
    }, cellSizeFeet, DEFAULT_PIXELS_PER_CELL);
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  /* ---------------------------------------------------------------------- */
  /* MEDIÇÃO / RÉGUA                                                         */
  /* ---------------------------------------------------------------------- */

  const rulerActive = mode === 'measure' || quickRuler || ruler !== null;

  const hoveredUnit = hoverTokenId ? (placed.find((item) => item.id === hoverTokenId) ?? null) : null;
  const hoverTarget: SpatialMeasureEndpoint | null =
    rulerActive && ruler && !ruler.locked
      ? hoveredUnit
        ? { kind: 'combatant', combatantId: hoveredUnit.id }
        : hoverAnchor
          ? { kind: 'point', position: hoverAnchor }
          : null
      : null;
  const rulerTo = ruler?.to ?? hoverTarget;
  const rulerFromKey = ruler ? rulerEndpointKey(ruler.from) : null;
  const rulerToKey = rulerTo ? rulerEndpointKey(rulerTo) : null;
  rulerRef.current = { from: ruler?.from ?? null, to: rulerTo ?? null };

  function clearRuler(): void {
    rulerSequence.current += 1;
    setRuler(null);
    setQuickRuler(false);
    setHoverAnchor(null);
    setHoverTokenId(null);
    setDistance(null);
    setRulerState('idle');
  }

  /** Fixa um extremo: primeiro clique define origem; o segundo TRAVA a régua. */
  function pickRulerEndpoint(endpoint: SpatialMeasureEndpoint): void {
    if (!ruler || ruler.locked) {
      rulerSequence.current += 1;
      setDistance(null);
      setRulerState('idle');
      setRuler({ from: endpoint, to: null, locked: false });
      return;
    }
    if (rulerSameEndpoint(endpoint, ruler.from)) return;
    setRuler({ from: ruler.from, to: endpoint, locked: true });
  }

  function pointEndpointAt(clientX: number, clientY: number): SpatialMeasureEndpoint | null {
    const feet = feetAt(clientX, clientY);
    if (!feet) return null;
    return {
      kind: 'point',
      position: pointerAnchor({ xFeet: feet.xFeet, yFeet: feet.yFeet, size: 'small', scene }),
    };
  }

  /**
   * Leitura da régua: UMA requisição por par de extremos ALINHADO (nunca por
   * pixel), com sequência para descartar resposta obsoleta. O valor exibido é
   * sempre do servidor — o cliente não converte distância.
   */
  useEffect(() => {
    const current = rulerRef.current;
    if (!current.from || !current.to || rulerSameEndpoint(current.from, current.to)) {
      setDistance(null);
      setRulerState('idle');
      return;
    }
    rulerSequence.current += 1;
    const sequence = rulerSequence.current;
    setRulerState('loading');
    measureSpatial(combat.id, current.from, current.to)
      .then((response) => {
        if (rulerSequence.current !== sequence) return;
        setDistance(response.distance);
        setRulerState('success');
      })
      .catch(() => {
        if (rulerSequence.current !== sequence) return;
        // Falha de rede NÃO mantém o valor anterior como se fosse atual.
        setDistance(null);
        setRulerState('error');
      });
  }, [combat.id, combat.version, rulerFromKey, rulerToKey, rulerRetry]);

  /** Troca de modo limpa a régua e o draft; sair de grid-2d limpa a medição. */
  useEffect(() => {
    if (mode === 'measure' && combat.spatial.mode !== 'grid-2d') setMode('placement');
  }, [combat.spatial.mode, mode]);

  /** REALTIME: extremo que sai do DTO (ficou privado) limpa a régua. */
  useEffect(() => {
    if (!ruler) return;
    const stillThere = (endpoint: SpatialMeasureEndpoint | null): boolean =>
      !endpoint ||
      endpoint.kind === 'point' ||
      combat.combatants.some((item) => item.id === endpoint.combatantId && item.spatial);
    if (stillThere(ruler.from) && stillThere(ruler.to)) return;
    clearRuler();
    // `clearRuler` só toca estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat.combatants, ruler]);

  /* ---------------------------------------------------------------------- */
  /* PLACEMENT / MOVIMENTO                                                   */
  /* ---------------------------------------------------------------------- */

  function clearDraft(): void {
    previewSequence.current += 1;
    operationRef.current = null;
    dragMoved.current = false;
    setDraft(null);
    setPreview(null);
    setPreviewState('idle');
    setPreviewError(null);
  }

  function cancelDraft(message: string | null = null): void {
    clearDraft();
    setDraftNotice(message);
  }

  function changeMode(next: InteractionMode): void {
    if (next === mode) return;
    clearRuler();
    clearDraft();
    setDraftNotice(null);
    setPendingNotice(null);
    setSelectedId(null);
    setMode(next);
  }

  async function place(combatantId: string, position: SpatialPosition) {
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

  async function toggleVisibility(combatantId: string) {
    const unit = combat.combatants.find((item) => item.id === combatantId);
    if (!unit) return;
    setPendingId(combatantId);
    setSceneError(null);
    try {
      onCombatChange(
        await setSpatialVisibility(
          combat,
          combatantId,
          unit.spatialVisibility === 'master-only' ? 'public' : 'master-only',
        ),
      );
    } catch (error) {
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

  /**
   * ARMA o gesto do token no pointerdown — ainda NÃO cria draft.
   *
   * Clique curto continua selecionando (nenhum Movement, nenhum gasto); o
   * draft nasce quando o ponteiro ultrapassa o limiar. Ferramentas explícitas
   * (Posicionar/Medir), Space e o botão do meio têm PRECEDÊNCIA.
   */
  function armTokenGesture(combatantId: string, event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    if (spaceDown.current || rulerActive || locked) return;
    if (mode !== 'none') return;
    if (movableUnitId !== combatantId) return;
    const unit = placed.find((item) => item.id === combatantId);
    const position = unit?.spatial?.position ?? null;
    if (!unit?.spatial || !position) return;
    const footprint = SIZE_FOOTPRINT_FEET[unit.spatial.effectiveSize];
    let grab: SpatialPosition = {
      xFeet: footprint.widthFeet / 2,
      yFeet: footprint.heightFeet / 2,
    };
    const feet = feetAt(event.clientX, event.clientY);
    if (feet) {
      grab = {
        xFeet: clampFeet(feet.xFeet - position.xFeet, footprint.widthFeet),
        yFeet: clampFeet(feet.yFeet - position.yFeet, footprint.heightFeet),
      };
    }
    // O gesto é do TOKEN: o pan do fundo não pode roubá-lo. Sem preventDefault,
    // o clique curto continua chegando para selecionar.
    event.stopPropagation();
    lastPointer.current = { x: event.clientX, y: event.clientY };
    released.current = false;
    const gesture: TokenGesture = {
      pointerId: event.pointerId,
      combatantId,
      startX: event.clientX,
      startY: event.clientY,
      grab,
      position,
    };
    gestureRef.current = gesture;
    setGrabGesture(gesture);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  /**
   * Cria o DRAFT (o token real NÃO sai do lugar): o trajeto nasce vazio e o
   * primeiro anchor já é contíguo à posição autoritativa de `startPosition`.
   */
  function beginDraft(gesture: TokenGesture, clientX: number, clientY: number): void {
    operationRef.current = null;
    dragMoved.current = false;
    setDraftNotice(null);
    setPendingNotice(null);
    setPreview(null);
    setPreviewState('idle');
    const next: MovementDraft = {
      combatantId: gesture.combatantId,
      startPosition: gesture.position,
      path: [],
      grab: gesture.grab,
    };
    draftRef.current = next;
    setDraft(next);
    appendDraftAt(clientX, clientY);
  }

  /** Acrescenta o anchor correspondente ao ponteiro atual (passo do tamanho). */
  function appendDraftAt(clientX: number, clientY: number): void {
    const current = draftRef.current;
    if (!current) return;
    const unit = placed.find((item) => item.id === current.combatantId);
    if (!unit?.spatial) return;
    const anchor = anchorAt(clientX, clientY, unit.spatial.effectiveSize, current.grab);
    if (!anchor) return;
    // O path começa DEPOIS da posição autoritativa (que o servidor já conhece).
    const nextPath = appendAnchor(
      current.path,
      anchor,
      anchorStepFeet(unit.spatial.effectiveSize),
      current.startPosition,
    );
    if (nextPath === current.path) return;
    dragMoved.current = true;
    const next = { ...current, path: nextPath };
    draftRef.current = next;
    setDraft(next);
  }

  /** POINTERUP = CONFIRMAÇÃO: sem botão, sem passo extra. */
  function finishDraft(): void {
    released.current = true;
    gestureRef.current = null;
    setGrabGesture(null);
    const current = draftRef.current;
    if (!current) return;
    const moved = dragMoved.current;
    dragMoved.current = false;
    if (current.path.length === 0) {
      // Clique curto (ou arrasto que não saiu da célula): nenhum commit.
      clearDraft();
      if (moved) setDraftNotice('Arraste por uma casa inteira para mover.');
      return;
    }
    // O clique sintético do fim do gesto não pode virar seleção.
    suppressClick.current = true;
    void confirmMovement(current.combatantId, current.path);
  }

  /* PREVIEW do trajeto: só quando o caminho EFETIVO muda (debounce curto). */
  const draftPath = draft?.path ?? null;
  const draftCombatantId = draft?.combatantId ?? null;
  useEffect(() => {
    if (!draftPath || !draftCombatantId || draftPath.length === 0) {
      previewSequence.current += 1;
      setPreview(null);
      setPreviewState('idle');
      setPreviewError(null);
      return;
    }
    previewSequence.current += 1;
    const sequence = previewSequence.current;
    setPreviewState('loading');
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      previewMovement(combat.id, { combatantId: draftCombatantId, path: draftPath })
        .then((response) => {
          if (previewSequence.current !== sequence) return;
          setPreview(response);
          setPreviewState('ready');
        })
        .catch((error: unknown) => {
          if (previewSequence.current !== sequence) return;
          setPreview(null);
          setPreviewState('error');
          setPreviewError(error instanceof Error ? error.message : 'Falha ao calcular o trajeto.');
        });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [combat.id, draftCombatantId, draftPath]);

  /**
   * REALTIME durante o draft: versão, turno, posição do source, status do
   * combate, projeção (ficou master-only) ou perda de autoridade invalidam o
   * trajeto local. O fantasma nunca fica órfão.
   */
  useEffect(() => {
    if (!draft) return;
    const unit = combat.combatants.find((item) => item.id === draft.combatantId);
    const position = unit?.spatial?.position ?? null;
    const invalid =
      combat.status !== 'ACTIVE' ||
      combat.currentCombatantId !== draft.combatantId ||
      !position ||
      position.xFeet !== draft.startPosition.xFeet ||
      position.yFeet !== draft.startPosition.yFeet ||
      (movement ? movement.combatantId !== draft.combatantId : false);
    if (!invalid) return;
    clearDraft();
    setDraftNotice('O movimento foi cancelado: o estado do combate mudou.');
    // `clearDraft` só toca estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat.version, combat.status, combat.currentCombatantId, combat.combatants, movement, draft]);

  /**
   * GESTO DO TOKEN: listeners no WINDOW enquanto existe gesto armado ou draft.
   *
   * Não dependemos do bubbling do plano (nem de o token continuar montado): o
   * gesto sobrevive ao ponteiro sair do viewport e ao retrato ter foco — foi o
   * que faltava no Drag & Drop da 6.6M.3. O DRAFT só nasce depois do limiar,
   * então clique curto continua sendo clique.
   */
  useEffect(() => {
    if (!grabGesture && !draft) return undefined;
    function onMove(event: globalThis.PointerEvent): void {
      lastPointer.current = { x: event.clientX, y: event.clientY };
      const gesture = gestureRef.current;
      if (gesture && !draftRef.current) {
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        beginDraft(gesture, event.clientX, event.clientY);
        return;
      }
      if (draftRef.current) appendDraftAt(event.clientX, event.clientY);
    }
    function onUp(): void {
      lastPointer.current = null;
      finishDraft();
    }
    /** Cancelamento NUNCA confirma: o token real continua onde o servidor diz. */
    function onCancel(): void {
      if (released.current) return;
      released.current = true;
      gestureRef.current = null;
      setGrabGesture(null);
      cancelDraft('Movimento cancelado.');
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onCancel);
    };
    // Os handlers leem refs: o efeito roda só quando o gesto nasce/termina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabGesture !== null, draft !== null]);

  /** AUTO-PAN: aproximar o cursor da borda move a câmera e o trajeto continua. */
  useEffect(() => {
    if (!draft) return undefined;
    let frame = 0;
    function tick(): void {
      const pointer = lastPointer.current;
      const node = viewportRef.current;
      if (pointer && node) {
        const rect = node.getBoundingClientRect();
        const dx = edgePanSpeed(pointer.x, rect.left, rect.right, AUTO_PAN_EDGE_PX, AUTO_PAN_MAX_SPEED);
        const dy = edgePanSpeed(pointer.y, rect.top, rect.bottom, AUTO_PAN_EDGE_PX, AUTO_PAN_MAX_SPEED);
        if (dx !== 0 || dy !== 0) {
          // Sinal invertido: empurrar a câmera "para dentro" revela a borda.
          const next = bounded(panBy(cameraRef.current, -dx, -dy));
          cameraRef.current = next;
          setCamera(next);
          appendDraftAt(pointer.x, pointer.y);
        }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft !== null, dimensions.width, dimensions.height, viewport.width, viewport.height]);

  /**
   * COMMIT do movimento: revalida (preview nunca é autoridade), envia o commit
   * real e adota o `CombatDto`. O `operationId` é o mesmo em retry da MESMA
   * tentativa.
   */
  async function confirmMovement(combatantId: string, path: SpatialPosition[]): Promise<void> {
    if (movementBusy) return;
    const unit = placed.find((item) => item.id === combatantId);
    if (!unit?.spatial?.position) return;
    setMovementBusy(true);
    setSceneError(null);
    setDraftNotice(null);
    try {
      // O preview NUNCA é autoridade e o drop pode acontecer antes da resposta
      // mais recente: o caminho final é SEMPRE revalidado pelo servidor.
      const fresh = await previewMovement(combat.id, { combatantId, path });
      if (!fresh.movement.legal || !fresh.movement.affordable) {
        setDraftNotice(
          fresh.movement.legal ? 'Movimento insuficiente para este trajeto.' : 'O trajeto não é válido.',
        );
        clearDraft();
        return;
      }
      operationRef.current ??= createOperationId();
      const result = await commitMovement(combat, {
        combatantId,
        path,
        operationId: operationRef.current,
      });
      onCombatChange(result.combat);
      setPendingNotice(
        result.pending
          ? result.pending.awaitingMaster
            ? 'Aguardando resolução do Mestre.'
            : 'Movimento pausado por reação.'
          : null,
      );
      clearDraft();
    } catch (error) {
      setSceneError(messageOf(error));
      setDraftNotice(messageOf(error));
      onError(messageOf(error));
      clearDraft();
    } finally {
      setMovementBusy(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* INTERAÇÕES DO PALCO                                                     */
  /* ---------------------------------------------------------------------- */

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (target.closest('.grid-movement-hud')) return;
    const overToken = Boolean(target.closest('.grid-token'));
    // O gesto do token é do TOKEN — exceto Space e botão do meio, que sempre
    // arrastam a câmera (mesmo começando sobre um token).
    if (overToken && !spaceDown.current && event.button !== 1) return;
    if (event.button !== 0 && event.button !== 1) return;
    panGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera: cameraRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Botão do meio: impede o auto-scroll do navegador.
    if (event.button === 1) event.preventDefault();
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const gesture = panGesture.current;
    if (gesture) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      // Limiar em px² (sem `hypot`: nada de geometria mecânica no grid).
      if (!gesture.moved && dx * dx + dy * dy < PAN_THRESHOLD_PX * PAN_THRESHOLD_PX) return;
      gesture.moved = true;
      const next = bounded(panBy(gesture.camera, dx, dy));
      cameraRef.current = next;
      setCamera(next);
      return;
    }
    if (!rulerActive) {
      if (hoverAnchor) setHoverAnchor(null);
      return;
    }
    // Célula sob o cursor: só apresentação (nunca validação local).
    const feet = feetAt(event.clientX, event.clientY);
    if (!feet) return;
    const anchor = pointerAnchor({ xFeet: feet.xFeet, yFeet: feet.yFeet, size: 'small', scene });
    if (!hoverAnchor || hoverAnchor.xFeet !== anchor.xFeet || hoverAnchor.yFeet !== anchor.yFeet) {
      setHoverAnchor(anchor);
    }
  }

  function handleViewportPointerUp(event: PointerEvent<HTMLDivElement>): void {
    const gesture = panGesture.current;
    panGesture.current = null;
    if (gesture) {
      event.currentTarget.releasePointerCapture?.(gesture.pointerId);
      if (gesture.moved) suppressClick.current = true;
    }
  }

  function handleViewportClick(event: MouseEvent<HTMLDivElement>): void {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (rulerActive) {
      const endpoint = pointEndpointAt(event.clientX, event.clientY);
      if (endpoint) pickRulerEndpoint(endpoint);
      return;
    }
    if (mode !== 'placement') return;
    if (!isMaster || !selectedId || locked) return;
    const unit = combat.combatants.find((item) => item.id === selectedId);
    if (!unit?.spatial) return;
    const feet = feetAt(event.clientX, event.clientY);
    if (!feet) return;
    void place(
      selectedId,
      pointerAnchor({
        xFeet: feet.xFeet,
        yFeet: feet.yFeet,
        size: unit.spatial.effectiveSize,
        scene,
      }),
    );
  }

  /**
   * Botão direito cancela SEMPRE o gesto corrente (e não abre menu do browser):
   * durante o movimento interrompe o draft sem commit; na régua limpa a linha.
   */
  function handleViewportContextMenu(event: MouseEvent<HTMLDivElement>): void {
    if (!rulerActive && !draft && !grabGesture) return;
    event.preventDefault();
    if (grabGesture || draft) {
      gestureRef.current = null;
      setGrabGesture(null);
      cancelDraft('Movimento cancelado.');
      return;
    }
    clearRuler();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (mode !== 'placement' || !isMaster || locked) return;
    event.preventDefault();
    const combatantId =
      event.dataTransfer.getData(GRID_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!combatantId) return;
    const unit = combat.combatants.find((item) => item.id === combatantId);
    if (!unit?.spatial) return;
    const feet = feetAt(event.clientX, event.clientY);
    if (!feet) return;
    void place(
      combatantId,
      pointerAnchor({ xFeet: feet.xFeet, yFeet: feet.yFeet, size: unit.spatial.effectiveSize, scene }),
    );
  }

  function selectUnit(combatantId: string): void {
    if (suppressClick.current) {
      // Clique sintético do fim de um arrasto: não seleciona por acidente.
      suppressClick.current = false;
      return;
    }
    if (rulerActive) {
      const unit = placed.find((item) => item.id === combatantId);
      if (!unit?.spatial) return;
      pickRulerEndpoint({ kind: 'combatant', combatantId });
      return;
    }
    if (mode === 'placement') setSelectedId(combatantId);
  }

  /* ---------------------------------------------------------------------- */
  /* ATALHOS (F = régua rápida, Esc, Space = pan)                            */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        if (ruler || quickRuler) clearRuler();
        if (draft) cancelDraft('Movimento cancelado.');
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (spaceDown.current) return;
        spaceDown.current = true;
        setSpacePan(true);
        event.preventDefault();
        return;
      }
      if ((event.key === 'f' || event.key === 'F') && !event.repeat) {
        if (combat.spatial.mode !== 'grid-2d') return;
        event.preventDefault();
        setQuickRuler(true);
      }
    }
    function onKeyUp(event: KeyboardEvent): void {
      if (event.key === ' ' || event.code === 'Space') {
        spaceDown.current = false;
        setSpacePan(false);
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        // Depois do primeiro clique a régua continua mesmo soltando F.
        if (!rulerRef.current.from) setQuickRuler(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // `clearRuler`/`cancelDraft` só tocam estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruler, quickRuler, draft, combat.spatial.mode, rulerActive]);

  /* ---------------------------------------------------------------------- */
  /* RENDER                                                                  */
  /* ---------------------------------------------------------------------- */

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
        {/* Sem grid não há medição autoritativa: nada de distância fingida. */}
        <p className="grid-measure-unavailable">Distância não disponível sem grid ativo.</p>
      </section>
    );
  }

  const placementInteractive = isMaster && !locked && mode === 'placement';
  /** MODO MEDIR: qualquer um com o grid ativo mede o que o servidor autoriza. */
  const measureInteractive = !locked;
  /** Só o combatente autorizado do turno responde ao gesto de movimento. */
  const movementInteractive = !locked && Boolean(movableUnitId);
  /** Token utilizável: régua > gesto de movimento do dono > placement do Mestre. */
  const tokenInteractive = (combatant: GridUnit): boolean =>
    rulerActive ? true : movementInteractive ? movableUnitId === combatant.id : placementInteractive;

  const hint = rulerActive
    ? ruler?.locked
      ? 'Régua fixada. Clique para medir de novo; botão direito ou Esc limpa.'
      : ruler
        ? 'Mova o cursor e clique no destino para fixar a régua.'
        : quickRuler
          ? 'Clique na origem (token ou espaço vazio) para puxar a régua.'
          : 'Clique na origem da régua (token ou espaço vazio).'
    : mode === 'placement'
      ? isMaster
        ? 'Selecione uma unidade e clique no mapa — ou arraste da bandeja.'
        : 'Visualização da cena.'
      : movement && !movement.combatantId
        ? (movement.reason ?? 'Nenhum combatente pode se mover agora.')
        : isMaster
          ? 'Arraste o token do turno para mover · Posicionar coloca unidades · F mede.'
          : 'Arraste o seu token para mover · Space/botão do meio arrastam a câmera · F mede.';

  const planeClasses = [
    'grid-plane',
    placementInteractive && selectedId ? 'is-placing' : '',
    mode === 'measure' ? 'is-measuring' : '',
    draft ? 'is-drafting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const viewportClasses = [
    'grid-viewport',
    panGesture.current?.moved ? 'is-panning' : '',
    spacePan ? 'is-space-pan' : '',
    rulerActive ? 'is-ruler' : '',
    draft ? 'is-drafting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rulerFromScreen = ruler
    ? endpointScreenPoint(ruler.from, camera)
    : null;
  const rulerToScreen = rulerTo ? endpointScreenPoint(rulerTo, camera) : null;
  const fromName = endpointName(ruler?.from ?? null);
  const toName = endpointName(rulerTo);

  function endpointScreenPoint(endpoint: SpatialMeasureEndpoint, current: GridCamera): Point2D | null {
    if (endpoint.kind === 'point') {
      const box = occupiedSpacePixels(
        {
          minXFeet: endpoint.position.xFeet,
          minYFeet: endpoint.position.yFeet,
          maxXFeet: endpoint.position.xFeet,
          maxYFeet: endpoint.position.yFeet,
          widthFeet: 0,
          heightFeet: 0,
        },
        cellSizeFeet,
        DEFAULT_PIXELS_PER_CELL,
      );
      const point = { x: box.left, y: box.top };
      // Ponto é a âncora: usa o centro da CÉLULA para o marcador não ficar no canto.
      const half = DEFAULT_PIXELS_PER_CELL / 2;
      return sceneToScreen(current, { x: point.x + half, y: point.y + half });
    }
    const unit = placed.find((item) => item.id === endpoint.combatantId);
    const center = unit ? footprintCenterPx(unit) : null;
    return center ? sceneToScreen(current, center) : null;
  }

  function endpointName(endpoint: SpatialMeasureEndpoint | null): string {
    if (!endpoint) return '—';
    if (endpoint.kind === 'point') return 'Ponto';
    return placed.find((item) => item.id === endpoint.combatantId)?.name ?? 'Combatente';
  }

  const measureRoleOf = (combatantId: string): 'source' | 'target' | null => {
    if (ruler?.from.kind === 'combatant' && ruler.from.combatantId === combatantId) return 'source';
    if (rulerTo?.kind === 'combatant' && rulerTo.combatantId === combatantId) return 'target';
    return null;
  };

  const currentOffscreen =
    currentUnit !== null &&
    (() => {
      const center = footprintCenterPx(currentUnit);
      if (!center) return false;
      const screen = sceneToScreen(camera, center);
      return (
        screen.x < 0 ||
        screen.y < 0 ||
        screen.x > viewport.width ||
        screen.y > viewport.height
      );
    })();

  return (
    <section className="combat-grid-panel" aria-label="Cena de combate">
      <div className="grid-toolbar">
        <div className="grid-toolbar-left">
          <div className="grid-modes" role="group" aria-label="Ferramenta do grid">
            {isMaster ? (
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={mode === 'placement'}
                disabled={locked}
                onClick={() => changeMode(mode === 'placement' ? 'none' : 'placement')}
              >
                Posicionar
              </button>
            ) : null}
            {/* Sem botão "Mover": o movimento é o GESTO no token do turno. */}
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={mode === 'measure'}
              title="Régua — medição de qualquer ponto a qualquer ponto"
              onClick={() => changeMode(mode === 'measure' ? 'none' : 'measure')}
            >
              Medir
            </button>
          </div>
          {currentUnit ? (
            <span className="grid-turn">
              Turno de <strong>{currentUnit.name}</strong>
            </span>
          ) : null}
        </div>
        <div className="grid-camera-controls" role="group" aria-label="Câmera">
          <button
            type="button"
            className="btn btn-small"
            aria-label="Reduzir zoom"
            onClick={() => zoomStep(1 / ZOOM_STEP)}
          >
            −
          </button>
          <span className="grid-zoom-value" aria-label="Zoom atual">
            {cameraPercent(camera.zoom)}%
          </span>
          <button
            type="button"
            className="btn btn-small"
            aria-label="Aumentar zoom"
            onClick={() => zoomStep(ZOOM_STEP)}
          >
            +
          </button>
          <button type="button" className="btn btn-small" aria-label="Enquadrar cena" onClick={fitScene}>
            Enquadrar
          </button>
          <button
            type="button"
            className={currentOffscreen ? 'btn btn-small is-offscreen' : 'btn btn-small'}
            aria-label="Centralizar no turno"
            disabled={!currentUnit}
            onClick={() => {
              if (currentUnit) centerOnCombatant(currentUnit.id);
            }}
          >
            Centralizar
          </button>
        </div>
      </div>

      <SpatialSceneControls
        mode={scene.mode}
        widthFeet={scene.widthFeet}
        heightFeet={scene.heightFeet}
        isMaster={isMaster}
        busy={locked}
        onActivate={() => undefined}
        onResize={(widthFeet, heightFeet) => void changeScene({ mode: 'grid-2d', widthFeet, heightFeet })}
        onAssisted={() => void changeScene({ mode: 'assisted' })}
      />

      {isMaster && mode === 'placement' && selectedUnit ? (
        <div className="grid-visibility">
          <span className="grid-visibility-label">
            {selectedUnit.name} ·{' '}
            {selectedUnit.spatialVisibility === 'master-only'
              ? 'oculto dos jogadores'
              : 'visível para os jogadores'}
          </span>
          <button
            type="button"
            className="btn btn-small"
            disabled={locked || pendingId === selectedUnit.id}
            onClick={() => void toggleVisibility(selectedUnit.id)}
          >
            {selectedUnit.spatialVisibility === 'master-only'
              ? 'Revelar aos jogadores'
              : 'Ocultar dos jogadores'}
          </button>
        </div>
      ) : null}

      {sceneError ? (
        <p className="grid-scene-error" role="status">
          {sceneError}
        </p>
      ) : null}

      <div className="grid-stage">
        <div
          ref={viewportRef}
          className={viewportClasses}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onPointerCancel={handleViewportPointerUp}
          onClick={handleViewportClick}
          onContextMenu={handleViewportContextMenu}
          onDragOver={isMaster ? (event) => event.preventDefault() : undefined}
          onDrop={isMaster ? handleDrop : undefined}
          role="presentation"
        >
          <div
            className="grid-camera"
            style={{
              transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})`,
            }}
          >
            <div
              ref={planeRef}
              className={planeClasses}
              style={
                {
                  width: `${dimensions.width}px`,
                  height: `${dimensions.height}px`,
                  '--grid-cell': `${DEFAULT_PIXELS_PER_CELL}px`,
                } as CSSProperties
              }
              data-scene-mode={scene.mode}
            >
              {placed.map((combatant) => (
                <GridToken
                  key={combatant.id}
                  combatant={combatant}
                  cellSizeFeet={cellSizeFeet}
                  pixelsPerCell={DEFAULT_PIXELS_PER_CELL}
                  currentTurn={
                    combat.status === 'ACTIVE' && combat.currentCombatantId === combatant.id
                  }
                  selected={mode === 'placement' && selectedId === combatant.id}
                  pending={
                    pendingId === combatant.id ||
                    (movementBusy && draft?.combatantId === combatant.id)
                  }
                  measureRole={rulerActive ? measureRoleOf(combatant.id) : null}
                  interactive={tokenInteractive(combatant)}
                  movable={!locked && !rulerActive && mode === 'none' && movableUnitId === combatant.id}
                  rulerActive={rulerActive}
                  onSelect={selectUnit}
                  onMoveStart={armTokenGesture}
                  onCenter={centerOnCombatant}
                  onHover={rulerActive && measureInteractive ? setHoverTokenId : undefined}
                />
              ))}

              {/* GHOST do destino: o token real continua na origem. */}
              {draft && draftLast && draftUnit?.spatial ? (
                <GridMovementOverlay
                  ghost={{
                    position: draftLast,
                    size: draftUnit.spatial.effectiveSize,
                    imageRef: draftUnit.spatial.tokenImageRef,
                  }}
                  cellSizeFeet={cellSizeFeet}
                  pixelsPerCell={DEFAULT_PIXELS_PER_CELL}
                />
              ) : null}

              {/* Célula sob o cursor — highlight sutil, sem fingir validade. */}
              {hoverAnchor && rulerActive ? (
                <div
                  className="grid-hover-cell"
                  aria-hidden="true"
                  style={{
                    left: `${(hoverAnchor.xFeet / cellSizeFeet) * DEFAULT_PIXELS_PER_CELL}px`,
                    top: `${(hoverAnchor.yFeet / cellSizeFeet) * DEFAULT_PIXELS_PER_CELL}px`,
                    width: `${DEFAULT_PIXELS_PER_CELL}px`,
                    height: `${DEFAULT_PIXELS_PER_CELL}px`,
                  }}
                />
              ) : null}
            </div>
          </div>

          {/* TRAÇO do movimento: MESMA linha tracejada da régua, em TELA. */}
          {draft && draft.path.length > 0 ? (
            <GridMovementTrace
              points={[draft.startPosition, ...draft.path]
                .map(anchorScreen)
                .filter((point): point is Point2D => point !== null)}
              distanceInFeet={preview?.movement.totalDistanceFeet ?? null}
              costInFeet={preview?.movement.totalCostFeet ?? null}
              state={previewState}
            />
          ) : null}

          {/* RÉGUA em coordenadas de TELA: label nítida e sempre horizontal. */}
          {rulerFromScreen && rulerToScreen ? (
            <GridRuler
              from={rulerFromScreen}
              to={rulerToScreen}
              fromLabel={fromName}
              toLabel={toName}
              distance={distance}
              state={rulerState}
              locked={ruler?.locked ?? false}
            />
          ) : null}

          {rulerState === 'error' ? (
            <button
              type="button"
              className="btn btn-small grid-ruler-retry"
              onClick={() => setRulerRetry((current) => current + 1)}
            >
              Tentar novamente
            </button>
          ) : null}

          {draftNotice && !draft ? (
            <p className="grid-hud-notice" role="status" aria-live="polite">
              {draftNotice}
            </p>
          ) : null}

          {draft ? (
            <MovementHud
              combatantName={draftUnit?.name ?? movableUnit?.name ?? null}
              eligible={Boolean(movableUnitId)}
              reason={movement?.reason ?? null}
              pathLength={draft.path.length}
              movement={preview?.movement ?? null}
              reaction={preview?.reaction ?? null}
              state={previewState}
              error={previewError}
              pendingNotice={pendingNotice ?? draftNotice}
              busy={movementBusy}
              onCancel={() => cancelDraft('Movimento cancelado.')}
            />
          ) : null}

          <p className="grid-hint">{hint}</p>
        </div>
      </div>

      {placed.length === 0 ? (
        <p className="grid-empty">Nenhuma unidade posicionada.</p>
      ) : null}

      {isMaster ? (
        <UnplacedCombatantsTray
          combatants={unplaced}
          selectedId={mode === 'placement' ? selectedId : null}
          pendingId={pendingId}
          interactive={!locked && mode === 'placement'}
          onSelect={setSelectedId}
        />
      ) : null}
    </section>
  );
}

