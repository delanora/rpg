import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from 'react';
import type {
  CombatDto,
  MovementPreviewResponse,
  SpatialDistanceReading,
  SpatialPosition,
  SpatialSize,
} from '../../types';
import { createOperationId } from '../../utils';
import { GridToken, type GridUnit } from './GridToken';
import { UnplacedCombatantsTray, GRID_DRAG_MIME } from './UnplacedCombatantsTray';
import { GridMeasureOverlay, GridMeasurementPanel, type MeasureRequestState } from './GridMeasurement';
import { SpatialSceneControls } from './SpatialSceneControls';
import { GridMovementOverlay } from './GridMovementOverlay';
import { MovementPanel, type MovementPreviewState } from './MovementPanel';
import { commitMovement, previewMovement } from './movementApi';
import { anchorStepFeet, appendAnchor, pointerAnchor } from './movementPath';
import {
  getSpatialDistance,
  setSpatialPosition,
  setSpatialVisibility,
  updateSpatialScene,
} from './gridApi';
import {
  BASE_CELL_SIZE_FEET,
  DEFAULT_PIXELS_PER_CELL,
  MAX_PIXELS_PER_CELL,
  MIN_PIXELS_PER_CELL,
  SIZE_FOOTPRINT_FEET,
  pixelToPlacementFeet,
  scenePixels,
  splitByPlacement,
} from './gridMath';
import type { MovementAuthority } from '../turnControl';

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
 * Modo de interação do grid — estado SÓ de UI (nunca vai ao banco nem ao DTO).
 *
 * São TRÊS intenções explícitas e mutuamente exclusivas:
 * • `placement` = organização administrativa da cena (Mestre);
 * • `movement`  = ação mecânica do combatente do turno (Movement Engine);
 * • `measure`   = consulta espacial.
 */
type InteractionMode = 'placement' | 'measure' | 'movement';

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha ao posicionar a unidade.';
}

