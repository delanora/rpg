/** Composição e economia de Ataques Múltiplos, sem banco nem sorte. */
import assert from 'node:assert/strict';
import { creatureAbilitySchema } from '../modules/shared/creature-abilities.js';
import { beginMultiattack, recordMultiattack } from '../modules/shared/multiattack.js';
import { onTurnStart, onTurnEnd, economyOf } from '../modules/shared/action-economy.js';
const ability=creatureAbilitySchema.parse({id:'multiple',name:'Ataques Múltiplos',cost:'action',execution:'multiattack',multiattack:[{attackId:'bite',count:1},{attackId:'claw',count:2}]});
const attacks=[{id:'bite',name:'Mordida'},{id:'claw',name:'Garra'}];
const state=onTurnStart(9);
beginMultiattack(state,ability,attacks,'sequence');
assert.equal(state.actionsUsed,1);assert.equal(state.attackAction,null);assert.equal(state.multiattack!.total,3);
assert.throws(()=>beginMultiattack(state,ability,attacks,'another'));
recordMultiattack(state,'sequence','claw');
recordMultiattack(state,'sequence','bite');
assert.throws(()=>recordMultiattack(state,'sequence','bite'));
assert.throws(()=>recordMultiattack(state,'wrong','claw'));
const reconnected=economyOf(JSON.parse(JSON.stringify(state)));
recordMultiattack(reconnected,'sequence','claw');assert.equal(reconnected.multiattack!.performed,3);assert.equal(reconnected.actionsUsed,1);
assert.throws(()=>recordMultiattack(reconnected,'sequence','claw'));
onTurnEnd(state);assert.equal(state.multiattack,null);assert.equal(state.actionsUsed,1);
const missing=onTurnStart(9);assert.throws(()=>beginMultiattack(missing,ability,[], 'invalid'));assert.equal(missing.actionsUsed,0);
for(const override of [{cost:'reaction'},{cost:'bonus-action'},{multiattack:[]},{multiattack:[{attackId:'bite',count:1}]},{multiattack:[{attackId:'bite',count:2},{attackId:'bite',count:2}]},{multiattack:[{attackId:'bite',count:21}]}])
 assert.equal(creatureAbilitySchema.safeParse({...ability,...override}).success,false);
console.log('✔ Composição, ordem livre, orçamento por golpe, persistência, cancelamento do turno e uma única Ação.');
