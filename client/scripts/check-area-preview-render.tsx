/** Interação real em jsdom; rede e acesso à mesa são proibidos. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { AreaPreviewRequest, PreviewShape } from '../src/combat/grid/areaPreviewGeometry';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost',pretendToBeVisual:true});
const globals = globalThis as unknown as Record<string,unknown>;
for(const name of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent']) globals[name]=name==='window'?dom.window:name==='document'?dom.window.document:(dom.window as unknown as Record<string,unknown>)[name];
globals.IS_REACT_ACT_ENVIRONMENT=true;
globals.fetch=()=>{throw Error('Rede real proibida')};
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {GridAreaPreview}=await import('../src/combat/grid/GridAreaPreview');
const {screenToFeet}=await import('../src/combat/grid/gridCamera');
const host=document.getElementById('root')!,root=createRoot(host);
const geometry={cellSizeFeet:5,pixelsPerCell:50};
let camera={panX:0,panY:0,zoom:1},request:AreaPreviewRequest|null=null;
let checks=0,propagated=0,id=0;
let props={disabled:false,panning:false,pinging:false};
const check=(label:string,ok:unknown)=>{assert.ok(ok,label);checks++};
const render=()=>act(async()=>root.render(h('div',{onClick:()=>propagated++},h(GridAreaPreview,{
 ...props,request,camera,geometry,widthFeet:100,heightFeet:100,positionAt:(x:number,y:number)=>screenToFeet(camera,{x,y},geometry),
}))));
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!;
const click=(text:string)=>act(async()=>button(text).click());
const begin=async(shape:PreviewShape='sphere')=>{request={id:++id,shape,origin:{xFeet:20,yFeet:15}};await render()};
const point=async(x:number,y:number,kind='click')=>act(async()=>{
 const target=host.querySelector('.grid-area-capture')!;
 for(const type of kind==='click'?['pointerdown','pointerup','click']:[kind]) target.dispatchEvent(new dom.window.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0}));
});
const choose=async(label:string,value:string)=>act(async()=>{
 const select=host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
});
const transform=()=>host.querySelector('svg g')!.getAttribute('transform')!;
const remove=()=>act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Remover prévia de área"]')!.click());
try{
 await render();check('Grid livre não mostra botão Áreas nem captura gestos',!host.querySelector('.grid-area-controls')&&!host.querySelector('.grid-area-capture'));
 await begin();check('Escolha radial inicia esfera na origem clicada',transform().startsWith('translate(200 150)')&&!button('Confirmar').disabled);
 await point(300,200);check('Clique ajusta centro sem propagar ação do mapa',transform().startsWith('translate(300 200)')&&propagated===0);
 await choose('Dimensão da área','20');check('Raio de 6m continua em 20 pés',host.querySelector('circle')?.getAttribute('r')==='20');
 await click('Confirmar');check('Confirmar libera o mapa e mostra apenas controles da prévia ativa',!host.querySelector('.grid-area-capture')&&!!button('Área ·'));
 camera={panX:30,panY:-10,zoom:2};await render();check('Pan e zoom preservam ponto e escala',transform().startsWith('translate(630 390)')&&transform().includes('scale(20)'));
 await click('Área ·');await point(830,490);await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'})));
 check('Esc restaura modelo confirmado',transform().startsWith('translate(630 390)')&&!host.querySelector('.grid-area-capture'));
 await click('Área ·');props={...props,pinging:true};await render();check('Alt libera captura para o ping',!host.querySelector('.grid-area-capture'));
 props={...props,pinging:false,panning:true};await render();await point(800,500);check('Pan não ajusta centro do modelo',transform().startsWith('translate(630 390)'));
 props={...props,panning:false,disabled:true};await render();check('Outra ferramenta encerra edição sem apagar modelo confirmado',!host.querySelector('.grid-area-capture')&&!!host.querySelector('circle'));
 await remove();check('Remover a prévia limpa todos os controles',!host.querySelector('.grid-area-controls')&&propagated===0);
 props={...props,disabled:false};await render();await begin();await click('Cancelar');check('Cancelar primeira prévia retorna ao mapa limpo',!host.querySelector('.grid-area-controls')&&!host.querySelector('svg'));
 for(const shape of ['cone','line','cube','cylinder'] as PreviewShape[]){
  await begin(shape);await choose('Dimensão da área','20');
  if(shape!=='cylinder'){
   check(`${shape}: origem ainda exige direção`,button('Confirmar').disabled);
   await point(430,490,'pointermove');check(`${shape}: direção acompanha ponteiro`,transform().includes('rotate(90)'));
   await point(430,490);
  }
  check(`${shape}: direção pronta permite confirmação`,!button('Confirmar').disabled);
  if(shape==='cone')check('Cone preserva comprimento e largura da base iguais',host.querySelector('polygon')?.getAttribute('points')==='0,0 20,-10 20,10');
  if(shape==='cube')check('Cubo preserva aresta e origem na face',host.querySelector('polygon')?.getAttribute('points')==='0,-10 20,-10 20,10 0,10');
  if(shape==='line'){await choose('Largura da linha','10');check('Linha mantém largura separada do comprimento',host.querySelector('polygon')?.getAttribute('points')==='0,-5 20,-5 20,5 0,5')}
  if(shape==='cylinder')check('Cilindro preserva raio e usa elevação do grid, sem campo manual de altura',host.querySelector('circle')?.getAttribute('r')==='20'&&!host.querySelector('[aria-label="Altura do cilindro"]'));
  await click('Confirmar');await render();check(`${shape}: pedido original não reabre edição`,!host.querySelector('.grid-area-capture'));
  await click('Área ·');await click('Cancelar');check(`${shape}: cancelar reedição conserva prévia`,!!host.querySelector('circle,polygon'));
  await remove();
 }
 await begin();await point(300,300,'contextmenu');check('Botão direito cancela edição sem propagar menu do grid',!host.querySelector('.grid-area-controls')&&propagated===0);
 await act(async()=>root.unmount());check('Desmontagem remove estado e ouvintes',!host.firstChild);
 console.log(`✔ ${checks} verificações das prévias de áreas aprovadas`);
}finally{dom.window.close()}
