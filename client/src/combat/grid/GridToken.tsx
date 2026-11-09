import { Icon } from '../../components/Icon';
import type { CSSProperties, PointerEvent } from 'react';
import type { CombatantDto } from '../../types';
import { ROLL_MODE_LABELS, gridRollModeClass, type CombatRollMode } from '../gridTargeting';
import { SIZE_LABELS, renderRect, tokenArtSize } from './gridMath';

/** Dados mínimos de um combatente para o grid (subset do DTO real). */
export type GridUnit = Pick<
  CombatantDto,
  'id' | 'name' | 'spatial' | 'spatialVisibility'
> & {
  /** Personagem × criatura/NPC: só muda o ARO do token (visual). */
  kind?: string;
  creatureId?: string | null;
  hostileToIds?: string[];
  tokenNumber?: number | null;
  tokenDimmed?: boolean;
  missing?: boolean;
  relation?: CombatantDto['relation'];
};

export interface GridTokenProps {
  combatant: GridUnit;
  cellSizeFeet: number;
  pixelsPerCell: number;
  /** Turno atual — indicação discreta, sem alterar a iniciativa. */
  currentTurn?: boolean;
  isMaster?: boolean;
  showNumber?: boolean;
  visibilityDisabled?: boolean;
  onToggleVisibility?: (combatantId: string) => void;
  selected?: boolean;
  /** Placement em voo: preview até o servidor confirmar. */
  pending?: boolean;
  /** Clique seleciona a unidade (posicionar, medir ou escolher extremo). */
  interactive?: boolean;
  /** Papel na MEDIÇÃO (apresentação/`aria-label`). */
  measureRole?: 'source' | 'target' | null;
  /**
   * Posição ANIMADA (pés→px) de Measure-to-Move: só apresentação. O DTO do
   * servidor continua sendo a posição verdadeira; quando a animação termina
   * este valor vira `null` e o token volta a renderizar o estado autoritativo.
   */
  visualRect?: { left: number; top: number; width: number; height: number } | null;
  /** O token pertence ao combatente que PODE mover mecanicamente agora. */
  movable?: boolean;
  /** Régua ativa: o clique escolhe extremo, nunca inicia movimento. */
  rulerActive?: boolean;
  /**
   * 6.6M.6.4 — TOKEN ELEGÍVEL como alvo do ataque escolhido na Hotbar. O clique
   * só ESCOLHE o alvo no fluxo existente; não rola nem gasta nada.
   */
  targetable?: boolean;
  /** O token é o alvo JÁ escolhido (destaque de latão, só apresentação). */
  targetPicked?: boolean;
  /**
   * 6.6M.6.4.4 — MODO de rolagem já escolhido no menu do token. O cursor de
   * espada ganha o glifo do modo; confirmar continua sendo o duplo clique.
   */
  rollMode?: CombatRollMode | null;
  onInspect?: (combatantId: string, point: { x: number; y: number }) => void;
  onSelect?: (combatantId: string) => void;
  /** Início do draft de movimento (pointer down / ativação por teclado). */
  onMoveStart?: (combatantId: string, event: PointerEvent<HTMLButtonElement>) => void;
  /** Duplo clique centraliza a CÂMERA no token (não inicia movimento). */
  onCenter?: (combatantId: string) => void;
  /** Hover da medição (complemento do clique — nunca obrigatório). */
  onHover?: (combatantId: string | null) => void;
}

/**
 * TOKEN do grid: o FOOTPRINT (espaço ocupado, mecânico) com o retrato/imagem
 * dentro. O círculo é só representação — não define tamanho.
 *
 * FASE 6.6M.3.1: o retrato NUNCA é arrastável nativamente. O `draggable={false}`
 * no `<img>` (e o `onDragStart` bloqueado) é a correção do bug real de Drag &
 * Drop: o drag nativo do HTML5 cancelava `pointermove`/`pointerup`, então o
 * gesto morria no meio e o commit nunca acontecia para tokens COM retrato.
 */
