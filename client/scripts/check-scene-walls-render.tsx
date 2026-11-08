/** 6.6M.4.2 — interação React real em jsdom, sem acesso à API da mesa.
 * npx tsx --tsconfig client/tsconfig.json client/scripts/check-scene-walls-render.tsx
 */
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import type { Scene } from '../src/types';
import type { SceneWallMutation } from '../src/sceneWallsApi';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'localStorage', 'MutationObserver']) {
  globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document :
    (dom.window as unknown as Record<string, unknown>)[name];
}
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => { throw new Error('Rede real proibida neste teste'); };
const { createElement: h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SceneWallsEditor } = await import('../src/components/master/SceneWallsEditor');
const { ApiError } = await import('../src/api');
const { mutateSceneWall } = await import('../src/sceneWallsApi');
const { wallPointerPosition, translateWall, wallDraftError } = await import('../src/components/master/sceneWallGeometry');

let checks = 0;
function check(label: string, condition: unknown) { assert.ok(condition, label); checks++; console.log(`✔ ${label}`); }
const baseScene = (): Scene => ({ id: 'cena-fixture', localityId: 'localidade-fixture', name: 'Salão',
  spatialConfig: { mode: 'grid-2d', widthFeet: 40, heightFeet: 20, cellSizeFeet: 5 },
  backgroundImageUrl: null, obstacles: [], version: 1, createdAt: 'fixture', updatedAt: 'fixture' });
