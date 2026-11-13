/** HTTP autoritativo, somente fixtures próprias em banco/schema descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
async function main() {
 assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema')??'',/^smoke_multiattack_/);
 const base=process.env.PLAYABLE_BASE_URL!;assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal(new URL(base).port,'3139');
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
  const abilities=[{id:'multiple',name:'Ataques Múltiplos',description:'Uma mordida e duas garras.',cost:'action',execution:'multiattack',multiattack:[{attackId:'bite',count:1},{attackId:'claw',count:2}]},{id:'broken',name:'Referência inválida',cost:'action',execution:'multiattack',multiattack:[{attackId:'missing',count:2}]}];
  const creature=await prisma.creature.create({data:{name:'Atacante isolado',hpMax:1000,hpCurrent:1000,abilities,attacks:['bite','claw','tail'].map(id=>({id,name:id,attackBonus:30,reachFeet:5,damage:{count:1,sides:4,bonus:0,type:'Perfurante'}}))}});creatureId=creature.id;
  const combat=await prisma.combat.create({data:{status:'ACTIVE',turnSequence:1,currentIndex:0,spatialConfig:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5}}});combatId=combat.id;
  const source=await prisma.combatant.create({data:{combatId,creatureId,kind:'CREATURE',name:'Atacante isolado',dexterityMod:0,initiative:30,hpCurrent:1000,hpMax:1000,spatialPosition:{xFeet:0,yFeet:0},turnEconomy:onTurnStart(9)}});
  const targetA=await prisma.combatant.create({data:{combatId,characterId:a.id,ownerUserId:player.id,kind:'CHARACTER',name:a.name,dexterityMod:0,initiative:20,spatialPosition:{xFeet:5,yFeet:0},turnEconomy:onTurnStart(9)}});
  const targetB=await prisma.combatant.create({data:{combatId,characterId:b.id,ownerUserId:peer.id,kind:'CHARACTER',name:b.name,dexterityMod:0,initiative:10,spatialPosition:{xFeet:0,yFeet:5},turnEconomy:onTurnStart(9)}});
  let dto=(await http('/combat/active')).data.combat;
  const operation=()=>({combatId:combat.id,expectedVersion:dto.version,operationId:randomUUID()});
  const startInput={...operation(),combatantId:source.id,abilityId:'multiple'};
  assert.equal((await http('/combat/creature-ability',startInput,player)).status,403);
  const start=await http('/combat/creature-ability',startInput);assert.equal(start.status,200,JSON.stringify(start));dto=start.data.combat;
  const economy=()=>dto.combatants.find((c:any)=>c.id===source.id).turnEconomy;
  const id=economy().multiattack.id;assert.equal(economy().actionsUsed,1);assert.equal(economy().attackAction,null);
  assert.deepEqual((await http('/combat/creature-ability',startInput)).data.combat,dto,'Retry de início não consome outra Ação');
  const publicDto=(await http('/combat/active',undefined,player)).data.combat;
  assert.equal(publicDto.combatants.find((c:any)=>c.id===source.id).turnEconomy.multiattack,null,'Composição e progresso internos não vazam');
  const hit=(attackId:string,targetCombatantId:string,extra:Record<string,unknown>={})=>http('/combat/attack',{...operation(),attackerCombatantId:source.id,attackId,targetCombatantId,multiattackId:id,...extra});
  const snapshot=async()=>JSON.stringify(await prisma.combat.findUnique({where:{id:combatId},include:{combatants:true}}));
  const {resolveAttack}=await import('../modules/combat/combat.service.js');
  await assert.rejects(resolveAttack({userId:master.id,username:master.username,role:'MASTER'},
    {...operation(),attackerCombatantId:source.id,attackId:'bite',targetCombatantId:targetA.id,multiattackId:id},
    {forcedReaction:true}), (error:any)=>error.code==='MULTIATTACK_INVALID_CONTEXT');
  const initial=await snapshot();assert.equal((await hit('tail',targetA.id)).status,409);assert.equal(await snapshot(),initial);
  assert.equal((await hit('bite',targetA.id,{multiattackId:'forged'})).status,409);
  assert.equal((await hit('bite',targetA.id,{prepared:true})).status,400);
  assert.equal((await hit('bite',targetA.id,{attackActionId:id})).status,400);
  // Alcance inválido não avança a composição nem consome um golpe.
  await prisma.combatant.update({where:{id:targetB.id},data:{spatialPosition:{xFeet:70,yFeet:70}}});
  assert.equal((await hit('claw',targetB.id)).data.error,'TARGET_OUT_OF_REACH');
  await prisma.combatant.update({where:{id:targetB.id},data:{spatialPosition:{xFeet:0,yFeet:5}}});
  const firstInput={...operation(),attackerCombatantId:source.id,attackId:'claw',targetCombatantId:targetA.id,multiattackId:id};
  const first=await http('/combat/attack',firstInput);assert.equal(first.status,200,JSON.stringify(first));dto=first.data.combat;
  assert.equal(economy().multiattack.performed,1);assert.equal(economy().actionsUsed,1);
  const hpAfterFirst=await prisma.character.findMany({where:{id:{in:characters}},select:{id:true,hpCurrent:true},orderBy:{id:'asc'}});const afterFirst=await snapshot();const retry=(await http('/combat/attack',firstInput)).data;assert.equal(retry.replayed,true);assert.deepEqual(retry.result,first.data.result);assert.deepEqual(retry.combat,first.data.combat);assert.equal(await snapshot(),afterFirst,'Retry não rola nem aplica dano novamente');assert.deepEqual(await prisma.character.findMany({where:{id:{in:characters}},select:{id:true,hpCurrent:true},orderBy:{id:'asc'}}),hpAfterFirst);
  const second=await hit('bite',targetB.id);assert.equal(second.status,200,JSON.stringify(second));dto=second.data.combat;assert.equal(economy().multiattack.performed,2);
  assert.equal((await hit('bite',targetA.id)).status,409,'Mordida esgotada não pode substituir Garra');
  const last=await hit('claw',targetA.id);assert.equal(last.status,200,JSON.stringify(last));dto=last.data.combat;
  assert.equal(economy().multiattack.performed,3);assert.equal(economy().actionsUsed,1);assert.equal(economy().attackAction,null);
  assert.equal((await hit('claw',targetB.id)).status,409);
  assert.equal((await http('/combat/attack',{...operation(),attackerCombatantId:source.id,attackId:'tail',targetCombatantId:targetA.id})).status,409,'Ação normal não fica gratuita');
  assert.equal((await http('/combat/creature-ability',{...operation(),combatantId:source.id,abilityId:'broken'})).status,409);
  // Encerrar turno elimina a sequência. Retentar o id velho no turno seguinte não funciona.
  for(let i=0;i<3;i++){const next=await http('/combat/next-turn',operation());assert.equal(next.status,200,JSON.stringify(next));dto=next.data.combat;}
  assert.equal(dto.currentCombatantId,source.id);assert.equal(economy().multiattack,null);assert.equal(economy().actionsUsed,0);
  assert.equal((await hit('claw',targetA.id)).status,409);
  const restarted=await http('/combat/creature-ability',{...operation(),combatantId:source.id,abilityId:'multiple'});assert.equal(restarted.status,200);dto=restarted.data.combat;
  const cancel=await http('/combat/creature-ability',{...operation(),combatantId:source.id,abilityId:'multiple',mode:'cancel-multiattack'});assert.equal(cancel.status,200);dto=cancel.data.combat;
  assert.equal(economy().multiattack,null);assert.equal(economy().actionsUsed,1,'Abandonar não devolve a Ação');
  // Composição genérica: uma habilidade assistida e uma área com condição.
  const extras=[{id:'assist',name:'Efeito assistido',cost:'action',execution:'assisted'}, {id:'fear',name:'Área com condição',cost:'action',execution:'area-save-damage',area:{shape:{kind:'sphere',radiusFeet:20},rangeFeet:0,saveAbility:'wisdom',dc:20,onSuccess:'none',damage:[],conditions:['frightened']}}, {id:'mixed',name:'Ataques e habilidades',cost:'action',execution:'multiattack',multiattack:[{attackId:'bite',count:2},{kind:'ability',attackId:'assist',count:1},{kind:'ability',attackId:'fear',count:1}]}];
  await prisma.creature.update({where:{id:creature.id},data:{abilities:[...abilities,...extras]}});
  await prisma.combatant.update({where:{id:source.id},data:{turnEconomy:onTurnStart(9)}});dto=(await http('/combat/active')).data.combat;
  const mixedStart=await http('/combat/creature-ability',{...operation(),combatantId:source.id,abilityId:'mixed'});assert.equal(mixedStart.status,200,JSON.stringify(mixedStart));dto=mixedStart.data.combat;
  const mixedId=economy().multiattack.id;
  const assistInput={...operation(),combatantId:source.id,abilityId:'assist',multiattackId:mixedId,confirmed:true};
  const assisted=await http('/combat/creature-ability',assistInput);assert.equal(assisted.status,200,JSON.stringify(assisted));dto=assisted.data.combat;assert.equal(economy().actionsUsed,1);assert.equal(economy().multiattack.performed,1);
  assert.equal((await http('/combat/creature-ability',assistInput)).data.replayed,true);
  assert.equal((await http('/combat/creature-ability',{...assistInput,...operation()})).status,409,'Quota da habilidade esgotada');
  const reading=await http(`/combat/${combatId}/creature-area-preview`,{combatantId:source.id,abilityId:'fear',placement:{origin:{xFeet:2.5,yFeet:2.5},angle:0}});assert.equal(reading.status,200);
  const areaPlacement={origin:{xFeet:2.5,yFeet:2.5},angle:0,definitionFingerprint:reading.data.definitionFingerprint,selectedTargetKeys:[`character:${a.id}`]};
  const areaInput={...operation(),combatantId:source.id,abilityId:'fear',multiattackId:mixedId,areaPlacement};
  const areaResult=await http('/combat/creature-ability',areaInput);assert.equal(areaResult.status,200,JSON.stringify(areaResult));dto=areaResult.data.combat;assert.equal(economy().actionsUsed,1);assert.equal(economy().multiattack.performed,2);
  const use=await prisma.creatureAreaUse.findFirstOrThrow({where:{combatId,abilityId:'fear'}});const {finalizeSaveDamageCast}=await import('../modules/spells/execution/save-damage-finalizer.js');
  await prisma.$transaction(async tx=>{await tx.pendingEffectSave.updateMany({where:{creatureAreaUseId:use.id},data:{status:'resolved',result:'failure'}});await finalizeSaveDamageCast(use.id,tx,{sourceKind:'creature-ability'});});
  assert.equal(await prisma.effectInstance.count({where:{sourceId:use.id}}),1);
  assert.equal((await http('/combat/creature-ability',areaInput)).data.replayed,true);assert.equal(await prisma.creatureAreaUse.count({where:{combatId,abilityId:'fear'}}),1);
  dto=(await http('/combat/active')).data.combat;
  const mixedHit=await http('/combat/attack',{...operation(),attackerCombatantId:source.id,attackId:'bite',targetCombatantId:targetB.id,multiattackId:mixedId});assert.equal(mixedHit.status,200,JSON.stringify(mixedHit));dto=mixedHit.data.combat;assert.equal(economy().multiattack.performed,3);assert.equal(economy().actionsUsed,1);
  console.log('✔ HTTP: uma Ação, alvos diferentes, ordem livre, quotas, alcance, contexto, reconexão, retry, privacidade e encerramento.');
 } finally {
  if(combatId){const uses=await prisma.creatureAreaUse.findMany({where:{combatId},select:{id:true}});await prisma.effectInstance.deleteMany({where:{sourceId:{in:uses.map(use=>use.id)}}});}
  if(combatId)await prisma.combat.deleteMany({where:{id:combatId}});
  if(creatureId)await prisma.creature.deleteMany({where:{id:creatureId}});
  await prisma.character.deleteMany({where:{id:{in:characters}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
