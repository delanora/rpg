/** Interação com o componente real; HTTP substituído por fixtures em memória. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'localStorage',
])
  globals[name] =
    name === 'window'
      ? dom.window
      : name === 'document'
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { GridAreaPreview } = await import('../src/combat/grid/GridAreaPreview');
let posted: Record<string, unknown> | null = null,
  calls = 0,
  fail = false,
  version = 7,
  context = true;
const rows = [
  {
    combatantId: 'hero',
    targetKey: 'character:hero',
    name: 'Herói',
    geometry: 'pass',
    propagation: 'pass',
    affected: 'pass',
    reasons: [],
  },
  {
    combatantId: 'npc',
    targetKey: 'combatant:npc',
    name: 'Sentinela',
    geometry: 'unknown',
    propagation: 'pass',
    affected: 'fail',
    overrideAllowed: true,
    reasons: ['different-elevation'],
  },
];
globals.fetch = async (_path: unknown, init: { body: string }) => {
  calls++;
  posted = JSON.parse(init.body);
  if (fail) throw Error('Falha simulada');
  return new Response(
    JSON.stringify({
      combatId: 'fixture',
      combatVersion: version,
      candidates: rows.map((row) =>
        row.combatantId === 'npc' &&
        (
          posted as { decisions?: { targetKey: string; affected: boolean }[] }
        )?.decisions?.some((item) => item.targetKey === row.targetKey)
          ? { ...row, affected: 'pass', decisionSource: 'master-confirmed' }
          : row,
      ),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
let highlighted: unknown[] = [];
const onTargets = (value: unknown[]) => {
  highlighted = value;
};
const root = createRoot(document.getElementById('root')!);
const render = () =>
  act(async () =>
    root.render(
      h(GridAreaPreview, {
        request: { id: 1, shape: 'sphere', origin: { xFeet: 20, yFeet: 15 } },
        camera: { panX: 0, panY: 0, zoom: 1 },
        geometry: { cellSizeFeet: 5, pixelsPerCell: 50 },
        widthFeet: 100,
        heightFeet: 100,
        positionAt: () => ({ xFeet: 20, yFeet: 15 }),
        disabled: false,
        panning: false,
        pinging: false,
        assessmentContext: context ? { combatId: 'fixture', version } : null,
        onTargets,
      }),
    ),
  );
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(name),
  )!;
try {
  await render();
  assert.equal(calls, 0);
  await act(async () => button('Confirmar').click());
  assert.equal(calls, 1);
  assert.ok(
    document.body.textContent?.includes('1 atingido(s)'),
  );
  assert.ok(document.body.textContent?.includes('Outra elevação · fora por padrão'));
  assert.equal(highlighted.length, 2);
  assert.ok(posted && !Object.hasOwn(posted, 'targetIds'));
  assert.deepEqual((posted as unknown as { origin: unknown }).origin, {
    xFeet: 20,
    yFeet: 15,
  });
  await act(async () => button('Incluir').click());
  assert.ok(
    document.body.textContent?.includes('2 atingido(s)'),
  );
  assert.ok(document.body.textContent?.includes('decisão do Mestre'));
  fail = true;
  version = 8;
  await render();
  assert.ok(document.body.textContent?.includes('Falha simulada'));
  assert.equal(highlighted.length, 0);
  assert.equal(
    (posted as unknown as { decisions: unknown[] }).decisions.length,
    0,
  );
  context = false;
  await render();
  assert.equal(document.querySelector('.grid-area-assessment'), null);
  assert.equal(highlighted.length, 0);
  console.log(
    '✔ UI de área: consulta após confirmar, atingidos/pendências do servidor, sem alvos no payload, erro limpa destaque e contexto privado removido.',
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
