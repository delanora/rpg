/** HTTP autoritativo, somente fixtures próprias em banco/schema descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
async function main() {
 assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema')??'',/^smoke_ability_effects_/);
 const base=process.env.PLAYABLE_BASE_URL!;assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal(new URL(base).port,'3141');
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
  const area={shape:{kind:'sphere',radiusFeet:30},rangeFeet:0,saveAbility:'wisdom',dc:20,onSuccess:'none',damage:[],conditions:['frightened']};
  const abilities=[{id:'fear',name:'Condição genérica',cost:'action',execution:'area-save-damage',area},{id:'wings',name:'Área lendária genérica',cost:'legendary',execution:'area-save-damage',legendaryCost:2,area:{...area,saveAbility:'dexterity',conditions:['prone'],onSuccess:'half',damage:[{bonus:10,type:'Concussão',dice:{count:2,sides:6}}]}}];
  const creature=await prisma.creature.create({data:{name:'Origem isolada',hpMax:1000,hpCurrent:1000,abilities,legendaryActionsMax:3}});creatureId=creature.id;
  const combat=await prisma.combat.create({data:{status:'ACTIVE',turnSequence:1,currentIndex:0,spatialConfig:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5}}});combatId=combat.id;
  const source=await prisma.combatant.create({data:{combatId,creatureId,kind:'CREATURE',name:'Origem',initiative:30,dexterityMod:0,hpCurrent:1000,hpMax:1000,spatialPosition:{xFeet:0,yFeet:0},turnEconomy:onTurnStart(9)}});
  const hero=await prisma.combatant.create({data:{combatId,characterId:a.id,ownerUserId:player.id,kind:'CHARACTER',name:a.name,initiative:20,dexterityMod:0,spatialPosition:{xFeet:5,yFeet:0},turnEconomy:onTurnStart(9)}});
  const friend=await prisma.combatant.create({data:{combatId,characterId:b.id,ownerUserId:peer.id,kind:'CHARACTER',name:b.name,initiative:10,dexterityMod:0,spatialPosition:{xFeet:10,yFeet:0},turnEconomy:onTurnStart(9)}});
  let dto=(await http('/combat/active')).data.combat;
  const op=()=>({combatId,expectedVersion:dto.version,operationId:randomUUID()});
  const placement=async(abilityId:string,keys:string[])=>{const input={origin:{xFeet:2.5,yFeet:2.5},angle:0};const result=await http(`/combat/${combatId}/creature-area-preview`,{combatantId:source.id,abilityId,placement:input});assert.equal(result.status,200,JSON.stringify(result));return {...input,definitionFingerprint:result.data.definitionFingerprint,selectedTargetKeys:keys};};
  assert.equal((await http(`/combat/${combatId}/spatial/area-visual`,{previewId:randomUUID(),sequence:1,placement:{combatantId:source.id,abilityId:'fear',origin:{xFeet:2.5,yFeet:2.5},angle:0}})).status,200,'Prévia sem dano não exige tipo de dano');
  const firstInput={...op(),combatantId:source.id,abilityId:'fear',areaPlacement:await placement('fear',[`character:${a.id}`])};
  const begin=await http('/combat/creature-ability',firstInput);assert.equal(begin.status,200,JSON.stringify(begin));dto=begin.data.combat;
  const use=await prisma.creatureAreaUse.findFirstOrThrow({where:{combatId}});
  const pending=await prisma.pendingEffectSave.findMany({where:{creatureAreaUseId:use.id}});assert.equal(pending.length,1);assert.equal(pending[0].targetEntityId,a.id);
  assert.equal(await prisma.effectInstance.count({where:{sourceId:use.id}}),0,'Condição aguarda a salvaguarda');
  const {finalizeSaveDamageCast}=await import('../modules/spells/execution/save-damage-finalizer.js');
  await prisma.$transaction(async tx=>{await tx.pendingEffectSave.update({where:{id:pending[0].id},data:{status:'resolved',result:'failure'}});await finalizeSaveDamageCast(use.id,tx,{sourceKind:'creature-ability'});});
  const effect=await prisma.effectInstance.findFirstOrThrow({where:{sourceId:use.id}});assert.deepEqual(effect.conditions,['frightened']);
  const changed=await prisma.character.findUniqueOrThrow({where:{id:a.id}});assert.equal(changed.hpCurrent,1000);assert.ok(JSON.stringify(changed.mechanicalState).includes('frightened'));
  assert.ok(!JSON.stringify((await prisma.character.findUniqueOrThrow({where:{id:b.id}})).mechanicalState).includes('frightened'),'Alvo desmarcado não recebe condição');
  await prisma.$transaction(tx=>finalizeSaveDamageCast(use.id,tx,{sourceKind:'creature-ability'}));assert.equal(await prisma.effectInstance.count({where:{sourceId:use.id}}),1,'Finalização repetida não duplica efeito');
  assert.equal((await http('/combat/creature-ability',firstInput)).data.replayed,true);
  // Remoção usa o lifecycle normal e limpa somente a condição deste efeito.
  const {endEffectInstance}=await import('../modules/effects/effect-group-lifecycle.js');
  await prisma.$transaction(tx=>endEffectInstance(effect.id,'manual',tx));
  assert.ok(!JSON.stringify((await prisma.character.findUniqueOrThrow({where:{id:a.id}})).mechanicalState).includes('frightened'));
  // Área lendária reutiliza o mesmo fluxo e cobra exclusivamente o saldo próprio.
  await prisma.combat.update({where:{id:combatId},data:{currentIndex:1,legendaryWindow:{id:'fixture-window',turnSequence:1,outgoingId:hero.id,candidateIds:[source.id],decidedIds:[]}}});
  dto=(await http('/combat/active')).data.combat;
  await prisma.character.update({where:{id:b.id},data:{raceResistances:['Concussão']}});
  const normal=(await prisma.combatant.findUniqueOrThrow({where:{id:source.id}})).turnEconomy;
  const legendInput={...op(),windowId:'fixture-window',combatantId:source.id,abilityId:'wings',areaPlacement:await placement('wings',[`character:${a.id}`,`character:${b.id}`])};
  assert.equal((await http('/combat/legendary/use',legendInput,player)).status,403);
  const legend=await http('/combat/legendary/use',legendInput);assert.equal(legend.status,200,JSON.stringify(legend));dto=legend.data.combat;
  const unit=await prisma.combatant.findUniqueOrThrow({where:{id:source.id}});assert.deepEqual(unit.turnEconomy,normal);assert.equal((unit.legendaryState as any).used,2);
  const second=await prisma.creatureAreaUse.findFirstOrThrow({where:{combatId,id:{not:use.id}}});
  assert.equal(await prisma.pendingEffectSave.count({where:{creatureAreaUseId:second.id}}),2);
  await prisma.$transaction(async tx=>{const rows=await tx.pendingEffectSave.findMany({where:{creatureAreaUseId:second.id}});for(const row of rows)await tx.pendingEffectSave.update({where:{id:row.id},data:{status:'resolved',result:row.targetEntityId===a.id?'failure':'success'}});await finalizeSaveDamageCast(second.id,tx,{sourceKind:'creature-ability',roll:()=>3});});
  assert.equal(await prisma.effectInstance.count({where:{sourceId:second.id}}),1,'Sucesso não recebe condição');
  assert.equal((await prisma.character.findUniqueOrThrow({where:{id:a.id}})).hpCurrent,984);assert.equal((await prisma.character.findUniqueOrThrow({where:{id:b.id}})).hpCurrent,996);
  const snapshot=(await prisma.creatureAreaUse.findUniqueOrThrow({where:{id:second.id}})).resolutionSnapshot as any;assert.equal(snapshot.damageRoll.rawDamage,16);assert.equal(snapshot.damageRoll.components[0].bonus,10);assert.deepEqual(snapshot.damageRoll.components[0].rolls,[3,3]);
  assert.equal((await http('/combat/legendary/use',legendInput)).data.replayed,true);assert.equal((await prisma.combatant.findUniqueOrThrow({where:{id:source.id}})).legendaryState&& (unit.legendaryState as any).used,2);
  console.log('✔ Condições sem dano, seleção de alvos, efeitos removíveis, retry, dano com condição e área lendária com saldo próprio.');
 } finally {
  if(combatId){const uses=await prisma.creatureAreaUse.findMany({where:{combatId},select:{id:true}});await prisma.effectInstance.deleteMany({where:{sourceId:{in:uses.map(use=>use.id)}}});}
  if(combatId)await prisma.combat.deleteMany({where:{id:combatId}});
  if(creatureId)await prisma.creature.deleteMany({where:{id:creatureId}});
  await prisma.character.deleteMany({where:{id:{in:characters}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
