import assert from 'node:assert/strict';
import {
  areaMembership,
  gridAreaQuerySchema,
  type GridAreaQuery,
} from '../modules/combat/spatial/area-membership.js';
import { wallTouchesAreaRay } from '../modules/combat/spatial/area-query-walls.js';
import type { SpatialBody } from '../modules/combat/spatial/spatial-distance.js';
import type { SpatialSceneConfig } from '../modules/combat/spatial/spatial.types.js';
const scene: SpatialSceneConfig = {
  mode: 'grid-2d',
  widthFeet: 100,
  heightFeet: 100,
  cellSizeFeet: 5,
};
const origin = { xFeet: 20, yFeet: 20, elevationFeet: 0 };
const body = (
  x: number,
  y: number,
  height: number | null = 6,
  elevation: number | null = 0,
  size: SpatialBody['size'] = 'medium',
): SpatialBody => ({
  position: { xFeet: x, yFeet: y },
  size,
  elevationFeet: elevation,
  bodyHeightFeet: height,
});
const query = (
  shape: GridAreaQuery['shape'],
  elevation = 0,
  angle = 0,
): GridAreaQuery => ({
  shape,
  origin: { ...origin, elevationFeet: elevation },
  angle,
});
let count = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, label);
  count++;
  console.log('✔ ' + label);
};
const hit = (q: GridAreaQuery, b: SpatialBody, s = scene) =>
  areaMembership(q, s, b).result;
check(
  'Esfera inclui sobreposição parcial do footprint',
  hit(query({ kind: 'sphere', radiusFeet: 10 }), body(28, 18)),
  'pass',
);
check(
  'Tangência pura não sobrepõe volume',
  hit(query({ kind: 'sphere', radiusFeet: 10 }), body(30, 18)),
  'fail',
);
check(
  'Token grande alcança área sem seu centro entrar',
  hit(query({ kind: 'sphere', radiusFeet: 3 }), body(10, 10, 6, 0, 'huge')),
  'pass',
);
check(
  'Esfera passa por cima do alvo baixo',
  hit(query({ kind: 'sphere', radiusFeet: 5 }, 20), body(18, 18, 5)),
  'fail',
);
check(
  'Altura corporal entra na esfera elevada',
  hit(query({ kind: 'sphere', radiusFeet: 5 }, 20), body(18, 18, 25)),
  'pass',
);
check(
  'Sem altura corporal exige decisão',
  hit(query({ kind: 'sphere', radiusFeet: 10 }), body(18, 18, null)),
  'unknown',
);
check(
  'Fora do plano é recusado mesmo sem altura',
  hit(query({ kind: 'sphere', radiusFeet: 5 }), body(60, 60, null)),
  'fail',
);
check(
  'Cilindro usa base e altura',
  hit(
    query({ kind: 'cylinder', radiusFeet: 10, heightFeet: 5 }, 10),
    body(18, 18, 6, 0),
  ),
  'fail',
);
check(
  'Cilindro intersecta corpo elevado',
  hit(
    query({ kind: 'cylinder', radiusFeet: 10, heightFeet: 5 }, 10),
    body(18, 18, 6, 12),
  ),
  'pass',
);
check(
  'Cubo gira com a face escolhida',
  hit(query({ kind: 'cube', sizeFeet: 10 }, 0, Math.PI / 2), body(18, 25)),
  'pass',
);
check(
  'Parte traseira do cubo não é incluída',
  hit(query({ kind: 'cube', sizeFeet: 10 }), body(10, 18)),
  'fail',
);
check(
  'Linha horizontal com altura explícita',
  hit(
    {
      ...query({ kind: 'line', lengthFeet: 20, widthFeet: 5 }),
      lineHeightFeet: 5,
    },
    body(30, 19),
  ),
  'pass',
);
check(
  'Linha sem espessura vertical pede decisão',
  hit(query({ kind: 'line', lengthFeet: 20, widthFeet: 5 }), body(30, 19)),
  'unknown',
);
check(
  'Linha elevada passa acima',
  hit(
    {
      ...query({ kind: 'line', lengthFeet: 20, widthFeet: 5 }, 12),
      lineHeightFeet: 5,
    },
    body(30, 19),
  ),
  'fail',
);
check(
  'Cone inclui corpo no volume circular',
  hit(query({ kind: 'cone', lengthFeet: 20 }), body(30, 19)),
  'pass',
);
check(
  'Cone exclui corpo muito acima',
  hit(query({ kind: 'cone', lengthFeet: 20 }), body(30, 19, 5, 30)),
  'fail',
);
check(
  'Cone exclui lado externo',
  hit(query({ kind: 'cone', lengthFeet: 20 }), body(25, 35)),
  'fail',
);
check(
  'Cone pode atingir só parte da altura',
  hit(query({ kind: 'cone', lengthFeet: 20 }, 8), body(30, 19, 6, 0)),
  'pass',
);
check(
  'Plataforma fornece elevação quando token não tem override',
  hit(
    query({ kind: 'cylinder', radiusFeet: 10, heightFeet: 5 }, 10),
    body(20, 20, 6, null),
    { ...scene, elevationCells: [{ xFeet: 20, yFeet: 20, elevationFeet: 10 }] },
  ),
  'pass',
);
check(
  'Desnível sob footprint exige Mestre',
  hit(
    query({ kind: 'sphere', radiusFeet: 10 }),
    body(20, 20, 6, null, 'large'),
    { ...scene, elevationCells: [{ xFeet: 20, yFeet: 20, elevationFeet: 10 }] },
  ),
  'unknown',
);
const wall = {
  kind: 'wall' as const,
  start: { xFeet: 25, yFeet: 0 },
  end: { xFeet: 25, yFeet: 50 },
  blocksMovement: true,
  blocksSight: true,
  coverLevel: 'total' as const,
};
check(
  'Parede interposta exige conferir altura física',
  wallTouchesAreaRay(origin, body(30, 20), [wall]),
  true,
);
check(
  'Parede distante não pede confirmação',
  wallTouchesAreaRay(origin, body(5, 20), [wall]),
  false,
);
check(
  'Meia cobertura não impede propagação',
  wallTouchesAreaRay(origin, body(30, 20), [{ ...wall, coverLevel: 'half' }]),
  false,
);
check(
  'Consulta não aceita alvos enviados pelo cliente',
  gridAreaQuerySchema.safeParse({
    ...query({ kind: 'sphere', radiusFeet: 10 }),
    targetIds: ['fraude'],
  }).success,
  false,
);
console.log(`${count} verificações puras de volumes de área aprovadas.`);
