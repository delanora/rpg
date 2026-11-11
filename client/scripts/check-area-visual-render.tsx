/** Forma compartilhada, cor e câmera com os componentes reais; sem servidor da mesa. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost'});
const globals=globalThis as unknown as Record<string,unknown>;
globals.localStorage=dom.window.localStorage;
globals.window=dom.window;globals.document=dom.window.document;globals.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {renderToStaticMarkup}=await import('react-dom/server');
const {GridAreaShape}=await import('../src/combat/grid/GridAreaShape');
const {GridSharedAreas}=await import('../src/combat/grid/GridSharedAreas');
const {publishAreaVisual,useShareAreaVisual}=await import('../src/combat/grid/areaVisual');
const geometry={cellSizeFeet:5,pixelsPerCell:50};
const marker={center:{xFeet:5,yFeet:10},radiusFeet:30,widthFeet:5,shape:'line' as const,angle:0};
for(const [damageType,family] of [['Elétrico','lightning'],['Veneno','poison'],['Fogo','fire'],['Frio','cold']]) {
 const markup=renderToStaticMarkup(h(GridAreaShape,{marker,geometry,camera:{panX:20,panY:30,zoom:2},damageType}));
 assert.match(markup,new RegExp(`--area-accent:var\\(--damage-${family}\\)`));
 assert.match(markup,/translate\(120 230\).*scale\(20\)/);
 assert.match(markup,/non-scaling-stroke/);
}
const root=createRoot(document.getElementById('root')!);
const combat={id:'combat',status:'ACTIVE' as const,combatants:[{id:'source',spatial:{}}]};
const event={previewId:'preview',sequence:1,combatId:'combat',authorId:'master',expiresAt:Date.now()+6000,area:{combatantId:'source',origin:{xFeet:5,yFeet:10},angle:0,shape:{kind:'line' as const,lengthFeet:30,widthFeet:5},damageType:'Elétrico' as const}};
try {
 await act(async()=>root.render(h(GridSharedAreas,{combat,geometry,camera:{panX:0,panY:0,zoom:1}})));
 await act(async()=>publishAreaVisual(event));assert.equal(document.querySelectorAll('.grid-area-shape').length,1);
 assert.equal(document.querySelector('.grid-area-shape')?.getAttribute('data-damage-family'),'lightning');
 await act(async()=>publishAreaVisual({...event,sequence:2,area:null}));assert.equal(document.querySelectorAll('.grid-area-shape').length,0);
 await act(async()=>publishAreaVisual(event));assert.equal(document.querySelectorAll('.grid-area-shape').length,0,'Evento atrasado não reabre prévia');
 await act(async()=>publishAreaVisual({...event,previewId:'expired',expiresAt:Date.now()-1}));assert.equal(document.querySelectorAll('.grid-area-shape').length,0);
 await act(async()=>publishAreaVisual({...event,previewId:'hidden',area:{...event.area,combatantId:'hidden-source'}}));assert.equal(document.querySelectorAll('.grid-area-shape').length,0,'Fonte ausente do DTO público não desenha');
 await act(async()=>root.render(h(GridSharedAreas,{combat:{...combat,status:'ENDED'},geometry,camera:{panX:0,panY:0,zoom:1}})));
 await act(async()=>publishAreaVisual({...event,previewId:'ended'}));assert.equal(document.querySelectorAll('.grid-area-shape').length,0);
 const requests:{previewId:string;sequence:number;placement:unknown}[]=[];
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));assert.equal(typeof body,'object','HTTP deve receber objeto, sem JSON duplamente codificado');requests.push(body);return new Response('{}',{status:200});};
 function Sender({active}:{active:boolean}) {useShareAreaVisual('combat','turn',active?{combatantId:'source',abilityId:'breath',origin:{xFeet:5,yFeet:10},angle:0}:null);return null;}
 await act(async()=>root.render(h(Sender,{active:true})));
 assert.equal(requests.length,1);assert.ok(requests[0].placement);
 await act(async()=>root.render(h(Sender,{active:false})));
 assert.equal(requests.length,2);assert.equal(requests[1].placement,null);
 assert.equal(requests[1].previewId,requests[0].previewId);assert.ok(requests[1].sequence>requests[0].sequence);
 console.log('✔ Paleta por dano, pan/zoom, prévia pública, cancelamento, ordem, expiração e ocultação.');
} finally {await act(async()=>root.unmount());dom.window.close();}
