/** Regressão do arraste: pega, tamanhos e câmera; toda chamada HTTP é interceptada.
 * npx tsx --tsconfig client/tsconfig.json client/scripts/check-grid-drag-render.tsx
 */
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'localStorage', 'MutationObserver']) {
  globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document :
    (dom.window as unknown as Record<string, unknown>)[name];
}
globals.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globals.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => { throw Error('Rede real proibida neste teste.'); };
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');

const { CombatGrid } = await import('../src/combat/grid/CombatGrid');
const { DEFAULT_PIXELS_PER_CELL, dragFootprintAt } = await import('../src/combat/grid/gridMath');
Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{get(){return this.classList.contains('grid-viewport')?900:0}});
Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return this.classList.contains('grid-viewport')?700:0}});
dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,right:900,bottom:700,width:900,height:700,toJSON(){}}};
let sent: {url:string; body:any}[]=[];
globals.fetch=async(url:string,options:any)=>{sent.push({url,body:JSON.parse(options.body)});return url.endsWith('/movement-preview')?{ok:true,status:200,text:async()=>JSON.stringify({movement:{legal:true,affordable:true,steps:[],totalCostFeet:JSON.parse(options.body).path.length*5},reaction:{boundaries:[],risk:'none'}})}:{ok:false,status:409,text:async()=>JSON.stringify({message:'Fixture: nenhuma escrita real.'})}};
let checks = 0;
for(const [size,width] of [['tiny',2.5],['small',5],['medium',5],['large',10],['huge',15],['gargantuan',20]] as const){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const combat={id:'arraste-fixture',version:1,status:'ACTIVE',currentCombatantId:'unit',sceneBackgroundImageUrl:null,spatial:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5,walls:[]},combatants:[{id:'unit',name:size,kind:'CREATURE',spatialVisibility:'public',spatial:{baseSize:size,effectiveSize:size,position:{xFeet:10,yFeet:10},occupiedSpace:{minXFeet:10,minYFeet:10,maxXFeet:10+width,maxYFeet:10+width,widthFeet:width,heightFeet:width}}}]} as never;
 await act(async()=>root.render(h(CombatGrid,{combat,isMaster:true,movement:{combatantId:'unit',reason:null},onCombatChange:()=>{},onError:()=>{}})));
 for (const zoomed of [false,true]) {
  if (zoomed) await act(async()=>host.querySelector('[aria-label="Aumentar zoom"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  const transform=(host.querySelector('.grid-camera') as HTMLElement).style.transform;
  const match=transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)!;assert.ok(match,transform);
  const panX=Number(match[1]),panY=Number(match[2]),zoom=Number(match[3]);
  for(const fraction of [.1,.5,.9]) for(const [dx,dy] of [[5,0],[0,5],[5,5],[-5,0]]) {
   const x=panX+(10+width*fraction)*DEFAULT_PIXELS_PER_CELL/5*zoom,y=panY+(10+width*fraction)*DEFAULT_PIXELS_PER_CELL/5*zoom;
   function event(type:string,clientX:number,clientY:number){const e=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,clientX,clientY});Object.defineProperty(e,'pointerId',{value:1});return e;}
   sent=[];
   await act(async()=>{host.querySelector('.grid-token')!.dispatchEvent(event('pointerdown',x,y));});
   await act(async()=>{window.dispatchEvent(event('pointermove',x+dx*DEFAULT_PIXELS_PER_CELL/5*zoom,y+dy*DEFAULT_PIXELS_PER_CELL/5*zoom));});
   await act(async()=>{window.dispatchEvent(event('pointerup',x+dx*DEFAULT_PIXELS_PER_CELL/5*zoom,y+dy*DEFAULT_PIXELS_PER_CELL/5*zoom));});
   const commits=sent.filter(call=>call.url.endsWith('/spatial/movement'));assert.equal(commits.length,1);
   assert.deepEqual(commits[0].body.path.at(-1),{xFeet:10+dx,yFeet:10+dy},JSON.stringify({size,fraction,zoomed,dx,dy}));
   assert.equal(commits[0].body.path.length,size==='tiny'?2:1);
   assert.ok(commits[0].body.operationId);checks++;
  }
 }
 // Voltar à origem e oscilar abaixo de meia casa não deve gerar um passo extra.
 const grab={xFeet:width*.9,yFeet:width*.9};
 assert.deepEqual(dragFootprintAt({xFeet:10+grab.xFeet-.01,yFeet:10+grab.yFeet},grab,size,{widthFeet:100,heightFeet:100}).destination,{xFeet:10,yFeet:10});checks++;
 assert.equal(dragFootprintAt({xFeet:101+grab.xFeet,yFeet:10+grab.yFeet},grab,size,{widthFeet:100,heightFeet:100}).destination,null);checks++;
 await act(async()=>root.unmount());host.remove();
 console.log('✔ '+size+': pega, horizontal/vertical/diagonal, retorno, zoom, bordas e ausência de salto');
}
dom.window.close();console.log(checks+' verificações de arraste aprovadas.');
