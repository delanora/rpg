/** Editor unificado real em jsdom: sem rede, sem dados da campanha. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Scene, ScenePatch } from '../src/types';
const dom = new JSDOM('<html><body><div id="fixture"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
const globals = globalThis as unknown as Record<string, unknown>;
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'SVGElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'localStorage',
  'MutationObserver',
])
  globals[key] =
    key === 'window'
      ? dom.window
      : key === 'document'
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[key];
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => {
  throw Error('Rede proibida nesta fixture.');
};
const { createElement: h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SceneMapEditor } =
  await import('../src/components/master/SceneMapEditor');
let scene: Scene & { regionId: string | null } = {
  regionId: null,
  id: 'mapa-fixture',
  localityId: 'local-fixture',
  name: 'Mapa único',
  spatialConfig: {
    mode: 'grid-2d',
    widthFeet: 40,
    heightFeet: 20,
    cellSizeFeet: 5,
    elevationCells: [{ xFeet: 0, yFeet: 0, elevationFeet: 5 }],
  },
  obstacles: [
    {
      id: 'wall-fixture',
      kind: 'wall',
      start: { xFeet: 20, yFeet: 0 },
      end: { xFeet: 20, yFeet: 20 },
      lengthFeet: 20,
      blocksMovement: true,
      blocksSight: true,
    },
  ],
  backgroundImageUrl: null,
  version: 1,
  createdAt: 'fixture',
  updatedAt: 'fixture',
};
let updateScene: (next: Scene) => void = () => {};
let disable: (value: boolean) => void = () => {};
let failSave = false;
let saved: Scene | null = null;
const calls: { patch: ScenePatch; version: number; id: string }[] = [];
let walls = 0,
  checks = 0;
const check = (label: string, value: unknown) => {
  assert.ok(value, label);
  checks++;
  console.log(`✔ ${label}`);
};
function Harness() {
  const [current, update] = useState<Scene>(scene);
  const [disabled, setDisabled] = useState(false);
  updateScene = update;
  disable = setDisabled;
  return h(SceneMapEditor, {
    scene: current,
    disabled,
    renderCanvas: (overlay, zoom) =>
      h('div', { className: 'fixture-map', 'data-zoom': zoom }, overlay),
    onReload: async () => scene,
    onWallMutation: async (mutation, version) => {
      walls++;
      assert.equal(version, scene.version);
      if (mutation.kind === 'create')
        scene = {
          ...scene,
          version: version + 1,
          obstacles: [
            ...scene.obstacles,
            { ...mutation.wall, id: 'added', kind: 'wall', lengthFeet: 5 },
          ],
        };
      update(scene);
      return scene;
    },
    onSaveElevation: async (patch, version, id) => {
      calls.push({ patch, version, id });
      if (saved) {
        update(saved);
        const replay = saved;
        saved = null;
        return replay;
      }
      scene = {
        ...scene,
        version: version + 1,
        spatialConfig: { ...scene.spatialConfig, ...patch.spatialConfig },
      };
      update(scene);
      if (failSave) {
        saved = scene;
        failSave = false;
        throw new TypeError('Resposta perdida após commit.');
      }
      return scene;
    },
  });
}
const host = document.querySelector('#fixture')!;
const root = createRoot(host);
const button = (label: string) => {
  const result =
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === label,
    );
  assert.ok(result, 'Botão ' + label);
  return result;
};
const click = async (label: string) => act(async () => button(label).click());
const pointer = async (kind: string, x: number, y: number) =>
  act(async () => {
    const svg = host.querySelector<SVGSVGElement>('.scene-walls-overlay')!;
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() {},
    });
    const event = new dom.window.MouseEvent(kind, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    svg.dispatchEvent(event);
  });
const input = async (value: string) =>
  act(async () => {
    const node = host.querySelector<HTMLInputElement>(
      '[aria-label="Elevação do terreno em metros"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(node, value);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
try {
  await act(async () => root.render(h(Harness)));
  check(
    'Um único mapa e barra interna',
    host.querySelectorAll('.fixture-map').length === 1 &&
      !!host.querySelector('.scene-map-canvas [role="toolbar"]'),
  );
  check(
    'Elevações salvas aparecem com ferramenta de parede',
    host.querySelectorAll('.scene-map-saved-layer .scene-elevation-cell')
      .length === 1,
  );
  await click('Aumentar zoom da cena');
  await click('Pincel de elevação');
  check(
    'Trocar ferramenta mantém zoom',
    host.querySelector('.fixture-map')?.getAttribute('data-zoom') === '1.25',
  );
  check(
    'Pincel mantém paredes visíveis e um único mapa',
    host.querySelectorAll('.fixture-map').length === 1 &&
      host.querySelectorAll('.scene-map-saved-layer line').length === 1,
  );
  await pointer('pointerdown', 60, 60);
  await pointer('pointermove', 160, 60);
  await pointer('pointerup', 160, 60);
  check('Pintura não escreve antes de confirmar', calls.length === 0);
  check(
    'Rascunho impede alternar e perder a seleção',
    button('Desenhar parede').disabled,
  );
  await input('-1,5');
  await click('Confirmar');
  check(
    'Confirma metros negativos em pés pelo mesmo contrato',
    calls.length === 1 &&
      calls[0].patch.spatialConfig?.elevationCells?.some(
        (c) => c.elevationFeet === -5,
      ),
  );
  check(
    'Salvar libera troca de ferramenta',
    !button('Desenhar parede').disabled,
  );
  await click('Desenhar parede');
  check(
    'Parede ativa mantém elevações recém-salvas',
    host.querySelectorAll('.scene-map-saved-layer .scene-elevation-cell')
      .length > 1,
  );
  await pointer('pointerdown', 50, 50);
  await pointer('pointermove', 150, 50);
  await pointer('pointerdown', 150, 50);
  check('Desenho da parede continua local', walls === 0);
  check(
    'Parede em edição protege troca para pincel',
    button('Pincel de elevação').disabled,
  );
  await click('Salvar parede');
  check('Salvar parede usa contrato existente', walls === 1);
  await click('Pincel de elevação');
  await pointer('pointerdown', 50, 150);
  await pointer('pointerup', 50, 150);
  await act(async () =>
    host
      .querySelector('.scene-elevation-editor')!
      .dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      ),
  );
  check(
    'Esc cancela e libera ferramentas sem escrita',
    !button('Selecionar parede').disabled && calls.length === 1,
  );
  failSave = true;
  await pointer('pointerdown', 250, 50);
  await pointer('pointerup', 250, 50);
  await input('3');
  await click('Confirmar');
  check(
    'Resposta perdida conserva intenção e bloqueia troca',
    button('Selecionar parede').disabled &&
      !!host.querySelector('[role="alert"]'),
  );
  await click('Repetir envio');
  check(
    'Retry preserva operação, payload e versão',
    calls.length === 3 &&
      calls[1].id === calls[2].id &&
      calls[1].version === calls[2].version &&
      JSON.stringify(calls[1].patch) === JSON.stringify(calls[2].patch),
  );
  check(
    'Retry confirmado libera editor',
    !button('Selecionar parede').disabled,
  );
  await click('Selecionar parede');
  await act(async () => disable(true));
  check(
    'Cena bloqueada impede ferramentas de edição',
    button('Desenhar parede').disabled && button('Pincel de elevação').disabled,
  );
  await act(async () => disable(false));
  await click('Pincel de elevação');
  await pointer('pointerdown', 50, 100);
  await pointer('pointerup', 50, 100);
  const before = calls.length;
  await act(async () => {
    scene = { ...scene, version: scene.version + 1 };
    updateScene(scene);
  });
  check(
    'Versão nova não sobrescreve rascunho antigo',
    button('Confirmar').disabled && calls.length === before,
  );
  await click('Cancelar');
  await click('Restaurar zoom da cena');
  check(
    'Restaurar zoom não escreve na cena',
    host.querySelector('.fixture-map')?.getAttribute('data-zoom') === '1' &&
      calls.length === before,
  );
  console.log(`${checks} verificações do editor unificado aprovadas.`);
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
