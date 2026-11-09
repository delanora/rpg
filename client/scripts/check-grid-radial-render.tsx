/** Menu local em React/jsdom; nenhuma requisição ou entidade da mesa. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost',pretendToBeVisual:true});
const globals = globalThis as unknown as Record<string,unknown>;
for (const name of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent']) globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : (dom.window as unknown as Record<string,unknown>)[name];
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => { throw Error('Rede proibida'); };
const { createElement:h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { GridRadialMenu } = await import('../src/combat/grid/GridRadialMenu');
const root = createRoot(document.getElementById('root')!);
let closed=0,added=0,parentClicks=0,shape='',key=0,checks=0;
const check=(label:string,ok:unknown)=>{assert.ok(ok,label);checks++;};
const render=async(canAdd=true,areaDisabled=false,point={x:500,y:400})=>act(async()=>root.render(h('div',{onClick:()=>parentClicks++},h(GridRadialMenu,{
 key:++key,point,canAdd,areaDisabled,onClose:()=>closed++,onAdd:()=>added++,onArea:value=>{shape=value;},
}))));
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('.grid-radial-menu button')].find(b=>b.textContent?.includes(label)||b.getAttribute('aria-label')?.includes(label))!;
const click=async(label:string)=>act(async()=>button(label).click());
try {
 await render();
 check('Mestre tem Encontro e Áreas no menu radial',!!button('Encontro')&&!!button('Áreas'));
 check('Radial reduzido a 200px com fatias clicáveis', document.querySelector<HTMLElement>('.grid-radial-menu')?.style.width==='200px' && [...document.querySelectorAll<HTMLElement>('.grid-radial-item')].every(item=>item.style.clipPath.startsWith('polygon(')));
 check('Divisórias acompanham as duas opções',document.querySelectorAll('.grid-radial-dividers line').length===2);
 check('Não há opções futuras de objetos ou itens',!document.body.textContent?.includes('Objetos')&&!document.body.textContent?.includes('Itens'));
 await click('Encontro');check('Encontro encaminha ao fluxo existente sem propagar clique no mapa',added===1&&parentClicks===0);
 await click('Áreas');
 check('Submenu oferece as cinco formas de 2014',document.querySelectorAll('[role="menuitem"]').length===6);
 check('Submenu tem cinco fatias delimitadas',document.querySelectorAll('.grid-radial-dividers line').length===5);
 for(const [label,kind] of [['Esfera','sphere'],['Cone','cone'],['Linha','line'],['Cubo','cube'],['Cilindro','cylinder']]) {
  await click(label);check(`${label} encaminha a forma correta`,shape===kind);
 }
 await click('Voltar');check('Voltar retorna às categorias',!!button('Encontro'));
 await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 check('Esc fecha o menu',closed===1);
 await render(false);check('Jogador não recebe ação administrativa Encontro',!button('Encontro')&&!!button('Áreas'));
 await act(async()=>document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true})));
 check('Clique fora fecha o menu',closed===2);
 await render(true,true);check('Outra ferramenta bloqueia área sem bloquear Encontro',button('Áreas').disabled&&!button('Encontro').disabled);
 Object.defineProperty(window,'innerWidth',{value:320,configurable:true});Object.defineProperty(window,'innerHeight',{value:480,configurable:true});
 await render(true,false,{x:319,y:479});
 const menu=document.querySelector<HTMLElement>('.grid-radial-menu')!;
 check('Menu cabe na borda inferior e direita da tela',parseFloat(menu.style.left)+parseFloat(menu.style.width)<=312&&parseFloat(menu.style.top)+parseFloat(menu.style.height)<=472);
 await click('Áreas');
 const first=document.activeElement;
 await act(async()=>document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
 check('Setas navegam entre as opções',document.activeElement!==first);
 await act(async()=>document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true})));
 check('End chega ao botão de voltar',document.activeElement===button('Voltar'));
 // Integração com o grid real: o callback administrativo só roda após escolha.
 const {CombatGrid}=await import('../src/combat/grid/CombatGrid');
 globals.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
 globals.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
 Object.defineProperty(window,'innerWidth',{value:1024,configurable:true});
 Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{get(){return this.classList.contains('grid-viewport')?900:0}});
 Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return this.classList.contains('grid-viewport')?700:0}});
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return{x:0,y:0,left:0,top:0,right:900,bottom:700,width:900,height:700,toJSON(){}}};
 const combat={id:'radial-fixture',version:1,status:'ACTIVE',currentCombatantId:'unit',sceneBackgroundImageUrl:null,
  spatial:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5,walls:[]},combatants:[{id:'unit',name:'Fixture',kind:'CREATURE',spatialVisibility:'public',spatial:{baseSize:'medium',effectiveSize:'medium',position:{xFeet:10,yFeet:10},occupiedSpace:{minXFeet:10,minYFeet:10,maxXFeet:15,maxYFeet:15,widthFeet:5,heightFeet:5}}}]} as never;
 let addPosition:unknown=null,inspections=0;
 const gridRender=async(isMaster=true)=>act(async()=>root.render(h(CombatGrid,{combat,isMaster,onCombatChange:()=>{throw Error('Escrita indevida')},onError:message=>{throw Error(message)},onInspectToken:()=>inspections++,onEmptyContext:position=>{addPosition=position}})));
 await gridRender();
 const open=async()=>act(async()=>document.querySelector('.grid-plane')!.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,clientX:450,clientY:350})));
 await open();
 check('Sem botão Áreas permanente no grid',!document.querySelector('.grid-area-controls'));
 check('Grid vazio abre radial sem adicionar imediatamente',!!document.querySelector('.grid-radial-menu')&&addPosition===null);
 await click('Encontro');check('Encontro usa o callback com posição do grid',addPosition!==null&&!document.querySelector('.grid-radial-menu'));
 await open();await click('Áreas');await click('Cone');
 check('Escolha radial inicia o cone na origem clicada no grid real',!!document.querySelector('.grid-area-capture')&&!!document.querySelector('.grid-area-shape polygon'));
 const before=document.querySelector('.grid-area-shape g')?.getAttribute('transform');
 await act(async()=>document.querySelector('.grid-area-capture')!.dispatchEvent(new dom.window.MouseEvent('pointermove',{bubbles:true,clientX:450,clientY:500})));
 check('Direção do cone muda mantendo a origem',before!==document.querySelector('.grid-area-shape g')?.getAttribute('transform'));
 await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await act(async()=>document.querySelector('.grid-token')!.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:180})));
 check('Botão direito no token mantém inspeção e não abre radial',inspections===1&&!document.querySelector('.grid-radial-menu'));
 await gridRender(false);await open();
 check('Grid do jogador abre somente áreas, sem ação de encontro',!!button('Áreas')&&!button('Encontro'));
 await act(async()=>root.unmount());
 check('Desmontagem remove o portal',!document.querySelector('.grid-radial-menu'));
 console.log(`✔ ${checks} verificações do menu radial aprovadas`);
} finally {dom.window.close();}
