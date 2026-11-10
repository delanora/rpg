import assert from 'node:assert/strict';
import { sceneMovementTerrain } from '../modules/combat/spatial/movement-terrain.js';
import { evaluateMovementPath } from '../modules/combat/spatial/spatial-movement.js';
import { terrainCellsSchema } from '../modules/combat/spatial/terrain.schema.js';
const cells = [{ xFeet: 5, yFeet: 0 }];
const terrain = sceneMovementTerrain(cells);
assert.equal(terrain.difficultAt({ xFeet: 0, yFeet: 0 }, 'medium'), 'normal');
assert.equal(
  terrain.difficultAt({ xFeet: 5, yFeet: 0 }, 'medium'),
  'difficult',
);
assert.equal(terrain.difficultAt({ xFeet: 0, yFeet: 0 }, 'large'), 'difficult');
assert.equal(terrain.difficultAt({ xFeet: 10, yFeet: 0 }, 'medium'), 'normal');
assert.equal(
  sceneMovementTerrain().difficultAt({ xFeet: 0, yFeet: 0 }, 'medium'),
  'normal',
);
assert.equal(
  terrainCellsSchema.safeParse([{ xFeet: 1, yFeet: 0 }]).success,
  false,
);
assert.equal(terrainCellsSchema.safeParse([...cells, ...cells]).success, false);
const input = {
  scene: {
    mode: 'grid-2d' as const,
    widthFeet: 40,
    heightFeet: 40,
    cellSizeFeet: 5 as const,
  },
  mover: {
    combatantId: 'hero',
    name: 'Herói',
    position: { xFeet: 0, yFeet: 0 },
    size: 'medium' as const,
    sideKey: 'players',
  },
  others: [],
  path: [
    { xFeet: 5, yFeet: 0 },
    { xFeet: 10, yFeet: 0 },
  ],
  prone: false,
  movementRemainingFeet: 30,
  terrain,
  revealBlockers: true,
};
assert.equal(evaluateMovementPath(input).totalCostFeet, 15);
assert.equal(evaluateMovementPath({ ...input, prone: true }).totalCostFeet, 25);
assert.equal(
  evaluateMovementPath({ ...input, movementRemainingFeet: 10 }).affordable,
  false,
);
console.log(
  '✔ Terreno: legado normal, footprint grande, bordas, alinhamento/duplicatas, custo misto, rastejar e saldo insuficiente.',
);
