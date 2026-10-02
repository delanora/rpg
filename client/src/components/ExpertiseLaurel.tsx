/**
 * Coroa de louros (dois ramos espelhados) que marca uma perícia ou ferramenta
 * em Expertise. Puro ornamento: `currentColor` deixa a cor vir do tema
 * (`--gold`/`--gold-bright`) e o SVG fica `aria-hidden` — quem explica o sentido
 * é o tooltip/hint ao redor.
 */

/** Folhas de UM ramo, subindo do pé (embaixo, centro) até a ponta (em cima). */
const LEAVES: { x: number; y: number; r: number }[] = [
  { x: 10.6, y: 25.4, r: -58 },
  { x: 7.9, y: 21.3, r: -74 },
  { x: 6.6, y: 16.8, r: -88 },
  { x: 8.2, y: 12.4, r: -104 },
  { x: 11.7, y: 9.2, r: -124 },
];

/** Texto único do indicador, usado por todos os lugares que o exibem. */
export const EXPERTISE_TOOLTIP = 'Expertise (bônus de proficiência dobrado)';

function LaurelHalf() {
  return (
    <>
      <path className="laurel-stem" d="M17 30.5 C 9.5 28 4.6 20.5 7.2 11.5" />
      {LEAVES.map((leaf, index) => (
        <ellipse
          key={index}
          className="laurel-leaf"
          cx={leaf.x}
          cy={leaf.y}
          rx="3.1"
          ry="1.5"
          transform={`rotate(${leaf.r} ${leaf.x} ${leaf.y})`}
        />
      ))}
    </>
  );
}

/**
 * O selo de Expertise ao lado do nome: uma pastilha `info-tip` (mesmo gatilho de
 * hover/foco dos outros "i" da ficha) com a coroa de louros e o tooltip
 * compartilhado — que tem FUNDO SÓLIDO (`.info-tip-text`).
 */
export function ExpertiseMark() {
  return (
    <span className="info-tip expertise-mark" tabIndex={0} aria-label={EXPERTISE_TOOLTIP}>
      <ExpertiseLaurel />
      <span className="info-tip-text expertise-tip" role="tooltip">
        {EXPERTISE_TOOLTIP}
      </span>
    </span>
  );
}

export function ExpertiseLaurel() {
  return (
    <svg
      className="expertise-laurel"
      viewBox="0 0 34 34"
      aria-hidden="true"
      focusable="false"
    >
      {/* Recentra o miolo da coroa no centro da caixa (17,17) e abre o aro
          ~20%, para a coroa envolver o círculo do checkbox com folga. */}
      <g transform="translate(17 17) scale(1.2) translate(-17 -18.5)">
        <g className="laurel-half">
          <LaurelHalf />
        </g>
        <g className="laurel-half" transform="translate(34 0) scale(-1 1)">
          <LaurelHalf />
        </g>
      </g>
    </svg>
  );
}
