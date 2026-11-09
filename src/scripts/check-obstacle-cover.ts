/** Provas puras, sem conexão com banco. */
import assert from 'node:assert/strict';
import {
  evaluateObstacleCover,
  obstacleCoverProvider,
} from '../modules/combat/spatial/obstacle-cover.js';
import {
  coverAcBonus,
  coverDexSaveBonus,
  knownCover,
} from '../modules/combat/cover.js';
import { obstacleDtoOf } from '../modules/combat/spatial/spatial-obstacle.js';
import type { SpatialObstacleShape } from '../modules/combat/spatial/spatial-obstacle.js';
import type { SpatialSize } from '../modules/combat/spatial/spatial.types.js';
const scene = {
  mode: 'grid-2d' as const,
  widthFeet: 100,
  heightFeet: 100,
  cellSizeFeet: 5 as const,
};
const point = (xFeet: number, yFeet: number) => ({ xFeet, yFeet });
const wall = (
  coverLevel: NonNullable<SpatialObstacleShape['coverLevel']>,
  y1 = 0,
  y2 = 100,
): SpatialObstacleShape => ({
  start: point(30, y1),
  end: point(30, y2),
  coverLevel,
  blocksMovement: false,
  blocksSight: false,
  blocksTargeting: coverLevel === 'total',
});
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
for (const size of [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as SpatialSize[]) {
  const source = { position: point(5, 5), size },
    target = { position: point(35, 5), size };
  const read = (walls: SpatialObstacleShape[]) =>
    evaluateObstacleCover(scene, source, target, walls);
  for (const level of ['none', 'half', 'three-quarters', 'total'] as const) {
    check(
      `${size}: grau declarado ${level}`,
      read([wall(level)]),
      knownCover(level, 'authoritative'),
    );
    check(
      `${size}: inversão de origem`,
      evaluateObstacleCover(scene, target, source, [wall(level)]),
      knownCover(level, 'authoritative'),
    );
  }
  check(
    `${size}: graus não somam`,
    read([wall('half'), wall('half')]),
    knownCover('half', 'authoritative'),
  );
  check(
    `${size}: maior grau`,
    read([wall('half'), wall('three-quarters')]),
    knownCover('three-quarters', 'authoritative'),
  );
  check(
    `${size}: parede distante`,
    read([wall('total', 70, 100)]),
    knownCover('none', 'authoritative'),
  );
  check(
    `${size}: fresta`,
    read([wall('half', 0, 7), wall('half', 8, 100)]).status,
    'unknown',
  );
  check(
    `${size}: grau mais forte só em parte`,
    read([wall('half'), wall('three-quarters', 0, 7)]).status,
    'unknown',
  );
  check(
    `${size}: colineares contíguos`,
    read([wall('half', 0, 7), wall('half', 7, 100)]),
    knownCover('half', 'authoritative'),
  );
  check(
    `${size}: cobertura total supera incerteza menor`,
    read([wall('total'), wall('half', 0, 7)]),
    knownCover('total', 'authoritative'),
  );
  check(
    `${size}: posição ausente`,
    evaluateObstacleCover(scene, { position: null, size }, target, []).status,
    'unknown',
  );
}
check('Meia cobertura CA', coverAcBonus('half'), 2);
check('Três quartos Dex', coverDexSaveBonus('three-quarters'), 5);
check(
  'Sem combate mantém assistência',
  obstacleCoverProvider(null).evaluate({
    origin: { kind: 'character', id: 'a' },
    target: { kind: 'character', id: 'b' },
    interaction: 'attack',
  }),
  {
    status: 'not-assessed',
    reason: 'sem cena de combate para avaliar cobertura',
  },
);
const legacy = {
  id: 'x',
  kind: 'wall',
  startXFeet: 30,
  startYFeet: 0,
  endXFeet: 30,
  endYFeet: 100,
  blocksMovement: true,
  blocksSight: false,
};
check('Legado sólido', obstacleDtoOf(legacy).coverLevel, 'total');
check(
  'Legado transparente para ataques',
  obstacleDtoOf({ ...legacy, blocksTargeting: false }).coverLevel,
  'none',
);
console.log(`✔ ${checks} verificações de cobertura por obstáculos`);
