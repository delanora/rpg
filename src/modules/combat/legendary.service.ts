import { beginCreatureAreaUse, publishCreatureAreaUse } from './creature-area.service.js';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { creatureAbilitiesOf } from '../shared/creature-abilities.js';
import { legendaryStateOf, legendaryWindowOf } from '../shared/legendary-actions.js';
import { deathBlocksActions } from '../shared/death.js';
import { deriveConditionEffects } from '../shared/conditions.js';
import { combatantDeathState, combatantMechanicalState, toCombatDto, type CombatSourced, type CombatantSourced } from './combat.dto.js';
import { appendEconomyLog, loadCombatById, resolveAttack, runCombatOperation, replayCombatOperation, type CombatActor } from './combat.service.js';
import type { legendaryUseSchema, legendaryPassSchema, legendarySurpriseSchema } from './combat.schema.js';

export function canUseLegendary(unit:CombatantSourced):boolean {
 const state=legendaryStateOf(unit.legendaryState);
 return Boolean(unit.creature && !unit.character && unit.initiative!==null && (unit.hpCurrent??unit.creature.hpCurrent)>0 && !deathBlocksActions(combatantDeathState(unit)) && deriveConditionEffects(combatantMechanicalState(unit)).canAct && (!state.surprised||state.firstTurnEnded));
}
export function legendaryCandidates(combat:CombatSourced,outgoingId:string):CombatantSourced[] {
 return combat.combatants.filter(unit=>unit.id!==outgoingId && canUseLegendary(unit) && creatureAbilitiesOf(unit.creature?.abilities).some(ability=>ability.cost==='legendary' && (ability.legendaryCost??Infinity)<=unit.creature!.legendaryActionsMax-legendaryStateOf(unit.legendaryState).used));
}
function requireMaster(actor:CombatActor) {if(actor.role!=='MASTER')throw new HttpError('Somente o Mestre decide Ações Lendárias.',403,'FORBIDDEN');}
function requireWindow(combat:CombatSourced,id:string,unitId:string) {
 const window=legendaryWindowOf(combat.legendaryWindow);
 if(!window||window.id!==id||window.turnSequence!==combat.turnSequence||!window.candidateIds.includes(unitId)||window.decidedIds.includes(unitId))throw new HttpError('Esta janela lendária já foi decidida ou não está disponível.',409,'LEGENDARY_WINDOW_INVALID');
 return window;
}
async function chargeLegendary(db:Prisma.TransactionClient,combat:CombatSourced,input:z.infer<typeof legendaryUseSchema>) {
 const window=requireWindow(combat,input.windowId,input.combatantId);
 const unit=combat.combatants.find(c=>c.id===input.combatantId);
 const ability=creatureAbilitiesOf(unit?.creature?.abilities).find(a=>a.id===input.abilityId&&a.cost==='legendary');
 if(!unit||!ability||unit.id===window.outgoingId||!canUseLegendary(unit))throw new HttpError('A criatura não pode usar esta Ação Lendária.',409,'LEGENDARY_UNAVAILABLE');
 const state=legendaryStateOf(unit.legendaryState),cost=ability.legendaryCost!;
 if(state.used+cost>unit.creature!.legendaryActionsMax)throw new HttpError('Saldo de Ações Lendárias insuficiente.',409,'LEGENDARY_BUDGET_EXHAUSTED');
 state.used+=cost;window.decidedIds.push(unit.id);
 await db.combatant.update({where:{id:unit.id},data:{legendaryState:state}});
 await db.combat.update({where:{id:combat.id},data:{legendaryWindow:window}});
 combat.legendaryWindow=window;
 await appendEconomyLog(db,combat,unit,ability.description?`${ability.name}: ${ability.description}`:ability.name,'legendary-action',{private:unit.spatialVisibility==='master-only'});
 return ability;
}
export async function useLegendaryAction(actor:CombatActor,input:z.infer<typeof legendaryUseSchema>) {
 requireMaster(actor);
 const replay=await replayCombatOperation(actor,input,'legendary-use');if(replay)return replay;
 const current=await loadCombatById(input.combatId);
 const unit=current.combatants.find(c=>c.id===input.combatantId);
 const definition=creatureAbilitiesOf(unit?.creature?.abilities).find(a=>a.id===input.abilityId&&a.cost==='legendary');
 if(definition?.execution==='legendary-attack') {
  if(!input.targetCombatantId)throw new HttpError('Escolha o alvo do ataque lendário.',400,'LEGENDARY_TARGET_REQUIRED');
  const attackId=definition.legendaryAttackId!;
  return resolveAttack(actor,{...input,attackerCombatantId:input.combatantId,attackId,targetCombatantId:input.targetCombatantId},{operationType:'legendary-use',operationInput:input,legendaryAction:true,beforeAttack:async({db,combat})=>{
   const ability=await chargeLegendary(db,combat,input);
   if(ability.execution!=='legendary-attack'||ability.legendaryAttackId!==attackId)throw new HttpError('O cadastro mudou. Atualize a janela lendária.',409,'CONFLICT');
  }});
 }
 if(definition?.execution==='area-save-damage') {
  const result=await runCombatOperation(actor,input,'legendary-use',async(db,combat)=>{
   const ability=await chargeLegendary(db,combat,input);
   if(ability.execution!=='area-save-damage'||!input.areaPlacement)throw new HttpError('Posicione a área da opção lendária.',400,'AREA_PLACEMENT_REQUIRED');
   const source=combat.combatants.find(c=>c.id===input.combatantId)!;
   const areaUseId=await beginCreatureAreaUse(db,combat,source,ability,input.areaPlacement);
   return {combat:toCombatDto(await loadCombatById(combat.id,db),'MASTER'),areaUseId};
  });
  await publishCreatureAreaUse(result.areaUseId);return result;
 }
 if(!input.confirmed)throw new HttpError('Confirme a resolução assistida desta opção lendária.',400,'LEGENDARY_CONFIRMATION_REQUIRED');
 return runCombatOperation(actor,input,'legendary-use',async(db,combat)=>{
  const ability=await chargeLegendary(db,combat,input);
  if(ability.execution!=='assisted')throw new HttpError('Esta opção exige o ataque cadastrado.',409,'CONFLICT');
  return {combat:toCombatDto(await loadCombatById(combat.id,db),'MASTER')};
 });
}
export async function passLegendaryAction(actor:CombatActor,input:z.infer<typeof legendaryPassSchema>) {
 requireMaster(actor);
 return runCombatOperation(actor,input,'legendary-pass',async(db,combat)=>{
  const window=requireWindow(combat,input.windowId,input.combatantId);window.decidedIds.push(input.combatantId);
  await db.combat.update({where:{id:combat.id},data:{legendaryWindow:window}});
  return {combat:toCombatDto(await loadCombatById(combat.id,db),'MASTER')};
 });
}
export async function setLegendarySurprise(actor:CombatActor,input:z.infer<typeof legendarySurpriseSchema>) {
 requireMaster(actor);
 return runCombatOperation(actor,input,'legendary-config',async(db,combat)=>{
  const unit=combat.combatants.find(c=>c.id===input.combatantId&&c.creature&&!c.character);
  if(!unit)throw new HttpError('Criatura não encontrada.',404,'NOT_FOUND');
  const state=legendaryStateOf(unit.legendaryState);
  if(state.firstTurnEnded)throw new HttpError('O primeiro turno desta criatura já terminou.',409,'CONFLICT');
  await db.combatant.update({where:{id:unit.id},data:{legendaryState:{...state,surprised:input.surprised}}});
  return {combat:toCombatDto(await loadCombatById(combat.id,db),'MASTER')};
 });
}
