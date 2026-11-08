/** Alcances compartilham o mesmo derivador da ficha, hotbar e combate. Sem I/O. */
import assert from 'node:assert/strict';
import { deriveWeaponAttacks, type WeaponInventoryItem } from '../modules/shared/weapon-attacks.js';
import { weaponRangeOf } from '../modules/shared/weapon-range.js';
import { sanitizeItemDetails } from '../modules/shared/item-details.js';
const abilities={strength:14,dexterity:14,constitution:10,intelligence:10,wisdom:10,charisma:10};
const attacks=(inventory:WeaponInventoryItem[])=>deriveWeaponAttacks({abilities,level:1,weaponProficiencies:[],inventory});
const unarmed=attacks([]).find(a=>a.id==='unarmed')!;
assert.equal(unarmed.reachFeet,5);assert.equal(unarmed.ranged,false);assert.equal(unarmed.damage.bonus,3);
console.log('✔ Golpe desarmado deriva alcance de 5 pés, inclusive sem arma');
const bow:WeaponInventoryItem={id:'bow',name:'Arco',slot:'hand1',category:'Arma',details:{weaponType:'ranged',properties:['two-handed'],rangeNormal:45,rangeLong:180,damageCount:1,damageDie:8,damageType:'Perfurante'}};
assert.equal(attacks([bow]).find(a=>a.id==='unarmed')?.reachFeet,5);
assert.equal(attacks([bow]).find(a=>a.id==='weapon:bow')?.reachFeet,undefined);
console.log('✔ Arco não concede alcance corpo a corpo; golpe desarmado permanece uma opção');
assert.equal(weaponRangeOf({weaponType:'melee'},'melee')?.reachFeet,5);
assert.equal(weaponRangeOf({weaponType:'melee',properties:['reach']},'melee')?.reachFeet,10);
assert.equal(weaponRangeOf({weaponType:'melee',properties:['thrown'],rangeNormal:6,rangeLong:18},'melee')?.reachFeet,5);
assert.equal(weaponRangeOf({weaponType:'melee',properties:['thrown'],rangeNormal:6,rangeLong:18},'ranged')?.normalRangeFeet,20);
console.log('✔ Arremesso não se transforma em alcance corpo a corpo');
for(const category of ['Arma','Cajado']) {
 const details=sanitizeItemDetails(category,{weaponType:'melee',meleeReachFeet:15});
 assert.equal(details.meleeReachFeet,15);assert.equal(weaponRangeOf(details,'melee')?.reachFeet,15);
}
assert.equal(weaponRangeOf({weaponType:'melee',meleeReachFeet:2.5},'melee')?.reachFeet,2.5);
assert.equal(weaponRangeOf({weaponType:'melee',rangeNormal:3},'melee')?.reachFeet,10);
console.log('✔ Alcance explícito é preservado no item e o legado sem arremesso mantém a leitura anterior');
