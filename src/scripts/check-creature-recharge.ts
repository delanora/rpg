/** Invariantes de recarga, sem banco e sem depender da sorte. */
import assert from 'node:assert/strict';
import { creatureAbilitySchema, rechargeCreatureAbilities } from '../modules/shared/creature-abilities.js';
const ability = { id: 'sopro', name: 'Sopro', cost: 'action', maxUses: 1, recharge: { minimum: 5 } };
for (let roll = 1; roll <= 6; roll++) {
  const original = { sopro: 1, outro: 2 };
  const result = rechargeCreatureAbilities([ability], original, () => roll);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].restored, roll >= 5);
  assert.equal(result.uses.sopro, roll >= 5 ? 0 : 1);
  assert.deepEqual(original, { sopro: 1, outro: 2 });
  assert.equal(result.uses.outro, 2);
}
const never = () => { throw Error('Habilidade disponível ou sem recarga não deve rolar'); };
assert.equal(rechargeCreatureAbilities([ability], {}, never).results.length, 0);
assert.equal(rechargeCreatureAbilities([{ ...ability, recharge: undefined }], { sopro: 1 }, never).results.length, 0);
for (const invalid of [{minimum: 0}, {minimum: 7}, {minimum: 5.5}])
  assert.equal(creatureAbilitySchema.safeParse({...ability, recharge: invalid}).success, false);
for (const maxUses of [null, 2])
  assert.equal(creatureAbilitySchema.safeParse({...ability, maxUses}).success, false);
assert.equal(creatureAbilitySchema.safeParse({...ability, cost: 'passive'}).success, false);
assert.equal(creatureAbilitySchema.safeParse({...ability, recharge: undefined, maxUses: null}).success, true);
assert.equal(rechargeCreatureAbilities([{...ability, recharge:{minimum:1}}], {sopro:1},()=>1).uses.sopro,0);
console.log('✔ Recarga: seis faces, limites, compatibilidade, ausência de rolagens extras e estado independente.');
