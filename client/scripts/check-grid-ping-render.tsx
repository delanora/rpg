/** Interação real em jsdom; não acessa a campanha. */
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'localStorage', 'MutationObserver']) {
  globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document :
    (dom.window as unknown as Record<string, unknown>)[name];
}
globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useGridPing, publishGridPing } = await import('../src/combat/grid/gridPing');
const { GridPings } = await import('../src/combat/grid/GridPings');
const { screenToFeet } = await import('../src/combat/grid/gridCamera');
const calls: { url: string; body: any }[] = [];
globals.fetch = async (url: string, options: { body: string }) => {
  calls.push({ url, body: JSON.parse(options.body) });
  return { ok: true, text: async () => '{}' };
};
let checks = 0, normal = 0, starts = 0;
function check(label: string, ok: unknown) { assert.ok(ok, label); checks++; console.log(`✔ ${label}`); }
const geometry = { cellSizeFeet: 5, pixelsPerCell: 50 };
const camera = { panX: 100, panY: 50, zoom: 2 };
function Harness({ combatId = 'combate', enabled = true }) {
  const ping = useGridPing({ combatId, enabled, widthFeet: 40, heightFeet: 40,
    positionAt: (x, y) => screenToFeet(camera, { x, y }, geometry),
    onStart: () => { starts++; }, onError: message => { throw Error(message); } });
  return h('div', { className: ping.holdingAlt ? 'is-pinging' : '', ...ping.capture,
    onPointerDown: () => { normal++; }, onPointerUp: () => { normal++; },
    onClick: () => { normal++; }, onDoubleClick: () => { normal++; } },
    h('div', { className: 'grid-plane' }, h('button', { id: 'token' }, 'Token')),
    h('button', { id: 'hud' }, 'Controle'), h('input', { id: 'entrada' }),
    h(GridPings, { pings: ping.pings, camera, geometry }));
}
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
await act(async () => root.render(h(Harness, {})));
const token = () => host.querySelector('#token')!;
async function key(type: string, target: EventTarget = window) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent(type, { key: 'Alt', altKey: type === 'keydown', bubbles: true, cancelable: true })); });
}
async function pointer(type: string, target: EventTarget, altKey = false, x = 300, y = 250) {
  await act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true,
    button: 0, altKey, clientX: x, clientY: y })); });
}
await key('keydown'); check('Alt ativa a bandeirinha', host.firstElementChild!.classList.contains('is-pinging'));
await pointer('pointerdown', token(), true);
check('Alt sobre token envia um POST e não inicia arraste', calls.length === 1 && normal === 0 && starts > 0);
check('cliente chama a rota HTTP sob /api', calls[0].url === '/api/combat/combate/spatial/ping');
check('posição desfaz pan e zoom, sem encaixe na célula', calls[0].body.position.xFeet === 10 && calls[0].body.position.yFeet === 10);
await key('keyup');
await pointer('pointerup', token()); await pointer('click', token()); await pointer('dblclick', token());
check('soltar Alt antes do clique não deixa escapar seleção ou ataque', normal === 0 && calls.length === 1);
await pointer('pointerdown', token()); await pointer('click', token());
check('próximo clique normal volta a funcionar', normal === 2);
await key('keydown'); await act(async () => window.dispatchEvent(new Event('blur')));
check('perda de foco libera o cursor', !host.firstElementChild!.classList.contains('is-pinging'));
await key('keydown', host.querySelector('#entrada')!);
check('Alt em campo de texto é ignorado', !host.firstElementChild!.classList.contains('is-pinging'));
await pointer('pointerdown', host.querySelector('#hud')!, true);
check('controles fora do mapa não enviam ping', calls.length === 1);
await new Promise(resolve => setTimeout(resolve, 310));
await pointer('pointerdown', token(), true, 50, 30);
check('ponto fora do mapa não é enviado', calls.length === 1);
const ping = { id: 'ping-1', combatId: 'combate', position: { xFeet: 10, yFeet: 10 },
  authorId: 'pessoa', authorName: 'Jogadora Teste', color: '#22d3ee', durationMs: 3000 as const };
await act(async () => { publishGridPing({ ...ping, combatId: 'outro' }); });
check('ignora outro combate', !host.querySelector('.grid-ping'));
await act(async () => { publishGridPing(ping); publishGridPing(ping); });
check('evento único mostra nome e cor do autor', host.querySelectorAll('.grid-ping').length === 1 && host.textContent!.includes('Jogadora Teste') && host.querySelector<HTMLElement>('.grid-ping')!.style.getPropertyValue('--ping-color') === '#22d3ee');
check('posição renderizada acompanha a câmera', host.querySelector<HTMLElement>('.grid-ping')!.style.left === '300px' && host.querySelector<HTMLElement>('.grid-ping')!.style.top === '250px');
await act(async () => { await new Promise(resolve => setTimeout(resolve, 3050)); });
check('ping expira após três segundos', !host.querySelector('.grid-ping'));
await act(async () => publishGridPing({ ...ping, id: 'ping-2' }));
await act(async () => root.render(h(Harness, { combatId: 'novo' })));
check('troca de combate limpa os pings', !host.querySelector('.grid-ping'));
await act(async () => root.render(h(Harness, { enabled: false })));
await key('keydown'); await pointer('pointerdown', token(), true);
check('modo desabilitado não envia nem prende Alt', calls.length === 1 && !host.firstElementChild!.classList.contains('is-pinging'));
await act(async () => root.unmount());
publishGridPing(ping); dom.window.close();
console.log(`${checks} verificações de ping aprovadas.`);
