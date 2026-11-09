/** Caminho livre real por HTTP; somente fixtures em schema descartável. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { characterDerivedAttacks } from '../modules/characters/characters.dto.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { grantCastingComponents, seedSpellRepertoire } from './spell-slot-fixtures.js';
async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^smoke_/);
  // Prova o backfill real sem tocar nem mesmo nas fixtures da cena.
  await prisma.$transaction(async db => {
    await db.$executeRawUnsafe('CREATE TEMP TABLE spatial_obstacles (id INTEGER, "blocksTargeting" BOOLEAN NOT NULL) ON COMMIT DROP');
    await db.$executeRawUnsafe('INSERT INTO spatial_obstacles VALUES (1, true), (2, false)');
    const migration = await readFile(new URL('../../prisma/migrations/20261109100000_add_obstacle_cover/migration.sql', import.meta.url), 'utf8');
    for (const sql of migration.split(';').filter(part => part.trim())) await db.$executeRawUnsafe(sql);
    assert.deepEqual(await db.$queryRawUnsafe('SELECT "coverLevel" FROM spatial_obstacles ORDER BY id'), [{coverLevel:'total'},{coverLevel:'none'}]);
  });
  console.log('✔ Migração preserva paredes existentes: bloqueio total ou sem cobertura');
  const base = process.env.PLAYABLE_BASE_URL!;
  assert.ok(base && !base.includes(':3000'));
  const users: string[] = [], ids: string[] = [];
  let combatId: string | undefined, regionId: string | undefined;
  try {
    const suffix = randomUUID();
    const master = await prisma.user.create({ data: { username: 'wall_m_'+suffix, displayName: 'Mestre fixture', passwordHash: 'fixture', role: 'MASTER' } }); users.push(master.id);
    const player = await prisma.user.create({ data: { username: 'wall_p_'+suffix, displayName: 'Jogador fixture', passwordHash: 'fixture', role: 'PLAYER' } }); users.push(player.id);
    const token = (u: typeof master) => signToken({ sub:u.id, username:u.username, displayName:u.displayName, role:u.role });
    const request = async (path:string, body?:unknown, auth=token(master)) => {
      const response = await fetch(base+'/api'+path, { method:body?'POST':'GET', headers:{ Authorization:'Bearer '+auth, 'Content-Type':'application/json' }, ...(body?{body:JSON.stringify(body)}:{}) });
      return {status:response.status, data:await response.json() as any};
    };
    const hero = await prisma.character.create({ data: { userId:player.id, name:'Clérigo fixture', raceId:'human', classes:[{classKey:'cleric',level:20,subclass:''}], hpMax:50,hpCurrent:50,speed:9,
      inventory:inventoryListSchema.parse([{id:'bow',name:'Arco Longo',slot:'hand1',category:'Arma',details:{weaponType:'ranged',weaponCategory:'martial',damageCount:1,damageDie:8,damageType:'Perfurante',properties:['two-handed','ammunition'],ammoType:'Flecha',rangeNormal:45,rangeLong:180}}, {id:'arrows',name:'Flechas',slot:null,category:'Munição',quantity:10,details:{ammoType:'Flecha'}}]) } }); ids.push(hero.id);
    assert.equal((await request('/characters/me',undefined,token(player))).data.character.id,hero.id, 'Sentinela HTTP e banco devem coincidir');
    const target = await prisma.creature.create({data:{name:'Alvo fixture',hpMax:100,hpCurrent:100,speed:9}}); ids.push(target.id);
    const region = await prisma.region.create({data:{name:'Região fixture'}}); regionId=region.id;
    const locality = await prisma.locality.create({data:{regionId,name:'Local fixture'}});
    const scene = await prisma.scene.create({data:{localityId:locality.id,name:'Cena fixture',spatialConfig:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5}}});
    const createdWall=await request('/scenes/'+scene.id+'/spatial/obstacles',{start:{xFeet:25,yFeet:0},end:{xFeet:25,yFeet:100},blocksMovement:false,blocksSight:false,blocksTargeting:true,expectedVersion:scene.version,operationId:randomUUID()});
    assert.equal(createdWall.status,200,JSON.stringify(createdWall));
    const wall=await prisma.spatialObstacle.findFirstOrThrow({where:{sceneId:scene.id}});
    const patchWall=async(auth:string,body:unknown)=>{
      const response=await fetch(base+'/api/scenes/'+scene.id+'/spatial/obstacles/'+wall.id,{method:'PATCH',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
      return {status:response.status,data:await response.json() as any};
    };
    const edit={blocksTargeting:false,expectedVersion:createdWall.data.scene.version,operationId:randomUUID()};
    assert.equal((await patchWall(token(player),edit)).status,403);
    assert.equal((await patchWall(token(master),edit)).status,200);
    assert.equal((await patchWall(token(master),edit)).status,200);
    const edited=await prisma.spatialObstacle.findUniqueOrThrow({where:{id:wall.id}});
    assert.ok(!edited.blocksTargeting && !edited.blocksMovement && !edited.blocksSight);
    await prisma.spatialObstacle.update({where:{id:wall.id},data:{blocksTargeting:true,coverLevel:'total'}});
    console.log('✔ Flag editável sem geometria, com permissão, idempotência e independência das outras flags');
    const partialEdit = { coverLevel: 'half', expectedVersion: (await prisma.scene.findUniqueOrThrow({where:{id:scene.id}})).version, operationId:randomUUID() };
    const partialResponse = await patchWall(token(master), partialEdit);
    assert.equal(partialResponse.status,200,JSON.stringify(partialResponse));
    assert.equal(partialResponse.data.obstacle.coverLevel,'half');
    assert.equal(partialResponse.data.obstacle.blocksTargeting,false);
    assert.equal((await patchWall(token(master), partialEdit)).status,200,'Retry da edição');
    const versionAfterPartial = (await prisma.scene.findUniqueOrThrow({where:{id:scene.id}})).version;
    assert.equal(versionAfterPartial,partialEdit.expectedVersion+1,'Edição idempotente incrementa uma vez');
    assert.equal((await patchWall(token(master), {...partialEdit,operationId:randomUUID(),expectedVersion:versionAfterPartial,coverLevel:'invalid'})).status,400);
    await prisma.spatialObstacle.update({where:{id:wall.id},data:{coverLevel:'total',blocksTargeting:true}});
    const combat = await prisma.combat.create({data:{status:'ACTIVE',round:1,turnSequence:1,localityId:locality.id,sceneId:scene.id,combatants:{create:[
      {kind:'CHARACTER',characterId:hero.id,ownerUserId:player.id,name:hero.name,initiative:20,dexterityMod:0,spatialPosition:{xFeet:5,yFeet:5},turnEconomy:onTurnStart(9)},
      {kind:'CREATURE',creatureId:target.id,name:target.name,initiative:10,dexterityMod:0,hpMax:100,hpCurrent:100,armorClass:10,spatialPosition:{xFeet:35,yFeet:5},turnEconomy:onTurnStart(9)},
    ]}},include:{combatants:true}}); combatId=combat.id;
    const actor = combat.combatants.find(c=>c.characterId===hero.id)!, victim=combat.combatants.find(c=>c.creatureId===target.id)!;
    const attackId = characterDerivedAttacks(hero).find(a=>a.name.includes('Arco'))!.id;
    const snapshot = async () => JSON.stringify(await Promise.all([prisma.combat.findUnique({where:{id:combatId},include:{combatants:{orderBy:{id:'asc'}},operations:true}}),prisma.character.findUnique({where:{id:hero.id}}),prisma.spellCast.findMany({where:{casterEntityId:hero.id}}),prisma.effectInstance.findMany({where:{sourceEntityId:hero.id}})]));
    const beforeAttack=await snapshot();
    for (const user of [player,master]) {
      const auth=token(user);
      const result=await request('/combat/attack',{combatId,expectedVersion:combat.version,operationId:randomUUID(),attackerCombatantId:actor.id,targetCombatantId:victim.id,attackId,...(user.role==='MASTER'?{coverConfirmation:{targetKey:'combatant:'+victim.id,level:'none'}}:{})},auth);
      assert.equal(result.status,409,JSON.stringify(result)); assert.equal(result.data.error,'TARGET_TOTAL_COVER');
      assert.equal(await snapshot(),beforeAttack);
    }
    console.log('✔ Parede independente impede ataque sem gastar ação/munição/PV; confirmação do Mestre não supera bloqueio');
    await prisma.character.update({where:{id:hero.id},data:{inventory:inventoryListSchema.parse((hero.inventory as any[]).map(i=>({...i,slot:null})))}});
    await grantCastingComponents({characters:[hero.id]});
    await seedSpellRepertoire({characterId:hero.id,classKey:'cleric',spellIds:['bless']});
    const cast={operationId:randomUUID(),caster:{kind:'character',id:hero.id},targets:[{kind:'combatant',id:victim.id}],castingResource:{kind:'spell-slot',level:1},spatialConfirmation:{withinRange:true,clearPath:true,sight:true,groupDistance:true}};
    const beforeSpell=await snapshot();
    const blocked=await request('/effects/bless',cast);
    assert.equal(blocked.status,409,JSON.stringify(blocked));
    assert.equal(await snapshot(),beforeSpell);
    console.log('✔ Magia bloqueada não consome espaço/ação/concentração nem cria efeitos');
    await prisma.spatialObstacle.update({where:{id:wall.id},data:{blocksMovement:true,blocksSight:true,blocksTargeting:false,coverLevel:'none'}});
    const opened=await request('/effects/bless',cast);
    assert.equal(opened.status,201,JSON.stringify(opened));
    const after=await snapshot(); assert.notEqual(after,beforeSpell);
    const retry=await request('/effects/bless',cast); assert.equal(retry.status,200,JSON.stringify(retry)); assert.equal(await snapshot(),after);
    console.log('✔ Desligar somente ataques/magias libera caminho; retry não reaplica custo nem efeito');
    await prisma.character.update({where:{id:hero.id},data:{inventory:hero.inventory!}});
    await prisma.combatant.update({where:{id:actor.id},data:{turnEconomy:onTurnStart(9)}});
    const fresh=await prisma.combat.findUniqueOrThrow({where:{id:combatId}});
    const attack={combatId,expectedVersion:fresh.version,operationId:randomUUID(),targetCombatantId:victim.id,attackId};
    const hit=await request('/combat/attack',attack,token(player));assert.equal(hit.status,200,JSON.stringify(hit));
    const afterAttack=await snapshot();
    const hitRetry=await request('/combat/attack',attack,token(player));assert.equal(hitRetry.status,200,JSON.stringify(hitRetry));assert.equal(await snapshot(),afterAttack);
    console.log('✔ Ataque liberado com movimento/visão bloqueados; retry preserva ação, munição e PV');
    // Só fixtures próprias: alternamos a geometria para provar o pipeline real.
    for (const [level,bonus] of [['half',2],['three-quarters',5]] as const) {
      await prisma.spatialObstacle.update({where:{id:wall.id},data:{coverLevel:level,blocksTargeting:false,blocksSight:false}});
      await prisma.combatant.update({where:{id:actor.id},data:{turnEconomy:onTurnStart(9)}});
      const fresh=await prisma.combat.findUniqueOrThrow({where:{id:combatId}});
      const input={combatId,expectedVersion:fresh.version,operationId:randomUUID(),attackerCombatantId:actor.id,targetCombatantId:victim.id,attackId};
      const covered=await request('/combat/attack',input);
      assert.equal(covered.status,200,JSON.stringify(covered));
      assert.deepEqual(covered.data.result.cover,{status:'known',level,acBonus:bonus,saveBonus:bonus,provenance:'authoritative'});
      assert.equal(covered.data.result.targetArmorClass,10+bonus);
      const afterCovered=await snapshot();
      const retryCovered=await request('/combat/attack',input);
      assert.equal(retryCovered.status,200,JSON.stringify(retryCovered));
      assert.deepEqual(retryCovered.data.result.cover,covered.data.result.cover);
      assert.equal(await snapshot(),afterCovered);
      await prisma.combatant.update({where:{id:actor.id},data:{turnEconomy:onTurnStart(9)}});
      const current=await prisma.combat.findUniqueOrThrow({where:{id:combatId}});
      const beforeDenied=await snapshot();
      const denied=await request('/combat/attack',{...input,expectedVersion:current.version,operationId:randomUUID(),attackerCombatantId:actor.id,coverConfirmation:{targetKey:'combatant:'+victim.id,level:'none'}});
      assert.equal(denied.status,409,JSON.stringify(denied));
      assert.equal(denied.data.error,'COVER_DECISION_NOT_ALLOWED');
      assert.equal(await snapshot(),beforeDenied);
    }
    console.log('✔ Meia cobertura e três quartos entram na CA pelo servidor; retry preserva snapshot; Mestre não supera grau conhecido');
    await prisma.character.update({where:{id:hero.id},data:{inventory:inventoryListSchema.parse((hero.inventory as any[]).map(i=>({...i,slot:null})))}});
    await grantCastingComponents({characters:[hero.id]});
    await seedSpellRepertoire({characterId:hero.id,classKey:'cleric',spellIds:['sacred-flame']});
    await prisma.combatant.update({where:{id:actor.id},data:{turnEconomy:onTurnStart(9)}});
    const flame=await request('/spells/cast',{operationId:randomUUID(),spellId:'sacred-flame',caster:{kind:'character',id:hero.id},targets:[{kind:'combatant',id:victim.id}]},token(player));
    assert.ok([200,201].includes(flame.status),JSON.stringify(flame));
    const pending=await prisma.pendingEffectSave.findFirstOrThrow({where:{spellCastId:flame.data.cast.id}});
    assert.ok(!pending.cover || (pending.cover as {bonus?:number}).bonus === 0,'Chama Sagrada ignora bônus de cobertura');
    console.log('✔ Chama Sagrada mantém a exceção de ignorar o bônus de cobertura');


  } finally {
    await prisma.pendingEffectSave.deleteMany({where:{targetEntityId:{in:ids}}});
    await prisma.effectInstance.deleteMany({where:{OR:[{sourceEntityId:{in:ids}},{targetEntityId:{in:ids}}]}});
    await prisma.spellCast.deleteMany({where:{casterEntityId:{in:ids}}});
    if(combatId) await prisma.combat.delete({where:{id:combatId}});
    await prisma.creature.deleteMany({where:{id:{in:ids}}});
    if(regionId) await prisma.region.delete({where:{id:regionId}});
    await prisma.character.deleteMany({where:{userId:{in:users}}}); await prisma.user.deleteMany({where:{id:{in:users}}}); await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
