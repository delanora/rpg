import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { CONDITION_LABELS, conditionAttackMode, deriveConditionEffects, deriveSaveEffects, effectiveMaxHp, effectiveSpeed, mechanicalStateOf, reconcileMovement, resolveRollMode, type Condition, type MechanicalEntity } from '../modules/shared/conditions.js';
import { canSeeAttacker } from '../modules/shared/vision.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import type { MechanicalDto } from '../modules/mechanical/mechanical.service.js';

type Check = (label: string, condition: boolean, detail?: string) => void;
const sample = (...conditions: Condition[]) => mechanicalStateOf({ conditions: conditions.map((condition, index) => ({ id: String(index), condition, appliedAt: 'fixture' })) });

/** Fixtures próprias; sem duração, death engine, mapa ou alteração de contas reais. */
export async function smokeConditions(baseUrl: string, check: Check): Promise<void> {
  console.log('\n63) Fase 6.2 — Conditions e Exhaustion PHB 2014');
  check('63) catálogo tem todas as 14 condições, sem Exhaustion booleana', Object.keys(CONDITION_LABELS).length === 14 && !('exhaustion' in CONDITION_LABELS));
  check('63) Blinded modifica ataques e expõe falha visual futura', conditionAttackMode(sample('blinded'), {}, false, false).disadvantage && conditionAttackMode({}, sample('blinded'), false, false).advantage && deriveConditionEffects(sample('blinded')).sightChecksAutoFail);
  check('63) Deafened só expõe efeito de audição', deriveConditionEffects(sample('deafened')).hearingChecksAutoFail && !conditionAttackMode(sample('deafened'), {}, false, false).disadvantage);
  check('63) Frightened não inventa linha de visão/posição', deriveConditionEffects(sample('frightened')).fearRequiresLineOfSight && !conditionAttackMode(sample('frightened'), {}, false, false).disadvantage);
  for (const condition of ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'] as Condition[]) {
    const effects = deriveConditionEffects(sample(condition));
    check(`63) ${condition} bloqueia Action/Bonus/Reaction por derivação`, effects.incapacitated && !effects.canAct && !effects.canReact && !effects.canBonusAct);
  }
  for (const condition of ['grappled', 'restrained', 'stunned', 'paralyzed', 'petrified', 'unconscious'] as Condition[]) {
    check(`63) ${condition} deriva speed 0`, effectiveSpeed(30, sample(condition)) === 0);
  }
  for (const condition of ['paralyzed', 'petrified', 'stunned', 'unconscious'] as Condition[]) {
    check(`63) ${condition} auto-fail STR/DEX e vantagem contra`, deriveSaveEffects(sample(condition), 'strength').autoFail && deriveSaveEffects(sample(condition), 'dexterity').autoFail && !deriveSaveEffects(sample(condition), 'wisdom').autoFail && conditionAttackMode({}, sample(condition), false, false).advantage);
  }
  check('63) Poisoned modifica ataques/checks', conditionAttackMode(sample('poisoned'), {}, false, false).disadvantage && deriveConditionEffects(sample('poisoned')).checkDisadvantage);
  check('63) Invisible modifica ataques sem Hidden', conditionAttackMode(sample('invisible'), {}, false, false).advantage && conditionAttackMode({}, sample('invisible'), false, false).disadvantage && !deriveConditionEffects(sample('invisible')).active.includes('hidden' as Condition));
  check('63) Restrained: ataques, DEX save, speed', conditionAttackMode(sample('restrained'), {}, false, false).disadvantage && conditionAttackMode({}, sample('restrained'), false, false).advantage && deriveSaveEffects(sample('restrained'), 'dexterity').disadvantage && !deriveSaveEffects(sample('restrained'), 'strength').disadvantage);
  check('63) Prone: desvantagem própria sem inventar distância ao alvo', conditionAttackMode(sample('prone'), {}, false, false).disadvantage && !conditionAttackMode({}, sample('prone'), false, false).advantage && !conditionAttackMode({}, sample('prone'), false, false).disadvantage);
  check('63) proximidade de Paralyzed/Unconscious é flag pendente', deriveConditionEffects(sample('paralyzed')).proximityCritical && deriveConditionEffects(sample('unconscious')).proximityCritical);
  check('63) Unconscious deriva Prone sem death saves', deriveConditionEffects(sample('unconscious')).prone && !('deathSaves' in deriveConditionEffects(sample('unconscious'))));
  check('63) Poisoned contra Restrained cancela vantagem/desvantagem', !conditionAttackMode(sample('poisoned'), sample('restrained'), false, false).advantage && !conditionAttackMode(sample('poisoned'), sample('restrained'), false, false).disadvantage);
  check('63) duas vantagens e uma desvantagem = normal', !resolveRollMode(['a', 'b'], ['c']).advantage && !resolveRollMode(['a', 'b'], ['c']).disadvantage);
  check('63) duas vantagens sem desvantagem = vantagem', resolveRollMode(['a', 'b'], []).advantage);
  check('63) Petrified suspende Poisoned sem apagar sua fonte', deriveConditionEffects(sample('poisoned', 'petrified')).poisonSuspended && !deriveConditionEffects(sample('poisoned', 'petrified')).checkDisadvantage && sample('poisoned', 'petrified').conditions.length === 2);
  const nominal = onTurnStart(30); nominal.movementUsed = 20;
  check('63) Grappled reconciliado zera saldo sem apagar gasto', reconcileMovement(nominal, 30, 0).movementBudget - nominal.movementUsed === 0 && nominal.movementUsed === 20);
  check('63) libertar devolve somente saldo original, nunca novo movimento', reconcileMovement(nominal, 30, 30).movementBudget - nominal.movementUsed === 10);
  for (let level = 0; level <= 6; level += 1) {
    const state = { exhaustionLevel: level }, effects = deriveConditionEffects(state);
    check(`63) Exhaustion ${level}: efeitos cumulativos PHB 2014`, effects.checkDisadvantage === (level >= 1) && effectiveSpeed(30, state) === (level >= 5 ? 0 : level >= 2 ? 15 : 30) && effects.saveDisadvantage === (level >= 3) && effectiveMaxHp(101, state) === (level >= 4 ? 50 : 101) && effects.fatalByExhaustion === (level === 6));
  }

  // Adendo: a Esquiva (Dodge) só impõe desvantagem se o ALVO conseguir VER o
  // atacante. Nunca derivar apenas de o atacante estar Invisível.
  console.log('\n66) Esquiva (Dodge) e visibilidade — o alvo precisa ver o atacante');
  const seesInvisible = (value = true) => mechanicalStateOf({ seesInvisible: value });
  const dodgeCtx = { targetDodging: true };
  const invisibleAttacker = sample('invisible');
  // L. alvo em Esquiva não vê o Invisível → Dodge NÃO adiciona desvantagem (a
  // vantagem do próprio Invisível permanece).
  const dodgeL = conditionAttackMode(invisibleAttacker, sample(), false, false, dodgeCtx);
  check('66) L. Dodge não impõe desvantagem contra atacante Invisível que o alvo não vê', dodgeL.advantage && !dodgeL.disadvantage);
  check('66) alvo Cego (ou alheio) não vê o atacante; alvo normal e atacante visível, sim', !canSeeAttacker(sample('blinded'), {}) && !canSeeAttacker(sample('unconscious'), {}) && canSeeAttacker(sample(), {}) && !canSeeAttacker(sample(), invisibleAttacker));
  // M. alvo tem meio CONFIÁVEL de ver o Invisível → Dodge aplica (cancela a
  // vantagem de Invisible, resultando em rolagem normal).
  const dodgeM = conditionAttackMode(invisibleAttacker, seesInvisible(), false, false, dodgeCtx);
  check('66) M. com estado confiável de visão, Dodge aplica desvantagem normalmente', !dodgeM.advantage && !dodgeM.disadvantage);
  // N. composição normal com outra fonte independente de desvantagem.
  const dodgeN1 = conditionAttackMode(sample('poisoned'), seesInvisible(), false, false, dodgeCtx);
  check('66) N. Dodge soma desvantagem independente (sem vantagem) = desvantagem', dodgeN1.disadvantage && !dodgeN1.advantage);
  const dodgeN2 = conditionAttackMode(sample('invisible', 'poisoned'), seesInvisible(), false, false, dodgeCtx);
  check('66) N. vantagem de Invisible cancela Dodge + desvantagem independente = normal', !dodgeN2.advantage && !dodgeN2.disadvantage);
  // O. atacante deixa de estar Invisível → Dodge volta a valer normalmente.
  const dodgeO = conditionAttackMode({}, seesInvisible(), false, false, dodgeCtx);
  check('66) O. sem Invisible, Dodge impõe desvantagem normalmente', dodgeO.disadvantage && !dodgeO.advantage);
  check('66) Dodge não é inferido fora do contexto (alvo vê, mas não está esquivando)', !conditionAttackMode({}, sample(), false, false).disadvantage);

  const suffix = randomUUID().slice(0, 8), userIds: string[] = [], entityIds: string[] = [];
  let creatureId: string | undefined, npcId: string | undefined, combatId: string | undefined;
  const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'] });
  try {
    const master = await prisma.user.create({ data: { username: `cond_m_${suffix}`, displayName: 'Mestre Condições', passwordHash: 'fixture', role: 'MASTER' } }); userIds.push(master.id);
    const player = await prisma.user.create({ data: { username: `cond_p_${suffix}`, displayName: 'Jogador Condições', passwordHash: 'fixture', role: 'PLAYER' } }); userIds.push(player.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });
    const inventory = inventoryListSchema.parse([
      { id: 'cond-a', name: 'Adaga A', category: 'Arma', slot: 'hand1', details: { weaponType: 'melee', weaponCategory: 'simple', damageDie: 4, damageType: 'Perfurante', properties: ['light', 'finesse'] } },
      { id: 'cond-b', name: 'Adaga B', category: 'Arma', slot: 'hand2', details: { weaponType: 'melee', weaponCategory: 'simple', damageDie: 4, damageType: 'Perfurante', properties: ['light', 'finesse'] } },
    ]);
    const character = await prisma.character.create({ data: { userId: player.id, name: 'Condições Jogador', hpCurrent: 101, hpMax: 101, speed: 30, classes: [{ classKey: 'fighter', level: 5, subclass: '' }], inventory, attacks: [
      { id: 'fire', name: 'Dano fixo fogo', attackBonus: 30, damage: { count: 0, sides: 0, bonus: 9, type: 'Fogo' }, extraDamages: [], finesse: false, ranged: false, notes: '' },
      { id: 'poison', name: 'Dano fixo veneno', attackBonus: 30, damage: { count: 0, sides: 0, bonus: 9, type: 'Veneno' }, extraDamages: [], finesse: false, ranged: false, notes: '' },
    ] } }); entityIds.push(character.id);
    const creature = await prisma.creature.create({ data: { name: 'Goblin Template Condições', hpCurrent: 1000, hpMax: 1000, speed: 9, vulnerabilities: ['Fogo'] } }); creatureId = creature.id; entityIds.push(creature.id);
    const npc = await prisma.creature.create({ data: { name: 'NPC persistente Condições', kind: 'NPC', hpCurrent: 80, hpMax: 80, speed: 9 } }); npcId = npc.id; entityIds.push(npc.id);
    const ownEntity: MechanicalEntity = { kind: 'character', id: character.id };
    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json() as any };
    }
    const read = async (entity = ownEntity, token = masterToken) => (await request(`/mechanical/${entity.kind}/${entity.id}`, undefined, token)).data.mechanical as MechanicalDto;
    async function mutation(entity: MechanicalEntity, extra: Record<string, unknown>, token = masterToken) {
      const current = await read(entity);
      return request('/mechanical/mutate', { entity: current.entity, expectedVersion: current.version, expectedCombatVersion: current.combat?.version, operationId: randomUUID(), ...extra }, token);
    }
    const apply = async (condition: string, entity = ownEntity, extra: Record<string, unknown> = {}) => mutation(entity, { action: 'apply', condition, ...extra });
    const remove = async (instanceId: string, entity = ownEntity) => mutation(entity, { action: 'remove', instanceId });
    const clear = async (entity = ownEntity) => {
      for (const instance of (await read(entity)).state.conditions) await remove(instance.id, entity);
    };
    const exhaust = async (level: number, entity = ownEntity) => mutation(entity, { action: 'exhaustion', exhaustionLevel: level });
    await apply('poisoned', ownEntity, { sourceLabel: 'Fonte A' });
    await apply('poisoned', ownEntity, { sourceLabel: 'Fonte B' });
    let own = await read();
    check('63) Poisoned fora de combate tem duas fontes persistentes', own.state.conditions.length === 2 && own.effects.attackDisadvantages.includes('poisoned'));
    await remove(own.state.conditions[0].id); own = await read();
    check('63) remover A preserva B', own.state.conditions.length === 1 && own.state.conditions[0].sourceLabel === 'Fonte B');
    await remove(own.state.conditions[0].id);
    check('63) remover última fonte termina Poisoned', !(await read()).effects.active.includes('poisoned'));
    const current = await read();
    check('63) PLAYER não aplica condição arbitrária', (await request('/mechanical/mutate', { entity: ownEntity, action: 'apply', condition: 'poisoned', expectedVersion: current.version, operationId: randomUUID() }, playerToken)).status === 403);
    check('63) PLAYER não zera Exaustão', (await mutation(ownEntity, { action: 'exhaustion', exhaustionLevel: 0 }, playerToken)).status === 403);
    const applied = await apply('poisoned');
    check('63) PLAYER não remove Poisoned', (await mutation(ownEntity, { action: 'remove', instanceId: applied.data.mechanical.state.conditions[0].id }, playerToken)).status === 403);
    await clear();
    const npcApplied = await apply('poisoned', { kind: 'creature', id: npc.id });
    check('63) NPC persistente usa mesma API e domínio', npcApplied.status === 200 && npcApplied.data.mechanical.state.conditions[0].condition === 'poisoned');
    await apply('poisoned', { kind: 'creature', id: creature.id }, { sourceLabel: 'Origem do template' });

    // Inicia pelo endpoint real: comprova snapshot independente em cada cópia.
    const started = await request('/combat', { entries: [{ creatureId: creature.id, quantity: 2 }, { creatureId: npc.id, quantity: 1 }] });
    if (started.status !== 201) throw new Error(`Não iniciou combate de condições: ${JSON.stringify(started.data)}`);
    let combat = started.data.combat as CombatDto; combatId = combat.id;
    const playerCombatant = combat.combatants.find(item => item.characterId === character.id)!;
    const copies = combat.combatants.filter(item => item.creatureId === creature.id);
    entityIds.push(...copies.map(item => item.id));
    const copyA: MechanicalEntity = { kind: 'combatant', id: copies[0].id }, copyB: MechanicalEntity = { kind: 'combatant', id: copies[1].id };
    check('63) cópias recebem fontes iniciais com IDs próprios', copies.every(item => item.mechanicalState.conditions.length === 1) && copies[0].mechanicalState.conditions[0].id !== copies[1].mechanicalState.conditions[0].id);
    const copySource = (await read(copyA)).state.conditions[0].id;
    await remove(copySource, copyA);
    check('63) remover fonte de Goblin 1 não afeta Goblin 2/template', !(await read(copyA)).effects.active.includes('poisoned') && (await read(copyB)).effects.active.includes('poisoned') && (await read({ kind: 'creature', id: creature.id })).effects.active.includes('poisoned'));
    await clear(copyB);
    const npcParticipant = combat.combatants.find(item => item.creatureId === npc.id)!;
    socket.auth = { token: masterToken };
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const initiativeNotice = new Promise<any>(resolve => {
      const timer = setTimeout(() => { socket.off('dice:rolled', handler); resolve(null); }, 4000);
      const handler = (payload: any) => { if (payload.kind !== 'initiative' || payload.actorName !== npc.name) return; clearTimeout(timer); socket.off('dice:rolled', handler); resolve(payload); };
      socket.on('dice:rolled', handler);
    });
    await request(`/combat/initiative/${npcParticipant.id}`, {});
    const initiative = await initiativeNotice;
    check('63) iniciativa é check: NPC Poisoned rola 2d20 e mantém menor', Boolean(initiative && initiative.rolls.length === 2 && initiative.total === Math.min(...initiative.rolls) + initiative.modifier));
    socket.disconnect();
    for (const participant of combat.combatants.filter(item => !item.rolled && item.id !== npcParticipant.id)) await request(`/combat/initiative/${participant.id}`, {});
    const refreshCombat = async () => { combat = (await request('/combat/active')).data.combat; return combat; };
    await refreshCombat();
    async function toOwnTurn() {
      await refreshCombat();
      for (let i = 0; combat.currentCombatantId !== playerCombatant.id && i <= combat.combatants.length; i += 1) {
        const next = await request('/combat/next-turn', { combatId, expectedVersion: combat.version, operationId: randomUUID() });
        if (next.status !== 200) throw new Error(`Falha no avanço: ${JSON.stringify(next.data)}`);
        combat = next.data.combat;
      }
    }
    async function override(adjustment = 'restore-action', extra: Record<string, unknown> = {}) {
      await refreshCombat();
      const res = await request('/combat/economy/override', { combatId, expectedVersion: combat.version, operationId: randomUUID(), combatantId: playerCombatant.id, adjustment, reason: 'Preparação explícita do smoke 6.2', ...extra });
      if (res.data.combat) combat = res.data.combat;
      return res;
    }
    async function action(action: string, extra: Record<string, unknown> = {}) {
      await refreshCombat();
      const res = await request('/combat/action', { combatId, expectedVersion: combat.version, operationId: randomUUID(), combatantId: playerCombatant.id, action, ...extra }, playerToken);
      if (res.data.combat) combat = res.data.combat;
      return res;
    }
    async function attack(extra: Record<string, unknown> = {}) {
      await refreshCombat();
      const res = await request('/combat/attack', { combatId, expectedVersion: combat.version, operationId: randomUUID(), attackId: 'fire', targetCombatantId: copyA.id, ...extra }, playerToken);
      if (res.data.combat) combat = res.data.combat;
      return res;
    }
    async function hit(extra: Record<string, unknown> = {}) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await override();
        const res = await attack(extra);
        if (res.status !== 200) return res;
        if (res.data.result.hit && res.data.result.attackRoll < 20) return res;
      }
      throw new Error('Não obteve acerto no treino de dano fixo.');
    }
    await toOwnTurn();
    await action('move', { distance: 20 });
    await apply('grappled'); await refreshCombat();
    let budget = combat.combatants.find(item => item.id === playerCombatant.id)!.turnEconomy;
    check('63) Grappled durante turno zera remaining sem apagar movementUsed', budget.movementUsed === 20 && budget.movementBudget - budget.movementUsed === 0 && (await action('move', { distance: 1 })).status === 409);
    await clear(); await refreshCombat(); budget = combat.combatants.find(item => item.id === playerCombatant.id)!.turnEconomy;
    check('63) remover Grappled preserva 20 gastos e só 10 restantes', budget.movementUsed === 20 && budget.movementBudget - budget.movementUsed === 10);
    await override('set-movement', { remaining: 30 });
    await apply('prone');
    const beforeStand = (await refreshCombat()).combatants.find(item => item.id === playerCombatant.id)!.turnEconomy;
    const stood = await mutation(ownEntity, { action: 'stand' }, playerToken);
    const afterStand = (await refreshCombat()).combatants.find(item => item.id === playerCombatant.id)!.turnEconomy;
    check('63) levantar usa metade speed, sem Action/Bonus', stood.status === 200 && afterStand.movementUsed - beforeStand.movementUsed === 15 && afterStand.actionsUsed === beforeStand.actionsUsed && afterStand.bonusActionUsed === beforeStand.bonusActionUsed && !(await read()).effects.prone);
    await apply('prone'); await override('set-movement', { remaining: 10 });
    check('63) movimento insuficiente não levanta', (await mutation(ownEntity, { action: 'stand' }, playerToken)).status === 409 && (await read()).effects.prone);
    await clear(); await override('set-movement', { remaining: 30 });
    await override(); await attack({ attackId: 'weapon:cond-a' });
    await override(); await action('ready', { trigger: 'Sinal', intent: 'Atacar' });
    await override();
    await apply('incapacitated');
    check('63) Incapacitated isolado não bloqueia Movement', (await action('move', { distance: 1 })).status === 200);
    check('63) Incapacitated bloqueia Action HTTP', (await action('hide')).status === 409);
    check('63) Incapacitated bloqueia Reaction HTTP', (await attack({ prepared: true })).status === 409);
    check('63) Incapacitated bloqueia Bonus HTTP', (await attack({ attackId: 'offhand:cond-b' })).status === 409);
    await clear(); await override();
    await apply('poisoned'); const poisoned = await attack();
    check('63) ataque real Poisoned tem disadvantage', poisoned.status === 200 && poisoned.data.result.disadvantage && !poisoned.data.result.advantage);
    await apply('restrained', copyA); await override(); const cancel = await attack();
    check('63) Poisoned contra Restrained real cancela', cancel.status === 200 && !cancel.data.result.disadvantage && !cancel.data.result.advantage);
    await clear(); await clear(copyA); await apply('invisible'); await override(); const invisible = await attack();
    check('63) atacante Invisible real tem advantage, sem Hidden', invisible.status === 200 && invisible.data.result.advantage && !(await read()).effects.active.includes('hidden' as Condition));
    await clear(); await apply('invisible', copyA); await override(); const vsInvisible = await attack();
    check('63) alvo Invisible real impõe disadvantage', vsInvisible.status === 200 && vsInvisible.data.result.disadvantage);
    await clear(copyA); await apply('charmed', ownEntity, { sourceEntity: copyA }); await override();
    check('63) Charmed bloqueia atacar fonte conhecida', (await attack()).status === 409);
    check('63) Charmed não confunde outra cópia com o charmer', (await attack({ targetCombatantId: copyB.id })).status === 200);
    await clear();
    const heldBefore = (await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).inventory;
    await apply('unconscious'); own = await read();
    check('63) Unconscious registra queda/objetos sem mover inventário', own.effects.prone && own.effects.incapacitated && own.state.log.some(entry => entry.message.includes('manualmente pelo Mestre')) && JSON.stringify((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).inventory) === JSON.stringify(heldBefore));
    check('63) Unconscious sem duplicar Incapacitated persistido', !own.state.conditions.some(instance => instance.condition === 'incapacitated'));
    await remove(own.state.conditions.find(instance => instance.condition === 'unconscious')!.id);
    check('63) acordar não levanta automaticamente', (await read()).effects.prone);
    await clear();
    await apply('paralyzed', copyA); const paralyzed = await hit();
    check('63) Paralyzed real dá vantagem, sem inventar crítico por alcance', paralyzed.status === 200 && paralyzed.data.result.advantage && paralyzed.data.result.critical === (paralyzed.data.result.attackRoll >= 20));
    await clear(copyA);
    await apply('poisoned', copyA); await apply('petrified', copyA);
    const stone = await hit();
    check('63) Petrified compõe resistência antes de vulnerabilidade: 9 → 4 → 8', stone.status === 200 && stone.data.result.components[0].rolled === 9 && stone.data.result.components[0].applied === 8 && stone.data.result.components[0].modifier === 'resistance-vulnerability');
    const poisonImmune = await hit({ attackId: 'poison' });
    check('63) Petrified imuniza dano Veneno', poisonImmune.status === 200 && poisonImmune.data.result.damageRolled === 0 && poisonImmune.data.result.components[0].modifier === 'immunity');
    check('63) Petrified rejeita nova fonte de Poisoned', (await apply('poisoned', copyA)).status === 409);
    let stoneState = await read(copyA);
    await remove(stoneState.state.conditions.find(instance => instance.condition === 'petrified')!.id, copyA);
    check('63) remover Petrified reativa veneno suspenso', (await read(copyA)).effects.attackDisadvantages.includes('poisoned'));
    await clear(copyA);
    await apply('stunned');
    const save = await request('/dice/roll', { dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', entity: ownEntity, label: 'Salvaguarda DEX', bonus: 100 }, playerToken);
    check('63) save real STR/DEX auto-fail sem rolar mesmo com bônus alto', save.status === 201 && save.data.roll.autoFail === true && save.data.roll.dice.length === 0 && save.data.roll.total === 0);
    await clear(); await apply('restrained');
    const dexSave = await request('/dice/roll', { dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', entity: ownEntity }, playerToken);
    check('63) save real Restrained DEX tem disadvantage', dexSave.status === 201 && dexSave.data.roll.disadvantage && dexSave.data.roll.dice.length === 2);
    await clear();
    await exhaust(1);
    const skill = await request('/dice/roll', { dice: [{ sides: 20 }], kind: 'skill', label: 'Teste de habilidade' }, playerToken);
    check('63) Exhaustion 1 aplica desvantagem em check real', skill.status === 201 && skill.data.roll.disadvantage);
    await exhaust(2); await refreshCombat();
    check('63) Exhaustion 2 efetivo 15 e saldo nunca negativo', (await read()).effectiveSpeed === 15 && combat.combatants.find(item => item.id === playerCombatant.id)!.turnEconomy.movementBudget >= combat.combatants.find(item => item.id === playerCombatant.id)!.turnEconomy.movementUsed);
    await override('set-movement', { remaining: 5 });
    await exhaust(0); await refreshCombat();
    const adminBudget = combat.combatants.find(item => item.id === playerCombatant.id)!.turnEconomy;
    check('63) remover half speed não multiplica ajuste de Movement do Mestre', adminBudget.movementBudget - adminBudget.movementUsed === 5);
    await exhaust(3); await override(); const tiredAttack = await attack();
    const tiredSave = await request('/dice/roll', { dice: [{ sides: 20 }], kind: 'save', ability: 'wisdom', entity: ownEntity }, playerToken);
    check('63) Exhaustion 3 afeta ataques/saves reais', tiredAttack.status === 200 && tiredAttack.data.result.disadvantage && tiredSave.status === 201 && tiredSave.data.roll.disadvantage);
    await exhaust(4); own = await read();
    const stored = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    check('63) Exhaustion 4 deriva half max (floor) e clampa HP sem destruir base', own.effectiveMaxHp === 50 && stored.hpCurrent === 50 && stored.hpMax === 101);
    const patch = await fetch(`${baseUrl}/api/characters/${character.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` }, body: JSON.stringify({ hpCurrent: 101 }) });
    check('63) PATCH HP respeita max efetivo', patch.status === 200 && (await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).hpCurrent === 50);
    const hp = await request('/combat/hp', { combatantId: playerCombatant.id, amount: 100, mode: 'heal' });
    check('63) cura de combate respeita max efetivo', hp.status === 200 && (await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).hpCurrent === 50);
    await exhaust(5); check('63) Exhaustion 5 zera Movement', (await action('move', { distance: 1 })).status === 409);
    await exhaust(6); own = await read();
    check('63) Exhaustion 6 sinaliza fatal sem 0 HP/death engine', own.effects.fatalByExhaustion && own.hpCurrent === 50 && !('dead' in own.state));
    check('63) Exhaustion não ultrapassa 6', (await mutation(ownEntity, { action: 'exhaustion', exhaustionDelta: 1 })).status === 400 && (await read()).state.exhaustionLevel === 6);
    await exhaust(0); check('63) reduzir Exhaustion não cura automaticamente HP', (await read()).effectiveMaxHp === 101 && (await read()).hpCurrent === 50);

    // Atomicidade, retry e concorrência na mutação própria (fora e dentro do combate).
    const beforeApply = await read();
    const same = { entity: ownEntity, action: 'apply', condition: 'poisoned', sourceLabel: 'Retry', expectedVersion: beforeApply.version, expectedCombatVersion: beforeApply.combat?.version, operationId: randomUUID() };
    const race = await Promise.all([request('/mechanical/mutate', same), request('/mechanical/mutate', same)]);
    check('63) retry concorrente aplica somente uma fonte', race.every(res => res.status === 200) && race.filter(res => res.data.replayed).length === 1 && (await read()).state.conditions.length === 1);
    check('63) chave reutilizada com outro payload rejeita', (await request('/mechanical/mutate', { ...same, condition: 'blinded' })).status === 409);
    const aliasState = await read();
    check('63) alias do combatente não burla operationId da ficha', (await request('/mechanical/mutate', { ...same, entity: { kind: 'combatant', id: playerCombatant.id }, expectedVersion: aliasState.version, expectedCombatVersion: aliasState.combat?.version })).status === 409);
    const latest = await read();
    const conflicting = await Promise.all([
      request('/mechanical/mutate', { ...same, operationId: randomUUID(), expectedVersion: latest.version, expectedCombatVersion: latest.combat?.version, condition: 'blinded' }),
      request('/mechanical/mutate', { ...same, operationId: randomUUID(), expectedVersion: latest.version, expectedCombatVersion: latest.combat?.version, condition: 'deafened' }),
    ]);
    check('63) versões concorrentes aceitam só uma escrita', conflicting.filter(res => res.status === 200).length === 1 && conflicting.filter(res => res.status === 409).length === 1);
    await clear();
    socket.auth = { token: playerToken };
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const notification = new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), 4000); socket.once('mechanical:updated', payload => { clearTimeout(timer); resolve(payload.mechanical.state.conditions.some((instance: { condition: string }) => instance.condition === 'poisoned')); }); });
    await apply('poisoned'); check('63) realtime pelo socket existente', await notification);
    socket.disconnect();
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    check('63) refresh/reconnect mantém condições', (await read(ownEntity, playerToken)).state.conditions.some(instance => instance.condition === 'poisoned'));
    await request('/combat/end', {});
    check('63) encerrar combate preserva condição da ficha', (await read()).state.conditions.some(instance => instance.condition === 'poisoned'));
    await apply('poisoned', copyA, { sourceLabel: 'Estado da instância após combate' });
    check('63) instância encerrada persiste sem copiar para template', (await read(copyA)).state.conditions.some(instance => instance.sourceLabel === 'Estado da instância após combate') && !(await read({ kind: 'creature', id: creature.id })).state.conditions.some(instance => instance.sourceLabel === 'Estado da instância após combate'));
    check('63) ações administrativas criam log explícito', (await read()).state.log.some(entry => entry.message.includes('Exaustão')) && (await read()).state.log.some(entry => entry.message.includes('removido')));
  } finally {
    socket.disconnect();
    if (combatId) {
      const participants = await prisma.combatant.findMany({ where: { combatId }, select: { id: true } }); entityIds.push(...participants.map(item => item.id));
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    if (creatureId) await prisma.creature.deleteMany({ where: { id: creatureId } });
    if (npcId) await prisma.creature.deleteMany({ where: { id: npcId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
