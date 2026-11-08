import { useGridPing } from './gridPing';
import { GridPings } from './GridPings';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { SpatialGridOverlay } from '../../components/spatial/SpatialGridOverlay';
import { useSceneGridTone } from '../../components/spatial/useSceneGridTone';
import { MovementHud, movementIssueLabel, type MovementPreviewState } from './MovementHud';
import { commitMovement, previewMovement } from './movementApi';
import { subscribeMovementVisual, useMovementVisual } from './movementVisual';
import { anchorStepFeet, contiguousAnchors } from './movementPath';
import {
  measureSpatial,
  setSpatialPosition,
  setSpatialVisibility,
  updateSpatialScene,
} from './gridApi';
import {
  CAMERA_FIT_MARGIN_PX,
  centerCamera,
  cameraIsUsable,
  autoPanCameraDelta,
  clampCamera,
  fitCamera,
  panBy,
  revealIntentAt,
  sceneToScreen,
  screenToFeet,
  zoomAt,
  cameraPercent,
  type GridCamera,
  type Point2D,
} from './gridCamera';
import { rulerEndpointKey, rulerSameEndpoint, type RulerRequestState } from './gridRuler';
import { gridPhaseOf, type GridPhase } from './gridLifecycle';
import {
  BASE_CELL_SIZE_FEET,
  DEFAULT_PIXELS_PER_CELL,
  SIZE_FOOTPRINT_FEET,
  centeredFootprintFeet,
  containingCellFeet,
  occupiedSpacePixels,
  scenePixels,
  spatialRectToScenePixels,
  splitByPlacement,
} from './gridMath';
import { Icon } from '../../components/Icon';
import type { MovementAuthority } from '../turnControl';
import { ROLL_MODE_LABELS, gridTargetPick, type CombatRollMode } from '../gridTargeting';
import { GridRollModePicker } from './GridRollModePicker';

/**
 * TARGETING DIRETO A PARTIR DA HOTBAR (6.6M.6.4) — o grid NÃO executa ataque.
 *
 * Ele só encaminha a INTENÇÃO de alvo para o fluxo que já existe (painel de
 * ataque → `resolveAttack` → servidor). Distâncias, alcance, cobertura total,
 * condições e economia continuam sendo julgados lá.
 */
export interface GridTargeting {
  /** O clique curto em token elegível vira alvo (estado de UI). */
  active: boolean;
  /** Ids elegíveis agora (DTO visível + posicionados). */
  targetableIds: readonly string[];
  /** Alvo já escolhido — destaque no token e menção no hint. */
  selectedTargetId: string | null;
  onPickTarget: (combatantId: string) => void;
  onClearTarget: () => void;
  /**
   * 6.6M.6.4.2 — DUPLO CLIQUE no alvo elegível executa o ataque pelo MESMO
   * pedido do botão "Rolar ataque". O grid só avisa; nada é rolado aqui e
   * nenhuma regra é decidida no cliente.
   */
  onExecuteTarget?: (combatantId: string) => void;
  /**
   * 6.6M.6.4.4 — MODO escolhido no menu do token: só GUARDA a escolha (alvo +
   * modo). Nada é enviado aqui — quem confirma o ataque é o duplo clique.
   */
  onChooseRollMode?: (combatantId: string, mode: CombatRollMode) => void;
  /**
   * Modo JÁ escolhido para o alvo selecionado (`null` = nenhum ainda). A espada
   * ganha o glifo dele e ele continua valendo no duplo clique.
   */
  rollMode?: CombatRollMode | null;
  /**
   * 6.6M.6.4.5 — o menu do token deve estar VISÍVEL agora. Um novo clique no
   * alvo que já tem modo escolhido reabre o menu para TROCAR a rolagem, sem
   * descartar a escolha anterior.
   */
  rollMenuOpen?: boolean;
  /** Prontidão de execução (vem do painel) — só habilita/desabilita o menu. */
  executeReady?: boolean;
  /** Esc: encerra TODO o fluxo — limpa o alvo e a ação escolhida na Hotbar. */
  onCancelFlow?: () => void;
}

