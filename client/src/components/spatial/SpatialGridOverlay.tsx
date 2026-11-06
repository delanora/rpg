import { useState } from 'react';
import { DEFAULT_PIXELS_PER_CELL } from '../../combat/grid/gridMath';
/**
 * Os estilos base vivem em `spatial.css`, carregado pelos dois consumidores
 * (`grid/grid.css` no combate e `master/scenes.css` no preview) via `@import`:
 * o componente é compartilhado, então a regra também é uma só. Importar CSS
 * daqui quebraria o runner do `test:combat-ui`, que executa os módulos no Node.
 */
import { gridLineColor, type GridTone } from './gridTone';

/**
 * 6.6M.4.1.2 — GRADE VISUAL (ÚNICA) DE UMA SCENE.
 *
 * Componente PRESENTACIONAL: não é engine. Recebe `widthFeet`, `heightFeet` e
 * `cellSizeFeet` da fonte que já existe (`SpatialScene`) e projeta a geometria
 * em SVG. Não calcula distância, path, footprint, Movement, alcance nem bounds
 * novos — quem decide espaço continua sendo o servidor.
 *
 * Por que SVG e não `repeating-linear-gradient`:
 *  • um `pattern` com `patternUnits="userSpaceOnUse"` repete em COORDENADAS, não
 *    em pixels de tela, então o espaçamento entre linhas é exato em qualquer
 *    zoom (nada de tiles arredondados pelo rasterizador gerando "células
 *    falsas" no zoom out);
 *  • cada limite é desenhado UMA vez — o gradiente antigo pintava duas linhas
 *    por borda (uma clara + uma escura) e o `scale()` da câmera separava esse
 *    par em duas grades visíveis no zoom in;
 *  • `viewBox` em PÉS mantém a verdade única do projeto: 1 célula = 5 pés.
 *
 * A espessura acompanha a escala do plano (`cellSizeFeet / 44 px por célula`),
 * então a linha tem ~1 px em 100% e engorda/delimita junto com a câmera. Isso é
 * rendering: nenhuma unidade mecânica depende de pixel.
 */
export interface SpatialGridOverlayProps {
  /** Largura da cena em PÉS (mesma fonte do engine). */
  widthFeet: number;
  /** Altura da cena em PÉS. */
  heightFeet: number;
  /** Célula em PÉS (5 pés = 1,5 m no PHB). */
  cellSizeFeet: number;
  /** Contraste derivado da imagem (apresentação). Padrão: grade clara. */
  tone?: GridTone;
  className?: string;
}

/** Contador de módulo: cada instância tem o próprio `<pattern>` no documento. */
let nextOverlayId = 0;

export function SpatialGridOverlay({
  widthFeet,
  heightFeet,
  cellSizeFeet,
  tone = 'light',
  className,
}: SpatialGridOverlayProps) {
  const [patternId] = useState(() => {
    nextOverlayId += 1;
    return `spatial-grid-${nextOverlayId}`;
  });

  const width = Number.isFinite(widthFeet) && widthFeet > 0 ? widthFeet : 0;
  const height = Number.isFinite(heightFeet) && heightFeet > 0 ? heightFeet : 0;
  const cell = Number.isFinite(cellSizeFeet) && cellSizeFeet > 0 ? cellSizeFeet : 0;
  // Sem geometria não existe grade: nada de linha inventada em 0×0.
  if (width <= 0 || height <= 0 || cell <= 0) return null;

  const stroke = gridLineColor(tone);
  const strokeWidth = cell / DEFAULT_PIXELS_PER_CELL;
  const classes = className ? `spatial-grid-overlay ${className}` : 'spatial-grid-overlay';

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-cell-size-feet={cell}
      data-grid-tone={tone}
    >
      <defs>
        {/*
          Um tile de UMA célula: desenha a borda direita e a inferior. Repetido,
          cobre todos os múltiplos de `cell` — uma linha por limite, sem par.
        */}
        <pattern id={patternId} width={cell} height={cell} patternUnits="userSpaceOnUse">
          <path
            d={`M ${cell} 0 V ${cell} M 0 ${cell} H ${cell}`}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill={`url(#${patternId})`} />
      {/* Bordas de origem (topo/esquerda) do plano: fecham a grade. */}
      <path
        d={`M 0 0 V ${height} M 0 0 H ${width}`}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