const calls: { mutation: SceneWallMutation; version: number; operationId: string }[] = [];
let latest = baseScene();
let setScene: (scene: Scene) => void = () => {};
let setDisabled: (value: boolean) => void = () => {};
let behavior: 'ok' | 'lost-response' | 'conflict' | 'locked' = 'ok';
let replayScene: Scene | null = null;
function Harness() {
  const [scene, update] = useState(latest);
  const [disabled, disable] = useState(false);
  setScene = update; setDisabled = disable;
  return h(SceneWallsEditor, {
    scene, disabled, renderCanvas: (overlay) => h('div', null, overlay),
    onReload: async () => { update(latest); return latest; },
    onMutate: async (mutation, version, operationId) => {
      calls.push({ mutation, version, operationId });
      if (behavior === 'conflict') throw new ApiError('A cena mudou.', 409, 'CONFLICT');
      if (behavior === 'locked') throw new ApiError('Cena em uso por combate.', 409, 'SCENE_IN_USE');
      if (replayScene) { update(replayScene); const result = replayScene; replayScene = null; return result; }
      const obstacles = [...latest.obstacles];
      if (mutation.kind === 'create' || mutation.kind === 'create-many') {
        const walls = mutation.kind === 'create' ? [mutation.wall] : mutation.walls;
        walls.forEach((wall, index) => obstacles.push({ id: `parede-${operationId}-${index}`, kind: 'wall',
          ...wall, lengthFeet: Math.hypot(wall.end.xFeet - wall.start.xFeet, wall.end.yFeet - wall.start.yFeet) }));
      }
      if (mutation.kind === 'update') {
        const i = obstacles.findIndex(wall => wall.id === mutation.wallId);
        obstacles[i] = { ...obstacles[i], ...mutation.wall };
      }
      latest = { ...latest, version: latest.version + 1,
        obstacles: mutation.kind === 'delete' ? obstacles.filter(wall => wall.id !== mutation.wallId) : obstacles };
      update(latest);
      if (behavior === 'lost-response') { replayScene = latest; throw new TypeError('Resposta perdida após commit'); }
      return latest;
    },
  });
}
const container = document.createElement('div'); document.body.appendChild(container);
const root = createRoot(container);
const button = (text: string) => {
  const found = [...container.querySelectorAll('button')].find(b => b.textContent === text);
  if (!found) throw new Error(`Botão ausente: ${text}`); return found;
};
const click = async (text: string) => act(async () => { button(text).click(); });
const pointer = async (target: Element, type: string, x: number, y: number) => act(async () => {
  const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
});
const canvas = () => {
  const svg = container.querySelector('svg')!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} });
  return svg;
};
try {
  await act(async () => root.render(h(Harness)));
  await click('Desenhar parede');
  await pointer(canvas(), 'pointerdown', 50, 50);
  await pointer(canvas(), 'pointermove', 250, 150);
  await pointer(canvas(), 'pointerdown', 250, 150);
  check('Desenhar só altera rascunho; duas coordenadas não fazem escrita', calls.length === 0);
  check('Rascunho usa coordenadas do mapa, com ajuste à grade', container.querySelector('.scene-wall-draft')?.getAttribute('x2') === '25');
  await act(async () => { button('Salvar parede').click(); button('Salvar parede').click(); });
  check('Salvar com clique duplo cria uma única intenção', calls.length === 1 && calls[0].mutation.kind === 'create');
  check('Payload conserva pés, versão e operationId', calls[0].version === 1 && calls[0].operationId.length > 0 &&
    calls[0].mutation.kind === 'create' && calls[0].mutation.wall.start.xFeet === 5 && calls[0].mutation.wall.end.yFeet === 15);
  check('Resposta do servidor atualiza a lista imediatamente', latest.obstacles.length === 1 && container.querySelectorAll('.scene-wall-item').length === 1);

  await act(async () => (container.querySelector('.scene-wall-item') as HTMLButtonElement).click());
  const end = container.querySelector('[aria-label="Fim da parede"]')!;
  await pointer(end, 'pointerdown', 250, 150);
  await pointer(canvas(), 'pointermove', 300, 150);
  await pointer(canvas(), 'pointerup', 300, 150);
  check('Arrastar extremo é local até salvar', calls.length === 1 && container.querySelector('[aria-label="Fim da parede"]')?.getAttribute('cx') === '30');
  await click('Cancelar edição');
  check('Cancelar não altera a parede persistida', calls.length === 1 && latest.obstacles[0].end.xFeet === 25);
  await act(async () => (container.querySelector('.scene-wall-item') as HTMLButtonElement).click());
  await pointer(container.querySelector('.scene-wall-hit')!, 'pointerdown', 150, 100);
  await pointer(canvas(), 'pointermove', 200, 100);
  await pointer(canvas(), 'pointerup', 200, 100);
  await click('Salvar parede');
  check('Arrastar a linha salva ambos os extremos juntos', calls.at(-1)?.mutation.kind === 'update' && latest.obstacles[0].start.xFeet === 10 && latest.obstacles[0].end.xFeet === 30);

  await act(async () => (container.querySelector('.scene-wall-item') as HTMLButtonElement).click());
  await act(async () => { container.querySelector('svg')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  check('Esc cancela a seleção sem escrever', !container.querySelector('fieldset') && calls.length === 2);
  await click('Nova por coordenadas');
  check('Alternativa por formulário permite edição sem ponteiro', container.querySelectorAll('fieldset input[type="number"]').length === 4);
  await act(async () => { latest = { ...latest, version: latest.version + 1 }; setScene(latest); });
  check('Evento de outra aba torna rascunho antigo indisponível', button('Salvar parede').disabled && container.textContent?.includes('A cena mudou'));
  await click('Cancelar edição');

  behavior = 'lost-response';
  await click('Nova por coordenadas'); await click('Salvar parede');
  const failed = calls.at(-1)!;
  check('Resposta perdida congela edição e oferece retry mesmo após realtime', Boolean(button('Tentar novamente')) && button('Nova por coordenadas').disabled);
  behavior = 'ok'; await click('Tentar novamente');
  const replayed = calls.at(-1)!;
  check('Retry reenvia payload, versão e id originais; não duplica parede',
    JSON.stringify(replayed) === JSON.stringify(failed) && latest.obstacles.length === 2);

  behavior = 'conflict';
  await click('Nova por coordenadas'); await click('Salvar parede');
  check('409 é recusa confirmada, sem retry automático ou alteração local', container.textContent?.includes('A cena mudou.') && !container.textContent?.includes('Tentar novamente'));
  await click('Cancelar edição');
  behavior = 'locked';
  await click('Nova por coordenadas'); await click('Salvar parede');
  check('Cena em uso apresenta o erro do servidor', container.textContent?.includes('Cena em uso por combate.'));
  await click('Recarregar cena'); behavior = 'ok';
  await act(async () => setDisabled(true));
  const count = calls.length;
  await pointer(canvas(), 'pointerdown', 10, 10);
  check('Edição desabilitada não envia operações', button('Desenhar parede').disabled && calls.length === count);
  await act(async () => setDisabled(false));
  await act(async () => (container.querySelector('.scene-wall-item') as HTMLButtonElement).click());
  await click('Excluir parede');
  check('Excluir exige confirmação', calls.length === count && Boolean(button('Confirmar exclusão')));
  await click('Confirmar exclusão');
  check('Confirmação remove apenas a parede selecionada', calls.at(-1)?.mutation.kind === 'delete' && latest.obstacles.length === 1);

  const rect = { left: 100, top: 50, width: 800, height: 400 };
  const pos = wallPointerPosition({ x: 500, y: 250 }, rect, { widthFeet: 40, heightFeet: 20 }, 5);
  check('Zoom/scroll não alteram o ponto espacial', pos?.xFeet === 20 && pos.yFeet === 10);
  check('Retângulo não medido não inventa coordenadas', wallPointerPosition({ x: 0, y: 0 }, { ...rect, width: 0 }, { widthFeet: 40, heightFeet: 20 }, 5) === null);
  const wall = { start: { xFeet: 5, yFeet: 5 }, end: { xFeet: 15, yFeet: 10 }, blocksMovement: true, blocksSight: false };
  const shifted = translateWall(wall, { xFeet: 100, yFeet: -100 }, { widthFeet: 40, heightFeet: 20 });
  check('Arrastar contra a borda preserva comprimento e inclinação', shifted.end.xFeet === 40 && shifted.start.yFeet === 0 && shifted.end.xFeet - shifted.start.xFeet === 10 && shifted.end.yFeet - shifted.start.yFeet === 5);
  check('Parede degenerada é recusada antes do envio', Boolean(wallDraftError({ ...wall, end: wall.start }, { widthFeet: 40, heightFeet: 20 })));

  await pointer(container.querySelector('.scene-wall-hit')!, 'pointerdown', 0, 0);
  await pointer(canvas(), 'pointermove', 50, 0);
  await pointer(canvas(), 'pointerup', 50, 0);
  await click('Salvar parede');
  const directDrag = calls.at(-1)?.mutation;
  check('Selecionar e arrastar pela linha não envia metadados do DTO como geometria',
    directDrag?.kind === 'update' && Object.keys(directDrag.wall).sort().join(',') === 'blocksMovement,blocksSight,end,start');

  const beforeTrace = calls.length;
  await click('Desenhar parede');
  for (const [x, y] of [[50, 50], [150, 50], [150, 150], [250, 150]]) {
    await pointer(canvas(), 'pointerdown', x, y);
  }
  check('Cliques sucessivos criam vários cantos sem salvar a cada reta', calls.length === beforeTrace && Boolean(button('Salvar traçado (3)')));
  await click('Desfazer último ponto');
  check('Desfazer remove só o último segmento do rascunho', Boolean(button('Salvar traçado (2)')) && calls.length === beforeTrace);
  await pointer(canvas(), 'pointerdown', 250, 150);
  await pointer(canvas(), 'pointerdown', 50, 50);
  await act(async () => { button('Salvar traçado (4)').click(); button('Salvar traçado (4)').click(); });
  const trace = calls.at(-1)?.mutation;
  check('Contorno completo é enviado em uma única intenção atômica',
    calls.length === beforeTrace + 1 && trace?.kind === 'create-many' && trace.walls.length === 4 &&
    trace.walls[3].end.xFeet === trace.walls[0].start.xFeet && trace.walls[3].end.yFeet === trace.walls[0].start.yFeet);

  const httpCalls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  globals.fetch = async (input: string, options: RequestInit) => {
    httpCalls.push({ path: input, method: String(options.method), body: JSON.parse(String(options.body)) });
    return new Response(JSON.stringify({ scene: latest }), { status: 200 });
  };
  await mutateSceneWall(latest.id, { kind: 'create', wall }, 7, 'operacao-criar');
  await mutateSceneWall(latest.id, { kind: 'update', wallId: 'parede-fixture', wall }, 8, 'operacao-editar');
  await mutateSceneWall(latest.id, { kind: 'delete', wallId: 'parede-fixture' }, 9, 'operacao-apagar');
  await mutateSceneWall(latest.id, { kind: 'create-many', walls: [wall, wall] }, 10, 'operacao-tracado');
  check('API reutiliza POST/PATCH/DELETE reais com versão e intenção explícitas',
    httpCalls.slice(0, 3).map(c => c.method).join(',') === 'POST,PATCH,DELETE' && httpCalls[0].path === '/api/scenes/cena-fixture/spatial/obstacles' &&
    httpCalls[2].path.endsWith('/parede-fixture') && httpCalls[1].body.expectedVersion === 8 && httpCalls[2].body.operationId === 'operacao-apagar' &&
    Object.keys(httpCalls[1].body).sort().join(',') === 'blocksMovement,blocksSight,end,expectedVersion,operationId,start');
  check('Traçado usa endpoint de lote com uma versão e uma chave para todos os segmentos',
    httpCalls[3].path.endsWith('/obstacles/batch') && httpCalls[3].body.expectedVersion === 10 &&
    Array.isArray(httpCalls[3].body.walls) && httpCalls[3].body.walls.length === 2);
} finally { await act(async () => root.unmount()); dom.window.close(); }
console.log(`\n${checks} verificações comportamentais aprovadas.`);
