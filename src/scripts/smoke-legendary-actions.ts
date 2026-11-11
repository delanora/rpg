/** HTTP autoritativo, somente fixtures próprias em banco/schema descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
async function main() {
 assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema')??'',/^smoke_legendary_/);
 const base=process.env.PLAYABLE_BASE_URL!;assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal(new URL(base).port,'3140');
 assert.equal(await prisma.user.count(),0);assert.equal(await prisma.combat.count(),0);
 const users:string[]=[],characters:string[]=[];let creatureId:string|undefined,combatId:string|undefined;
 try {
  const makeUser=(role:'MASTER'|'PLAYER')=>prisma.user.create({data:{username:'fixture_'+randomUUID(),displayName:'Fixture isolada',passwordHash:'fixture',role}});
  const master=await makeUser('MASTER');users.push(master.id);const player=await makeUser('PLAYER');users.push(player.id);const peer=await makeUser('PLAYER');users.push(peer.id);
  const a=await prisma.character.create({data:{userId:player.id,name:'Alvo A isolado',hpMax:1000,hpCurrent:1000}});characters.push(a.id);
  const b=await prisma.character.create({data:{userId:peer.id,name:'Alvo B isolado',hpMax:1000,hpCurrent:1000}});characters.push(b.id);
  const token=(u:typeof master)=>signToken({sub:u.id,username:u.username,displayName:u.displayName,role:u.role});
  const http=async(path:string,body?:unknown,actor=master)=>{const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json() as any};};
  assert.equal((await http('/characters/me',undefined,player)).data.character.id,a.id,'Sentinela HTTP comprova schema antes das operações');
  const abilities=[{id:'tail',name:'Cauda lendária',description:'Golpe de cauda.',cost:'legendary',execution:'legendary-attack',legendaryCost:1,legendaryAttackId:'tail-hit'}, {id:'heavy',name:'Golpe pesado',cost:'legendary',execution:'legendary-attack',legendaryCost:2,legendaryAttackId:'tail-hit'}, {id:'detect',name:'Detectar',description:'O Mestre resolve a percepção.',cost:'legendary',execution:'assisted',legendaryCost:1}];
  const creature=await prisma.creature.create({data:{name:'Lendária isolada',hpMax:1000,hpCurrent:1000,legendaryActionsMax:3,abilities,attacks:[{id:'tail-hit',name:'Cauda',attackBonus:30,reachFeet:10,damage:{count:1,sides:4,bonus:0,type:'Concussão'}}]}});creatureId=creature.id;
  const combat=await prisma.combat.create({data:{status:'ACTIVE',turnSequence:1,currentIndex:0,spatialConfig:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5}}});combatId=combat.id;
  const heroA=await prisma.combatant.create({data:{combatId,characterId:a.id,ownerUserId:player.id,kind:'CHARACTER',name:a.name,dexterityMod:0,initiative:30,spatialPosition:{xFeet:0,yFeet:0},turnEconomy:onTurnStart(9)}});
  const heroB=await prisma.combatant.create({data:{combatId,characterId:b.id,ownerUserId:peer.id,kind:'CHARACTER',name:b.name,dexterityMod:0,initiative:20,spatialPosition:{xFeet:0,yFeet:5},turnEconomy:onTurnStart(9)}});
  const normal={...onTurnStart(9),actionsUsed:1,reactionAvailable:false};
  const source=await prisma.combatant.create({data:{combatId,creatureId,kind:'CREATURE',name:'Lendária isolada',dexterityMod:0,initiative:10,hpCurrent:1000,hpMax:1000,spatialPosition:{xFeet:5,yFeet:0},turnEconomy:normal}});
  const hidden=await prisma.combatant.create({data:{combatId,creatureId,kind:'CREATURE',name:'Segredo lendário',dexterityMod:0,initiative:5,hpCurrent:1000,hpMax:1000,spatialVisibility:'master-only',spatialPosition:{xFeet:10,yFeet:0},turnEconomy:onTurnStart(9)}});
  let dto=(await http('/combat/active')).data.combat;
  const op=()=>({combatId:combat.id,expectedVersion:dto.version,operationId:randomUUID()});
  const accept=async(path:string,body:unknown,actor=master)=>{const result=await http(path,body,actor);assert.equal(result.status,200,JSON.stringify(result));dto=actor.role==='MASTER'?result.data.combat:(await http('/combat/active')).data.combat;return result;};
  const getUnit=(id:string)=>dto.combatants.find((c:any)=>c.id===id);
  const endInput=op();await accept('/combat/next-turn',endInput,player);
  assert.equal(dto.currentCombatantId,heroA.id);assert.equal((await prisma.combat.findUniqueOrThrow({where:{id:combat.id}})).turnSequence,1);assert.equal(dto.legendaryPause,true);
  const windowId=dto.legendaryWindow.id;assert.deepEqual(new Set(dto.legendaryWindow.candidateIds),new Set([source.id,hidden.id]));
  assert.equal((await http('/combat/next-turn',endInput,player)).data.combat.legendaryPause,true);assert.equal((await prisma.combat.findUniqueOrThrow({where:{id:combat.id}})).turnSequence,1);
  const pub=(await http('/combat/active',undefined,player)).data.combat;
  assert.equal(pub.legendaryPause,true);assert.equal(pub.legendaryWindow,null);assert.equal(pub.combatants.some((c:any)=>c.id===hidden.id),false);assert.equal(pub.combatants.find((c:any)=>c.id===source.id).legendary,null);
  assert.equal((await http('/combat/next-turn',{...op(),skipLegendary:true},player)).status,409);
  const use=(id:string,abilityId:string,extra:Record<string,unknown>={})=>({...op(),windowId:dto.legendaryWindow.id,combatantId:id,abilityId,...extra});
  assert.equal((await http('/combat/legendary/use',use(source.id,'heavy',{targetCombatantId:heroA.id}),player)).status,403);
  assert.equal((await http('/combat/creature-ability',{...op(),combatantId:source.id,abilityId:'heavy'})).status,409);
  await prisma.combatant.update({where:{id:heroB.id},data:{spatialPosition:{xFeet:80,yFeet:80}}});
  assert.equal((await http('/combat/legendary/use',use(source.id,'heavy',{targetCombatantId:heroB.id}))).status,409);
  assert.deepEqual((await prisma.combatant.findUniqueOrThrow({where:{id:source.id}})).legendaryState,{});
  await prisma.combatant.update({where:{id:heroB.id},data:{spatialPosition:{xFeet:0,yFeet:5}}});
  const hitInput=use(source.id,'heavy',{targetCombatantId:heroA.id});const hit=await accept('/combat/legendary/use',hitInput);
  assert.equal(getUnit(source.id).legendary.used,2);assert.deepEqual(getUnit(source.id).turnEconomy,normal);
  const hp=(await prisma.character.findUniqueOrThrow({where:{id:a.id}})).hpCurrent;
  assert.equal((await http('/combat/legendary/use',hitInput)).data.replayed,true);assert.equal((await prisma.character.findUniqueOrThrow({where:{id:a.id}})).hpCurrent,hp);
  assert.equal((await http('/combat/legendary/use',{...hitInput,abilityId:'tail'})).status,409);
  await prisma.creature.update({where:{id:creature.id},data:{abilities:abilities.filter(x=>x.id!=='heavy')}});
  assert.equal((await http('/combat/legendary/use',hitInput)).data.replayed,true,'Retry independe do cadastro atual');
  await prisma.creature.update({where:{id:creature.id},data:{abilities}});
  assert.equal((await http('/combat/legendary/use',use(source.id,'tail',{targetCombatantId:heroA.id}))).status,409,'Só uma opção por criatura nesta janela');
  assert.equal((await http('/combat/legendary/use',use(hidden.id,'detect'))).status,400);
  await accept('/combat/legendary/use',use(hidden.id,'detect',{confirmed:true}));assert.equal(getUnit(hidden.id).legendary.used,1);
  await accept('/combat/next-turn',op());assert.equal(dto.currentCombatantId,heroB.id);assert.equal((await prisma.combat.findUniqueOrThrow({where:{id:combat.id}})).turnSequence,2);assert.equal(dto.legendaryPause,false);
  await accept('/combat/next-turn',op(),peer);
  assert.equal((await http('/combat/legendary/use',use(source.id,'heavy',{targetCombatantId:heroA.id}))).status,409);
  await accept('/combat/legendary/use',use(source.id,'tail',{targetCombatantId:heroA.id}));assert.equal(getUnit(source.id).legendary.used,3);
  await accept('/combat/legendary/pass',{...op(),windowId:dto.legendaryWindow.id,combatantId:hidden.id});
  await accept('/combat/next-turn',op());assert.equal(dto.currentCombatantId,source.id);assert.equal(getUnit(source.id).legendary.used,0);assert.equal(getUnit(source.id).legendary.firstTurnEnded,false);
  await accept('/combat/next-turn',op());assert.equal(dto.legendaryWindow.candidateIds.includes(source.id),false);assert.equal(getUnit(source.id).legendary.firstTurnEnded,true);
  await accept('/combat/next-turn',{...op(),skipLegendary:true});assert.equal(dto.currentCombatantId,hidden.id);assert.equal(getUnit(hidden.id).legendary.used,0);
  // Surpresa bloqueia antes do fim do primeiro turno; condições incapacitantes também.
  const {canUseLegendary}=await import('../modules/combat/legendary.service.js');
  const {loadCombatById}=await import('../modules/combat/combat.service.js');
  const loaded=await loadCombatById(combat.id);const sample=loaded.combatants.find(c=>c.id===source.id)!;
  assert.equal(canUseLegendary({...sample,legendaryState:{surprised:true,firstTurnEnded:false}}),false);
  assert.equal(canUseLegendary({...sample,legendaryState:{surprised:true,firstTurnEnded:true}}),true);
  assert.equal(canUseLegendary({...sample,hpCurrent:0}),false);
  for(const condition of ['stunned','unconscious','incapacitated']){
   const mechanicalState={conditions:[{id:randomUUID(),condition,sourceType:'manual',appliedAt:new Date().toISOString()}]};
   assert.equal(canUseLegendary({...sample,mechanicalState}),false,condition);
  }
  assert.equal(canUseLegendary({...sample,mechanicalState:{conditions:[{id:randomUUID(),condition:'prone',sourceType:'manual',appliedAt:new Date().toISOString()}]}}),true);
  // O índice ainda aponta para quem encerrou, mas não autoriza teste de morte.
  await prisma.combat.update({where:{id:combat.id},data:{currentIndex:0,legendaryWindow:{id:'death-boundary',turnSequence:4,outgoingId:heroA.id,candidateIds:[source.id],decidedIds:[]}}});
  await prisma.character.update({where:{id:a.id},data:{hpCurrent:0}});
  const {resolutionRequestsForCombat}=await import('../modules/combat/resolution-requests.js');
  const requests=await resolutionRequestsForCombat({userId:master.id,username:master.username,role:'MASTER'},combat.id);
  assert.equal(requests.requests.some(r=>r.kind==='death-saving-throw'),false,'Morte só é testada no início do próprio turno');
  console.log('✔ Ações Lendárias: pausa persistida, permissão, privacidade, custos, ataque existente, efeitos assistidos, retry, recarga e elegibilidade.');
 } finally {
  if(combatId)await prisma.combat.deleteMany({where:{id:combatId}});
  if(creatureId)await prisma.creature.deleteMany({where:{id:creatureId}});
  await prisma.character.deleteMany({where:{id:{in:characters}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