export interface CombatGridProps {
  /**
   * Estado AUTORITATIVO vindo do servidor (`Combat.spatial` + `Combatant.spatial`).
   * O grid não mantém segunda fonte de posição: `onCombatChange` recebe o DTO
   * devolvido por cada requisição.
   */
  combat: Pick<
    CombatDto,
    'id' | 'version' | 'status' | 'currentCombatantId' | 'spatial' | 'sceneBackgroundImageUrl'
  > & { combatants: GridUnit[] };
  isMaster: boolean;
  busy?: boolean;
  /**
   * 6.6M.3 — quem pode mover MECANICAMENTE agora (derivação única em
   * `turnControl.movementAuthorityOf`). Sem isso o modo Mover apenas explica o
   * motivo; nenhum gesto inicia draft.
   */
  movement?: MovementAuthority;
  /**
   * AUSENTE/`null` = grid sem targeting (comportamento anterior intacto: clique
   * em token continua sendo placement ou extremo da régua).
   */
  targeting?: GridTargeting | null;
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
type InteractionMode = 'none' | 'placement';

/**
 * Trajeto pretendido LOCAL (nunca persistido, nunca fonte de posição).
 *
 * 6.6M.3.1.3 — DIRECIONADO A DESTINO: existem só a origem autoritativa, o
 * DESTINO mecânico (célula sob o ponteiro) e o path canônico derivado dele. O
 * `pointer` livre serve exclusivamente ao ghost suave; nenhum rastro do mouse
 * entra no `path`.
 */
interface MovementDraft {
  combatantId: string;
  /** Âncora autoritativa no início do draft — base da invalidação por realtime. */
  startPosition: SpatialPosition;
  /** Destino MECÂNICO atual (âncora canônica); `null` = ponteiro fora da cena. */
  destination: SpatialPosition | null;
  /**
   * Âncora do GHOST: canto mínimo do footprint posicionado para o CENTRO cair
   * exatamente sob o ponteiro (pés). Só apresentação.
   */
  pointer: SpatialPosition;
  /** Path direto origem→destino (vazio = sem destino / de volta à origem). */
  path: SpatialPosition[];
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
  position: SpatialPosition;
}

/** Régua: origem + destino opcionais (ponto no grid ou combatente). */
interface RulerState {
  from: SpatialMeasureEndpoint;
  to: SpatialMeasureEndpoint | null;
  locked: boolean;
}

/**
 * 6.6M.3.1.2 — MEASURE TO MOVE: régua FIXA que pode virar Movement.
 *
 * Não é um segundo Movement Engine: o intent é só um PRODUTOR de
 * `combatantId + path` (o resto é o mesmo preview/commit do gesto direto). O
 * `sourcePosition` é o snapshot da origem no momento em que a régua foi fixada
 * — se o combatente andar depois, o trajeto é descartado em vez de reinterpretado.
 */
type MeasureMoveState = 'loading' | 'ready' | 'invalid' | 'executing';

interface MeasureMoveIntent {
  combatantId: string;
  sourcePosition: SpatialPosition;
  path: SpatialPosition[];
  preview: MovementPreviewResponse | null;
  state: MeasureMoveState;
  message: string | null;
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
 * FASE 6.6M.2 — régua (leitura do servidor, linha decorativa).
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
  targeting = null,
  onCombatChange,
  onError,
}: CombatGridProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  /**
   * URL cuja imagem de fundo NÃO carregou. Guarda a própria URL (não um
   * booleano) para que uma troca de cena/imagem volte a tentar naturalmente.
   * Falha de imagem é apresentação: o grid, os tokens e o movimento seguem.
   */
  const [failedBackground, setFailedBackground] = useState<string | null>(null);
  // --- 6.6M.3.1: câmera (estado APENAS local) -------------------------------
  const [camera, setCamera] = useState<GridCamera>({ panX: 0, panY: 0, zoom: 1 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  /**
   * Câmera ENQUADRADA de fato (fit aplicado, ou escolha do usuário com viewport
   * válido). Só vira `true` depois de medir e aplicar o transform: é o que
   * separa `initializing` de `ready` no lifecycle de ativação.
   */
  const [cameraReady, setCameraReady] = useState(false);
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
  // --- 6.6M.3.1.2: Measure to Move (estado APENAS local) -------------------
  const [measureMove, setMeasureMove] = useState<MeasureMoveIntent | null>(null);
  const measureMoveRef = useRef<MeasureMoveIntent | null>(null);
  const measureSequence = useRef(0);
  /**
   * Snapshot da posição AUTORITATIVA no instante em que a régua foi fixada.
   * Se o combatente andar depois, o trajeto medido é desativado — nunca
   * reinterpretado a partir do lugar novo.
   */
  const measureSnapshot = useRef<{ signature: string; position: SpatialPosition } | null>(null);
  /** Execução em voo: novos Space são ignorados (nunca dois commits). */
  const executing = useRef(false);
  /** Space pode virar Movement; vira Pan se o ponteiro arrastar antes do keyup. */
  const spaceCandidate = useRef(false);
  const spacePanUsed = useRef(false);
  /**
   * Posição ANIMADA (apresentação): UMA primitive para Direct Drag E
   * Measure-to-Move, alimentada pelo evento `combat:movement-visual`. O DTO
   * continua sendo a verdade; a animação só desenha o trecho autorizado.
   */
  const movementVisual = useMovementVisual();
  const playMovementVisual = useRef(movementVisual.play);
  playMovementVisual.current = movementVisual.play;
  const previewSequence = useRef(0);
  const operationRef = useRef<string | null>(null);
  const dragMoved = useRef(false);
  const suppressClick = useRef(false);
  const gestureRef = useRef<TokenGesture | null>(null);
  const [grabGesture, setGrabGesture] = useState<TokenGesture | null>(null);
  // --- 6.6M.3.1.3: cursor da régua (ícone real, sem crosshair) --------------
  const rulerCursorRef = useRef<HTMLDivElement | null>(null);
  /**
   * Intenção de alvo para os listeners/gestos já registrados (6.6M.6.4).
   *
   * PRECISA ficar junto dos outros refs, ANTES de qualquer `return` do corpo:
   * o render da cena assistida retorna cedo e, quando este `useRef` vivia
   * depois desse retorno (6.6M.8.1), alternar grid ↔ cena assistida mudava a
   * quantidade de hooks do componente — React #300/#310 derrubavam a tela
   * depois de uma rolagem do ciclo de morte.
   */
  const targetingRef = useRef<GridTargeting | null>(targeting);
  targetingRef.current = targeting;
  /** Última posição do ponteiro no VIEWPORT (px) — inicializa o cursor ícone. */
  const pointerInViewport = useRef<Point2D | null>(null);
  /** O ponteiro já soltou: `lostpointercapture` tardio não pode cancelar. */
  const released = useRef(false);

  const planeRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  const draftRef = useRef<MovementDraft | null>(draft);
  /**
   * Combatente com commit de Movement EM VOO (6.6M.3.1.4.3). Enquanto houver
   * valor aqui, o eco de realtime daquele combatente é o NOSSO movimento e não
   * pode cancelar draft nem régua.
   */
  const committingRef = useRef<string | null>(null);
  const rulerRef = useRef<{ from: SpatialMeasureEndpoint | null; to: SpatialMeasureEndpoint | null }>({
    from: null,
    to: null,
  });
  const lastPointer = useRef<Point2D | null>(null);
  const panGesture = useRef<PanGesture | null>(null);
  const spaceDown = useRef(false);
  /** Câmera já foi escolhida pelo usuário (não reenquadrar sozinha). */
  const cameraTouched = useRef(false);
  /** Cena atual (combate + dimensões): trocar reabre o enquadramento. */
  const sceneKeyRef = useRef('');
  /** A câmera já foi enquadrada com viewport real (nunca em 0×0). */
  const cameraInitialized = useRef(false);

  const scene = combat.spatial;
  /**
   * GRID ATIVO — o efeito colateral que importa.
   *
   * A cena assistida não monta viewport nenhum, mas o componente CONTINUA
   * montado (é ele quem oferece "Ativar grid"). Por isso o bootstrap é
   * REENTRANTE: medição, câmera, wheel e atalhos dependem deste booleano e são
   * instalados de novo a cada `false → true` — nada de exigir F5.
   */
  const active = scene.mode === 'grid-2d';
  const cellSizeFeet = scene.cellSizeFeet || BASE_CELL_SIZE_FEET;
  const geometry = { pixelsPerCell: DEFAULT_PIXELS_PER_CELL, cellSizeFeet };
  const { placed, unplaced } = useMemo(() => splitByPlacement(combat.combatants), [combat.combatants]);
  const dimensions = useMemo(
    () => scenePixels(scene, cellSizeFeet, DEFAULT_PIXELS_PER_CELL),
    [scene, cellSizeFeet],
  );
  /**
   * FUNDO da cena: apresentação da MESMA superfície mecânica. Ausente quando
   * não há cena/imagem (`null`) ou quando a imagem falhou.
   */
  const sceneBackground =
    combat.sceneBackgroundImageUrl && failedBackground !== combat.sceneBackgroundImageUrl
      ? combat.sceneBackgroundImageUrl
      : null;
  /**
   * Contraste da grade (6.6M.4.1.2): análise LOCAL da imagem, só apresentação.
   * Nenhuma regra lê este valor — Movement, alcance e paredes seguem em pés.
   */
  const gridTone = useSceneGridTone(sceneBackground);
  /**
   * LIFECYCLE do grid (estado EXCLUSIVAMENTE local — nada vai ao servidor):
   * `inactive` → `initializing` → `ready`. Ver `gridLifecycle.ts`.
   */
  const gridPhase: GridPhase = gridPhaseOf({
    active,
    viewport,
    scene: dimensions,
    cameraReady,
  });
  const locked = busy || sceneBusy || movementBusy;
  /**
   * Contexto do listener do barramento de movimento (evita reassinar o evento a
   * cada render): combate, unidades visíveis e geometria do momento.
   */
  const visualContextRef = useRef({ combatId: combat.id, units: placed, geometry });
  visualContextRef.current = { combatId: combat.id, units: placed, geometry };

  const movableUnitId = movement?.combatantId ?? null;
  const movableUnit = placed.find((item) => item.id === movableUnitId) ?? null;
  const draftUnit = draft ? (placed.find((item) => item.id === draft.combatantId) ?? null) : null;
  const currentUnit =
    combat.status === 'ACTIVE'
      ? (placed.find((item) => item.id === combat.currentCombatantId) ?? null)
      : null;

  const selectedUnit = mode === 'placement' ? (combat.combatants.find((item) => item.id === selectedId) ?? null) : null;
  const draftDestination = draft?.destination ?? null;

  /* ---------------------------------------------------------------------- */
  /* MEASURE TO MOVE — derivação de ELEGIBILIDADE                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Régua FIXA que nasceu num combatente: essa é a única origem que pode virar
   * Movement. O destino precisa ser um PONTO canônico — terminar sobre outro
   * token não tem posição final inequívoca (nada de sobrepor footprints).
   */
  const measureSourceId =
    ruler && ruler.locked && ruler.from.kind === 'combatant' ? ruler.from.combatantId : null;
  const measureTarget =
    ruler && ruler.locked && ruler.to?.kind === 'point' ? ruler.to.position : null;
  const measureSourceUnit = measureSourceId
    ? (placed.find((item) => item.id === measureSourceId) ?? null)
    : null;
  /**
   * A AUTORIDADE é a MESMA do gesto direto (`movement.combatantId`): turno,
   * controle, morte, deslocamento efetivo e saldo já foram derivados em
   * `turnControl`. Aqui só se exige que a régua tenha nascido nesse combatente.
   */
  const measureMoveEligible = Boolean(
    measureSourceId &&
      measureTarget &&
      measureSourceUnit?.spatial?.position &&
      movableUnitId === measureSourceId,
  );

  cameraRef.current = camera;
  draftRef.current = draft;

  /* ---------------------------------------------------------------------- */
  /* CÂMERA                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * ENQUADRAMENTO INICIAL — não depende de F5 (FASE 6.6M.3.1.4).
   *
   * Bug real: o fit rodava com a PRIMEIRA medição do viewport (que pode ser
   * anterior ao layout final — painel abrindo, aba trocando, fontes carregando)
   * e a flag "inicializado" ficava marcada para sempre. Numa tela maior depois,
   * a cena aparecia deslocada para o canto e só o F5 concertava.
   *
   * Regras:
   *  • `useLayoutEffect` mede ANTES da primeira pintura;
   *  • viewport sem dimensão válida NÃO marca a câmera como inicializada;
   *  • enquanto o usuário não escolheu câmera (pan/zoom), cada medição válida
   *    REENQUADRA — a cena nasce centralizada sem reload;
   *  • depois disso, `combat:updated` NUNCA mexe na câmera (nada de recentralizar
   *    por cima da escolha de quem está jogando);
   *  • trocar a cena (dimensões reais) reabre o enquadramento, porque os bounds
   *    mudaram de verdade;
   *  • 6.6M.3.1.4.1: ATIVAR o grid reexecuta o enquadramento (o viewport só
   *    existe depois da ativação) e a câmera do usuário é PRESERVADA se ainda
   *    for utilizável (`cameraIsUsable`) — nunca herda NaN/zoom inválido.
   */
  useLayoutEffect(() => {
    if (!active) return;
    // Viewport 0×0 (recém-ativado, painel ainda assentando) NÃO enquadra e NÃO
    // marca a câmera como pronta: o ResizeObserver avisa quando houver medida.
    if (viewport.width <= 0 || viewport.height <= 0) return;
    if (dimensions.width <= 0 || dimensions.height <= 0) return;
    const sceneKey = `${combat.id}:${dimensions.width.toFixed(1)}x${dimensions.height.toFixed(1)}`;
    if (sceneKeyRef.current !== sceneKey) {
      sceneKeyRef.current = sceneKey;
      cameraTouched.current = false;
      cameraInitialized.current = false;
    }
    // Câmera do usuário só é mantida se ainda descreve esta cena: trocar de
    // combate/dimensões (ou herdar estado corrompido) volta para o fit.
    const preserved = cameraRef.current;
    const keepCamera =
      cameraTouched.current && cameraInitialized.current && cameraIsUsable(preserved);
    setCamera(
      keepCamera
        ? clampCamera(preserved, dimensions, viewport)
        : fitCamera({ scene: dimensions, viewport, margin: CAMERA_FIT_MARGIN_PX }),
    );
    cameraInitialized.current = true;
    setCameraReady(true);
  }, [active, combat.id, dimensions, viewport]);

  /**
   * INACTIVE ← viewport/estado de interação.
   *
   * Desligar o grid tira o viewport do DOM, então a medição e a prontidão são
   * zeradas e a próxima ativação mede o viewport novo. A CÂMERA é preservada
   * (mesmo combate, mesma cena): quem decide reenquadrar é o fit pendente, não
   * o desligamento. Nenhuma interação pendente sobrevive à desativação.
   */
  useLayoutEffect(() => {
    if (active) return;
    setViewport((current) =>
      current.width === 0 && current.height === 0 ? current : { width: 0, height: 0 },
    );
    setCameraReady(false);
    clearRuler();
    clearDraft();
    setDraftNotice(null);
    setPendingNotice(null);
    setMode('none');
    // `clearRuler`/`clearDraft` só tocam estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /**
   * ResizeObserver: a fonte da medição do viewport.
   *
   * Medir uma vez no mount não basta (o grid pode montar antes do layout
   * assentar). Aqui a primeira leitura já é sincronizada com o layout e cada
   * mudança real de tamanho chega por callback — sem `setTimeout` arbitrário.
   */
  useLayoutEffect(() => {
    // INACTIVE: sem grid montado não existe viewport para observar. Este efeito
    // roda DE NOVO na ativação (`active` é dependência) — era o `[]` que deixava
    // a primeira ativação sem medição, sem câmera e sem wheel, obrigando a F5.
    if (!active) return undefined;
    const node = viewportRef.current;
    if (!node) return undefined;
    const measure = (width: number, height: number): void => {
      setViewport((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure(node.clientWidth, node.clientHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      measure(rect.width, rect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  function applyCamera(next: GridCamera): void {
    // Pan/zoom/fit do usuário encerram o enquadramento automático: a câmera
    // passa a ser dele e nenhum resize fica recentralizando por cima.
    cameraTouched.current = true;
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
    // O listener nativo vive no viewport da INSTÂNCIA ativa: sem grid não há
    // nó para receber roda e Ctrl+roda.
    if (!active) return undefined;
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
  }, [active, dimensions.width, dimensions.height, viewport.width, viewport.height]);

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

  /**
   * Ícone do cursor da régua acompanha o ponteiro.
   *
   * A posição e a visibilidade vão por `style` (sem estado React por pixel):
   * a cena não re-renderiza a cada movimento e o ícone nunca fica desalinhado.
   */
  function trackRulerCursor(clientX: number, clientY: number): void {
    const point = viewportPoint(clientX, clientY);
    if (!point) return;
    pointerInViewport.current = point;
    const node = rulerCursorRef.current;
    if (!node) return;
    node.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    node.style.opacity = '1';
  }

  /** Montagem do ícone: nasce no último ponto conhecido (sem salto para 0,0). */
  function attachRulerCursor(node: HTMLDivElement | null): void {
    rulerCursorRef.current = node;
    if (!node) return;
    const point = pointerInViewport.current;
    node.style.opacity = point ? '1' : '0';
    if (point) node.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  }

  /** Saiu do grid: cursor de régua escondido (o nativo volta fora daqui). */
  function handleViewportPointerLeave(): void {
    pointerInViewport.current = null;
    if (rulerCursorRef.current) rulerCursorRef.current.style.opacity = '0';
    setHoverAnchor(null);
  }

  /** Ponteiro (cliente) → PÉS na cena, com pan/zoom aplicados. */
  function feetAt(clientX: number, clientY: number): SpatialPosition | null {
    const point = viewportPoint(clientX, clientY);
    if (!point) return null;
    return screenToFeet(cameraRef.current, point, geometry);
  }

  /**
   * Âncora canônica da CÉLULA QUE CONTÉM o ponteiro.
   *
   * Única interpretação de "qual casa está sob o mouse": `floor` (nunca a
   * interseção mais próxima), footprint-aware e `null` fora da cena — régua,
   * placement, hover e destino do gesto leem o ponteiro por aqui. O zoom/pan já
   * foram removidos em `feetAt`.
   *
   * O ponteiro entra CRU: nenhum deslocamento por meia footprint é aplicado
   * antes de decidir a célula. Recuar o ponto primeiro fazia um Medium com o
   * mouse a 7 pés (célula 5–10) cair na célula 0–5 — o destino trocava de casa
   * sem o ponteiro cruzar a linha.
   */
  function cellAnchorAt(
    clientX: number,
    clientY: number,
    size: SpatialSize,
  ): SpatialPosition | null {
    const feet = feetAt(clientX, clientY);
    if (!feet) return null;
    return containingCellFeet(feet, size, scene);
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

  // A régua tem UMA entrada: a tecla F ("Medir" saiu da toolbar na 6.6M.3.1.4).
  // Touch/mobile ainda não tem equivalente — limitação de UX registrada.
  const rulerActive = quickRuler || ruler !== null;
  /**
   * CURSOR DE RÉGUA: enquanto o usuário está APONTANDO (F armado ou régua
   * aberta), o ponteiro vira um ícone de régua e o cursor nativo some. Ao fixar
   * o segundo ponto (ou cancelar) volta ao normal.
   */
  const rulerCursorActive = ruler ? !ruler.locked : quickRuler;

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

  /**
   * Ponto da régua = a CÉLULA sob o ponteiro (não a interseção mais próxima).
   * A âncora enviada ao servidor continua canônica (canto mínimo da célula) e o
   * marcador é desenhado no CENTRO dessa célula — o traço visual e o trajeto
   * medido são a mesma reta, só deslocada meio passo.
   */
  function pointEndpointAt(clientX: number, clientY: number): SpatialMeasureEndpoint | null {
    const position = cellAnchorAt(clientX, clientY, 'small');
    if (!position) return null;
    return { kind: 'point', position };
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
   * (Posicionar/régua), Space e o botão do meio têm PRECEDÊNCIA.
   */
  function armTokenGesture(combatantId: string, event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    if (spaceDown.current || rulerActive || locked) return;
    if (mode !== 'none') return;
    if (movableUnitId !== combatantId) return;
    const unit = placed.find((item) => item.id === combatantId);
    const position = unit?.spatial?.position ?? null;
    if (!unit?.spatial || !position) return;
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
      position,
    };
    gestureRef.current = gesture;
    setGrabGesture(gesture);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  /**
   * Cria o DRAFT (o token real NÃO sai do lugar): origem autoritativa + destino
   * mecânico atual. O trajeto é sempre DERIVADO, nunca acumulado do ponteiro.
   */
  function beginDraft(gesture: TokenGesture, clientX: number, clientY: number): void {
    operationRef.current = null;
    dragMoved.current = true;
    setDraftNotice(null);
    setPendingNotice(null);
    setPreview(null);
    setPreviewState('idle');
    const next: MovementDraft = {
      combatantId: gesture.combatantId,
      startPosition: gesture.position,
      destination: null,
      pointer: gesture.position,
      path: [],
    };
    draftRef.current = next;
    setDraft(next);
    updateDraftAt(clientX, clientY);
  }

  /**
   * Atualiza o DESTINO mecânico a partir do ponteiro.
   *
   * Só quando a célula apontada muda o path é RECONSTRUÍDO (origem→destino) e o
   * preview é refeito: zigue-zague dentro da mesma célula não gera passos, não
   * gasta Movement e não cria requisição. O ghost, que é apresentação, continua
   * livre e suave entre uma célula e outra.
   */
  function updateDraftAt(clientX: number, clientY: number): void {
    const current = draftRef.current;
    if (!current) return;
    const unit = placed.find((item) => item.id === current.combatantId);
    if (!unit?.spatial) return;
    const size = unit.spatial.effectiveSize;
    const feet = feetAt(clientX, clientY);
    if (!feet) return;
    // A CÉLULA MECÂNICA nasce do ponteiro CRU (regra canônica de `cellAnchorAt`):
    // usar aqui a âncora já recuada do ghost fazia o destino pular para a célula
    // de cima enquanto o mouse ainda estava na de baixo.
    const destination = containingCellFeet(feet, size, scene);
    // GHOST = CURSOR: o centro do footprint fica sob o ponteiro (o ponto de
    // pega do clique não vale durante o draft). Ghost e destino são conceitos
    // diferentes de propósito: o ghost acompanha o mouse, o destino já está
    // snapado na célula que o mouse aponta.
    const pointer = centeredFootprintFeet(feet, size, scene);
    const sameDestination =
      current.destination === null
        ? destination === null
        : destination !== null &&
          destination.xFeet === current.destination.xFeet &&
          destination.yFeet === current.destination.yFeet;
    if (sameDestination) {
      if (pointer.xFeet === current.pointer.xFeet && pointer.yFeet === current.pointer.yFeet) return;
      const next = { ...current, pointer };
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const backHome =
      destination !== null &&
      destination.xFeet === current.startPosition.xFeet &&
      destination.yFeet === current.startPosition.yFeet;
    const path =
      destination && !backHome
        ? contiguousAnchors(current.startPosition, destination, anchorStepFeet(size))
        : [];
    const next: MovementDraft = { ...current, pointer, destination, path };
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
   *
   * 6.6M.3.1.4.3 — COMMIT PRÓPRIO não invalida o próprio draft: entre o
   * `pointerup` e a resposta HTTP, o `combat:updated`/`combat:movement-visual`
   * do NOSSO movimento chega pelo socket e muda a posição autoritativa. Quem
   * arbitra esse intervalo é o SERVIDOR (`expectedVersion` + `operationId`);
   * anunciar cancelamento aqui era falso positivo. Mudança EXTERNA enquanto o
   * usuário ainda arrasta continua cancelando normalmente.
   */
  useEffect(() => {
    if (!draft) return;
    if (committingRef.current === draft.combatantId) return;
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
   * MEASURE TO MOVE — preview SÓ depois de fixar a régua.
   *
   * Enquanto o cursor ainda está medindo (régua aberta) o cliente usa apenas
   * `spatial/measure`; o Movement Preview começa no segundo clique, quando o
   * trajeto já é uma intenção. `combat.version` revalida depois de Dash, reação
   * ou ajuste do Mestre (a régua em si não é invalidada por versão).
   */
  const measureMoveSignature = measureMoveEligible ? `${rulerFromKey}|${rulerToKey}` : null;
  useEffect(() => {
    const signature = measureMoveSignature;
    const unit = measureMoveEligible ? measureSourceUnit : null;
    const target = measureMoveEligible ? measureTarget : null;
    if (!signature || !unit?.spatial?.position || !target) {
      measureSequence.current += 1;
      measureSnapshot.current = null;
      measureMoveRef.current = null;
      setMeasureMove(null);
      return;
    }
    const current = unit.spatial.position;
    const snapshot = measureSnapshot.current;
    if (!snapshot || snapshot.signature !== signature) {
      measureSnapshot.current = { signature, position: current };
    } else if (
      snapshot.position.xFeet !== current.xFeet ||
      snapshot.position.yFeet !== current.yFeet
    ) {
      // A origem saiu do lugar: a régua continua medindo, mas não oferece
      // Movement para um trajeto que começava em outro ponto.
      const moved: MeasureMoveIntent = {
        combatantId: unit.id,
        sourcePosition: snapshot.position,
        path: [],
        preview: null,
        state: 'invalid',
        message: 'A origem do movimento mudou: meça novamente.',
      };
      measureSequence.current += 1;
      measureMoveRef.current = moved;
      setMeasureMove(moved);
      return;
    }
    // O path é INTERPOLADO pela mesma função do gesto direto, a partir da
    // posição autoritativa (nunca `path[0] = origem`).
    const startPosition = measureSnapshot.current?.position ?? current;
    const path = contiguousAnchors(
      startPosition,
      target,
      anchorStepFeet(unit.spatial.effectiveSize),
    );
    const last = path.length > 0 ? path[path.length - 1] : startPosition;
    const aligned =
      path.length > 0 && last.xFeet === target.xFeet && last.yFeet === target.yFeet;
    if (!aligned) {
      const intent: MeasureMoveIntent = {
        combatantId: unit.id,
        sourcePosition: startPosition,
        path,
        preview: null,
        state: 'invalid',
        message:
          path.length === 0
            ? 'O destino é a posição atual.'
            : 'O destino não está alinhado ao grid.',
      };
      measureSequence.current += 1;
      measureMoveRef.current = intent;
      setMeasureMove(intent);
      return;
    }
    measureSequence.current += 1;
    const sequence = measureSequence.current;
    const pending: MeasureMoveIntent = {
      combatantId: unit.id,
      sourcePosition: startPosition,
      path,
      preview: null,
      state: 'loading',
      message: null,
    };
    measureMoveRef.current = pending;
    setMeasureMove(pending);
    previewMovement(combat.id, { combatantId: unit.id, path })
      .then((response) => {
        // Resposta de uma régua anterior NUNCA atualiza a atual.
        if (measureSequence.current !== sequence) return;
        const ready = response.movement.legal && response.movement.affordable;
        const next: MeasureMoveIntent = {
          ...pending,
          preview: response,
          state: ready ? 'ready' : 'invalid',
          message: ready ? null : movementIssueLabel(response.movement),
        };
        measureMoveRef.current = next;
        setMeasureMove(next);
      })
      .catch((error: unknown) => {
        if (measureSequence.current !== sequence) return;
        const next: MeasureMoveIntent = {
          ...pending,
          state: 'invalid',
          message: error instanceof Error ? error.message : 'Não foi possível avaliar o trajeto.',
        };
        measureMoveRef.current = next;
        setMeasureMove(next);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat.id, combat.version, measureMoveEligible, measureMoveSignature]);

  /** REALTIME durante a animação: o estado autoritativo de OUTRA versão vence. */
  useEffect(() => {
    movementVisual.syncVersion(combat.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat.version]);

  /**
   * ESPECTADOR: o mesmo evento que o operador recebe é o que anima aqui.
   * Nenhum caminho alternativo (HTTP do operador, estado local, localStorage).
   */
  useEffect(
    () =>
      subscribeMovementVisual((payload) => {
        const context = visualContextRef.current;
        if (payload.combatId !== context.combatId) return;
        const unit = context.units.find((item) => item.id === payload.combatantId);
        const size = unit?.spatial?.effectiveSize;
        // Combatente fora da projeção autorizada (master-only/removido): nada.
        if (!size) return;
        playMovementVisual.current(payload, size, context.geometry);
      }),
    [],
  );

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
      if (draftRef.current) updateDraftAt(event.clientX, event.clientY);
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
      const point = pointer ? viewportPoint(pointer.x, pointer.y) : null;
      if (pointer && point) {
        // Três sistemas separados: borda em px de TELA (viewport), intenção de
        // REVELAR e só então delta de câmera — a borda direita revela a direita.
        const intent = revealIntentAt(
          point,
          { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
          AUTO_PAN_EDGE_PX,
        );
        const delta = autoPanCameraDelta(intent, AUTO_PAN_MAX_SPEED);
        if (delta.dx !== 0 || delta.dy !== 0) {
          const next = bounded(panBy(cameraRef.current, delta.dx, delta.dy));
          // Na borda real da cena o clamp devolve a MESMA câmera: parar de
          // escrever evita re-render inútil e oscilação no limite.
          if (next.panX !== cameraRef.current.panX || next.panY !== cameraRef.current.panY) {
            cameraRef.current = next;
            setCamera(next);
            // O ponteiro NÃO se moveu, mas a câmera sim: reprojetar é o que faz
            // o destino mecânico (e o path origem→destino) avançar de célula.
            updateDraftAt(pointer.x, pointer.y);
          }
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
      // Daqui até a resposta, o draft está em COMMIT: qualquer eco do socket
      // sobre ESTE combatente é o nosso movimento, não uma invalidação.
      committingRef.current = combatantId;
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
      committingRef.current = null;
      setMovementBusy(false);
    }
  }

  /**
   * MEDIR + SPACE = PERCORRER o trajeto medido (nunca teleporte).
   *
   * O servidor revalida o caminho AGORA (o preview exibido não é autoridade) e
   * só então há commit, com `expectedVersion` e um `operationId` por tentativa.
   * Em falha a RÉGUA PERMANECE — a decisão continua analisável, diferente do
   * gesto direto, em que o draft termina sozinho.
   */
  async function executeMeasureMove(): Promise<void> {
    if (executing.current || movementBusy) return;
    const intent = measureMoveRef.current;
    if (!intent || intent.state !== 'ready' || intent.path.length === 0) return;
    const unit = placed.find((item) => item.id === intent.combatantId);
    const position = unit?.spatial?.position ?? null;
    const sourceMoved =
      !position ||
      position.xFeet !== intent.sourcePosition.xFeet ||
      position.yFeet !== intent.sourcePosition.yFeet ||
      (movement ? movement.combatantId !== intent.combatantId : false);
    if (sourceMoved) {
      // Origem diferente do snapshot fixado: não reinterpretar o trajeto antigo.
      const stale: MeasureMoveIntent = {
        ...intent,
        state: 'invalid',
        message: 'A origem do movimento mudou: meça novamente.',
      };
      measureMoveRef.current = stale;
      setMeasureMove(stale);
      return;
    }
    executing.current = true;
    setMovementBusy(true);
    setSceneError(null);
    const running: MeasureMoveIntent = { ...intent, state: 'executing', message: null };
    measureMoveRef.current = running;
    setMeasureMove(running);
    try {
      const fresh = await previewMovement(combat.id, {
        combatantId: intent.combatantId,
        path: intent.path,
      });
      if (!fresh.movement.legal || !fresh.movement.affordable) {
        const blocked: MeasureMoveIntent = {
          ...running,
          preview: fresh,
          state: 'invalid',
          message: movementIssueLabel(fresh.movement),
        };
        measureMoveRef.current = blocked;
        setMeasureMove(blocked);
        return;
      }
      operationRef.current ??= createOperationId();
      // Mesmo contrato do gesto direto: o eco do NOSSO commit não invalida a
      // régua que acabou de ser percorrida.
      committingRef.current = intent.combatantId;
      const result = await commitMovement(combat, {
        combatantId: intent.combatantId,
        path: intent.path,
        operationId: operationRef.current,
      });
      operationRef.current = null;
      onCombatChange(result.combat);
      setDraftNotice(
        result.pending
          ? result.pending.awaitingMaster
            ? 'Aguardando resolução do Mestre.'
            : 'Movimento pausado por reação.'
          : null,
      );
      // A peça desliza pelo trecho que o SERVIDOR confirmou — e quem anima é o
      // evento `combat:movement-visual`, a MESMA primitive do Direct Drag e dos
      // espectadores (com Reação pendente, para no checkpoint).
      onCombatChange(result.combat);
      clearRuler();
    } catch (error) {
      setSceneError(messageOf(error));
      onError(messageOf(error));
      const failed: MeasureMoveIntent = {
        ...running,
        state: 'invalid',
        message: messageOf(error),
      };
      measureMoveRef.current = failed;
      setMeasureMove(failed);
    } finally {
      committingRef.current = null;
      executing.current = false;
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
    // Space sendo usado para PAN não pode executar Movement no keyup.
    if (spaceDown.current) spacePanUsed.current = true;
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
    // O ícone do cursor da régua acompanha o ponteiro; a posição vai por style
    // (sem estado React por pixel) para não re-renderizar a cena a cada move.
    trackRulerCursor(event.clientX, event.clientY);
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
    // Célula sob o cursor: só apresentação (nunca validação local). `null` =
    // ponteiro fora da cena, então nada é destacado.
    const anchor = cellAnchorAt(event.clientX, event.clientY, 'small');
    if (
      (!hoverAnchor && !anchor) ||
      (hoverAnchor && anchor && hoverAnchor.xFeet === anchor.xFeet && hoverAnchor.yFeet === anchor.yFeet)
    ) {
      return;
    }
    setHoverAnchor(anchor);
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
    // TARGETING: clique no FUNDO fecha o menu de modo e limpa o alvo escolhido
    // (não escolhe combatente nem executa nada). O clique DENTRO do menu para
    // a propagação, então escolher um modo nunca cai aqui.
    if (targetingActive) {
      targeting?.onClearTarget();
      return;
    }
    if (mode !== 'placement') return;
    if (!isMaster || !selectedId || locked) return;
    const unit = combat.combatants.find((item) => item.id === selectedId);
    if (!unit?.spatial) return;
    // A célula que CONTÉM o ponteiro é a célula do placement.
    const anchor = cellAnchorAt(event.clientX, event.clientY, unit.spatial.effectiveSize);
    if (!anchor) return;
    void place(selectedId, anchor);
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
    const anchor = cellAnchorAt(event.clientX, event.clientY, unit.spatial.effectiveSize);
    if (!anchor) return;
    void place(combatantId, anchor);
  }

  /**
   * DUPLO CLIQUE no token: com targeting ativo e alvo elegível ele EXECUTA o
   * ataque (mesmo envio do botão); caso contrário continua centralizando a
   * câmera, como antes. O gesto nunca rola dado no cliente.
   */
  function handleTokenDoubleClick(combatantId: string): void {
    const live = targetingRef.current;
    if (live?.active && live.targetableIds.includes(combatantId) && live.onExecuteTarget) {
      live.onPickTarget(combatantId);
      live.onExecuteTarget(combatantId);
      return;
    }
    centerOnCombatant(combatantId);
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
    if (mode === 'placement') {
      setSelectedId(combatantId);
      return;
    }
    // TARGETING (6.6M.6.4) — por último de propósito: régua e placement já
    // retornaram acima, então o clique de alvo nunca sequestra esses gestos.
    // O clique sintético do fim do arrasto foi descartado no topo.
    const picked = gridTargetPick({
      targetingActive,
      targetableIds: targeting?.targetableIds ?? [],
      combatantId,
      rulerActive,
      placementActive: false,
    });
    if (picked) targeting?.onPickTarget(picked);
  }

  /* ---------------------------------------------------------------------- */
  /* ATALHOS (F = régua rápida, Esc, Space = pan)                            */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    // INACTIVE: F/Space/Esc são atalhos DO GRID — sem viewport montado não
    // existe régua, pan nem movimento para eles acionarem.
    if (!active) return undefined;
    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return;
      if (event.altKey) return;
      if (event.key === 'Escape') {
        if (ruler || quickRuler) clearRuler();
        if (draft) cancelDraft('Movimento cancelado.');
        // 6.6M.6.4.3 — Esc encerra o FLUXO INTEIRO: fecha o menu de modo, limpa
        // o alvo e desmarca a ação escolhida na Hotbar (o painel desmonta).
        // Continua sendo estado de UI: nenhum ataque em voo é afetado.
        const liveTargeting = targetingRef.current;
        if (liveTargeting?.active) liveTargeting.onCancelFlow?.();
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (spaceDown.current) return;
        spaceDown.current = true;
        setSpacePan(true);
        event.preventDefault();
        // Space só vira Movement se houver régua fixa EXECUTÁVEL; o commit
        // espera o keyup, para Space+drag continuar sendo PAN.
        if (!event.repeat) {
          const intent = measureMoveRef.current;
          spaceCandidate.current = Boolean(
            intent && intent.state === 'ready' && !executing.current,
          );
          spacePanUsed.current = false;
        }
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
        const candidate = spaceCandidate.current && !event.altKey;
        const panned = spacePanUsed.current;
        spaceCandidate.current = false;
        spacePanUsed.current = false;
        if (candidate && !panned) void executeMeasureMove();
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
  }, [active, ruler, quickRuler, draft, combat.spatial.mode, rulerActive]);

  const ping = useGridPing({
    combatId: combat.id, enabled: active && combat.status !== 'ENDED',
    positionAt: feetAt, widthFeet: scene.widthFeet, heightFeet: scene.heightFeet,
    onError,
    onStart: () => {
      spaceCandidate.current = false;
      panGesture.current = null;
      gestureRef.current = null;
      setGrabGesture(null);
      if (!committingRef.current && !executing.current && draftRef.current) cancelDraft();
    },
  });

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
  /**
   * 6.6M.6.4 — TARGETING (só apresentação/encaminhamento): com uma ação escolhida
   * na Hotbar, tokens elegíveis deixam de ser "só cenário" e passam a receber
   * clique. Quem decide se o ataque vale continua sendo o servidor.
   */
  const targetingActive = Boolean(targeting?.active);
  // `targetingRef` (useRef) é declarado no TOPO do componente (junto dos
  // outros refs): hooks não podem viver depois do return da cena assistida.
  const isTargetable = (combatantId: string): boolean =>
    targetingActive && Boolean(targeting?.targetableIds.includes(combatantId));
  /** Token utilizável: régua > gesto de movimento do dono > placement do Mestre. */
  const tokenInteractive = (combatant: GridUnit): boolean =>
    rulerActive ? true : movementInteractive ? movableUnitId === combatant.id : placementInteractive;

  const hint = rulerActive
    ? ruler?.locked
      ? measureMove?.state === 'ready'
        ? 'Espaço percorre o trajeto medido · clique mede de novo · Esc limpa.'
        : measureMove?.state === 'executing'
          ? 'Percorrendo o trajeto medido…'
          : 'Régua fixada. Clique para medir de novo; botão direito ou Esc limpa.'
      : ruler
        ? 'Mova o cursor e clique no destino para fixar a régua.'
        : quickRuler
          ? 'Clique na origem (token ou espaço vazio) para puxar a régua.'
          : 'Clique na origem da régua (token ou espaço vazio).'
    : mode === 'placement'
      ? isMaster
        ? 'Selecione uma unidade e clique no mapa — ou arraste da bandeja.'
        : 'Visualização da cena.'
      : targetingActive
        ? targeting?.selectedTargetId
          ? targeting?.rollMenuOpen
            ? 'Escolha o modo de rolagem no menu do alvo · duplo clique confirma · Esc cancela.'
            : targeting?.rollMode
              ? `Modo ${ROLL_MODE_LABELS[targeting.rollMode]} · clique no alvo troca o modo · duplo clique confirma · Esc cancela.`
              : 'Escolha o modo de rolagem no menu do alvo · duplo clique confirma · Esc cancela.'
          : 'Selecione um alvo no grid · duplo clique rola o ataque.'
      : movement && !movement.combatantId
        ? (movement.reason ?? 'Nenhum combatente pode se mover agora.')
        : isMaster
          ? 'Arraste o token do turno para mover · Posicionar coloca unidades · F mede.'
          : 'Arraste o seu token para mover · Space/botão do meio arrastam a câmera · F mede.';

  const planeClasses = [
    'grid-plane',
    placementInteractive && selectedId ? 'is-placing' : '',
    rulerActive ? 'is-measuring' : '',
    draft ? 'is-drafting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const viewportClasses = [
    'grid-viewport',
    ping.holdingAlt ? 'is-pinging' : '',
    gridPhase !== 'ready' ? 'is-initializing' : '',
    panGesture.current?.moved ? 'is-panning' : '',
    spacePan ? 'is-space-pan' : '',
    rulerCursorActive ? 'is-ruler-cursor' : '',
    draft ? 'is-drafting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * CAIXAS VISUAIS (6.6M.4.1.4) — hover e destino passam pela MESMA projeção
   * do token (`spatialRectToScenePixels`), não por conta inline própria.
   * A decisão de célula continua sendo a da 6.6M.4.1.3: aqui só se desenha o
   * retângulo do footprint que já foi escolhido.
   */
  const destinationBox =
    draftDestination && draftUnit?.spatial
      ? spatialRectToScenePixels(
          {
            xFeet: draftDestination.xFeet,
            yFeet: draftDestination.yFeet,
            widthFeet: SIZE_FOOTPRINT_FEET[draftUnit.spatial.effectiveSize].widthFeet,
            heightFeet: SIZE_FOOTPRINT_FEET[draftUnit.spatial.effectiveSize].heightFeet,
          },
          cellSizeFeet,
          DEFAULT_PIXELS_PER_CELL,
        )
      : null;
  const hoverBox = hoverAnchor
    ? spatialRectToScenePixels(
        {
          xFeet: hoverAnchor.xFeet,
          yFeet: hoverAnchor.yFeet,
          widthFeet: cellSizeFeet,
          heightFeet: cellSizeFeet,
        },
        cellSizeFeet,
        DEFAULT_PIXELS_PER_CELL,
      )
    : null;

  const draftOriginScene = draft && draftUnit ? footprintCenterPx(draftUnit) : null;
  const draftTraceFrom = draftOriginScene ? sceneToScreen(camera, draftOriginScene) : null;
  const draftTraceTo = draft && draftDestination ? anchorScreen(draftDestination) : null;

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

  /**
   * MENU DE MODO (6.6M.6.4.3) — âncora na BORDA INFERIOR do footprint do alvo,
   * projetada em px de TELA. Fica acima do token quando não cabe embaixo e
   * nunca vaza nas laterais; nada aqui depende de zoom, então o menu não escala.
   */
  const rollMenuAnchor = (() => {
    if (!targetingActive || !targeting?.selectedTargetId) return null;
    // O menu só aparece quando o fluxo pede: no primeiro clique e em TODO novo
    // clique no alvo, para o jogador trocar o modo (6.6M.6.4.5).
    if (!targeting.rollMenuOpen) return null;
    const unit = placed.find((item) => item.id === targeting.selectedTargetId);
    const space = unit?.spatial?.occupiedSpace;
    const box = space ? occupiedSpacePixels(space, cellSizeFeet, DEFAULT_PIXELS_PER_CELL) : null;
    if (!box) return null;
    const centerX = sceneToScreen(camera, { x: box.left + box.width / 2, y: box.top }).x;
    const bottom = sceneToScreen(camera, { x: 0, y: box.top + box.height }).y;
    const top = sceneToScreen(camera, { x: 0, y: box.top }).y;
    // Medidas do menu em px (mesmas do CSS): só para o clamp de borda.
    const halfWidth = 88;
    const height = 62;
    const left = Math.min(
      Math.max(centerX, halfWidth + 6),
      Math.max(viewport.width - halfWidth - 6, halfWidth + 6),
    );
    const fitsBelow = bottom + 8 + height <= viewport.height;
    return { left, top: fitsBelow ? bottom + 8 : Math.max(top - height - 8, 6) };
  })();

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
    <section
      className="combat-grid-panel"
      aria-label="Cena de combate"
      data-grid-phase={gridPhase}
    >
      {isMaster ? (
        <details className="grid-master-settings" onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}>
          <summary><Icon name="gear" size={14} /> Cena e posicionamento{mode === 'placement' ? ' · Posicionando' : ''}</summary>
          <div className="grid-master-settings-content">
      {/*
        TOOLBAR — SÓ ADMINISTRAÇÃO (6.6M.6.1.5). A câmera saiu daqui: virou
        overlay DENTRO do palco. Esta linha existe apenas para o Mestre
        (ferramenta de posicionamento); na visão do jogador ela NÃO é montada,
        então a altura acima do mapa é zero em vez de "escondida por CSS".

        Não existe botão "Mover" (o movimento é o GESTO no token do turno) nem
        botão "Medir" (a régua é a tecla F), e nada de placeholder vazio.
      */}
      {isMaster ? (
        <div className="grid-toolbar">
          <div className="grid-toolbar-left">
            <div className="grid-modes" role="group" aria-label="Ferramenta do grid">
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={mode === 'placement'}
                disabled={locked}
                onClick={() => changeMode(mode === 'placement' ? 'none' : 'placement')}
              >
                Posicionar
              </button>
            </div>
            {currentUnit ? (
              <span className="grid-turn">
                Turno de <strong>{currentUnit.name}</strong>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Administração da cena (ativação, dimensões, modo assistido): o MESMO
          componente de sempre, no fluxo, exclusivo do Mestre. */}
      {isMaster ? (
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
      ) : null}

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

          </div>
        </details>
      ) : null}

      {/* Erro da cena do MESTRE fica no fluxo (contexto administrativo). O do
          jogador aparece sobreposto, logo abaixo — nada empurra o palco. */}
      {isMaster && sceneError ? (
        <p className="grid-scene-error" role="status">
          {sceneError}
        </p>
      ) : null}

      <div className="grid-stage">
        {/*
          JOGADOR: o palco NÃO exibe turno nem dimensões (6.6M.6.1.5.1). O
          Obsyrium já informa o turno fora do mapa e as dimensões são
          administrativas: nenhum chip permanente ocupa a superfície de
          combate. Só o ERRO REAL da cena aparece aqui — e só quando acontece
          (sem aviso permanente, sem região vazia reservada).
        */}
        {!isMaster && sceneError ? (
          <p className="grid-scene-error grid-scene-error-inset" role="status">
            {sceneError}
          </p>
        ) : null}

        <div
          ref={viewportRef}
          className={viewportClasses}
          {...ping.capture}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerLeave={handleViewportPointerLeave}
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
                } as CSSProperties
              }
              data-scene-mode={scene.mode}
            >
              {/*
                FUNDO DA SCENE (6.6M.4.1.1) — primeira camada do plano: ocupa
                exatamente os bounds mecânicos (`dimensions`, derivado de
                `spatial`), então pan/zoom movem imagem, grade e tokens juntos.
                `object-fit: fill` de propósito: a arte representa a CENA
                inteira; `cover`/`contain` deslocariam a correspondência entre
                pixel do mapa e coordenada em pés.
              */}
              {sceneBackground ? (
                <img
                  className="grid-scene-background"
                  src={sceneBackground}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  onError={() => setFailedBackground(sceneBackground)}
                />
              ) : null}

              {/*
                GRADE ÚNICA (6.6M.4.1.2) — overlay SVG presentacional, ACIMA do
                fundo e ABAIXO dos tokens. O mesmo componente monta a grade do
                preview da cena, então não existe segundo renderer: o `viewBox`
                está em PÉS e as linhas se repetem em coordenadas, não em
                pixels, o que mantém o espaçamento exato em qualquer zoom.
              */}
              <SpatialGridOverlay
                widthFeet={scene.widthFeet}
                heightFeet={scene.heightFeet}
                cellSizeFeet={cellSizeFeet}
                tone={gridTone}
              />

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
                  measureRole={rulerActive ? measureRoleOf(combatant.id) : null}                    visualRect={
                      movementVisual.visualRect?.combatantId === combatant.id
                        ? movementVisual.visualRect
                        : null
                    }
                  interactive={tokenInteractive(combatant)}
                  movable={!locked && !rulerActive && mode === 'none' && movableUnitId === combatant.id}
                  rulerActive={rulerActive}
                  targetable={isTargetable(combatant.id)}
                  targetPicked={targeting?.selectedTargetId === combatant.id}
                  rollMode={
                    targeting?.selectedTargetId === combatant.id
                      ? (targeting?.rollMode ?? null)
                      : null
                  }
                  onSelect={selectUnit}
                  onMoveStart={armTokenGesture}
                  onCenter={handleTokenDoubleClick}
                  onHover={rulerActive && measureInteractive ? setHoverTokenId : undefined}
                />
              ))}

              {/* GHOST livre: acompanha o ponteiro; o token real fica na origem. */}
              {draft && draftUnit?.spatial ? (
                <GridMovementOverlay
                  ghost={{
                    position: draft.pointer,
                    size: draftUnit.spatial.effectiveSize,
                    imageRef: draftUnit.spatial.tokenImageRef,
                  }}
                  cellSizeFeet={cellSizeFeet}
                  pixelsPerCell={DEFAULT_PIXELS_PER_CELL}
                />
              ) : null}

              {/* Destino MECÂNICO snapado: um ÚNICO ghost + o footprint do destino. */}
              {draft && draft.path.length > 0 && destinationBox ? (
                <div
                  className="grid-destination-cell"
                  aria-hidden="true"
                  data-destination="true"
                  style={{
                    left: `${destinationBox.left}px`,
                    top: `${destinationBox.top}px`,
                    width: `${destinationBox.width}px`,
                    height: `${destinationBox.height}px`,
                  }}
                />
              ) : null}

              {/* Célula sob o cursor — highlight sutil, sem fingir validade. */}
              {hoverBox && rulerActive ? (
                <div
                  className="grid-hover-cell"
                  aria-hidden="true"
                  style={{
                    left: `${hoverBox.left}px`,
                    top: `${hoverBox.top}px`,
                    width: `${hoverBox.width}px`,
                    height: `${hoverBox.height}px`,
                  }}
                />
              ) : null}
            </div>
          </div>

          <GridPings pings={ping.pings} camera={camera} geometry={geometry} />
          <span className="grid-ping-hint">Alt + clique: sinalizar ponto</span>

          {/* TRAÇO do movimento: reta tracejada origem→destino, em TELA. */}
          {draft && draft.path.length > 0 && draftTraceFrom && draftTraceTo ? (
            <GridMovementTrace
              points={[draftTraceFrom, draftTraceTo]}
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
              move={
                measureMove
                  ? {
                      state: measureMove.state,
                      message: measureMove.message,
                      costFeet: measureMove.preview?.movement.totalCostFeet ?? null,
                    }
                  : null
              }
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

          {/* CURSOR da régua: ícone real do projeto, sem crosshair nativo. */}
          {rulerCursorActive ? (
            <div ref={attachRulerCursor} className="grid-ruler-cursor" aria-hidden="true">
              <Icon name="ruler" size={16} />
            </div>
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

          {/* MENU DE MODO DE ROLAGEM: acompanha o alvo escolhido no token. */}
          {rollMenuAnchor ? (
            <GridRollModePicker
              left={rollMenuAnchor.left}
              top={rollMenuAnchor.top}
              ready={Boolean(targeting?.executeReady)}
              busy={busy}
              selected={targeting?.rollMode ?? null}
              onChoose={(mode) => {
                const target = targetingRef.current?.selectedTargetId;
                if (target) targetingRef.current?.onChooseRollMode?.(target, mode);
              }}
            />
          ) : null}

          <p className="grid-hint">{hint}</p>
        </div>

        {/*
          CÂMERA FLUTUANTE (6.6M.6.1.5.1) — IRMÃ do `.grid-viewport`, nunca
          filha: os botões ficam FORA da camada transformada por pan/zoom e
          fora da superfície que interpreta gestos, então clicar aqui não
          seleciona célula, não inicia arrasto e não movimenta ninguém.

          Handlers, rótulos, nomes acessíveis e estados `disabled` são os
          MESMOS de antes. A barra é UMA linha só (`− 153% + Enquadrar
          Centralizar`), fina, no canto inferior direito do palco.
        */}
        <div
          className={rulerState === 'error' ? 'grid-camera-overlay is-lifted' : 'grid-camera-overlay'}
          role="group"
          aria-label="Câmera"
        >
          <button
            type="button"
            className="btn btn-small"
            aria-label="Reduzir zoom"
            disabled={gridPhase !== 'ready'}
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
            disabled={gridPhase !== 'ready'}
            onClick={() => zoomStep(ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-label="Enquadrar cena"
            disabled={gridPhase !== 'ready'}
            onClick={fitScene}
          >
            Enquadrar
          </button>
          <button
            type="button"
            className={currentOffscreen ? 'btn btn-small is-offscreen' : 'btn btn-small'}
            aria-label="Centralizar no turno"
            disabled={!currentUnit || gridPhase !== 'ready'}
            onClick={() => {
              if (currentUnit) centerOnCombatant(currentUnit.id);
            }}
          >
            Centralizar
          </button>
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

