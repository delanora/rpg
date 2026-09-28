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
const createdLocalityIds: string[] = [];
const createdRegionIds: string[] = [];
const createdItemIds: string[] = [];

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

/**
 * Define a lista de classes direto no banco (setup dos testes de regras).
 *
 * O nível de uma classe só muda pelo fluxo de Level Up, então os cenários de
 * nível alto são preparados na fonte antes de exercitar a API.
 */
async function setCharacterClasses(
  userId: string,
  entries: { classKey: string; subclass?: string; level: number }[],
): Promise<void> {
  await prisma.character.update({
    where: { userId },
    data: {
      classes: entries.map((entry) => ({
        classKey: entry.classKey,
        subclass: entry.subclass ?? '',
        level: entry.level,
      })) as any,
    },
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
    body: { name: 'Thoradin', race: 'Anão' },
  });
  check('jogador cria a própria ficha (201)', created.status === 201, JSON.stringify(created.data));

  const sheet = created.data?.character;
  check(
    'ficha nasce sem classe (a primeira classe entra na ficha)',
    (sheet?.classes ?? []).length === 0 && sheet?.level === 0,
    JSON.stringify({ classes: sheet?.classes, level: sheet?.level }),
  );
  check('ficha tem as 18 perícias normalizadas', Object.keys(sheet?.skills ?? {}).length === 18);
  check('ficha tem as 6 salvaguardas normalizadas', Object.keys(sheet?.saves ?? {}).length === 6);
  check('nenhuma perícia começa proficiente', Object.values(sheet?.skills ?? {}).every((s: any) => !s.proficient));
  check(
    'não é possível criar uma segunda ficha (409)',
    (await api('/api/characters/me', { method: 'POST', token: playerToken, body: {} })).status === 409,
  );

  // O nível do personagem não é mais editável diretamente.
  check(
    'PATCH direto do nível é recusado (400)',
    (await api('/api/characters/me', { method: 'PATCH', token: playerToken, body: { level: 5 } })).status === 400,
  );
  check(
    'adicionar classe pela ficha (fora do Level Up) é recusado (400)',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: playerToken,
        body: { classes: [{ classKey: 'fighter' }, { classKey: 'wizard' }] },
      })
    ).status === 400,
  );

  // Regras: nível, modificadores e proficiência (nível preparado na fonte).
  await setCharacterClasses(playerId, [{ classKey: 'fighter', level: 5 }]);
  const rules = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { dexterity: 16, strength: 8, wisdom: 14 },
  });
  const rulesSheet = rules.data?.character;
  check('PATCH aplica os valores', rulesSheet?.level === 5 && rulesSheet?.dexterity === 16);
  check('bônus de proficiência no nível 5 é +3', rulesSheet?.derived?.proficiencyBonus === 3, `recebido: ${rulesSheet?.derived?.proficiencyBonus}`);
  check('modificador de DES 16 é +3', rulesSheet?.derived?.modifiers?.dexterity === 3);
  check('modificador de FOR 8 é -1', rulesSheet?.derived?.modifiers?.strength === -1);
  check('iniciativa = modificador de Destreza', rulesSheet?.derived?.initiative === 3, `recebido: ${rulesSheet?.derived?.initiative}`);
  check(
    'CA é calculada (10 + DES, sem armadura equipada)',
    rulesSheet?.armorClass === 10 + (rulesSheet?.derived?.modifiers?.dexterity ?? 0),
    JSON.stringify({ ca: rulesSheet?.armorClass, automatica: rulesSheet?.derived?.armorClass }),
  );
  check(
    'jogador NÃO define a CA manual (403)',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: playerToken,
        body: { armorClassOverride: 20 },
      })
    ).status === 403,
  );
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
  check('capacidade de carga = FOR × 7,5 (8 × 7,5 = 60 kg)', withItems.data?.character?.derived?.carryingCapacity === 60, `recebido: ${withItems.data?.character?.derived?.carryingCapacity}`);
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

  // A primeira classe exige o pré-requisito de atributo (multiclasse do PHB).
  await api('/api/characters/me', { method: 'POST', token: otherReg.data.token, body: {} });
  check(
    'entrar em Mago sem INT 13 é recusado (400)',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: otherReg.data.token,
        body: { classes: [{ classKey: 'wizard' }] },
      })
    ).status === 400,
  );
  await api('/api/characters/me', {
    method: 'PATCH',
    token: otherReg.data.token,
    body: { intelligence: 15 },
  });
  const otherSheet = await api('/api/characters/me', {
    method: 'PATCH',
    token: otherReg.data.token,
    body: { classes: [{ classKey: 'wizard' }] },
  });
  check(
    'com INT 15 o Mago entra no nível 1',
    otherSheet.status === 200 &&
      otherSheet.data?.character?.classes?.[0]?.classKey === 'wizard' &&
      otherSheet.data?.character?.level === 1,
    JSON.stringify(otherSheet.data),
  );
  check(
    'PV inicial = dado de vida máximo (d6) + CON',
    otherSheet.data?.character?.hpMax === 6 && otherSheet.data?.character?.hpCurrent === 6,
    JSON.stringify({ hpMax: otherSheet.data?.character?.hpMax, hpCurrent: otherSheet.data?.character?.hpCurrent }),
  );
  check(
    'com INT 15 mas CAR 10, entrar em Bardo é recusado (400)',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: otherReg.data.token,
        body: { classes: [{ classKey: 'wizard' }, { classKey: 'bard' }] },
      })
    ).status === 400,
  );

  // --- 7. Criaturas / NPCs ---------------------------------------------------
  console.log('\n7) Criaturas/NPCs (bestiário do mestre)');

  check('regiões exigem autenticação (401)', (await api('/api/regions')).status === 401);
  check(
    'jogador NÃO acessa regiões (403)',
    (await api('/api/regions', { token: playerToken })).status === 403,
  );
  check('localidades exigem autenticação (401)', (await api('/api/localities')).status === 401);
  check(
    'jogador NÃO acessa localidades (403)',
    (await api('/api/localities', { token: playerToken })).status === 403,
  );

  const regionEvent = waitFor<any>(masterSocket, 'region:created');
  const regionCreated = await api('/api/regions', {
    method: 'POST',
    token: masterToken,
    body: {
      name: 'Vale do Teste',
      description: 'Região usada pelo smoke test.',
      notes: 'Anotações do mestre sobre a região.',
    },
  });
  check('mestre cadastra região (201)', regionCreated.status === 201, JSON.stringify(regionCreated.data));
  const region = regionCreated.data?.region;
  createdRegionIds.push(region.id);
  check('região guarda descrição e anotações', region?.description.length > 0 && region?.notes.length > 0);
  check(
    'região nova começa sem localidades',
    region?.localityCount === 0,
    String(region?.localityCount),
  );
  check(
    'mestre recebe region:created em tempo real',
    (await regionEvent.catch(() => null))?.region?.id === region?.id,
  );
  check(
    'região sem nome é recusada (400)',
    (
      await api('/api/regions', { method: 'POST', token: masterToken, body: { name: '  ' } })
    ).status === 400,
  );

  check(
    'localidade sem região é recusada (400)',
    (
      await api('/api/localities', {
        method: 'POST',
        token: masterToken,
        body: { name: 'Local solto' },
      })
    ).status === 400,
  );
  check(
    'localidade em região inexistente é recusada (400)',
    (
      await api('/api/localities', {
        method: 'POST',
        token: masterToken,
        body: { name: 'Local órfão', regionId: 'regiao-que-nao-existe' },
      })
    ).status === 400,
  );

  const localityCreated = await api('/api/localities', {
    method: 'POST',
    token: masterToken,
    body: { name: 'Caverna do Teste', description: 'Local usado pelo smoke test.', regionId: region.id },
  });
  check('mestre cadastra localidade (201)', localityCreated.status === 201, JSON.stringify(localityCreated.data));
  const locality = localityCreated.data?.locality;
  createdLocalityIds.push(locality.id);
  check('localidade pertence à região escolhida', locality?.regionId === region.id);
  check(
    'a região passa a contar a localidade nova',
    (await api(`/api/regions/${region.id}`, { token: masterToken })).data.region.localityCount === 1,
  );

  // Região com localidade é removida em cascata (localidade junto).
  const throwawayRegion = (
    await api('/api/regions', { method: 'POST', token: masterToken, body: { name: 'Região descartável' } })
  ).data.region;
  const throwawayLocality = (
    await api('/api/localities', {
      method: 'POST',
      token: masterToken,
      body: { name: 'Local descartável', regionId: throwawayRegion.id },
    })
  ).data.locality;
  check(
    'mestre remove a região (204)',
    (await api(`/api/regions/${throwawayRegion.id}`, { method: 'DELETE', token: masterToken })).status === 204,
  );
  const afterDelete = (await api('/api/localities', { token: masterToken })).data.localities;
  check(
    'apagar a região apaga as localidades dela',
    !afterDelete.some((item: any) => item.id === throwawayLocality.id),
  );

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
    body: {
      name: 'Goblin',
      kind: 'CREATURE',
      type: 'Humanoide',
      challengeRating: '1/4',
      hpMax: 7,
      armorClass: 15,
      localityIds: [locality.id],
    },
  });
  check('mestre cadastra criatura (201)', createdCreature.status === 201, JSON.stringify(createdCreature.data));
  check(
    'criatura precisa de ao menos uma localidade (400)',
    (
      await api('/api/creatures', {
        method: 'POST',
        token: masterToken,
        body: { name: 'Sem local', localityIds: [] },
      })
    ).status === 400,
  );

  const creature = createdCreature.data?.creature;
  check('criatura nasce com HP atual = máximo', creature?.hpCurrent === 7 && creature?.hpMax === 7);
  check('criatura nasce como CREATURE', creature?.kind === 'CREATURE');
  check(
    'criatura nasce com deslocamento métrico (9 m = 30 pés)',
    creature?.speed === 9,
    String(creature?.speed),
  );
  check('criatura fica vinculada à localidade', creature?.localities?.[0]?.id === locality.id);
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
    body: { name: 'Lobo', type: 'Besta', hpMax: 20, armorClass: 12, localityIds: [locality.id] },
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
    body: { localityId: locality.id, entries: [{ creatureId: wolf.id, quantity: 2 }] },
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
  check('combate registra a localidade', combat.localityId === locality.id);
  check(
    'quantidade gera uma cópia por unidade',
    combat.combatants.filter((item: any) => item.kind === 'CREATURE').length === 2,
  );
  check(
    'cada cópia tem nome próprio',
    combat.combatants.some((item: any) => item.name === 'Lobo 1') &&
      combat.combatants.some((item: any) => item.name === 'Lobo 2'),
  );
  check('cada cópia tem a própria vida', creatureCombatant.hpCurrent === 20 && creatureCombatant.hpMax === 20);
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

  let active = masterRoll.data.combat;
  check('mestre rola pela criatura', active.combatants.find((item: any) => item.id === creatureCombatant.id)?.initiative !== null);

  // Outras fichas de jogador já existentes na mesa também entram no combate; o
  // mestre rola por quem ainda não rolou, para a ordem fechar.
  for (const id of active.combatants
    .filter((item: any) => item.initiative === null)
    .map((item: any) => item.id)) {
    active = (
      await api(`/api/combat/initiative/${id}`, { method: 'POST', token: masterToken })
    ).data.combat;
  }

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

  // Avança até dar a volta e começar a rodada 2 (o número de combatentes varia).
  let wrapped = nextTurn.data.combat;
  while (wrapped.round === 1) {
    wrapped = (await api('/api/combat/next-turn', { method: 'POST', token: masterToken })).data.combat;
  }
  check(
    'ao passar do último, volta ao início com nova rodada',
    wrapped.currentIndex === 0 && wrapped.round === 2,
    JSON.stringify({ index: wrapped.currentIndex, round: wrapped.round }),
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
  check('dano só existe quando acerta', attackResult.hit ? attackResult.damageRolled >= 1 : attackResult.damageRolled === 0, JSON.stringify(attackResult));
  check(
    'jogador NÃO vê a CA da criatura no resultado do ataque',
    attackResult.targetStatsHidden === true && attackResult.targetArmorClass === null,
    JSON.stringify(attackResult),
  );
  check(
    'jogador NÃO vê a vida da criatura no resultado do ataque',
    attackResult.targetHpCurrent === null && attackResult.targetHpMax === null,
  );
  check(
    'jogador NÃO vê a vida da criatura no estado do combate',
    attack.data.combat.combatants.find((item: any) => item.id === creatureCombatant.id)?.statsHidden === true,
  );

  // O mestre enxerga CA e HP normalmente.
  const masterCombat = (await api('/api/combat/active', { token: masterToken })).data.combat;
  const masterCreature = masterCombat.combatants.find((item: any) => item.id === creatureCombatant.id);
  check('mestre vê a CA da criatura', masterCreature.armorClass === 12);
  check(
    'HP do alvo reflete o dano aplicado (visão do mestre)',
    attackResult.hit ? masterCreature.hpCurrent === 20 - attackResult.damageRolled : masterCreature.hpCurrent === 20,
    JSON.stringify({ hit: attackResult.hit, hp: masterCreature.hpCurrent, dano: attackResult.damageRolled }),
  );

  // --- Ladino: features derivadas e Ataque Furtivo automático ----------------
  await setCharacterClasses(playerId, [{ classKey: 'rogue', level: 3 }]);
  const rogueSheet = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: {
        attacks: [
          { id: 'p1', name: 'Adaga', damage: '1d4+3', damageType: 'Perfurante', attackBonus: 10, notes: '', finesse: true, ranged: false },
        ],
      },
    })
  ).data.character;
  check(
    'features de classe liberadas pelo nível (Ataque Furtivo, Ação Ardilosa)',
    rogueSheet.activeFeatures.some((f: any) => f.id === 'sneak-attack') &&
      rogueSheet.activeFeatures.some((f: any) => f.id === 'cunning-action'),
    JSON.stringify(rogueSheet.activeFeatures.map((f: any) => f.id)),
  );
  check(
    'Ataque Furtivo no nível 3 é 2d6',
    rogueSheet.derived.sneakAttack?.expression === '2d6',
    JSON.stringify(rogueSheet.derived.sneakAttack),
  );
  check(
    'Expertise concede 2 espaços no nível 3',
    rogueSheet.derived.expertiseSlots === 2,
    String(rogueSheet.derived.expertiseSlots),
  );
  check(
    'dado de vida do Ladino é d8',
    rogueSheet.derived.hitDie === 8,
    String(rogueSheet.derived.hitDie),
  );

  const sneakAttack = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id },
  });
  const sneakResult = sneakAttack.data.result;
  check(
    'arma sutil soma o Ataque Furtivo ao dano',
    sneakResult.hit
      ? sneakResult.sneakAttack?.expression === '2d6' &&
          sneakResult.damageRolled >= sneakResult.sneakAttack.total + 1
      : sneakResult.sneakAttack === null,
    JSON.stringify(sneakResult),
  );

  // Arma sem sutil/à distância não recebe o dano extra.
  await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      attacks: [
        { id: 'p2', name: 'Maça', damage: '1d6+3', damageType: 'Concussão', attackBonus: 10, notes: '', finesse: false, ranged: false },
      ],
    },
  });
  const plainAttack = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p2', targetCombatantId: creatureCombatant.id },
  });
  check(
    'arma sem sutil/à distância NÃO recebe Ataque Furtivo',
    plainAttack.data.result.sneakAttack === null,
    JSON.stringify(plainAttack.data.result),
  );

  // Nível alto: Mente Escorregadia e conjuração de subclasse.
  await setCharacterClasses(playerId, [{ classKey: 'rogue', level: 15 }]);
  const highRogue = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'rogue', subclass: 'Trapaceiro Arcano' }] },
    })
  ).data.character;
  check(
    'Mente Escorregadia trava a salvaguarda de Sabedoria',
    highRogue.derived.lockedSaves.includes('wisdom'),
    JSON.stringify(highRogue.derived.lockedSaves),
  );
  check(
    'Trapaceiro Arcano conjura com Inteligência (terço-conjurador)',
    highRogue.derived.spellcasting?.ability === 'intelligence',
    JSON.stringify(highRogue.derived.spellcasting),
  );
  check(
    'feature de subclasse aparece nas características',
    highRogue.activeFeatures.some((f: any) => f.id === 'magical-ambush'),
    JSON.stringify(highRogue.activeFeatures.map((f: any) => f.id)),
  );

  // --- Bárbaro: Fúria, contador de usos e efeitos automáticos ---------------
  await setCharacterClasses(playerId, [{ classKey: 'barbarian', level: 9 }]);
  const barbarianSheet = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: {
        attacks: [
          { id: 'p1', name: 'Machado grande', damage: '1d12+3', damageType: 'Cortante', attackBonus: 10, notes: '', finesse: false, ranged: false },
        ],
      },
    })
  ).data.character;
  check('dado de vida do Bárbaro é d12', barbarianSheet.derived.hitDie === 12, String(barbarianSheet.derived.hitDie));
  check(
    'salvaguardas FOR e CON fixas',
    barbarianSheet.derived.lockedSaves.includes('strength') &&
      barbarianSheet.derived.lockedSaves.includes('constitution'),
    JSON.stringify(barbarianSheet.derived.lockedSaves),
  );
  check(
    'Defesa sem Armadura entra na CA (10 + DES + CON)',
    barbarianSheet.derived.armorClass.automatic ===
      10 + barbarianSheet.derived.modifiers.dexterity + barbarianSheet.derived.modifiers.constitution,
    JSON.stringify({ ca: barbarianSheet.derived.armorClass }),
  );
  const rageResource = barbarianSheet.classAdjustments.resources.find((r: any) => r.id === 'rage');
  check('Fúria tem 4 usos no nível 9', rageResource?.max === 4 && rageResource?.remaining === 4, JSON.stringify(rageResource));

  const raging = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classState: { active: ['rage'], used: { rage: 1 } } },
    })
  ).data.character;
  check('Fúria ativa dá +3 de dano no nível 9', raging.classAdjustments.meleeDamageBonus === 3, String(raging.classAdjustments.meleeDamageBonus));
  check(
    'Fúria ativa concede resistência física',
    ['Concussão', 'Perfurante', 'Cortante'].every((type: string) => raging.classAdjustments.resistances.includes(type)),
    JSON.stringify(raging.classAdjustments.resistances),
  );
  const ragingResource = raging.classAdjustments.resources.find((r: any) => r.id === 'rage');
  check('contador de Fúria mostra 1 uso gasto', ragingResource?.remaining === 3, JSON.stringify(ragingResource));
  check(
    'recurso é ligado ao toggle da Fúria',
    raging.classAdjustments.toggles.find((t: any) => t.id === 'rage')?.resourceId === 'rage',
  );

  const rageAttack = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id },
  });
  check(
    'Fúria soma o bônus de dano corpo a corpo',
    rageAttack.data.result.hit ? rageAttack.data.result.damageRolled >= 7 : true,
    JSON.stringify(rageAttack.data.result),
  );

  const longRest = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classState: { active: [], used: {} } },
    })
  ).data.character;
  check(
    'descanso longo repõe os usos de Fúria',
    longRest.classAdjustments.resources.find((r: any) => r.id === 'rage')?.remaining === 4,
    JSON.stringify(longRest.classAdjustments.resources),
  );

  await setCharacterClasses(playerId, [{ classKey: 'barbarian', level: 20 }]);
  const champion = (await api('/api/characters/me', { token: playerToken })).data.character;
  const effectiveStrength = Math.min(champion.strength + 4, 24);
  check(
    'Campeão Primitivo soma +4 de FOR (teto 24)',
    champion.derived.modifiers.strength === Math.floor((effectiveStrength - 10) / 2),
    JSON.stringify({ str: champion.strength, mod: champion.derived.modifiers.strength }),
  );

  // --- Monge: Ki, Artes Marciais, Defesa sem Armadura e subclasses ----------
  await setCharacterClasses(playerId, [{ classKey: 'monk', level: 9 }]);
  const monkSheet = (await api('/api/characters/me', { token: playerToken })).data.character;
  check('dado de vida do Monge é d8', monkSheet.derived.hitDie === 8, String(monkSheet.derived.hitDie));
  check(
    'salvaguardas FOR e DES fixas',
    monkSheet.derived.lockedSaves.includes('strength') &&
      monkSheet.derived.lockedSaves.includes('dexterity'),
    JSON.stringify(monkSheet.derived.lockedSaves),
  );
  check(
    'Defesa sem Armadura do Monge entra na CA (10 + DES + SAB)',
    monkSheet.derived.armorClass.automatic ===
      10 + monkSheet.derived.modifiers.dexterity + monkSheet.derived.modifiers.wisdom,
    JSON.stringify({ ca: monkSheet.derived.armorClass }),
  );
  check(
    'Artes Marciais usa 1d6 no nível 9',
    monkSheet.classAdjustments.martialArtsDie === 6,
    String(monkSheet.classAdjustments.martialArtsDie),
  );
  const kiResource = monkSheet.classAdjustments.resources.find((r: any) => r.id === 'ki');
  check(
    'Ki tem pontos iguais ao nível (9) e recarga curta',
    kiResource?.max === 9 && kiResource?.remaining === 9 && kiResource?.recharge === 'short',
    JSON.stringify(kiResource),
  );
  check(
    'Movimento sem Armadura dá +4,5 m no nível 9',
    monkSheet.classAdjustments.speedBonus === 4.5,
    String(monkSheet.classAdjustments.speedBonus),
  );
  check(
    'Rajada de Golpes consome do recurso Ki',
    monkSheet.classAdjustments.toggles.find((t: any) => t.id === 'flurry-of-blows')?.resourceId === 'ki',
  );

  const monkSpent = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classState: { active: ['flurry-of-blows'], used: { ki: 1 } } },
    })
  ).data.character;
  check(
    'gastar 1 ki deixa o contador em 8/9',
    monkSpent.classAdjustments.resources.find((r: any) => r.id === 'ki')?.remaining === 8,
    JSON.stringify(monkSpent.classAdjustments.resources),
  );

  // Subclasse do Monge (Mão Aberta) e nível alto.
  await setCharacterClasses(playerId, [
    { classKey: 'monk', level: 17, subclass: 'Caminho da Mão Aberta' },
  ]);
  const openHand = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Artes Marciais usa 1d10 no nível 17',
    openHand.classAdjustments.martialArtsDie === 10,
    String(openHand.classAdjustments.martialArtsDie),
  );
  check(
    'Movimento sem Armadura dá +7,5 m no nível 17',
    openHand.classAdjustments.speedBonus === 7.5,
    String(openHand.classAdjustments.speedBonus),
  );
  check(
    'Totalidade do Corpo tem 1 uso por descanso longo',
    openHand.classAdjustments.resources.find((r: any) => r.id === 'wholeness-of-body')?.max === 1,
    JSON.stringify(openHand.classAdjustments.resources),
  );

  await setCharacterClasses(playerId, [
    { classKey: 'monk', level: 14, subclass: 'Caminho da Mão Aberta' },
  ]);
  const diamondSoul = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Alma de Diamante proficiência em todas as salvaguardas',
    ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].every(
      (ability: string) => diamondSoul.derived.lockedSaves.includes(ability),
    ),
    JSON.stringify(diamondSoul.derived.lockedSaves),
  );

  // --- Druida: Forma Selvagem, limite de CR e magias preparadas -------------
  await setCharacterClasses(playerId, [{ classKey: 'druid', level: 2 }]);
  const druidSheet = (await api('/api/characters/me', { token: playerToken })).data.character;
  check('dado de vida do Druida é d8', druidSheet.derived.hitDie === 8, String(druidSheet.derived.hitDie));
  check(
    'salvaguardas INT e SAB fixas',
    druidSheet.derived.lockedSaves.includes('intelligence') &&
      druidSheet.derived.lockedSaves.includes('wisdom'),
    JSON.stringify(druidSheet.derived.lockedSaves),
  );
  const wildShape = druidSheet.classAdjustments.resources.find((r: any) => r.id === 'wild-shape');
  check(
    'Forma Selvagem tem 2 usos e recarga curta no nível 2',
    wildShape?.max === 2 && wildShape?.remaining === 2 && wildShape?.recharge === 'short',
    JSON.stringify(wildShape),
  );
  check(
    'limite de CR da Forma Selvagem é 1/4 no nível 2 e sem voo',
    druidSheet.classAdjustments.wildShapeCr === 0.25 &&
      druidSheet.classAdjustments.wildShapeFlying === false,
    JSON.stringify({ cr: druidSheet.classAdjustments.wildShapeCr, fly: druidSheet.classAdjustments.wildShapeFlying }),
  );
  check(
    'Druida prepara mod. de SAB + nível magias (mínimo 1)',
    druidSheet.derived.preparedSpellCount ===
      Math.max(1, druidSheet.derived.modifiers.wisdom + 2),
    JSON.stringify({ prepared: druidSheet.derived.preparedSpellCount, wis: druidSheet.derived.modifiers.wisdom }),
  );

  await setCharacterClasses(playerId, [{ classKey: 'druid', level: 8 }]);
  const druidHigh = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Forma Selvagem sobe para CR 1 e libera voo no nível 8',
    druidHigh.classAdjustments.wildShapeCr === 1 && druidHigh.classAdjustments.wildShapeFlying === true,
    JSON.stringify({ cr: druidHigh.classAdjustments.wildShapeCr, fly: druidHigh.classAdjustments.wildShapeFlying }),
  );

  await setCharacterClasses(playerId, [{ classKey: 'druid', level: 6 }]);
  const moonDruid = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'druid', subclass: 'Círculo da Lua' }] },
    })
  ).data.character;
  check(
    'Círculo da Lua eleva o limite de CR para 2 no nível 6',
    moonDruid.classAdjustments.wildShapeCr === 2,
    String(moonDruid.classAdjustments.wildShapeCr),
  );

  await setCharacterClasses(playerId, [
    { classKey: 'druid', level: 20, subclass: 'Círculo da Lua' },
  ]);
  const archdruid = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Arquidruida torna a Forma Selvagem ilimitada',
    archdruid.classAdjustments.resources.find((r: any) => r.id === 'wild-shape')?.unlimited === true,
    JSON.stringify(archdruid.classAdjustments.resources),
  );

  // --- Feiticeiro: Pontos de Feitiçaria e Linhagem Dracônica ----------------
  await setCharacterClasses(playerId, [{ classKey: 'sorcerer', level: 6 }]);
  const sorcererSheet = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'sorcerer', subclass: 'Linhagem Dracônica' }] },
    })
  ).data.character;
  check('dado de vida do Feiticeiro é d6', sorcererSheet.derived.hitDie === 6, String(sorcererSheet.derived.hitDie));
  check(
    'salvaguardas CON e CAR fixas',
    sorcererSheet.derived.lockedSaves.includes('constitution') &&
      sorcererSheet.derived.lockedSaves.includes('charisma'),
    JSON.stringify(sorcererSheet.derived.lockedSaves),
  );
  const sorceryPoints = sorcererSheet.classAdjustments.resources.find(
    (r: any) => r.id === 'sorcery-points',
  );
  check(
    'pontos de feitiçaria iguais ao nível (6) e recarga longa',
    sorceryPoints?.max === 6 && sorceryPoints?.remaining === 6 && sorceryPoints?.recharge === 'long',
    JSON.stringify(sorceryPoints),
  );
  check(
    'Resiliência Dracônica soma +1 PV por nível (+6 no nível 6)',
    sorcererSheet.classAdjustments.hpBonus === 6,
    String(sorcererSheet.classAdjustments.hpBonus),
  );
  check(
    'CA sem armadura dracônica é 13 + DES',
    sorcererSheet.derived.armorClass.automatic === 13 + sorcererSheet.derived.modifiers.dexterity,
    String(sorcererSheet.derived.armorClass.automatic),
  );
  check(
    'Feiticeiro (conjurador conhecido) não tem limite de preparadas',
    sorcererSheet.derived.preparedSpellCount === null,
    JSON.stringify(sorcererSheet.derived.preparedSpellCount),
  );

  // --- Mago: grimório, Recuperação Arcana, Couraça Arcana e Presságio ------
  await setCharacterClasses(playerId, [{ classKey: 'wizard', level: 6 }]);
  const wizardSheet = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'wizard', subclass: 'Escola de Abjuração' }] },
    })
  ).data.character;
  check('dado de vida do Mago é d6', wizardSheet.derived.hitDie === 6, String(wizardSheet.derived.hitDie));
  check(
    'salvaguardas INT e SAB fixas',
    wizardSheet.derived.lockedSaves.includes('intelligence') &&
      wizardSheet.derived.lockedSaves.includes('wisdom'),
    JSON.stringify(wizardSheet.derived.lockedSaves),
  );
  check(
    'Mago prepara mod. de INT + nível magias do grimório',
    wizardSheet.derived.preparedSpellCount ===
      Math.max(1, wizardSheet.derived.modifiers.intelligence + 6),
    JSON.stringify({ prepared: wizardSheet.derived.preparedSpellCount }),
  );
  const ward = wizardSheet.classAdjustments.resources.find((r: any) => r.id === 'arcane-ward');
  check(
    'Couraça Arcana = 2 × nível + mod. de INT (no nível 6)',
    ward?.max === 2 * 6 + wizardSheet.derived.modifiers.intelligence &&
      ward?.remaining === ward?.max,
    JSON.stringify(ward),
  );

  const diviner = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'wizard', subclass: 'Escola de Adivinhação' }] },
    })
  ).data.character;
  check(
    'Presságio tem 2 dados no nível 6',
    diviner.classAdjustments.resources.find((r: any) => r.id === 'portent')?.max === 2,
    JSON.stringify(diviner.classAdjustments.resources),
  );

  await setCharacterClasses(playerId, [
    { classKey: 'wizard', level: 14, subclass: 'Escola de Adivinhação' },
  ]);
  const divinerHigh = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Presságio Maior eleva para 3 dados no nível 14',
    divinerHigh.classAdjustments.resources.find((r: any) => r.id === 'portent')?.max === 3,
    JSON.stringify(divinerHigh.classAdjustments.resources.find((r: any) => r.id === 'portent')),
  );

  await setCharacterClasses(playerId, [
    { classKey: 'wizard', level: 20, subclass: 'Escola de Adivinhação' },
  ]);
  const wizard20 = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Magias Assinatura aparece no nível 20',
    wizard20.activeFeatures.some((f: any) => f.id === 'signature-spells'),
    JSON.stringify(wizard20.activeFeatures.map((f: any) => f.id)),
  );
  check(
    'Mago tem as 8 Escolas de Magia',
    wizard20.classes?.[0]?.subclassNames?.length === 8,
    JSON.stringify(wizard20.classes?.[0]?.subclassNames),
  );

  const evoker = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'wizard', subclass: 'Escola de Evocação' }] },
    })
  ).data.character;
  check(
    'Evocação libera Moldar Magias no nível 2',
    evoker.activeFeatures.some((f: any) => f.id === 'sculpt-spells'),
    JSON.stringify(evoker.activeFeatures.map((f: any) => f.id)),
  );

  const necromancer = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: { classes: [{ classKey: 'wizard', subclass: 'Escola de Necromancia' }] },
    })
  ).data.character;
  check(
    'Necromancia concede resistência a dano necrótico no nível 10',
    necromancer.classAdjustments.resistances.includes('Necrótico'),
    JSON.stringify(necromancer.classAdjustments.resistances),
  );

  // --- Multiclasse: soma de features, magia combinada e ASI por classe ------
  console.log('\n8.5) Multiclasse (regras combinadas)');

  // Bárbaro 3 / Ladino 2: as duas classes valem ao mesmo tempo.
  await setCharacterClasses(playerId, [
    { classKey: 'barbarian', level: 3 },
    { classKey: 'rogue', level: 2 },
  ]);
  const multiclass = (await api('/api/characters/me', { token: playerToken })).data.character;
  check('nível total soma as classes (3 + 2 = 5)', multiclass.level === 5, String(multiclass.level));
  check(
    'nome composto mostra as duas classes',
    multiclass.className === 'Bárbaro 3 / Ladino 2',
    String(multiclass.className),
  );
  check(
    'features das duas classes coexistem',
    multiclass.activeFeatures.some((f: any) => f.id === 'rage') &&
      multiclass.activeFeatures.some((f: any) => f.id === 'sneak-attack'),
    JSON.stringify(multiclass.activeFeatures.map((f: any) => f.id)),
  );
  check(
    'Fúria escala com o nível de Bárbaro (3 usos no nível 3)',
    multiclass.classAdjustments.resources.find((r: any) => r.id === 'rage')?.max === 3,
    JSON.stringify(multiclass.classAdjustments.resources.find((r: any) => r.id === 'rage')),
  );
  check(
    'Ataque Furtivo escala com o nível de Ladino (1d6 no nível 2)',
    multiclass.derived.sneakAttack?.expression === '1d6',
    JSON.stringify(multiclass.derived.sneakAttack),
  );
  check(
    'salvaguardas fixas somam as duas classes',
    ['strength', 'constitution', 'dexterity', 'intelligence'].every((ability: string) =>
      multiclass.derived.lockedSaves.includes(ability),
    ),
    JSON.stringify(multiclass.derived.lockedSaves),
  );
  check(
    'ASI/Talento são por classe (Ladino: 4/8/10/12/16/19)',
    JSON.stringify(multiclass.classes.find((c: any) => c.classKey === 'rogue')?.asiLevels) ===
      JSON.stringify([4, 8, 10, 12, 16, 19]),
    JSON.stringify(multiclass.classes.map((c: any) => ({ key: c.classKey, asi: c.asiLevels }))),
  );
  check(
    'XP do próximo nível vem do nível total (5 → 14000)',
    multiclass.derived.xpForNextLevel === 14000,
    String(multiclass.derived.xpForNextLevel),
  );

  // Magia combinada: Mago 5 (completo) + Clérigo 3 (completo) = conjurador 8.
  await setCharacterClasses(playerId, [
    { classKey: 'wizard', level: 5 },
    { classKey: 'cleric', level: 3 },
  ]);
  const caster = (await api('/api/characters/me', { token: playerToken })).data.character;
  const slotsAt = (level: number): number | undefined =>
    caster.derived.spellSlots.find((slot: any) => slot.level === level)?.max;
  check(
    'magia combinada usa o nível de conjurador somado (Mago 5 + Clérigo 3 = 8)',
    slotsAt(1) === 4 && slotsAt(2) === 3 && slotsAt(3) === 3 && slotsAt(4) === 2,
    JSON.stringify(caster.derived.spellSlots),
  );

  // Meio-conjurador arredonda para baixo: Paladino 5 = 2 níveis de conjurador.
  await setCharacterClasses(playerId, [
    { classKey: 'wizard', level: 3 },
    { classKey: 'paladin', level: 5 },
  ]);
  const halfCaster = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'meio-conjurador conta metade do nível (Mago 3 + Paladino 5 = 5)',
    halfCaster.derived.spellSlots.find((s: any) => s.level === 3)?.max === 2,
    JSON.stringify(halfCaster.derived.spellSlots),
  );

  // Bruxo fica fora da soma e usa Magia de Pacto própria.
  await setCharacterClasses(playerId, [
    { classKey: 'wizard', level: 3 },
    { classKey: 'warlock', level: 4 },
  ]);
  const pact = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Magia de Pacto é calculada à parte (Bruxo 4: 2 espaços de 2º)',
    pact.derived.pactSlots?.max === 2 && pact.derived.pactSlots?.slotLevel === 2,
    JSON.stringify(pact.derived.pactSlots),
  );
  check(
    'Bruxo não entra na soma dos espaços combinados (só Mago 3)',
    pact.derived.spellSlots.find((s: any) => s.level === 1)?.max === 4 &&
      pact.derived.spellSlots.find((s: any) => s.level === 2)?.max === 2 &&
      !pact.derived.spellSlots.some((s: any) => s.level === 3),
    JSON.stringify(pact.derived.spellSlots),
  );

  // A conjuração da SUBCLASSE conta na soma: Ladino 6 Trapaceiro Arcano vale
  // como 2 níveis de conjurador (2 espaços de 1º na tabela combinada).
  await setCharacterClasses(playerId, [
    { classKey: 'rogue', level: 6, subclass: 'Trapaceiro Arcano' },
  ]);
  const thirdCaster = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'subclasse terço-conjuradora entra na soma (Ladino 6 = conjurador 2)',
    thirdCaster.derived.spellSlots.find((s: any) => s.level === 1)?.max === 3 &&
      !thirdCaster.derived.spellSlots.some((s: any) => s.level === 2),
    JSON.stringify(thirdCaster.derived.spellSlots),
  );

  // --- Itens, ícones e avatar ------------------------------------------------
  console.log('\n9) Itens, ícones e avatar');

  const itemCreatedEvent = waitFor<any>(playerSocket, 'item:created');
  const itemCreated = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Poção de Cura ${suffix}`,
      category: 'Poção',
      weight: 0.5,
      description: 'Recupera 2d4+2 pontos de vida.',
    },
  });
  check('mestre cadastra item no catálogo (201)', itemCreated.status === 201, JSON.stringify(itemCreated.data));
  check(
    'novo item do catálogo chega ao jogador em tempo real',
    (await itemCreatedEvent.catch(() => null))?.item?.id === itemCreated.data?.item?.id,
  );
  const catalogItem = itemCreated.data?.item;
  createdItemIds.push(catalogItem.id);
  check('item guarda a categoria e o peso', catalogItem?.category === 'Poção' && catalogItem?.weight === 0.5);

  // Cada categoria aceita atributos próprios; o preço é exclusivo do mestre.
  const weaponCreated = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Espada Longa ${suffix}`,
      category: 'Arma',
      weight: 3,
      details: { damageCount: 2, damageDie: 6, damageType: 'Cortante', attackBonus: 5 },
      price: { gold: 15, silver: 0, copper: 0 },
    },
  });
  const weapon = weaponCreated.data?.item;
  createdItemIds.push(weapon.id);
  check(
    'arma guarda dano (qtd/tipo/dado) e bônus de ataque',
    weapon?.details?.damageCount === 2 &&
      weapon?.details?.damageDie === 6 &&
      weapon?.details?.damageType === 'Cortante' &&
      weapon?.details?.attackBonus === 5,
    JSON.stringify(weapon?.details),
  );
  check(
    'preço em PO/PP/PC volta para o mestre',
    weapon?.price?.gold === 15 && weapon?.price?.silver === 0 && weapon?.price?.copper === 0,
    JSON.stringify(weapon?.price),
  );
  check(
    'jogador NÃO vê o preço ao buscar o item',
    (await api(`/api/items/${weapon.id}`, { token: playerToken })).data?.item?.price === null,
  );
  check(
    'jogador NÃO vê o preço na listagem do catálogo',
    (await api('/api/items', { token: playerToken })).data.items.find(
      (item: any) => item.id === weapon.id,
    )?.price === null,
  );

  const armorCreated = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Cota de Malha ${suffix}`,
      category: 'Armadura',
      weight: 55,
      // `damageCount` não pertence a Armadura — deve ser descartado ao salvar.
      details: { armorClassBonus: 4, damageCount: 2 },
      price: { gold: 75, silver: 0, copper: 0 },
    },
  });
  const armor = armorCreated.data?.item;
  createdItemIds.push(armor.id);
  check(
    'armadura guarda a CA adicional e descarta atributos de outra categoria',
    armor?.details?.armorClassBonus === 4 && armor?.details?.damageCount === undefined,
    JSON.stringify(armor?.details),
  );

  const recategorized = await api(`/api/items/${armor.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: { category: 'Poção' },
  });
  check(
    'trocar a categoria limpa os atributos antigos',
    recategorized.status === 200 && recategorized.data?.item?.details?.armorClassBonus === undefined,
    JSON.stringify(recategorized.data?.item?.details),
  );
  check(
    'jogador NÃO edita o item do catálogo (403)',
    (await api(`/api/items/${armor.id}`, { method: 'PATCH', token: playerToken, body: { name: 'x' } })).status === 403,
  );

  check(
    'jogador NÃO cria item no catálogo (403)',
    (await api('/api/items', { method: 'POST', token: playerToken, body: { name: 'x' } })).status === 403,
  );
  check(
    'jogador lista o catálogo (sem preço)',
    (await api('/api/items', { token: playerToken })).data.items.some((item: any) => item.id === catalogItem.id),
  );

  const playerSheetBefore = (await api('/api/characters/me', { token: playerToken })).data.character;
  const sendSheetEvent = waitFor<any>(playerSocket, 'sheet:updated');
  const sentItem = await api(`/api/items/${catalogItem.id}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: playerSheetBefore.id, quantity: 3 },
  });
  check('mestre envia item ao inventário do jogador (201)', sentItem.status === 201, JSON.stringify(sentItem.data));
  const sendPayload = await sendSheetEvent.catch(() => null);
  check(
    'envio do item avisa a ficha do jogador em tempo real',
    Boolean(sendPayload?.character?.inventory?.some((entry: any) => entry.itemId === catalogItem.id)),
    JSON.stringify(sendPayload?.changes),
  );

  const afterSend = (await api('/api/characters/me', { token: playerToken })).data.character;
  const received = afterSend.inventory.find((entry: any) => entry.itemId === catalogItem.id);
  check(
    'item enviado chega ao inventário com nome/peso/descrição do catálogo',
    Boolean(received) && received.quantity === 3 && received.weight === 0.5 && received.description.length > 0,
    JSON.stringify(received),
  );
  check('item enviado guarda o vínculo com o catálogo', received?.itemId === catalogItem.id);

  await api(`/api/items/${weapon.id}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: playerSheetBefore.id, quantity: 1 },
  });
  const afterWeaponSend = (await api('/api/characters/me', { token: playerToken })).data.character;
  const weaponInInventory = afterWeaponSend.inventory.find((entry: any) => entry.itemId === weapon.id);
  check(
    'item enviado leva categoria e atributos ao inventário',
    weaponInInventory?.category === 'Arma' &&
      weaponInInventory?.details?.damageCount === 2 &&
      weaponInInventory?.details?.attackBonus === 5,
    JSON.stringify(weaponInInventory),
  );
  check(
    'preço NUNCA entra no inventário do jogador',
    weaponInInventory !== undefined && weaponInInventory.price === undefined,
    JSON.stringify(weaponInInventory),
  );

  // --- Equipamento (slots + mochila) e endpoint de mover item ---------------
  const equipSheet = (await api('/api/characters/me', { token: playerToken })).data.character;
  const potion = equipSheet.inventory.find((entry: any) => entry.itemId === catalogItem.id);
  const blade = equipSheet.inventory.find((entry: any) => entry.itemId === weapon.id);
  check(
    'item enviado entra na mochila sem slot nem posição',
    potion?.slot === null && potion?.backpackX === null && potion?.backpackY === null,
    JSON.stringify({ slot: potion?.slot, x: potion?.backpackX, y: potion?.backpackY }),
  );

  const moveEvent = waitFor<any>(playerSocket, 'sheet:updated');
  const equipped = await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: playerToken,
    body: { itemInventoryId: blade.id, targetSlot: 'hand1' },
  });
  check(
    'equipar em um slot grava o slot e limpa a posição da mochila',
    equipped.data?.character?.inventory?.find((e: any) => e.id === blade.id)?.slot === 'hand1',
    JSON.stringify(equipped.data),
  );
  check('mover item avisa a ficha em tempo real', (await moveEvent.catch(() => null)) !== null);

  const backpacked = await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: playerToken,
    body: { itemInventoryId: potion.id, targetBackpackX: 2, targetBackpackY: 4 },
  });
  const potionAfter = backpacked.data?.character?.inventory?.find((e: any) => e.id === potion.id);
  check(
    'mover para a mochila grava a célula e zera o slot',
    potionAfter?.slot === null && potionAfter?.backpackX === 2 && potionAfter?.backpackY === 4,
    JSON.stringify(potionAfter),
  );

  // Troca: equipar a poção no hand1 devolve a espada para a célula (2,4).
  const swapped = await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: playerToken,
    body: { itemInventoryId: potion.id, targetSlot: 'hand1' },
  });
  const swappedInv: any[] = swapped.data?.character?.inventory ?? [];
  const potionSwapped = swappedInv.find((e) => e.id === potion.id);
  const bladeSwapped = swappedInv.find((e) => e.id === blade.id);
  check(
    'equipar em slot ocupado troca com o item que estava lá',
    potionSwapped?.slot === 'hand1' &&
      bladeSwapped?.slot === null &&
      bladeSwapped?.backpackX === 2 &&
      bladeSwapped?.backpackY === 4,
    JSON.stringify(swappedInv.map((e) => ({ id: e.id, slot: e.slot, x: e.backpackX, y: e.backpackY }))),
  );

  check(
    'slot inválido é recusado (400)',
    (
      await api('/api/characters/me/inventory/move', {
        method: 'POST',
        token: playerToken,
        body: { itemInventoryId: potion.id, targetSlot: 'cape' },
      })
    ).status === 400,
  );

  // --- Inventário espelha o catálogo ---------------------------------------
  const itemSyncEvent = waitFor<any>(playerSocket, 'sheet:updated');
  const itemPatched = await api(`/api/items/${weapon.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      name: `Espada Longa Afiada ${suffix}`,
      weight: 2.5,
      description: 'Lâmina reforçada pelo mestre.',
    },
  });
  check('mestre edita o item do catálogo (200)', itemPatched.status === 200);

  const syncPayload = await itemSyncEvent.catch(() => null);
  const syncedEntry = syncPayload?.character?.inventory?.find(
    (entry: any) => entry.itemId === weapon.id,
  );
  check('quem tem o item recebe a ficha republicada', syncPayload !== null);
  check(
    'inventário passa a mostrar o nome, o peso e a descrição novos',
    syncedEntry?.name === `Espada Longa Afiada ${suffix}` &&
      syncedEntry?.weight === 2.5 &&
      syncedEntry?.description === 'Lâmina reforçada pelo mestre.',
    JSON.stringify(syncedEntry),
  );
  check('a quantidade do jogador é preservada', syncedEntry?.quantity === 1, String(syncedEntry?.quantity));

  // Edição local em um campo do catálogo é sobrescrita pelo espelho.
  const locallyEdited = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      inventory: afterWeaponSend.inventory.map((entry: any) =>
        entry.itemId === weapon.id ? { ...entry, name: 'Nome local', weight: 99 } : entry,
      ),
    },
  });
  const mirrored = locallyEdited.data?.character?.inventory?.find(
    (entry: any) => entry.itemId === weapon.id,
  );
  check(
    'dados do catálogo vencem a edição local',
    mirrored?.name === `Espada Longa Afiada ${suffix}` && mirrored?.weight === 2.5,
    JSON.stringify(mirrored),
  );

  await api(`/api/items/${catalogItem.id}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: playerSheetBefore.id, quantity: 1_000_000 },
  });
  const afterBulk = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'mestre envia grandes quantidades e os envios se acumulam',
    afterBulk.inventory.find((entry: any) => entry.itemId === catalogItem.id)?.quantity === 3 + 1_000_000,
  );

  // Ícone de criatura e avatar de jogador refletem no combate.
  await api(`/api/creatures/${wolf.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: { imageUrl: '/uploads/creatures/teste.png' },
  });
  const combatWithIcons = (await api('/api/combat/active', { token: masterToken })).data.combat;
  check(
    'ícone da criatura aparece no combatente',
    combatWithIcons.combatants.find((item: any) => item.id === creatureCombatant.id)?.imageUrl === '/uploads/creatures/teste.png',
  );

  const avatarSheetEvent = waitFor<any>(masterSocket, 'sheet:updated');
  await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { avatarUrl: '/uploads/characters/avatar.png' },
  });
  check(
    'avatar do jogador avisa o mestre em tempo real',
    (await avatarSheetEvent.catch(() => null))?.character?.avatarUrl === '/uploads/characters/avatar.png',
  );
  const combatWithAvatar = (await api('/api/combat/active', { token: masterToken })).data.combat;
  check(
    'avatar do personagem aparece no combatente',
    combatWithAvatar.combatants.find((item: any) => item.id === playerCombatant.id)?.imageUrl === '/uploads/characters/avatar.png',
  );

  check(
    'upload de avatar é aberto ao jogador (400 de validação, não 403)',
    (await api('/api/uploads/avatar', { method: 'POST', token: playerToken, body: {} })).status === 400,
  );
  check(
    'upload de imagem geral continua exclusivo do mestre (403)',
    (await api('/api/uploads/image', { method: 'POST', token: playerToken, body: { dataUrl: 'x' } })).status === 403,
  );

  // Os ataques acima mudaram o HP da criatura; atualiza a referência usada
  // pelos checks de dano manual abaixo.
  Object.assign(
    masterCreature,
    (await api('/api/combat/active', { token: masterToken })).data.combat.combatants.find(
      (item: any) => item.id === creatureCombatant.id,
    ),
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
  const hpBefore = masterCreature.hpCurrent;
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

  // Dano em personagem precisa chegar à ficha dele em tempo real. Os PV
  // temporários são preparados na fonte (sem PATCH, que geraria evento) e o
  // dano deve abatê-los antes do HP atual.
  await prisma.character.update({
    where: { userId: playerId },
    data: { hpCurrent: 20, hpTemp: 3 },
  });
  const sheetDamaged = waitFor<any>(playerSocket, 'sheet:updated');
  await api('/api/combat/hp', {
    method: 'POST',
    token: masterToken,
    body: { combatantId: playerCombatant.id, amount: 4, mode: 'damage' },
  });
  const sheetPayload = await sheetDamaged.catch(() => null);
  check('dano em personagem avisa a ficha do dono', sheetPayload !== null);
  check(
    'dano consome os PV temporários antes do HP atual',
    sheetPayload?.character?.hpTemp === 0 && sheetPayload?.character?.hpCurrent === 19,
    JSON.stringify({ hpTemp: sheetPayload?.character?.hpTemp, hpCurrent: sheetPayload?.character?.hpCurrent }),
  );

  const combatEndedEvent = waitFor<any>(playerSocket, 'combat:ended');
  check('mestre encerra o combate', (await api('/api/combat/end', { method: 'POST', token: masterToken })).status === 200);
  check('mesa é avisada do fim do combate', (await combatEndedEvent.catch(() => null)) !== null);
  check('não há mais combate ativo', (await api('/api/combat/active', { token: playerToken })).data.combat === null);
  check(
    'jogador NÃO encerra combate (403)',
    (await api('/api/combat/end', { method: 'POST', token: playerToken })).status === 403,
  );

  // --- 10. Apresentação de imagens ("mostrar aos jogadores") ----------------
  console.log('\n10) Apresentação de imagens para a mesa');

  check(
    'jogador NÃO apresenta imagem (403)',
    (
      await api('/api/presentation', {
        method: 'POST',
        token: playerToken,
        body: { imageUrl: '/uploads/characters/qualquer.png' },
      })
    ).status === 403,
  );
  check(
    'endereço de imagem inválido é recusado (400)',
    (
      await api('/api/presentation', {
        method: 'POST',
        token: masterToken,
        body: { imageUrl: 'javascript:alert(1)' },
      })
    ).status === 400,
  );

  const presented = waitFor<any>(playerSocket, 'presentation:shown');
  const presentResponse = await api('/api/presentation', {
    method: 'POST',
    token: masterToken,
    body: { imageUrl: '/uploads/localities/mapa.png', alt: 'Mapa da masmorra' },
  });
  check('mestre apresenta a imagem (201)', presentResponse.status === 201, JSON.stringify(presentResponse.data));

  const presentedPayload = await presented.catch(() => null);
  check('jogador recebe a imagem apresentada', presentedPayload !== null);
  check(
    'imagem apresentada chega com o rótulo',
    presentedPayload?.presentation?.alt === 'Mapa da masmorra' &&
      presentedPayload?.presentation?.imageUrl === '/uploads/localities/mapa.png',
  );
  check(
    'quem apresentou é carimbado pelo token, não pelo corpo',
    presentedPayload?.presentation?.presentedBy === 'Mestre Teste',
    `recebido: ${presentedPayload?.presentation?.presentedBy}`,
  );
  check(
    'apresentação em andamento fica disponível na API',
    (await api('/api/presentation', { token: playerToken })).data.presentation?.id ===
      presentedPayload?.presentation?.id,
  );

  // Quem entra no meio da apresentação recebe a imagem já aberta.
  const lateSocket = connect(playerToken);
  const latePresentation = await waitFor<any>(lateSocket, 'presentation:shown').catch(() => null);
  check(
    'quem conecta depois recebe a apresentação em andamento',
    latePresentation?.presentation?.id === presentedPayload?.presentation?.id,
  );
  lateSocket.close();

  check(
    'jogador NÃO fecha a imagem (403)',
    (await api('/api/presentation/close', { method: 'POST', token: playerToken })).status === 403,
  );

  const closed = waitFor<any>(playerSocket, 'presentation:closed');
  check(
    'mestre fecha a imagem (204)',
    (await api('/api/presentation/close', { method: 'POST', token: masterToken })).status === 204,
  );
  check('mesa é avisada do fechamento', (await closed.catch(() => null)) !== null);
  check(
    'não há mais apresentação em andamento',
    (await api('/api/presentation', { token: playerToken })).data.presentation === null,
  );

  // --- 11. Mestre edita a ficha do jogador ----------------------------------
  console.log('\n11) Mestre edita a ficha do jogador');
  const playerSheetId = (await api('/api/characters/me', { token: playerToken })).data.character.id;

  check(
    'jogador NÃO edita a ficha de ninguém por id (403)',
    (
      await api(`/api/characters/${playerSheetId}`, {
        method: 'PATCH',
        token: playerToken,
        body: { name: 'Invadido' },
      })
    ).status === 403,
  );
  check(
    'PATCH vazio do mestre é recusado (400)',
    (
      await api(`/api/characters/${playerSheetId}`, {
        method: 'PATCH',
        token: masterToken,
        body: {},
      })
    ).status === 400,
  );
  check(
    'mestre NÃO edita ficha inexistente (404)',
    (
      await api('/api/characters/ficha-que-nao-existe', {
        method: 'PATCH',
        token: masterToken,
        body: { name: 'Fantasma' },
      })
    ).status === 404,
  );

  const masterEditEvent = waitFor<any>(playerSocket, 'sheet:updated');
  const masterEdit = await api(`/api/characters/${playerSheetId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { notes: 'ajustado pelo mestre', strength: 10 },
  });
  check('mestre edita a ficha do jogador (200)', masterEdit.status === 200, JSON.stringify(masterEdit.data));
  check(
    'resposta recalcula os valores derivados',
    masterEdit.data.character?.derived?.modifiers?.strength === 0,
    `mod FOR ${masterEdit.data.character?.derived?.modifiers?.strength}`,
  );
  check(
    'edição do mestre NÃO muda o nível (400 se tentar)',
    (
      await api(`/api/characters/${playerSheetId}`, {
        method: 'PATCH',
        token: masterToken,
        body: { level: 3 },
      })
    ).status === 400,
  );

  const masterEditPayload = await masterEditEvent.catch(() => null);
  check('jogador é avisado da edição do mestre', masterEditPayload !== null);
  check(
    'evento marca quem editou (editedBy)',
    masterEditPayload?.editedBy === 'Mestre Teste',
    `recebido: ${masterEditPayload?.editedBy}`,
  );
  check('a ficha continua sendo do jogador', masterEditPayload?.username === playerUsername);
  check(
    'alteração do mestre aparece na ficha do jogador',
    (await api('/api/characters/me', { token: playerToken })).data.character?.notes ===
      'ajustado pelo mestre',
  );

  // A edição do próprio jogador não traz `editedBy`.
  const ownEditEvent = waitFor<any>(playerSocket, 'sheet:updated');
  await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: { notes: 'anotação do jogador' },
  });
  const ownEditPayload = await ownEditEvent.catch(() => null);
  check(
    'edição do próprio jogador não marca editedBy',
    ownEditPayload !== null && ownEditPayload?.editedBy === undefined,
    `recebido: ${ownEditPayload?.editedBy}`,
  );

  // --- 11.5 Level Up controlado pelo mestre ---------------------------------
  console.log('\n11.5) Level Up liberado pelo mestre');

  const initialConfig = await api('/api/game', { token: playerToken });
  check('configuração da mesa é acessível ao jogador (200)', initialConfig.status === 200);
  check(
    'jogador NÃO controla o Level Up (403)',
    (
      await api('/api/game/level-up', {
        method: 'POST',
        token: playerToken,
        body: { unlocked: true },
      })
    ).status === 403,
  );

  const releaseBefore = initialConfig.data?.config?.levelUpRelease ?? 0;
  const configEvent = waitFor<any>(playerSocket, 'game:config');
  const unlocked = await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: true },
  });
  check(
    'mestre libera o Level Up (200)',
    unlocked.status === 200 && unlocked.data?.config?.levelUpUnlocked === true,
    JSON.stringify(unlocked.data),
  );
  check(
    'cada liberação incrementa o contador',
    unlocked.data?.config?.levelUpRelease === releaseBefore + 1,
    JSON.stringify({ before: releaseBefore, after: unlocked.data?.config?.levelUpRelease }),
  );
  check('jogador recebe a liberação em tempo real', (await configEvent.catch(() => null)) !== null);

  const unlockedAgain = await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: true },
  });
  check(
    'liberar de novo sem bloquear NÃO gera nova liberação',
    unlockedAgain.data?.config?.levelUpRelease === releaseBefore + 1,
    JSON.stringify(unlockedAgain.data?.config),
  );

  await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: false },
  });
  const relocked = await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: true },
  });
  check(
    'desligar e ligar de novo gera nova liberação',
    relocked.data?.config?.levelUpRelease === releaseBefore + 2,
    JSON.stringify(relocked.data?.config),
  );
  check(
    'ficha expõe a última liberação usada (0 para esta ficha nova)',
    (await api('/api/characters/me', { token: playerToken })).data.character
      ?.lastLevelUpRelease === 0,
  );

  // Devolve a mesa ao estado inicial (desligado).
  await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: false },
  });

  // --- 11.7 Assistente de Level Up ------------------------------------------
  console.log('\n11.7) Level Up (assistente)');

  const otherToken = otherReg.data.token;

  /** Cada liberação precisa de um desligar → ligar para valer para o próximo nível. */
  async function unlockForLevelUp(): Promise<void> {
    await api('/api/game/level-up', {
      method: 'POST',
      token: masterToken,
      body: { unlocked: false },
    });
    await api('/api/game/level-up', {
      method: 'POST',
      token: masterToken,
      body: { unlocked: true },
    });
  }

  await unlockForLevelUp();
  check(
    'subir sem escolher a subclasse liberada é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: otherToken,
        body: { classKey: 'wizard', hp: 'average' },
      })
    ).status === 400,
  );
  check(
    'multiclassar sem o pré-requisito é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: otherToken,
        body: { classKey: 'barbarian', hp: 'average' },
      })
    ).status === 400,
  );

  const otherBefore = (await api('/api/characters/me', { token: otherToken })).data.character;
  const levelTwo = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: otherToken,
    body: { classKey: 'wizard', subclass: 'Escola de Abjuração', hp: 'average' },
  });
  check('sobe de nível usando a média (200)', levelTwo.status === 200, JSON.stringify(levelTwo.data));
  check('nível total vira 2', levelTwo.data?.character?.level === 2);
  check('a classe sobe para o nível 2', levelTwo.data?.character?.classes?.[0]?.level === 2);
  check(
    'subclasse escolhida é gravada',
    levelTwo.data?.character?.classes?.[0]?.subclass === 'Escola de Abjuração',
    JSON.stringify(levelTwo.data?.character?.classes),
  );
  check(
    'PV máximo sobe com a média (d6 = 4 + CON)',
    levelTwo.data?.character?.hpMax === otherBefore.hpMax + 4,
    `antes ${otherBefore.hpMax}, depois ${levelTwo.data?.character?.hpMax}`,
  );
  check(
    'PV atual sobe junto no Level Up',
    levelTwo.data?.character?.hpCurrent === otherBefore.hpCurrent + 4,
    `antes ${otherBefore.hpCurrent}, depois ${levelTwo.data?.character?.hpCurrent}`,
  );
  check(
    'a mesma liberação não pode ser usada de novo (409)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: otherToken,
        body: { classKey: 'wizard', hp: 'average' },
      })
    ).status === 409,
  );

  // Rolando o dado de vida: quem rola é o servidor.
  await unlockForLevelUp();
  const hpBeforeRoll = levelTwo.data.character.hpMax;
  const levelThree = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: otherToken,
    body: { classKey: 'wizard', hp: 'roll' },
  });
  check('rolar o Dado de Vida aplica o ganho (200)', levelThree.status === 200);
  check(
    'PV sobe ao menos 1 ao rolar',
    levelThree.data?.character?.hpMax >= hpBeforeRoll + 1,
    `antes ${hpBeforeRoll}, depois ${levelThree.data?.character?.hpMax}`,
  );

  // Nível 4 do Mago concede Aumento de Atributo ou Talento.
  await unlockForLevelUp();
  check(
    'nível de ASI sem escolher a progressão é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: otherToken,
        body: { classKey: 'wizard', hp: 'average' },
      })
    ).status === 400,
  );
  const intBefore = (await api('/api/characters/me', { token: otherToken })).data.character
    .intelligence;
  const levelFour = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: otherToken,
    body: {
      classKey: 'wizard',
      hp: 'average',
      abilityIncreases: [{ ability: 'intelligence', amount: 2 }],
    },
  });
  check('nível 4 aplica o Aumento de Atributo (200)', levelFour.status === 200, JSON.stringify(levelFour.data));
  check(
    'INT sobe em 2 com o Aumento de Atributo',
    levelFour.data?.character?.intelligence === intBefore + 2,
    `antes ${intBefore}, depois ${levelFour.data?.character?.intelligence}`,
  );

  // Talento: registrado como característica textual.
  await setCharacterClasses(playerId, [{ classKey: 'fighter', level: 3, subclass: 'Campeão' }]);
  await unlockForLevelUp();
  const featLevel = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'fighter',
      hp: 'average',
      feat: { name: 'Sortudo', description: 'Registro textual do talento.' },
    },
  });
  check('escolher Talento sobe o nível (200)', featLevel.status === 200, JSON.stringify(featLevel.data));
  check('o personagem chega ao nível 4', featLevel.data?.character?.level === 4);
  check(
    'talento fica registrado como característica',
    (featLevel.data?.character?.features ?? []).some(
      (feature: any) => feature.source === 'feat' && feature.name === 'Sortudo',
    ),
    JSON.stringify(featLevel.data?.character?.features),
  );

  // Recálculo retroativo de Constituição (PHB): subir a CON no Level Up soma o
  // ajuste a TODOS os níveis já obtidos, além do PV normal do nível novo.
  await setCharacterClasses(playerId, [{ classKey: 'fighter', level: 3, subclass: 'Campeão' }]);
  await prisma.character.update({ where: { userId: playerId }, data: { constitution: 10 } });
  const conBefore = (await api('/api/characters/me', { token: playerToken })).data.character;
  await unlockForLevelUp();
  const conLevel = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'fighter',
      hp: 'average',
      abilityIncreases: [{ ability: 'constitution', amount: 2 }],
    },
  });
  // d10 média 6 + novo mod. CON (+1) = 7, mais +1 por cada um dos 3 níveis
  // anteriores (nível total 3) → +10 no total.
  check(
    'subir a CON soma o PV retroativo de todos os níveis anteriores',
    conLevel.data?.character?.hpMax === conBefore.hpMax + 10,
    `antes ${conBefore.hpMax}, depois ${conLevel.data?.character?.hpMax}`,
  );
  check(
    'o PV atual acompanha o ganho retroativo de CON',
    conLevel.data?.character?.hpCurrent === conBefore.hpCurrent + 10,
    `antes ${conBefore.hpCurrent}, depois ${conLevel.data?.character?.hpCurrent}`,
  );

  // Devolve a mesa ao estado inicial (desligado).
  await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: false },
  });

  // --- 11.8 Criação finalizada, CA automática e talentos --------------------
  console.log('\n11.8) Fim da criação, CA automática e talentos');

  const openSheet = (await api('/api/characters/me', { token: playerToken })).data.character;
  const playerCharacterId: string = openSheet.id;
  check('a ficha nasce com a criação aberta', openSheet.creationFinalized === false);
  check(
    'o talento escolhido no Level Up está na ficha',
    (openSheet.features ?? []).some((feature: any) => feature.source === 'feat'),
    JSON.stringify(openSheet.features),
  );

  // A CA é CALCULADA: sem armadura vale a maior fórmula (aqui, a Defesa sem
  // Armadura do bárbaro: 10 + DES + CON).
  await setCharacterClasses(playerId, [
    { classKey: 'barbarian', level: 3, subclass: 'Guerreiro Primitivo' },
  ]);
  const unarmored = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'sem armadura, a CA usa a maior fórmula (10 + DES + CON)',
    unarmored.armorClass ===
      10 + unarmored.derived.modifiers.dexterity + unarmored.derived.modifiers.constitution,
    JSON.stringify({ ca: unarmored.armorClass, detalhe: unarmored.derived.armorClass }),
  );

  // Armadura pesada (CA base, sem Destreza) e escudo, direto do catálogo.
  const heavyArmor = (
    await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: 'Cota de malha',
        category: 'Armadura',
        weight: 25,
        details: { armorType: 'Pesada', baseArmorClass: 16 },
      },
    })
  ).data.item;
  createdItemIds.push(heavyArmor.id);
  const shieldItem = (
    await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: { name: 'Escudo', category: 'Escudo', weight: 3, details: { armorClassBonus: 2 } },
    })
  ).data.item;
  createdItemIds.push(shieldItem.id);

  const armorDetails = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: { name: 'Armadura sem tipo', category: 'Armadura', details: { armorClassBonus: 3 } },
  });
  check(
    'tipo e CA base do item de armadura sobrevivem ao cadastro',
    (await api(`/api/items/${heavyArmor.id}`, { token: masterToken })).data.item.details
      .armorType === 'Pesada' &&
      (await api(`/api/items/${heavyArmor.id}`, { token: masterToken })).data.item.details
        .baseArmorClass === 16,
  );
  check(
    'armadura sem tipo nem CA base não guarda campos de peso',
    armorDetails.status === 201 &&
      armorDetails.data?.item?.details?.armorType === undefined &&
      armorDetails.data?.item?.details?.baseArmorClass === undefined,
    JSON.stringify(armorDetails.data?.item?.details),
  );
  createdItemIds.push(armorDetails.data?.item?.id);

  for (const item of [heavyArmor, shieldItem]) {
    await api(`/api/items/${item.id}/send`, {
      method: 'POST',
      token: masterToken,
      body: { characterId: playerCharacterId, quantity: 1 },
    });
  }

  const carryingArmor = (await api('/api/characters/me', { token: playerToken })).data.character;
  const armorEntry = carryingArmor.inventory.find(
    (entry: any) => entry.itemId === heavyArmor.id,
  );
  const shieldEntry = carryingArmor.inventory.find(
    (entry: any) => entry.itemId === shieldItem.id,
  );
  check('armadura e escudo chegam ao inventário', Boolean(armorEntry) && Boolean(shieldEntry));

  await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: playerToken,
    body: { itemInventoryId: armorEntry.id, targetSlot: 'chest' },
  });
  const armored = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'armadura pesada equipada: CA = base, sem Destreza',
    armored.derived.armorClass.armor?.name === 'Cota de malha' &&
      armored.derived.armorClass.dexterityBonus === 0 &&
      armored.armorClass === 16,
    JSON.stringify(armored.derived.armorClass),
  );

  await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: playerToken,
    body: { itemInventoryId: shieldEntry.id, targetSlot: 'hand2' },
  });
  const shielded = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'escudo equipado soma o próprio bônus',
    shielded.derived.armorClass.shieldBonus === 2 && shielded.armorClass === 18,
    JSON.stringify(shielded.derived.armorClass),
  );

  // O mestre pode fixar uma CA manual; o override entra no lugar do cálculo.
  const overrideSheet = (
    await api(`/api/characters/${playerCharacterId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { armorClassOverride: 20 },
    })
  ).data.character;
  check(
    'mestre define a CA manual (override vence o cálculo)',
    overrideSheet.armorClass === 20 && overrideSheet.derived.armorClass.override === 20,
    JSON.stringify(overrideSheet.derived.armorClass),
  );
  const clearedOverride = (
    await api(`/api/characters/${playerCharacterId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { armorClassOverride: null },
    })
  ).data.character;
  check(
    'limpar o override volta ao cálculo automático',
    clearedOverride.armorClass === 18 && clearedOverride.armorClassOverride === null,
  );

  // --- Trava da criação (assistente de criação) -----------------------------
  // A ficha em montagem passa pelo assistente: cada passo grava o que lhe
  // pertence e o ÚLTIMO passo (a revisão) é quem fecha a criação.
  const draftSheet = (await api('/api/characters/me', { token: playerToken })).data.character;
  const draftOpen = await api('/api/characters/me/creation', { token: playerToken });
  check(
    'a criação aberta começa no passo 1 do assistente',
    draftOpen.status === 200 &&
      draftOpen.data?.creation?.step === 1 &&
      draftOpen.data?.creation?.mode === null,
    JSON.stringify(draftOpen.data?.creation),
  );

  const wizardSteps: [number, Record<string, unknown>][] = [
    [1, { mode: 'existing' }],
    [2, { name: draftSheet.name, alignment: 'Leal e Bom' }],
    [3, { race: draftSheet.race }],
    [4, { background: 'Sábio' }],
    [5, { classKey: draftSheet.classes[0].classKey }],
    [
      6,
      {
        baseAbilities: {
          // O bárbaro exige Força 13 e o passo dos atributos confere o
          // pré-requisito da classe: a ficha do smoke tinha Força 8, então o
          // personagem volta do assistente com o mínimo da classe.
          strength: Math.max(13, draftSheet.strength),
          dexterity: draftSheet.dexterity,
          constitution: draftSheet.constitution,
          intelligence: draftSheet.intelligence,
          wisdom: draftSheet.wisdom,
          charisma: draftSheet.charisma,
        },
      },
    ],
    [7, { skills: ['athletics', 'survival'] }],
  ];

  const stepStatuses: number[] = [];
  for (const [step, body] of wizardSteps) {
    const saved = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: playerToken,
      body: { step, ...body },
    });
    stepStatuses.push(saved.status);
  }
  check(
    'assistente: os passos 1 a 7 salvam o progresso (200)',
    stepStatuses.every((status) => status === 200),
    JSON.stringify(stepStatuses),
  );

  const resumed = await api('/api/characters/me/creation', { token: playerToken });
  check(
    'o progresso fica salvo para retomar de onde parou',
    resumed.data?.creation?.step === 8,
    JSON.stringify(resumed.data?.creation?.step),
  );

  const finalized = await api('/api/characters/me/creation/finalize', {
    method: 'POST',
    token: playerToken,
  });
  check(
    'jogador finaliza a criação pelo assistente (200)',
    finalized.status === 200 && finalized.data?.character?.creationFinalized === true,
    JSON.stringify(finalized.data),
  );

  const blockedBodies: [string, Record<string, unknown>][] = [
    ['nome', { name: 'Nome novo' }],
    ['raça', { race: 'Elfo' }],
    ['antecedente', { background: 'Sábio' }],
    ['alinhamento', { alignment: 'Caótico e Bom' }],
    ['experiência', { experience: 9999 }],
    ['atributo', { strength: 20 }],
    ['perícias', { skills: { perception: { proficient: true, expertise: false } } }],
    ['salvaguardas', { saves: { strength: true } }],
    ['classes', { classes: [{ classKey: 'fighter' }] }],
    ['PV máximo', { hpMax: 999 }],
    ['iniciativa', { initiativeBonus: 5 }],
    ['deslocamento', { speed: 20 }],
    ['inventário', { inventory: [] }],
    ['ataques', { attacks: [] }],
    ['características', { features: [] }],
  ];
  for (const [label, body] of blockedBodies) {
    check(
      `criação finalizada: ${label} é recusado (403)`,
      (await api('/api/characters/me', { method: 'PATCH', token: playerToken, body })).status === 403,
    );
  }

  // O que é ESTADO DE JOGO continua liberado.
  const statePatch = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      hpCurrent: 7,
      hpTemp: 3,
      notes: 'Diário de bordo',
      avatarUrl: '/uploads/characters/avatar.png',
      classState: { active: ['rage'], used: { rage: 1 } },
    },
  });
  const stateSheet = statePatch.data?.character;
  check(
    'criação finalizada: PV atual/temporário, anotações, avatar e recursos seguem editáveis (200)',
    statePatch.status === 200 &&
      stateSheet?.hpCurrent === 7 &&
      stateSheet?.hpTemp === 3 &&
      stateSheet?.notes === 'Diário de bordo' &&
      stateSheet?.classState?.active?.includes('rage'),
    JSON.stringify({ status: statePatch.status, hp: stateSheet?.hpCurrent }),
  );

  // Espaços de magia: o USO muda, mas a lista e o TOTAL (da classe) não.
  await api(`/api/characters/${playerCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { spells: { list: [], slots: { '1': { max: 2, used: 0 } } } },
  });
  const slotsPatched = await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      spells: {
        list: [
          { id: 'inventada', name: 'Magia inventada', level: 1, school: '', prepared: false, description: '' },
        ],
        slots: { '1': { max: 9, used: 1 } },
      },
    },
  });
  const slotsAfter = slotsPatched.data?.character?.spells;
  check(
    'criação finalizada: gastar espaço de magia é aceito (200)',
    slotsPatched.status === 200 && slotsAfter?.slots?.['1']?.used === 1,
    JSON.stringify(slotsAfter),
  );
  check(
    'criação finalizada: lista de magias e TOTAL do espaço não mudam',
    (slotsAfter?.list ?? []).length === 0 && slotsAfter?.slots?.['1']?.max === 2,
    JSON.stringify(slotsAfter),
  );

  // O mestre não tem travas — e a mudança chega na ficha do jogador na hora.
  const finalizeEditEvent = waitFor<any>(playerSocket, 'sheet:updated');
  const finalizeEdit = await api(`/api/characters/${playerCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { name: 'Renomeado pelo mestre', strength: 18 },
  });
  check(
    'mestre edita uma ficha finalizada (200)',
    finalizeEdit.status === 200 &&
      finalizeEdit.data?.character?.name === 'Renomeado pelo mestre' &&
      finalizeEdit.data?.character?.strength === 18,
    JSON.stringify(finalizeEdit.data?.character?.creationFinalized),
  );
  check(
    'a edição do mestre chega ao jogador em tempo real',
    (await finalizeEditEvent.catch(() => null))?.character?.name === 'Renomeado pelo mestre',
  );

  // E o Level Up continua sendo o caminho da construção.
  await unlockForLevelUp();
  const afterFinalizeLevel = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'barbarian',
      hp: 'average',
      abilityIncreases: [{ ability: 'strength', amount: 2 }],
    },
  });
  check(
    'criação finalizada: o Level Up continua aplicando a construção (200)',
    afterFinalizeLevel.status === 200 && afterFinalizeLevel.data?.character?.strength === 20,
    JSON.stringify(afterFinalizeLevel.data),
  );
  await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
    body: { unlocked: false },
  });

  // --- 11.9 Rolagem de dados -------------------------------------------------
  console.log('\n11.9) Rolagem de dados (janela de dados)');

  check(
    'pool vazio é recusado (400)',
    (
      await api('/api/dice/roll', {
        method: 'POST',
        token: playerToken,
        body: { dice: [] },
      })
    ).status === 400,
  );

  const publicRollEvent = waitFor<any>(masterSocket, 'dice:roll').catch(() => null);
  const publicRoll = await api('/api/dice/roll', {
    method: 'POST',
    token: playerToken,
    body: { dice: [{ sides: 20 }], kind: 'free', clientId: 'smoke-public' },
  });
  check('rolagem livre pública é aceita (201)', publicRoll.status === 201);
  check(
    'o total de um d20 fica entre 1 e 20',
    publicRoll.data?.roll?.total >= 1 && publicRoll.data?.roll?.total <= 20,
    JSON.stringify(publicRoll.data?.roll),
  );
  check(
    'quem rolou vem da ficha do jogador',
    typeof publicRoll.data?.roll?.actorName === 'string' &&
      publicRoll.data.roll.actorName.length > 0,
    String(publicRoll.data?.roll?.actorName),
  );
  check(
    'o mestre recebe a rolagem em tempo real',
    (await publicRollEvent)?.roll?.id === publicRoll.data?.roll?.id,
  );

  const skillRoll = await api('/api/dice/roll', {
    method: 'POST',
    token: playerToken,
    body: { dice: [{ sides: 20 }], kind: 'skill', label: 'Percepção', bonus: 5, advantage: true },
  });
  const skillDice = skillRoll.data?.roll?.dice ?? [];
  const keptDice = skillDice.filter((die: any) => !die.dropped);
  check(
    'vantagem rola dois d20 e mantém um só',
    skillDice.length === 2 && keptDice.length === 1,
    JSON.stringify(skillDice),
  );
  check(
    'o total soma o d20 mantido e o bônus da perícia',
    skillRoll.data?.roll?.total === keptDice[0]?.value + 5,
    JSON.stringify({ total: skillRoll.data?.roll?.total, kept: keptDice[0]?.value }),
  );

  // Rolagem privada do mestre: não chega a nenhum jogador.
  let playerSawPrivate = false;
  const privateWatcher = (payload: any): void => {
    if (payload?.roll?.isPrivate) playerSawPrivate = true;
  };
  playerSocket.on('dice:roll', privateWatcher);

  const privateRoll = await api('/api/dice/roll', {
    method: 'POST',
    token: masterToken,
    body: { dice: [{ sides: 6 }], kind: 'free', private: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  playerSocket.off('dice:roll', privateWatcher);
  check(
    'rolagem privada do mestre não chega ao jogador',
    privateRoll.status === 201 &&
      privateRoll.data?.roll?.isPrivate === true &&
      playerSawPrivate === false,
  );

  const forcedPublic = await api('/api/dice/roll', {
    method: 'POST',
    token: playerToken,
    body: { dice: [{ sides: 6 }], private: true },
  });
  check(
    'rolagem de jogador é sempre pública',
    forcedPublic.data?.roll?.isPrivate === false,
    JSON.stringify(forcedPublic.data?.roll),
  );

  check(
    'jogador não acessa o histórico (403)',
    (await api('/api/dice/history', { token: playerToken })).status === 403,
  );
  const diceHistory = await api('/api/dice/history', { token: masterToken });
  check(
    'histórico do mestre reúne as rolagens da sessão',
    Array.isArray(diceHistory.data?.rolls) &&
      diceHistory.data.rolls.some((roll: any) => roll.id === privateRoll.data?.roll?.id),
  );
  check(
    'jogador não limpa o histórico (403)',
    (await api('/api/dice/history', { method: 'DELETE', token: playerToken })).status === 403,
  );
  check(
    'mestre limpa o histórico (204)',
    (await api('/api/dice/history', { method: 'DELETE', token: masterToken })).status === 204,
  );
  const clearedHistory = await api('/api/dice/history', { token: masterToken });
  check('histórico fica vazio depois de limpar', (clearedHistory.data?.rolls ?? []).length === 0);

  // --- 11.10 Faixa de rolagem (janela aberta) -------------------------------
  console.log('\n11.10) Faixa de rolagem (janela de dados aberta)');

  const playerUserId = playerReg.data?.user?.id;

  check(
    'aviso de janela inválido é recusado (400)',
    (
      await api('/api/dice/active', {
        method: 'POST',
        token: playerToken,
        body: { active: 'sim' },
      })
    ).status === 400,
  );

  const bannerEvent = waitFor<any>(masterSocket, 'dice:active').catch(() => null);
  const opened = await api('/api/dice/active', {
    method: 'POST',
    token: playerToken,
    body: {
      active: true,
      kind: 'skill',
      label: 'Percepção',
      pool: [{ sides: 20, locked: true }, { sides: 6 }],
      advantage: true,
      bonus: 5,
    },
  });
  check(
    'abrir a janela responde com quem está rolando',
    opened.status === 200 && opened.data?.activeRoll?.userId === playerUserId,
    JSON.stringify(opened.data),
  );

  const banner = await bannerEvent;
  check(
    'o mestre recebe a faixa com nome, foto e o teste',
    banner?.active === true &&
      banner?.actorName === publicRoll.data?.roll?.actorName &&
      typeof banner?.avatarUrl === 'string' &&
      banner?.label === 'Percepção',
    JSON.stringify(banner),
  );
  check(
    'o tabuleiro montado vai junto (pool, vantagem e bônus)',
    banner?.board?.pool?.length === 2 &&
      banner?.board?.pool?.[0]?.sides === 20 &&
      banner?.board?.pool?.[0]?.locked === true &&
      banner?.board?.advantage === true &&
      banner?.board?.bonus === 5 &&
      banner?.board?.phase === 'idle',
    JSON.stringify(banner?.board),
  );
  check(
    'o pool anunciado é validado (401 dados não passam)',
    (
      await api('/api/dice/active', {
        method: 'POST',
        token: playerToken,
        body: { active: true, pool: Array.from({ length: 60 }, () => ({ sides: 6 })) },
      })
    ).status === 400,
  );

  // Rolar: o próprio pedido de rolagem avisa a mesa de que os dados estão
  // caindo. O anúncio tem de sair do servidor (e não de um segundo pedido do
  // cliente) para nunca chegar depois do resultado — era isso que deixava o
  // dado na tela de quem assiste sem o total.
  const tumblingEvent = waitFor<any>(masterSocket, 'dice:active').catch(() => null);
  const rolling = await api('/api/dice/roll', {
    method: 'POST',
    token: playerToken,
    body: { dice: [{ sides: 20 }], advantage: true, bonus: 5, kind: 'skill', label: 'Percepção' },
  });
  check(
    'a rolagem identifica o dono (para casar com o tabuleiro)',
    rolling.data?.roll?.actorUserId === playerUserId,
    String(rolling.data?.roll?.actorUserId),
  );

  const tumbling = await tumblingEvent;
  check('a mesa é avisada de que os dados estão rolando', tumbling?.board?.phase === 'tumbling');
  check(
    'o anúncio da queda ainda não carrega resultado',
    tumbling?.lastRoll === null,
    JSON.stringify(tumbling?.lastRoll),
  );
  check(
    'quem sincroniza depois recebe o resultado guardado no tabuleiro',
    (await api('/api/dice/active', { token: masterToken })).data?.activeRoll?.lastRoll?.id ===
      rolling.data?.roll?.id,
    JSON.stringify((await api('/api/dice/active', { token: masterToken })).data?.activeRoll),
  );

  // Quem entra no meio da rolagem já recebe a faixa — e com o resultado, para
  // não ver só os dados parados.
  const lateDiceSocket = connect(playerToken);
  const lateBanner = await waitFor<any>(lateDiceSocket, 'dice:active').catch(() => null);
  check(
    'quem conecta depois recebe a faixa em andamento',
    lateBanner?.active === true && lateBanner?.userId === playerUserId,
  );
  check(
    'quem conecta depois também recebe o resultado',
    lateBanner?.lastRoll?.id === rolling.data?.roll?.id,
    JSON.stringify(lateBanner?.lastRoll),
  );
  lateDiceSocket.close();

  // Mexer no tabuleiro descarta o resultado guardado (espelha a janela).
  await api('/api/dice/active', {
    method: 'POST',
    token: playerToken,
    body: {
      active: true,
      kind: 'skill',
      label: 'Percepção',
      pool: [{ sides: 20, locked: true }, { sides: 6 }],
      advantage: true,
      bonus: 5,
    },
  });
  check(
    'mexer no pool descarta o resultado anterior',
    (await api('/api/dice/active', { token: masterToken })).data?.activeRoll?.lastRoll === null,
  );

  check(
    'a mesa consulta quem está rolando',
    (await api('/api/dice/active', { token: masterToken })).data?.activeRoll?.label ===
      'Percepção',
  );

  // Janela privada do mestre: não vira faixa e não derruba a de quem já estava
  // rolando.
  let playerSawActive = false;
  const activeWatcher = (payload: any): void => {
    if (payload?.userId !== playerUserId) playerSawActive = true;
  };
  playerSocket.on('dice:active', activeWatcher);

  const privateWindow = await api('/api/dice/active', {
    method: 'POST',
    token: masterToken,
    body: { active: true, private: true, kind: 'free' },
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  playerSocket.off('dice:active', activeWatcher);
  check(
    'janela privada do mestre não vira faixa para o jogador',
    privateWindow.status === 200 &&
      privateWindow.data?.activeRoll?.userId === playerUserId &&
      playerSawActive === false,
    JSON.stringify({ state: privateWindow.data, playerSawActive }),
  );
  check(
    'a rolagem de quem já estava na mesa continua anunciada',
    (await api('/api/dice/active', { token: playerToken })).data?.activeRoll?.userId ===
      playerUserId,
  );

  const closedBanner = waitFor<any>(masterSocket, 'dice:active').catch(() => null);
  check(
    'fechar a janela desfaz a faixa (200)',
    (await api('/api/dice/active', { method: 'POST', token: playerToken, body: { active: false } }))
      .status === 200,
  );
  check('a mesa é avisada de que a rolagem acabou', (await closedBanner)?.active === false);
  check(
    'ninguém mais aparece como rolando',
    (await api('/api/dice/active', { token: masterToken })).data?.activeRoll === null,
  );

  // --- 11.11 Assistente de criação de personagem ---------------------------
  console.log('\n11.11) Assistente de criação de personagem');

  // Um jogador novo (sem ficha) é quem percorre o assistente do começo.
  const rookieUsername = `criacao_${suffix}`;
  createdUsernames.push(rookieUsername);
  const rookieReg = await api('/api/auth/register', {
    method: 'POST',
    body: { username: rookieUsername, displayName: 'Criação Teste', password: 'senha-forte-123' },
  });
  const rookieToken: string = rookieReg.data?.token;
  check(
    'jogador novo cadastrado para o assistente (201)',
    rookieReg.status === 201 && Boolean(rookieToken),
    JSON.stringify(rookieReg.data),
  );

  const emptyCreation = await api('/api/characters/me/creation', { token: rookieToken });
  check(
    'sem ficha, o assistente abre no passo 1 e sem personagem',
    emptyCreation.status === 200 &&
      emptyCreation.data?.character === null &&
      emptyCreation.data?.creation?.step === 1 &&
      emptyCreation.data?.creation?.mode === null,
    JSON.stringify(emptyCreation.data?.creation),
  );
  check(
    'o assistente traz o nível inicial da mesa e os catálogos',
    emptyCreation.data?.creation?.startingLevel === 1 &&
      Array.isArray(emptyCreation.data?.creation?.raceCatalog) &&
      Array.isArray(emptyCreation.data?.creation?.backgroundCatalog),
    JSON.stringify(emptyCreation.data?.creation),
  );

  // Passo 1: o rascunho É a ficha (criada aqui), com a criação em aberto.
  const stepOne = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 1, mode: 'new' },
  });
  const rookieCharacterId: string = stepOne.data?.character?.id;
  check(
    'passo 1 cria o rascunho (personagem novo, criação em aberto)',
    stepOne.status === 200 &&
      Boolean(rookieCharacterId) &&
      stepOne.data?.character?.creationFinalized === false &&
      stepOne.data?.creation?.step === 2,
    JSON.stringify({ status: stepOne.status, creation: stepOne.data?.creation }),
  );
  check(
    'o rascunho já aparece para o mestre (ficha em andamento)',
    (await api('/api/characters', { token: masterToken })).data?.characters?.some(
      (entry: any) => entry.id === rookieCharacterId && entry.creationFinalized === false,
    ),
  );

  // Rolagem de atributo: 4d6 descartando o menor, pelo mesmo mecanismo da
  // janela de dados (o dado é sorteado no servidor).
  const firstRoll = await api('/api/characters/me/creation/roll', {
    method: 'POST',
    token: rookieToken,
    body: {},
  });
  const rolled = firstRoll.data?.roll;
  const rollTotal = (roll: any): number =>
    roll.dice.reduce((sum: number, value: number, index: number) =>
      index === roll.dropped ? sum : sum + value,
      0,
    );
  check(
    'rolagem de criação: 4d6 com o MENOR dado descartado',
    firstRoll.status === 201 &&
      rolled?.dice?.length === 4 &&
      rolled?.dropped === rolled?.dice?.indexOf(Math.min(...(rolled?.dice ?? []))) &&
      rolled?.value === rollTotal(rolled),
    JSON.stringify(rolled),
  );
  check(
    'a rolagem fica guardada no rascunho (para distribuir depois)',
    firstRoll.data?.creation?.rolls?.length === 1,
    JSON.stringify(firstRoll.data?.creation?.rolls),
  );

  const creationHistory = await api('/api/dice/history', { token: masterToken });
  const creationEntry = (creationHistory.data?.rolls ?? []).find(
    (roll: any) => roll.kind === 'creation',
  );
  check(
    'a rolagem entra no histórico do mestre como "Criação de personagem"',
    creationEntry?.label === 'Criação de personagem',
    JSON.stringify(creationEntry),
  );

  // Seis valores por criação: a sétima rolagem só depois de "rolar novamente".
  for (let index = 0; index < 5; index += 1) {
    await api('/api/characters/me/creation/roll', { method: 'POST', token: rookieToken, body: {} });
  }
  check(
    'os seis valores já rolados são recusados na sétima rolagem (409)',
    (
      await api('/api/characters/me/creation/roll', {
        method: 'POST',
        token: rookieToken,
        body: {},
      })
    ).status === 409,
  );
  const restarted = await api('/api/characters/me/creation/roll', {
    method: 'POST',
    token: rookieToken,
    body: { restart: true },
  });
  check(
    '"rolar novamente" recomeça os seis valores',
    restarted.status === 201 && restarted.data?.creation?.rolls?.length === 1,
    JSON.stringify(restarted.data?.creation?.rolls),
  );

  // Distribuição: os valores têm de ser EXATAMENTE os rolados.
  for (let index = 0; index < 5; index += 1) {
    await api('/api/characters/me/creation/roll', {
      method: 'POST',
      token: rookieToken,
      body: {},
    });
  }
  const sixRolls = await api('/api/characters/me/creation', { token: rookieToken });
  check(
    'o rascunho guarda as seis rolagens (para distribuir depois)',
    sixRolls.data?.creation?.rolls?.length === 6,
    JSON.stringify(sixRolls.data?.creation?.rolls?.length),
  );

  const forged = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: {
      step: 6,
      baseAbilities: {
        strength: 1,
        dexterity: 1,
        constitution: 1,
        intelligence: 1,
        wisdom: 1,
        charisma: 1,
      },
    },
  });
  check(
    'distribuir valores que não foram rolados é recusado (400)',
    forged.status === 400,
    JSON.stringify(forged.data),
  );

  // O resto do assistente é feito no modo "personagem existente" (valores
  // digitados), que é determinístico para os testes.
  check(
    'voltar ao passo 1 e trocar o modo é aceito (200)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 1, mode: 'existing' },
      })
    ).status === 200,
  );

  const walkSteps: [number, Record<string, unknown>][] = [
    [2, { name: 'Teste do Assistente', alignment: 'Neutro e Bom' }],
    [3, { race: 'Anão' }],
    [4, { background: 'Sábio' }],
  ];
  const walkStatuses: number[] = [];
  for (const [step, body] of walkSteps) {
    const walked = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: rookieToken,
      body: { step, ...body },
    });
    walkStatuses.push(walked.status);
  }
  check(
    'identidade, raça e antecedente são salvos passo a passo (200)',
    walkStatuses.every((status) => status === 200),
    JSON.stringify(walkStatuses),
  );

  check(
    'finalizar com passos faltando é recusado com a lista do que falta (400)',
    (
      await api('/api/characters/me/creation/finalize', { method: 'POST', token: rookieToken })
    ).status === 400,
  );

  // A classe é escolhida ANTES dos atributos: o pré-requisito é conferido no
  // passo seguinte, com os valores finais (Paladino exige Força 13 e Carisma 13).
  const paladinClass = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 5, classKey: 'paladin' },
  });
  check(
    'a classe é escolhida mesmo antes de os atributos existirem (200)',
    paladinClass.status === 200 && paladinClass.data?.character?.classes?.[0]?.classKey === 'paladin',
    JSON.stringify(paladinClass.data?.character?.classes),
  );

  const paladinAbilities = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: {
      step: 6,
      baseAbilities: {
        strength: 15,
        dexterity: 14,
        constitution: 14,
        intelligence: 10,
        wisdom: 12,
        charisma: 8,
      },
    },
  });
  check(
    'atributos sem o pré-requisito da classe devolvem o que falta (400)',
    paladinAbilities.status === 400 &&
      String(paladinAbilities.data?.message ?? '').includes('Carisma'),
    JSON.stringify(paladinAbilities.data),
  );

  const barbarianClass = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 5, classKey: 'barbarian' },
  });
  check(
    'trocar a classe inicial pelo assistente é aceito (200)',
    barbarianClass.status === 200 &&
      barbarianClass.data?.character?.classes?.[0]?.classKey === 'barbarian',
    JSON.stringify(barbarianClass.data?.character?.classes),
  );

  const badAbilities = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: {
      step: 6,
      baseAbilities: {
        strength: 8,
        dexterity: 14,
        constitution: 14,
        intelligence: 10,
        wisdom: 12,
        charisma: 8,
      },
    },
  });
  check(
    'atributos sem o pré-requisito da classe são recusados com o que falta (400)',
    badAbilities.status === 400 && String(badAbilities.data?.message ?? '').includes('faltam'),
    JSON.stringify(badAbilities.data),
  );

  const goodAbilities = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: {
      step: 6,
      baseAbilities: {
        strength: 15,
        dexterity: 14,
        constitution: 14,
        intelligence: 10,
        wisdom: 12,
        charisma: 8,
      },
    },
  });
  const rookieSheet = goodAbilities.data?.character;
  check(
    'os atributos são gravados e o PV de nível 1 usa o dado de vida + CON',
    goodAbilities.status === 200 &&
      rookieSheet?.strength === 15 &&
      rookieSheet?.hpMax === 12 + 2 &&
      rookieSheet?.hpCurrent === 14,
    JSON.stringify({ hpMax: rookieSheet?.hpMax, abilities: rookieSheet?.strength }),
  );

  // Perícias: quantidade e lista vêm da classe (Bárbaro escolhe 2).
  const wrongSkills = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 7, skills: ['athletics'] },
  });
  const outsideSkills = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 7, skills: ['arcana', 'history'] },
  });
  check(
    'perícias fora da lista da classe são recusadas (400)',
    wrongSkills.status === 400 && outsideSkills.status === 400,
    JSON.stringify({ wrongSkills: wrongSkills.data, outsideSkills: outsideSkills.data }),
  );

  const skillsStep = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 7, skills: ['athletics', 'survival'] },
  });
  check(
    'as perícias escolhidas ficam proficientes na ficha (200)',
    skillsStep.status === 200 &&
      skillsStep.data?.character?.skills?.athletics?.proficient === true &&
      skillsStep.data?.character?.skills?.survival?.proficient === true,
    JSON.stringify(skillsStep.data?.character?.skills),
  );

  check(
    'passo 8 no nível inicial da mesa (1) é aceito (200)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 8 },
      })
    ).status === 200,
  );

  const rookieFinalized = await api('/api/characters/me/creation/finalize', {
    method: 'POST',
    token: rookieToken,
  });
  check(
    'passo 9 fecha a criação (200)',
    rookieFinalized.status === 200 &&
      rookieFinalized.data?.character?.creationFinalized === true,
    JSON.stringify(rookieFinalized.data),
  );

  check(
    'criação finalizada: o assistente não aceita mais passos (409)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 2, name: 'Outro nome' },
      })
    ).status === 409,
  );
  check(
    'o jogador não reabre a própria criação (403)',
    (
      await api(`/api/characters/${rookieCharacterId}/creation/reopen`, {
        method: 'POST',
        token: rookieToken,
      })
    ).status === 403,
  );

  // Só o mestre reabre — e o assistente volta com o que já existia preenchido.
  const reopened = await api(`/api/characters/${rookieCharacterId}/creation/reopen`, {
    method: 'POST',
    token: masterToken,
  });
  check(
    'o mestre reabre a criação (200)',
    reopened.status === 200 && reopened.data?.character?.creationFinalized === false,
    JSON.stringify(reopened.data?.character?.creationFinalized),
  );

  const afterReopen = await api('/api/characters/me/creation', { token: rookieToken });
  check(
    'reaberta, a criação volta ao passo 1 com os valores atuais como base',
    afterReopen.data?.creation?.step === 1 &&
      afterReopen.data?.creation?.mode === 'existing' &&
      afterReopen.data?.creation?.baseAbilities?.strength === 15,
    JSON.stringify(afterReopen.data?.creation),
  );

  // Nível inicial da mesa: o passo 8 aplica os níveis SEM a liberação do mestre.
  const startingLevelSet = await api('/api/game/starting-level', {
    method: 'POST',
    token: masterToken,
    body: { level: 2 },
  });
  check(
    'o mestre define o nível inicial da mesa (200)',
    startingLevelSet.status === 200 && startingLevelSet.data?.config?.startingLevel === 2,
    JSON.stringify(startingLevelSet.data?.config),
  );
  check(
    'o assistente passa a exigir o nível inicial (2)',
    (await api('/api/characters/me/creation', { token: rookieToken })).data?.creation
      ?.startingLevel === 2,
  );
  check(
    'passo 8 sem ter aplicado os níveis iniciais é recusado (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 8 },
      })
    ).status === 400,
  );

  const creationLevel = await api('/api/characters/me/creation/level-up', {
    method: 'POST',
    token: rookieToken,
    body: { classKey: 'barbarian', hp: 'average' },
  });
  check(
    'o assistente aplica o nível inicial sem a liberação do mestre (200)',
    creationLevel.status === 200 && creationLevel.data?.character?.level === 2,
    JSON.stringify({ status: creationLevel.status, level: creationLevel.data?.character?.level }),
  );
  check(
    'o nível inicial não consome a liberação de Level Up do jogador',
    creationLevel.data?.character?.lastLevelUpRelease === 0,
    JSON.stringify(creationLevel.data?.character?.lastLevelUpRelease),
  );

  const reopenWalk: [number, Record<string, unknown>][] = [
    [2, { name: 'Teste do Assistente' }],
    [3, { race: 'Anão' }],
    [4, { background: 'Sábio' }],
    [5, { classKey: 'barbarian' }],
    [
      6,
      {
        baseAbilities: {
          strength: 15,
          dexterity: 14,
          constitution: 14,
          intelligence: 10,
          wisdom: 12,
          charisma: 8,
        },
      },
    ],
    [7, { skills: ['athletics', 'survival'] }],
    [8, {}],
  ];
  const reopenStatuses: number[] = [];
  for (const [step, body] of reopenWalk) {
    const walked = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: rookieToken,
      body: { step, ...body },
    });
    reopenStatuses.push(walked.status);
  }
  check(
    'a criação reaberta percorre os passos de novo (200)',
    reopenStatuses.every((status) => status === 200),
    JSON.stringify(reopenStatuses),
  );

  const rookieRefinalized = await api('/api/characters/me/creation/finalize', {
    method: 'POST',
    token: rookieToken,
  });
  check(
    'a criação reaberta é finalizada no nível inicial da mesa',
    rookieRefinalized.status === 200 &&
      rookieRefinalized.data?.character?.creationFinalized === true &&
      rookieRefinalized.data?.character?.level === 2,
    JSON.stringify({
      status: rookieRefinalized.status,
      level: rookieRefinalized.data?.character?.level,
    }),
  );

  await api('/api/game/starting-level', {
    method: 'POST',
    token: masterToken,
    body: { level: 1 },
  });

  // --- 12. Presença ao desconectar ------------------------------------------
  console.log('\n12) Presença ao desconectar');
  const offlinePromise = waitForPresence(
    masterSocket,
    (online) => !online.some((u) => u.username === playerUsername),
  );
  playerSocket.close();
  check('jogador some da presença ao desconectar', (await offlinePromise.catch(() => null)) !== null);

  masterSocket.close();

  // --- 13. Exclusão de personagem (com a conta do jogador) ------------------
  console.log('\n13) Exclusão de personagem pelo mestre');

  const ownSheet = await api('/api/characters/me', { token: playerToken });
  const doomedCharacterId: string = ownSheet.data?.character?.id;
  check('a ficha a excluir existe', Boolean(doomedCharacterId), JSON.stringify(ownSheet.data));

  check(
    'jogador NÃO exclui personagem (403)',
    (
      await api(`/api/characters/${doomedCharacterId}`, {
        method: 'DELETE',
        token: playerToken,
      })
    ).status === 403,
  );

  check(
    'excluir ficha inexistente devolve 404',
    (await api('/api/characters/nao-existe', { method: 'DELETE', token: masterToken })).status === 404,
  );

  // A conta do mestre é a chave da mesa: esta rota não apaga ficha de mestre.
  const masterSheet = await api('/api/characters/me', {
    method: 'POST',
    token: masterToken,
    body: {},
  });
  check(
    'a conta de um mestre não é excluída por esta rota (403)',
    (
      await api(`/api/characters/${masterSheet.data?.character?.id}`, {
        method: 'DELETE',
        token: masterToken,
      })
    ).status === 403,
    JSON.stringify(masterSheet.data),
  );

  // Combate de apoio: o personagem excluído também sai da ordem de iniciativa.
  const doomedCombat = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { entries: [] },
  });
  createdCombatIds.push(doomedCombat.data?.combat?.id);
  check(
    'o combate de apoio traz o personagem que será excluído',
    doomedCombat.data?.combat?.combatants?.some(
      (item: any) => item.ownerUserId === playerUserId,
    ) === true,
    JSON.stringify(doomedCombat.data),
  );

  const logBefore = await api('/api/dice/history', { token: masterToken });
  const playerRollsBefore = (logBefore.data?.rolls ?? []).filter(
    (item: any) => item.actorUserId === playerUserId,
  );
  check('o log do mestre tem rolagens do personagem', playerRollsBefore.length > 0);

  const masterBackSocket = connect(masterToken);
  const playerBackSocket = connect(playerToken);
  await Promise.all([
    waitFor<any>(masterBackSocket, 'connection:ready').catch(() => null),
    waitFor<any>(playerBackSocket, 'connection:ready').catch(() => null),
  ]);

  const masterWatch = waitFor<any>(masterBackSocket, 'character:deleted');
  const playerWatch = waitFor<any>(playerBackSocket, 'character:deleted').catch(() => null);
  const playerDropped = waitFor<any>(playerBackSocket, 'disconnect').catch(() => null);

  const removal = await api(`/api/characters/${doomedCharacterId}`, {
    method: 'DELETE',
    token: masterToken,
  });
  check('o mestre exclui o personagem (204)', removal.status === 204, `status ${removal.status}`);
  check(
    'o painel do mestre é avisado da exclusão',
    (await masterWatch.catch(() => null))?.characterId === doomedCharacterId,
  );
  check('o dono recebe o aviso antes de ser derrubado', (await playerWatch)?.userId === playerUserId);
  check('a sessão da conta excluída é derrubada', (await playerDropped) !== null);

  const charactersAfter = await api('/api/characters', { token: masterToken });
  check(
    'a ficha sai da lista de fichas do mestre',
    Array.isArray(charactersAfter.data?.characters) &&
      !charactersAfter.data.characters.some((item: any) => item.id === doomedCharacterId),
  );
  check(
    'a conta do jogador sai da lista de usuários',
    !(await api('/api/users', { token: masterToken })).data.users.some(
      (item: any) => item.username === playerUsername,
    ),
  );
  check(
    'o personagem sai do combate em andamento',
    !(await api('/api/combat/active', { token: masterToken })).data.combat.combatants.some(
      (item: any) => item.ownerUserId === playerUserId || item.characterId === doomedCharacterId,
    ),
  );

  const logAfter = await api('/api/dice/history', { token: masterToken });
  check(
    'as rolagens do personagem saem do log do mestre',
    (logAfter.data?.rolls ?? []).every((item: any) => item.actorUserId !== playerUserId) &&
      logAfter.data.rolls.length === logBefore.data.rolls.length - playerRollsBefore.length,
  );

  check(
    'o token do jogador excluído não vale mais (401)',
    (await api('/api/characters/me', { token: playerToken })).status === 401,
  );
  check(
    'a conexão WebSocket da conta excluída é recusada',
    await new Promise<boolean>((resolve) => {
      const socket = connect(playerToken);
      const done = (refused: boolean): void => {
        socket.close();
        resolve(refused);
      };
      socket.on('connect_error', () => done(true));
      socket.on('connect', () => done(false));
      setTimeout(() => done(false), 3000);
    }),
  );
  check(
    'a conta excluída não faz login de novo (401)',
    (
      await api('/api/auth/login', {
        method: 'POST',
        body: { username: playerUsername, password: 'senha-forte-123' },
      })
    ).status === 401,
  );

  masterBackSocket.close();

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

  if (createdRegionIds.length > 0) {
    // As localidades dentro delas caem em cascata.
    await prisma.region.deleteMany({ where: { id: { in: createdRegionIds } } });
  }

  if (createdLocalityIds.length > 0) {
    await prisma.locality.deleteMany({ where: { id: { in: createdLocalityIds } } });
  }

  if (createdItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
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
