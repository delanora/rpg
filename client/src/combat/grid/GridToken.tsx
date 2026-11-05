import type { CSSProperties } from 'react';
import type { CombatantDto } from '../../types';
import {
  SIZE_LABELS,
  renderRect,
  tokenArtSize,
} from './gridMath';

/** Dados mínimos de um combatente para o grid (subset do DTO real). */
export type GridUnit = Pick<
  CombatantDto,
  'id' | 'name' | 'spatial' | 'spatialVisibility'
> & {
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
  /**
   * Clique seleciona a unidade: no modo Posicionar (Mestre) ou no modo Medir
   * (qualquer um com o grid ativo). PLAYER não posiciona.
   */
  interactive?: boolean;
  /**
   * 6.6M.2 — papel na MEDIÇÃO. Só muda apresentação/`aria-label`: a linha e a
   * distância continuam sendo do servidor.
   */
  measureRole?: 'source' | 'target' | null;
  onSelect?: (combatantId: string) => void;
  /** Hover da medição (complemento do clique — nunca obrigatório). */
  onHover?: (combatantId: string | null) => void;
}

/**
 * TOKEN do grid: o FOOTPRINT (espaço ocupado, mecânico) com o retrato/imagem
 * dentro. O círculo é só representação — não define tamanho.
 *
 * Fonte da imagem: o `tokenImageRef` do DTO (retrato da ficha para Character;
 * imagem cadastrada para NPC/criatura). `null` = fallback `?`, desenhado em
 * texto/CSS (sem raster e sem depender de zoom/font-size fixo).
 *
 * 6.6L.3.2: `?` significa APENAS "sem imagem". Quem está `master-only` não
 * chega ao grid do jogador (o DTO vem com `spatial: null`); para o Mestre o
 * token continua desenhado, com a indicação discreta de oculto.
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
  onSelect,
  onHover,
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
  if (measureRole === 'source') classes.push('is-measure-source');
  if (measureRole === 'target') classes.push('is-measure-target');

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
      aria-label={`${combatant.name}, ${label}${
        measureRole === 'source'
          ? ', origem da medição'
          : measureRole === 'target'
            ? ', alvo da medição'
            : ''
      }`}
      aria-pressed={selected || measureRole !== null}
      aria-current={currentTurn ? 'true' : undefined}
      data-size={size}
      disabled={!interactive}
      onClick={interactive && onSelect ? () => onSelect(combatant.id) : undefined}
      onMouseEnter={interactive && onHover ? () => onHover(combatant.id) : undefined}
      onMouseLeave={interactive && onHover ? () => onHover(null) : undefined}
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
      {combatant.spatialVisibility === 'master-only' ? (
        <span className="grid-token-hidden" title="Oculto dos jogadores">
          Oculto
        </span>
      ) : null}
    </button>
  );
}
