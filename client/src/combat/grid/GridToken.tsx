import type { CSSProperties } from 'react';
import type { CombatantDto } from '../../types';
import {
  SIZE_LABELS,
  renderRect,
  tokenArtSize,
} from './gridMath';

/** Dados mínimos de um combatente para o grid (subset do DTO real). */
export type GridUnit = Pick<CombatantDto, 'id' | 'name' | 'spatial'> & {
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
  /** PLAYER é somente leitura (sem placement nesta fase). */
  interactive?: boolean;
  onSelect?: (combatantId: string) => void;
}

/**
 * TOKEN do grid: o FOOTPRINT (espaço ocupado, mecânico) com o retrato/imagem
 * dentro. O círculo é só representação — não define tamanho.
 *
 * Fonte da imagem: o `tokenImageRef` do DTO (retrato da ficha para Character;
 * imagem cadastrada para NPC/criatura). `null` = fallback `?`, desenhado em
 * texto/CSS (sem raster e sem depender de zoom/font-size fixo).
 */
export function GridToken({
  combatant,
  cellSizeFeet,
  pixelsPerCell,
  currentTurn = false,
  selected = false,
  pending = false,
  interactive = false,
  onSelect,
}: GridTokenProps) {
  const rect = renderRect(combatant, cellSizeFeet, pixelsPerCell);
  if (!rect || !combatant.spatial) return null;

  const size = combatant.spatial.effectiveSize;
  const artSize = tokenArtSize(rect);
  const label = SIZE_LABELS[size];
  const classes = ['grid-token'];
  if (currentTurn) classes.push('is-current');
  if (selected) classes.push('is-selected');
  if (pending) classes.push('is-pending');
  if (combatant.missing) classes.push('is-missing');

  const style: CSSProperties & Record<'--grid-token-art', string> = {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    '--grid-token-art': `${artSize}px`,
  };

  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={style}
      title={`${combatant.name} · ${label}`}
      aria-label={`${combatant.name}, ${label}`}
      aria-pressed={selected}
      aria-current={currentTurn ? 'true' : undefined}
      data-size={size}
      disabled={!interactive}
      onClick={interactive && onSelect ? () => onSelect(combatant.id) : undefined}
    >
      <span className="grid-token-art">
        {combatant.spatial.tokenImageRef ? (
          <img className="grid-token-img" src={combatant.spatial.tokenImageRef} alt="" loading="lazy" />
        ) : (
          <span className="grid-token-fallback" aria-hidden="true">
            ?
          </span>
        )}
      </span>
      <span className="grid-token-label">{combatant.name}</span>
    </button>
  );
}
