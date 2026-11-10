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
globals.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globals.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
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
const wallPayloads: unknown[] = [];
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
      h(
        'div',
        { className: 'scene-wall-viewport' },
        h(
          'div',
          { className: 'fixture-map scene-preview', 'data-zoom': zoom },
          overlay,
        ),
      ),
    onReload: async () => scene,
    onWallMutation: async (mutation, version) => {
      walls++;
      wallPayloads.push(mutation);
      assert.equal(version, scene.version);
      if (mutation.kind === 'create')
        scene = {
          ...scene,
          version: version + 1,
          obstacles: [
            ...scene.obstacles,
            {
              ...mutation.wall,
              id: `added-${walls}`,
              kind: 'wall',
              lengthFeet: 5,
            },
          ],
        };
      if (mutation.kind === 'delete') scene = {...scene, version:version + 1, obstacles:scene.obstacles.filter(wall => wall.id !== mutation.wallId)};
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
    document.querySelector<HTMLButtonElement>(
      `[role="menu"] button[aria-label="${label}"]`,
    ) ??
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
const pressSpace = async (target: Element, repeat = false) =>
  act(async () => {
    target.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        repeat,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
const openContext = async () =>
  act(async () => {
    const rect = {
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() {},
    };
    host.querySelector('.scene-preview')!.getBoundingClientRect = () => rect;
    host
      .querySelector('.scene-walls-overlay')!
      .dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          clientX: 120,
          clientY: 80,
          button: 2,
          bubbles: true,
          cancelable: true,
        }),
      );
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
    (
      host.querySelector('.scene-map-canvas') as HTMLElement
    )?.style.getPropertyValue('--scene-editor-zoom') === '1.25',
  );
  check(
    'Pincel mantém paredes visíveis e um único mapa',
    host.querySelectorAll('.fixture-map').length === 1 &&
      host.querySelectorAll('.scene-map-saved-layer line').length === 1,
  );
  const slider = host.querySelector<HTMLInputElement>(
    '[aria-label="Elevação do terreno em metros"]',
  )!;
  check(
    'Barra começa em zero no centro entre −100 e +100 metros',
    slider.type === 'range' &&
      slider.min === '-100' &&
      slider.max === '100' &&
      slider.value === '0',
  );
  await pointer('pointerdown', 60, 60);
  check(
    'Barra recolhe durante a pintura',
    (host.querySelector('.scene-height-cursor') as HTMLElement).hidden,
  );
  await pointer('pointermove', 160, 60);
  await pointer('pointerup', 160, 60);
  check(
    'Barra reaparece ao soltar o pincel',
    !(host.querySelector('.scene-height-cursor') as HTMLElement).hidden,
  );
  check('Pintura não escreve antes de confirmar', calls.length === 0);
  check(
    'Rascunho impede alternar e perder a seleção',
    button('Desenhar parede').disabled,
  );
  await input('-1.5');
  await pressSpace(host.querySelector('[data-scene-save-on-space]')!);
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
  await click('Começar a desenhar parede');
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
  await pressSpace(host.querySelector('.scene-walls-overlay')!);
  check('Salvar parede usa contrato existente', walls === 1);
  await click('Pincel de elevação');
  await pointer('pointerdown', 50, 150);
  await pointer('pointerup', 50, 150);
  await act(async () =>
    host.querySelector('.scene-elevation-editor')!.dispatchEvent(
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
    (
      host.querySelector('.scene-map-canvas') as HTMLElement
    )?.style.getPropertyValue('--scene-editor-zoom') === '1' &&
      calls.length === before,
  );
  await openContext();
  check(
    'Botão direito abre radial neutro sem escrever',
    !!document.querySelector(
      '[role="menu"][aria-label="Ferramentas do mapa"]',
    ) &&
      !document.querySelector('.scene-editor-radial .is-highlighted') &&
      calls.length === before,
  );
  await click('Configurar parede');
  await click('Escolher cobertura');
  await click('Meia cobertura');
  await click('Bloqueia visão');
  await click('Bloqueia movimento');
  check(
    'Radial mantém visão e movimento independentes da cobertura',
    document
      .querySelector('[aria-label="Bloqueia visão"]')
      ?.getAttribute('aria-checked') === 'false' &&
      document
        .querySelector('[aria-label="Bloqueia movimento"]')
        ?.getAttribute('aria-checked') === 'false',
  );
  await click('Começar a desenhar parede');
  await pointer('pointerdown', 50, 50);
  await pointer('pointerdown', 150, 50);
  const beforeWall = walls;
  await pressSpace(host.querySelector('.scene-walls-overlay')!);
  await pressSpace(host.querySelector('.scene-walls-overlay')!, true);
  const payload = wallPayloads.at(-1) as {
    wall: {
      blocksMovement: boolean;
      blocksSight: boolean;
      coverLevel: string;
      blocksTargeting: boolean;
    };
  };
  check(
    'Espaço salva uma vez com a configuração escolhida no radial',
    walls === beforeWall + 1 &&
      !payload.wall.blocksSight &&
      !payload.wall.blocksMovement &&
      payload.wall.coverLevel === 'half' &&
      !payload.wall.blocksTargeting,
  );
  const beforePan = (
    host.querySelector('.scene-map-canvas') as HTMLElement
  ).style.getPropertyValue('--scene-editor-pan-x');
  await act(async () => {
    host
      .querySelector('.scene-map-editor')!
      .dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'd',
          code: 'KeyD',
          bubbles: true,
          cancelable: true,
        }),
      );
    await new Promise((resolve) => setTimeout(resolve, 45));
    window.dispatchEvent(
      new dom.window.KeyboardEvent('keyup', { key: 'd', code: 'KeyD' }),
    );
  });
  const afterPan = (
    host.querySelector('.scene-map-canvas') as HTMLElement
  ).style.getPropertyValue('--scene-editor-pan-x');
  check(
    'WASD move apenas a câmera',
    beforePan !== afterPan &&
      walls === beforeWall + 1 &&
      calls.length === before,
  );
  await click('Pincel de elevação');
  await pointer('pointerdown', 250, 150);
  await pointer('pointerup', 250, 150);
  const beforeTyping = (
    host.querySelector('.scene-map-canvas') as HTMLElement
  ).style.getPropertyValue('--scene-editor-pan-x');
  await act(async () => {
    host
      .querySelector('input[data-scene-save-on-space]')!
      .dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'a',
          code: 'KeyA',
          bubbles: true,
          cancelable: true,
        }),
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
    window.dispatchEvent(
      new dom.window.KeyboardEvent('keyup', { code: 'KeyA' }),
    );
  });
  check(
    'Digitar em campo de altura não move câmera',
    beforeTyping ===
      (
        host.querySelector('.scene-map-canvas') as HTMLElement
      ).style.getPropertyValue('--scene-editor-pan-x'),
  );
  await act(async () =>
    host
      .querySelector('.scene-map-editor')!
      .dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
  );
  check(
    'Esc no editor cancela rascunho sem salvar',
    !button('Desenhar parede').disabled && calls.length === before,
  );
  await act(async () => { scene = {...scene, version: scene.version + 1, spatialConfig: {...scene.spatialConfig, elevationCells:[{xFeet:0,yFeet:0,elevationFeet:5},{xFeet:5,yFeet:0,elevationFeet:10},{xFeet:30,yFeet:15,elevationFeet:-5}]}}; updateScene(scene); });
  await click('Borracha'); await click('Apagar elevações');
  const eraseBefore = calls.length;
  await pointer('pointerdown', 10, 10); await pointer('pointermove', 60, 10); await pointer('pointerup', 60, 10);
  check('Borracha de altura apenas seleciona antes da confirmação', calls.length === eraseBefore && button('Desenhar parede').disabled);
  await click('Confirmar');
  check('Borracha remove só os quadrados pintados e preserva os demais', scene.spatialConfig.elevationCells?.length === 1 && scene.spatialConfig.elevationCells[0].xFeet === 30);
  await click('Borracha'); await click('Apagar paredes');
  const wallBefore = walls;
  const hit = host.querySelector('.scene-wall-hit')!;
  await act(async () => {const event = new dom.window.MouseEvent('pointerdown', {bubbles:true,button:0}); Object.defineProperty(event,'pointerId',{value:1}); hit.dispatchEvent(event);});
  check('Borracha de parede pede confirmação sem escrever nem arrastar', walls === wallBefore && !!button('Confirmar exclusão') && !host.querySelector('.scene-wall-handle'));
  await click('Manter parede');
  check('Cancelar borracha conserva a parede', walls === wallBefore && scene.obstacles.length > 0);
  await act(async () => {const event = new dom.window.MouseEvent('pointerdown', {bubbles:true,button:0}); Object.defineProperty(event,'pointerId',{value:2}); hit.dispatchEvent(event);});
  const wallId = scene.obstacles[0].id;
  await click('Confirmar exclusão');
  check('Borracha exclui a parede pela operação existente', walls === wallBefore + 1 && !scene.obstacles.some(wall => wall.id === wallId) && (wallPayloads.at(-1) as {kind:string}).kind === 'delete');
  console.log(`${checks} verificações do editor unificado aprovadas.`);
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
