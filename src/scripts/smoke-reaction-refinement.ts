/** Fluxo real iniciado pela UI/API; exige schema descartável e sentinela HTTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { loadCombatById } from '../modules/combat/combat-load.js';
import { opportunityAttackProfilesOf } from '../modules/combat/spatial/opportunity-openers.js';
async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^smoke_/);
  assert.ok(process.env.PLAYABLE_BASE_URL && !process.env.PLAYABLE_BASE_URL.includes(':3000'));
  const users:string[]=[], characters:string[]=[], creatures:string[]=[];
  let combatId:string|undefined, regionId:string|undefined;
  try {
    // Sem entidades preexistentes: startCombat inclui a mesa inteira por contrato.
    assert.equal(await prisma.user.count(),0,'Execute esta prova num schema vazio');
    const suffix=randomUUID();
    const makeUser=async(role:'MASTER'|'PLAYER',label:string)=>{
      const row=await prisma.user.create({data:{username:label+suffix,displayName:label,passwordHash:'fixture',role}});users.push(row.id);return row;
    };
    const master=await makeUser('MASTER','Mestre'), player=await makeUser('PLAYER','Jogador'), observer=await makeUser('PLAYER','Observador');
    const token=(user:typeof master)=>signToken({sub:user.id,username:user.username,displayName:user.displayName,role:user.role});
    const http=async(path:string,body?:unknown,user=master,method=body?'POST':'GET')=>{
      const response=await fetch(process.env.PLAYABLE_BASE_URL+'/api'+path,{method,headers:{Authorization:'Bearer '+token(user),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json() as any};
    };
    const hero=await prisma.character.create({data:{userId:player.id,name:'Herói fixture',raceId:'human',hpMax:100,hpCurrent:100,speed:9,inventory:inventoryListSchema.parse([{id:'glaive',name:'Alabarda',slot:'hand1',category:'Arma',details:{weaponType:'melee',weaponCategory:'martial',damageCount:1,damageDie:10,damageType:'Cortante',properties:['reach','two-handed']}}])}});characters.push(hero.id);
    assert.equal((await http('/characters/me',undefined,player)).data.character.id,hero.id,'HTTP deve apontar para o mesmo schema');
    const other=await prisma.character.create({data:{userId:observer.id,name:'Outro herói fixture',raceId:'human',hpMax:20,hpCurrent:20,speed:9}});characters.push(other.id);
    const dragon=await prisma.creature.create({data:{name:'Dragão fixture',size:'Huge',hpMax:100,hpCurrent:100,speed:9,attacks:[{id:'bite',name:'Mordida',reachFeet:15,ranged:false,attackBonus:0,damage:{count:0,sides:0,bonus:0,type:null}}]}});creatures.push(dragon.id);
    const npc=await prisma.creature.create({data:{name:'NPC fixture',kind:'NPC',hpMax:20,hpCurrent:20,speed:9}});creatures.push(npc.id);
    const region=await prisma.region.create({data:{name:'Região de reação fixture'}});regionId=region.id;
    const locality=await prisma.locality.create({data:{regionId,name:'Localidade fixture'}});
    const scene=await prisma.scene.create({data:{localityId:locality.id,name:'Cena de reação fixture',spatialConfig:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5}}});
    const started=await http('/combat',{sceneId:scene.id,entries:[{creatureId:dragon.id,quantity:1,disposition:'hostile'},{creatureId:npc.id,quantity:1}]});
    combatId=started.data.combat?.id;assert.equal(started.status,201,JSON.stringify(started));
    let loaded=await loadCombatById(combatId!);
    const actor=loaded.combatants.find(c=>c.characterId===hero.id)!, foe=loaded.combatants.find(c=>c.creatureId===dragon.id)!, neutral=loaded.combatants.find(c=>c.creatureId===npc.id)!, spectator=loaded.combatants.find(c=>c.characterId===other.id)!;
    assert.equal(actor.sideKey,'players');assert.equal(foe.sideKey,'enemies');assert.equal(neutral.sideKey,'neutral');
    assert.equal(opportunityAttackProfilesOf(foe)[0]?.reachFeet,15,'Alcance manual deve sobreviver ao schema de ataques');
    console.log('✔ Preparação real define grupo, hostil escolhido e NPC neutro; alcance manual é executável');
    const publicCombat=(await http('/combat/active',undefined,player)).data.combat;
    assert.equal(publicCombat.combatants.find((c:any)=>c.id===actor.id).relation,'allied');
    assert.equal(publicCombat.combatants.find((c:any)=>c.id===foe.id).relation,'hostile');
    assert.equal(publicCombat.combatants.find((c:any)=>c.id===neutral.id).relation,'neutral');
    assert.ok(publicCombat.combatants.every((c:any)=>c.sideKey===null));

    for(const [unit,initiative,position] of [[actor,30,{xFeet:15,yFeet:10}],[spectator,25,{xFeet:80,yFeet:80}],[foe,20,{xFeet:30,yFeet:10}],[neutral,10,{xFeet:80,yFeet:60}]] as const)
      await prisma.combatant.update({where:{id:unit.id},data:{initiative,spatialPosition:position,turnEconomy:onTurnStart(9)}});
    await prisma.combat.update({where:{id:combatId},data:{status:'ACTIVE',round:1,turnSequence:1,currentIndex:0}});
    const version=async()=>(await prisma.combat.findUniqueOrThrow({where:{id:combatId}})).version;
    const path=[{xFeet:10,yFeet:10}];
    const preview=async()=>http(`/combat/${combatId}/spatial/movement-preview`,{combatantId:actor.id,path},player);
    let read=await preview();assert.equal(read.status,200);assert.equal(read.data.reaction.risk,'possible');assert.equal(read.data.reaction.boundaries.length,0);
    assert.equal(read.data.reaction.threatAreas.length,1);assert.equal(read.data.reaction.threatAreas[0].reachFeet,15);assert.equal(read.data.reaction.threatAreas[0].widthFeet,15);
    assert.deepEqual(Object.keys(read.data.reaction.threatAreas[0]).sort(),['heightFeet','minXFeet','minYFeet','reachFeet','widthFeet'].sort());
    await prisma.combatant.update({where:{id:foe.id},data:{spatialVisibility:'master-only'}});
    read=await preview();assert.equal(read.data.reaction.threatAreas.length,0);
    const hidden=(await http('/combat/active',undefined,player)).data.combat.combatants.find((c:any)=>c.id===foe.id);
    assert.equal(hidden.relation,'unknown');assert.equal(hidden.spatial,null);

    await prisma.combatant.update({where:{id:foe.id},data:{spatialVisibility:'public'}});
    const sideInput={sideKey:'neutral',expectedVersion:await version(),operationId:randomUUID()};
    assert.equal((await http(`/combat/${combatId}/combatants/${foe.id}/side`,sideInput,player,'PATCH')).status,403);
    assert.equal((await http(`/combat/${combatId}/combatants/${foe.id}/side`,sideInput,master,'PATCH')).status,200);
    assert.equal((await preview()).data.reaction.risk,'none');
    assert.equal((await http(`/combat/${combatId}/combatants/${foe.id}/side`,{...sideInput,sideKey:'enemies',expectedVersion:await version(),operationId:randomUUID()},master,'PATCH')).status,200);
    console.log('✔ Aura usa footprint/alcance do servidor, oculta reactors privados e desaparece para neutros');
    const move=await http(`/combat/${combatId}/spatial/movement`,{combatantId:actor.id,path,expectedVersion:await version(),operationId:randomUUID()},player);
    assert.equal(move.status,200,JSON.stringify(move));assert.ok(move.data.pending);
    assert.deepEqual((await prisma.combatant.findUniqueOrThrow({where:{id:actor.id}})).spatialPosition,{xFeet:15,yFeet:10});
    const windows=await http(`/combat/${combatId}/reaction-opportunities`);const window=windows.data.opportunities[0];assert.ok(window.actionable);assert.equal(window.reactorCombatantId,foe.id);assert.equal(window.responseKind,'reaction');
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities`,undefined,player)).data.opportunities.length,0);
    const reaction={combatId,expectedVersion:await version(),operationId:randomUUID(),attackId:'bite'};
    const resolved=await http(`/combat/${combatId}/reaction-opportunities/${window.id}/attack`,reaction);assert.equal(resolved.status,200,JSON.stringify(resolved));
    const after=JSON.stringify(await prisma.combatant.findMany({where:{combatId},orderBy:{id:'asc'}}));
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities/${window.id}/attack`,reaction)).status,200);
    assert.equal(JSON.stringify(await prisma.combatant.findMany({where:{combatId},orderBy:{id:'asc'}})),after);
    const acted=await prisma.combatant.findUniqueOrThrow({where:{id:foe.id}});assert.equal((acted.turnEconomy as any).reactionAvailable,false);assert.equal((acted.turnEconomy as any).actionsUsed,0);
    assert.deepEqual((await prisma.combatant.findUniqueOrThrow({where:{id:actor.id}})).spatialPosition,{xFeet:10,yFeet:10});
    console.log('✔ Mestre reage pela criatura fora do turno; movimento pausa antes da saída, retoma e retry não cobra novamente');
    await prisma.combatant.update({where:{id:actor.id},data:{spatialPosition:{xFeet:15,yFeet:10},turnEconomy:onTurnStart(9)}});
    await prisma.combatant.update({where:{id:foe.id},data:{turnEconomy:onTurnStart(9)}});
    await prisma.spatialObstacle.create({data:{sceneId:scene.id,kind:'wall',startXFeet:90,startYFeet:0,endXFeet:90,endYFeet:100,blocksMovement:false,blocksTargeting:false,blocksSight:true}});
    assert.equal((await preview()).data.reaction.masterAdjudication,true);
    const paused=await http(`/combat/${combatId}/spatial/movement`,{combatantId:actor.id,path,expectedVersion:await version(),operationId:randomUUID()},player);assert.ok(paused.data.pending);
    const uncertain=(await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0];assert.equal(uncertain.visibilityStatus,'unknown');assert.equal(uncertain.responseKind,'visibility');
    const adjudicated=await http(`/combat/${combatId}/reaction-opportunities/${uncertain.id}/visibility`,{combatId,visible:false,expectedVersion:await version(),operationId:randomUUID()});assert.equal(adjudicated.status,200,JSON.stringify(adjudicated));
    assert.equal((await prisma.combatant.findUniqueOrThrow({where:{id:foe.id}})).turnEconomy && ((await prisma.combatant.findUniqueOrThrow({where:{id:foe.id}})).turnEconomy as any).reactionAvailable,true);
    console.log('✔ Paredes de visão pedem adjudicação; recusar visão retoma movimento sem gastar reação');
    await prisma.combatant.update({where:{id:actor.id},data:{spatialPosition:{xFeet:15,yFeet:10},turnEconomy:onTurnStart(9)}});
    await http(`/combat/${combatId}/spatial/movement`,{combatantId:actor.id,path,expectedVersion:await version(),operationId:randomUUID()},player);
    const confirmable=(await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0];
    const confirmed=await http(`/combat/${combatId}/reaction-opportunities/${confirmable.id}/visibility`,{combatId,visible:true,expectedVersion:await version(),operationId:randomUUID()});assert.equal(confirmed.status,200);
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0].visibilityStatus,'known-visible');
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities/${confirmable.id}/decline`,{combatId,expectedVersion:await version(),operationId:randomUUID()})).status,200);
    await prisma.combatant.update({where:{id:actor.id},data:{spatialPosition:{xFeet:15,yFeet:10},turnEconomy:onTurnStart(9)}});
    await prisma.spatialObstacle.create({data:{sceneId:scene.id,kind:'wall',startXFeet:25,startYFeet:0,endXFeet:25,endYFeet:100,blocksMovement:false,blocksTargeting:true,blocksSight:false}});
    assert.equal((await preview()).data.reaction.threatAreas.length,0,'Parede que impede o ataque não deve desenhar ameaça executável');
    assert.notEqual((await preview()).data.reaction.risk,'possible');
    console.log('✔ Confirmar visão libera a escolha; barreira completa de ataque suprime oportunidade impossível');
    // Reproduz o vídeo: arco equipado, oportunidade válida pelo golpe desarmado.
    await prisma.spatialObstacle.deleteMany({where:{sceneId:scene.id}});
    await prisma.character.update({where:{id:hero.id},data:{inventory:inventoryListSchema.parse([{id:'bow',name:'Arco fixture',category:'Arma',slot:'hand1',details:{weaponType:'ranged',rangeNormal:45,rangeLong:180,properties:['two-handed']}}])}});
    await prisma.combatant.update({where:{id:actor.id},data:{spatialPosition:{xFeet:15,yFeet:10},turnEconomy:onTurnStart(9)}});
    await prisma.combatant.update({where:{id:foe.id},data:{spatialPosition:{xFeet:20,yFeet:10},turnEconomy:onTurnStart(9)}});
    await prisma.combat.update({where:{id:combatId},data:{currentIndex:2,turnSequence:2}});
    const leaving=await http(`/combat/${combatId}/spatial/movement`,{combatantId:foe.id,path:[{xFeet:25,yFeet:10}],expectedVersion:await version(),operationId:randomUUID()});
    assert.equal(leaving.status,200,JSON.stringify(leaving));assert.ok(leaving.data.pending);
    const playerWindow=(await http(`/combat/${combatId}/reaction-opportunities`,undefined,player)).data.opportunities[0];
    assert.equal(playerWindow.responseKind,'reaction');
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0].responseKind,null);
    assert.equal(playerWindow.reactorCombatantId,actor.id);assert.deepEqual(playerWindow.options.map((o:any)=>o.attackId),['unarmed']);
    const unarmed=await http(`/combat/${combatId}/reaction-opportunities/${playerWindow.id}/attack`,{combatId,attackId:'unarmed',expectedVersion:await version(),operationId:randomUUID()},player);
    assert.equal(unarmed.status,200,JSON.stringify(unarmed));
    assert.equal(((await prisma.combatant.findUniqueOrThrow({where:{id:actor.id}})).turnEconomy as any).reactionAvailable,false);
    console.log('✔ Arquearia mantém oportunidade desarmada real para o jogador; relações públicas não expõem times nem tokens ocultos');
    // Quando a reação é do jogador, o Mestre só adjudica visão desconhecida.
    await prisma.combatant.update({where:{id:actor.id},data:{spatialPosition:{xFeet:15,yFeet:10},turnEconomy:onTurnStart(9)}});
    await prisma.combatant.update({where:{id:foe.id},data:{spatialPosition:{xFeet:20,yFeet:10},turnEconomy:onTurnStart(9)}});
    await prisma.spatialObstacle.create({data:{sceneId:scene.id,kind:'wall',startXFeet:90,startYFeet:0,endXFeet:90,endYFeet:100,blocksMovement:false,blocksTargeting:false,blocksSight:true}});
    await http(`/combat/${combatId}/spatial/movement`,{combatantId:foe.id,path:[{xFeet:25,yFeet:10}],expectedVersion:await version(),operationId:randomUUID()});
    const vision=(await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0];assert.equal(vision.responseKind,'visibility');
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities`,undefined,player)).data.opportunities.length,0);
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities/${vision.id}/visibility`,{combatId,visible:true,expectedVersion:await version(),operationId:randomUUID()})).status,200);
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0].responseKind,null);
    const confirmedPlayer=(await http(`/combat/${combatId}/reaction-opportunities`,undefined,player)).data.opportunities[0];assert.equal(confirmedPlayer.responseKind,'reaction');
    assert.equal((await http(`/combat/${combatId}/reaction-opportunities/${confirmedPlayer.id}/decline`,{combatId,expectedVersion:await version(),operationId:randomUUID()},player)).status,200);
    await prisma.spatialObstacle.deleteMany({where:{sceneId:scene.id}});
    console.log('✔ Mestre acompanha reação do jogador sem pergunta duplicada; confirmação de visão devolve a decisão ao dono');

    for(const kind of ['NPC','CREATURE'] as const) {
      await prisma.creature.update({where:{id:npc.id},data:{kind,attacks:[{id:'neutral-claw',name:'Garra neutra',reachFeet:5,ranged:false,damage:{count:0,sides:0,bonus:0,type:null}}]}});
      await prisma.combatant.update({where:{id:neutral.id},data:{kind,sideKey:'neutral',spatialPosition:{xFeet:40,yFeet:10},turnEconomy:onTurnStart(9)}});
      await prisma.combatant.update({where:{id:actor.id},data:{spatialPosition:{xFeet:80,yFeet:80},turnEconomy:onTurnStart(9)}});
      await prisma.combatant.update({where:{id:foe.id},data:{sideKey:'enemies',spatialPosition:{xFeet:45,yFeet:10},turnEconomy:onTurnStart(9)}});
      await prisma.combat.update({where:{id:combatId},data:{currentIndex:2,turnSequence:{increment:1}}});
      const moveHostile=await http(`/combat/${combatId}/spatial/movement`,{combatantId:foe.id,path:[{xFeet:50,yFeet:10}],expectedVersion:await version(),operationId:randomUUID()});
      assert.equal(moveHostile.status,200,JSON.stringify(moveHostile));assert.ok(moveHostile.data.pending);
      const neutralReaction=(await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0];
      assert.equal(neutralReaction.reactorCombatantId,neutral.id);assert.equal(neutralReaction.responseKind,'reaction');
      assert.equal((await http(`/combat/${combatId}/reaction-opportunities/${neutralReaction.id}/decline`,{combatId,expectedVersion:await version(),operationId:randomUUID()})).status,200);
      await prisma.combatant.update({where:{id:foe.id},data:{spatialPosition:{xFeet:45,yFeet:10},turnEconomy:onTurnStart(9)}});
      await prisma.combatant.update({where:{id:neutral.id},data:{spatialPosition:{xFeet:30,yFeet:10},turnEconomy:onTurnStart(9)}});
      await prisma.combat.update({where:{id:combatId},data:{currentIndex:3,turnSequence:{increment:1}}});
      const leave=[{xFeet:25,yFeet:10}];
      const threat=await http(`/combat/${combatId}/spatial/movement-preview`,{combatantId:neutral.id,path:leave});
      assert.equal(threat.data.reaction.risk,'possible');assert.ok(threat.data.reaction.threatAreas.length);
      const moveNeutral=await http(`/combat/${combatId}/spatial/movement`,{combatantId:neutral.id,path:leave,expectedVersion:await version(),operationId:randomUUID()});
      assert.equal(moveNeutral.status,200,JSON.stringify(moveNeutral));assert.ok(moveNeutral.data.pending);
      const hostileReaction=(await http(`/combat/${combatId}/reaction-opportunities`)).data.opportunities[0];
      assert.equal(hostileReaction.reactorCombatantId,foe.id);
      assert.equal((await http(`/combat/${combatId}/reaction-opportunities/${hostileReaction.id}/decline`,{combatId,expectedVersion:await version(),operationId:randomUUID()})).status,200);
      console.log('✔ '+kind+' neutro e criatura hostil provocam oportunidade nos dois sentidos, com aura e decisão do Mestre');
    }



  } finally {
    if(combatId)await prisma.combat.delete({where:{id:combatId}});
    await prisma.creature.deleteMany({where:{id:{in:creatures}}});
    if(regionId)await prisma.region.delete({where:{id:regionId}});
    await prisma.character.deleteMany({where:{id:{in:characters}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
