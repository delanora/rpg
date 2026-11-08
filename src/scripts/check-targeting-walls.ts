/** Provas geométricas sem banco, dados reais, HTTP ou rolador. */
import assert from 'node:assert/strict';
import { evaluateWallPath } from '../modules/combat/spatial/targeting-walls.js';
import type { SpatialSize } from '../modules/combat/spatial/spatial.types.js';
const scene = { mode: 'grid-2d' as const, widthFeet: 100, heightFeet: 100, cellSizeFeet: 5 as const };
const point = (xFeet: number, yFeet: number) => ({ xFeet, yFeet });
const wall = (x: number, y1: number, y2: number, blocksTargeting = true) => ({
  start: point(x, y1), end: point(x, y2), blocksTargeting, blocksMovement: false, blocksSight: false,
});
let checks = 0;
function check(label: string, actual: string, expected: string) { assert.equal(actual, expected, label); checks++; }
for (const [size, span] of [['tiny', 2.5], ['small', 5], ['medium', 5], ['large', 10], ['huge', 15], ['gargantuan', 20]] as [SpatialSize, number][]) {
  const source = { position: point(5, 5), size }, target = { position: point(35, 5), size };
  const read = (walls: ReturnType<typeof wall>[]) => evaluateWallPath(scene, source, target, walls).result;
  check(`${size}: vazio é livre`, read([]), 'pass');
  check(`${size}: parede inteira bloqueia todos os pontos`, read([wall(30, 0, 100)]), 'fail');
  check(`${size}: flag independente de movimento e visão`, read([wall(30, 0, 100, false)]), 'pass');
  check(`${size}: parede fora do corredor não interfere`, read([wall(30, 60, 80)]), 'pass');
  check(`${size}: parede curta não é cobertura total`, read([wall(30, 5 + span / 2 - .2, 5 + span / 2 + .2)]), 'unknown');
  check(`${size}: canto não é bloqueio autoritativo`, read([wall(30, 5 + span, 90)]), 'unknown');
  check(`${size}: segmentos contíguos formam uma barreira`, read([wall(30, 0, 10), wall(30, 10, 100)]), 'fail');
  check(`${size}: endpoints invertidos mantêm a barreira`, read([wall(30, 10, 0), wall(30, 100, 10)]), 'fail');
  const middle = 5 + span / 2;
  check(`${size}: fresta é preservada`, read([wall(30, 0, middle - .1), wall(30, middle + .1, 100)]), 'unknown');
  check(`${size}: limite parcial do footprint não usa só seu centro`, read([wall(30, 5 + span / 2, 100)]), 'unknown');
  check(`${size}: caminho inverso tem o mesmo resultado`, evaluateWallPath(scene, target, source, [wall(30, 0, 100)]).result, 'fail');
  check(`${size}: posição ausente é desconhecida`, evaluateWallPath(scene, { position: null, size }, target, []).result, 'unknown');
  check(`${size}: posição fora da cena é desconhecida`, evaluateWallPath(scene, { position: point(-5, 5), size }, target, []).result, 'unknown');
  check(`${size}: mesma entidade dispensa caminho externo`, evaluateWallPath(scene, source, source, [wall(30, 0, 100)]).result, 'pass');
}
const source = { position: point(5, 5), size: 'medium' as const }, target = { position: point(35, 35), size: 'medium' as const };
check('diagonal integral separa footprints', evaluateWallPath(scene, source, target, [{ ...wall(30, 0, 100), start: point(0, 40), end: point(40, 0) }]).result, 'fail');
check('assistido continua assistido', evaluateWallPath({ ...scene, mode: 'assisted' }, source, target, []).result, 'unknown');
check('paredes não carregadas não viram caminho livre', evaluateWallPath(scene, source, target, undefined).result, 'unknown');
check('geometria corrompida não vira caminho livre', evaluateWallPath(scene, source, target, [wall(30, 10, 10)]).result, 'unknown');
console.log(`✔ ${checks} verificações de caminho livre por paredes aprovadas.`);
