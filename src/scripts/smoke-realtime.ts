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

  // --- 7. Presença ao desconectar -------------------------------------------
  console.log('\n7) Presença ao desconectar');
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
