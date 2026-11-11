import { smokeCreatureArea } from './smoke-creature-area.js';
import assert from 'node:assert/strict';
import { prisma } from '../config/prisma.js';
/** Somente fixtures descartáveis, depois da sentinela HTTP do smoke de elevação. */
export async function smokeAreaQuery(
  http: (
    path: string,
    method?: string,
    body?: unknown,
    token?: string,
  ) => Promise<{ status: number; data: any }>,
  combatId: string,
  combatantId: string,
  playerToken: string,
) {
  assert.match(
    new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  const path = `/combat/${combatId}/spatial/area-query`;
  const sphere = {
    shape: { kind: 'sphere', radiusFeet: 10 },
    origin: { xFeet: 5, yFeet: 0 },
    angle: 0,
    casterCombatantId: combatantId,
  };
  const query = (input: unknown, token?: string) =>
    http(path, 'POST', input, token);
  let checks = 0;
  const check = (label: string, ok: unknown) => {
    assert.ok(ok, label);
    checks++;
    console.log('✔ ' + label);
  };
  const before = JSON.stringify(
    await prisma.combat.findUnique({
      where: { id: combatId },
      include: { combatants: true },
    }),
  );
  let result = await query(sphere);
  check(
    'Mesmo nível inclui sem cadastrar altura corporal',
    result.status === 200 && result.data.candidates[0].affected === 'pass',
  );
  const targetKey = result.data.candidates[0].targetKey;
  check(
    'Decisão não sobrescreve alvo autoritativo',
    (await query({ ...sphere, decisions: [{ targetKey, affected: false }] }))
      .status === 409,
  );
  result = await query({
    ...sphere,
    origin: { ...sphere.origin, elevationFeet: 300 },
  });
  check(
    'Altura legada da origem não muda a elevação do caster',
    result.status === 200 && result.data.candidates[0].affected === 'pass',
  );
  for (const shape of [
    { kind: 'cone', lengthFeet: 20 },
    { kind: 'line', lengthFeet: 20, widthFeet: 5 },
    { kind: 'cube', sizeFeet: 20 },
    { kind: 'cylinder', radiusFeet: 10, heightFeet: 10 },
  ]) {
    result = await query({ ...sphere, shape, origin: { xFeet: 0, yFeet: 0 } });
    check(
      `${shape.kind}: inclui no mesmo nível`,
      result.status === 200 && result.data.candidates[0].affected === 'pass',
    );
  }
  check(
    'Jogador não consulta entidades ocultas',
    (await query(sphere, playerToken)).status === 403,
  );
  check(
    'Cliente não envia atingidos',
    (await query({ ...sphere, targetIds: [combatantId] })).status === 400,
  );
  check(
    'Origem fora do mapa recusada',
    (await query({ ...sphere, origin: { xFeet: 1000, yFeet: 0 } })).status ===
      400,
  );
  const after = JSON.stringify(
    await prisma.combat.findUnique({
      where: { id: combatId },
      include: { combatants: true },
    }),
  );
  check('Consultas não alteram dados', before === after);
  console.log(`${checks} verificações HTTP de áreas aprovadas.`);
  await smokeCreatureArea(http, combatId, combatantId, playerToken);
}
