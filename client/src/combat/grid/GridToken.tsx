import type { CSSProperties, PointerEvent } from 'react';
import type { CombatantDto } from '../../types';
import { SIZE_LABELS, renderRect, tokenArtSize } from './gridMath';

/** Dados mínimos de um combatente para o grid (subset do DTO real). */
export type GridUnit = Pick<
  CombatantDto,
  'id' | 'name' | 'spatial' | 'spatialVisibility'
> & {
  /** Personagem × criatura/NPC: só muda o ARO do token (visual). */
  kind?: string;
  missing?: boolean;
};

export interface GridTokenProps {
  combatant: GridUnit;
  cellSizeFeet: number;
  pixelsPerCell: number;
  /** Turno atual — indicação discreta, sem alterar a iniciativa. */
  currentTurn?: boolean;
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
  selected = false,
  pending = false,
  interactive = false,
  measureRole = null,
  visualRect = null,
  movable = false,
  rulerActive = false,
  targetable = false,
  targetPicked = false,
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
  const classes = ['grid-token'];
  if (currentTurn) classes.push('is-current');
  if (selected) classes.push('is-selected');
  if (pending) classes.push('is-pending');
  if (combatant.missing) classes.push('is-missing');
  if (movable) classes.push('is-movable');
  if (visualRect) classes.push('is-animating');
  if (rulerActive) classes.push('is-ruler-pick');
  if (targetable) classes.push('is-targetable');
  if (targetPicked) classes.push('is-target-picked');
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
    <button
      type="button"
      className={classes.join(' ')}
      style={style}
      aria-label={`${combatant.name}, ${label}${roleLabel}${
        movable ? ', pode ser movido' : ''
      }${rulerActive ? ', pode ser medido' : ''}${
        targetable ? ', pode ser escolhido como alvo' : ''
      }${targetPicked ? ', alvo escolhido' : ''}`}
      aria-pressed={selected || measureRole !== null || targetPicked}
      aria-current={currentTurn ? 'true' : undefined}
      data-size={size}
      data-kind={combatant.kind ?? 'character'}
      data-movable={movable ? 'true' : undefined}
      disabled={!interactive && !movable && !targetable}
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
      <span className="grid-token-art">
        {combatant.spatial.tokenImageRef ? (
          <img
            className="grid-token-img"
            src={combatant.spatial.tokenImageRef}
            alt=""
            loading="lazy"
            draggable={false}
          />
        ) : (
          <span className="grid-token-fallback" aria-hidden="true">
            ?
          </span>
        )}
      </span>
      <span className="grid-token-label">{combatant.name}</span>
      {combatant.spatialVisibility === 'master-only' ? (
        <span className="grid-token-hidden" title="Oculto dos jogadores">
          Oculto
        </span>
      ) : null}
    </button>
  );
}
