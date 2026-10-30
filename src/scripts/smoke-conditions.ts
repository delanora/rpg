import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { CONDITION_LABELS, conditionAttackMode, deriveConditionEffects, deriveSaveEffects, dodgeBenefitAvailable, effectiveMaxHp, effectiveSpeed, mechanicalStateOf, reconcileMovement, resolveRollMode, type Condition, type MechanicalEntity } from '../modules/shared/conditions.js';
import { canSeeAttacker } from '../modules/shared/vision.js';
import { addHpZeroUnconscious, HP_ZERO_PRONE_LABEL } from '../modules/shared/death.js';
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
  check('63) Prone: desvantagem própria continua (ataques do caído)', conditionAttackMode(sample('prone'), {}, false, false).disadvantage);
  // PRONE (PHB 2014) — aproximação aprovada sem geometria: MELEE = atacante a
  // até 1,5 m → vantagem; RANGED = fora de 1,5 m → desvantagem. A composição é
  // a normal (uma fonte de cada lado cancela; nunca "double").
  const proneMelee = conditionAttackMode({}, sample('prone'), false, false, { attackRanged: false });
  const proneRanged = conditionAttackMode({}, sample('prone'), false, false, { attackRanged: true });
  check('65.G) alvo Caído + ataque CORPO A CORPO = vantagem', proneMelee.advantage && !proneMelee.disadvantage);
  check('65.H) alvo Caído + ataque À DISTÂNCIA = desvantagem', proneRanged.disadvantage && !proneRanged.advantage);
  const proneMeleeOtherDisadvantage = conditionAttackMode({}, sample('prone', 'invisible'), false, false, { attackRanged: false });
  check('65.I) vantagem (Caído melee) + outra desvantagem = rolagem normal', !proneMeleeOtherDisadvantage.advantage && !proneMeleeOtherDisadvantage.disadvantage);
  const proneRangedOtherAdvantage = conditionAttackMode({}, sample('prone', 'restrained'), false, false, { attackRanged: true });
  check('65.J) desvantagem (Caído ranged) + outra vantagem = rolagem normal', !proneRangedOtherAdvantage.advantage && !proneRangedOtherAdvantage.disadvantage);
  const proneTwoAdvantages = conditionAttackMode({}, sample('prone', 'restrained'), false, false, { attackRanged: false });
  check('65.K) múltiplas vantagens continuam apenas vantagem', proneTwoAdvantages.advantage && !proneTwoAdvantages.disadvantage);
  const proneTwoDisadvantages = conditionAttackMode({}, sample('prone', 'invisible'), false, false, { attackRanged: true });
  check('65.L) múltiplas desvantagens continuam apenas desvantagem', proneTwoDisadvantages.disadvantage && !proneTwoDisadvantages.advantage);
  check('65.M) Caído não vira tipo de dano: só o MODO do ataque decide', conditionAttackMode({}, sample('prone'), false, false, { attackRanged: false }).advantage && conditionAttackMode({}, sample('prone'), false, false, { attackRanged: true }).disadvantage);
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

  // HOTFIX da Esquiva (PHB 2014): os benefícios só valem com a criatura apta a
  // agir e com deslocamento EFETIVO > 0. `movementRemaining` não é deslocamento.
  console.log('\n68) Esquiva (Dodge): validade, composição e salvaguarda de Destreza');
  const dodgeValid = { dodging: true, mechanicalState: sample(), effectiveSpeed: 30 };
  check('68.A) Esquiva sem Incapacitated e com deslocamento > 0 vale', dodgeBenefitAvailable(dodgeValid));
  check('68.B) Incapacitated suspende a Esquiva', !dodgeBenefitAvailable({ ...dodgeValid, mechanicalState: sample('incapacitated') }));
  check(
    '68.C) deslocamento efetivo 0 suspende a Esquiva (Agarrado inclusive)',
    !dodgeBenefitAvailable({ ...dodgeValid, effectiveSpeed: 0 }) &&
      !dodgeBenefitAvailable({ ...dodgeValid, mechanicalState: sample('grappled'), effectiveSpeed: effectiveSpeed(30, sample('grappled')) }) &&
      !dodgeBenefitAvailable({ dodging: true, mechanicalState: sample('grappled') }),
  );
  const spentTurn = onTurnStart(30);
  spentTurn.movementUsed = spentTurn.movementBudget;
  check(
    '68.D) movimento restante zero NÃO suspende a Esquiva',
    spentTurn.movementUsed === spentTurn.movementBudget &&
      dodgeBenefitAvailable({ dodging: true, mechanicalState: sample(), effectiveSpeed: effectiveSpeed(30, sample()) }),
  );
  const dodgeCtxSpeed = { targetDodging: true, targetSpeed: 30 };
  const dodgeVisiblePure = conditionAttackMode({}, sample(), false, false, dodgeCtxSpeed);
  check('68.E) atacante visível + Esquiva válida = desvantagem', dodgeVisiblePure.disadvantage && !dodgeVisiblePure.advantage);
  const dodgeIncapPure = conditionAttackMode({}, sample('incapacitated'), false, false, dodgeCtxSpeed);
  check('68.F) Esquiva + Incapacitated = sem desvantagem da Esquiva', !dodgeIncapPure.disadvantage && !dodgeIncapPure.advantage);
  const dodgeZeroPure = conditionAttackMode({}, sample(), false, false, { targetDodging: true, targetSpeed: 0 });
  check('68.G) Esquiva + deslocamento 0 = sem desvantagem da Esquiva', !dodgeZeroPure.disadvantage && !dodgeZeroPure.advantage);
  const dodgeUnseenPure = conditionAttackMode(sample('invisible'), sample(), false, false, dodgeCtxSpeed);
  check('68.H) Invisível não visto: vantagem mantida e sem desvantagem da Esquiva', dodgeUnseenPure.advantage && !dodgeUnseenPure.disadvantage);
  const proneDodgeMelee = conditionAttackMode({}, sample('prone'), false, false, { ...dodgeCtxSpeed, attackRanged: false });
  check('68.I) Caído + Esquiva válida + corpo a corpo = normal', !proneDodgeMelee.advantage && !proneDodgeMelee.disadvantage);
  const proneGrappledDodge = conditionAttackMode({}, sample('prone', 'grappled'), false, false, { targetDodging: true, targetSpeed: 0, attackRanged: false });
  check('68.J) Caído + Agarrado + Esquiva suspensa + corpo a corpo = vantagem', proneGrappledDodge.advantage && !proneGrappledDodge.disadvantage);
  const proneDodgeRanged = conditionAttackMode({}, sample('prone'), false, false, { ...dodgeCtxSpeed, attackRanged: true });
  check('68.K) Caído + Esquiva válida + à distância = desvantagem', proneDodgeRanged.disadvantage && !proneDodgeRanged.advantage);
  const dexWithDodge = deriveSaveEffects(sample(), 'dexterity', [], [], { dodge: true });
  check('68.L) Esquiva válida dá vantagem na salvaguarda de Destreza', dexWithDodge.advantage && !dexWithDodge.disadvantage);
  check(
    '68.M–Q) Esquiva não dá vantagem em FOR/CON/INT/SAB/CAR',
    (['strength', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const).every((ability) => {
      const mode = deriveSaveEffects(sample(), ability, [], [], { dodge: true });
      return !mode.advantage && !mode.disadvantage;
    }),
  );
  check(
    '68.R) Esquiva + Incapacitated não dá vantagem em Destreza',
    !deriveSaveEffects(sample('incapacitated'), 'dexterity', [], [], {
      dodge: dodgeBenefitAvailable({ dodging: true, mechanicalState: sample('incapacitated'), effectiveSpeed: 30 }),
    }).advantage,
  );
  check(
    '68.S) Esquiva suspensa por deslocamento 0 não dá vantagem em Destreza',
    !deriveSaveEffects(sample(), 'dexterity', [], [], {
      dodge: dodgeBenefitAvailable({ dodging: true, mechanicalState: sample(), effectiveSpeed: 0 }),
    }).advantage,
  );
  const dodgePlusDisadvantage = deriveSaveEffects(sample(), 'dexterity', [], ['manual'], { dodge: true });
  check('68.T) vantagem da Esquiva + outra desvantagem = normal', !dodgePlusDisadvantage.advantage && !dodgePlusDisadvantage.disadvantage);
  const dodgePlusAdvantage = deriveSaveEffects(sample(), 'dexterity', ['manual'], [], { dodge: true });
  check('68.U) duas fontes de vantagem continuam vantagem', dodgePlusAdvantage.advantage && !dodgePlusAdvantage.disadvantage);

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
      { id: 'ranged-fire', name: 'Dano fixo à distância', attackBonus: 30, damage: { count: 0, sides: 0, bonus: 9, type: 'Fogo' }, extraDamages: [], finesse: false, ranged: true, notes: '' },
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
    async function advanceTo(combatantId: string) {
      await refreshCombat();
      for (let i = 0; combat.currentCombatantId !== combatantId && i <= combat.combatants.length; i += 1) {
        const next = await request('/combat/next-turn', { combatId, expectedVersion: combat.version, operationId: randomUUID() });
        if (next.status !== 200) throw new Error(`Falha no avanço: ${JSON.stringify(next.data)}`);
        combat = next.data.combat;
      }
      if (combat.currentCombatantId !== combatantId) throw new Error(`Não alcançou o turno de ${combatantId}.`);
    }
    async function toOwnTurn() {
      await advanceTo(playerCombatant.id);
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
    // ESQUIVA × INVISÍVEL — integração real: o alvo só impõe desvantagem a
    // quem ele consegue VER. A Invisibilidade entra/ sai pelo controle manual.
    await advanceTo(copyA.id);
    const dodged = await request('/combat/action', {
      combatId,
      expectedVersion: (await refreshCombat()).version,
      operationId: randomUUID(),
      combatantId: copyA.id,
      action: 'dodge',
    });
    check('63.MCN) alvo entra em Esquiva no próprio turno', dodged.status === 200, JSON.stringify(dodged.data));
    await advanceTo(playerCombatant.id);
    await override();
    const dodgeVisible = await attack();
    check(
      '63.MCO) Esquiva contra atacante VISÍVEL impõe desvantagem',
      dodgeVisible.status === 200 && dodgeVisible.data.result.disadvantage && !dodgeVisible.data.result.advantage,
      JSON.stringify(dodgeVisible.data),
    );
    await apply('invisible');
    await override();
    const dodgeInvisible = await attack();
    check(
      '63.MCP) Invisível: a Esquiva NÃO soma desvantagem e a vantagem do Invisível vale',
      dodgeInvisible.status === 200 && dodgeInvisible.data.result.advantage && !dodgeInvisible.data.result.disadvantage,
      JSON.stringify(dodgeInvisible.data),
    );
    await clear();
    await override();
    const dodgeRestored = await attack();
    check(
      '63.MCQ) removida a Invisibilidade, a Esquiva volta a impor desvantagem',
      dodgeRestored.status === 200 && dodgeRestored.data.result.disadvantage && !dodgeRestored.data.result.advantage,
      JSON.stringify(dodgeRestored.data),
    );

    // HOTFIX: Incapacitated e deslocamento efetivo 0 suspendem os BENEFÍCIOS da
    // Esquiva sem apagar `dodging` — removida a condição dentro da duração, o
    // benefício volta sozinho.
    await apply('incapacitated', copyA);
    await override();
    const dodgeIncapacitated = await attack();
    check(
      '63.MCT) Esquiva + Incapacitated: ataque visível volta ao normal',
      dodgeIncapacitated.status === 200 &&
        !dodgeIncapacitated.data.result.disadvantage &&
        !dodgeIncapacitated.data.result.advantage,
      JSON.stringify(dodgeIncapacitated.data),
    );
    await remove((await read(copyA)).state.conditions.find((instance) => instance.condition === 'incapacitated')!.id, copyA);
    await override();
    const dodgeRestoredFromIncap = await attack();
    check(
      '63.MCU) removido o Incapacitated, a Esquiva volta a valer dentro da duração',
      dodgeRestoredFromIncap.status === 200 &&
        dodgeRestoredFromIncap.data.result.disadvantage &&
        !dodgeRestoredFromIncap.data.result.advantage,
      JSON.stringify(dodgeRestoredFromIncap.data),
    );
    await apply('grappled', copyA);
    await override();
    const dodgeGrappled = await attack();
    check(
      '63.MCV) Esquiva + Agarrado (deslocamento 0): ataque volta ao normal',
      dodgeGrappled.status === 200 &&
        !dodgeGrappled.data.result.disadvantage &&
        !dodgeGrappled.data.result.advantage,
      JSON.stringify(dodgeGrappled.data),
    );
    await apply('prone', copyA);
    await override();
    const proneGrappledDodge = await attack();
    check(
      '63.MCW) Caído + Agarrado + Esquiva suspensa: corpo a corpo = vantagem',
      proneGrappledDodge.status === 200 &&
        proneGrappledDodge.data.result.advantage &&
        !proneGrappledDodge.data.result.disadvantage,
      JSON.stringify(proneGrappledDodge.data),
    );
    await clear(copyA);

    // CAMINHO REAL DA FICHA: o botão de salvaguarda envia `kind: 'save'` +
    // `ability` + a própria entidade para `/api/dice/roll`. É este fluxo (e não
    // um helper isolado) que precisa enxergar a Esquiva.
    await override();
    const playerDodge = await action('dodge');
    check('63.MCX) personagem entra em Esquiva no próprio turno', playerDodge.status === 200, JSON.stringify(playerDodge.data));
    const dexSaveDodging = await request('/dice/roll', {
      dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', entity: ownEntity,
      label: 'Salvaguarda de Destreza',
    }, playerToken);
    check(
      '63.MCY) salvaguarda de Destreza na ficha recebe vantagem pela Esquiva',
      dexSaveDodging.status === 201 && dexSaveDodging.data.roll.advantage && dexSaveDodging.data.roll.dice.length === 2,
      JSON.stringify(dexSaveDodging.data),
    );
    const conSaveDodging = await request('/dice/roll', {
      dice: [{ sides: 20 }], kind: 'save', ability: 'constitution', entity: ownEntity,
      label: 'Salvaguarda de Constituição',
    }, playerToken);
    check(
      '63.MCZ) outras salvaguardas (CON) não recebem vantagem da Esquiva',
      conSaveDodging.status === 201 && !conSaveDodging.data.roll.advantage,
      JSON.stringify(conSaveDodging.data),
    );
    await apply('incapacitated');
    const dexSaveDodgeIncap = await request('/dice/roll', {
      dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', entity: ownEntity,
    }, playerToken);
    check(
      '63.MDA) Esquiva + Incapacitated: salvaguarda de Destreza sem vantagem',
      dexSaveDodgeIncap.status === 201 && !dexSaveDodgeIncap.data.roll.advantage,
      JSON.stringify(dexSaveDodgeIncap.data),
    );
    await remove((await read()).state.conditions.find((instance) => instance.condition === 'incapacitated')!.id);
    await apply('grappled');
    const dexSaveDodgeGrappled = await request('/dice/roll', {
      dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', entity: ownEntity,
    }, playerToken);
    check(
      '63.MDB) Esquiva + Agarrado (deslocamento 0): salvaguarda de Destreza sem vantagem',
      dexSaveDodgeGrappled.status === 201 && !dexSaveDodgeGrappled.data.roll.advantage,
      JSON.stringify(dexSaveDodgeGrappled.data),
    );
    await clear();

    // A Esquiva do alvo termina ao começar o próximo turno dele; voltamos ao
    // turno do jogador para as próximas seções não herdarem desvantagem.
    await advanceTo(copyA.id);
    await advanceTo(playerCombatant.id);

    // CAÍDO aplicado pelo Mestre → a regra de MODO do ataque já existente
    // responde: corpo a corpo contra Caído = vantagem; à distância = desvantagem.
    await clear(copyA);
    const proneApplied = await apply('prone', copyA);
    await override();
    const proneMeleeAttack = await attack();
    check(
      '63.MCR) Caído pelo Mestre: ataque CORPO A CORPO recebe vantagem',
      proneApplied.status === 200 &&
        proneMeleeAttack.status === 200 &&
        proneMeleeAttack.data.result.advantage &&
        !proneMeleeAttack.data.result.disadvantage,
      JSON.stringify(proneMeleeAttack.data),
    );
    await override();
    const proneRangedAttack = await attack({ attackId: 'ranged-fire' });
    check(
      '63.MCS) Caído pelo Mestre: ataque À DISTÂNCIA recebe desvantagem',
      proneRangedAttack.status === 200 &&
        proneRangedAttack.data.result.disadvantage &&
        !proneRangedAttack.data.result.advantage,
      JSON.stringify(proneRangedAttack.data),
    );
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

    // ======================================================================
    // 67) CONTROLE MANUAL DE CONDITIONS PELO MESTRE
    // Ferramenta do "Estado e ajustes": mesmo domínio, fontes próprias e
    // Conditions DERIVADAS protegidas (0 PV).
    // ======================================================================
    console.log('\n67) Controle manual de Conditions pelo Mestre');
    const playerAlias: MechanicalEntity = { kind: 'combatant', id: playerCombatant.id };
    const playerAttempt = await mutation(playerAlias, { action: 'apply', condition: 'invisible' }, playerToken);
    check(
      '63.MCA) PLAYER não usa o controle administrativo no combatente',
      playerAttempt.status === 403 &&
        (await read(ownEntity)).state.conditions.length === 0,
    );
    const appliedManual = await apply('invisible', playerAlias);
    const manualInstance = appliedManual.data.mechanical.state.conditions.find((instance: any) => instance.condition === 'invisible');
    check(
      '63.MCB) Mestre aplica Invisível manualmente com fonte identificável',
      appliedManual.status === 200 &&
        manualInstance?.sourceType === 'manual' &&
        manualInstance?.sourceLabel === 'Mestre' &&
        Boolean(manualInstance?.sourceId),
      JSON.stringify(manualInstance),
    );
    const manualState = await read(ownEntity);
    check(
      '63.MCC) Invisível manual chega à engine e ao histórico mecânico',
      manualState.effects.active.includes('invisible') &&
        manualState.effects.attackAdvantages.includes('invisible') &&
        manualState.state.log.some(entry => entry.message.includes('Invisível') && entry.message.includes('Mestre')),
    );
    const playerView = (await request('/combat/active', undefined, playerToken)).data.combat as CombatDto;
    check(
      '63.MCD) badge do card recebe a condição no DTO do PLAYER',
      playerView.combatants
        .find(item => item.id === playerCombatant.id)
        ?.mechanicalState.conditions.some(instance => instance.condition === 'invisible') === true,
    );
    // Múltiplas fontes: cada aplicação manual é uma instância. Remover uma NÃO
    // apaga as outras (nada de sobrescrever a lista).
    const manualSourceA = await apply('invisible');
    const manualSourceB = await apply('invisible');
    let doubled = await read();
    const invisibleSources = doubled.state.conditions.filter(instance => instance.condition === 'invisible');
    check(
      '63.MCE) cada aplicação manual cria fonte própria (não sobrescreve)',
      manualSourceA.status === 200 &&
        manualSourceB.status === 200 &&
        invisibleSources.length === 3 &&
        new Set(invisibleSources.map(instance => instance.sourceId)).size === 3,
      JSON.stringify(invisibleSources),
    );
    await remove(invisibleSources[0].id);
    doubled = await read();
    check(
      '63.MCF) remover UMA fonte preserva as demais',
      doubled.state.conditions.filter(instance => instance.condition === 'invisible').length === 2 &&
        doubled.effects.active.includes('invisible'),
    );
    await clear();
    // Source-aware: a criatura FONTE escolhida chega à engine (sem inventar).
    const fearApplied = await apply('frightened', ownEntity, { sourceEntity: { kind: 'combatant', id: copyA.id } });
    const fearState = await read();
    const fearInstance = fearState.state.conditions.find(instance => instance.condition === 'frightened');
    check(
      '63.MCG) Amedrontado com FONTE: criatura, rótulo e sourceId corretos',
      fearApplied.status === 200 &&
        fearInstance?.sourceEntity?.id === copyA.id &&
        fearInstance?.sourceLabel === copies[0].name &&
        fearInstance?.sourceId === copyA.id &&
        fearState.effects.fearSources[0]?.source?.id === copyA.id,
      JSON.stringify({ fear: fearInstance, sources: fearState.effects.fearSources }),
    );
    await clear();
    const grappleApplied = await apply('grappled', ownEntity, { sourceEntity: { kind: 'combatant', id: copyA.id } });
    const grappleState = await read();
    check(
      '63.MCH) Agarrado com FONTE e deslocamento zero (engine existente)',
      grappleApplied.status === 200 &&
        grappleState.effects.active.includes('grappled') &&
        grappleState.effectiveSpeed === 0 &&
        grappleState.state.conditions.find(instance => instance.condition === 'grappled')?.sourceEntity?.id === copyA.id,
    );
    await clear();
    // DERIVADAS de 0 PV: fixture com as MESMAS funções do ciclo de morte.
    await prisma.creature.update({
      where: { id: npc.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    const npcEntity: MechanicalEntity = { kind: 'creature', id: npc.id };
    const npcZero = await read(npcEntity);
    const hpZeroUnconscious = npcZero.state.conditions.find(instance => instance.condition === 'unconscious' && instance.sourceType === 'hp-zero');
    const hpZeroProne = npcZero.state.conditions.find(instance => instance.condition === 'prone' && instance.sourceLabel === HP_ZERO_PRONE_LABEL);
    check(
      '63.MCI) o DTO marca Inconsciente/Caído de 0 PV como protegidos',
      (npcZero.protectedInstanceIds ?? []).length === 2 &&
        Boolean(hpZeroUnconscious) &&
        Boolean(hpZeroProne) &&
        (npcZero.protectedInstanceIds ?? []).includes(hpZeroUnconscious!.id),
      JSON.stringify(npcZero.protectedInstanceIds),
    );
    const removeUnconsciousZero = await remove(hpZeroUnconscious!.id, npcEntity);
    const removeProneZero = await remove(hpZeroProne!.id, npcEntity);
    const npcAfterProtected = await read(npcEntity);
    check(
      '63.MCJ) remover derivada de 0 PV é recusado e o estado continua íntegro',
      removeUnconsciousZero.status === 409 &&
        removeProneZero.status === 409 &&
        npcAfterProtected.effects.active.includes('unconscious') &&
        npcAfterProtected.effects.prone,
      JSON.stringify({ inconsciente: removeUnconsciousZero.data, caido: removeProneZero.data }),
    );
    const manualUnconscious = await apply('unconscious', npcEntity);
    let npcMixed = await read(npcEntity);
    const unconsciousInstances = npcMixed.state.conditions.filter(instance => instance.condition === 'unconscious');
    check(
      '63.MCK) Inconsciente MANUAL convive com a fonte de 0 PV',
      manualUnconscious.status === 200 &&
        unconsciousInstances.length === 2 &&
        unconsciousInstances.some(instance => instance.sourceType === 'manual') &&
        unconsciousInstances.some(instance => instance.sourceType === 'hp-zero'),
      JSON.stringify(unconsciousInstances),
    );
    await remove(unconsciousInstances.find(instance => instance.sourceType === 'manual')!.id, npcEntity);
    npcMixed = await read(npcEntity);
    check(
      '63.MCL) remover a fonte manual mantém a Inconsciência de 0 PV',
      npcMixed.state.conditions.some(instance => instance.condition === 'unconscious' && instance.sourceType === 'hp-zero') &&
        npcMixed.effects.active.includes('unconscious') &&
        (npcMixed.protectedInstanceIds ?? []).length === 2,
    );
    await apply('invisible', npcEntity);
    const npcInvisible = await read(npcEntity);
    check(
      '63.MCM) Invisível manual em NPC/Creature é editável (não é derivada)',
      npcInvisible.state.conditions.some(instance => instance.condition === 'invisible' && instance.sourceType === 'manual') &&
        !(npcInvisible.protectedInstanceIds ?? []).some(instanceId =>
          npcInvisible.state.conditions.find(instance => instance.id === instanceId)?.condition === 'invisible',
        ),
    );
    await clear(npcEntity);
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
