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

export function ExpertiseLaurel() {
  return (
    <svg
      className="expertise-laurel"
      viewBox="0 0 34 34"
      aria-hidden="true"
      focusable="false"
    >
      <g className="laurel-half">
        <LaurelHalf />
      </g>
      <g className="laurel-half" transform="translate(34 0) scale(-1 1)">
        <LaurelHalf />
      </g>
    </svg>
  );
}
