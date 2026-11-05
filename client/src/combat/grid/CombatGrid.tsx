import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { CombatDto, SpatialDistanceReading } from '../../types';
import { GridToken, type GridUnit } from './GridToken';
import { UnplacedCombatantsTray, GRID_DRAG_MIME } from './UnplacedCombatantsTray';
import { GridMeasureOverlay, GridMeasurementPanel, type MeasureRequestState } from './GridMeasurement';
import { SpatialSceneControls } from './SpatialSceneControls';
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

/** Modo de interação do grid — estado SÓ de UI (nunca vai ao banco nem ao DTO). */
type InteractionMode = 'placement' | 'measure';

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

  const scene = combat.spatial;
  const cellSizeFeet = scene.cellSizeFeet || BASE_CELL_SIZE_FEET;
  const { placed, unplaced } = splitByPlacement(combat.combatants);
  const dimensions = scenePixels(scene, cellSizeFeet, pixelsPerCell);
  const locked = busy || sceneBusy;

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

  function resetMeasure(): void {
    measureSequence.current += 1;
    setMeasureSourceId(null);
    setMeasureTargetId(null);
    setHoverId(null);
    setDistance(null);
    setMeasureState('idle');
  }

  function changeMode(next: InteractionMode): void {
    if (next === mode) return;
    resetMeasure();
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

  /** Escape (desktop) limpa a medição sem sair do modo. */
  useEffect(() => {
    if (mode !== 'measure') return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      resetMeasure();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
   * Clique numa unidade. Em `placement` seleciona para posicionar; em `measure`
   * escolhe origem/alvo e NUNCA dispara placement (mesmo para o Mestre).
   */
  function selectUnit(combatantId: string): void {
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

  function handlePlaneClick(event: MouseEvent<HTMLDivElement>) {
    // MODO MEDIR nunca posiciona: o clique no plano não tem efeito mecânico.
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
      : isMaster
        ? 'Selecione uma unidade e clique no mapa — ou arraste da bandeja.'
        : 'Visualização da cena.';

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

      {sceneError ? (
        <p className="grid-scene-error" role="status">
          {sceneError}
        </p>
      ) : null}

      <div className="grid-viewport">
        <div
          className={`grid-plane${placementInteractive && selectedId ? ' is-placing' : ''}${mode === 'measure' ? ' is-measuring' : ''}`}
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
              selected={mode === 'placement' && selectedId === combatant.id}
              pending={pendingId === combatant.id}
              measureRole={
                mode !== 'measure'
                  ? null
                  : measureSourceId === combatant.id
                    ? 'source'
                    : activeTargetId === combatant.id
                      ? 'target'
                      : null
              }
              interactive={mode === 'measure' ? measureInteractive : placementInteractive}
              onSelect={selectUnit}
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
