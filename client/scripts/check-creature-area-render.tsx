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
const definition = {
  id: 'sopro',
  name: 'Sopro de prova',
  description: 'Prova',
  cost: 'action',
  execution: 'area-save-damage',
  trigger: '',
  maxUses: 1,
  area: {
    shape: { kind: 'sphere', radiusFeet: 85 },
    rangeFeet: 0,
    saveAbility: 'dexterity',
    dc: 15,
    onSuccess: 'half',
    damage: [{ type: 'Fogo', dice: { count: 2, sides: 6 } }],
  },
} as const;
const { creatureAbilitySchema } =
  await import('../../src/modules/shared/creature-abilities');
const ability = creatureAbilitySchema.parse(definition);
let previews = 0,
  uses: unknown[] = [],
  changed = false;
globals.fetch = async (path: unknown, init: { body: string }) => {
  const body = JSON.parse(init.body);
  if (String(path).includes('creature-area-preview')) {
    previews++;
    assert.equal(body.abilityId, 'sopro');
    assert.ok(!Object.hasOwn(body.placement, 'shape'));
    return new Response(
      JSON.stringify({
        combatId: 'fixture',
        combatVersion: 7,
        area: ability.area,
        definitionFingerprint: 'a'.repeat(64),
        candidates: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(path).endsWith('/creature-ability')) {
    uses.push(body);
    if (uses.length === 1) throw Error('Conexão interrompida');
    return new Response(
      JSON.stringify({ combat: { id: 'fixture', version: 8 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  throw Error('Rede externa proibida');
};
const root = createRoot(document.getElementById('root')!);
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(name),
  )!;
try {
  await act(async () =>
    root.render(
      h(GridAreaPreview, {
        request: {
          id: 1,
          shape: 'sphere',
          origin: { xFeet: 20, yFeet: 15 },
          ability: { combatantId: 'caster', definition: ability },
        },
        camera: { panX: 0, panY: 0, zoom: 1 },
        geometry: { cellSizeFeet: 5, pixelsPerCell: 50 },
        widthFeet: 100,
        heightFeet: 100,
        positionAt: () => ({ xFeet: 20, yFeet: 15 }),
        disabled: false,
        panning: false,
        pinging: false,
        assessmentContext: {
          combatId: 'fixture',
          version: 7,
          casterCombatantId: 'caster',
        },
        onCombatChange: () => {
          changed = true;
        },
      }),
    ),
  );
  assert.equal(previews, 0);
  assert.equal(
    (
      document.querySelector(
        '[aria-label="Dimensão da área"]',
      ) as HTMLSelectElement
    ).value,
    '85',
  );
  assert.equal(
    document.querySelector('[aria-label="Elevação da origem"]'),
    null,
  );
  await act(async () => button('Confirmar').click());
  assert.equal(previews, 1);
  await act(async () => button('Usar Sopro').click());
  assert.ok(document.body.textContent?.includes('Conexão interrompida'));
  assert.ok((button('Área ·') as HTMLButtonElement).disabled);
  await act(async () => button('Repetir envio').click());
  assert.equal(uses.length, 2);
  assert.deepEqual(uses[0], uses[1]);
  assert.ok(changed);
  assert.ok(!document.body.textContent?.includes('Usar Sopro'));
  console.log(
    '✔ Habilidade em área: dimensões do cadastro, nenhum campo de altura, confirmação, envio idempotente preservado após falha e adoção do combate.',
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
