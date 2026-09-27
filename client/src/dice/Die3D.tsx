import { useMemo, type CSSProperties } from 'react';
import { dieFaces, paintsValues, settleTransform, type V3 } from './polyhedra';

/** Direção da luz (no espaço do modelo) usada para o facetado das faces. */
const LIGHT: V3 = [-0.45, -0.78, 0.44];

/** Inclinação parada do dado antes de rolar (só para dar volume à peça). */
const IDLE_TILT = 'rotateX(-18deg) rotateY(26deg) rotateZ(4deg)';

/** Posições dos pontos do d6 (grade 3×3). */
const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DiePips({ value, style }: { value: number; style?: CSSProperties }) {
  const on = new Set(PIP_LAYOUT[value] ?? []);
  return (
    <span className="ddie-pips" style={style} aria-hidden>
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} className={on.has(index) ? 'on' : ''} />
      ))}
    </span>
  );
}

interface Die3DProps {
  sides: number;
  /** Valor a apresentar quando `reveal` está ligado. */
  value: number | null;
  /** Dado assentado: mostra os números e pousa na face do resultado. */
  reveal: boolean;
  tumbling?: boolean;
  dropped?: boolean;
  locked?: boolean;
  onClick?: () => void;
  title?: string;
}

/**
 * Um dado de verdade em CSS 3D: as faces do poliedro são colocadas com
 * `matrix3d` e `backface-visibility` esconde as de trás. O dado gira (`.ddie-spin`)
 * e pousa na orientação que traz o resultado para a câmera (`.ddie-orient`).
 */
export function Die3D({
  sides,
  value,
  reveal,
  tumbling = false,
  dropped = false,
  locked = false,
  onClick,
  title,
}: Die3DProps) {
  const faces = useMemo(() => dieFaces(sides), [sides]);
  const paints = paintsValues(sides);
  const settle = reveal && value !== null ? settleTransform(sides, value) : null;

  const className = [
    'ddie',
    `ddie-s${sides}`,
    tumbling ? 'is-tumbling' : '',
    reveal ? 'is-revealed' : '',
    dropped ? 'is-dropped' : '',
    locked ? 'is-locked' : '',
    onClick ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <span className="ddie-orient" style={{ transform: settle ?? IDLE_TILT }}>
        <span className="ddie-spin">
          <span className="ddie-model">
            {faces.map((face) => {
              const shade = Math.max(0, face.normal[0] * LIGHT[0] + face.normal[1] * LIGHT[1] + face.normal[2] * LIGHT[2]);
              // Dado descartado (vantagem/desvantagem) fica mais fosco e sem cor.
              const saturation = dropped ? 8 : 46;
              const base = (dropped ? 50 : 64) + Math.round(shade * (dropped ? 16 : 26));

              return (
                <span
                  key={face.key}
                  className="ddie-face"
                  style={{
                    width: face.size,
                    height: face.size,
                    clipPath: face.clipPath,
                    transform: face.transform,
                    background: `linear-gradient(150deg, hsl(38 ${saturation}% ${Math.min(92, base + 8)}%), hsl(33 ${saturation - 4}% ${Math.max(30, base - 12)}%))`,
                  }}
                >
                  {reveal && face.value !== null ? (
                    sides === 6 ? (
                      <DiePips
                        value={face.value}
                        style={{ left: `${face.valueX}%`, top: `${face.valueY}%` }}
                      />
                    ) : (
                      // O número fica no centroide da face (não no centro da
                      // caixa) e cresce junto com a face. É um `font-size` no
                      // espaço do modelo, então o `.ddie-model` o escala na
                      // proporção certa — nada de número minúsculo.
                      <span
                        className="ddie-num"
                        style={{
                          left: `${face.valueX}%`,
                          top: `${face.valueY}%`,
                          fontSize: `${face.valueSize}px`,
                        }}
                      >
                        {face.value}
                      </span>
                    )
                  ) : null}
                </span>
              );
            })}
          </span>
        </span>
      </span>

      {!reveal || !paints ? (
        <span className="ddie-badge">
          {reveal && value !== null && !paints ? value : `d${sides}`}
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        title={title ?? 'Clique para remover'}
        aria-label={locked ? `d${sides} fixo` : `Remover d${sides} do pool`}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return (
    <span className={className} title={title ?? `d${sides}`} aria-hidden={!reveal}>
      {body}
    </span>
  );
}

