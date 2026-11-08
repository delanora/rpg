/** Menu do token: alvo, condições, PV, teclado e fechamento, sem rede real. */
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


const { CombatTokenMenu } = await import('../src/combat/components/CombatTokenMenu');
const { CombatTokenAdjustments } = await import('../src/combat/components/CombatTokenAdjustments');
const { GridToken } = await import('../src/combat/grid/GridToken');
const { AuthProvider } = await import('../src/auth');
const { mechanicalStateOf, deriveConditionEffects, CONDITION_LABELS } = await import('../../src/modules/shared/conditions');
localStorage.setItem('grimorio.token', 'fixture');
let state = mechanicalStateOf({});
const calls: {url:string; body:any}[] = [];
const dto = () => ({ entity:{kind:'combatant',id:'target'},name:'Alvo fora do turno',version:3,state,
  effects:{...deriveConditionEffects(state),labels:CONDITION_LABELS},effectiveSpeed:9,effectiveMaxHp:30,hpCurrent:30,
  combat:{id:'combat',version:7,status:'ACTIVE'} });
globals.fetch = async (url: string, options: any = {}) => {
  const body=options.body?JSON.parse(options.body):undefined;calls.push({url,body});
  let result: unknown;
  if(url==='/api/auth/me') result={user:{sub:'master',username:'mestre',displayName:'Mestre',role:'MASTER'}};
  else if(url==='/api/mechanical/combatant/target') result={mechanical:dto()};
  else if(url==='/api/effects/combatant/target') result={effects:[]};
  else if(url==='/api/mechanical/mutate') {
    assert.equal(body.entity.id,'target');
    state=mechanicalStateOf({...state,conditions:[{id:'condition-fixture',condition:body.condition,sourceType:'manual',appliedAt:new Date().toISOString()}]});
    result={mechanical:dto()};
  } else if(url==='/api/combat/hp') result={combat};
  else if(url.endsWith('/economy/override')) result={combat};
  else return {ok:false,status:404,text:async()=>JSON.stringify({message:'Leitura auxiliar indisponível na fixture.'})};
  return {ok:true,status:200,text:async()=>JSON.stringify(result)};
};
const target={id:'target',name:'Alvo fora do turno',kind:'CREATURE',hpCurrent:30,hpMax:30,mechanicalVersion:3,
  spatialVisibility:'public',spatial:{baseSize:'large',effectiveSize:'large',position:{xFeet:10,yFeet:10},
    occupiedSpace:{minXFeet:10,minYFeet:10,maxXFeet:20,maxYFeet:20,widthFeet:10,heightFeet:10}}} as never;
