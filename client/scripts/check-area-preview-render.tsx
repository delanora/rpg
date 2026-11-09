/** Interação real em jsdom; rede e acesso à mesa são proibidos. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { AreaPreviewRequest } from '../src/combat/grid/areaPreviewGeometry';
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
let request: AreaPreviewRequest | null = null;
let props = { disabled: false, panning: false, pinging: false };
const render = () => act(async () => root.render(h('div', { onClick: () => propagated++ }, h(GridAreaPreview, {
  ...props, request, camera, geometry, widthFeet: 100, heightFeet: 100,
  positionAt: (x: number, y: number) => screenToFeet(camera, {x,y}, geometry),
}))));
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
const click = (text: string) => act(async () => button(text).click());
const point = async (x: number, y: number, kind = 'click', extra = {}) => act(async () => {
  const target = host.querySelector('.grid-area-capture')!;
  for (const type of kind === 'click' ? ['pointerdown', 'pointerup', 'click'] : [kind]) {
    target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }));
  }
});
const circle = () => host.querySelector('circle')!;
const transform = () => host.querySelector('svg g')!.getAttribute('transform')!;
try {
  await render();
  check('Sem ferramenta ativa não captura o grid', !host.querySelector('.grid-area-capture'));
  await click('Áreas');
  check('Confirmar depende de clique no mapa', button('Confirmar').disabled);
  await point(200,150,'pointermove');
  check('Prévia segue o ponteiro em coordenadas da cena', transform().startsWith('translate(200 150)'));
  check('Hover sozinho não confirma uma área', button('Confirmar').disabled);
  await point(-1,150);
  check('Ponto fora da cena não é aceito', button('Confirmar').disabled);
  await point(200,150);
  check('Clicar habilita confirmação e não propaga ação do mapa', !button('Confirmar').disabled && propagated === 0);
  await point(300,200,'pointermove');
  check('Escolha não segue o mouse depois do clique', transform().startsWith('translate(200 150)'));
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Dimensão da área"]')!;
  await act(async () => { select.value = '20'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  check('Raio de 6 metros equivale a 20 pés', circle().getAttribute('r') === '20' && transform().includes('scale(10)') && select.selectedOptions[0].textContent === '6 m');
  await click('Confirmar');
  check('Confirmar fixa o modelo e libera os gestos do mapa', !host.querySelector('.grid-area-capture') && !!circle());
  camera = { panX: 30, panY: -10, zoom: 2 }; await render();
  check('Pan e zoom reprojetam o mesmo ponto e raio', transform().startsWith('translate(430 290)') && circle().getAttribute('r') === '20' && transform().includes('scale(20)'));
  await click('Área ·');
  await point(630,390);
  check('Novo clique ajusta a posição com a câmera atual', transform().startsWith('translate(630 390)'));
  await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  check('Esc cancela edição e restaura o modelo anterior', !host.querySelector('.grid-area-capture') && transform().startsWith('translate(430 290)'));
  await click('Área ·');
  props = { ...props, pinging: true }; await render();
  check('Alt libera a camada de captura para o ping', !host.querySelector('.grid-area-capture'));
  props = { ...props, pinging: false, panning: true }; await render();
  await point(800,500,'pointerdown'); await point(800,500);
  check('Space e pan não mudam o centro escolhido', transform().startsWith('translate(430 290)'));
  props = { ...props, panning: false, disabled: true }; await render();
  check('Movimento, ataque ou régua suspendem edição sem apagar modelo confirmado', !host.querySelector('.grid-area-capture') && !!circle() && button('Área ·').disabled);
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remover prévia de área"]')!;
  await act(async () => remove.click());
  check('Remover funciona durante outra ferramenta sem executar ações', !host.querySelector('circle') && propagated === 0);
  props = { ...props, disabled: false }; await render(); await click('Áreas');
  await point(200,200);
  await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })));
  check('Esc no primeiro rascunho remove a prévia', !host.querySelector('circle') && !host.querySelector('.grid-area-capture'));
  await click('Áreas'); await point(200,200); await point(200,200,'contextmenu');
  check('Botão direito cancela sem abrir menu do grid', !host.querySelector('circle') && propagated === 0);
  // Novas formas compartilham origem/câmera, mas preservam suas dimensões.
  const choose = async (label: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  for (const shape of ['cone', 'line', 'cube', 'cylinder']) {
    await click('Áreas'); await choose('Forma da área',shape); await choose('Dimensão da área','20');
    await point(230,190);
    if (shape !== 'cylinder') {
      check(`${shape}: origem sozinha não fixa direção`,button('Confirmar').disabled);
      await point(230,390,'pointermove');
      check(`${shape}: direção acompanha o ponteiro`,transform().includes('rotate(90)'));
      await point(230,390);
    }
    check(`${shape}: posição/direção prontas permitem confirmar`,!button('Confirmar').disabled);
    if (shape === 'cone') check('Cone tem comprimento 20 e base 20, sem ângulo de 90 graus',host.querySelector('polygon')?.getAttribute('points') === '0,0 20,-10 20,10');
    if (shape === 'cube') check('Cubo usa aresta 20 e origem no meio da face',host.querySelector('polygon')?.getAttribute('points') === '0,-10 20,-10 20,10 0,10');
    if (shape === 'line') {
      await choose('Largura da linha','10');
      check('Linha tem comprimento e largura separados',host.querySelector('polygon')?.getAttribute('points') === '0,-5 20,-5 20,5 0,5');
    }
    if (shape === 'cylinder') {
      await choose('Altura do cilindro','40');
      check('Cilindro mantém raio e informa altura separada',circle().getAttribute('r') === '20' && host.textContent?.includes('Altura 12 m'));
    }
    await click('Confirmar');
    check(`${shape}: confirmar libera o mapa`,!host.querySelector('.grid-area-capture'));
    await click('Área ·'); await click('Cancelar');
    check(`${shape}: cancelar reedição preserva forma confirmada`,Boolean(host.querySelector('circle,polygon')));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remover prévia de área"]')!.click());
  }
  request={id:1,shape:'cone',origin:{xFeet:10,yFeet:10}};
  await render();
  check('Menu radial inicia área exatamente na origem escolhida', transform().startsWith('translate(230 190)') && button('Confirmar').disabled);
  await point(430,190,'pointermove'); await point(430,190); await click('Confirmar');
  check('Origem do menu permite apontar e fixar cone',!!host.querySelector('polygon')&&!host.querySelector('.grid-area-capture'));
  await render();
  check('Mesmo pedido não reabre a edição',!host.querySelector('.grid-area-capture'));
  await act(async () => root.unmount());
  check('Desmontagem remove ouvintes e estado local', !host.firstChild);
  console.log(`✔ ${checks} verificações das prévias de áreas aprovadas`);
} finally { dom.window.close(); }
