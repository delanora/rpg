/** Geometria pura: nenhuma conexão com banco ou com a mesa. */
import assert from 'node:assert/strict';
import {
  evaluateWallSight,
  evaluateWallPath,
} from '../modules/combat/spatial/targeting-walls.js';
import { scanReactionBoundaries } from '../modules/combat/spatial/opportunity-openers.js';
import { opportunityVisibilityOf } from '../modules/combat/spatial/opportunity-attack.js';
import type { SpatialSize } from '../modules/combat/spatial/spatial.types.js';
const scene = {
  mode: 'grid-2d' as const,
  widthFeet: 100,
  heightFeet: 100,
  cellSizeFeet: 5 as const,
};
const point = (xFeet: number, yFeet: number) => ({ xFeet, yFeet });
const wall = (y1: number, y2: number, blocksSight = true) => ({
  start: point(30, y1),
  end: point(30, y2),
  blocksSight,
  blocksMovement: false,
  blocksTargeting: false,
});
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
for (const [size, span] of [
  ['tiny', 2.5],
  ['small', 5],
  ['medium', 5],
  ['large', 10],
  ['huge', 15],
  ['gargantuan', 20],
] as [SpatialSize, number][]) {
  const source = { position: point(5, 5), size },
    target = { position: point(35, 5), size };
  const read = (walls: ReturnType<typeof wall>[]) =>
    evaluateWallSight(scene, source, target, walls).result;
  check(`${size}: sem parede`, read([]), 'pass');
  check(`${size}: parede opaca longe dos tokens`, read([wall(60, 80)]), 'pass');
  check(`${size}: parede opaca completa`, read([wall(0, 100)]), 'fail');
  check(
    `${size}: parede transparente`,
    read([
      { ...wall(0, 100, false), blocksMovement: true, blocksTargeting: true },
    ]),
    'pass',
  );
  check(
    `${size}: visão não bloqueia caminho de ataque por implicação`,
    evaluateWallPath(scene, source, target, [wall(0, 100)]).result,
    'pass',
  );
  check(
    `${size}: canto permanece assistido`,
    read([wall(5 + span, 80)]),
    'unknown',
  );
  check(
    `${size}: barreira parcial não vira bloqueio total`,
    read([wall(5 + span / 2, 80)]),
    'unknown',
  );
  check(
    `${size}: segmentos contíguos opacos`,
    read([wall(0, 10), wall(10, 100)]),
    'fail',
  );
  check(
    `${size}: fresta não é fechada`,
    read([wall(0, 5 + span / 2 - 0.1), wall(5 + span / 2 + 0.1, 100)]),
    'unknown',
  );
  check(
    `${size}: dados não carregados`,
    evaluateWallSight(scene, source, target, undefined).result,
    'unknown',
  );
  check(
    `${size}: sentido inverso`,
    evaluateWallSight(scene, target, source, [wall(0, 100)]).result,
    'fail',
  );
}
check(
  'modo assistido não inventa visão geométrica',
  evaluateWallSight(
    { ...scene, mode: 'assisted' },
    { position: point(5, 5), size: 'medium' },
    { position: point(35, 5), size: 'medium' },
    [],
  ).result,
  'unknown',
);
check(
  'visão mecânica prevalece sobre geometria livre',
  opportunityVisibilityOf({
    canSeeMover: false,
    occludersExist: false,
    geometry: 'pass',
  }),
  'known-not-visible',
);
check(
  'parede opaca conhecida não pede confirmação',
  opportunityVisibilityOf({
    canSeeMover: true,
    occludersExist: true,
    geometry: 'fail',
  }),
  'known-not-visible',
);
check(
  'parede longe não pede confirmação',
  opportunityVisibilityOf({
    canSeeMover: true,
    occludersExist: true,
    geometry: 'pass',
  }),
  'known-visible',
);
const scan = {
  threats: [
    {
      reactorCombatantId: 'reactor',
      reactorName: 'Fixture',
      body: { position: point(20, 20), size: 'medium' as const },
      attacks: [{ attackId: 'ataque', attackName: 'Fixture', reachFeet: 10 }],
    },
  ],
  orderIndex: new Map([['reactor', 1]]),
  relationUnknown: false,
  masterAdjudication: false,
};
const mover = { position: point(15, 20), size: 'medium' as const },
  path = [point(10, 20), point(5, 20)];
check(
  'visão é calculada antes do passo de saída, não na origem inicial',
  scanReactionBoundaries(
    {
      ...scan,
      visibilityAt: (_id, position) =>
        position.xFeet === 10 ? 'known-visible' : 'known-not-visible',
    },
    mover,
    path,
  ).map((b) => b.visibility),
  ['known-visible'],
);
check(
  'visão perdida ao longo do caminho impede oportunidade',
  scanReactionBoundaries(
    {
      ...scan,
      visibilityAt: (_id, position) =>
        position.xFeet === 15 ? 'known-visible' : 'known-not-visible',
    },
    mover,
    path,
  ).length,
  0,
);
console.log(`✔ ${checks} verificações de linha de visão aprovadas.`);
