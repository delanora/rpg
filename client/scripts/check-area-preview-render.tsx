/** Interação real em jsdom; rede e acesso à mesa são proibidos. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent'])
  globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name];
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => { throw Error('Rede real proibida'); };
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { GridAreaPreview } = await import('../src/combat/grid/GridAreaPreview');
const { screenToFeet } = await import('../src/combat/grid/gridCamera');
const host = document.getElementById('root')!, root = createRoot(host);
const geometry = { cellSizeFeet: 5, pixelsPerCell: 50 };
let camera = { panX: 0, panY: 0, zoom: 1 };
let checks = 0, propagated = 0;
const check = (label: string, ok: unknown) => { assert.ok(ok, label); checks++; };
let props = { disabled: false, panning: false, pinging: false };
const render = () => act(async () => root.render(h('div', { onClick: () => propagated++ }, h(GridAreaPreview, {
  ...props, camera, geometry, widthFeet: 100, heightFeet: 100,
  positionAt: (x: number, y: number) => screenToFeet(camera, {x,y}, geometry),
}))));
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
const click = (text: string) => act(async () => button(text).click());
const point = async (x: number, y: number, kind = 'click', extra = {}) => act(async () => {
  const target = host.querySelector('.grid-area-capture')!;
  target.dispatchEvent(new dom.window.MouseEvent(kind, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }));
});
const circle = () => host.querySelector('circle')!;
try {
  await render();
  check('Sem ferramenta ativa não captura o grid', !host.querySelector('.grid-area-capture'));
  await click('Área circular');
  check('Confirmar depende de clique no mapa', button('Confirmar').disabled);
  await point(200,150,'pointermove');
  check('Prévia segue o ponteiro em coordenadas da cena', circle().getAttribute('cx') === '200' && circle().getAttribute('cy') === '150');
  check('Hover sozinho não confirma uma área', button('Confirmar').disabled);
  await point(-1,150);
  check('Ponto fora da cena não é aceito', button('Confirmar').disabled);
  await point(200,150);
  check('Clicar habilita confirmação e não propaga ação do mapa', !button('Confirmar').disabled && propagated === 0);
  await point(300,200,'pointermove');
  check('Escolha não segue o mouse depois do clique', circle().getAttribute('cx') === '200');
  const select = host.querySelector('select')!;
  await act(async () => { select.value = '20'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  check('Raio de 6 metros equivale a 20 pés', circle().getAttribute('r') === '200' && select.selectedOptions[0].textContent === '6 m');
  await click('Confirmar');
  check('Confirmar fixa o modelo e libera os gestos do mapa', !host.querySelector('.grid-area-capture') && !!circle());
  camera = { panX: 30, panY: -10, zoom: 2 }; await render();
  check('Pan e zoom reprojetam o mesmo ponto e raio', circle().getAttribute('cx') === '430' && circle().getAttribute('cy') === '290' && circle().getAttribute('r') === '400');
  await click('Área ·');
  await point(630,390);
  check('Novo clique ajusta a posição com a câmera atual', circle().getAttribute('cx') === '630');
  await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  check('Esc cancela edição e restaura o modelo anterior', !host.querySelector('.grid-area-capture') && circle().getAttribute('cx') === '430');
  await click('Área ·');
  props = { ...props, pinging: true }; await render();
  check('Alt libera a camada de captura para o ping', !host.querySelector('.grid-area-capture'));
  props = { ...props, pinging: false, panning: true }; await render();
  await point(800,500,'pointerdown'); await point(800,500);
  check('Space e pan não mudam o centro escolhido', circle().getAttribute('cx') === '430');
  props = { ...props, panning: false, disabled: true }; await render();
  check('Movimento, ataque ou régua suspendem edição sem apagar modelo confirmado', !host.querySelector('.grid-area-capture') && !!circle() && button('Área ·').disabled);
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remover prévia de área"]')!;
  await act(async () => remove.click());
  check('Remover funciona durante outra ferramenta sem executar ações', !host.querySelector('circle') && propagated === 0);
  props = { ...props, disabled: false }; await render(); await click('Área circular');
  await point(200,200);
  await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })));
  check('Esc no primeiro rascunho remove a prévia', !host.querySelector('circle') && !host.querySelector('.grid-area-capture'));
  await click('Área circular'); await point(200,200); await point(200,200,'contextmenu');
  check('Botão direito cancela sem abrir menu do grid', !host.querySelector('circle') && propagated === 0);
  await act(async () => root.unmount());
  check('Desmontagem remove ouvintes e estado local', !host.firstChild);
  console.log(`✔ ${checks} verificações da prévia circular aprovadas`);
} finally { dom.window.close(); }
