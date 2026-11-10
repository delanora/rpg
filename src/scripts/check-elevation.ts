import assert from 'node:assert/strict';
import {
  elevationAfterMovement,
  elevationCellsSchema,
  elevationCellsWithinScene,
  elevationDecisionRequired,
  surfaceElevation,
} from '../modules/combat/spatial/elevation.js';
import {
  spatialSceneOf,
  type SpatialSceneConfig,
} from '../modules/combat/spatial/spatial.types.js';
import { evaluateSpatialDistance } from '../modules/combat/spatial/spatial-distance.js';
const scene: SpatialSceneConfig = {
  mode: 'grid-2d',
  widthFeet: 40,
  heightFeet: 40,
  cellSizeFeet: 5,
  elevationCells: [
    { xFeet: 5, yFeet: 0, elevationFeet: 10 },
    { xFeet: 10, yFeet: 0, elevationFeet: 10 },
    { xFeet: 0, yFeet: 5, elevationFeet: -5 },
  ],
};
let checks = 0;
function check(name: string, test: unknown) {
  assert.ok(test, name);
  checks++;
  console.log(`✔ ${name}`);
}
check(
  'Cena legada preserva grade sem elevações inventadas',
  spatialSceneOf({
    mode: 'grid-2d',
    widthFeet: 40,
    heightFeet: 40,
    cellSizeFeet: 5,
  }).mode === 'grid-2d',
);
check(
  'Célula não pintada é nível zero',
  surfaceElevation(scene, { xFeet: 0, yFeet: 0 }, 'medium') === 0,
);
check(
  'Plataforma usa pés persistidos',
  surfaceElevation(scene, { xFeet: 5, yFeet: 0 }, 'medium') === 10,
);
check(
  'Fosso aceita nível negativo',
  surfaceElevation(scene, { xFeet: 0, yFeet: 5 }, 'medium') === -5,
);
check(
  'Criatura grande sobre desnível é ambígua',
  surfaceElevation(scene, { xFeet: 0, yFeet: 0 }, 'large') === null,
);
check(
  'Minúsculo conserva footprint menor',
  surfaceElevation(scene, { xFeet: 7.5, yFeet: 0 }, 'tiny') === 10,
);
check(
  'Trajeto no mesmo nível não solicita Mestre',
  !elevationDecisionRequired(scene, { xFeet: 5, yFeet: 0 }, 'medium', [
    { xFeet: 10, yFeet: 0 },
  ]),
);
check(
  'Subida exige decisão',
  elevationDecisionRequired(scene, { xFeet: 0, yFeet: 0 }, 'medium', [
    { xFeet: 5, yFeet: 0 },
  ]),
);
check(
  'Descida exige decisão',
  elevationDecisionRequired(scene, { xFeet: 5, yFeet: 0 }, 'medium', [
    { xFeet: 0, yFeet: 0 },
  ]),
);
check(
  'Caminho que sobe e desce não oculta a borda intermediária',
  elevationDecisionRequired(scene, { xFeet: 0, yFeet: 0 }, 'medium', [
    { xFeet: 5, yFeet: 0 },
    { xFeet: 0, yFeet: 0 },
  ]),
);
check(
  'Elevação manual suspensa exige arbitragem',
  elevationDecisionRequired(
    scene,
    { xFeet: 5, yFeet: 0 },
    'medium',
    [{ xFeet: 10, yFeet: 0 }],
    30,
  ),
);
check(
  'Movimento horizontal não derruba token suspenso',
  elevationAfterMovement(
    scene,
    { xFeet: 5, yFeet: 0 },
    { xFeet: 10, yFeet: 0 },
    'medium',
    30,
  ) === 30,
);
check(
  'Token apoiado acompanha a superfície autorizada',
  elevationAfterMovement(
    scene,
    { xFeet: 0, yFeet: 0 },
    { xFeet: 5, yFeet: 0 },
    'medium',
    0,
  ) === 10,
);
check(
  'Não aceita células duplicadas',
  !elevationCellsSchema.safeParse([
    scene.elevationCells![0],
    scene.elevationCells![0],
  ]).success,
);
check(
  'Não aceita NaN nem desalinhamento',
  !elevationCellsSchema.safeParse([{ xFeet: 1, yFeet: 0, elevationFeet: NaN }])
    .success,
);
check(
  'Redimensionamento não deixa células fora do mapa',
  !elevationCellsWithinScene(scene.elevationCells!, {
    widthFeet: 10,
    heightFeet: 40,
  }),
);
check(
  'Distância entre níveis não se apresenta como 2D conhecida',
  evaluateSpatialDistance(
    scene,
    { position: { xFeet: 0, yFeet: 0 }, size: 'medium' },
    { position: { xFeet: 5, yFeet: 0 }, size: 'medium' },
  ).status === 'unknown',
);
check(
  'Distância no mesmo nível continua conhecida',
  evaluateSpatialDistance(
    scene,
    { position: { xFeet: 5, yFeet: 0 }, size: 'medium' },
    { position: { xFeet: 10, yFeet: 0 }, size: 'medium' },
  ).status === 'known',
);
console.log(`${checks} verificações de elevação aprovadas.`);
