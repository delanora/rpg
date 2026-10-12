import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { deriveAttackActionLimit, onTurnStart, spendEconomy, spellCastingEconomy } from '../modules/shared/action-economy.js';
import type { ClassEntry } from '../modules/shared/classes.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/** Fixtures próprias e HTTP real; não usa o preparador de ataques legado. */
export async function smokeActionEconomy(baseUrl: string, check: Check): Promise<void> {
  console.log('\n62) Fase 6.1 — economia autoritativa e Attack Action');
  const entry = (classKey: string, level: number, subclass = ''): ClassEntry => ({ classKey, level, subclass });
  for (const [name, classes, expected] of [
    ['sem Extra Attack', [], 1], ['Guerreiro 5', [entry('fighter', 5)], 2],
    ['Paladino 5', [entry('paladin', 5)], 2], ['Guerreiro 11', [entry('fighter', 11)], 3],
    ['Guerreiro 20', [entry('fighter', 20)], 4],
    ['Guerreiro 5 / Paladino 5', [entry('fighter', 5), entry('paladin', 5)], 2],
    ['Guerreiro 11 / Paladino 5', [entry('fighter', 11), entry('paladin', 5)], 3],
    ['Bardo da Bravura 6', [entry('bard', 6, 'Colégio da Bravura')], 2],
    ['subclasse sem Ataque Extra', [entry('bard', 6, 'Colégio do Conhecimento')], 1],
  ] as [string, ClassEntry[], number][]) {
    check(`62) limite central: ${name} → ${expected}`, deriveAttackActionLimit(classes) === expected);
  }
  check('62) casting time possui classificação central sem executar magia', spellCastingEconomy('action') === 'action' && spellCastingEconomy('bonusAction') === 'bonus-action' && spellCastingEconomy('reaction') === 'reaction' && spellCastingEconomy('minute') === null);
  const primitive = onTurnStart(30);
  spendEconomy(primitive, 'bonus-action');
  let bonusRejected = false;
  try { spendEconomy(primitive, 'bonus-action'); } catch { bonusRejected = true; }
  check('62) primitive de Bonus Action consome uma vez', primitive.bonusActionUsed && bonusRejected);
  const reactionPrimitive = onTurnStart(30);
  spendEconomy(reactionPrimitive, 'reaction');
  let reactionRejected = false;
  try { spendEconomy(reactionPrimitive, 'reaction'); } catch { reactionRejected = true; }
  check('62) primitive de Reaction rejeita segundo consumo', !reactionPrimitive.reactionAvailable && reactionRejected);

  const suffix = randomUUID().slice(0, 8);
  const users: string[] = [];
  let combatId: string | undefined;
  let creatureId: string | undefined;
  const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'] });
  try {
    const master = await prisma.user.create({ data: { username: `economy_m_${suffix}`, displayName: 'Mestre Economia', passwordHash: 'fixture', role: 'MASTER' } });
    users.push(master.id);
    const player = await prisma.user.create({ data: { username: `economy_p_${suffix}`, displayName: 'Jogador Economia', passwordHash: 'fixture', role: 'PLAYER' } });
    users.push(player.id);
    const token = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const inventory = inventoryListSchema.parse([
      { id: 'leve-a', name: 'Adaga A', slot: 'hand1', category: 'Arma', details: { weaponType: 'melee', weaponCategory: 'simple', damageDie: 4, damageType: 'Perfurante', properties: ['light', 'finesse'] } },
      { id: 'leve-b', name: 'Adaga B', slot: 'hand2', category: 'Arma', details: { weaponType: 'melee', weaponCategory: 'simple', damageDie: 4, damageType: 'Perfurante', properties: ['light', 'finesse'] } },
    ]);
    const character = await prisma.character.create({ data: {
      userId: player.id, name: 'Atacante Economia', classes: [{ ...entry('fighter', 5) }],
      hpMax: 1000, hpCurrent: 1000, speed: 30, inventory,
    } });
    const creature = await prisma.creature.create({ data: { name: 'NPC Economia', kind: 'NPC', speed: 9, hpMax: 1000, hpCurrent: 1000 } });
    creatureId = creature.id;
    const combat = await prisma.combat.create({ data: { combatants: { create: [
      { kind: 'CHARACTER', characterId: character.id, ownerUserId: player.id, name: character.name, initiative: 100, dexterityMod: 0 },
      { kind: 'CREATURE', creatureId: creature.id, name: creature.name, hpCurrent: 1000, hpMax: 1000, armorClass: 10 },
    ] } } });
    combatId = combat.id;
    const combatants = await prisma.combatant.findMany({ where: { combatId } });
    const playerId = combatants.find(item => item.characterId === character.id)!.id;
    const npcId = combatants.find(item => item.creatureId === creature.id)!.id;
    async function request(path: string, body?: unknown, auth = token) {
      const response = await fetch(`${baseUrl}/api/combat${path}`, {
        method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() as any };
    }
    let state = (await request(`/initiative/${npcId}`, {}, masterToken)).data.combat as CombatDto;
    const own = () => state.combatants.find(item => item.id === playerId)!.turnEconomy;
    const operation = () => ({ combatId, expectedVersion: state.version, operationId: randomUUID() });
    async function action(action: string, extra: Record<string, unknown> = {}, auth = token) {
      const response = await request('/action', { ...operation(), combatantId: playerId, action, ...extra }, auth);
      if (response.data.combat) state = response.data.combat;
      return response;
    }
    async function override(adjustment: string, extra: Record<string, unknown> = {}, auth = masterToken) {
      const response = await request('/economy/override', { ...operation(), combatantId: playerId, adjustment, reason: 'Verificação 6.1', ...extra }, auth);
      if (response.data.combat) state = response.data.combat;
      return response;
    }
    async function advance(auth = masterToken) {
      const response = await request('/next-turn', operation(), auth);
      if (response.data.combat) state = response.data.combat;
      return response;
    }
    const attackBody = (extra: Record<string, unknown> = {}) => ({ ...operation(), targetCombatantId: npcId, attackId: 'weapon:leve-a', ...extra });
    // IDs derivados vêm da fonte do servidor; sem suposições sobre o prefixo.
    const { characterDerivedAttacks } = await import('../modules/characters/characters.dto.js');
    const attacks = characterDerivedAttacks(character);
    const mainAttack = attacks.find(item => item.inventoryItemId === 'leve-a' && !item.id.startsWith('offhand:'))!.id;
    const offhand = attacks.find(item => item.id.startsWith('offhand:'))!.id;
    const attack = async (extra: Record<string, unknown> = {}, auth = token) => {
      const response = await request('/attack', attackBody({ attackId: mainAttack, ...extra }), auth);
      if (response.data.combat) state = response.data.combat;
      return response;
    };

    check('62) primeiro início inicializa Action/Bonus/Reaction/Movement', state.currentCombatantId === playerId && own().actionsGranted === 1 && !own().bonusActionUsed && own().reactionAvailable && own().movementBudget === 30);
    check('62) não existe ação bônus genérica HTTP', (await action('bonus-action')).status === 400);
    check('62) PLAYER não restaura economia', (await override('restore-action', {}, token)).status === 403);
    check('62) offhand sem Attack Action rejeitado', (await attack({ attackId: offhand })).status === 409);
    check('62) mover 10 reduz para 20', (await action('move', { distance: 10 })).status === 200 && own().movementBudget - own().movementUsed === 20);
    const socketVersion = state.version;
    const eventReceived = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 4000);
      socket.once('combat:updated', payload => { clearTimeout(timer); resolve(payload.combat.version > socketVersion); });
    });
    socket.auth = { token };
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const firstPayload = attackBody({ attackId: mainAttack, attacksAllowed: 999 });
    const first = await request('/attack', firstPayload);
    state = first.data.combat;
    check('62) ataque cria contexto e ignora limite do cliente', first.status === 200 && own().actionsUsed === 1 && own().attackAction?.attacksMade === 1 && own().attackAction!.attacksAllowed === 2);
    check('62) economia é publicada no socket existente', await eventReceived);
    const storedAfterFirst = await prisma.combatant.findUniqueOrThrow({ where: { id: npcId } });
    const replay = await request('/attack', firstPayload);
    const storedAfterReplay = await prisma.combatant.findUniqueOrThrow({ where: { id: npcId } });
    check('62) retry não repete dano/consumo', replay.status === 200 && replay.data.replayed === true && storedAfterReplay.hpCurrent === storedAfterFirst.hpCurrent && replay.data.result.attackRoll === first.data.result.attackRoll);
    const reused = await request('/attack', { ...firstPayload, attackId: 'unarmed' });
    check('62) mesma chave com outro payload rejeita', reused.status === 409 && reused.data.error === 'IDEMPOTENCY_KEY_REUSED');
    const refreshed = (await request('/active')).data.combat as CombatDto;
    check('62) refresh mantém contexto/action gasta', refreshed.combatants.find(item => item.id === playerId)?.turnEconomy.attackAction?.attackActionId === own().attackAction?.attackActionId && refreshed.combatants.find(item => item.id === playerId)?.turnEconomy.actionsUsed === 1);
    check('62) movimento dividido após ataque deixa 5', (await action('move', { distance: 15 })).status === 200 && own().movementBudget - own().movementUsed === 5);
    check('62) movimento excedente não fica negativo', (await action('move', { distance: 10 })).status === 409 && own().movementUsed === 25);
    const continuation = own().attackAction!.attackActionId;
    const concurrent = await Promise.all([
      request('/attack', attackBody({ attackId: mainAttack, attackActionId: continuation })),
      request('/attack', attackBody({ attackId: mainAttack, attackActionId: continuation })),
    ]);
    state = (await request('/active')).data.combat;
    check('62) segundo ataque não gasta outra Action; concorrência não excede 2', concurrent.filter(item => item.status === 200).length === 1 && concurrent.filter(item => item.status === 409).length === 1 && own().actionsUsed === 1 && own().attackAction?.attacksMade === 2);
    check('62) ataque acima do limite rejeitado', (await attack({ attackActionId: continuation })).status === 409);
    check('62) outra Attack Action sem Action rejeitada', (await attack()).status === 409);
    const counter = own().attackAction!.attacksMade;
    check('62) offhand usa Bonus e não altera contador', (await attack({ attackId: offhand })).status === 200 && own().bonusActionUsed && own().attackAction?.attacksMade === counter && own().attackAction!.attacksAllowed === 2);
    check('62) segundo offhand rejeitado', (await attack({ attackId: offhand })).status === 409);
    check('62) Mestre concede Action logada', (await override('grant-action')).status === 200 && own().actionsGranted === 2 && state.economyLog.some(item => item.message.includes('concedeu +1 Ação')));
    check('62) Dash após movimento parcial soma speed', (await action('dash')).status === 200 && own().movementBudget === 60 && own().movementUsed === 25 && own().actionsUsed === 2);
    await override('restore-action');
    const ready = await action('ready', { trigger: 'Quando abrir a porta', intent: 'Ataco com a adaga' });
    check('62) Ready consome Action e salva intenção', ready.status === 200 && own().actionsUsed === 1 && own().ready?.trigger === 'Quando abrir a porta');
    await advance(token);
    check('62) fim não recupera Action/Bonus/Movement anterior', own().actionsUsed === 1 && own().bonusActionUsed && own().movementUsed === 25);
    check('62) NPC recebe mesma economia e speed', state.currentCombatantId === npcId && state.combatants.find(item => item.id === npcId)?.turnEconomy.movementBudget === 9 && state.combatants.find(item => item.id === npcId)?.turnEconomy.actionsGranted === 1);
    check('62) PLAYER Action fora do turno rejeitada', (await action('hide')).status === 403);
    check('62) MASTER não tem bypass automático de ataque', (await attack({ attackerCombatantId: playerId }, masterToken)).status === 403);
    const actionsBeforeReaction = own().actionsUsed;
    const reactionAttack = await attack({ prepared: true });
    check('62) Ready attack usa Reaction fora do turno sem outra Action', reactionAttack.status === 200 && !own().reactionAvailable && own().actionsUsed === actionsBeforeReaction && own().ready === null);
    check('62) Ready não detecta gatilho sozinho', state.economyLog.some(item => item.message.includes('gatilho confirmado manualmente')));
    check('62) repetir Ready sem preparo rejeitado', (await attack({ prepared: true })).status === 409);
    await override('restore-action');
    await advance();
    check('62) início próprio recupera Reaction e limpa turno anterior', own().reactionAvailable && own().actionsUsed === 0 && !own().bonusActionUsed && own().movementUsed === 0 && own().movementBudget === 30 && own().attackAction === null);
    await action('ready', { trigger: 'Sinal', intent: 'Empurro a porta' });
    await advance();
    const reactionOps = await Promise.all([
      request('/action', { ...operation(), combatantId: playerId, action: 'execute-ready' }),
      request('/action', { ...operation(), combatantId: playerId, action: 'execute-ready' }),
    ]);
    state = (await request('/active')).data.combat;
    check('62) consumo concorrente de Reaction aceita só um', reactionOps.filter(item => item.status === 200).length === 1 && reactionOps.filter(item => item.status === 409).length === 1 && !own().reactionAvailable);
    // Encerrar o próprio turno do NPC não recupera a Reaction dele.
    const npcPrepare = await request('/action', { ...operation(), combatantId: npcId, action: 'ready', trigger: 'Sinal', intent: 'Abro a porta' }, masterToken);
    state = npcPrepare.data.combat;
    const npcExecute = await request('/action', { ...operation(), combatantId: npcId, action: 'execute-ready' }, masterToken);
    state = npcExecute.data.combat;
    await advance();
    check('62) turn end não recupera Reaction do combatente que terminou', !state.combatants.find(item => item.id === npcId)!.turnEconomy.reactionAvailable);
    const improvisation = await action('improvised', { description: 'Derrubo a estante sobre a porta' });
    check('62) improvisada consome e registra sem teste/resultado', improvisation.status === 200 && own().actionsUsed === 1 && state.economyLog.some(item => item.message.includes('Derrubo a estante')) && !('roll' in improvisation.data));
    for (const simple of ['disengage', 'dodge', 'help', 'hide', 'search', 'use-object']) {
      await override('restore-action');
      check(`62) ${simple} estrutural consome Action`, (await action(simple, { description: 'Contexto narrativo' })).status === 200 && own().actionsUsed === 1 && state.economyLog.some(item => item.action === simple));
    }
    await override('restore-action');
    const dashOps = await Promise.all([
      request('/action', { ...operation(), combatantId: playerId, action: 'dash' }),
      request('/action', { ...operation(), combatantId: playerId, action: 'dash' }),
    ]);
    state = (await request('/active')).data.combat;
    check('62) duplo Dash não duplica movimento', dashOps.filter(item => item.status === 200).length === 1 && dashOps.filter(item => item.status === 409).length === 1 && own().movementBudget === 60);
    await override('set-movement', { remaining: 7.5 });
    check('62) override fracionário de Movement logado', own().movementBudget - own().movementUsed === 7.5 && state.economyLog.some(item => item.message.includes('7.5 m')));
    await override('restore-bonus');
    await override('restore-reaction');
    check('62) overrides restauram Bonus/Reaction explicitamente', !own().bonusActionUsed && own().reactionAvailable);
    await override('restore-action');
    const otherMain = attacks.find(item => item.inventoryItemId === 'leve-b' && !item.id.startsWith('offhand:'))!.id;
    await attack({ attackId: otherMain });
    check('62) mão secundária exige arma diferente da usada', (await attack({ attackId: 'offhand:leve-b' })).status === 409);
    check('62) qualquer mão pode ser secundária; não exige o estilo', (await attack({ attackId: 'offhand:leve-a' })).status === 200 && own().bonusActionUsed);
    await override('restore-action');
    await action('ready', { trigger: 'Sinal', intent: 'Ação assistida' });
    await action('execute-ready');
    await override('restore-action');
    await action('ready', { trigger: 'Outro sinal', intent: 'Atacar' });
    check('62) Ready existente sem Reaction não executa', (await attack({ prepared: true })).status === 409 && own().ready !== null);
    await override('restore-action');
    const beforeDash = own().movementBudget;
    const sameDash = { ...operation(), combatantId: playerId, action: 'dash' };
    const retryRace = await Promise.all([request('/action', sameDash), request('/action', sameDash)]);
    state = (await request('/active')).data.combat;
    check('62) retries simultâneos da mesma operação têm um efeito', retryRace.every(item => item.status === 200) && retryRace.filter(item => item.data.replayed).length === 1 && own().movementBudget === beforeDash + 30 && own().actionsUsed === 1);
    // Reconnect consulta a mesma persistência; nunca reinicializa economia.
    socket.disconnect();
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const reconnect = (await request('/active')).data.combat as CombatDto;
    check('62) reconnect preserva contador e Action gasta', reconnect.combatants.find(item => item.id === playerId)?.turnEconomy.attackAction?.attackActionId === own().attackAction?.attackActionId && reconnect.combatants.find(item => item.id === playerId)?.turnEconomy.actionsUsed === 1);
    const sheet = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    check('62) economia não vazou para classState/racialState/spells', !JSON.stringify([sheet.classState, sheet.racialState, sheet.spells]).includes('actionsUsed'));
    const ended = await request('/end', {}, masterToken);
    check('62) encerramento preservado; fora de combate não há orçamento', ended.status === 200 && (await request('/active')).data.combat === null);
  } finally {
    socket.disconnect();
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    if (creatureId) await prisma.creature.deleteMany({ where: { id: creatureId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
}