export function GridToken({
  combatant,
  cellSizeFeet,
  pixelsPerCell,
  currentTurn = false,
  isMaster = false,
  showNumber = false,
  visibilityDisabled = false,
  onToggleVisibility,
  selected = false,
  pending = false,
  interactive = false,
  measureRole = null,
  visualRect = null,
  movable = false,
  rulerActive = false,
  targetable = false,
  targetPicked = false,
  rollMode = null,
  onInspect,
  onSelect,
  onMoveStart,
  onCenter,
  onHover,
}: GridTokenProps) {
  const rect = renderRect(combatant, cellSizeFeet, pixelsPerCell);
  if (!rect || !combatant.spatial) return null;

  // A caixa desenhada pode ser a animada; o footprint mecânico não muda.
  const box = visualRect ?? rect;
  const size = combatant.spatial.effectiveSize;
  const artSize = tokenArtSize(box);
  const label = SIZE_LABELS[size];
  const relation = combatant.relation ?? 'unknown';
  const relationLabel = {hostile:'hostil',allied:'aliado',neutral:'neutro',unknown:'relação não definida'}[relation];
  const classes = ['grid-token'];
  if (combatant.tokenDimmed) classes.push('is-inactive');
  if (currentTurn) classes.push('is-current');
  if (selected) classes.push('is-selected');
  if (pending) classes.push('is-pending');
  if (combatant.missing) classes.push('is-missing');
  if (movable) classes.push('is-movable');
  if (visualRect) classes.push('is-animating');
  if (rulerActive) classes.push('is-ruler-pick');
  if (targetable) classes.push('is-targetable');
  if (targetPicked) classes.push('is-target-picked');
  const rollModeClass = gridRollModeClass(rollMode);
  if (rollModeClass) classes.push(rollModeClass);
  if (measureRole === 'source') classes.push('is-measure-source');
  if (measureRole === 'target') classes.push('is-measure-target');

  const style: CSSProperties & Record<'--grid-token-art', string> = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    '--grid-token-art': `${artSize}px`,
  };

  const roleLabel =
    measureRole === 'source'
      ? ', origem da medição'
      : measureRole === 'target'
        ? ', alvo da medição'
        : '';

  return (
    <>
    <button
      type="button"
      className={classes.join(' ')}
      style={style}
      aria-label={`${combatant.name}, ${label}, ${relationLabel}${roleLabel}${
        movable ? ', pode ser movido' : ''
      }${rulerActive ? ', pode ser medido' : ''}${
        targetable ? ', pode ser escolhido como alvo' : ''
      }${targetPicked ? ', alvo escolhido' : ''}${
        rollMode ? `, modo de rolagem ${ROLL_MODE_LABELS[rollMode].toLowerCase()}` : ''
      }`}
      aria-pressed={selected || measureRole !== null || targetPicked}
      aria-current={currentTurn ? 'true' : undefined}
      data-size={size}
      data-relation={relation}
      data-kind={combatant.kind ?? 'character'}
      data-movable={movable ? 'true' : undefined}
      disabled={!interactive && !movable && !targetable && !onInspect}
      aria-haspopup={onInspect ? 'dialog' : undefined}
      onContextMenu={onInspect ? event => {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        const rect = event.currentTarget.getBoundingClientRect();
        onInspect(combatant.id, { x: event.clientX || rect.left, y: event.clientY || rect.bottom });
      } : undefined}
      onKeyDown={onInspect ? event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault(); event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onInspect(combatant.id, { x: rect.left, y: rect.bottom });
      } : undefined}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={
        movable && !rulerActive && onMoveStart
          ? (event) => onMoveStart(combatant.id, event)
          : undefined
      }
      onClick={
        (interactive || targetable) && onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect(combatant.id);
            }
          : undefined
      }
      onDoubleClick={
        onCenter
          ? (event) => {
              event.stopPropagation();
              onCenter(combatant.id);
            }
          : undefined
      }
      onMouseEnter={interactive && onHover ? () => onHover(combatant.id) : undefined}
      onMouseLeave={interactive && onHover ? () => onHover(null) : undefined}
    >
      {relation !== 'unknown' ? <span className="grid-token-relation-ring" aria-hidden="true" /> : null}
      <span className="grid-token-art">
        {combatant.spatial.tokenImageRef ? (
          <img
            className="grid-token-img"
            src={combatant.spatial.tokenImageRef}
            alt=""
            loading="lazy"
            aria-haspopup={onInspect ? 'dialog' : undefined}
      onContextMenu={onInspect ? event => {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        const rect = event.currentTarget.getBoundingClientRect();
        onInspect(combatant.id, { x: event.clientX || rect.left, y: event.clientY || rect.bottom });
      } : undefined}
      onKeyDown={onInspect ? event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault(); event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onInspect(combatant.id, { x: rect.left, y: rect.bottom });
      } : undefined}
      draggable={false}
          />
        ) : (
          <span className="grid-token-fallback" aria-hidden="true">
            ?
          </span>
        )}
      </span>
      {showNumber && combatant.tokenNumber ? <span className="grid-token-number" aria-label={`Unidade ${combatant.tokenNumber}`}>{combatant.tokenNumber}</span> : null}
      <span className="grid-token-label">{combatant.name}</span>
    </button>
    {isMaster && (combatant.kind === 'CREATURE' || combatant.kind === 'NPC') ? <button
      type="button" className="grid-token-visibility"
      style={{ left: `${box.left + box.width / 2 - artSize * .32}px`, top: `${box.top + box.height / 2 - artSize * .32}px`, '--grid-token-art': `${artSize}px` } as CSSProperties}
      disabled={visibilityDisabled || !onToggleVisibility}
      aria-label={`${combatant.spatialVisibility === 'master-only' ? 'Revelar' : 'Ocultar'} ${combatant.name} ${combatant.spatialVisibility === 'master-only' ? 'aos' : 'dos'} jogadores`}
      title={combatant.spatialVisibility === 'master-only' ? 'Oculto dos jogadores — clique para revelar' : 'Revelado aos jogadores — clique para ocultar'}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); onToggleVisibility?.(combatant.id); }}
    ><Icon name={combatant.spatialVisibility === 'master-only' ? 'eye-off' : 'eye'} size={12} /></button> : null}
    </>
  );
}

/** Numeração é apresentação por cadastro, considerando só a lista já autorizada do observador. */
export function repeatedCreatureIds(units: readonly Pick<GridUnit, 'kind' | 'creatureId'>[]): Set<string> {
  const counts = new Map<string, number>();
  for (const unit of units) if (unit.kind === 'CREATURE' && unit.creatureId)
    counts.set(unit.creatureId, (counts.get(unit.creatureId) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}