function clampFeet(value: number, max: number): number {
  return Math.min(Math.max(0, value), Math.max(0, max));
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
 *
 * FASE 6.6M.2 — MODO MEDIR (feedback de distância/alcance).
 *
 *  • `Interação` ganhou um modo EXPLÍCITO: `placement` (organizar a mesa) e
 *    `measure` (consultar relações espaciais). Não existe Shift+Click escondido
 *    e o clique NUNCA é ambíguo: em `measure` ele não dispara placement;
 *  • o número exibido vem de `GET /spatial/distance`; a linha SVG é decoração e
 *    os centros do footprint servem só para desenhá-la. Nenhuma distância é
 *    calculada aqui — o grid nunca vira a fonte da regra;
 *  • medição é estado LOCAL: não persiste, não é transmitida e não entra no DTO;
 *  • PLACEMENT/PLAYER: o Mestre mantém Posicionar; o jogador só recebe Medir.
 *
 * FASE 6.6L.3.2 — VISIBILIDADE ESPACIAL.
 *
 * O grid NÃO decide quem aparece: ele desenha o que o servidor projetou. NPC
 * público chega com `spatial` completo; `master-only` chega com `spatial: null`
 * e simplesmente não existe token (nem `?`, nem ghost). O único controle novo é
 * o do Mestre, que alterna `spatialVisibility` da unidade selecionada.
 *
 * FASE 6.6M.3 — MOVIMENTO VOLUNTÁRIO (drag & drop / tap).
 *
 *  • o cliente constrói só o TRAJETO pretendido (âncoras em pés) e consulta
 *    `movement-preview` quando o trajeto MUDA; legal/custo/saldo são do servidor;
 *  • o TOKEN REAL nunca anda durante o draft — apenas um ghost decorativo;
 *  • soltar com trajeto válido faz o COMMIT e adota o `CombatDto` devolvido:
 *    nenhuma posição otimista, nenhum ajuste local de saldo;
 *  • OA pausada, 0 PV, turno encerrado ou visibilidade alterada invalidam o
 *    draft (o servidor continua sendo quem decide o resultado).
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
  const [pixelsPerCell, setPixelsPerCell] = useState(DEFAULT_PIXELS_PER_CELL);
  // --- 6.6M.2: modo de interação e medição (estado APENAS local) ------------
  const [mode, setMode] = useState<InteractionMode>('placement');
  const [measureSourceId, setMeasureSourceId] = useState<string | null>(null);
  const [measureTargetId, setMeasureTargetId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [distance, setDistance] = useState<SpatialDistanceReading | null>(null);
  const [measureState, setMeasureState] = useState<MeasureRequestState>('idle');
  const [measureRetry, setMeasureRetry] = useState(0);
  /** Sequência das leituras: resposta atrasada de um alvo antigo é IGNORADA. */
  const measureSequence = useRef(0);
  // --- 6.6M.3: draft de movimento (estado APENAS local) --------------------
  const [draft, setDraft] = useState<MovementDraft | null>(null);
  const [preview, setPreview] = useState<MovementPreviewResponse | null>(null);
  const [previewState, setPreviewState] = useState<MovementPreviewState>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [movementBusy, setMovementBusy] = useState(false);
  /**
   * Sequência do preview: resposta atrasada de um trajeto ANTIGO nunca
   * substitui o atual (proteção de leitura obsoleta sem depender de rede).
   */
  const previewSequence = useRef(0);
  /** operationId ESTÁVEL por tentativa (retry reusa; novo draft gera outro). */
  const operationRef = useRef<string | null>(null);
  /** O gesto realmente andou? Diferencia tap (mantém draft) de arrasto vazio. */
  const dragMoved = useRef(false);
  /** O clique sintético que segue um drag NÃO pode abrir um draft novo. */
  const suppressClick = useRef(false);
  const planeRef = useRef<HTMLDivElement | null>(null);

  const scene = combat.spatial;
  const cellSizeFeet = scene.cellSizeFeet || BASE_CELL_SIZE_FEET;
  const { placed, unplaced } = splitByPlacement(combat.combatants);
  const dimensions = scenePixels(scene, cellSizeFeet, pixelsPerCell);
  const locked = busy || sceneBusy || movementBusy;

  const movableUnitId = movement?.combatantId ?? null;
  const movableUnit = placed.find((item) => item.id === movableUnitId) ?? null;
  const draftUnit = draft ? (placed.find((item) => item.id === draft.combatantId) ?? null) : null;

  const selectedUnit =
    mode === 'placement'
      ? (combat.combatants.find((item) => item.id === selectedId) ?? null)
      : null;
  const measureSourceUnit = placed.find((item) => item.id === measureSourceId) ?? null;
  // Hover é PREVIEW; o clique FIXA o alvo. Sem hover, volta ao alvo fixado.
  const activeTargetId = mode === 'measure' ? (hoverId ?? measureTargetId) : null;
  const measureTargetUnit = placed.find((item) => item.id === activeTargetId) ?? null;

  /** Fonte/target ainda existem e visíveis no DTO (privacy change remove). */
  const sourceVisible = !measureSourceId || combat.combatants.some((item) => item.id === measureSourceId && item.spatial);
  const targetVisible = !measureTargetId || combat.combatants.some((item) => item.id === measureTargetId && item.spatial);

  /** Feedback de placement (modo Posicionar). */
  const placementInteractive = isMaster && !locked && mode === 'placement';
  /** MODO MEDIR: qualquer um com o grid ativo mede o que o servidor autoriza. */
  const measureInteractive = !locked;
  /** MODO MOVER: só o combatente autorizado inicia gesto. */
  const movementInteractive = !locked && Boolean(movableUnitId);
  const draftLast = draft && draft.path.length > 0 ? draft.path[draft.path.length - 1] : null;

  function resetMeasure(): void {
    measureSequence.current += 1;
    setMeasureSourceId(null);
    setMeasureTargetId(null);
    setHoverId(null);
    setDistance(null);
    setMeasureState('idle');
  }

  /**
   * Limpa o draft SEM tocar no estado autoritativo.
   *
   * Nenhuma chamada de commit, nenhuma posição local alterada, nenhum saldo
   * recalculado — o token continua exatamente onde o DTO o colocou.
   */
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
    resetMeasure();
    clearDraft();
    setDraftNotice(null);
    setPendingNotice(null);
    setSelectedId(null);
    setMode(next);
  }

  /**
   * Troca de modo limpa a medição; sair de `grid-2d` também (a cena assistida não
   * oferece medição autoritativa — nada de distância fingida).
   */
  useEffect(() => {
    if (mode === 'measure' && combat.spatial.mode !== 'grid-2d') setMode('placement');
  }, [combat.spatial.mode, mode]);

  /**
   * REALTIME: se a fonte ou o alvo saírem do DTO (combatente removido, ficou
   * privado), a medição é LIMPA em vez de continuar exibindo valor velho.
   */
  useEffect(() => {
    if (mode !== 'measure') return;
    if (measureSourceId && !sourceVisible) {
      resetMeasure();
      return;
    }
    if (measureTargetId && !targetVisible) {
      measureSequence.current += 1;
      setMeasureTargetId(null);
      setDistance(null);
      setMeasureState('idle');
    }
    // `resetMeasure` só toca estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, measureSourceId, measureTargetId, sourceVisible, targetVisible]);

  /**
   * LEITURA da distância: uma requisição por alvo efetivo, com sequência para
   * descartar resposta atrasada (A → B → C nunca deixa B sobrescrever C). O
   * efeito também reaponta quando o combate muda (`combat.version`) para nunca
   * apresentar posição antiga como atual. Zoom/scroll não mudam nada aqui.
   */
  useEffect(() => {
    if (
      mode !== 'measure' ||
      !measureSourceId ||
      !activeTargetId ||
      activeTargetId === measureSourceId
    ) {
      setDistance(null);
      setMeasureState('idle');
      return;
    }
    measureSequence.current += 1;
    const sequence = measureSequence.current;
    setMeasureState('loading');
    getSpatialDistance(combat.id, measureSourceId, activeTargetId)
      .then((response) => {
        if (measureSequence.current !== sequence) return;
        setDistance(response.distance);
        setMeasureState('success');
      })
      .catch(() => {
        if (measureSequence.current !== sequence) return;
        // Falha de rede NÃO mantém o valor anterior como se fosse atual.
        setDistance(null);
        setMeasureState('error');
      });
  }, [mode, combat.id, combat.version, measureSourceId, activeTargetId, measureRetry]);

  /**
   * PREVIEW do trajeto: consulta o servidor só quando o caminho EFETIVO muda
   * (com debounce curto), aborta a requisição anterior e ignora resposta de
   * sequência antiga. Durante `loading` o painel mostra "Calculando…" — o valor
   * anterior nunca é apresentado como atual.
   */
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
   * trajeto local. O fantasma nunca fica órfão e nenhum caminho antigo é
   * enviado depois disso.
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

  /** Escape cancela a medição (no modo Medir) e o draft (no modo Mover). */
  useEffect(() => {
    if (mode === 'measure') {
      function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        resetMeasure();
      }
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
    if (mode === 'movement' && draft) {
      function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        cancelDraft('Movimento cancelado.');
      }
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draft !== null]);

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

  /**
   * Alterna a PRESENÇA ESPACIAL da unidade selecionada. Só o Mestre vê o
   * controle; o servidor recusa qualquer outro papel (403). O estado exibido é
   * sempre o `CombatDto` devolvido pelo servidor.
   */
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

  function placeAt(combatantId: string, offsetX: number, offsetY: number) {
    const unit = combat.combatants.find((item) => item.id === combatantId);
    if (!unit?.spatial) return;
    const size = unit.spatial.effectiveSize;
    void place(combatantId, {
      xFeet: pixelToPlacementFeet(offsetX, cellSizeFeet, pixelsPerCell, size),
      yFeet: pixelToPlacementFeet(offsetY, cellSizeFeet, pixelsPerCell, size),
    });
  }

  /**
   * Clique numa unidade.
   * • `placement`: seleciona para posicionar (só Mestre);
   * • `measure`: escolhe origem/alvo (nunca posiciona);
   * • `movement`: garante o draft do combatente autorizado (fluxo por teclado).
   */
  function selectUnit(combatantId: string): void {
    if (mode === 'movement') {
      if (suppressClick.current) return;
      if (movableUnitId === combatantId) startDraft(combatantId);
      return;
    }
    if (mode === 'placement') {
      setSelectedId(combatantId);
      return;
    }
    if (!measureSourceId) {
      setMeasureSourceId(combatantId);
      setMeasureTargetId(null);
      setHoverId(null);
      return;
    }
    // Mesma entidade: não é interação principal (evita "0 pés" acidental).
    if (combatantId === measureSourceId) return;
    setMeasureTargetId(combatantId);
  }

  /** Pés do ponteiro relativos ao plano da cena (scroll/zoom já resolvidos). */
  function pointerFeet(
    event: { clientX: number; clientY: number },
    plane: HTMLElement,
  ): SpatialPosition {
    const rect = plane.getBoundingClientRect();
    return {
      xFeet: ((event.clientX - rect.left) / pixelsPerCell) * cellSizeFeet,
      yFeet: ((event.clientY - rect.top) / pixelsPerCell) * cellSizeFeet,
    };
  }

  function anchorAt(
    event: { clientX: number; clientY: number },
    plane: HTMLElement,
    size: SpatialSize,
    grab: SpatialPosition,
  ): SpatialPosition {
    const feet = pointerFeet(event, plane);
    return pointerAnchor({
      xFeet: feet.xFeet - grab.xFeet,
      yFeet: feet.yFeet - grab.yFeet,
      size,
      scene,
    });
  }

  /**
   * Inicia o DRAFT de movimento (pointer down no token ou ativação por teclado).
   *
   * Nada é movido: o token real continua no DTO; só nasce o trajeto vazio.
   */
  function startDraft(combatantId: string, event?: PointerEvent<HTMLButtonElement>): void {
    if (mode !== 'movement' || locked) return;
    if (movableUnitId !== combatantId) return;
    if (draft && draft.combatantId === combatantId) return;
    const unit = placed.find((item) => item.id === combatantId);
    const position = unit?.spatial?.position ?? null;
    if (!unit?.spatial || !position) return;
    const footprint = SIZE_FOOTPRINT_FEET[unit.spatial.effectiveSize];
    let grab: SpatialPosition = {
      xFeet: footprint.widthFeet / 2,
      yFeet: footprint.heightFeet / 2,
    };
    if (event && planeRef.current) {
      // Ponto de pega: o token não salta para o centro do cursor.
      const feet = pointerFeet(event, planeRef.current);
      grab = {
        xFeet: clampFeet(feet.xFeet - position.xFeet, footprint.widthFeet),
        yFeet: clampFeet(feet.yFeet - position.yFeet, footprint.heightFeet),
      };
      // O arrasto sobrevive ao ponteiro sair temporariamente do token.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    operationRef.current = null;
    dragMoved.current = false;
    setDraftNotice(null);
    setPendingNotice(null);
    setPreview(null);
    setPreviewState('idle');
    setDraft({ combatantId, startPosition: position, path: [], grab });
  }

  function handlePlanePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (mode !== 'movement' || !draft) return;
    const unit = placed.find((item) => item.id === draft.combatantId);
    if (!unit?.spatial) return;
    const step = anchorStepFeet(unit.spatial.effectiveSize);
    const anchor = anchorAt(event, event.currentTarget, unit.spatial.effectiveSize, draft.grab);
    const nextPath = appendAnchor(draft.path, anchor, step);
    if (nextPath === draft.path) return;
    dragMoved.current = true;
    setDraft({ ...draft, path: nextPath });
  }

  function handlePlanePointerUp(): void {
    if (mode !== 'movement' || !draft) return;
    const moved = dragMoved.current;
    dragMoved.current = false;
    if (draft.path.length === 0) {
      // tap: mantém o draft para o fluxo por toque; arrasto sem trajeto: cancela.
      if (moved) cancelDraft();
      return;
    }
    // O clique sintético do fim do gesto não pode abrir outro draft.
    suppressClick.current = true;
    void confirmMovement(draft.combatantId, draft.path);
  }

  /**
   * COMMIT do movimento: revalidação (preview nunca é autoridade), commit real
   * e adoção do `CombatDto`. Nenhuma posição/saldo é alterado localmente e o
   * `operationId` é o mesmo em retry da MESMA tentativa.
   */
  async function confirmMovement(combatantId: string, path: SpatialPosition[]): Promise<void> {
    if (movementBusy) return;
    const unit = placed.find((item) => item.id === combatantId);
    if (!unit?.spatial?.position) return;
    // Preview já recusou este trajeto: não gasta rede nem envia commit.
    if (preview && previewState === 'ready' && (!preview.movement.legal || !preview.movement.affordable)) {
      setDraftNotice(
        preview.movement.legal
          ? 'Movimento insuficiente para este trajeto.'
          : 'O trajeto não é válido.',
      );
      return;
    }
    setMovementBusy(true);
    setSceneError(null);
    setDraftNotice(null);
    try {
      if (!preview || previewState !== 'ready') {
        // Preview ausente/stale: consulta antes do commit (o servidor revalida de novo).
        const fresh = await previewMovement(combat.id, { combatantId, path });
        if (!fresh.movement.legal || !fresh.movement.affordable) {
          setPreview(fresh);
          setPreviewState('ready');
          setDraftNotice(
            fresh.movement.legal
              ? 'Movimento insuficiente para este trajeto.'
              : 'O trajeto não é válido.',
          );
          return;
        }
      }
      operationRef.current ??= createOperationId();
      const result = await commitMovement(combat, {
        combatantId,
        path,
        operationId: operationRef.current,
      });
      // Estado AUTORITATIVO — inclusive quando o servidor pausou em checkpoint.
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
      // 409/403: o servidor prevalece; o trajeto é descartado e nada é inventado.
      setSceneError(messageOf(error));
      setDraftNotice(messageOf(error));
      onError(messageOf(error));
      clearDraft();
    } finally {
      setMovementBusy(false);
    }
  }

  function clearPath(): void {
    if (!draft) return;
    operationRef.current = null;
    setDraft({ ...draft, path: [] });
    setDraftNotice(null);
  }

  function handlePlaneClick(event: MouseEvent<HTMLDivElement>) {
    if (mode === 'measure') return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (mode === 'movement') {
      // Fallback de toque/precisão: clique numa âncora acrescenta/trunca o passo.
      if (!draft || locked) return;
      const unit = placed.find((item) => item.id === draft.combatantId);
      if (!unit?.spatial) return;
      const step = anchorStepFeet(unit.spatial.effectiveSize);
      const anchor = anchorAt(event, event.currentTarget, unit.spatial.effectiveSize, draft.grab);
      setDraft({ ...draft, path: appendAnchor(draft.path, anchor, step) });
      return;
    }
    if (mode !== 'placement') return;
    if (!isMaster || !selectedId || locked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    placeAt(selectedId, event.clientX - rect.left, event.clientY - rect.top);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (mode !== 'placement' || !isMaster || locked) return;
    event.preventDefault();
    const combatantId =
      event.dataTransfer.getData(GRID_DRAG_MIME) ||
      event.dataTransfer.getData('text/plain');
    if (!combatantId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    placeAt(combatantId, event.clientX - rect.left, event.clientY - rect.top);
  }

  const hint =
    mode === 'measure'
      ? 'Clique na origem e depois no alvo para medir.'
      : mode === 'movement'
        ? movableUnit
          ? 'Arraste o token do turno para montar o trajeto — ou toque nas células.'
          : (movement?.reason ?? 'Nenhum combatente pode se mover agora.')
        : isMaster
          ? 'Selecione uma unidade e clique no mapa — ou arraste da bandeja.'
          : 'Visualização da cena.';

  const planeClasses = [
    'grid-plane',
    placementInteractive && selectedId ? 'is-placing' : '',
    mode === 'measure' ? 'is-measuring' : '',
    mode === 'movement' ? 'is-moving' : '',
    draft ? 'is-drafting' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
        <span className="grid-toolbar-hint">{hint}</span>
        <div className="grid-toolbar-right">
          <div className="grid-modes" role="group" aria-label="Modo do grid">
            {isMaster ? (
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={mode === 'placement'}
                disabled={locked}
                onClick={() => changeMode('placement')}
              >
                Posicionar
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={mode === 'movement'}
              disabled={locked}
              title={movement?.reason ?? 'Mover o combatente do turno'}
              onClick={() => changeMode('movement')}
            >
              Mover
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={mode === 'measure'}
              onClick={() => changeMode('measure')}
            >
              Medir
            </button>
          </div>
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
      </div>

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

      {mode === 'measure' ? (
        <GridMeasurementPanel
          sourceName={measureSourceUnit?.name ?? null}
          targetName={measureTargetUnit?.name ?? null}
          distance={distance}
          state={measureState}
          onClear={resetMeasure}
          onRetry={() => setMeasureRetry((current) => current + 1)}
        />
      ) : null}

      {mode === 'movement' ? (
        <MovementPanel
          combatantName={movableUnit?.name ?? draftUnit?.name ?? null}
          eligible={Boolean(movableUnitId)}
          reason={movement?.reason ?? null}
          pathLength={draft?.path.length ?? 0}
          movement={preview?.movement ?? null}
          reaction={preview?.reaction ?? null}
          state={previewState}
          error={previewError}
          pendingNotice={pendingNotice ?? draftNotice}
          busy={movementBusy}
          onClear={clearPath}
          onCancel={() => cancelDraft('Movimento cancelado.')}
          onConfirm={() => {
            if (draft) void confirmMovement(draft.combatantId, draft.path);
          }}
        />
      ) : null}

      {sceneError ? (
        <p className="grid-scene-error" role="status">
          {sceneError}
        </p>
      ) : null}

      <div className="grid-viewport">
        <div
          ref={planeRef}
          className={planeClasses}
          style={
            {
              width: `${dimensions.width}px`,
              height: `${dimensions.height}px`,
              '--grid-cell': `${pixelsPerCell}px`,
            } as CSSProperties
          }
          data-scene-mode={scene.mode}
          onClick={handlePlaneClick}
          onPointerMove={mode === 'movement' ? handlePlanePointerMove : undefined}
          onPointerUp={mode === 'movement' ? handlePlanePointerUp : undefined}
          onPointerCancel={mode === 'movement' ? handlePlanePointerUp : undefined}
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
              selected={mode === 'placement' && selectedId === combatant.id}
              pending={
                pendingId === combatant.id ||
                (movementBusy && draft?.combatantId === combatant.id)
              }
              measureRole={
                mode !== 'measure'
                  ? null
                  : measureSourceId === combatant.id
                    ? 'source'
                    : activeTargetId === combatant.id
                      ? 'target'
                      : null
              }
              interactive={
                mode === 'measure'
                  ? measureInteractive
                  : mode === 'movement'
                    ? movementInteractive
                    : placementInteractive
              }
              movable={mode === 'movement' && !locked && movableUnitId === combatant.id}
              onSelect={selectUnit}
              onMoveStart={(combatantId, event) => startDraft(combatantId, event)}
              onHover={mode === 'measure' && measureSourceId ? setHoverId : undefined}
            />
          ))}

          {/* LINHA de medição: camada decorativa, sem captura de clique. */}
          {mode === 'measure' ? (
            <GridMeasureOverlay
              source={measureSourceUnit}
              target={measureTargetUnit}
              cellSizeFeet={cellSizeFeet}
              pixelsPerCell={pixelsPerCell}
            />
          ) : null}

          {/* 6.6M.3 — TRAJETO pretendido + ghost (o token real não se move). */}
          {mode === 'movement' && draft ? (
            <GridMovementOverlay
              path={draft.path}
              ghost={
                draftLast && draftUnit?.spatial
                  ? {
                      position: draftLast,
                      size: draftUnit.spatial.effectiveSize,
                      imageRef: draftUnit.spatial.tokenImageRef,
                    }
                  : null
              }
              cellSizeFeet={cellSizeFeet}
              pixelsPerCell={pixelsPerCell}
            />
          ) : null}
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
