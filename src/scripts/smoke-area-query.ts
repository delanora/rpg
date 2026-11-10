import assert from 'node:assert/strict';
import { prisma } from '../config/prisma.js';
/** Somente fixtures do smoke isolado, depois da sentinela HTTP. */
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
    origin: { xFeet: 5, yFeet: 0, elevationFeet: 0 },
    angle: 0,
  };
  const query = async (input: unknown, token?: string) =>
    http(path, 'POST', input, token);
  let checks = 0;
  const check = (label: string, value: unknown) => {
    assert.ok(value, label);
    checks++;
    console.log('✔ ' + label);
  };
  let result = await query(sphere);
  check(
    'Área sem altura corporal pede decisão',
    result.status === 200 &&
      result.data.candidates[0].affected === 'unknown' &&
      result.data.candidates[0].reasons.includes('body-height-missing'),
  );
  const targetKey = result.data.candidates[0].targetKey;
  let decision = await query({
    ...sphere,
    decisions: [{ targetKey, affected: true }],
  });
  check(
    'Mestre inclui apenas caso desconhecido pela fundação existente',
    decision.status === 200 &&
      decision.data.candidates[0].affected === 'pass' &&
      decision.data.candidates[0].decisionSource === 'master-confirmed',
  );
  decision = await query({
    ...sphere,
    decisions: [{ targetKey, affected: false }],
  });
  check(
    'Mestre também pode excluir desconhecido',
    decision.status === 200 && decision.data.candidates[0].affected === 'fail',
  );
  await prisma.combatant.update({
    where: { id: combatantId },
    data: { bodyHeightFeet: 6 },
  });
  const before = JSON.stringify(
    await prisma.combat.findUnique({
      where: { id: combatId },
      include: { combatants: true },
    }),
  );
  result = await query(sphere);
  check(
    'Esfera deriva atingido real no servidor',
    result.status === 200 && result.data.candidates[0].affected === 'pass',
  );
  check(
    'Confirmação não sobrescreve atingido conhecido',
    (await query({ ...sphere, decisions: [{ targetKey, affected: false }] }))
      .status === 409,
  );
  result = await query({
    ...sphere,
    origin: { ...sphere.origin, elevationFeet: 30 },
  });
  check(
    'Área passa acima de personagem baixo',
    result.status === 200 && result.data.candidates[0].affected === 'fail',
  );
  check(
    'Confirmação não inclui alvo comprovadamente fora',
    (
      await query({
        ...sphere,
        origin: { ...sphere.origin, elevationFeet: 30 },
        decisions: [{ targetKey, affected: true }],
      })
    ).status === 409,
  );
  check(
    'Decisões duplicadas são recusadas',
    (
      await query({
        ...sphere,
        decisions: [
          { targetKey, affected: true },
          { targetKey, affected: false },
        ],
      })
    ).status === 400,
  );
  for (const shape of [
    { kind: 'cone', lengthFeet: 20 },
    { kind: 'line', lengthFeet: 20, widthFeet: 5 },
    { kind: 'cube', sizeFeet: 20 },
    { kind: 'cylinder', radiusFeet: 10, heightFeet: 10 },
  ]) {
    result = await query({
      ...sphere,
      shape,
      origin: { xFeet: 0, yFeet: 0, elevationFeet: 0 },
      ...(shape.kind === 'line' ? { lineHeightFeet: 10 } : {}),
    });
    check(
      `${shape.kind}: contrato e alvo derivados`,
      result.status === 200 && result.data.candidates[0].affected === 'pass',
    );
  }
  check(
    'Jogador não consulta entidades ocultas',
    (await query(sphere, playerToken)).status === 403,
  );
  check(
    'Cliente não escolhe atingidos',
    (await query({ ...sphere, targetIds: [combatantId] })).status === 400,
  );
  check(
    'Origem fora do mapa é recusada',
    (
      await query({
        ...sphere,
        origin: { xFeet: 1000, yFeet: 0, elevationFeet: 0 },
      })
    ).status === 400,
  );
  const after = JSON.stringify(
    await prisma.combat.findUnique({
      where: { id: combatId },
      include: { combatants: true },
    }),
  );
  check(
    'Consulta não altera combate, recursos ou combatentes',
    before === after,
  );
  console.log(`${checks} verificações HTTP de áreas aprovadas.`);
}