const combat={id:'combat',version:7,status:'ACTIVE',currentCombatantId:'other',combatants:[target]} as never;
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
let checks=0,opened=0,normal=0,closed=0;
const check=(label:string,ok:unknown)=>{assert.ok(ok,label);checks++;console.log('✔ '+label)};
const close=()=>{closed++};
const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(node=>node.textContent!.includes(label))!;
const click=async(node:Element)=>{await act(async()=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
await act(async()=>root.render(h(GridToken,{combatant:target,cellSizeFeet:5,pixelsPerCell:44,
  interactive:false,onSelect:()=>{normal++},onInspect:(id,point)=>{assert.equal(id,'target');if(opened===0) assert.equal(point.x,180);opened++}})));
const token=host.querySelector('button')!;
await act(async()=>token.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:150})));
check('botão direito funciona mesmo em token fora do turno e sem seleção normal',opened===1&&normal===0&&!token.disabled);
await act(async()=>token.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true})));
check('Shift+F10 também abre os ajustes',opened===2);
await act(async()=>root.render(h(GridToken,{combatant:target,cellSizeFeet:5,pixelsPerCell:44,interactive:true,onSelect:()=>{normal++}})));
await act(async()=>host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
check('token sem permissão de inspeção não abre o menu',opened===2);
await act(async()=>root.render(h(AuthProvider,null,h(CombatTokenMenu,{name:'Alvo fora do turno',kind:'Criatura',point:{x:99999,y:99999},onClose:close,children:null},
 h(CombatTokenAdjustments,{combat,combatant:target,busy:false,effectsRefresh:0,onRun:action=>{void action()}})))));
check('menu identifica o alvo e recebe foco',!!document.querySelector('[aria-label="Ajustes de Alvo fora do turno"]')&&document.activeElement?.getAttribute('aria-label')==='Fechar ajustes do token');
const menu=document.querySelector<HTMLElement>('.combat-token-menu')!;
check('condições aparecem antes dos controles avançados', document.querySelector('.token-mechanical-body')?.firstElementChild?.classList.contains('master-conditions'));
check('formulários avançados de efeitos começam recolhidos', Array.from(document.querySelectorAll<HTMLDetailsElement>('.token-effect-editor')).every(node => !node.open));
check('menu ajusta a posição aos limites da janela',parseFloat(menu.style.left)<window.innerWidth&&parseFloat(menu.style.top)<window.innerHeight);
await click(button('Adicionar condição'));
await click(Array.from(document.querySelectorAll('.condition-picker button')).find(node=>node.textContent!.includes('Envenenado'))!);
check('condição usa o domínio existente com alvo e versões corretos',calls.some(call=>call.url==='/api/mechanical/mutate'&&call.body.entity.id==='target'&&call.body.expectedVersion===3&&call.body.expectedCombatVersion===7&&call.body.operationId));
await click(button('Vida'));await click(button('Aplicar dano'));
check('dano é enviado apenas para o alvo inspecionado',calls.some(call=>call.url==='/api/combat/hp'&&call.body.combatantId==='target'&&call.body.mode==='damage'&&call.body.amount===5));
await click(button('Curar'));
check('cura mantém o alvo inspecionado',calls.some(call=>call.url==='/api/combat/hp'&&call.body.combatantId==='target'&&call.body.mode==='heal'));
await click(button('Economia'));
check('economia reutiliza o ajuste explícito existente',!!document.querySelector('[aria-label="Motivo do ajuste"]'));
const field=document.querySelector<HTMLTextAreaElement>('[aria-label="Motivo do ajuste"]')!;
check('aplicar ajuste não exige justificativa', !button('Aplicar ajuste').disabled);
await click(button('Aplicar ajuste'));
check('justificativa vazia é omitida do comando', calls.some(call => call.url.endsWith('/economy/override') && !('reason' in call.body)));
await act(async () => {
 Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '  Ajuste combinado  ');
 field.dispatchEvent(new Event('input', { bubbles: true }));
});
await click(button('Aplicar e registrar'));
check('justificativa preenchida é enviada sem espaços extras', calls.some(call => call.url.endsWith('/economy/override') && call.body.reason === 'Ajuste combinado'));
field.focus();await act(async()=>field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
check('Escape fecha o painel',closed===1);
await act(async()=>document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));
check('clique fora fecha o painel',closed===2);
check('nenhum comando assume ou avança turno',!calls.some(call=>/next-turn|attack|initiative/.test(call.url)));
const { CombatGrid } = await import('../src/combat/grid/CombatGrid');
let inspections=0;
for(const master of [true,false]) {
 const gridCombat={...(combat as unknown as Record<string,unknown>),spatial:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5,walls:[]},sceneBackgroundImageUrl:null} as never;
 await act(async()=>root.render(h(CombatGrid,{combat:gridCombat,isMaster:master,
   onInspectToken:()=>{inspections++},onCombatChange:()=>{},onError:()=>{}})));
 await act(async()=>host.querySelector('.grid-token')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:120})));
 check(master?'grid do mestre entrega o token ao menu':'grid do jogador bloqueia a inspeção administrativa',inspections===1);
}
await act(async()=>root.unmount());dom.window.close();console.log(checks+' verificações do menu de token aprovadas.');
