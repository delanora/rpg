import { io, type Socket } from 'socket.io-client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

/**
 * Smoke test ponta a ponta das Etapas 1 e 2.
 *
 * Exige o servidor rodando (`npm run dev`) e valida:
 *   1. Cadastro de jogador e de mestre (com código de convite).
 *   2. Login, /api/auth/me e proteção de papel em /api/users.
 *   3. Conexão WebSocket autenticada por JWT e presença.
 *   4. Ficha: criação, cálculo das regras de D&D 5e, validações e permissões.
 *   5. CRÍTICO: alteração do jogador chega ao mestre na hora, sem recarregar.
 *
 * Uso: npm run smoke           (servidor em http://localhost:3000)
 *      SMOKE_BASE_URL=... npm run smoke
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? `http://localhost:${env.PORT}`;
const suffix = Date.now().toString(36);
const createdUsernames: string[] = [];
const createdCreatureIds: string[] = [];
const createdCombatIds: string[] = [];

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function api<T = any>(
  path: string,
  { method = 'GET', body, token }: ApiOptions = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

/** Aguarda um evento do socket, com timeout. */
function waitFor<T = any>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout aguardando evento "${event}"`));
    }, timeoutMs);

    function handler(payload: T): void {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

/**
 * Aguarda um `presence:update` que satisfaça o predicado.
 * Necessário porque o evento é emitido a cada entrada/saída.
 */
function waitForPresence(
  socket: Socket,
  predicate: (online: any[]) => boolean,
  timeoutMs = 4000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('presence:update', handler);
      reject(new Error('Timeout aguardando presence:update correspondente'));
    }, timeoutMs);

    function handler(payload: any): void {
      if (!predicate(payload?.online ?? [])) return;
      clearTimeout(timer);
      socket.off('presence:update', handler);
      resolve(payload);
    }

    socket.on('presence:update', handler);
  });
}

function connect(token: string): Socket {
  return io(BASE_URL, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
  });
}

async function main(): Promise<void> {
  console.log(`\n🔎 Smoke test (Etapas 1 e 2) em ${BASE_URL}\n`);

  // --- 1. Cadastro -----------------------------------------------------------
  console.log('1) Cadastro e papéis');
  const playerUsername = `jogador_${suffix}`;
  const masterUsername = `mestre_${suffix}`;
  createdUsernames.push(playerUsername, masterUsername);

  const playerReg = await api('/api/auth/register', {
    method: 'POST',
    body: { username: playerUsername, displayName: 'Jogador Teste', password: 'senha-forte-123' },
  });
  check('jogador cadastrado (201)', playerReg.status === 201, JSON.stringify(playerReg.data));
  check('jogador recebeu papel PLAYER', playerReg.data?.user?.role === 'PLAYER');

  const masterReg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      username: masterUsername,
      displayName: 'Mestre Teste',
      password: 'senha-forte-123',
      masterInviteCode: env.MASTER_INVITE_CODE,
    },
  });
  check('mestre cadastrado (201)', masterReg.status === 201, JSON.stringify(masterReg.data));
  check('mestre recebeu papel MASTER', masterReg.data?.user?.role === 'MASTER');

  const badCode = await api('/api/auth/register', {
    method: 'POST',
    body: {
      username: `intruso_${suffix}`,
      displayName: 'Intruso',
      password: 'senha-forte-123',
      masterInviteCode: 'codigo-errado',
    },
  });
  check('código de mestre inválido é rejeitado (403)', badCode.status === 403, `status ${badCode.status}`);

  const dup = await api('/api/auth/register', {
    method: 'POST',
    body: { username: playerUsername, displayName: 'Duplicado', password: 'senha-forte-123' },
  });
  check('usuário duplicado é rejeitado (409)', dup.status === 409, `status ${dup.status}`);

  // --- 2. Login / autorização -----------------------------------------------
  console.log('\n2) Login e autorização');
  const playerLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: playerUsername, password: 'senha-forte-123' },
  });
  check('login do jogador (200)', playerLogin.status === 200, JSON.stringify(playerLogin.data));

  const masterLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: masterUsername, password: 'senha-forte-123' },
  });
  check('login do mestre (200)', masterLogin.status === 200, JSON.stringify(masterLogin.data));

  const wrongPassword = await api('/api/auth/login', {
    method: 'POST',
    body: { username: playerUsername, password: 'senha-errada' },
  });
  check('senha errada é rejeitada (401)', wrongPassword.status === 401, `status ${wrongPassword.status}`);

  const playerToken: string = playerLogin.data?.token;
  const masterToken: string = masterLogin.data?.token;
  const playerId: string = playerLogin.data?.user?.id;

  check('/api/auth/me exige token (401 sem token)', (await api('/api/auth/me')).status === 401);

  const usersAsMaster = await api('/api/users', { token: masterToken });
  check('mestre pode listar usuários (200)', usersAsMaster.status === 200);
  check(
    'lista de usuários não expõe senhas',
    !JSON.stringify(usersAsMaster.data).includes('passwordHash'),
  );
  check(
    'jogador NÃO pode listar usuários (403)',
    (await api('/api/users', { token: playerToken })).status === 403,
  );

  // --- 3. WebSocket ----------------------------------------------------------
  console.log('\n3) WebSocket autenticado e presença');
  const rejected = connect('token-invalido');
  const rejectError = await waitFor<string>(rejected, 'connect_error').catch(() => null);
  check('token inválido é recusado na conexão', rejectError !== null);
  rejected.close();

  const masterSocket = connect(masterToken);
  const masterReady = await waitFor(masterSocket, 'connection:ready').catch(() => null);
  check('mestre conecta e recebe connection:ready', masterReady !== null);
  check('connection:ready traz o papel MASTER', masterReady?.user?.role === 'MASTER');

  const presencePromise = waitForPresence(
    masterSocket,
    (online) =>
      online.some((u) => u.username === playerUsername) &&
      online.some((u) => u.username === masterUsername),
  );

  const playerSocket = connect(playerToken);
  const playerReady = await waitFor(playerSocket, 'connection:ready').catch(() => null);
  check('jogador conecta e recebe connection:ready', playerReady !== null);
  check('mestre recebe presence:update com os dois', (await presencePromise.catch(() => null)) !== null);

  // --- 4. Ficha de personagem ------------------------------------------------
  console.log('\n4) Ficha de personagem e regras de D&D 5e');
  const emptySheet = await api('/api/characters/me', { token: playerToken });
  check('jogador ainda não tem ficha (null)', emptySheet.data?.character === null);

  const created = await api('/api/characters/me', {
    method: 'POST',
    token: playerToken,
    body: { name: 'Thoradin', race: 'Anão', className: 'Guerreiro', level: 1 },
  });
  check('jogador cria a própria ficha (201)', created.status === 201, JSON.stringify(created.data));

  const sheet = created.data?.character;
  check('ficha tem as 18 perícias normalizadas', Object.keys(sheet?.skills ?? {}).length === 18);
  check('ficha tem as 6 salvaguardas normalizadas', Object.keys(sheet?.saves ?? {}).length === 6);
  check('nenhuma perícia começa proficiente', Object.values(sheet?.skills ?? {}).every((s: any) => !s.proficient));
  check(
    'não é possível criar uma segunda ficha (409)',
    (await api('/api/characters/me', { method: 'POST', token: playerToken, body: {} })).status === 409,
  );

  // Regras: nível, modificadores e proficiência.
  const rules = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { level: 5, dexterity: 16, strength: 8, wisdom: 14, armorClass: 15 },
  });
  const rulesSheet = rules.data?.character;
  check('PATCH aplica os valores', rulesSheet?.level === 5 && rulesSheet?.dexterity === 16);
  check('bônus de proficiência no nível 5 é +3', rulesSheet?.derived?.proficiencyBonus === 3, `recebido: ${rulesSheet?.derived?.proficiencyBonus}`);
  check('modificador de DES 16 é +3', rulesSheet?.derived?.modifiers?.dexterity === 3);
  check('modificador de FOR 8 é -1', rulesSheet?.derived?.modifiers?.strength === -1);
  check('iniciativa = modificador de Destreza', rulesSheet?.derived?.initiative === 3, `recebido: ${rulesSheet?.derived?.initiative}`);
  check('CA não é recalculada (valor manual preservado)', rulesSheet?.armorClass === 15);
  const withSave = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { saves: { ...rulesSheet.saves, strength: true } },
  });
  const strengthSave = (withSave.data?.character?.derived?.saves ?? []).find(
    (save: any) => save.ability === 'strength',
  );
  // FOR 8 -> modificador -1; proficiência no nível 5 -> +3
  check('salvaguarda proficiente soma proficiência (-1 + 3 = +2)', strengthSave?.total === 2, `recebido: ${strengthSave?.total}`);

  // Proficiência em perícia e especialização.
  const withProf = {
    ...rulesSheet.skills,
    perception: { proficient: true, expertise: false },
  };
  const skilled = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { skills: withProf },
  });
  // SAB 14 -> modificador +2; proficiência no nível 5 -> +3
  check('perícia com proficiência soma o bônus', skilled.data?.character?.derived?.skills?.perception?.total === 5, `recebido: ${skilled.data?.character?.derived?.skills?.perception?.total}`);
  check('percepção passiva reflete a proficiência', skilled.data?.character?.derived?.passivePerception === 15, `recebido: ${skilled.data?.character?.derived?.passivePerception}`);

  const withExpertise = {
    ...skilled.data.character.skills,
    perception: { proficient: true, expertise: true },
  };
  const expert = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { skills: withExpertise },
  });
  check('especialização dobra o bônus de proficiência', expert.data?.character?.derived?.skills?.perception?.total === 8, `recebido: ${expert.data?.character?.derived?.skills?.perception?.total}`);

  // Bônus de iniciativa avulso.
  const withBonus = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { initiativeBonus: 2 },
  });
  check('bônus extra soma à iniciativa', withBonus.data?.character?.derived?.initiative === 5, `recebido: ${withBonus.data?.character?.derived?.initiative}`);

  check('versão incrementa a cada alteração', (expert.data?.character?.version ?? 0) > (rulesSheet?.version ?? 0));

  // Validações de limites.
  check(
    'nível fora de 1–20 é rejeitado (400)',
    (await api('/api/characters/me', { method: 'PATCH', token: playerToken, body: { level: 99 } })).status === 400,
  );
  check(
    'atributo fora de 1–30 é rejeitado (400)',
    (await api('/api/characters/me', { method: 'PATCH', token: playerToken, body: { strength: 50 } })).status === 400,
  );
  check(
    'PATCH vazio é rejeitado (400)',
    (await api('/api/characters/me', { method: 'PATCH', token: playerToken, body: {} })).status === 400,
  );
  check(
    'ficha exige autenticação (401 sem token)',
    (await api('/api/characters/me')).status === 401,
  );

  // Inventário com peso.
  const withItems = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      inventory: [
        { id: 'i1', name: 'Espada longa', description: 'cortante', quantity: 1, weight: 3, equipped: true },
        { id: 'i2', name: 'Poção de cura', description: '', quantity: 3, weight: 0.5, equipped: false },
      ],
      attacks: [
        { id: 'a1', name: 'Espada longa', damage: '1d8+2', damageType: 'Cortante', attackBonus: 5, notes: '' },
      ],
      features: [{ id: 'f1', name: 'Visão no escuro', source: 'race', description: 'Enxerga no escuro até 18m.' }],
      spells: {
        list: [{ id: 's1', name: 'Mísseis Mágicos', level: 1, school: 'Evocação', prepared: true, description: '' }],
        slots: { '1': { max: 2, used: 1 } },
      },
    },
  });
  check('peso total é somado (3 + 1,5 = 4,5)', withItems.data?.character?.derived?.totalWeight === 4.5, `recebido: ${withItems.data?.character?.derived?.totalWeight}`);
  check('capacidade de carga = FOR × 15 (8 × 15 = 120)', withItems.data?.character?.derived?.carryingCapacity === 120, `recebido: ${withItems.data?.character?.derived?.carryingCapacity}`);
  check('ataques são gravados', withItems.data?.character?.attacks?.length === 1);
  check('características são gravadas', withItems.data?.character?.features?.length === 1);
  check('magias e espaços são gravados', withItems.data?.character?.spells?.list?.length === 1 && withItems.data?.character?.spells?.slots?.['1']?.max === 2);

  // --- 5. Permissões entre papéis -------------------------------------------
  console.log('\n5) Permissões das fichas');
  const allAsMaster = await api('/api/characters', { token: masterToken });
  check('mestre lista todas as fichas (200)', allAsMaster.status === 200);
  const seenByMaster = (allAsMaster.data?.characters ?? []).find(
    (c: any) => c.id === withItems.data?.character?.id,
  );
  check('mestre vê a ficha do jogador', Boolean(seenByMaster));
  check('listagem do mestre traz o dono', Boolean(seenByMaster?.ownerUsername), JSON.stringify(seenByMaster?.ownerUsername));
  check('mestre enxerga o inventário da ficha', (seenByMaster?.inventory ?? []).length === 2);
  check(
    'jogador NÃO lista fichas alheias (403)',
    (await api('/api/characters', { token: playerToken })).status === 403,
  );

  // --- 6. CRÍTICO: sincronização em tempo real -------------------------------
  console.log('\n6) Sincronização em tempo real (jogador → mestre)');
  const masterUpdate = waitFor<any>(masterSocket, 'sheet:updated');
  await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { hpCurrent: 12, notes: 'Ferido no combate.' },
  });

  const payload = await masterUpdate.catch(() => null);
  check('mestre recebe sheet:updated SEM recarregar', payload !== null);
  check('evento carimba o autor correto', payload?.userId === playerId, `recebido: ${payload?.userId}`);
  check('evento identifica a ficha', payload?.characterId === withItems.data?.character?.id);
  check('evento traz as mudanças aplicadas', payload?.changes?.hpCurrent === 12);
  check('evento traz a ficha completa para o painel', payload?.character?.hpCurrent === 12);
  check('ficha do evento vem com os valores derivados', typeof payload?.character?.derived?.proficiencyBonus === 'number');

  const playerEcho = waitFor<any>(playerSocket, 'sheet:updated');
  await api('/api/characters/me', { method: 'PATCH', token: playerToken, body: { hpTemp: 5 } });
  const echo = await playerEcho.catch(() => null);
  check('o próprio jogador também recebe o evento (sincroniza abas)', echo?.character?.hpTemp === 5);

  // Uma ficha de outro jogador não deve aparecer para este jogador.
  const otherPlayer = `outro_${suffix}`;
  createdUsernames.push(otherPlayer);
  const otherReg = await api('/api/auth/register', {
    method: 'POST',
    body: { username: otherPlayer, displayName: 'Outro Jogador', password: 'senha-forte-123' },
  });
  const otherMe = await api('/api/characters/me', { token: otherReg.data?.token });
  check('outro jogador não vê a ficha alheia (null)', otherMe.data?.character === null);

  // --- 7. Criaturas / NPCs ---------------------------------------------------
  console.log('\n7) Criaturas/NPCs (bestiário do mestre)');

  check(
    'bestiário exige autenticação (401)',
    (await api('/api/creatures')).status === 401,
  );
  check(
    'jogador NÃO acessa o bestiário (403)',
    (await api('/api/creatures', { token: playerToken })).status === 403,
  );

  const createdEvent = waitFor<any>(masterSocket, 'creature:created');
  const createdCreature = await api('/api/creatures', {
    method: 'POST',
    token: masterToken,
    body: { name: 'Goblin', type: 'Humanoide', challengeRating: '1/4', hpMax: 7, armorClass: 15 },
  });
  check('mestre cadastra criatura (201)', createdCreature.status === 201, JSON.stringify(createdCreature.data));

  const creature = createdCreature.data?.creature;
  check('criatura nasce com HP atual = máximo', creature?.hpCurrent === 7 && creature?.hpMax === 7);
  check('criatura traz os 6 modificadores derivados', Object.keys(creature?.derived?.modifiers ?? {}).length === 6);
  check('mestre recebe creature:created em tempo real', (await createdEvent.catch(() => null))?.creature?.id === creature?.id);

  const updatedEvent = waitFor<any>(masterSocket, 'creature:updated');
  const updatedCreature = await api(`/api/creatures/${creature.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      hpCurrent: 3,
      strength: 8,
      dexterity: 14,
      attacks: [
        { id: 'g1', name: 'Cimitarra', damage: '1d6+2', damageType: 'Cortante', attackBonus: 4, notes: '' },
      ],
      resistances: ['Fogo'],
      immunities: ['Veneno'],
      description: 'Pequeno e covarde.',
    },
  });
  const goblin = updatedCreature.data?.creature;
  check('PATCH atualiza a criatura', goblin?.hpCurrent === 3 && goblin?.strength === 8);
  check('modificador de FOR 8 é -1', goblin?.derived?.modifiers?.strength === -1);
  check('modificador de DES 14 é +2', goblin?.derived?.modifiers?.dexterity === 2);
  check('ataques da criatura são gravados', goblin?.attacks?.length === 1 && goblin?.attacks?.[0]?.damage === '1d6+2');
  check('resistências são gravadas', goblin?.resistances?.[0] === 'Fogo');
  check('imunidades são gravadas', goblin?.immunities?.[0] === 'Veneno');
  check('versão da criatura incrementa', (goblin?.version ?? 0) > (creature?.version ?? 0));
  check('mestre recebe creature:updated em tempo real', (await updatedEvent.catch(() => null))?.creature?.hpCurrent === 3);

  check(
    'tipo de dano inválido é rejeitado (400)',
    (
      await api(`/api/creatures/${creature.id}`, {
        method: 'PATCH',
        token: masterToken,
        body: { resistances: ['Sonoro'] },
      })
    ).status === 400,
  );
  check(
    'atributo fora de 1–30 é rejeitado (400)',
    (
      await api(`/api/creatures/${creature.id}`, {
        method: 'PATCH',
        token: masterToken,
        body: { strength: 50 },
      })
    ).status === 400,
  );
  check(
    'jogador NÃO edita criatura (403)',
    (
      await api(`/api/creatures/${creature.id}`, {
        method: 'PATCH',
        token: playerToken,
        body: { hpCurrent: 1 },
      })
    ).status === 403,
  );

  const bestiary = await api('/api/creatures', { token: masterToken });
  check(
    'mestre lista as criaturas',
    (bestiary.data?.creatures ?? []).some((item: any) => item.id === creature.id),
  );

  const deletedEvent = waitFor<any>(masterSocket, 'creature:deleted');
  check(
    'mestre remove criatura (204)',
    (await api(`/api/creatures/${creature.id}`, { method: 'DELETE', token: masterToken })).status === 204,
  );
  check('mestre recebe creature:deleted em tempo real', (await deletedEvent.catch(() => null))?.creatureId === creature.id);
  check(
    'criatura removida devolve 404',
    (await api(`/api/creatures/${creature.id}`, { token: masterToken })).status === 404,
  );

  // --- 8. Combate ------------------------------------------------------------
  console.log('\n8) Combate');

  // HP decente para o combate e um ataque no personagem.
  await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      hpMax: 30,
      hpCurrent: 30,
      attacks: [
        { id: 'p1', name: 'Espada longa', damage: '1d8+3', damageType: 'Cortante', attackBonus: 10, notes: '' },
      ],
    },
  });

  const wolfCreated = await api('/api/creatures', {
    method: 'POST',
    token: masterToken,
    body: { name: 'Lobo', type: 'Besta', hpMax: 20, armorClass: 12 },
  });
  const wolf = wolfCreated.data.creature;
  createdCreatureIds.push(wolf.id);

  await api(`/api/creatures/${wolf.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      dexterity: 14,
      attacks: [
        { id: 'c1', name: 'Mordida', damage: '1d6+2', damageType: 'Cortante', attackBonus: 10, notes: '' },
      ],
    },
  });

  check(
    'jogador NÃO inicia combate (403)',
    (await api('/api/combat', { method: 'POST', token: playerToken, body: { creatureIds: [] } })).status === 403,
  );
  check('sem combate ativo no início', (await api('/api/combat/active', { token: playerToken })).data.combat === null);

  const combatStartedEvent = waitFor<any>(playerSocket, 'combat:started');
  const combatStarted = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { creatureIds: [wolf.id] },
  });
  check('mestre inicia o combate (201)', combatStarted.status === 201, JSON.stringify(combatStarted.data));
  check(
    'jogadores recebem combat:started',
    (await combatStartedEvent.catch(() => null))?.combat?.status === 'PENDING_INITIATIVE',
  );

  const combat = combatStarted.data.combat;
  createdCombatIds.push(combat.id);
  const playerCombatant = combat.combatants.find((item: any) => item.ownerUserId === playerId);
  const creatureCombatant = combat.combatants.find((item: any) => item.kind === 'CREATURE');
  check('personagens de jogador entram automaticamente', Boolean(playerCombatant));
  check('criatura escolhida entra no combate', Boolean(creatureCombatant));
  check('ninguém rolou iniciativa ainda', combat.combatants.every((item: any) => !item.rolled));

  check(
    'não é possível iniciar dois combates (409)',
    (await api('/api/combat', { method: 'POST', token: masterToken, body: { creatureIds: [] } })).status === 409,
  );
  check(
    'jogador NÃO rola a iniciativa de outro (403)',
    (await api(`/api/combat/initiative/${creatureCombatant.id}`, { method: 'POST', token: playerToken })).status === 403,
  );
  check(
    'jogador NÃO avança o turno (403)',
    (await api('/api/combat/next-turn', { method: 'POST', token: playerToken })).status === 403,
  );

  const diceEvent = waitFor<any>(playerSocket, 'dice:rolled');
  const playerRoll = await api('/api/combat/initiative', { method: 'POST', token: playerToken });
  const rolledPlayer = playerRoll.data.combat.combatants.find((item: any) => item.id === playerCombatant.id);
  check('jogador rola a própria iniciativa', rolledPlayer.initiative !== null);
  check(
    'iniciativa = 1d20 + modificador de Destreza',
    rolledPlayer.initiative >= 1 + playerCombatant.dexterityMod &&
      rolledPlayer.initiative <= 20 + playerCombatant.dexterityMod,
    `valor ${rolledPlayer.initiative}, mod ${playerCombatant.dexterityMod}`,
  );
  check('rolagem é divulgada para a mesa (dice:rolled)', (await diceEvent.catch(() => null))?.kind === 'initiative');
  check(
    'combate continua pendente enquanto falta alguém',
    playerRoll.data.combat.status === 'PENDING_INITIATIVE',
  );
  check(
    'não é possível rolar duas vezes (409)',
    (await api('/api/combat/initiative', { method: 'POST', token: playerToken })).status === 409,
  );

  const turnEvent = waitFor<any>(masterSocket, 'combat:turn');
  const masterRoll = await api(`/api/combat/initiative/${creatureCombatant.id}`, {
    method: 'POST',
    token: masterToken,
  });

  const active = masterRoll.data.combat;
  check('mestre rola pela criatura', active.combatants.find((item: any) => item.id === creatureCombatant.id)?.initiative !== null);
  check('todos rolaram -> combate ativo', active.status === 'ACTIVE');
  check(
    'ordem montada do maior para o menor',
    active.combatants.every((item: any, index: number) => index === 0 || active.combatants[index - 1].initiative >= item.initiative),
    JSON.stringify(active.combatants.map((item: any) => item.initiative)),
  );
  check('turno começa no primeiro da ordem', active.currentIndex === 0 && active.currentCombatantId === active.combatants[0].id);
  check('rodada começa em 1', active.round === 1);
  check('mesa é avisada do primeiro turno', (await turnEvent.catch(() => null)) !== null);

  const nextTurn = await api('/api/combat/next-turn', { method: 'POST', token: masterToken });
  check('mestre avança o turno', nextTurn.data.combat.currentIndex === 1);
  const wrapped = await api('/api/combat/next-turn', { method: 'POST', token: masterToken });
  check(
    'ao passar do último, volta ao início com nova rodada',
    wrapped.data.combat.currentIndex === 0 && wrapped.data.combat.round === 2,
    JSON.stringify({ index: wrapped.data.combat.currentIndex, round: wrapped.data.combat.round }),
  );

  // Ataque: o dano só entra quando acerta a CA.
  const attack = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id },
  });
  const attackResult = attack.data.result;
  check('ataque devolve a rolagem de acerto', attackResult.attackRoll >= 1 && attackResult.attackRoll <= 20);
  check('total do ataque = d20 + bônus', attackResult.attackTotal === attackResult.attackRoll + attackResult.attackBonus);
  check('CA considerada é a do alvo', attackResult.targetArmorClass === 12);
  check('dano só existe quando acerta', attackResult.hit ? attackResult.damageRolled >= 1 : attackResult.damageRolled === 0, JSON.stringify(attackResult));
  check(
    'HP do alvo reflete o dano aplicado',
    attackResult.hit ? attackResult.targetHpCurrent === 20 - attackResult.damageRolled : attackResult.targetHpCurrent === 20,
    JSON.stringify({ hit: attackResult.hit, hp: attackResult.targetHpCurrent, dano: attackResult.damageRolled }),
  );
  check(
    'HP atualizado aparece no estado do combate',
    attack.data.combat.combatants.find((item: any) => item.id === creatureCombatant.id).hpCurrent === attackResult.targetHpCurrent,
  );
  check(
    'jogador NÃO usa o ataque de outra ficha (404)',
    (await api('/api/combat/attack', {
      method: 'POST',
      token: playerToken,
      body: { attackId: 'c1', targetCombatantId: creatureCombatant.id },
    })).status === 404,
  );
  check(
    'não é possível atacar a si mesmo (400)',
    (await api('/api/combat/attack', {
      method: 'POST',
      token: playerToken,
      body: { attackId: 'p1', targetCombatantId: playerCombatant.id },
    })).status === 400,
  );

  // Dano/cura manual do mestre.
  const hpBefore = attackResult.targetHpCurrent;
  const manualDamage = await api('/api/combat/hp', {
    method: 'POST',
    token: masterToken,
    body: { combatantId: creatureCombatant.id, amount: 5, mode: 'damage' },
  });
  check(
    'mestre aplica dano manual',
    manualDamage.data.combat.combatants.find((item: any) => item.id === creatureCombatant.id).hpCurrent === Math.max(0, hpBefore - 5),
  );
  const healed = await api('/api/combat/hp', {
    method: 'POST',
    token: masterToken,
    body: { combatantId: creatureCombatant.id, amount: 3, mode: 'heal' },
  });
  check(
    'cura não passa do HP máximo',
    healed.data.combat.combatants.find((item: any) => item.id === creatureCombatant.id).hpCurrent === Math.min(20, Math.max(0, hpBefore - 5) + 3),
  );
  check(
    'jogador NÃO aplica dano manual (403)',
    (await api('/api/combat/hp', {
      method: 'POST',
      token: playerToken,
      body: { combatantId: creatureCombatant.id, amount: 1, mode: 'damage' },
    })).status === 403,
  );

  // Dano em personagem precisa chegar à ficha dele em tempo real.
  const sheetDamaged = waitFor<any>(playerSocket, 'sheet:updated');
  const beforeSheet = (await api('/api/characters/me', { token: playerToken })).data.character.hpCurrent;
  await api('/api/combat/hp', {
    method: 'POST',
    token: masterToken,
    body: { combatantId: playerCombatant.id, amount: 4, mode: 'damage' },
  });
  const sheetPayload = await sheetDamaged.catch(() => null);
  check('dano em personagem avisa a ficha do dono', sheetPayload !== null);
  check(
    'HP da ficha cai pelo dano do combate',
    sheetPayload?.character?.hpCurrent === beforeSheet - 4,
    `antes ${beforeSheet}, depois ${sheetPayload?.character?.hpCurrent}`,
  );

  const combatEndedEvent = waitFor<any>(playerSocket, 'combat:ended');
  check('mestre encerra o combate', (await api('/api/combat/end', { method: 'POST', token: masterToken })).status === 200);
  check('mesa é avisada do fim do combate', (await combatEndedEvent.catch(() => null)) !== null);
  check('não há mais combate ativo', (await api('/api/combat/active', { token: playerToken })).data.combat === null);
  check(
    'jogador NÃO encerra combate (403)',
    (await api('/api/combat/end', { method: 'POST', token: playerToken })).status === 403,
  );

  // --- 9. Presença ao desconectar -------------------------------------------
  console.log('\n9) Presença ao desconectar');
  const offlinePromise = waitForPresence(
    masterSocket,
    (online) => !online.some((u) => u.username === playerUsername),
  );
  playerSocket.close();
  check('jogador some da presença ao desconectar', (await offlinePromise.catch(() => null)) !== null);

  masterSocket.close();

  console.log(
    failures === 0
      ? '\n✅ Todos os testes passaram.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
}

async function cleanup(): Promise<void> {
  // Combates criados pelo teste (os combatentes somem em cascata).
  if (createdCombatIds.length > 0) {
    await prisma.combat.deleteMany({ where: { id: { in: createdCombatIds } } });
  }
  // Rede de segurança: se o teste abortou no meio de um combate, não deixa lixo.
  await prisma.combat.deleteMany({ where: { status: { in: ['PENDING_INITIATIVE', 'ACTIVE'] } } });

  if (createdCreatureIds.length > 0) {
    await prisma.creature.deleteMany({ where: { id: { in: createdCreatureIds } } });
  }

  if (createdUsernames.length > 0) {
    // A ficha é removida junto com o usuário (onDelete: Cascade).
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
  }

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error('\n❌ Erro inesperado no smoke test:', error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  });
