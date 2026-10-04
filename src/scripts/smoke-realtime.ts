import { io, type Socket } from 'socket.io-client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { damageExpression } from '../modules/shared/attacks.js';
import { RACE_CATALOG } from '../modules/shared/creation.js';
import { rollDice } from '../modules/shared/dice.js';
import { SKILLS, normalizeSkills } from '../modules/shared/dnd5e.js';
import {
  allRaces,
  getRace,
  getSubrace,
  hasLuckyReroll,
  raceHpBonus,
  raceHpBonusDelta,
} from '../modules/shared/races/index.js';

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
const createdCustomRaceIds: string[] = [];
/** Token do jogador da seção 40, reaproveitado na seção 41 (o limiter de auth
 * de produção é apertado: o smoke já consome todas as contas que pode criar). */
let testsPlayerToken = '';

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



/**
 * Garante DUAS perícias proficientes e devolve as chaves — é o mínimo que a
 * Expertise (Ladino 1º/6º, Bardo 3º/10º) exige para poder escolher. Grava
 * direto no banco (como os outros preparos do smoke) para não depender de rota.
 */
async function ensureExpertisePool(
  where: { id: string } | { userId: string },
): Promise<string[]> {
  const character = await prisma.character.findUniqueOrThrow({ where });
  const skills = normalizeSkills(character.skills);
  const proficient = SKILLS.filter((skill) => skills[skill.key]?.proficient).map(
    (skill) => skill.key,
  );
  if (proficient.length >= 2) return proficient.slice(0, 2);

  const pool = SKILLS.slice(0, 2).map((skill) => skill.key);
  const next = { ...skills };
  for (const key of pool) next[key] = { proficient: true, expertise: false };
  await prisma.character.update({ where, data: { skills: next as any } });
  return pool;
}

/**
 * Corpo do Level Up montado do mesmo jeito que o `LevelUpDialog` monta.
 *
 * As escolhas do nível novo saem de `classes[].featureChoices` (classe que já
 * está na ficha) ou de `classOptions[].featureChoices` (classe nova) e, quando a
 * SUBCLASSE está sendo escolhida agora, de `classOptions[].subclassChoices`
 * (Caçador e Colégio do Conhecimento pedem escolha no mesmo nível).
 *
 * Nos níveis de Aumento de Atributo/Talento distribui os +1/+1 entre os
 * atributos que ainda têm espaço (é o que o assistente pede).
 */
function levelUpRequestFor(sheet: any, classKey: string, subclassPick = 0): any {
  const entry =
    (sheet?.classes ?? []).find((item: any) => item.classKey === classKey) ?? null;
  const option = (sheet?.classOptions ?? []).find((item: any) => item.key === classKey);

  const newLevel = (entry?.level ?? 0) + 1;
  const needsSubclass =
    (entry?.subclass ?? '') === '' && newLevel >= (option?.subclassLevel ?? 1);
  const subclassNames: string[] = option?.subclassNames ?? [];
  const subclass = needsSubclass
    ? (subclassNames[subclassPick] ?? subclassNames[0] ?? '')
    : '';

  const pending: any[] = [
    ...(entry ? (entry.featureChoices ?? []) : (option?.featureChoices ?? [])),
  ].filter((info: any) => info.level === newLevel && info.chosen.length < info.count);

  if (needsSubclass) {
    for (const info of option?.subclassChoices ?? []) {
      if (
        info.subclass === subclass &&
        info.level === newLevel &&
        info.chosen.length < info.count
      ) {
        pending.push(info);
      }
    }
  }

  const choices: Record<string, string[]> = {};
  for (const info of pending) {
    choices[info.featureId] = info.options
      .slice(0, info.count)
      .map((item: any) => item.key);
  }

  const request: any = {
    classKey,
    subclass: needsSubclass ? subclass : '',
    hp: 'average',
    choices,
  };

  if ((option?.asiLevels ?? []).includes(newLevel)) {
    const room = [
      'strength',
      'dexterity',
      'constitution',
      'intelligence',
      'wisdom',
      'charisma',
    ].filter((ability) => (sheet?.[ability] ?? 0) + 1 <= 20);

    if (room.length >= 2) {
      request.abilityIncreases = [
        { ability: room[0], amount: 1 },
        { ability: room[1], amount: 1 },
      ];
    } else {
      request.feat = { name: 'Talento do smoke', description: 'verificação automática' };
    }
  }

  return request;
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

  /**
   * Monta o inventário (ou qualquer campo) da ficha de um jogador COMO MESTRE.
   *
   * O jogador não edita mais o inventário por PATCH em fase nenhuma, então os
   * cenários que precisam de itens específicos usam o PATCH do mestre.
   */
  const patchAsMaster = async (userId: string, body: Record<string, unknown>) => {
    const character = await prisma.character.findUnique({ where: { userId } });
    if (!character) throw new Error(`Ficha não encontrada para ${userId}.`);
    return api(`/api/characters/${character.id}`, {
      method: 'PATCH',
      token: masterToken,
      body,
    });
  };

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
    body: { name: 'Thoradin', race: 'Tiefling' },
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

  // Inventário com peso — montado pelo MESTRE (o jogador não edita o
  // inventário por PATCH em fase nenhuma).
  const withItems = await patchAsMaster(playerId, {
      inventory: [
        { id: 'i1', name: 'Espada longa', description: 'cortante', quantity: 1, weight: 3, equipped: true },
        { id: 'i2', name: 'Poção de cura', description: '', quantity: 3, weight: 0.5, equipped: false },
      ],
      attacks: [
        { id: 'a1', name: 'Espada longa', damage: { count: 1, sides: 8, bonus: 2, type: 'Cortante' }, attackBonus: 5, notes: '' },
        { id: 'a2', name: 'Dardos mágicos (fixo)', damage: { count: 0, sides: 0, bonus: 4, type: 'Força' }, attackBonus: 0, notes: '' },
      ],
      features: [{ id: 'f1', name: 'Visão no escuro', source: 'race', description: 'Enxerga no escuro até 18m.' }],
      spells: {
        list: [{ id: 's1', name: 'Mísseis Mágicos', level: 1, school: 'Evocação', prepared: true, description: '' }],
        slots: { '1': { max: 2, used: 1 } },
      },
  });
  check('peso total é somado (3 + 1,5 = 4,5)', withItems.data?.character?.derived?.totalWeight === 4.5, `recebido: ${withItems.data?.character?.derived?.totalWeight}`);
  check('capacidade de carga = FOR × 7,5 (8 × 7,5 = 60 kg)', withItems.data?.character?.derived?.carryingCapacity === 60, `recebido: ${withItems.data?.character?.derived?.carryingCapacity}`);
  check('ataques são gravados', withItems.data?.character?.attacks?.length === 2);
  const structuredAttack = withItems.data?.character?.attacks?.find((a: any) => a.id === 'a1');
  check(
    'dano é ESTRUTURADO (1d8+2 Cortante, sem texto livre)',
    structuredAttack?.damage?.count === 1 &&
      structuredAttack?.damage?.sides === 8 &&
      structuredAttack?.damage?.bonus === 2 &&
      structuredAttack?.damage?.type === 'Cortante' &&
      structuredAttack?.damageType === undefined,
    JSON.stringify(structuredAttack),
  );
  const fixedAttack = withItems.data?.character?.attacks?.find((a: any) => a.id === 'a2');
  check(
    'dano FIXO usa count 0 + bônus (4 de Força)',
    fixedAttack?.damage?.count === 0 &&
      fixedAttack?.damage?.sides === 0 &&
      fixedAttack?.damage?.bonus === 4 &&
      fixedAttack?.damage?.type === 'Força',
    JSON.stringify(fixedAttack),
  );
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
    'a primeira classe concede as proficiências iniciais completas (PHB cap. 6)',
    (otherSheet.data?.character?.proficiencies?.weapons ?? []).includes('Bordões') &&
      (otherSheet.data?.character?.proficiencies?.armor ?? []).length === 0 &&
      (otherSheet.data?.character?.proficiencies?.tools ?? []).length === 0,
    JSON.stringify(otherSheet.data?.character?.proficiencies),
  );
  check(
    'as opções de classe já trazem as proficiências e a perícia de multiclasse',
    otherSheet.data?.character?.classOptions?.find((item: any) => item.key === 'rogue')
      ?.multiclassSkillChoice?.count === 1 &&
      (
        otherSheet.data?.character?.classOptions?.find((item: any) => item.key === 'fighter')
          ?.multiclassProficiencies?.armor ?? []
      ).includes('Escudos'),
    JSON.stringify(otherSheet.data?.character?.classOptions?.[0]),
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
        { id: 'g1', name: 'Cimitarra', damage: { count: 1, sides: 6, bonus: 2, type: 'Cortante' }, attackBonus: 4, notes: '' },
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
  check(
    'ataques da criatura são gravados (dano estruturado)',
    goblin?.attacks?.length === 1 &&
      goblin?.attacks?.[0]?.damage?.count === 1 &&
      goblin?.attacks?.[0]?.damage?.sides === 6 &&
      goblin?.attacks?.[0]?.damage?.bonus === 2 &&
      goblin?.attacks?.[0]?.damage?.type === 'Cortante',
    JSON.stringify(goblin?.attacks),
  );
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
        { id: 'p1', name: 'Espada longa', damage: { count: 1, sides: 8, bonus: 3, type: 'Cortante' }, attackBonus: 10, notes: '' },
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
        { id: 'c1', name: 'Mordida', damage: { count: 1, sides: 6, bonus: 2, type: 'Cortante' }, attackBonus: 10, notes: '' },
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

  // --- Munição: arma EQUIPADA consome 1 por ataque ---------------------------
  const bowId = 'inv-bow';
  const arrowId = 'inv-arrow';
  const magicArrowId = 'inv-arrow-magic';
  const bowItem = {
    id: bowId,
    name: 'Arco curto',
    description: '',
    quantity: 1,
    weight: 1,
    slot: 'hand2',
    backpackX: null,
    backpackY: null,
    imageUrl: '',
    itemId: '',
    category: 'Arma',
    details: {
      damageCount: 1,
      damageDie: 6,
      damageType: 'Perfurante',
      weaponType: 'ranged',
      weaponCategory: 'simple',
      properties: ['ammunition', 'two-handed'],
      ammoType: 'Flecha',
      rangeNormal: 24,
      rangeLong: 96,
    },
  };
  const arrowItem = {
    id: arrowId,
    name: 'Flechas',
    description: '',
    quantity: 3,
    weight: 0,
    slot: null,
    backpackX: 0,
    backpackY: 0,
    imageUrl: '',
    itemId: '',
    category: 'Munição',
    details: { ammoType: 'Flecha' },
  };
  const magicArrowItem = {
    id: magicArrowId,
    name: 'Flechas +2',
    description: '',
    quantity: 2,
    weight: 0,
    slot: null,
    backpackX: 1,
    backpackY: 0,
    imageUrl: '',
    itemId: '',
    category: 'Munição',
    details: { ammoType: 'Flecha', attackBonus: 2, damageBonus: 2 },
  };
  const bowAttack = {
    id: 'bow',
    name: 'Arco curto',
    damage: { count: 1, sides: 6, bonus: 3, type: 'Perfurante' },
    attackBonus: 10,
    notes: '',
    finesse: false,
    ranged: true,
    inventoryItemId: bowId,
  };
  const ammoSheet = async (): Promise<any> =>
    (await api('/api/characters/me', { token: playerToken })).data.character;

  const withAmmo = (
    await patchAsMaster(playerId, {
      inventory: [bowItem, arrowItem, magicArrowItem],
      attacks: [bowAttack],
    })
  ).data.character;
  check(
    'inventário aceita arma equipada e pilhas de munição',
    withAmmo.inventory.length === 3 &&
      withAmmo.inventory.find((e: any) => e.id === bowId)?.slot === 'hand2',
    JSON.stringify(withAmmo.inventory.map((e: any) => ({ name: e.name, slot: e.slot }))),
  );

  const ammoSpendEvent = waitFor<any>(playerSocket, 'sheet:updated');
  const firstShot = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'bow', targetCombatantId: creatureCombatant.id },
  });
  check('ataque de arma com munição resolve (200)', firstShot.status === 200, JSON.stringify(firstShot.data));
  check(
    'o gasto de munição publica sheet:updated para o dono',
    (await ammoSpendEvent.catch(() => null))?.character?.inventory !== undefined,
  );
  const afterFirst = await ammoSheet();
  check(
    'consome 1 da pilha SEM bônus por padrão (3 -> 2)',
    afterFirst.inventory.find((e: any) => e.id === arrowId)?.quantity === 2,
    JSON.stringify(afterFirst.inventory.map((e: any) => ({ id: e.id, q: e.quantity }))),
  );
  check(
    'NÃO gasta a munição mágica sem pedir',
    afterFirst.inventory.find((e: any) => e.id === magicArrowId)?.quantity === 2,
  );

  const magicShot = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: {
      attackId: 'bow',
      targetCombatantId: creatureCombatant.id,
      ammoInventoryId: magicArrowId,
    },
  });
  const afterMagic = await ammoSheet();
  check(
    'a pilha escolhida é a consumida (mágica 2 -> 1)',
    afterMagic.inventory.find((e: any) => e.id === magicArrowId)?.quantity === 1,
    JSON.stringify(afterMagic.inventory.map((e: any) => ({ id: e.id, q: e.quantity }))),
  );
  check(
    'os bônus da munição somam ao ataque (10 + 2)',
    magicShot.data.result.attackBonus === 12,
    JSON.stringify(magicShot.data.result),
  );

  // Pilha que chega a 0 sai do inventário.
  await patchAsMaster(playerId, {
    inventory: [bowItem, { ...arrowItem, quantity: 1 }, { ...magicArrowItem, quantity: 1 }],
  });
  await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'bow', targetCombatantId: creatureCombatant.id },
  });
  const afterDrain = await ammoSheet();
  check(
    'pilha que chega a 0 sai do inventário',
    afterDrain.inventory.find((e: any) => e.id === arrowId) === undefined &&
      afterDrain.inventory.length === 2,
    JSON.stringify(afterDrain.inventory.map((e: any) => e.id)),
  );

  // Sem munição: 409 e nada é rolado.
  await patchAsMaster(playerId, { inventory: [bowItem] });
  const emptyQuiver = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'bow', targetCombatantId: creatureCombatant.id },
  });
  check(
    'sem munição devolve 409 e não rola o ataque',
    emptyQuiver.status === 409 && /sem munição/i.test(String(emptyQuiver.data?.message ?? '')),
    JSON.stringify(emptyQuiver.data),
  );

  // Arma vinculada NÃO equipada: o ataque não é utilizável.
  await patchAsMaster(playerId, {
    inventory: [{ ...bowItem, slot: null }, { ...arrowItem, quantity: 5 }],
  });
  const unequippedBow = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'bow', targetCombatantId: creatureCombatant.id },
  });
  check(
    'arma não equipada não ataca (409)',
    unequippedBow.status === 409 && /equipe a arma/i.test(String(unequippedBow.data?.message ?? '')),
    JSON.stringify(unequippedBow.data),
  );

  // Restaura o inventário do começo do combate para as próximas seções.
  await patchAsMaster(playerId, {
    inventory: [
      { id: 'i1', name: 'Espada longa', description: 'cortante', quantity: 1, weight: 3, equipped: true },
      { id: 'i2', name: 'Poção de cura', description: '', quantity: 3, weight: 0.5, equipped: false },
    ],
  });

  // --- Ladino: features derivadas e Ataque Furtivo automático ----------------
  await setCharacterClasses(playerId, [{ classKey: 'rogue', level: 3 }]);
  const rogueSheet = (
    await api('/api/characters/me', {
      method: 'PATCH',
      token: playerToken,
      body: {
        attacks: [
          { id: 'p1', name: 'Adaga', damage: { count: 1, sides: 4, bonus: 3, type: 'Perfurante' }, attackBonus: 10, notes: '', finesse: true, ranged: false },
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

  // O combate é por turnos: ao ENTRAR no turno do personagem, a trava "uma
  // vez por turno" do Ataque Furtivo é zerada (nextTurn).
  async function advanceToPlayerTurn(): Promise<void> {
    let state = (await api('/api/combat/active', { token: masterToken })).data.combat;
    let guard = 0;
    do {
      state = (await api('/api/combat/next-turn', { method: 'POST', token: masterToken })).data
        .combat;
      guard += 1;
    } while (
      state?.status === 'ACTIVE' &&
      state.currentCombatantId !== playerCombatant.id &&
      guard < 20
    );
  }

  // Sem vantagem e sem aliado adjacente, a arma sutil NÃO recebe o extra.
  await advanceToPlayerTurn();
  const noCondition = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id },
  });
  check(
    'arma sutil sem vantagem nem aliado adjacente NÃO recebe Ataque Furtivo',
    noCondition.data.result.sneakAttack === null,
    JSON.stringify(noCondition.data.result),
  );

  // Desvantagem impede o Ataque Furtivo, mesmo com aliado adjacente confirmado.
  const withDisadvantage = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: {
      attackId: 'p1',
      targetCombatantId: creatureCombatant.id,
      disadvantage: true,
      adjacentAlly: true,
    },
  });
  check(
    'desvantagem impede o Ataque Furtivo mesmo com aliado adjacente',
    withDisadvantage.data.result.sneakAttack === null,
    JSON.stringify(withDisadvantage.data.result),
  );

  // Só com aliado adjacente confirmado já recebe (com a razão no log).
  const allyAttack = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id, adjacentAlly: true },
  });
  const allyResult = allyAttack.data.result;
  const allyApplied = allyResult.hit && allyResult.sneakAttack !== null;
  check(
    'aliado adjacente habilita o Ataque Furtivo (sem vantagem)',
    allyResult.hit
      ? allyResult.sneakAttack?.expression === '2d6' &&
          allyResult.sneakAttack?.reason === 'aliado adjacente'
      : allyResult.sneakAttack === null,
    JSON.stringify(allyResult),
  );

  // Uma vez por turno: se o ataque anterior aplicou, este não aplica de novo.
  const repeated = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id, advantage: true },
  });
  check(
    'Ataque Furtivo não repete no mesmo turno',
    !allyApplied || repeated.data.result.sneakAttack === null,
    JSON.stringify(repeated.data.result),
  );

  // Turno novo: com vantagem, volta a aplicar (razão 'vantagem').
  await advanceToPlayerTurn();
  const advantageAttack = await api('/api/combat/attack', {
    method: 'POST',
    token: playerToken,
    body: { attackId: 'p1', targetCombatantId: creatureCombatant.id, advantage: true },
  });
  const advantageResult = advantageAttack.data.result;
  check(
    'vantagem habilita o Ataque Furtivo (razão no log)',
    advantageResult.hit
      ? advantageResult.sneakAttack?.expression === '2d6' &&
          advantageResult.sneakAttack?.reason === 'vantagem'
      : advantageResult.sneakAttack === null,
    JSON.stringify(advantageResult),
  );

  // Arma sem sutil/à distância não recebe o dano extra.
  await api('/api/characters/me', {
    method: 'PATCH',
    token: playerToken,
    body: {
      attacks: [
        { id: 'p2', name: 'Maça', damage: { count: 1, sides: 6, bonus: 3, type: 'Concussão' }, attackBonus: 10, notes: '', finesse: false, ranged: false },
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
          { id: 'p1', name: 'Machado grande', damage: { count: 1, sides: 12, bonus: 3, type: 'Cortante' }, attackBonus: 10, notes: '', finesse: false, ranged: false },
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

  // A resistência do alvo usa o TIPO ESTRUTURADO do ataque: o Lobo morde o
  // bárbaro em Fúria (Cortante) e o dano cai pela metade (1d6+2 ⇒ no máximo 4).
  const biteOnRaging = await api('/api/combat/attack', {
    method: 'POST',
    token: masterToken,
    body: {
      attackerCombatantId: creatureCombatant.id,
      attackId: 'c1',
      targetCombatantId: playerCombatant.id,
    },
  });
  check(
    'resistência da Fúria halva o dano pelo TIPO estruturado (máx. 4 de 1d6+2 Cortante)',
    biteOnRaging.data.result.hit ? biteOnRaging.data.result.damageRolled <= 4 : true,
    JSON.stringify(biteOnRaging.data.result),
  );
  check(
    'o resultado do ataque devolve o tipo estruturado (Cortante)',
    biteOnRaging.data.result.damageType === 'Cortante',
    JSON.stringify(biteOnRaging.data.result),
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
    druidSheet.classes[0]?.spellcasting?.preparedCount ===
      Math.max(1, druidSheet.derived.modifiers.wisdom + 2),
    JSON.stringify({
      prepared: druidSheet.classes[0]?.spellcasting?.preparedCount,
      wis: druidSheet.derived.modifiers.wisdom,
    }),
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
    sorcererSheet.classes[0]?.spellcasting?.preparedCount === null,
    JSON.stringify(sorcererSheet.classes[0]?.spellcasting),
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
    wizardSheet.classes[0]?.spellcasting?.preparedCount ===
      Math.max(1, wizardSheet.derived.modifiers.intelligence + 6),
    JSON.stringify({ prepared: wizardSheet.classes[0]?.spellcasting?.preparedCount }),
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
  // Multiclasse NUNCA concede salvaguardas (PHB 2014, p.164): as fixas são só
  // as da PRIMEIRA classe — aqui, as do Bárbaro (Força e Constituição).
  check(
    'salvaguardas fixas são só as da PRIMEIRA classe',
    ['strength', 'constitution'].every((ability: string) =>
      multiclass.derived.lockedSaves.includes(ability),
    ) &&
      !['dexterity', 'intelligence'].some((ability: string) =>
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

  // --- Espaços e preparadas POR CLASSE (PHB cap. 3 x cap. 6) ----------------
  console.log('\n8.6) Tabela de espaços e magias preparadas por classe');

  // Com UMA classe conjuradora vale a tabela da PRÓPRIA classe: o
  // meio-conjurador arredonda a metade para CIMA (Paladino 3 = 3 espaços de 1º).
  // O arredondamento para BAIXO é só da tabela COMBINADA de multiclasse.
  await setCharacterClasses(playerId, [{ classKey: 'paladin', level: 3 }]);
  const paladinAlone = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Paladino 3 sozinho usa a tabela do Paladino (3 espaços de 1º, nenhum de 2º)',
    paladinAlone.derived.spellSlots.find((s: any) => s.level === 1)?.max === 3 &&
      !paladinAlone.derived.spellSlots.some((s: any) => s.level === 2),
    JSON.stringify(paladinAlone.derived.spellSlots),
  );
  check(
    'Paladino prepara CAR + METADE do nível (Paladino 3 → metade = 1)',
    paladinAlone.classes[0]?.spellcasting?.preparedCount ===
      Math.max(1, paladinAlone.derived.modifiers.charisma + 1),
    JSON.stringify({
      prepared: paladinAlone.classes[0]?.spellcasting?.preparedCount,
      car: paladinAlone.derived.modifiers.charisma,
    }),
  );

  // Paladino no 1º nível ainda NÃO conjura: zero espaços e zero preparadas.
  await setCharacterClasses(playerId, [{ classKey: 'paladin', level: 1 }]);
  const paladinFirst = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Paladino de nível 1 não tem espaços nem magias preparadas',
    paladinFirst.derived.spellSlots.length === 0 &&
      paladinFirst.classes[0]?.spellcasting?.preparedCount === 0,
    JSON.stringify({
      slots: paladinFirst.derived.spellSlots,
      prepared: paladinFirst.classes[0]?.spellcasting?.preparedCount,
    }),
  );

  // Patrulheiro: meio-conjurador de magias CONHECIDAS (a metade não entra na
  // contagem de preparadas, mas a tabela dele é a de meio-conjurador).
  await setCharacterClasses(playerId, [{ classKey: 'ranger', level: 5 }]);
  const rangerAlone = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Patrulheiro 5 usa a tabela dele (4 espaços de 1º e 2 de 2º)',
    rangerAlone.derived.spellSlots.find((s: any) => s.level === 1)?.max === 4 &&
      rangerAlone.derived.spellSlots.find((s: any) => s.level === 2)?.max === 2,
    JSON.stringify(rangerAlone.derived.spellSlots),
  );
  check(
    'Patrulheiro usa magias conhecidas (sem limite de preparadas)',
    rangerAlone.classes[0]?.spellcasting?.preparedCount === null,
    JSON.stringify(rangerAlone.classes[0]?.spellcasting),
  );

  // Terço-conjurador sozinho também arredonda para CIMA (Ladino 4 → conjurador 2).
  await setCharacterClasses(playerId, [
    { classKey: 'rogue', level: 4, subclass: 'Trapaceiro Arcano' },
  ]);
  const tricksterAlone = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Trapaceiro Arcano 4 usa a tabela dele (3 espaços de 1º, nenhum de 2º)',
    tricksterAlone.derived.spellSlots.find((s: any) => s.level === 1)?.max === 3 &&
      !tricksterAlone.derived.spellSlots.some((s: any) => s.level === 2),
    JSON.stringify(tricksterAlone.derived.spellSlots),
  );

  // Classe que NÃO conjura não puxa a tabela combinada: Guerreiro 5 / Paladino 5
  // continua com a tabela do Paladino (4 de 1º e 2 de 2º) — a combinada daria 3.
  await setCharacterClasses(playerId, [
    { classKey: 'fighter', level: 5 },
    { classKey: 'paladin', level: 5 },
  ]);
  const fighterPaladin = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Guerreiro sem conjuração não entra na tabela combinada (Guerreiro 5 / Paladino 5)',
    fighterPaladin.derived.spellSlots.find((s: any) => s.level === 1)?.max === 4 &&
      fighterPaladin.derived.spellSlots.find((s: any) => s.level === 2)?.max === 2,
    JSON.stringify(fighterPaladin.derived.spellSlots),
  );

  // Bruxo sozinho: nenhum espaço da tabela comum, só a Magia de Pacto.
  await setCharacterClasses(playerId, [{ classKey: 'warlock', level: 4 }]);
  const warlockAlone = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'Bruxo sozinho fica fora da tabela comum (só Magia de Pacto)',
    warlockAlone.derived.spellSlots.length === 0 &&
      warlockAlone.derived.pactSlots?.max === 2 &&
      warlockAlone.derived.pactSlots?.slotLevel === 2,
    JSON.stringify({
      slots: warlockAlone.derived.spellSlots,
      pact: warlockAlone.derived.pactSlots,
    }),
  );

  // Multiclasse preparado: cada classe com o próprio atributo e o próprio nível
  // (nada de número somado).
  await setCharacterClasses(playerId, [
    { classKey: 'wizard', level: 6 },
    { classKey: 'cleric', level: 3 },
  ]);
  const twoPrepared = (await api('/api/characters/me', { token: playerToken })).data.character;
  check(
    'magias preparadas são POR CLASSE (Mago 6 e Clérigo 3, sem somar)',
    twoPrepared.classes[0]?.spellcasting?.preparedCount ===
      Math.max(1, twoPrepared.derived.modifiers.intelligence + 6) &&
      twoPrepared.classes[1]?.spellcasting?.preparedCount ===
        Math.max(1, twoPrepared.derived.modifiers.wisdom + 3),
    JSON.stringify(
      twoPrepared.classes.map((entry: any) => ({
        key: entry.classKey,
        prepared: entry.spellcasting?.preparedCount,
      })),
    ),
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
      details: {
        damageCount: 2,
        damageDie: 6,
        damageType: 'Cortante',
        attackBonus: 5,
        weaponType: 'melee',
        weaponCategory: 'martial',
        properties: ['versatile'],
        versatileDie: 10,
      },
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
    'arma guarda tipo, categoria, propriedades e o dado versátil',
    weapon?.details?.weaponType === 'melee' &&
      weapon?.details?.weaponCategory === 'martial' &&
      weapon?.details?.properties?.includes('versatile') &&
      weapon?.details?.versatileDie === 10,
    JSON.stringify(weapon?.details),
  );

  // Arma sem tipo/categoria cai nos padrões seguros (corpo a corpo, simples).
  const defaultWeapon = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Bordão ${suffix}`,
      category: 'Arma',
      details: { damageCount: 1, damageDie: 6, damageType: 'Concussão' },
    },
  });
  createdItemIds.push(defaultWeapon.data?.item?.id);
  check(
    'arma sem tipo assume corpo a corpo e simples por padrão',
    defaultWeapon.data?.item?.details?.weaponType === 'melee' &&
      defaultWeapon.data?.item?.details?.weaponCategory === 'simple',
    JSON.stringify(defaultWeapon.data?.item?.details),
  );

  // Arma à distância: alcance em metros + munição.
  const bowCreated = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Arco Curto ${suffix}`,
      category: 'Arma',
      weight: 1,
      details: {
        damageCount: 1,
        damageDie: 6,
        damageType: 'Perfurante',
        weaponType: 'ranged',
        weaponCategory: 'simple',
        properties: ['ammunition', 'two-handed'],
        ammoType: 'Flecha',
        rangeNormal: 24,
        rangeLong: 96,
      },
    },
  });
  createdItemIds.push(bowCreated.data?.item?.id);
  check(
    'arma à distância guarda alcance normal/longo e a munição',
    bowCreated.status === 201 &&
      bowCreated.data?.item?.details?.weaponType === 'ranged' &&
      bowCreated.data?.item?.details?.rangeNormal === 24 &&
      bowCreated.data?.item?.details?.rangeLong === 96 &&
      bowCreated.data?.item?.details?.properties?.includes('ammunition'),
    JSON.stringify(bowCreated.data),
  );

  // Munição entra como categoria própria, com tipo e bônus (mágica +1/+2/+3).
  const ammoItem = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Flechas +1 ${suffix}`,
      category: 'Munição',
      weight: 0.05,
      details: { ammoType: 'Flecha', attackBonus: 1, damageBonus: 1, damageCount: 9 },
    },
  });
  createdItemIds.push(ammoItem.data?.item?.id);
  check(
    'categoria Munição guarda tipo e bônus (e descarta dano de arma)',
    ammoItem.status === 201 &&
      ammoItem.data?.item?.details?.ammoType === 'Flecha' &&
      ammoItem.data?.item?.details?.attackBonus === 1 &&
      ammoItem.data?.item?.details?.damageBonus === 1 &&
      ammoItem.data?.item?.details?.damageCount === undefined,
    JSON.stringify(ammoItem.data),
  );

  const ammoWithoutType = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Arco sem Tipo ${suffix}`,
      category: 'Arma',
      details: { weaponType: 'ranged', properties: ['ammunition'], rangeNormal: 24, rangeLong: 96 },
    },
  });
  check(
    "'Munição' sem o tipo de munição é recusada (400)",
    ammoWithoutType.status === 400,
    JSON.stringify(ammoWithoutType.data),
  );

  // --- Coerência das propriedades de arma (validada no servidor) -----------
  const badAmmunition = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Munição Inválida ${suffix}`,
      category: 'Arma',
      details: { weaponType: 'melee', properties: ['ammunition'] },
    },
  });
  check("Munição em arma corpo a corpo é recusada (400)", badAmmunition.status === 400, JSON.stringify(badAmmunition.data));

  const badVersatile = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Versátil Inválida ${suffix}`,
      category: 'Arma',
      details: { weaponType: 'melee', properties: ['versatile'] },
    },
  });
  check('Versátil sem o dado de duas mãos é recusado (400)', badVersatile.status === 400, JSON.stringify(badVersatile.data));

  const badTwoHanded = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Versátil Duas Mãos ${suffix}`,
      category: 'Arma',
      details: { weaponType: 'melee', properties: ['versatile', 'two-handed'], versatileDie: 10 },
    },
  });
  check("Versátil junto de 'Duas mãos' é recusado (400)", badTwoHanded.status === 400, JSON.stringify(badTwoHanded.data));

  const badRanged = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `À Distância sem Alcance ${suffix}`,
      category: 'Arma',
      details: { weaponType: 'ranged' },
    },
  });
  check('arma à distância sem alcance é recusada (400)', badRanged.status === 400, JSON.stringify(badRanged.data));

  const badThrown = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Arremesso sem Alcance ${suffix}`,
      category: 'Arma',
      details: { weaponType: 'melee', properties: ['thrown'] },
    },
  });
  check('arremesso sem alcance é recusado (400)', badThrown.status === 400, JSON.stringify(badThrown.data));
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

  // O slot de munição ('ammo') é um slot REAL (antes era decorativo e não
  // aceitava item nenhum): equipar nele grava o slot e limpa a posição.
  const ammoEquipped = await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: playerToken,
    body: { itemInventoryId: potion.id, targetSlot: 'ammo' },
  });
  const potionInAmmo = ammoEquipped.data?.character?.inventory?.find((e: any) => e.id === potion.id);
  check(
    'o slot de munição (ammo) aceita equipar um item',
    potionInAmmo?.slot === 'ammo' && potionInAmmo?.backpackX === null && potionInAmmo?.backpackY === null,
    JSON.stringify(potionInAmmo),
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

  // Edição local em um campo do catálogo é sobrescrita pelo espelho (aqui o
  // mestre escreve o valor local, que o espelho do catálogo substitui).
  const locallyEdited = await patchAsMaster(playerId, {
    inventory: afterWeaponSend.inventory.map((entry: any) =>
      entry.itemId === weapon.id ? { ...entry, name: 'Nome local', weight: 99 } : entry,
    ),
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
      })
    ).status === 403,
  );

  const releaseBefore = initialConfig.data?.config?.levelUpRelease ?? 0;
  const configEvent = waitFor<any>(playerSocket, 'game:config');
  const released = await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
  });
  check(
    'mestre libera o Level Up (200)',
    released.status === 200 && released.data?.config?.levelUpRelease === releaseBefore + 1,
    JSON.stringify(released.data),
  );
  check('jogador recebe a liberação em tempo real', (await configEvent.catch(() => null)) !== null);

  // Não existe mais estado "bloqueado": liberar de novo JÁ é uma liberação
  // nova, sem o mestre precisar desligar nada antes.
  const releasedAgain = await api('/api/game/level-up', {
    method: 'POST',
    token: masterToken,
  });
  check(
    'liberar de novo sem bloquear gera nova liberação',
    releasedAgain.data?.config?.levelUpRelease === releaseBefore + 2,
    JSON.stringify(releasedAgain.data?.config),
  );
  check(
    'a configuração não expõe mais estado de bloqueio',
    releasedAgain.data?.config?.levelUpUnlocked === undefined,
    JSON.stringify(releasedAgain.data?.config),
  );
  check(
    'ficha expõe a última liberação usada (0 para esta ficha nova)',
    (await api('/api/characters/me', { token: playerToken })).data.character
      ?.lastLevelUpRelease === 0,
  );

  // --- 11.5b Anotações do mestre --------------------------------------------
  console.log('\n11.5b) Anotações privadas do mestre');

  check(
    'as anotações do mestre exigem autenticação (401)',
    (await api('/api/game/notes')).status === 401,
  );
  check(
    'jogador NÃO lê as anotações do mestre (403)',
    (await api('/api/game/notes', { token: playerToken })).status === 403,
  );
  check(
    'jogador NÃO grava as anotações do mestre (403)',
    (
      await api('/api/game/notes', {
        method: 'PATCH',
        token: playerToken,
        body: { notes: 'invadindo o caderno alheio' },
      })
    ).status === 403,
  );

  const playerConfig = (await api('/api/game', { token: playerToken })).data?.config ?? {};
  check(
    'a configuração que o jogador recebe NÃO traz as anotações do mestre',
    playerConfig.notes === undefined && playerConfig.masterNotes === undefined,
    JSON.stringify(playerConfig),
  );

  const savedNotes = await api('/api/game/notes', {
    method: 'PATCH',
    token: masterToken,
    body: { notes: 'O dragao do poço devolve segredos.' },
  });
  check(
    'o mestre grava as próprias anotações (200)',
    savedNotes.status === 200 && savedNotes.data?.notes === 'O dragao do poço devolve segredos.',
    JSON.stringify(savedNotes.data),
  );
  check(
    'o mestre relê as anotações gravadas',
    (await api('/api/game/notes', { token: masterToken })).data?.notes ===
      'O dragao do poço devolve segredos.',
  );
  check(
    'anotações acima do limite são recusadas (400)',
    (
      await api('/api/game/notes', {
        method: 'PATCH',
        token: masterToken,
        body: { notes: 'x'.repeat(20_001) },
      })
    ).status === 400,
  );
  // Não deixa texto de teste na configuração da mesa (ela é global).
  await api('/api/game/notes', { method: 'PATCH', token: masterToken, body: { notes: '' } });

  // --- 11.5c Escolhas de característica e efeitos de classe ------------------
  console.log('\n11.5c) Escolhas de característica e efeitos de classe');

  // Ficha própria e isolada: aqui testamos as ESCOLHAS de característica
  // (Estilo de Luta, Inimigo Favorito...) e os efeitos numéricos que elas
  // destravam, sem mexer nas fichas usadas pelos outros blocos.
  const choicesUsername = `escolhas_${suffix}`;
  createdUsernames.push(choicesUsername);
  const choicesReg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      username: choicesUsername,
      displayName: 'Escolhas Teste',
      password: 'senha-forte-123',
    },
  });
  const choicesToken: string = choicesReg.data?.token;
  const choicesId: string = choicesReg.data?.user?.id;
  const choicesSheet = await api('/api/characters/me', {
    method: 'POST',
    token: choicesToken,
    body: {},
  });
  const choicesCharacterId: string = choicesSheet.data?.character?.id;
  check(
    'jogador novo cadastrado para as escolhas (201)',
    choicesReg.status === 201 && Boolean(choicesToken) && Boolean(choicesCharacterId),
    JSON.stringify(choicesReg.data),
  );

  // Guerreiro de nível 1 com uma armadura leve EQUIPADA: o Estilo de Luta
  // Defesa só vale "enquanto você estiver usando armadura".
  const testArmor = {
    id: 'armor-escolhas',
    name: 'Couro do teste',
    description: '',
    quantity: 1,
    weight: 5,
    slot: 'chest' as string | null,
    backpackX: null as number | null,
    backpackY: null as number | null,
    imageUrl: '',
    itemId: '',
    category: 'Armadura',
    details: { armorType: 'Leve', baseArmorClass: 12 },
  };
  // Os atributos vêm ANTES da classe: o pré-requisito do livro é conferido com
  // os valores já gravados na ficha (ver resolveClassPatch).
  await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      strength: 15,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 14,
      charisma: 10,
    },
  });
  // REGRESSÃO: o assistente de criação monta os seletores a partir do CATÁLOGO
  // (`classOptions[].featureChoices`), porque na hora da escolha a ficha ainda
  // não tem classe — as opções precisam vir do catálogo, não da ficha.
  const classlessSheet = (await api('/api/characters/me', { token: choicesToken }))
    .data.character;
  const classlessFighter = (classlessSheet?.classOptions ?? []).find(
    (option: any) => option.key === 'fighter',
  );
  const classlessRanger = (classlessSheet?.classOptions ?? []).find(
    (option: any) => option.key === 'ranger',
  );
  check(
    'sem classe na ficha, o catálogo já traz as escolhas do nível 1 (opções visíveis)',
    classlessFighter?.featureChoices?.[0]?.options?.length === 6 &&
      classlessRanger?.featureChoices?.length === 2 &&
      classlessRanger?.featureChoices?.[0]?.options?.length === 13 &&
      classlessRanger?.featureChoices?.[1]?.options?.length === 8,
    JSON.stringify({
      fighter: classlessFighter?.featureChoices?.[0]?.options?.length,
      ranger: classlessRanger?.featureChoices?.map((info: any) => info.options.length),
    }),
  );

  const choicesSetup = await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { classes: [{ classKey: 'fighter' }], inventory: [testArmor] },
  });
  check(
    'o mestre monta o guerreiro de teste (200)',
    choicesSetup.status === 200 &&
      choicesSetup.data?.character?.classes?.[0]?.classKey === 'fighter',
    JSON.stringify(choicesSetup.data),
  );

  const fighterOption = (choicesSetup.data?.character?.classOptions ?? []).find(
    (option: any) => option.key === 'fighter',
  );
  const paladinOption = (choicesSetup.data?.character?.classOptions ?? []).find(
    (option: any) => option.key === 'paladin',
  );
  const rangerOption = (choicesSetup.data?.character?.classOptions ?? []).find(
    (option: any) => option.key === 'ranger',
  );
  check(
    'o Estilo de Luta do Guerreiro traz as 6 opções do livro (nível 1)',
    fighterOption?.featureChoices?.length === 1 &&
      fighterOption?.featureChoices?.[0]?.featureId === 'fighter-fighting-style' &&
      fighterOption?.featureChoices?.[0]?.options?.length === 6,
    JSON.stringify(fighterOption?.featureChoices),
  );
  check(
    'o Patrulheiro pede as DUAS escolhas do nível 1 (Inimigo Favorito e Explorador Nato)',
    rangerOption?.featureChoices?.length === 2 &&
      rangerOption?.featureChoices?.map((info: any) => info.featureId).join(',') ===
        'favored-enemy,natural-explorer',
    JSON.stringify(rangerOption?.featureChoices),
  );
  check(
    'o Estilo de Luta do Paladino é do nível 2 (não aparece na entrada)',
    paladinOption?.featureChoices?.length === 0,
    JSON.stringify(paladinOption?.featureChoices),
  );

  const fighterStyle = await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      classState: {
        active: [],
        used: {},
        choices: { 'fighter-fighting-style': ['defense'] },
      },
    },
  });
  const armoredFighter = fighterStyle.data?.character;
  check(
    'o mestre escolhe o Estilo de Luta Defesa (200)',
    fighterStyle.status === 200 &&
      armoredFighter?.classState?.choices?.['fighter-fighting-style']?.[0] === 'defense',
    JSON.stringify(armoredFighter?.classState),
  );
  check(
    'a escolha já feita aparece nas escolhas da classe',
    armoredFighter?.classes?.[0]?.featureChoices?.[0]?.chosen?.[0] === 'defense',
    JSON.stringify(armoredFighter?.classes?.[0]?.featureChoices),
  );
  check(
    'Defesa soma +1 na CA com armadura equipada (12 + DES 2 + 1)',
    armoredFighter?.derived?.armorClass?.automatic === 15 &&
      armoredFighter?.derived?.armorClass?.classBonus === 1 &&
      armoredFighter?.classAdjustments?.armorClassBonus === 1,
    JSON.stringify({
      ca: armoredFighter?.derived?.armorClass,
      ajuste: armoredFighter?.classAdjustments?.armorClassBonus,
    }),
  );

  const withoutArmor = await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { inventory: [{ ...testArmor, slot: null, backpackX: 1, backpackY: 0 }] },
  });
  check(
    'sem armadura VESTIDA a Defesa não soma (o livro exige armadura)',
    withoutArmor.data?.character?.derived?.armorClass?.automatic === 12 &&
      withoutArmor.data?.character?.derived?.armorClass?.classBonus === 0,
    JSON.stringify(withoutArmor.data?.character?.derived?.armorClass),
  );
  await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { inventory: [testArmor] },
  });

  // Level Up: entrar numa classe NOVA pede as escolhas do nível 1 DELA. O
  // guerreiro tem FOR 15/DES 14, então atende o patrulheiro (DES 13 e SAB 13).
  await api('/api/game/level-up', { method: 'POST', token: masterToken });
  check(
    'multiclassar em Patrulheiro sem as escolhas do nível 1 é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: choicesToken,
        body: { classKey: 'ranger', hp: 'average', skillChoice: 'nature' },
      })
    ).status === 400,
  );
  check(
    'opção de escolha inválida no Level Up é recusada (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: choicesToken,
        body: {
          classKey: 'ranger',
          hp: 'average',
          skillChoice: 'nature',
          choices: { 'favored-enemy': ['inventado'], 'natural-explorer': ['forest'] },
        },
      })
    ).status === 400,
  );
  check(
    'escolha do nível ERRADO no Level Up é recusada (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: choicesToken,
        body: {
          classKey: 'ranger',
          hp: 'average',
          skillChoice: 'nature',
          choices: {
            'favored-enemy': ['undead'],
            'natural-explorer': ['forest'],
            // O Estilo de Luta do patrulheiro só é escolhido no 2º nível.
            'ranger-fighting-style': ['defense'],
          },
        },
      })
    ).status === 400,
  );

  const rangerEntry = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: choicesToken,
    body: {
      classKey: 'ranger',
      hp: 'average',
      skillChoice: 'nature',
      choices: { 'favored-enemy': ['undead'], 'natural-explorer': ['forest'] },
    },
  });
  check(
    'Inimigo Favorito e Explorador Nato entram no Level Up (200)',
    rangerEntry.status === 200 &&
      rangerEntry.data?.character?.classState?.choices?.['favored-enemy']?.[0] === 'undead' &&
      rangerEntry.data?.character?.classState?.choices?.['natural-explorer']?.[0] === 'forest',
    JSON.stringify(rangerEntry.data?.character?.classState),
  );
  check(
    'a perícia do patrulheiro entra na ficha junto das escolhas',
    rangerEntry.data?.character?.skills?.nature?.proficient === true,
    JSON.stringify(rangerEntry.data?.character?.skills),
  );
  check(
    'entrar numa classe nova não apaga a escolha da anterior (Estilo de Luta)',
    rangerEntry.data?.character?.classState?.choices?.['fighter-fighting-style']?.[0] === 'defense',
    JSON.stringify(rangerEntry.data?.character?.classState?.choices),
  );

  // As escolhas são CONSTRUÇÃO: com a criação finalizada o jogador só vê (o
  // mestre continua editando), mas usos de recursos seguem liberados.
  // O assistente do passo 9 não é usado aqui (esta ficha foi montada direto
  // pelo mestre), então o flag vai na fonte — como os cenários de nível.
  await prisma.character.update({
    where: { userId: choicesId },
    data: { creationFinalized: true },
  });
  check(
    'a ficha de teste fica com a criação finalizada',
    (await api('/api/characters/me', { token: choicesToken })).data?.character
      ?.creationFinalized === true,
  );
  const keptChoices = {
    'fighter-fighting-style': ['defense'],
    'favored-enemy': ['undead'],
    'natural-explorer': ['forest'],
  };
  check(
    'com a criação finalizada o jogador NÃO troca a escolha (403)',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: choicesToken,
        body: {
          classState: {
            active: [],
            used: {},
            choices: { ...keptChoices, 'fighter-fighting-style': ['archery'] },
          },
        },
      })
    ).status === 403,
  );
  check(
    'o jogador continua mexendo nos usos de recursos (200)',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: choicesToken,
        body: { classState: { active: [], used: { 'second-wind': 1 }, choices: keptChoices } },
      })
    ).status === 200,
  );
  const masterChoiceEdit = await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      classState: {
        active: [],
        used: {},
        choices: { ...keptChoices, 'fighter-fighting-style': ['archery'] },
      },
    },
  });
  check(
    'o mestre edita a escolha de característica (200)',
    masterChoiceEdit.data?.character?.classState?.choices?.['fighter-fighting-style']?.[0] ===
      'archery' &&
      masterChoiceEdit.data?.character?.derived?.armorClass?.classBonus === 0,
    JSON.stringify(masterChoiceEdit.data?.character?.derived?.armorClass),
  );

  // --- Bardo (Pau para Toda Obra) e Paladino (Aura de Proteção) -------------
  // Cenários de nível alto são preparados direto no banco, como no resto do
  // smoke (o nível de uma classe só sobe pelo fluxo de Level Up).
  await setCharacterClasses(choicesId, [{ classKey: 'bard', level: 2 }]);
  const bardSheet = (await api('/api/characters/me', { token: choicesToken })).data.character;
  const inspiration = (bardSheet?.classAdjustments?.resources ?? []).find(
    (resource: any) => resource.id === 'bardic-inspiration',
  );
  check(
    'Inspiração de Bardo: usos = mod. de CAR com mínimo 1 (CAR 10 → 1)',
    inspiration?.max === 1 && inspiration?.recharge === 'long',
    JSON.stringify(inspiration),
  );
  check(
    'Pau para Toda Obra dá metade da proficiência (nível 2 → +1)',
    bardSheet?.derived?.halfProficiencyBonus === 1 &&
      bardSheet?.derived?.skills?.athletics?.total ===
        bardSheet?.derived?.modifiers?.strength + 1 &&
      bardSheet?.derived?.initiative === bardSheet?.derived?.modifiers?.dexterity + 1,
    JSON.stringify({
      half: bardSheet?.derived?.halfProficiencyBonus,
      athletics: bardSheet?.derived?.skills?.athletics,
      initiative: bardSheet?.derived?.initiative,
    }),
  );
  check(
    'Pau para Toda Obra NÃO entra em perícia com proficiência',
    bardSheet?.derived?.skills?.nature?.proficient === true &&
      bardSheet?.derived?.skills?.nature?.total === bardSheet?.derived?.modifiers?.intelligence + 2,
    JSON.stringify(bardSheet?.derived?.skills?.nature),
  );

  await prisma.character.update({
    where: { userId: choicesId },
    data: { charisma: 16, classState: { active: [], used: {}, choices: {} } as any },
  });
  const paladinSheet = await (async () => {
    await setCharacterClasses(choicesId, [{ classKey: 'paladin', level: 6 }]);
    return (await api('/api/characters/me', { token: choicesToken })).data.character;
  })();
  const divineSense = (paladinSheet?.classAdjustments?.resources ?? []).find(
    (resource: any) => resource.id === 'divine-sense',
  );
  const layOnHands = (paladinSheet?.classAdjustments?.resources ?? []).find(
    (resource: any) => resource.id === 'lay-on-hands',
  );
  check(
    'Aura de Proteção soma o mod. de CAR (mínimo +1) em TODAS as salvaguardas',
    paladinSheet?.derived?.saveBonus === 3 &&
      (paladinSheet?.derived?.saves ?? []).every(
        (save: any) =>
          save.total === save.modifier + (save.proficient ? 3 : 0) + 3 &&
          paladinSheet?.derived?.saveBonus === 3,
      ),
    JSON.stringify({ bonus: paladinSheet?.derived?.saveBonus, saves: paladinSheet?.derived?.saves }),
  );
  check(
    'Sentido Divino = 1 + mod. de CAR e Mãos Consagradas = 5 × nível',
    divineSense?.max === 4 && layOnHands?.max === 30 && layOnHands?.recharge === 'long',
    JSON.stringify({ divineSense, layOnHands }),
  );
  check(
    'o Estilo de Luta do Paladino fica pendente no nível 2 (não cobrado no 6)',
    (paladinSheet?.classes?.[0]?.featureChoices ?? []).some(
      (info: any) => info.featureId === 'paladin-fighting-style' && info.level === 2,
    ),
    JSON.stringify(paladinSheet?.classes?.[0]?.featureChoices),
  );

  await setCharacterClasses(choicesId, [{ classKey: 'ranger', level: 10 }]);
  await prisma.character.update({
    where: { userId: choicesId },
    data: {
      classState: {
        active: [],
        used: {},
        choices: {
          'favored-enemy': ['undead'],
          'favored-enemy-6': ['fiends'],
          'natural-explorer': ['forest'],
          'natural-explorer-6': ['arctic'],
        },
      } as any,
    },
  });
  const rangerTen = (await api('/api/characters/me', { token: choicesToken })).data.character;
  const rangerChoices = rangerTen?.classes?.[0]?.featureChoices ?? [];
  const explorerTen = rangerChoices.find((info: any) => info.featureId === 'natural-explorer-10');
  check(
    'o Inimigo Favorito melhora no 6 e no 14 e o Explorador Nato no 6 e no 10',
    rangerChoices.length === 7 &&
      explorerTen?.count === 2 &&
      rangerChoices.some((info: any) => info.featureId === 'favored-enemy-14') &&
      rangerChoices.find((info: any) => info.featureId === 'favored-enemy-6')?.chosen?.[0] ===
        'fiends',
    JSON.stringify(rangerChoices.map((info: any) => [info.featureId, info.level, info.count])),
  );
  check(
    'classes conhecidas: o Patrulheiro não tem limite de preparadas',
    rangerTen?.classes?.[0]?.spellcasting?.preparedCount === null &&
      rangerTen?.classes?.[0]?.spellcasting?.learning === 'known',
    JSON.stringify(rangerTen?.classes?.[0]?.spellcasting),
  );

  // --- 11.5d As subclasses do PHB que faltavam ---------------------------------
  // Bardo, Guerreiro, Paladino e Patrulheiro fecham o livro: escolhas de
  // subclasse feitas no MESMO nível da subclasse, limiar de crítico, dados de
  // superioridade, proficiências concedidas pela subclasse e as magias de
  // juramento do paladino.
  console.log('\n11.5d) Subclasses novas do PHB (bardo, guerreiro, paladino, patrulheiro)');

  const subclassSheet = (await api('/api/characters/me', { token: choicesToken })).data.character;
  const optionOf = (key: string): any =>
    (subclassSheet?.classOptions ?? []).find((option: any) => option.key === key);
  check(
    'o catálogo passa a ter as 9 subclasses novas (bardo 2, guerreiro 3, paladino 3, patrulheiro 2)',
    optionOf('bard')?.subclassNames?.length === 2 &&
      optionOf('fighter')?.subclassNames?.length === 3 &&
      optionOf('paladin')?.subclassNames?.length === 3 &&
      optionOf('ranger')?.subclassNames?.length === 2,
    JSON.stringify({
      bard: optionOf('bard')?.subclassNames,
      fighter: optionOf('fighter')?.subclassNames,
      paladin: optionOf('paladin')?.subclassNames,
      ranger: optionOf('ranger')?.subclassNames,
    }),
  );

  const hunterCatalogChoices = (optionOf('ranger')?.subclassChoices ?? []).filter(
    (item: any) => item.subclass === 'Caçador',
  );
  check(
    'o catálogo já traz as 4 escolhas do Caçador (a Presa é escolhida junto da subclasse)',
    hunterCatalogChoices.length === 4 &&
      hunterCatalogChoices.every((item: any) => item.chosen.length === 0) &&
      hunterCatalogChoices.map((item: any) => item.featureId).join(',') ===
        'hunters-prey,defensive-tactics,multiattack,superior-hunters-defense' &&
      hunterCatalogChoices.find((item: any) => item.featureId === 'hunters-prey')?.level === 3,
    JSON.stringify(hunterCatalogChoices.map((item: any) => [item.featureId, item.level])),
  );

  // --- Campeão: limiar de crítico e Atleta Extraordinário -------------------
  await setCharacterClasses(choicesId, [{ classKey: 'fighter', subclass: 'Campeão', level: 3 }]);
  const championThree = (await api('/api/characters/me', { token: choicesToken })).data.character;
  check(
    'Campeão: Crítico Aprimorado baixa o limiar de crítico para 19 no d20',
    championThree?.derived?.critThreshold === 19,
    JSON.stringify(championThree?.derived?.critThreshold),
  );

  await setCharacterClasses(choicesId, [{ classKey: 'fighter', subclass: 'Campeão', level: 7 }]);
  const championSeven = (await api('/api/characters/me', { token: choicesToken })).data.character;
  check(
    'Atleta Extraordinário soma metade da proficiência PARA CIMA, inclusive na iniciativa',
    championSeven?.derived?.halfProficiencyBonus === 2 &&
      championSeven?.derived?.initiative === championSeven?.derived?.modifiers?.dexterity + 2 &&
      championSeven?.derived?.skills?.athletics?.total ===
        championSeven?.derived?.modifiers?.strength + 2,
    JSON.stringify({
      half: championSeven?.derived?.halfProficiencyBonus,
      initiative: championSeven?.derived?.initiative,
      athletics: championSeven?.derived?.skills?.athletics,
    }),
  );

  await setCharacterClasses(choicesId, [{ classKey: 'fighter', subclass: 'Campeão', level: 15 }]);
  check(
    'Campeão (15): Crítico Superior baixa o limiar para 18 (o menor prevalece)',
    (await api('/api/characters/me', { token: choicesToken })).data.character?.derived
      ?.critThreshold === 18,
  );

  // --- Mestre da Batalha: dados de superioridade e manobras ------------------
  await setCharacterClasses(choicesId, [
    { classKey: 'fighter', subclass: 'Mestre da Batalha', level: 3 },
  ]);
  const battleMasterThree = (await api('/api/characters/me', { token: choicesToken })).data
    .character;
  const superiority = (battleMasterThree?.classAdjustments?.resources ?? []).find(
    (resource: any) => resource.id === 'superiority-dice',
  );
  const maneuversThree = (battleMasterThree?.classes?.[0]?.featureChoices ?? []).find(
    (info: any) => info.featureId === 'maneuvers',
  );
  const studentOfWar = (battleMasterThree?.classes?.[0]?.featureChoices ?? []).find(
    (info: any) => info.featureId === 'student-of-war',
  );
  check(
    'Mestre da Batalha: 4 dados de superioridade no 3º nível, voltando no descanso curto',
    superiority?.max === 4 && superiority?.recharge === 'short',
    JSON.stringify(superiority),
  );
  check(
    'as 16 manobras do PHB são oferecidas (3 escolhidas no 3º nível)',
    maneuversThree?.count === 3 && maneuversThree?.options?.length === 16,
    JSON.stringify({ count: maneuversThree?.count, options: maneuversThree?.options?.length }),
  );
  check(
    'Estudante da Guerra: 1 ferramenta de artesão à escolha (13 do livro)',
    studentOfWar?.count === 1 && studentOfWar?.options?.length === 13,
    JSON.stringify({ count: studentOfWar?.count, options: studentOfWar?.options?.length }),
  );

  await setCharacterClasses(choicesId, [
    { classKey: 'fighter', subclass: 'Mestre da Batalha', level: 7 },
  ]);
  const battleMasterSeven = (await api('/api/characters/me', { token: choicesToken })).data
    .character;
  check(
    'Mestre da Batalha (7): 5 dados e mais duas manobras',
    (battleMasterSeven?.classAdjustments?.resources ?? []).find(
      (resource: any) => resource.id === 'superiority-dice',
    )?.max === 5 &&
      (battleMasterSeven?.classes?.[0]?.featureChoices ?? []).find(
        (info: any) => info.featureId === 'maneuvers-7',
      )?.count === 2,
    JSON.stringify(battleMasterSeven?.classAdjustments?.resources),
  );

  await setCharacterClasses(choicesId, [
    { classKey: 'fighter', subclass: 'Mestre da Batalha', level: 15 },
  ]);
  const battleMasterFifteen = (await api('/api/characters/me', { token: choicesToken })).data
    .character;
  const superiorityIds = (battleMasterFifteen?.activeFeatures ?? [])
    .filter((feature: any) => feature.source === 'subclass')
    .map((feature: any) => feature.id);
  check(
    'Mestre da Batalha (15): 6 dados, mais duas manobras e Conheça seu Inimigo',
    (battleMasterFifteen?.classAdjustments?.resources ?? []).find(
      (resource: any) => resource.id === 'superiority-dice',
    )?.max === 6 &&
      (battleMasterFifteen?.classes?.[0]?.featureChoices ?? []).find(
        (info: any) => info.featureId === 'maneuvers-15',
      )?.count === 2 &&
      superiorityIds.includes('know-your-enemy') &&
      superiorityIds.includes('relentless'),
    JSON.stringify(superiorityIds),
  );

  // --- Cavaleiro Arcano: terço-conjurador de INT ----------------------------
  await setCharacterClasses(choicesId, [
    { classKey: 'fighter', subclass: 'Cavaleiro Arcano', level: 3 },
  ]);
  const knightThree = (await api('/api/characters/me', { token: choicesToken })).data.character;
  check(
    'Cavaleiro Arcano: terço-conjurador de INT com magias conhecidas e os espaços dele',
    knightThree?.classes?.[0]?.spellcasting?.type === 'third' &&
      knightThree?.classes?.[0]?.spellcasting?.ability === 'intelligence' &&
      knightThree?.classes?.[0]?.spellcasting?.learning === 'known' &&
      JSON.stringify((knightThree?.derived?.spellSlots ?? []).map((slot: any) => [slot.level, slot.max])) ===
        JSON.stringify([[1, 2]]),
    JSON.stringify({
      casting: knightThree?.classes?.[0]?.spellcasting,
      slots: knightThree?.derived?.spellSlots,
    }),
  );

  await setCharacterClasses(choicesId, [
    { classKey: 'fighter', subclass: 'Cavaleiro Arcano', level: 7 },
  ]);
  const knightSeven = (await api('/api/characters/me', { token: choicesToken })).data.character;
  check(
    'Cavaleiro Arcano (7): os espaços sobem para 4/2 e a Magia de Guerra entra',
    JSON.stringify((knightSeven?.derived?.spellSlots ?? []).map((slot: any) => [slot.level, slot.max])) ===
      JSON.stringify([
        [1, 4],
        [2, 2],
      ]) &&
      (knightSeven?.activeFeatures ?? []).some((feature: any) => feature.id === 'war-magic'),
    JSON.stringify(knightSeven?.derived?.spellSlots),
  );

  // --- Juramentos do Paladino -----------------------------------------------
  await setCharacterClasses(choicesId, [
    { classKey: 'paladin', subclass: 'Juramento de Devoção', level: 3 },
  ]);
  const devotion = (await api('/api/characters/me', { token: choicesToken })).data.character;
  const channelDivinity = (devotion?.classAdjustments?.resources ?? []).find(
    (resource: any) => resource.id === 'channel-divinity',
  );
  const devotionIds = (devotion?.activeFeatures ?? [])
    .filter((feature: any) => feature.source === 'subclass')
    .map((feature: any) => feature.id);
  check(
    'Canalizar Divindade do juramento: 1 uso, recuperado no descanso curto ou longo',
    channelDivinity?.max === 1 && channelDivinity?.recharge === 'short',
    JSON.stringify(channelDivinity),
  );
  check(
    'as magias de juramento do 3º nível entram como característica da subclasse',
    devotionIds.includes('oath-spells') && !devotionIds.includes('aura-of-devotion'),
    JSON.stringify(devotionIds),
  );

  await setCharacterClasses(choicesId, [
    { classKey: 'paladin', subclass: 'Juramento de Vingança', level: 20 },
  ]);
  const vengeance = (await api('/api/characters/me', { token: choicesToken })).data.character;
  const vengeanceIds = (vengeance?.activeFeatures ?? [])
    .filter((feature: any) => feature.source === 'subclass')
    .map((feature: any) => feature.id);
  check(
    'o juramento cobre as 5 faixas de magias e as características de 7/15/20',
    [
      'oath-spells',
      'oath-spells-5',
      'oath-spells-9',
      'oath-spells-13',
      'oath-spells-17',
      'relentless-avenger',
      'soul-of-vengeance',
      'avenging-angel',
    ].every((id) => vengeanceIds.includes(id)) &&
      (vengeance?.classAdjustments?.resources ?? []).find(
        (resource: any) => resource.id === 'avenging-angel',
      )?.max === 1,
    JSON.stringify(vengeanceIds),
  );

  // --- Bardo: Colégio do Conhecimento (escolha no MESMO nível) -------------- 
  await setCharacterClasses(choicesId, [{ classKey: 'bard', level: 2 }]);
  await prisma.character.update({
    where: { userId: choicesId },
    data: { classState: { active: [], used: {}, choices: {} } as any },
  });
  await api('/api/game/level-up', { method: 'POST', token: masterToken });
  check(
    'Colégio do Conhecimento: o 3º nível não fecha sem as 3 perícias (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: choicesToken,
        body: { classKey: 'bard', hp: 'average', subclass: 'Colégio do Conhecimento' },
      })
    ).status === 400,
  );
  // A Expertise do bardo chega no 3º nível junto com a subclasse: as duas
  // escolhas saem do que o personagem JÁ domina (o servidor recusa o resto).
  const loreExpertise = await ensureExpertisePool({ id: choicesCharacterId });
  const loreUp = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: choicesToken,
    body: {
      classKey: 'bard',
      hp: 'average',
      subclass: 'Colégio do Conhecimento',
      choices: {
        'bonus-proficiencies': ['arcana', 'history', 'insight'],
        expertise: loreExpertise,
      },
    },
  });
  check(
    'Colégio do Conhecimento: a subclasse e as 3 perícias entram na mesma subida (200)',
    loreUp.status === 200 &&
      loreUp.data?.character?.classes?.[0]?.subclass === 'Colégio do Conhecimento' &&
      (['arcana', 'history', 'insight'] as string[]).every(
        (key) => loreUp.data?.character?.skills?.[key]?.proficient === true,
      ) &&
      (loreUp.data?.character?.classState?.choices?.['bonus-proficiencies'] ?? []).length === 3,
    JSON.stringify(loreUp.data?.message ?? loreUp.data?.character?.classState),
  );
  check(
    'Expertise do bardo: as 2 escolhas entram em expertiseSkills e dobram o bônus',
    loreUp.status === 200 &&
      (loreUp.data?.character?.expertiseSkills ?? []).length === 2 &&
      (loreUp.data?.character?.expertiseSkills ?? []).includes(loreExpertise[0]) &&
      loreUp.data?.character?.skills?.[loreExpertise[0]]?.expertise === true,
    JSON.stringify({
      expertise: loreUp.data?.character?.expertiseSkills,
      skill: loreUp.data?.character?.skills?.[loreExpertise[0]],
    }),
  );
  const blockedUncheck = await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      skills: {
        ...(loreUp.data?.character?.skills ?? {}),
        [loreExpertise[0]]: { proficient: false, expertise: true },
      },
    },
  });
  check(
    'tirar a proficiência de uma perícia em Expertise é recusado (400)',
    blockedUncheck.status === 400 &&
      String(blockedUncheck.data?.message ?? '').includes('Expertise'),
    JSON.stringify(blockedUncheck.data),
  );

  // --- Bardo: Colégio da Bravura (proficiências da subclasse) --------------- 
  // Proficiências zeradas antes: assim o que aparecer na ficha é só o que a
  // SUBCLASSE concedeu.
  await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { proficiencies: { armor: [], weapons: [], tools: [] } },
  });
  await setCharacterClasses(choicesId, [{ classKey: 'bard', level: 2 }]);
  await prisma.character.update({
    where: { userId: choicesId },
    data: { classState: { active: [], used: {}, choices: {} } as any },
  });
  await api('/api/game/level-up', { method: 'POST', token: masterToken });
  const valorExpertise = await ensureExpertisePool({ id: choicesCharacterId });
  const valorUp = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: choicesToken,
    body: {
      classKey: 'bard',
      hp: 'average',
      subclass: 'Colégio da Bravura',
      choices: { expertise: valorExpertise },
    },
  });
  check(
    'Colégio da Bravura concede armaduras médias, escudos e armas marciais (200)',
    valorUp.status === 200 &&
      JSON.stringify(valorUp.data?.character?.proficiencies?.armor) ===
        JSON.stringify(['Armaduras médias', 'Escudos']) &&
      JSON.stringify(valorUp.data?.character?.proficiencies?.weapons) ===
        JSON.stringify(['Armas marciais']) &&
      (valorUp.data?.character?.activeFeatures ?? []).some(
        (feature: any) => feature.id === 'combat-inspiration',
      ),
    JSON.stringify(valorUp.data?.character?.proficiencies),
  );

  // --- Patrulheiro: Caçador e Senhor das Feras ------------------------------ 
  await setCharacterClasses(choicesId, [{ classKey: 'ranger', level: 2 }]);
  await prisma.character.update({
    where: { userId: choicesId },
    data: { classState: { active: [], used: {}, choices: {} } as any },
  });
  await api('/api/game/level-up', { method: 'POST', token: masterToken });
  check(
    'Caçador: subir para o 3º sem a Presa do Caçador é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: choicesToken,
        body: { classKey: 'ranger', hp: 'average', subclass: 'Caçador' },
      })
    ).status === 400,
  );
  const hunterUp = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: choicesToken,
    body: {
      classKey: 'ranger',
      hp: 'average',
      subclass: 'Caçador',
      choices: { 'hunters-prey': ['colossus-slayer'] },
    },
  });
  check(
    'Caçador: a subclasse e a Presa do Caçador entram na mesma subida (200)',
    hunterUp.status === 200 &&
      hunterUp.data?.character?.classes?.[0]?.subclass === 'Caçador' &&
      hunterUp.data?.character?.classState?.choices?.['hunters-prey']?.[0] === 'colossus-slayer' &&
      (hunterUp.data?.character?.classes?.[0]?.featureChoices ?? []).some(
        (info: any) => info.featureId === 'defensive-tactics' && info.level === 7,
      ),
    JSON.stringify(hunterUp.data?.character?.classState),
  );

  await setCharacterClasses(choicesId, [{ classKey: 'ranger', level: 2 }]);
  await prisma.character.update({
    where: { userId: choicesId },
    data: { classState: { active: [], used: {}, choices: {} } as any },
  });
  await api('/api/game/level-up', { method: 'POST', token: masterToken });
  const beastUp = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: choicesToken,
    body: { classKey: 'ranger', hp: 'average', subclass: 'Senhor das Feras' },
  });
  check(
    'Senhor das Feras: o companheiro entra como característica informativa (200)',
    beastUp.status === 200 &&
      (beastUp.data?.character?.activeFeatures ?? []).some(
        (feature: any) => feature.id === 'rangers-companion' && feature.source === 'subclass',
      ),
    JSON.stringify(beastUp.data?.character?.activeFeatures),
  );

  await setCharacterClasses(choicesId, [
    { classKey: 'ranger', subclass: 'Senhor das Feras', level: 15 },
  ]);
  const beastFifteen = (await api('/api/characters/me', { token: choicesToken })).data.character;
  const beastIds = (beastFifteen?.activeFeatures ?? [])
    .filter((feature: any) => feature.source === 'subclass')
    .map((feature: any) => feature.id);
  check(
    'Senhor das Feras (15): Treinamento Excepcional, Fúria Bestial e Compartilhar Magias',
    ['exceptional-training', 'bestial-fury', 'share-spells'].every((id) => beastIds.includes(id)),
    JSON.stringify(beastIds),
  );

  // A ficha de teste sai de cena limpa (o usuário é apagado no fim do smoke).
  await api(`/api/characters/${choicesCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { classState: { active: [], used: {}, choices: {} } },
  });

  // --- 11.6 Compêndio da mesa (aba "Mesa") ----------------------------------
  console.log('\n11.6) Compêndio da mesa (aba Mesa)');

  check('o compêndio exige autenticação (401)', (await api('/api/compendium')).status === 401);

  const compendiumRes = await api('/api/compendium', { token: playerToken });
  const compendium = compendiumRes.data?.compendium;
  check(
    'o compêndio é acessível (200)',
    compendiumRes.status === 200,
    JSON.stringify(compendiumRes.data),
  );
  check(
    'há 12 classes, cada uma com dado de vida, duas salvaguardas e descrição',
    (compendium?.classes ?? []).length === 12 &&
      compendium.classes.every(
        (entry: any) =>
          entry.hitDie > 0 &&
          entry.savingThrows?.length === 2 &&
          typeof entry.description === 'string' &&
          entry.description.length > 20,
      ),
    JSON.stringify((compendium?.classes ?? []).map((entry: any) => entry.key)),
  );
  check(
    'o clérigo traz os 7 domínios',
    compendium?.classes?.find((entry: any) => entry.key === 'cleric')?.subclasses?.length === 7,
  );
  check(
    'há 18 linhagens de raça (9 raças + sub-raças), todas com história',
    (compendium?.races ?? []).length === 18 &&
      compendium.races.every((race: any) => (race.description ?? '').length > 0),
    JSON.stringify((compendium?.races ?? []).map((race: any) => race.key)),
  );
  check(
    'há 13 antecedentes, cada um com 2 perícias',
    (compendium?.backgrounds ?? []).length === 13 &&
      compendium.backgrounds.every((entry: any) => entry.skills?.length === 2),
    JSON.stringify((compendium?.backgrounds ?? []).map((entry: any) => entry.key)),
  );
  check(
    'o catálogo de magias está preparado (lista vazia por enquanto)',
    Array.isArray(compendium?.spells) && compendium.spells.length === 0,
    JSON.stringify(compendium?.spells),
  );
  check(
    'o compêndio traz as 37 armas canônicas do PHB',
    (compendium?.weapons ?? []).length === 37 &&
      compendium.weapons.every(
        (weapon: any) =>
          typeof weapon.id === 'string' &&
          typeof weapon.namePt === 'string' &&
          ['simple', 'martial'].includes(weapon.category) &&
          ['melee', 'ranged'].includes(weapon.type) &&
          Array.isArray(weapon.properties),
      ) &&
      compendium.weapons.some((weapon: any) => weapon.id === 'battleaxe') &&
      compendium.weapons.some((weapon: any) => weapon.id === 'hand-crossbow'),
    JSON.stringify((compendium?.weapons ?? []).map((weapon: any) => weapon.id)),
  );
  check(
    'armas à distância trazem alcance e munição no catálogo',
    (() => {
      const longbow = compendium?.weapons?.find((weapon: any) => weapon.id === 'longbow');
      const dagger = compendium?.weapons?.find((weapon: any) => weapon.id === 'dagger');
      return (
        longbow?.rangeNormal === 45 &&
        longbow?.rangeLong === 180 &&
        longbow?.ammoType === 'Flecha' &&
        dagger?.rangeNormal === 6 &&
        dagger?.rangeLong === 18 &&
        dagger?.ammoType === undefined
      );
    })(),
    JSON.stringify(compendium?.weapons?.find((weapon: any) => weapon.id === 'longbow')),
  );

  // --- 11.7 Assistente de Level Up ------------------------------------------
  console.log('\n11.7) Level Up (assistente)');

  const otherToken = otherReg.data.token;

  /**
   * Libera mais um Level Up para a mesa.
   *
   * Cada chamada é uma liberação nova, então basta pedir de novo — não existe
   * mais o desligar → ligar de antes.
   */
  async function unlockForLevelUp(): Promise<void> {
    await api('/api/game/level-up', {
      method: 'POST',
      token: masterToken,
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

  // --- Metamagia do Feiticeiro (PHB 2014) -----------------------------------
  // O Feiticeiro escolhe 2 Metamagias no 3º nível, +1 no 10º e +1 no 17º; as
  // opções do 10º/17º nunca repetem o que já foi aprendido, e a escolha é
  // OBRIGATÓRIA (o servidor recusa o nível sem ela).
  await setCharacterClasses(playerId, [
    { classKey: 'sorcerer', subclass: 'Linhagem Dracônica', level: 2 },
  ]);
  await unlockForLevelUp();
  check(
    'subir o Feiticeiro ao 3º sem escolher a Metamagia é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: playerToken,
        body: { classKey: 'sorcerer', hp: 'average' },
      })
    ).status === 400,
  );

  const sorcererTwo = (await api('/api/characters/me', { token: playerToken })).data.character;
  const metamagicInfo = (sorcererTwo.classes ?? [])
    .find((entry: any) => entry.classKey === 'sorcerer')
    ?.featureChoices?.find((info: any) => info.featureId === 'metamagic');
  check(
    'Metamagia do 3º nível pede 2 opções entre as 8 do livro, com descrição',
    metamagicInfo?.count === 2 &&
      metamagicInfo?.options?.length === 8 &&
      metamagicInfo.options.every((option: any) => (option.description ?? '').length > 0),
    JSON.stringify(metamagicInfo),
  );
  check(
    'a Elevada custa 3 pontos de feitiçaria (PHB 2014, não 2)',
    metamagicInfo?.options?.find((option: any) => option.key === 'heightened')?.description?.includes(
      '3 pontos',
    ) === true,
    JSON.stringify(metamagicInfo?.options),
  );

  const sorcererThree = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'sorcerer',
      hp: 'average',
      choices: { metamagic: ['careful', 'empowered'] },
    },
  });
  check(
    'escolher as 2 Metamagias no 3º nível sobe (200)',
    sorcererThree.status === 200,
    JSON.stringify(sorcererThree.data),
  );
  check(
    'as Metamagias escolhidas ficam gravadas na ficha',
    (sorcererThree.data?.character?.classState?.choices?.metamagic ?? []).join(',') ===
      'careful,empowered',
    JSON.stringify(sorcererThree.data?.character?.classState?.choices),
  );

  // Nível 10: aprende +1 Metamagia, sem repetir as do 3º.
  await setCharacterClasses(playerId, [
    { classKey: 'sorcerer', subclass: 'Linhagem Dracônica', level: 9 },
  ]);
  await unlockForLevelUp();
  const sorcererNine = (await api('/api/characters/me', { token: playerToken })).data.character;
  const improvement = (sorcererNine.classes ?? [])
    .find((entry: any) => entry.classKey === 'sorcerer')
    ?.featureChoices?.find((info: any) => info.featureId === 'metamagic-improvement');
  check(
    'a Metamagia Aprimorada (10º) pede 1 opção e exclui as já aprendidas',
    improvement?.count === 1 &&
      improvement?.options?.length === 6 &&
      !improvement.options.some((option: any) => option.key === 'careful' || option.key === 'empowered'),
    JSON.stringify(improvement),
  );
  check(
    'repetir uma Metamagia já aprendida no 10º é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: playerToken,
        body: {
          classKey: 'sorcerer',
          hp: 'average',
          choices: { 'metamagic-improvement': ['careful'] },
        },
      })
    ).status === 400,
  );
  const sorcererTen = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'sorcerer',
      hp: 'average',
      choices: { 'metamagic-improvement': ['heightened'] },
    },
  });
  check(
    'escolher a Metamagia do 10º sobe (200)',
    sorcererTen.status === 200,
    JSON.stringify(sorcererTen.data),
  );
  check(
    'a Metamagia do 10º é somada às do 3º',
    (sorcererTen.data?.character?.classState?.choices?.['metamagic-improvement'] ?? []).join(',') ===
      'heightened',
    JSON.stringify(sorcererTen.data?.character?.classState?.choices),
  );

  // Nível 17: +1 Metamagia, excluindo as 3 já aprendidas.
  await setCharacterClasses(playerId, [
    { classKey: 'sorcerer', subclass: 'Linhagem Dracônica', level: 16 },
  ]);
  await unlockForLevelUp();
  const sorcererSixteen = (await api('/api/characters/me', { token: playerToken })).data.character;
  const master = (sorcererSixteen.classes ?? [])
    .find((entry: any) => entry.classKey === 'sorcerer')
    ?.featureChoices?.find((info: any) => info.featureId === 'metamagic-master');
  check(
    'o Mestre da Metamagia (17º) exclui as 3 já aprendidas',
    master?.count === 1 && master?.options?.length === 5,
    JSON.stringify(master),
  );
  const sorcererSeventeen = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'sorcerer',
      hp: 'average',
      choices: { 'metamagic-master': [master.options[0].key] },
    },
  });
  check(
    'escolher a Metamagia do 17º sobe (200)',
    sorcererSeventeen.status === 200,
    JSON.stringify(sorcererSeventeen.data),
  );

  // --- Pré-requisito de MULTICLASSE do PHB (cap. 6) -------------------------
  // Entrar numa classe nova exige 13 nos atributos exigidos por ela E por todas
  // as classes que o personagem JÁ tem. O Paladino abaixo fica com Força 8
  // (pré-requisito perdido), o que precisa barrar a entrada no Ladino mesmo
  // com Destreza 14.
  await setCharacterClasses(playerId, [{ classKey: 'paladin', level: 1 }]);
  await prisma.character.update({
    where: { userId: playerId },
    data: { strength: 8, dexterity: 14 },
  });
  await unlockForLevelUp();
  const blockedByPaladin = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: { classKey: 'rogue', hp: 'average', skillChoice: 'stealth' },
  });
  check(
    'multiclassar é barrado quando uma classe ATUAL está sem o pré-requisito (400)',
    blockedByPaladin.status === 400,
    JSON.stringify(blockedByPaladin.data),
  );
  check(
    'a mensagem do bloqueio diz qual classe exige o quê',
    typeof blockedByPaladin.data?.message === 'string' &&
      blockedByPaladin.data.message.includes('Paladino') &&
      blockedByPaladin.data.message.includes('Força 13'),
    JSON.stringify(blockedByPaladin.data),
  );
  const paladinOptions = (await api('/api/characters/me', { token: playerToken })).data.character
    .classOptions;
  check(
    'o DTO marca a classe nova como inelegível citando a classe atual',
    paladinOptions.find((item: any) => item.key === 'rogue')?.eligible === false &&
      (paladinOptions.find((item: any) => item.key === 'rogue')?.missing ?? '').includes(
        'Paladino',
      ),
    JSON.stringify(paladinOptions.find((item: any) => item.key === 'rogue')),
  );
  check(
    'a classe que o personagem já tem continua elegível (subir nela não exige nada)',
    paladinOptions.find((item: any) => item.key === 'paladin')?.eligible === true,
  );

  // Com os pré-requisitos do Paladino de volta (Força e Carisma 13), entrar no
  // Ladino exige a perícia de multiclasse (PHB p.164) e concede só o conjunto
  // reduzido de proficiências.
  // As salvaguardas gravadas são zeradas junto: é assim que dá para conferir
  // depois que o Ladino (segunda classe) NÃO concede Destreza/Inteligência.
  await prisma.character.update({
    where: { userId: playerId },
    data: { strength: 13, charisma: 13, saves: {} },
  });
  const rogueWithoutSkill = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: { classKey: 'rogue', hp: 'average' },
  });
  check(
    'entrar em Ladino exige a perícia de multiclasse (400)',
    rogueWithoutSkill.status === 400,
    JSON.stringify(rogueWithoutSkill.data),
  );
  const rogueSkillOutOfList = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: { classKey: 'rogue', hp: 'average', skillChoice: 'arcana' },
  });
  check(
    'perícia fora da lista da classe é recusada (400)',
    rogueSkillOutOfList.status === 400,
    JSON.stringify(rogueSkillOutOfList.data),
  );
  // O Ladino concede a Expertise já no 1º nível (inclusive entrando por
  // multiclasse): a escolha sai do que o personagem já domina.
  const rogueExpertise = await ensureExpertisePool({ userId: playerId });
  const rogueEntry = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: playerToken,
    body: {
      classKey: 'rogue',
      hp: 'average',
      skillChoice: 'stealth',
      choices: { expertise: rogueExpertise },
    },
  });
  check(
    'entrar em Ladino aplica a perícia escolhida (200)',
    rogueEntry.status === 200 && rogueEntry.data?.character?.skills?.stealth?.proficient === true,
    JSON.stringify({ status: rogueEntry.status, body: rogueEntry.data }),
  );
  check(
    'a entrada por multiclasse concede o conjunto reduzido (Ferramentas de ladrão)',
    (rogueEntry.data?.character?.proficiencies?.tools ?? []).includes('Ferramentas de ladrão') &&
      (rogueEntry.data?.character?.proficiencies?.armor ?? []).includes('Armaduras leves'),
    JSON.stringify(rogueEntry.data?.character?.proficiencies ?? rogueEntry.data),
  );
  check(
    'e NÃO concede a lista completa do nível 1 (Espadas longas)',
    !(rogueEntry.data?.character?.proficiencies?.weapons ?? []).includes('Espadas longas'),
    JSON.stringify(rogueEntry.data?.character?.proficiencies?.weapons),
  );
  check(
    'multiclasse não concede salvaguardas: só as da PRIMEIRA classe ficam fixas',
    // As do Paladino (primeira classe) seguem fixas: Sabedoria e Carisma.
    rogueEntry.data?.character?.saves?.wisdom === true &&
      rogueEntry.data?.character?.saves?.charisma === true &&
      rogueEntry.data?.character?.saves?.dexterity === false &&
      rogueEntry.data?.character?.saves?.intelligence === false,
    JSON.stringify(rogueEntry.data?.character?.saves),
  );

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
    [4, { background: 'Sábio', backgroundLanguageChoices: ['Élfico', 'Anão'] }],
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
    ['proficiências de armadura/arma/ferramenta', { proficiencies: { armor: [], weapons: [] } }],
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
      // O jogador devolve o classState inteiro (como o cliente faz): sem as
      // `choices` ele pareceria estar tentando apagá-las.
      classState: {
        ...(finalized.data?.character?.classState ?? { active: [], used: {}, choices: {} }),
        active: ['rage'],
        used: { rage: 1 },
      },
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
  const masterProficiencies = await api(`/api/characters/${playerCharacterId}`, {
    method: 'PATCH',
    token: masterToken,
    body: { proficiencies: { armor: ['Armaduras leves'], weapons: ['Machados'], tools: [] } },
  });
  check(
    'o mestre edita as proficiências de uma ficha finalizada (200)',
    masterProficiencies.status === 200 &&
      (masterProficiencies.data?.character?.proficiencies?.weapons ?? []).includes('Machados'),
    JSON.stringify(masterProficiencies.data?.character?.proficiencies),
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

  // O catálogo de raças do Livro do Jogador já vem preenchido: o passo 3 lista
  // as linhagens (com os bônus somados) em vez de pedir texto livre.
  const raceCatalog: any[] = emptyCreation.data?.creation?.raceCatalog ?? [];
  const hillDwarf = raceCatalog.find((race: any) => race.key === 'dwarf:hill-dwarf');
  check(
    'o catálogo de raças traz as linhagens do PHB com os bônus',
    raceCatalog.length >= 18 &&
      hillDwarf?.abilityBonuses?.constitution === 2 &&
      hillDwarf?.abilityBonuses?.wisdom === 1 &&
      raceCatalog.some((race: any) => race.key === 'elf:drow-elf'),
    JSON.stringify(raceCatalog.map((race: any) => race.key)),
  );
  check(
    'o humano soma +1 nos seis atributos e o meio-elfo pede duas escolhas',
    Object.values(
      raceCatalog.find((race: any) => race.key === 'human')?.abilityBonuses ?? {},
    ).every((value) => value === 1) &&
      raceCatalog.find((race: any) => race.key === 'half-elf')?.abilityChoice === 2,
    JSON.stringify(raceCatalog.find((race: any) => race.key === 'human')?.abilityBonuses),
  );

  // Antecedentes: os 13 do Livro do Jogador, cada um com as duas perícias.
  const backgroundCatalog: any[] = emptyCreation.data?.creation?.backgroundCatalog ?? [];
  const sage = backgroundCatalog.find((item: any) => item.key === 'sage');
  check(
    'o catálogo de antecedentes traz os 13 do PHB com as perícias',
    backgroundCatalog.length === 13 &&
      JSON.stringify(sage?.skills) === JSON.stringify(['arcana', 'history']) &&
      backgroundCatalog.every((item: any) => (item.skills ?? []).length === 2),
    JSON.stringify(backgroundCatalog.map((item: any) => item.key)),
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
    [3, { race: 'Tiefling' }],
    [4, { background: 'Sábio', backgroundLanguageChoices: ['Élfico', 'Anão'] }],
  ];
  const walkStatuses: number[] = [];
  let sageStep: any = null;
  for (const [step, body] of walkSteps) {
    const walked = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: rookieToken,
      body: { step, ...body },
    });
    walkStatuses.push(walked.status);
    if (step === 4) sageStep = walked;
  }
  check(
    'identidade, raça e antecedente são salvos passo a passo (200)',
    walkStatuses.every((status) => status === 200),
    JSON.stringify(walkStatuses),
  );
  check(
    'o antecedente concede as perícias sem gastar as escolhas da classe',
    sageStep?.data?.character?.skills?.arcana?.proficient === true &&
      sageStep?.data?.character?.skills?.history?.proficient === true &&
      (sageStep?.data?.creation?.skillPicks ?? []).length === 0,
    JSON.stringify({
      arcana: sageStep?.data?.character?.skills?.arcana,
      history: sageStep?.data?.character?.skills?.history,
      picks: sageStep?.data?.creation?.skillPicks,
    }),
  );

  check(
    'finalizar com passos faltando é recusado com a lista do que falta (400)',
    (
      await api('/api/characters/me/creation/finalize', { method: 'POST', token: rookieToken })
    ).status === 400,
  );

  // Clérigo, Feiticeiro e Bruxo escolhem a SUBCLASSE já no nível 1 (Domínio,
  // Origem e Patrono): o passo da classe exige a escolha.
  check(
    'classe com subclasse no nível 1 exige a escolha (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 5, classKey: 'cleric' },
      })
    ).status === 400,
  );
  check(
    'subclasse fora do catálogo é recusada (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 5, classKey: 'cleric', subclass: 'Domínio Inventado' },
      })
    ).status === 400,
  );
  check(
    'subclasse de classe que só a libera depois é recusada (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 5, classKey: 'fighter', subclass: 'Campeão' },
      })
    ).status === 400,
  );
  const clericPick = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 5, classKey: 'cleric', subclass: 'Domínio da Vida' },
  });
  check(
    'a subclasse do nível 1 entra na ficha junto da classe (200)',
    clericPick.status === 200 &&
      clericPick.data?.character?.classes?.[0]?.classKey === 'cleric' &&
      clericPick.data?.character?.classes?.[0]?.subclass === 'Domínio da Vida',
    JSON.stringify(clericPick.data?.character?.classes),
  );
  const clericKept = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 5, classKey: 'cleric' },
  });
  check(
    'voltar ao passo da classe sem trocar nada mantém a subclasse (200)',
    clericKept.status === 200 &&
      clericKept.data?.character?.classes?.[0]?.subclass === 'Domínio da Vida',
    JSON.stringify(clericKept.data?.character?.classes),
  );

  // Escolhas que a classe faz JÁ no nível 1 (Guerreiro e Patrulheiro): o passo
  // da classe mostra as opções do CATÁLOGO e exige a escolha. O assistente usa
  // `classOptions[].featureChoices` porque na hora a ficha ainda não tem classe.
  check(
    'o passo da classe exige o Estilo de Luta do Guerreiro (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 5, classKey: 'fighter' },
      })
    ).status === 400,
  );
  const fighterPick = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 5, classKey: 'fighter', choices: { 'fighter-fighting-style': ['archery'] } },
  });
  check(
    'a escolha do nível 1 entra pelo assistente, com as opções visíveis (200)',
    fighterPick.status === 200 &&
      fighterPick.data?.character?.classState?.choices?.['fighter-fighting-style']?.[0] ===
        'archery' &&
      fighterPick.data?.creation?.featureChoices?.[0]?.options?.length === 6 &&
      fighterPick.data?.creation?.featureChoices?.[0]?.chosen?.[0] === 'archery',
    JSON.stringify({
      choices: fighterPick.data?.character?.classState?.choices,
      featureChoices: fighterPick.data?.creation?.featureChoices,
    }),
  );
  const classSwap = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: { step: 5, classKey: 'monk' },
  });
  check(
    'trocar a classe descarta as escolhas da anterior (e a nova não pede nenhuma)',
    classSwap.status === 200 &&
      classSwap.data?.character?.classState?.choices?.['fighter-fighting-style'] === undefined &&
      (classSwap.data?.creation?.featureChoices ?? []).length === 0,
    JSON.stringify({
      choices: classSwap.data?.character?.classState?.choices,
      featureChoices: classSwap.data?.creation?.featureChoices,
    }),
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
    // A mensagem cita a classe e o atributo exigido (PHB cap. 6).
    badAbilities.status === 400 &&
      String(badAbilities.data?.message ?? '').includes('Bárbaro') &&
      String(badAbilities.data?.message ?? '').includes('Força 13'),
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

  // Raça do catálogo no passo 3: os bônus entram na ficha e as escolhas do
  // Meio-Elfo são validadas contra o catálogo. (O resto do assistente remonta a
  // ficha a partir do passo 2, então nada aqui vaza para os testes seguintes.)
  check(
    'raça com escolha sem informar os atributos à escolha é recusada (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 3, race: 'Meio-Elfo' },
      })
    ).status === 400,
  );
  check(
    'escolher um atributo fora do pool da raça é recusado (400)',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 3, race: 'Meio-Elfo', abilityChoices: ['charisma', 'strength'] },
      })
    ).status === 400,
  );
  const halfElf = await api('/api/characters/me/creation', {
    method: 'PATCH',
    token: rookieToken,
    body: {
      step: 3,
      race: 'Meio-Elfo',
      abilityChoices: ['strength', 'constitution'],
      raceChoices: { 'half-elf-skill-1': 'perception', 'half-elf-skill-2': 'stealth' },
      languageChoices: ['Gigante'],
    },
  });
  check(
    'os bônus fixos e os +1 à escolha entram na ficha (200)',
    halfElf.status === 200 &&
      halfElf.data?.character?.charisma === 10 &&
      halfElf.data?.character?.strength === 16 &&
      halfElf.data?.character?.constitution === 15 &&
      JSON.stringify(halfElf.data?.creation?.abilityChoices) ===
        JSON.stringify(['strength', 'constitution']),
    JSON.stringify({
      charisma: halfElf.data?.character?.charisma,
      strength: halfElf.data?.character?.strength,
      choices: halfElf.data?.creation?.abilityChoices,
    }),
  );
  check(
    'voltar para uma raça sem escolha limpa os +1 à escolha',
    (
      await api('/api/characters/me/creation', {
        method: 'PATCH',
        token: rookieToken,
        body: { step: 3, race: 'Tiefling' },
      })
    ).status === 200 &&
      (await api('/api/characters/me/creation', { token: rookieToken })).data?.creation
        ?.abilityChoices?.length === 0,
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
    [3, { race: 'Tiefling' }],
    [4, { background: 'Sábio', backgroundLanguageChoices: ['Élfico', 'Anão'] }],
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

  // ==========================================================================
  // FASE 0 — regressão das regras base e das fases de ataques/itens/moedas
  // (seções 14 a 26)
  //
  // Cada seção cria as PRÓPRIAS contas (sufixo único) e limpa no final, como o
  // resto do smoke. Os cenários de nível alto são montados direto no banco
  // (`setCharacterClasses`), porque o nível de uma classe só sobe pelo Level Up.
  //
  // Tudo vive num BLOCO próprio: assim os nomes daqui não colidem com os dos
  // cenários das seções anteriores (que já usam `championThree`, `equipped`…).
  // ==========================================================================
  {

  /** Jogador novo com a ficha em branco, para as seções da Fase 0. */
  async function freshSheet(prefix: string): Promise<{
    token: string;
    userId: string;
    characterId: string;
  }> {
    const username = `${prefix}_${suffix}`;
    createdUsernames.push(username);
    const registered = await api('/api/auth/register', {
      method: 'POST',
      body: { username, displayName: `Fase 0 ${prefix}`, password: 'senha-forte-123' },
    });
    const token: string = registered.data?.token;
    const userId: string = registered.data?.user?.id;
    const sheet = await api('/api/characters/me', { method: 'POST', token, body: {} });
    check(
      `conta da Fase 0 (${prefix}) com ficha criada`,
      registered.status === 201 && Boolean(userId) && Boolean(sheet.data?.character?.id),
      JSON.stringify(registered.data),
    );
    return { token, userId, characterId: sheet.data?.character?.id };
  }

  /** PATCH do mestre na ficha de um jogador. */
  const masterPatch = (characterId: string, body: unknown) =>
    api(`/api/characters/${characterId}`, { method: 'PATCH', token: masterToken, body });

  /** Lê a ficha do próprio jogador. */
  const sheetOf = async (token: string) =>
    (await api('/api/characters/me', { token })).data.character;

  /** Estado de classe (toggles/usos/escolhas) gravado direto no banco. */
  const setState = (
    userId: string,
    classState: unknown = { active: [], used: {}, choices: {} },
  ) => prisma.character.update({ where: { userId }, data: { classState: classState as any } });

  /** Item avulso já equipado no inventário (armadura, escudo…). */
  const equipped = (
    name: string,
    category: 'Armadura' | 'Escudo',
    details: Record<string, unknown>,
    slot: string | null = 'chest',
  ) => ({
    id: `fase0-${name}`,
    name,
    description: '',
    quantity: 1,
    weight: 5,
    slot,
    backpackX: null,
    backpackY: null,
    imageUrl: '',
    itemId: '',
    category,
    details,
  });

  // --- 14. PV e CA automáticos (regressão) ----------------------------------
  console.log('\n14) PV e CA automáticos (regressão)');

  const vitals = await freshSheet('fase0pv');
  await prisma.character.update({
    where: { userId: vitals.userId },
    data: { constitution: 14, dexterity: 18, wisdom: 16 },
  });

  const fighterOne = await masterPatch(vitals.characterId, {
    classes: [{ classKey: 'fighter' }],
  });
  check(
    'PV inicial = dado de vida máximo + CON (Guerreiro d10 com CON 14 → 12)',
    fighterOne.data?.character?.hpMax === 12 && fighterOne.data?.character?.hpCurrent === 12,
    JSON.stringify({ hpMax: fighterOne.data?.character?.hpMax }),
  );

  const arcane = await freshSheet('fase0pv2');
  // A classe nova também passa pelo pré-requisito do livro (Mago exige INT 13).
  await prisma.character.update({
    where: { userId: arcane.userId },
    data: { constitution: 14, intelligence: 14 },
  });
  const wizardOne = await masterPatch(arcane.characterId, { classes: [{ classKey: 'wizard' }] });
  check(
    'o PV inicial segue o dado de vida da classe (Mago d6 com CON 14 → 8)',
    wizardOne.data?.character?.hpMax === 8,
    JSON.stringify({ hpMax: wizardOne.data?.character?.hpMax }),
  );

  // Recálculo retroativo: o modificador novo vale como se existisse desde o 1º
  // nível — o delta cobre TODOS os níveis já obtidos e entra no máximo e no atual.
  await setCharacterClasses(vitals.userId, [{ classKey: 'fighter', level: 5 }]);
  await prisma.character.update({
    where: { userId: vitals.userId },
    data: { constitution: 14, hpMax: 40, hpCurrent: 30 },
  });
  const conUp = await masterPatch(vitals.characterId, { constitution: 16 });
  check(
    'subir CON no 5º nível soma (novo mod − mod antigo) × nível no máximo E no atual',
    conUp.data?.character?.hpMax === 45 && conUp.data?.character?.hpCurrent === 35,
    JSON.stringify({
      hpMax: conUp.data?.character?.hpMax,
      hpCurrent: conUp.data?.character?.hpCurrent,
    }),
  );
  const conDown = await masterPatch(vitals.characterId, { constitution: 8 });
  check(
    'reduzir CON reduz os dois na mesma medida',
    conDown.data?.character?.hpMax === 25 && conDown.data?.character?.hpCurrent === 15,
    JSON.stringify({
      hpMax: conDown.data?.character?.hpMax,
      hpCurrent: conDown.data?.character?.hpCurrent,
    }),
  );

  // O detalhe da CA vem do corpo da resposta (`{ status, data: { character } }`).
  const armorClassOf = (payload: any) => payload?.data?.character?.derived?.armorClass;

  const lightArmor = await masterPatch(vitals.characterId, {
    inventory: [equipped('Couro batido', 'Armadura', { armorType: 'Leve', baseArmorClass: 12 })],
  });
  check(
    'armadura leve soma a Destreza inteira (12 + DES 4 = 16)',
    armorClassOf(lightArmor)?.automatic === 16 &&
      armorClassOf(lightArmor)?.dexterityBonus === 4 &&
      lightArmor.data?.character?.armorClass === 16,
    JSON.stringify(armorClassOf(lightArmor)),
  );

  const mediumArmor = await masterPatch(vitals.characterId, {
    inventory: [equipped('Camisão de malha', 'Armadura', { armorType: 'Média', baseArmorClass: 13 })],
  });
  check(
    'armadura média limita a Destreza a +2 (13 + 2 = 15)',
    armorClassOf(mediumArmor)?.automatic === 15 && armorClassOf(mediumArmor)?.dexterityBonus === 2,
    JSON.stringify(armorClassOf(mediumArmor)),
  );

  const heavyArmor = await masterPatch(vitals.characterId, {
    inventory: [equipped('Cota de malha', 'Armadura', { armorType: 'Pesada', baseArmorClass: 16 })],
  });
  check(
    'armadura pesada ignora a Destreza (16, sem bônus de DES)',
    armorClassOf(heavyArmor)?.automatic === 16 && armorClassOf(heavyArmor)?.dexterityBonus === 0,
    JSON.stringify(armorClassOf(heavyArmor)),
  );

  const withShield = await masterPatch(vitals.characterId, {
    inventory: [
      equipped('Cota de malha', 'Armadura', { armorType: 'Pesada', baseArmorClass: 16 }),
      equipped('Escudo', 'Escudo', { armorClassBonus: 2 }, 'hand2'),
    ],
  });
  check(
    'o escudo soma em cima de qualquer armadura (16 + 2 = 18)',
    armorClassOf(withShield)?.automatic === 18 && armorClassOf(withShield)?.shieldBonus === 2,
    JSON.stringify(armorClassOf(withShield)),
  );

  // Defesa sem Armadura: Bárbaro (10 + DES + CON) e Monge (10 + DES + SAB, que
  // exige NENHUM escudo). Vale a fórmula que der o maior valor — a Constituição
  // volta ao normal para a conta do Bárbaro ficar acima do padrão 10 + DES.
  await prisma.character.update({
    where: { userId: vitals.userId },
    data: { constitution: 14 },
  });
  await setCharacterClasses(vitals.userId, [{ classKey: 'barbarian', level: 3 }]);
  await masterPatch(vitals.characterId, { inventory: [] });
  const barbarianAc = await sheetOf(vitals.token);
  check(
    'sem armadura o Bárbaro usa 10 + DES + CON (10 + 4 + 2 = 16)',
    barbarianAc?.derived?.armorClass?.automatic === 16 &&
      Boolean(barbarianAc?.derived?.armorClass?.unarmoredLabel),
    JSON.stringify(barbarianAc?.derived?.armorClass),
  );

  await setCharacterClasses(vitals.userId, [{ classKey: 'monk', level: 3 }]);
  const monkAc = await sheetOf(vitals.token);
  check(
    'o Monge usa 10 + DES + SAB (10 + 4 + 3 = 17)',
    monkAc?.derived?.armorClass?.automatic === 17 &&
      Boolean(monkAc?.derived?.armorClass?.unarmoredLabel),
    JSON.stringify(monkAc?.derived?.armorClass),
  );

  const monkWithShield = await masterPatch(vitals.characterId, {
    inventory: [equipped('Escudo', 'Escudo', { armorClassBonus: 2 }, 'hand2')],
  });
  check(
    'com escudo a Defesa sem Armadura do Monge cai (10 + DES + 2 = 16)',
    armorClassOf(monkWithShield)?.automatic === 16 &&
      armorClassOf(monkWithShield)?.unarmoredLabel === null,
    JSON.stringify(armorClassOf(monkWithShield)),
  );

  const overrideSet = await masterPatch(vitals.characterId, { armorClassOverride: 30 });
  check(
    'a CA manual do mestre vence a automática (30, com a automática em 16)',
    overrideSet.data?.character?.armorClass === 30 &&
      armorClassOf(overrideSet)?.override === 30 &&
      armorClassOf(overrideSet)?.automatic === 16,
    JSON.stringify({ ca: overrideSet.data?.character?.armorClass, detalhe: armorClassOf(overrideSet) }),
  );
  const overrideCleared = await masterPatch(vitals.characterId, { armorClassOverride: 0 });
  check(
    'CA manual 0 volta ao cálculo automático',
    armorClassOf(overrideCleared)?.override === null &&
      overrideCleared.data?.character?.armorClass === 16,
    JSON.stringify(armorClassOf(overrideCleared)),
  );

  // Fase 1.2 — proficiência de armadura. A CA NÃO muda sem proficiência (PHB
  // 2014: vestir armadura sem proficiência mantém a CA); o que muda é o ESTADO
  // (`armorProficiency` / `armorNonProficiency`), que a Fase 8 vai consumir nas
  // penalidades de testes, salvaguardas, ataques e conjuração.
  const setArmorProfs = (armor: string[]) =>
    masterPatch(vitals.characterId, { proficiencies: { armor, weapons: [], tools: [] } });

  // Caso 1 — proficiência correta (leve com "Armaduras leves").
  await setArmorProfs(['Armaduras leves']);
  const profLight = await masterPatch(vitals.characterId, {
    inventory: [equipped('Couro batido', 'Armadura', { armorType: 'Leve', baseArmorClass: 12 })],
  });
  check(
    'armadura leve COM proficiência: armorProficiency.armor = true',
    armorClassOf(profLight)?.armorProficiency?.armor === true &&
      armorClassOf(profLight)?.armorNonProficiency?.armor === false,
    JSON.stringify(armorClassOf(profLight)),
  );
  check(
    'o popup da armadura leve mostra PROFICIENTE (dados do servidor)',
    profLight.data?.character?.inventory?.find((item: any) => item.category === 'Armadura')
      ?.proficiency?.proficient === true,
    JSON.stringify(profLight.data?.character?.inventory?.[0]?.proficiency),
  );

  // Caso 2 — média SEM proficiência: a CA continua a da regra (13 + DES 2 = 15).
  await setArmorProfs(['Armaduras leves']);
  const noProfMedium = await masterPatch(vitals.characterId, {
    inventory: [
      equipped('Camisão de malha', 'Armadura', { armorType: 'Média', baseArmorClass: 13 }),
    ],
  });
  check(
    'armadura média SEM proficiência: CA 15 mantida e armorNonProficiency.armor = true',
    armorClassOf(noProfMedium)?.automatic === 15 &&
      armorClassOf(noProfMedium)?.armorProficiency?.armor === false &&
      armorClassOf(noProfMedium)?.armorNonProficiency?.armor === true,
    JSON.stringify(armorClassOf(noProfMedium)),
  );
  check(
    'o popup da armadura média mostra SEM proficiência',
    noProfMedium.data?.character?.inventory?.find((item: any) => item.category === 'Armadura')
      ?.proficiency?.proficient === false,
    JSON.stringify(noProfMedium.data?.character?.inventory?.[0]?.proficiency),
  );

  // Caso 3 — pesada sem proficiência.
  await setArmorProfs(['Armaduras leves']);
  const noProfHeavy = await masterPatch(vitals.characterId, {
    inventory: [
      equipped('Cota de malha', 'Armadura', { armorType: 'Pesada', baseArmorClass: 16 }),
    ],
  });
  check(
    'armadura pesada SEM proficiência: CA 16 mantida e armorNonProficiency.armor = true',
    armorClassOf(noProfHeavy)?.automatic === 16 &&
      armorClassOf(noProfHeavy)?.armorProficiency?.armor === false &&
      armorClassOf(noProfHeavy)?.armorNonProficiency?.armor === true,
    JSON.stringify(armorClassOf(noProfHeavy)),
  );

  // Caso 4 — escudo sem proficiência (lista sem "Escudos").
  await setArmorProfs(['Armaduras pesadas']);
  const noProfShield = await masterPatch(vitals.characterId, {
    inventory: [
      equipped('Cota de malha', 'Armadura', { armorType: 'Pesada', baseArmorClass: 16 }),
      equipped('Escudo', 'Escudo', { armorClassBonus: 2 }, 'hand2'),
    ],
  });
  check(
    'escudo SEM proficiência: CA 18 mantida e armorNonProficiency.shield = true',
    armorClassOf(noProfShield)?.automatic === 18 &&
      armorClassOf(noProfShield)?.armorProficiency?.shield === false &&
      armorClassOf(noProfShield)?.armorNonProficiency?.shield === true &&
      armorClassOf(noProfShield)?.shield?.name === 'Escudo',
    JSON.stringify(armorClassOf(noProfShield)),
  );
  check(
    'o popup do escudo mostra SEM proficiência (lista sem "Escudos")',
    noProfShield.data?.character?.inventory?.find((item: any) => item.category === 'Escudo')
      ?.proficiency?.proficient === false,
    JSON.stringify(noProfShield.data?.character?.inventory?.[1]?.proficiency),
  );

  // Caso 5 — as quatro proficiências: armadura e escudo proficientes.
  await setArmorProfs([
    'Armaduras leves',
    'Armaduras médias',
    'Armaduras pesadas',
    'Escudos',
  ]);
  const allProf = await masterPatch(vitals.characterId, {
    inventory: [
      equipped('Cota de malha', 'Armadura', { armorType: 'Pesada', baseArmorClass: 16 }),
      equipped('Escudo', 'Escudo', { armorClassBonus: 2 }, 'hand2'),
    ],
  });
  check(
    'com as quatro proficiências, armadura e escudo são proficientes',
    armorClassOf(allProf)?.armorProficiency?.armor === true &&
      armorClassOf(allProf)?.armorProficiency?.shield === true &&
      armorClassOf(allProf)?.armorNonProficiency?.armor === false &&
      armorClassOf(allProf)?.armorNonProficiency?.shield === false,
    JSON.stringify(armorClassOf(allProf)),
  );
  check(
    'os popups de armadura e escudo mostram PROFICIENTE com as quatro proficiências',
    allProf.data?.character?.inventory?.find((item: any) => item.category === 'Armadura')
      ?.proficiency?.proficient === true &&
      allProf.data?.character?.inventory?.find((item: any) => item.category === 'Escudo')
        ?.proficiency?.proficient === true,
    JSON.stringify(allProf.data?.character?.inventory?.map((item: any) => item.proficiency)),
  );

  // Caso 9 — Defesa sem Armadura (Bárbaro) NÃO vira "sem proficiência".
  await setArmorProfs([]);
  await prisma.character.update({
    where: { userId: vitals.userId },
    data: { constitution: 14 },
  });
  await setCharacterClasses(vitals.userId, [{ classKey: 'barbarian', level: 3 }]);
  const unarmoredProf = await masterPatch(vitals.characterId, { inventory: [] });
  check(
    'Defesa sem Armadura sem equipamento não gera não proficiência',
    armorClassOf(unarmoredProf)?.armorProficiency?.armor === true &&
      armorClassOf(unarmoredProf)?.armorProficiency?.shield === true &&
      armorClassOf(unarmoredProf)?.armorNonProficiency?.armor === false &&
      armorClassOf(unarmoredProf)?.armorNonProficiency?.shield === false,
    JSON.stringify(armorClassOf(unarmoredProf)),
  );

  // Caso 8 — a CA (e o estado de proficiência) do combate é EXATAMENTE a da
  // ficha: o combatente lê `characterArmorClass`, sem uma segunda conta.
  await setArmorProfs(['Armaduras leves']);
  const sheetForCombat = await masterPatch(vitals.characterId, {
    inventory: [equipped('Couro batido', 'Armadura', { armorType: 'Leve', baseArmorClass: 12 })],
  });
  await api('/api/combat/end', { method: 'POST', token: masterToken });
  const combatForAc = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { entries: [] },
  });
  createdCombatIds.push(combatForAc.data.combat.id);
  for (const combatant of combatForAc.data.combat.combatants) {
    await api(`/api/combat/initiative/${combatant.id}`, { method: 'POST', token: masterToken });
  }
  const activeForAc = (await api('/api/combat/active', { token: masterToken })).data.combat;
  const vitalsCombatant = (activeForAc?.combatants ?? []).find(
    (item: any) => item.characterId === vitals.characterId,
  );
  check(
    'a CA do combate é a mesma da ficha (e traz o estado de proficiência)',
    vitalsCombatant?.armorClass === armorClassOf(sheetForCombat)?.value &&
      vitalsCombatant?.armorNonProficiency?.armor === false &&
      vitalsCombatant?.armorNonProficiency?.shield === false,
    JSON.stringify({
      ficha: armorClassOf(sheetForCombat)?.value,
      combate: vitalsCombatant?.armorClass,
      nonProf: vitalsCombatant?.armorNonProficiency,
    }),
  );
  await api('/api/combat/end', { method: 'POST', token: masterToken });

  // --- 15. Multiclasse ------------------------------------------------------
  console.log('\n15) Multiclasse: pré-requisitos, proficiências e perícia');

  // A entrada por multiclasse só acontece pelo Level Up (a ficha não troca nem
  // acrescenta classe por PATCH): os cenários abaixo passam pelo fluxo real.
  const multi = await freshSheet('fase0mc');
  await prisma.character.update({
    where: { userId: multi.userId },
    data: {
      strength: 8,
      dexterity: 13,
      constitution: 12,
      intelligence: 14,
      wisdom: 13,
      charisma: 8,
      skills: {},
      saves: {},
    },
  });
  await setCharacterClasses(multi.userId, [{ classKey: 'wizard', level: 1 }]);
  await unlockForLevelUp();

  // Falta atributo na classe NOVA: Paladino exige Força 13 e Carisma 13, e o
  // Mago (classe atual) tem a Inteligência 14 que ele pede.
  const blockedNewClass = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: multi.token,
    body: { classKey: 'paladin', hp: 'average' },
  });
  check(
    'entrada bloqueada quando falta atributo na classe NOVA (400)',
    blockedNewClass.status === 400,
    JSON.stringify(blockedNewClass.data),
  );
  check(
    'a mensagem cita a classe nova e os atributos que ela exige',
    typeof blockedNewClass.data?.message === 'string' &&
      blockedNewClass.data.message.includes('Para entrar em Paladino') &&
      blockedNewClass.data.message.includes('Força 13') &&
      blockedNewClass.data.message.includes('Carisma 13'),
    JSON.stringify(blockedNewClass.data),
  );

  // Falta atributo na classe ATUAL: o Paladino (Força/Carisma 13) está abaixo e
  // é ele quem barra — o Ladino que se quer entrar tem a Destreza 13 atendida.
  await prisma.character.update({
    where: { userId: multi.userId },
    data: { strength: 8, charisma: 8, dexterity: 13 },
  });
  await setCharacterClasses(multi.userId, [{ classKey: 'paladin', level: 1 }]);
  await unlockForLevelUp();
  const blockedCurrentClass = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: multi.token,
    body: { classKey: 'rogue', hp: 'average', skillChoice: 'stealth' },
  });
  check(
    'entrada bloqueada quando a classe ATUAL está sem o pré-requisito (400)',
    blockedCurrentClass.status === 400,
    JSON.stringify(blockedCurrentClass.data),
  );
  check(
    'a mensagem acusa a classe ATUAL, e não a nova (Ladino: Destreza 13 está atendida)',
    typeof blockedCurrentClass.data?.message === 'string' &&
      blockedCurrentClass.data.message.includes('para continuar como Paladino') &&
      !blockedCurrentClass.data.message.includes('Para entrar em Ladino'),
    JSON.stringify(blockedCurrentClass.data),
  );

  // Liberada quando os DOIS lados batem (Paladino: Força e Carisma 13; Ladino:
  // Destreza 13). As salvaguardas gravadas são zeradas junto: é assim que dá
  // para conferir que a segunda classe não concede nenhuma.
  await prisma.character.update({
    where: { userId: multi.userId },
    data: {
      strength: 13,
      charisma: 13,
      skills: {},
      saves: {},
      proficiencies: { armor: [], weapons: [], tools: [] },
    },
  });
  // O Ladino concede a Expertise já no 1º nível: a escolha sai do que o
  // personagem domina (duas perícias proficientes garantidas aqui).
  const multiExpertise = await ensureExpertisePool({ userId: multi.userId });
  await unlockForLevelUp();
  const allowedEntry = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: multi.token,
    body: {
      classKey: 'rogue',
      hp: 'average',
      skillChoice: 'stealth',
      choices: { expertise: multiExpertise },
    },
  });
  check(
    'liberada quando os DOIS lados batem (200)',
    allowedEntry.status === 200 &&
      allowedEntry.data?.character?.classes?.length === 2 &&
      allowedEntry.data?.character?.classes?.[1]?.classKey === 'rogue',
    JSON.stringify(allowedEntry.data?.message ?? allowedEntry.data),
  );
  check(
    'a classe por multiclasse concede o conjunto PARCIAL de proficiências',
    (allowedEntry.data?.character?.proficiencies?.armor ?? []).includes('Armaduras leves') &&
      (allowedEntry.data?.character?.proficiencies?.tools ?? []).includes('Ferramentas de ladrão') &&
      !(allowedEntry.data?.character?.proficiencies?.weapons ?? []).includes('Espadas longas'),
    JSON.stringify(allowedEntry.data?.character?.proficiencies),
  );
  check(
    'multiclasse NÃO concede salvaguardas (só as do Paladino: Sabedoria e Carisma)',
    allowedEntry.data?.character?.saves?.wisdom === true &&
      allowedEntry.data?.character?.saves?.charisma === true &&
      allowedEntry.data?.character?.saves?.dexterity === false &&
      allowedEntry.data?.character?.saves?.intelligence === false,
    JSON.stringify(allowedEntry.data?.character?.saves),
  );

  const firstClass = await freshSheet('fase0mc2');
  await prisma.character.update({ where: { userId: firstClass.userId }, data: { strength: 13 } });
  const firstClassEntry = await masterPatch(firstClass.characterId, {
    classes: [{ classKey: 'fighter' }],
  });
  check(
    'a PRIMEIRA classe concede a lista COMPLETA (Guerreiro: armaduras pesadas)',
    (firstClassEntry.data?.character?.proficiencies?.armor ?? []).includes('Armaduras pesadas') &&
      (firstClassEntry.data?.character?.proficiencies?.weapons ?? []).includes('Armas marciais'),
    JSON.stringify(firstClassEntry.data?.character?.proficiencies),
  );

  // Perícia de multiclasse pelo fluxo de Level Up: Patrulheiro (da lista da
  // classe) e Bardo (qualquer perícia).
  const skillEntry = await freshSheet('fase0mc3');
  await prisma.character.update({
    where: { userId: skillEntry.userId },
    data: {
      strength: 13,
      dexterity: 14,
      wisdom: 13,
      charisma: 13,
      skills: {},
      saves: {},
      lastLevelUpRelease: 0,
    },
  });
  await setCharacterClasses(skillEntry.userId, [{ classKey: 'fighter', level: 1 }]);

  const rangerEntryChoices = {
    'favored-enemy': ['undead'],
    'natural-explorer': ['forest'],
  };
  await unlockForLevelUp();
  check(
    'multiclasse de Patrulheiro exige a perícia da classe (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: skillEntry.token,
        body: { classKey: 'ranger', hp: 'average', choices: rangerEntryChoices },
      })
    ).status === 400,
  );
  check(
    'perícia fora da lista do Patrulheiro é recusada (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: skillEntry.token,
        body: {
          classKey: 'ranger',
          hp: 'average',
          skillChoice: 'arcana',
          choices: rangerEntryChoices,
        },
      })
    ).status === 400,
  );
  const rangerEntry = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: skillEntry.token,
    body: {
      classKey: 'ranger',
      hp: 'average',
      skillChoice: 'nature',
      choices: rangerEntryChoices,
    },
  });
  check(
    'a perícia dentro da lista entra na ficha junto da classe nova (200)',
    rangerEntry.status === 200 && rangerEntry.data?.character?.skills?.nature?.proficient === true,
    JSON.stringify(rangerEntry.data?.message ?? rangerEntry.data),
  );

  await unlockForLevelUp();
  check(
    'multiclasse de Bardo exige a perícia mesmo sendo de qualquer lista (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: skillEntry.token,
        body: { classKey: 'bard', hp: 'average' },
      })
    ).status === 400,
  );
  const bardEntry = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: skillEntry.token,
    body: { classKey: 'bard', hp: 'average', skillChoice: 'arcana' },
  });
  check(
    'o Bardo aceita qualquer perícia na entrada (200)',
    bardEntry.status === 200 && bardEntry.data?.character?.skills?.arcana?.proficient === true,
    JSON.stringify(bardEntry.data?.message ?? bardEntry.data),
  );

  await prisma.character.update({
    where: { userId: skillEntry.userId },
    data: { creationFinalized: true },
  });
  check(
    'jogador com a criação finalizada leva 403 ao editar proficiencies',
    (
      await api('/api/characters/me', {
        method: 'PATCH',
        token: skillEntry.token,
        body: { proficiencies: { armor: ['Armaduras de teste'], weapons: [], tools: [] } },
      })
    ).status === 403,
  );

  // --- 16. Magias preparadas por classe -------------------------------------
  console.log('\n16) Magias preparadas (por classe, com o próprio atributo)');

  const spellbook = await freshSheet('fase0prep');
  await prisma.character.update({
    where: { userId: spellbook.userId },
    data: { wisdom: 16, intelligence: 18, charisma: 16, skills: {} },
  });
  /** Monta um cenário de classes e devolve a ficha (preparadas por classe). */
  const scenarioOf = async (entries: { classKey: string; level: number; subclass?: string }[]) => {
    await setCharacterClasses(spellbook.userId, entries);
    return sheetOf(spellbook.token);
  };
  const preparedOf = (sheet: any, index = 0) => sheet?.classes?.[index]?.spellcasting;

  const clericFive = await scenarioOf([{ classKey: 'cleric', level: 5 }]);
  check(
    'Clérigo prepara mod. de Sabedoria + nível da classe (3 + 5 = 8)',
    preparedOf(clericFive)?.preparedCount === 8 &&
      preparedOf(clericFive)?.learning === 'prepared' &&
      preparedOf(clericFive)?.ability === 'wisdom',
    JSON.stringify(preparedOf(clericFive)),
  );

  const druidThree = await scenarioOf([{ classKey: 'druid', level: 3 }]);
  check(
    'Druida prepara mod. de Sabedoria + nível (3 + 3 = 6)',
    preparedOf(druidThree)?.preparedCount === 6,
    JSON.stringify(preparedOf(druidThree)),
  );

  const wizardSeven = await scenarioOf([{ classKey: 'wizard', level: 7 }]);
  check(
    'Mago prepara mod. de Inteligência + nível (4 + 7 = 11)',
    preparedOf(wizardSeven)?.preparedCount === 11 && preparedOf(wizardSeven)?.ability === 'intelligence',
    JSON.stringify(preparedOf(wizardSeven)),
  );

  const paladinOneLevel = await scenarioOf([{ classKey: 'paladin', level: 1 }]);
  check(
    'Paladino de 1º nível ainda não conjura: zero preparadas',
    preparedOf(paladinOneLevel)?.preparedCount === 0,
    JSON.stringify(preparedOf(paladinOneLevel)),
  );

  const paladinTwo = await scenarioOf([{ classKey: 'paladin', level: 2 }]);
  check(
    'Paladino prepara mod. de Carisma + METADE do nível, para baixo (3 + 1 = 4)',
    preparedOf(paladinTwo)?.preparedCount === 4,
    JSON.stringify(preparedOf(paladinTwo)),
  );

  const paladinNine = await scenarioOf([{ classKey: 'paladin', level: 9 }]);
  check(
    '...e escala por metade do nível (3 + 4 = 7 no 9º)',
    preparedOf(paladinNine)?.preparedCount === 7,
    JSON.stringify(preparedOf(paladinNine)),
  );

  const knownCasters = await scenarioOf([
    { classKey: 'bard', level: 5 },
    { classKey: 'ranger', level: 5 },
    { classKey: 'sorcerer', level: 5 },
    { classKey: 'warlock', level: 5 },
  ]);
  check(
    'as classes de magias CONHECIDAS não usam a fórmula (nulo)',
    (knownCasters?.classes ?? []).length === 4 &&
      knownCasters.classes.every((entry: any) => entry.spellcasting?.preparedCount === null),
    JSON.stringify(
      (knownCasters?.classes ?? []).map((entry: any) => [entry.classKey, entry.spellcasting?.preparedCount]),
    ),
  );

  const knightPrep = await scenarioOf([
    { classKey: 'fighter', level: 7, subclass: 'Cavaleiro Arcano' },
  ]);
  check(
    'o terço-conjurador (Cavaleiro Arcano) também é de magias conhecidas (nulo)',
    preparedOf(knightPrep)?.type === 'third' && preparedOf(knightPrep)?.preparedCount === null,
    JSON.stringify(preparedOf(knightPrep)),
  );

  const mixedCasters = await scenarioOf([
    { classKey: 'cleric', level: 5 },
    { classKey: 'paladin', level: 4 },
  ]);
  check(
    'no multiclasse o valor é SEPARADO por classe (Clérigo 8, Paladino 5)',
    preparedOf(mixedCasters, 0)?.preparedCount === 8 &&
      preparedOf(mixedCasters, 1)?.preparedCount === 5 &&
      preparedOf(mixedCasters, 0)?.ability === 'wisdom' &&
      preparedOf(mixedCasters, 1)?.ability === 'charisma',
    JSON.stringify((mixedCasters?.classes ?? []).map((entry: any) => entry.spellcasting)),
  );

  // --- 17. Espaços de magia -------------------------------------------------
  console.log('\n17) Espaços de magia (tabela da classe x tabela combinada)');

  const slotLabel = (sheet: any) =>
    JSON.stringify((sheet?.derived?.spellSlots ?? []).map((slot: any) => [slot.level, slot.max]));

  const paladinThreeSlots = await scenarioOf([{ classKey: 'paladin', level: 3 }]);
  check(
    'Paladino 3 usa a tabela dele: 3 espaços de 1º (metade para CIMA)',
    slotLabel(paladinThreeSlots) === JSON.stringify([[1, 3]]),
    slotLabel(paladinThreeSlots),
  );

  const rangerFiveSlots = await scenarioOf([{ classKey: 'ranger', level: 5 }]);
  check(
    'Patrulheiro 5: 4 espaços de 1º e 2 de 2º',
    slotLabel(rangerFiveSlots) === JSON.stringify([[1, 4], [2, 2]]),
    slotLabel(rangerFiveSlots),
  );

  const knightFourSlots = await scenarioOf([
    { classKey: 'fighter', level: 4, subclass: 'Cavaleiro Arcano' },
  ]);
  check(
    'Cavaleiro Arcano 4: 3 espaços de 1º (um terço para CIMA)',
    slotLabel(knightFourSlots) === JSON.stringify([[1, 3]]),
    slotLabel(knightFourSlots),
  );

  const twoCasterSlots = await scenarioOf([
    { classKey: 'wizard', level: 3 },
    { classKey: 'cleric', level: 3 },
  ]);
  check(
    'duas conjuradoras usam a tabela COMBINADA (nível de conjurador 6 → 4/3/3)',
    slotLabel(twoCasterSlots) === JSON.stringify([[1, 4], [2, 3], [3, 3]]),
    slotLabel(twoCasterSlots),
  );

  const fighterPaladinSlots = await scenarioOf([
    { classKey: 'fighter', level: 5 },
    { classKey: 'paladin', level: 4 },
  ]);
  check(
    'Guerreiro sem subclasse conjuradora não conta: vale a tabela do Paladino (3 de 1º)',
    slotLabel(fighterPaladinSlots) === JSON.stringify([[1, 3]]),
    slotLabel(fighterPaladinSlots),
  );

  const warlockFiveSlots = await scenarioOf([{ classKey: 'warlock', level: 5 }]);
  check(
    'o Bruxo fica FORA da tabela: nenhum espaço comum e a Magia de Pacto à parte (2 × 3º)',
    (warlockFiveSlots?.derived?.spellSlots ?? []).length === 0 &&
      warlockFiveSlots?.derived?.pactSlots?.max === 2 &&
      warlockFiveSlots?.derived?.pactSlots?.slotLevel === 3,
    JSON.stringify({
      slots: warlockFiveSlots?.derived?.spellSlots,
      pact: warlockFiveSlots?.derived?.pactSlots,
    }),
  );

  const warlockWizardSlots = await scenarioOf([
    { classKey: 'warlock', level: 5 },
    { classKey: 'wizard', level: 3 },
  ]);
  check(
    'Bruxo + Mago: os espaços saem do Mago e a Magia de Pacto vem separada',
    slotLabel(warlockWizardSlots) === JSON.stringify([[1, 4], [2, 2]]) &&
      warlockWizardSlots?.derived?.pactSlots?.max === 2 &&
      warlockWizardSlots?.derived?.pactSlots?.slotLevel === 3,
    JSON.stringify({
      slots: warlockWizardSlots?.derived?.spellSlots,
      pact: warlockWizardSlots?.derived?.pactSlots,
    }),
  );

  // --- 18. Features e escolhas de característica ----------------------------
  console.log('\n18) Features e escolhas de característica');

  const chosen = await freshSheet('fase0feat');
  await prisma.character.update({
    where: { userId: chosen.userId },
    data: {
      strength: 15,
      dexterity: 14,
      constitution: 14,
      wisdom: 14,
      charisma: 16,
      skills: {},
      lastLevelUpRelease: 0,
    },
  });

  // Estilo de Luta Defesa: "+1 na CA enquanto você estiver usando armadura".
  await setCharacterClasses(chosen.userId, [{ classKey: 'fighter', level: 1 }]);
  await setState(chosen.userId, {
    active: [],
    used: {},
    choices: { 'fighter-fighting-style': ['defense'] },
  });
  const defenseBare = await masterPatch(chosen.characterId, { inventory: [] });
  check(
    'Estilo de Luta Defesa NÃO soma sem armadura (10 + DES 2 = 12)',
    armorClassOf(defenseBare)?.automatic === 12 && armorClassOf(defenseBare)?.classBonus === 0,
    JSON.stringify(armorClassOf(defenseBare)),
  );

  const defenseArmored = await masterPatch(chosen.characterId, {
    inventory: [equipped('Couro', 'Armadura', { armorType: 'Leve', baseArmorClass: 12 })],
  });
  check(
    'com armadura a Defesa soma +1 e a ficha explica de onde veio (12 + 2 + 1 = 15)',
    armorClassOf(defenseArmored)?.automatic === 15 &&
      armorClassOf(defenseArmored)?.classBonus === 1 &&
      (armorClassOf(defenseArmored)?.classBonusLabels ?? []).includes('Estilo de Luta (Defesa)') &&
      defenseArmored.data?.character?.classAdjustments?.armorClassBonus === 1,
    JSON.stringify(armorClassOf(defenseArmored)),
  );

  // Pau para Toda Obra do Bardo: metade da proficiência (para baixo) onde não há.
  await setCharacterClasses(chosen.userId, [{ classKey: 'bard', level: 2 }]);
  await setState(chosen.userId);
  const jack = await masterPatch(chosen.characterId, { inventory: [], skills: {} });
  check(
    'Pau para Toda Obra soma metade da proficiência em perícia sem proficiência',
    jack.data?.character?.derived?.halfProficiencyBonus === 1 &&
      jack.data?.character?.derived?.skills?.athletics?.total ===
        jack.data?.character?.derived?.modifiers?.strength + 1,
    JSON.stringify({
      metade: jack.data?.character?.derived?.halfProficiencyBonus,
      athletics: jack.data?.character?.derived?.skills?.athletics,
    }),
  );
  check(
    '...e também vale para a INICIATIVA',
    jack.data?.character?.derived?.initiative ===
      jack.data?.character?.derived?.modifiers?.dexterity + 1,
    JSON.stringify(jack.data?.character?.derived?.initiative),
  );
  const jackProficient = await masterPatch(chosen.characterId, {
    skills: { athletics: { proficient: true } },
  });
  check(
    '...mas não soma onde o personagem JÁ tem proficiência (vale só o bônus cheio)',
    jackProficient.data?.character?.derived?.skills?.athletics?.total ===
      jackProficient.data?.character?.derived?.modifiers?.strength + 2,
    JSON.stringify(jackProficient.data?.character?.derived?.skills?.athletics),
  );

  // Aura de Proteção do Paladino: mod. de CAR (mínimo +1) em TODAS as salvaguardas.
  await setCharacterClasses(chosen.userId, [{ classKey: 'paladin', level: 6 }]);
  await setState(chosen.userId);
  const aura = await sheetOf(chosen.token);
  check(
    'Aura de Proteção soma o mod. de CAR (3) em todas as salvaguardas',
    aura?.derived?.saveBonus === 3 &&
      aura?.derived?.saves?.every(
        (save: any) =>
          save.total ===
          save.modifier + (save.proficient ? aura.derived.proficiencyBonus : 0) + 3,
      ) &&
      aura?.classAdjustments?.saveBonusLabel === 'Aura de Proteção',
    JSON.stringify({ bonus: aura?.derived?.saveBonus, saves: aura?.derived?.saves }),
  );

  // Escolhas inválidas: opção inexistente, quantidade errada, nível errado e a
  // escolha obrigatória faltando (todas 400, sem aplicar o nível).
  const picky = await freshSheet('fase0ch');
  await prisma.character.update({
    where: { userId: picky.userId },
    data: {
      strength: 15,
      dexterity: 14,
      intelligence: 14,
      wisdom: 13,
      charisma: 13,
      skills: {},
      lastLevelUpRelease: 0,
    },
  });
  await setCharacterClasses(picky.userId, [{ classKey: 'wizard', level: 1 }]);

  const fighterEntryBody = (extra: Record<string, unknown> = {}) => ({
    classKey: 'fighter',
    hp: 'average',
    ...extra,
  });
  await unlockForLevelUp();
  check(
    'opção inexistente na escolha é recusada (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: picky.token,
        body: fighterEntryBody({ choices: { 'fighter-fighting-style': ['inventado'] } }),
      })
    ).status === 400,
  );
  check(
    'quantidade de opções diferente da declarada é recusada (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: picky.token,
        body: fighterEntryBody({ choices: { 'fighter-fighting-style': ['defense', 'archery'] } }),
      })
    ).status === 400,
  );
  check(
    'entrar numa classe nova SEM a escolha obrigatória é recusado (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: picky.token,
        body: fighterEntryBody(),
      })
    ).status === 400,
  );
  const fighterEntryOk = await api('/api/characters/me/level-up', {
    method: 'POST',
    token: picky.token,
    body: fighterEntryBody({ choices: { 'fighter-fighting-style': ['defense'] } }),
  });
  check(
    'com a escolha certa a entrada é aplicada (200)',
    fighterEntryOk.status === 200 &&
      fighterEntryOk.data?.character?.classState?.choices?.['fighter-fighting-style']?.[0] ===
        'defense',
    JSON.stringify(fighterEntryOk.data?.message ?? fighterEntryOk.data),
  );

  await unlockForLevelUp();
  check(
    'escolha declarada para o nível ERRADO na mesma classe é recusada (400)',
    (
      await api('/api/characters/me/level-up', {
        method: 'POST',
        token: picky.token,
        body: {
          classKey: 'ranger',
          hp: 'average',
          skillChoice: 'nature',
          choices: {
            'favored-enemy': ['undead'],
            'natural-explorer': ['forest'],
            // O Estilo de Luta do Patrulheiro só é escolhido no 2º nível.
            'ranger-fighting-style': ['defense'],
          },
        },
      })
    ).status === 400,
  );

  // Subclasse no 3º nível das quatro classes que escolhem nele: sem ela o nível
  // não fecha; com ela o nome entra na ficha.
  const subclassPick = await freshSheet('fase0sub');
  await prisma.character.update({
    where: { userId: subclassPick.userId },
    data: {
      strength: 15,
      dexterity: 14,
      constitution: 14,
      intelligence: 14,
      wisdom: 14,
      charisma: 16,
      // Duas perícias proficientes: o Bardo escolhe a Expertise no 3º nível.
      skills: {
        arcana: { proficient: true, expertise: false },
        history: { proficient: true, expertise: false },
      },
      lastLevelUpRelease: 0,
    },
  });
  for (const classKey of ['bard', 'fighter', 'paladin', 'ranger']) {
    await setCharacterClasses(subclassPick.userId, [{ classKey, level: 2 }]);
    await setState(subclassPick.userId);
    await unlockForLevelUp();
    const withoutSubclass = await api('/api/characters/me/level-up', {
      method: 'POST',
      token: subclassPick.token,
      body: { classKey, hp: 'average' },
    });
    check(
      `${classKey}: subir para o 3º nível sem a subclasse é recusado (400)`,
      withoutSubclass.status === 400,
      JSON.stringify(withoutSubclass.data),
    );

    const before = await sheetOf(subclassPick.token);
    const body = levelUpRequestFor(before, classKey, 0);
    const withSubclass = await api('/api/characters/me/level-up', {
      method: 'POST',
      token: subclassPick.token,
      body,
    });
    check(
      `${classKey}: com a subclasse escolhida o 3º nível entra (200)`,
      withSubclass.status === 200 &&
        withSubclass.data?.character?.classes?.[0]?.subclass === body.subclass &&
        withSubclass.data?.character?.classes?.[0]?.level === 3,
      JSON.stringify({ body, response: withSubclass.data?.message ?? withSubclass.data }),
    );
  }

  // --- 19. Subclasses novas: 1 → 20, features e crítico ---------------------
  console.log('\n19) Subclasses novas: Level Up 1 → 20, features e recursos');

  const walker = await freshSheet('fase0walk');
  await prisma.character.update({
    where: { userId: walker.userId },
    data: {
      strength: 15,
      dexterity: 14,
      constitution: 14,
      intelligence: 14,
      wisdom: 14,
      charisma: 15,
      skills: {},
    },
  });

  /** Percorre o Level Up do 1º ao 20º nível de UMA subclasse, sem atalhos. */
  async function walkSubclass(classKey: string, pick: number, label: string): Promise<void> {
    await prisma.character.update({
      where: { userId: walker.userId },
      data: {
        classes: [{ classKey, subclass: '', level: 1 }] as any,
        classState: { active: [], used: {}, choices: {} } as any,
        lastLevelUpRelease: 0,
      },
    });
    // O Bardo tem a Especialização no 3º e no 10º: duas perícias proficientes
    // garantem que a escolha tenha de onde sair em toda a caminhada.
    await ensureExpertisePool({ userId: walker.userId });

    let sheet = await sheetOf(walker.token);
    let failure = '';
    for (let guard = 0; guard < 25 && (sheet?.classes?.[0]?.level ?? 0) < 20; guard += 1) {
      const from = sheet?.classes?.[0]?.level ?? 0;
      await unlockForLevelUp();
      const result = await api('/api/characters/me/level-up', {
        method: 'POST',
        token: walker.token,
        body: levelUpRequestFor(sheet, classKey, pick),
      });
      if (result.status !== 200) {
        failure = `nível ${from} → ${from + 1}: ${result.status} ${JSON.stringify(
          result.data?.message ?? result.data,
        )}`;
        break;
      }
      sheet = result.data?.character;
    }

    const entry = sheet?.classes?.[0];
    const expected = (sheet?.classOptions ?? []).find((item: any) => item.key === classKey)
      ?.subclassNames?.[pick];
    check(
      `${label}: Level Up do 1º ao 20º sem travar`,
      failure === '' && entry?.level === 20,
      failure || JSON.stringify({ nivel: entry?.level }),
    );
    check(
      `${label}: a subclasse gravada é a do catálogo`,
      expected !== undefined && entry?.subclass === expected,
      JSON.stringify({ esperado: expected, gravado: entry?.subclass }),
    );
  }

  const subclassRuns: { classKey: string; pick: number; label: string }[] = [
    { classKey: 'bard', pick: 0, label: 'Bardo · Colégio do Conhecimento' },
    { classKey: 'bard', pick: 1, label: 'Bardo · Colégio da Bravura' },
    { classKey: 'fighter', pick: 0, label: 'Guerreiro · Campeão' },
    { classKey: 'fighter', pick: 1, label: 'Guerreiro · Mestre da Batalha' },
    { classKey: 'fighter', pick: 2, label: 'Guerreiro · Cavaleiro Arcano' },
    { classKey: 'paladin', pick: 0, label: 'Paladino · Juramento de Devoção' },
    { classKey: 'paladin', pick: 1, label: 'Paladino · Juramento dos Anciões' },
    { classKey: 'paladin', pick: 2, label: 'Paladino · Juramento de Vingança' },
    { classKey: 'ranger', pick: 0, label: 'Patrulheiro · Caçador' },
    { classKey: 'ranger', pick: 1, label: 'Patrulheiro · Senhor das Feras' },
  ];
  for (const run of subclassRuns) {
    await walkSubclass(run.classKey, run.pick, run.label);
  }

  /** Features da subclasse ativas num cenário pronto (classe + subclasse + nível). */
  async function subclassScenario(
    classKey: string,
    subclass: string,
    level: number,
    classState: unknown = { active: [], used: {}, choices: {} },
  ): Promise<any> {
    await prisma.character.update({
      where: { userId: walker.userId },
      data: {
        classes: [{ classKey, subclass, level }] as any,
        classState: classState as any,
      },
    });
    const sheet = await sheetOf(walker.token);
    return {
      sheet,
      ids: (sheet?.activeFeatures ?? [])
        .filter((feature: any) => feature.source === 'subclass')
        .map((feature: any) => feature.id),
    };
  }

  const resourceMax = (scenario: any, id: string): number | undefined =>
    (scenario?.sheet?.classAdjustments?.resources ?? []).find((item: any) => item.id === id)?.max;

  const championThree = await subclassScenario('fighter', 'Campeão', 3);
  check(
    'Campeão (3): Crítico Aprimorado e limiar de crítico em 19',
    championThree.ids.includes('improved-critical') &&
      championThree.sheet?.derived?.critThreshold === 19,
    JSON.stringify(championThree.ids),
  );
  const championSeven = await subclassScenario('fighter', 'Campeão', 7);
  check(
    'Campeão (7): Atleta Extraordinário entram no nível certo (não antes)',
    championSeven.ids.includes('remarkable-athlete') &&
      !championThree.ids.includes('remarkable-athlete') &&
      !championThree.ids.includes('survivor'),
    JSON.stringify(championSeven.ids),
  );
  const championFifteen = await subclassScenario('fighter', 'Campeão', 15);
  check(
    'Campeão (15): Crítico Superior baixa o limiar para 18 (o menor prevalece)',
    championFifteen.ids.includes('superior-critical') &&
      championFifteen.sheet?.derived?.critThreshold === 18,
    JSON.stringify(championFifteen.ids),
  );
  const championEighteen = await subclassScenario('fighter', 'Campeão', 18);
  check(
    'Campeão (18): Sobrevivente entra e o limiar fica em 18',
    championEighteen.ids.includes('survivor') &&
      championEighteen.sheet?.derived?.critThreshold === 18,
    JSON.stringify(championEighteen.ids),
  );

  const battleMasterThree = await subclassScenario('fighter', 'Mestre da Batalha', 3, {
    active: [],
    used: {},
    choices: { maneuvers: ['trip-attack', 'riposte', 'parry'], 'student-of-war': ['smith'] },
  });
  check(
    'Mestre da Batalha (3): 4 dados de superioridade e as manobras escolhidas',
    battleMasterThree.ids.includes('combat-superiority') &&
      resourceMax(battleMasterThree, 'superiority-dice') === 4 &&
      battleMasterThree.sheet?.classes?.[0]?.featureChoices?.find(
        (info: any) => info.featureId === 'maneuvers',
      )?.count === 3,
    JSON.stringify({ dados: resourceMax(battleMasterThree, 'superiority-dice') }),
  );
  const battleMasterSeven = await subclassScenario('fighter', 'Mestre da Batalha', 7);
  check(
    'Mestre da Batalha (7): 5 dados e Conheça seu Inimigo',
    resourceMax(battleMasterSeven, 'superiority-dice') === 5 &&
      battleMasterSeven.ids.includes('know-your-enemy'),
    JSON.stringify(battleMasterSeven.ids),
  );
  const battleMasterFifteen = await subclassScenario('fighter', 'Mestre da Batalha', 15);
  check(
    'Mestre da Batalha (15): 6 dados, mais duas manobras e Implacável',
    resourceMax(battleMasterFifteen, 'superiority-dice') === 6 &&
      battleMasterFifteen.ids.includes('maneuvers-15') &&
      battleMasterFifteen.ids.includes('relentless'),
    JSON.stringify(battleMasterFifteen.ids),
  );
  const battleMasterEighteen = await subclassScenario('fighter', 'Mestre da Batalha', 18);
  check(
    'Mestre da Batalha (18): Superioridade em Combate Aprimorada',
    battleMasterEighteen.ids.includes('combat-superiority-mastery'),
    JSON.stringify(battleMasterEighteen.ids),
  );

  const knightThree = await subclassScenario('fighter', 'Cavaleiro Arcano', 3);
  check(
    'Cavaleiro Arcano (3): Vínculo com Arma e conjuração de terço',
    knightThree.ids.includes('weapon-bond') &&
      knightThree.sheet?.classes?.[0]?.spellcasting?.type === 'third',
    JSON.stringify(knightThree.ids),
  );
  const knightSeven = await subclassScenario('fighter', 'Cavaleiro Arcano', 7);
  const knightTen = await subclassScenario('fighter', 'Cavaleiro Arcano', 10);
  const knightFifteen = await subclassScenario('fighter', 'Cavaleiro Arcano', 15);
  const knightEighteen = await subclassScenario('fighter', 'Cavaleiro Arcano', 18);
  check(
    'Cavaleiro Arcano: Magia de Guerra (7), Golpe Místico (10), Carga Arcana (15) e Aprimorada (18)',
    knightSeven.ids.includes('war-magic') &&
      knightTen.ids.includes('eldritch-strike') &&
      knightFifteen.ids.includes('arcane-charge') &&
      knightEighteen.ids.includes('improved-war-magic'),
    JSON.stringify([
      knightSeven.ids,
      knightTen.ids,
      knightFifteen.ids,
      knightEighteen.ids,
    ]),
  );

  const paladinOneStep = await subclassScenario('paladin', 'Juramento de Devoção', 1);
  const paladinFiveStep = await subclassScenario('paladin', 'Juramento de Devoção', 5);
  check(
    'Mãos Consagradas = 5 × nível de Paladino (5 no 1º nível, 25 no 5º)',
    resourceMax(paladinOneStep, 'lay-on-hands') === 5 &&
      resourceMax(paladinFiveStep, 'lay-on-hands') === 25,
    JSON.stringify({
      um: resourceMax(paladinOneStep, 'lay-on-hands'),
      cinco: resourceMax(paladinFiveStep, 'lay-on-hands'),
    }),
  );

  const devotionThree = await subclassScenario('paladin', 'Juramento de Devoção', 3);
  check(
    'Devoção (3): Canalizar Divindade (1 uso) e as magias de juramento',
    resourceMax(devotionThree, 'channel-divinity') === 1 &&
      devotionThree.ids.includes('oath-spells') &&
      !devotionThree.ids.includes('aura-of-devotion'),
    JSON.stringify(devotionThree.ids),
  );
  const devotionSeven = await subclassScenario('paladin', 'Juramento de Devoção', 7);
  const devotionTwenty = await subclassScenario('paladin', 'Juramento de Devoção', 20);
  check(
    'Devoção (7 e 20): Aura de Devoção, Purificação e Halo Sagrado nos níveis certos',
    devotionSeven.ids.includes('aura-of-devotion') &&
      !devotionSeven.ids.includes('holy-nimbus') &&
      devotionTwenty.ids.includes('purity-of-spirit') &&
      devotionTwenty.ids.includes('holy-nimbus'),
    JSON.stringify({ sete: devotionSeven.ids, vinte: devotionTwenty.ids }),
  );

  const ancientsThree = await subclassScenario('paladin', 'Juramento dos Anciões', 3);
  const ancientsSeven = await subclassScenario('paladin', 'Juramento dos Anciões', 7);
  const ancientsTwenty = await subclassScenario('paladin', 'Juramento dos Anciões', 20);
  check(
    'Anciões: magias de juramento, Aura de Resguardo (7), Sentinela Imortal (15) e Campeão Ancestral (20)',
    ancientsThree.ids.includes('oath-spells') &&
      ancientsSeven.ids.includes('aura-of-warding') &&
      ancientsTwenty.ids.includes('undying-sentinel') &&
      ancientsTwenty.ids.includes('elder-champion') &&
      resourceMax(ancientsTwenty, 'elder-champion') === 1,
    JSON.stringify(ancientsTwenty.ids),
  );

  const vengeanceThree = await subclassScenario('paladin', 'Juramento de Vingança', 3);
  const vengeanceTwenty = await subclassScenario('paladin', 'Juramento de Vingança', 20);
  check(
    'Vingança: Abjurar Inimigo/Voto de Inimizade (3) e as features até o Anjo Vingador (20)',
    vengeanceThree.ids.includes('oath-spells') &&
      vengeanceTwenty.ids.includes('relentless-avenger') &&
      vengeanceTwenty.ids.includes('soul-of-vengeance') &&
      vengeanceTwenty.ids.includes('avenging-angel') &&
      resourceMax(vengeanceTwenty, 'avenging-angel') === 1,
    JSON.stringify(vengeanceTwenty.ids),
  );

  const loreThree = await subclassScenario('bard', 'Colégio do Conhecimento', 3);
  const loreFourteen = await subclassScenario('bard', 'Colégio do Conhecimento', 14);
  check(
    'Colégio do Conhecimento: 3 perícias e Palavras de Interrupção (3), Perícia Inigualável (14)',
    loreThree.ids.includes('bonus-proficiencies') &&
      loreThree.ids.includes('cutting-words') &&
      loreFourteen.ids.includes('additional-magical-secrets') &&
      loreFourteen.ids.includes('peerless-skill'),
    JSON.stringify(loreFourteen.ids),
  );
  const valorThree = await subclassScenario('bard', 'Colégio da Bravura', 3);
  const valorFourteen = await subclassScenario('bard', 'Colégio da Bravura', 14);
  check(
    'Colégio da Bravura: Inspiração de Combate (3), Ataque Extra (6) e Magia de Batalha (14)',
    valorThree.ids.includes('combat-inspiration') &&
      !valorThree.ids.includes('extra-attack') &&
      valorFourteen.ids.includes('extra-attack') &&
      valorFourteen.ids.includes('battle-magic'),
    JSON.stringify(valorFourteen.ids),
  );

  const hunterThree = await subclassScenario('ranger', 'Caçador', 3);
  const hunterSeven = await subclassScenario('ranger', 'Caçador', 7);
  const hunterEleven = await subclassScenario('ranger', 'Caçador', 11);
  const hunterFifteen = await subclassScenario('ranger', 'Caçador', 15);
  check(
    'Caçador: Presa (3), Táticas Defensivas (7), Multiataque (11) e Defesa Superior (15)',
    hunterThree.ids.includes('hunters-prey') &&
      !hunterThree.ids.includes('defensive-tactics') &&
      hunterSeven.ids.includes('defensive-tactics') &&
      hunterEleven.ids.includes('multiattack') &&
      hunterFifteen.ids.includes('superior-hunters-defense'),
    JSON.stringify([hunterThree.ids, hunterFifteen.ids]),
  );

  const beastThree = await subclassScenario('ranger', 'Senhor das Feras', 3);
  const beastFifteen = await subclassScenario('ranger', 'Senhor das Feras', 15);
  check(
    'Senhor das Feras: companheiro (3), Treinamento Excepcional (7), Fúria Bestial (11) e Compartilhar Magias (15)',
    beastThree.ids.includes('rangers-companion') &&
      beastFifteen.ids.includes('exceptional-training') &&
      beastFifteen.ids.includes('bestial-fury') &&
      beastFifteen.ids.includes('share-spells'),
    JSON.stringify(beastFifteen.ids),
  );

  // --- Crítico no ataque de verdade ----------------------------------------
  // O limiar do Campeão precisa valer no combate: com o Crítico Superior todo
  // d20 igual ou acima de 18 critica, e o 1 natural continua errando.
  await api('/api/combat/end', { method: 'POST', token: masterToken });

  const critPlayer = await freshSheet('fase0crit');
  await prisma.character.update({
    where: { userId: critPlayer.userId },
    data: {
      strength: 15,
      dexterity: 14,
      hpMax: 400,
      hpCurrent: 400,
      classes: [{ classKey: 'fighter', subclass: 'Campeão', level: 15 }] as any,
      classState: { active: [], used: {}, choices: {} } as any,
    },
  });
  await masterPatch(critPlayer.characterId, {
    attacks: [
      {
        id: 'crit1',
        name: 'Espada longa',
        damage: { count: 1, sides: 8, bonus: 3, type: 'Cortante' },
        attackBonus: 12,
        notes: '',
        finesse: false,
        ranged: false,
      },
    ],
  });

  const dummy = await api('/api/creatures', {
    method: 'POST',
    token: masterToken,
    body: {
      name: 'Boneco de treino',
      type: 'Constructo',
      hpMax: 9999,
      armorClass: 10,
      localityIds: [locality.id],
    },
  });
  createdCreatureIds.push(dummy.data.creature.id);

  const started = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { entries: [{ creatureId: dummy.data.creature.id, quantity: 1 }] },
  });
  check('combate de treino iniciado para o teste de crítico (201)', started.status === 201, JSON.stringify(started.data));
  createdCombatIds.push(started.data.combat.id);

  for (const combatant of started.data.combat.combatants) {
    await api(`/api/combat/initiative/${combatant.id}`, { method: 'POST', token: masterToken });
  }
  const training = (await api('/api/combat/active', { token: masterToken })).data.combat;
  const targetCombatant = (training?.combatants ?? []).find((item: any) => item.kind === 'CREATURE');
  check(
    'o combate fica ativo com o boneco de treino como alvo',
    training?.status === 'ACTIVE' && Boolean(targetCombatant),
    JSON.stringify({ status: training?.status }),
  );

  /** Ataca N vezes com o personagem e devolve os resultados aceitos. */
  async function rollAttacks(token: string, times: number): Promise<any[]> {
    const results: any[] = [];
    for (let index = 0; index < times; index += 1) {
      const response = await api('/api/combat/attack', {
        method: 'POST',
        token,
        body: { attackId: 'crit1', targetCombatantId: targetCombatant.id },
      });
      if (response.status === 200 && response.data?.result) results.push(response.data.result);
    }
    return results;
  }

  const championRolls = await rollAttacks(critPlayer.token, 60);
  check(
    'o Campeão (15) resolve os 60 ataques de treino',
    championRolls.length === 60,
    JSON.stringify({ resolvidos: championRolls.length }),
  );
  check(
    'com o Crítico Superior, TODO d20 ≥ 18 é crítico (18–20)',
    championRolls.every((result: any) => result.critical === (result.attackRoll >= 18)),
    JSON.stringify(championRolls.filter((r: any) => r.critical !== (r.attackRoll >= 18))),
  );
  check(
    'a amostra do Campeão tem um crítico de verdade (a regra foi exercitada)',
    championRolls.some((result: any) => result.attackRoll >= 18 && result.critical),
    JSON.stringify(championRolls.map((r: any) => r.attackRoll)),
  );
  check(
    'o 1 natural continua ERRANDO mesmo com o limiar baixo',
    championRolls.every((result: any) => result.attackRoll !== 1 || result.hit === false),
    JSON.stringify(championRolls.filter((r: any) => r.attackRoll === 1 && r.hit)),
  );

  // Sem o Campeão o limiar volta a 20: um 19 NÃO pode ser crítico.
  await prisma.character.update({
    where: { userId: critPlayer.userId },
    data: { classes: [{ classKey: 'fighter', subclass: '', level: 15 }] as any },
  });
  const plainRolls = await rollAttacks(critPlayer.token, 60);
  check(
    'sem o Campeão o limiar volta a 20 (nenhum acerto com d20 < 20 é crítico)',
    plainRolls.length === 60 &&
      plainRolls.every((result: any) => result.critical === (result.attackRoll >= 20)),
    JSON.stringify(plainRolls.filter((r: any) => r.critical !== (r.attackRoll >= 20))),
  );
  check(
    'o 1 natural também erra no Guerreiro sem subclasse',
    plainRolls.every((result: any) => result.attackRoll !== 1 || result.hit === false),
    JSON.stringify(plainRolls.filter((r: any) => r.attackRoll === 1 && r.hit)),
  );

  // --- 20. Moedas -----------------------------------------------------------
  console.log('\n20) Moedas');

  const wallet = await freshSheet('fase0coins');
  const receiver = await freshSheet('fase0coins2');

  const initialCoins = await sheetOf(wallet.token);
  check(
    'a ficha nasce com as cinco denominações zeradas',
    initialCoins?.coins?.pp === 0 &&
      initialCoins?.coins?.gp === 0 &&
      initialCoins?.coins?.ep === 0 &&
      initialCoins?.coins?.sp === 0 &&
      initialCoins?.coins?.cp === 0,
    JSON.stringify(initialCoins?.coins),
  );

  // O PATCH do JOGADOR nunca aceita moedas — nem antes de finalizar a criação.
  const playerCoinPatch = await api('/api/characters/me', {
    method: 'PATCH',
    token: wallet.token,
    body: { coins: { gp: 100 } },
  });
  check(
    'o jogador não altera moedas por PATCH (403 citando Moedas)',
    playerCoinPatch.status === 403 && /Moedas/.test(playerCoinPatch.data?.message ?? ''),
    JSON.stringify(playerCoinPatch.data),
  );

  const masterGive = (characterId: string, delta: Record<string, number>) =>
    api(`/api/characters/${characterId}/coins`, {
      method: 'POST',
      token: masterToken,
      body: { delta },
    });

  await masterPatch(wallet.characterId, { coins: { pp: 0, gp: 50, ep: 0, sp: 0, cp: 0 } });
  const weighted = await sheetOf(wallet.token);
  check(
    '50 moedas entram no derived.totalWeight como 0,5 kg',
    weighted?.derived?.totalWeight === 0.5,
    JSON.stringify({ totalWeight: weighted?.derived?.totalWeight }),
  );

  const given = await masterGive(wallet.characterId, { gp: 20, sp: 5 });
  check(
    'o mestre dá moedas pelo endpoint dedicado (200)',
    given.status === 200 &&
      given.data?.character?.coins?.gp === 70 &&
      given.data?.character?.coins?.sp === 5,
    JSON.stringify(given.data?.character?.coins),
  );

  check(
    'retirar mais do que existe é recusado (400)',
    (await masterGive(wallet.characterId, { gp: -999 })).status === 400,
  );

  const spent = await api('/api/characters/me/coins/spend', {
    method: 'POST',
    token: wallet.token,
    body: { amount: { gp: 10, sp: 5 } },
  });
  check(
    'gastar debita exatamente as denominações pedidas (sem troco)',
    spent.status === 200 &&
      spent.data?.character?.coins?.gp === 60 &&
      spent.data?.character?.coins?.sp === 0,
    JSON.stringify(spent.data?.character?.coins),
  );

  check(
    'gastar mais do que o saldo é recusado (400)',
    (
      await api('/api/characters/me/coins/spend', {
        method: 'POST',
        token: wallet.token,
        body: { amount: { pp: 1 } },
      })
    ).status === 400,
  );

  await masterGive(wallet.characterId, { sp: 10 });
  const exchanged = await api('/api/characters/me/coins/exchange', {
    method: 'POST',
    token: wallet.token,
    body: { from: 'sp', to: 'gp', amount: 10 },
  });
  check(
    'trocar 10 PP por 1 PO preserva o valor total (200)',
    exchanged.status === 200 &&
      exchanged.data?.character?.coins?.sp === 0 &&
      exchanged.data?.character?.coins?.gp === 61,
    JSON.stringify(exchanged.data?.character?.coins),
  );

  await masterGive(wallet.characterId, { cp: 1 });
  check(
    'troca que exigiria fração é recusada (1 PC para PO → 400)',
    (
      await api('/api/characters/me/coins/exchange', {
        method: 'POST',
        token: wallet.token,
        body: { from: 'cp', to: 'gp', amount: 1 },
      })
    ).status === 400,
  );

  await masterGive(wallet.characterId, { gp: 10 });
  const transferred = await api('/api/characters/me/coins/transfer', {
    method: 'POST',
    token: wallet.token,
    body: { targetCharacterId: receiver.characterId, amount: { gp: 10 } },
  });
  const receiverSheet = await sheetOf(receiver.token);
  check(
    'transferir debita do doador e credita no destino na mesma ação',
    transferred.status === 200 &&
      transferred.data?.character?.coins?.gp === 61 &&
      receiverSheet?.coins?.gp === 10,
    JSON.stringify({ doador: transferred.data?.character?.coins, destino: receiverSheet?.coins }),
  );

  check(
    'transferir para si mesmo é recusado (400)',
    (
      await api('/api/characters/me/coins/transfer', {
        method: 'POST',
        token: wallet.token,
        body: { targetCharacterId: wallet.characterId, amount: { gp: 1 } },
      })
    ).status === 400,
  );

  const targets = await api('/api/characters/players', { token: wallet.token });
  check(
    'a lista de destinos traz outros jogadores e não a própria ficha',
    targets.status === 200 &&
      Array.isArray(targets.data?.characters) &&
      targets.data.characters.some((entry: any) => entry.id === receiver.characterId) &&
      !targets.data.characters.some((entry: any) => entry.id === wallet.characterId),
    JSON.stringify(targets.data?.characters?.length),
  );

  check(
    'só o mestre alterna as moedas extras (403)',
    (
      await api('/api/game/extra-coins', {
        method: 'POST',
        token: wallet.token,
        body: { enabled: true },
      })
    ).status === 403,
  );

  const toggled = await api('/api/game/extra-coins', {
    method: 'POST',
    token: masterToken,
    body: { enabled: true },
  });
  check(
    'o mestre liga as denominações extras (200)',
    toggled.status === 200 && toggled.data?.config?.extraCoins === true,
    JSON.stringify(toggled.data?.config),
  );
  // Devolve ao padrão para não influenciar o restante da mesa.
  await api('/api/game/extra-coins', {
    method: 'POST',
    token: masterToken,
    body: { enabled: false },
  });

  // --- 21. Inventário: quantidade só do mestre e uso de consumível ----------
  console.log('\n21) Inventário (quantidade e uso de item)');

  const bag = await freshSheet('fase0inv');
  // A ficha ainda NÃO finalizou a criação — e o PATCH de inventário já é 403.
  const inventoryPatch = await api('/api/characters/me', {
    method: 'PATCH',
    token: bag.token,
    body: { inventory: [] },
  });
  check(
    'o jogador não altera o inventário por PATCH nem durante a criação (403 citando Inventário)',
    inventoryPatch.status === 403 && /Inventário/.test(inventoryPatch.data?.message ?? ''),
    JSON.stringify(inventoryPatch.data),
  );

  const potion = {
    id: 'inv-potion',
    name: 'Poção de cura',
    description: '',
    quantity: 2,
    weight: 0.5,
    slot: null,
    backpackX: null,
    backpackY: null,
    imageUrl: '',
    itemId: '',
    category: 'Poção',
    details: { effectRoll: '2d4+2' },
  };
  const gear = {
    id: 'inv-gear',
    name: 'Corda',
    description: '',
    quantity: 1,
    weight: 2,
    slot: null,
    backpackX: null,
    backpackY: null,
    imageUrl: '',
    itemId: '',
    category: 'Item Geral',
    details: {},
  };
  const sword = {
    ...gear,
    id: 'inv-sword',
    name: 'Espada longa',
    category: 'Arma',
    details: { damageCount: 1, damageDie: 8, damageType: 'Cortante' },
  };

  const stocked = await masterPatch(bag.characterId, { inventory: [potion, gear, sword] });
  check(
    'o mestre define o inventário pelo PATCH (200)',
    stocked.status === 200 && stocked.data?.character?.inventory?.length === 3,
    JSON.stringify(stocked.data?.character?.inventory?.length),
  );

  // Movimentar continua do jogador, e nunca mexe na quantidade (o campo extra
  // de quantidade no corpo é ignorado pelo schema).
  const moved = await api('/api/characters/me/inventory/move', {
    method: 'POST',
    token: bag.token,
    body: { itemInventoryId: 'inv-potion', targetSlot: 'hand1', quantity: 99 },
  });
  const movedPotion = (moved.data?.character?.inventory ?? []).find(
    (item: any) => item.id === 'inv-potion',
  );
  check(
    'mover/equipar do jogador continua valendo e não muda a quantidade',
    moved.status === 200 && movedPotion?.slot === 'hand1' && movedPotion?.quantity === 2,
    JSON.stringify(movedPotion),
  );

  const used = await api('/api/characters/me/inventory/use', {
    method: 'POST',
    token: bag.token,
    body: { itemInventoryId: 'inv-potion' },
  });
  const usedPotion = (used.data?.character?.inventory ?? []).find(
    (item: any) => item.id === 'inv-potion',
  );
  check(
    'usar a poção desconta 1 unidade (2 → 1) e devolve a ficha (200)',
    used.status === 200 && usedPotion?.quantity === 1,
    JSON.stringify(usedPotion),
  );
  check(
    'a rolagem do efeito volta como kind item, com o nome do item',
    used.data?.roll?.kind === 'item' &&
      used.data?.roll?.label === 'Item: Poção de cura' &&
      used.data?.roll?.actorName === used.data?.character?.name &&
      used.data?.roll?.dice?.length === 2 &&
      used.data?.roll?.dice?.every((die: any) => die.sides === 4) &&
      used.data?.roll?.bonus === 2 &&
      used.data?.roll?.total ===
        used.data.roll.dice.reduce((sum: number, die: any) => sum + die.value, 0) + 2,
    JSON.stringify(used.data?.roll),
  );

  const usedAgain = await api('/api/characters/me/inventory/use', {
    method: 'POST',
    token: bag.token,
    body: { itemInventoryId: 'inv-potion' },
  });
  check(
    'a última unidade sai do inventário (a entrada some)',
    usedAgain.status === 200 &&
      !(usedAgain.data?.character?.inventory ?? []).some((item: any) => item.id === 'inv-potion'),
    JSON.stringify(usedAgain.data?.character?.inventory?.map((item: any) => item.id)),
  );

  check(
    'item não consumível é recusado (400)',
    (
      await api('/api/characters/me/inventory/use', {
        method: 'POST',
        token: bag.token,
        body: { itemInventoryId: 'inv-sword' },
      })
    ).status === 400,
  );

  check(
    'usar um item fora do inventário é 404',
    (
      await api('/api/characters/me/inventory/use', {
        method: 'POST',
        token: bag.token,
        body: { itemInventoryId: 'nao-existe' },
      })
    ).status === 404,
  );

  // Item de Outro marcado pelo mestre como consumível, com efeito FIXO (sem dado).
  await masterPatch(bag.characterId, {
    inventory: [
      gear,
      sword,
      {
        ...gear,
        id: 'inv-oil',
        name: 'Óleo flamejante',
        category: 'Outro',
        details: { consumable: true, effectRoll: '4' },
      },
    ],
  });
  const oilUse = await api('/api/characters/me/inventory/use', {
    method: 'POST',
    token: bag.token,
    body: { itemInventoryId: 'inv-oil' },
  });
  check(
    'item de Outro marcado como consumível pode ser usado; efeito fixo vira bônus',
    oilUse.status === 200 &&
      oilUse.data?.roll?.kind === 'item' &&
      oilUse.data?.roll?.dice?.length === 0 &&
      oilUse.data?.roll?.bonus === 4 &&
      oilUse.data?.roll?.total === 4 &&
      !(oilUse.data?.character?.inventory ?? []).some((item: any) => item.id === 'inv-oil'),
    JSON.stringify({
      roll: oilUse.data?.roll,
      inv: oilUse.data?.character?.inventory?.map((item: any) => item.id),
    }),
  );

  // --- 22. Dano estruturado: expressão derivada, tipo canônico e legado -----
  console.log('\n22) Dano estruturado: expressão derivada, tipo canônico e legado');

  // A expressão textual ("2d6+3") é DERIVADA do dano estruturado, nunca gravada.
  check(
    'a expressão textual é derivada do dano estruturado',
    damageExpression({ count: 2, sides: 6, bonus: 3, type: 'Cortante' }) === '2d6+3' &&
      damageExpression({ count: 1, sides: 8, bonus: -1, type: 'Cortante' }) === '1d8-1' &&
      damageExpression({ count: 0, sides: 0, bonus: 4, type: 'Força' }) === '4',
    JSON.stringify([
      damageExpression({ count: 2, sides: 6, bonus: 3, type: 'Cortante' }),
      damageExpression({ count: 1, sides: 8, bonus: -1, type: 'Cortante' }),
      damageExpression({ count: 0, sides: 0, bonus: 4, type: 'Força' }),
    ]),
  );

  // O crítico dobra os DADOS e soma o modificador UMA vez.
  const critDamage = rollDice(
    damageExpression({ count: 2, sides: 6, bonus: 3, type: 'Cortante' }),
    { crit: true },
  );
  const normalDamage = rollDice(
    damageExpression({ count: 2, sides: 6, bonus: 3, type: 'Cortante' }),
  );
  check(
    'o crítico dobra os dados (2d6 → 4d6) e soma o modificador uma só vez',
    critDamage?.count === 4 &&
      critDamage.sides === 6 &&
      critDamage.modifier === 3 &&
      critDamage.rolls.length === 4 &&
      critDamage.total >= 7 &&
      critDamage.total <= 27 &&
      normalDamage?.count === 2 &&
      normalDamage.total >= 5 &&
      normalDamage.total <= 15,
    JSON.stringify({ crit: critDamage?.total, normal: normalDamage?.total }),
  );

  // Reaproveita a carteira da seção 20 como ficha de trabalho (o cadastro de
  // contas é limitado pelo rate limiter do login).
  const dmgSheet = wallet;
  const badTypeAttack = await masterPatch(dmgSheet.characterId, {
    attacks: [
      {
        id: 'bad',
        name: 'Ataque estranho',
        damage: { count: 1, sides: 6, bonus: 0, type: 'Sonoro' },
        attackBonus: 0,
        notes: '',
        finesse: false,
        ranged: false,
      },
    ],
  });
  check(
    'tipo de dano fora dos 13 canônicos é recusado (400)',
    badTypeAttack.status === 400,
    JSON.stringify(badTypeAttack.data),
  );

  const legacySaved = await masterPatch(dmgSheet.characterId, {
    attacks: [
      {
        id: 'legacy1',
        name: 'Mordida',
        damage: { count: 0, sides: 0, bonus: 0, type: 'Elétrico' },
        attackBonus: 0,
        notes: '',
        finesse: false,
        ranged: false,
        legacy: true,
        damageText: '(2d10+9)+2d10',
      },
    ],
  });
  const legacyKept = legacySaved.data?.character?.attacks?.find((a: any) => a.id === 'legacy1');
  check(
    'ataque legado é preservado com a marca e o texto original',
    legacySaved.status === 200 &&
      legacyKept?.legacy === true &&
      legacyKept?.damageText === '(2d10+9)+2d10',
    JSON.stringify(legacyKept),
  );

  const typedSaved = await masterPatch(dmgSheet.characterId, {
    attacks: [
      {
        id: 'typed',
        name: 'Adaga',
        damage: { count: 1, sides: 4, bonus: 2, type: 'Perfurante' },
        attackBonus: 5,
        notes: '',
        finesse: true,
        ranged: false,
      },
    ],
  });
  const typedAttack = typedSaved.data?.character?.attacks?.find((a: any) => a.id === 'typed');
  check(
    'dano estruturado com tipo canônico é gravado (sem texto paralelo)',
    typedSaved.status === 200 &&
      typedAttack?.damage?.count === 1 &&
      typedAttack?.damage?.sides === 4 &&
      typedAttack?.damage?.bonus === 2 &&
      typedAttack?.damage?.type === 'Perfurante' &&
      typedAttack?.legacy === false &&
      typedAttack?.damageText === undefined,
    JSON.stringify(typedAttack),
  );

  // --- 23. Cadastro de arma: perfil na ficha e preço fora dela --------------
  console.log('\n23) Cadastro de arma: perfil na ficha e preço só do mestre');

  const shopper = wallet;
  const pricedItem = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Espada do teste ${suffix}`,
      category: 'Arma',
      weight: 2,
      details: {
        damageCount: 1,
        damageDie: 8,
        damageType: 'Cortante',
        weaponType: 'melee',
        weaponCategory: 'martial',
        properties: [],
      },
      price: { gold: 15, silver: 5, copper: 0 },
    },
  });
  check(
    'mestre cadastra a arma com preço no catálogo (201)',
    pricedItem.status === 201,
    JSON.stringify(pricedItem.data),
  );
  const pricedId = pricedItem.data?.item?.id;
  createdItemIds.push(pricedId);

  await api(`/api/items/${pricedId}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: shopper.characterId, quantity: 1 },
  });
  const shopperSheet = await sheetOf(shopper.token);
  const shopEntry = shopperSheet?.inventory?.find((item: any) => item.itemId === pricedId);
  check(
    'a ficha do jogador recebe a arma com o PERFIL (tipo, categoria e dano)',
    shopEntry?.category === 'Arma' &&
      shopEntry?.details?.weaponType === 'melee' &&
      shopEntry?.details?.weaponCategory === 'martial' &&
      shopEntry?.details?.damageDie === 8,
    JSON.stringify(shopEntry),
  );
  check(
    'o PREÇO do catálogo não vai para a ficha do jogador',
    shopEntry !== undefined &&
      !('price' in shopEntry) &&
      !JSON.stringify(shopEntry).includes('"price"'),
    JSON.stringify(shopEntry),
  );

  // --- 24. Munição: exigência, bônus de dano e concorrência -----------------
  console.log('\n24) Munição: exigência, bônus de dano e concorrência');

  /** Item de inventário no formato aceito pelo PATCH da ficha. */
  const makeItem = (
    id: string,
    name: string,
    category: string,
    details: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    name,
    description: '',
    quantity: 1,
    weight: 1,
    slot: null,
    backpackX: null,
    backpackY: null,
    imageUrl: '',
    itemId: '',
    category,
    details,
    ...extra,
  });

  // Só há UM combate ativo por vez: encerra o de treino anterior.
  await api('/api/combat/end', { method: 'POST', token: masterToken });

  const archer = wallet;
  const ammoTarget = await api('/api/creatures', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Alvo de munição ${suffix}`,
      type: 'Constructo',
      hpMax: 9999,
      armorClass: 10,
      localityIds: [locality.id],
    },
  });
  createdCreatureIds.push(ammoTarget.data.creature.id);

  const ammoCombat = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { entries: [{ creatureId: ammoTarget.data.creature.id, quantity: 1 }] },
  });
  check('combate de munição iniciado (201)', ammoCombat.status === 201, JSON.stringify(ammoCombat.data));
  createdCombatIds.push(ammoCombat.data.combat.id);
  for (const combatant of ammoCombat.data.combat.combatants) {
    await api(`/api/combat/initiative/${combatant.id}`, { method: 'POST', token: masterToken });
  }
  const ammoActive = (await api('/api/combat/active', { token: masterToken })).data.combat;
  const ammoTargetCombatant = (ammoActive?.combatants ?? []).find(
    (item: any) => item.kind === 'CREATURE',
  );
  check(
    'o combate de munição fica ativo com alvo',
    ammoActive?.status === 'ACTIVE' && Boolean(ammoTargetCombatant),
    JSON.stringify({ status: ammoActive?.status }),
  );

  // Arma corpo a corpo SEM a propriedade Munição: nada é consumido.
  await masterPatch(archer.characterId, {
    inventory: [
      makeItem(
        'plain-sword',
        'Espada',
        'Arma',
        { damageCount: 1, damageDie: 8, damageType: 'Cortante' },
        { slot: 'hand1' },
      ),
      makeItem('plain-arrow', 'Flecha', 'Munição', { ammoType: 'Flecha' }, { quantity: 5 }),
    ],
    attacks: [
      {
        id: 'plain-sword-atk',
        name: 'Espada',
        damage: { count: 0, sides: 0, bonus: 4, type: 'Cortante' },
        attackBonus: 30,
        notes: '',
        finesse: false,
        ranged: false,
        inventoryItemId: 'plain-sword',
      },
    ],
  });
  const plainHit = await api('/api/combat/attack', {
    method: 'POST',
    token: archer.token,
    body: { attackId: 'plain-sword-atk', targetCombatantId: ammoTargetCombatant.id },
  });
  const afterPlainHit = await sheetOf(archer.token);
  check(
    'arma sem a propriedade Munição NÃO consome nada',
    plainHit.status === 200 &&
      afterPlainHit.inventory.find((item: any) => item.id === 'plain-arrow')?.quantity === 5,
    JSON.stringify(afterPlainHit.inventory.map((item: any) => ({ id: item.id, q: item.quantity }))),
  );

  // Munição mágica: o bônus soma ao ATAQUE e ao DANO.
  const rangedBow = makeItem(
    'bow2',
    'Arco curto',
    'Arma',
    {
      damageCount: 1,
      damageDie: 6,
      damageType: 'Perfurante',
      weaponType: 'ranged',
      weaponCategory: 'simple',
      properties: ['ammunition', 'two-handed'],
      ammoType: 'Flecha',
      rangeNormal: 24,
      rangeLong: 96,
    },
    { slot: 'hand2' },
  );
  const magicArrow2 = makeItem(
    'arrow2',
    'Flecha +2',
    'Munição',
    { ammoType: 'Flecha', attackBonus: 2, damageBonus: 2 },
    { quantity: 3 },
  );
  const bowAttack2 = {
    id: 'bow2-atk',
    name: 'Arco',
    damage: { count: 0, sides: 0, bonus: 4, type: 'Perfurante' },
    attackBonus: 30,
    notes: '',
    finesse: false,
    ranged: true,
    inventoryItemId: 'bow2',
  };
  await masterPatch(archer.characterId, {
    inventory: [rangedBow, magicArrow2],
    attacks: [bowAttack2],
  });

  let ammoDamageResult: any = null;
  for (let attempt = 0; attempt < 12 && ammoDamageResult === null; attempt += 1) {
    const shot = await api('/api/combat/attack', {
      method: 'POST',
      token: archer.token,
      body: { attackId: 'bow2-atk', targetCombatantId: ammoTargetCombatant.id },
    });
    if (shot.status === 200 && shot.data?.result?.hit) ammoDamageResult = shot.data.result;
  }
  check(
    'o bônus da munição mágica soma ao ATAQUE e ao DANO (dano fixo 4 + 2)',
    ammoDamageResult !== null &&
      ammoDamageResult.attackBonus === 32 &&
      ammoDamageResult.damageRolled === 6,
    JSON.stringify(ammoDamageResult),
  );

  // Duas requisições SIMULTÂNEAS não gastam a mesma unidade duas vezes.
  await masterPatch(archer.characterId, {
    inventory: [rangedBow, { ...magicArrow2, id: 'arrow3', quantity: 1 }],
    attacks: [bowAttack2],
  });
  const race = await Promise.all([
    api('/api/combat/attack', {
      method: 'POST',
      token: archer.token,
      body: { attackId: 'bow2-atk', targetCombatantId: ammoTargetCombatant.id },
    }),
    api('/api/combat/attack', {
      method: 'POST',
      token: archer.token,
      body: { attackId: 'bow2-atk', targetCombatantId: ammoTargetCombatant.id },
    }),
  ]);
  const raceStatuses = race.map((response) => response.status).sort();
  const afterRace = await sheetOf(archer.token);
  check(
    'duas requisições simultâneas não gastam a mesma unidade (1 consome, 1 recusa)',
    raceStatuses[0] === 200 &&
      raceStatuses[1] === 409 &&
      afterRace.inventory.find((item: any) => item.id === 'arrow3') === undefined,
    JSON.stringify({
      statuses: raceStatuses,
      inventario: afterRace.inventory.map((item: any) => ({ id: item.id, q: item.quantity })),
    }),
  );

  await api('/api/combat/end', { method: 'POST', token: masterToken });

  // --- 25. Moedas: eventos em tempo real e recusas --------------------------
  console.log('\n25) Moedas: eventos em tempo real e recusas');

  // Duas fichas que já existem (o cadastro é limitado pelo rate limiter).
  const payer = wallet;
  const payee = receiver;
  const payerSocket = connect(payer.token);
  const payeeSocket = connect(payee.token);
  await Promise.all([
    waitFor<any>(payerSocket, 'connection:ready').catch(() => null),
    waitFor<any>(payeeSocket, 'connection:ready').catch(() => null),
  ]);

  // Saldos conhecidos antes da transferência.
  await masterPatch(payer.characterId, { coins: { pp: 0, gp: 30, ep: 0, sp: 0, cp: 0 } });
  await masterPatch(payee.characterId, { coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } });
  /** Espera um `sheet:updated` com o saldo em ouro informado (ignora outros). */
  const waitForGold = async (socket: Socket, gold: number) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const payload = await waitFor<any>(socket, 'sheet:updated', 1500).catch(() => null);
      if (!payload) return null;
      if (payload.character?.coins?.gp === gold) return payload;
    }
    return null;
  };

  const payerEvent = waitForGold(payerSocket, 20);
  const payeeEvent = waitForGold(payeeSocket, 10);
  const sent = await api('/api/characters/me/coins/transfer', {
    method: 'POST',
    token: payer.token,
    body: { targetCharacterId: payee.characterId, amount: { gp: 10 } },
  });
  const [payerPayload, payeePayload] = await Promise.all([payerEvent, payeeEvent]);
  check(
    'a transferência publica sheet:updated para as DUAS fichas, com os saldos finais',
    sent.status === 200 &&
      payerPayload?.character?.coins?.gp === 20 &&
      payeePayload?.character?.coins?.gp === 10,
    JSON.stringify({
      status: sent.status,
      doador: payerPayload?.character?.coins,
      destino: payeePayload?.character?.coins,
    }),
  );

  check(
    'transferir mais do que o saldo é recusado (400)',
    (
      await api('/api/characters/me/coins/transfer', {
        method: 'POST',
        token: payer.token,
        body: { targetCharacterId: payee.characterId, amount: { gp: 999 } },
      })
    ).status === 400,
  );

  // O mestre também pode ter ficha própria: transferir para ela é 400.
  const masterSheetCreated = await api<{ character: any }>('/api/characters/me', {
    method: 'POST',
    token: masterToken,
    body: {},
  });
  const masterCharacterId =
    masterSheetCreated.status === 201
      ? masterSheetCreated.data?.character?.id
      : (await api<{ character: any }>('/api/characters/me', { token: masterToken })).data?.character
          ?.id;
  check(
    'transferir para o mestre é recusado (400)',
    Boolean(masterCharacterId) &&
      (
        await api('/api/characters/me/coins/transfer', {
          method: 'POST',
          token: payer.token,
          body: { targetCharacterId: masterCharacterId, amount: { gp: 1 } },
        })
      ).status === 400,
  );

  // Alternar as moedas extras publica game:config para a mesa.
  const configSocket = connect(masterToken);
  await waitFor<any>(configSocket, 'connection:ready').catch(() => null);
  const configEvent = waitFor<any>(configSocket, 'game:config');
  const toggledEvent = await api('/api/game/extra-coins', {
    method: 'POST',
    token: masterToken,
    body: { enabled: true },
  });
  const configPayload = await configEvent.catch(() => null);
  check(
    'alternar as moedas extras publica game:config',
    toggledEvent.status === 200 && configPayload?.config?.extraCoins === true,
    JSON.stringify(configPayload?.config),
  );
  await api('/api/game/extra-coins', {
    method: 'POST',
    token: masterToken,
    body: { enabled: false },
  });

  payerSocket.close();
  payeeSocket.close();
  configSocket.close();

  // --- 26. Inventário: ajuste do mestre, send e log do item -----------------
  console.log('\n26) Inventário: ajuste do mestre, send e log do item');

  const locked = wallet;
  const healingPotion = makeItem('lock-potion', 'Poção de teste', 'Poção', { effectRoll: '1d4+1' });
  const rope = makeItem('lock-rope', 'Corda', 'Item Geral', {});

  await masterPatch(locked.characterId, { inventory: [healingPotion, rope] });
  const adjusted = await masterPatch(locked.characterId, {
    inventory: [{ ...healingPotion, quantity: 5 }, rope],
  });
  check(
    'o mestre ajusta a QUANTIDADE de um item (200)',
    adjusted.status === 200 &&
      adjusted.data?.character?.inventory?.find((item: any) => item.id === 'lock-potion')
        ?.quantity === 5,
    JSON.stringify(adjusted.data?.character?.inventory),
  );

  const removedItem = await masterPatch(locked.characterId, {
    inventory: [{ ...healingPotion, quantity: 5 }],
  });
  check(
    'o mestre REMOVE um item do inventário (200)',
    removedItem.status === 200 &&
      !(removedItem.data?.character?.inventory ?? []).some((item: any) => item.id === 'lock-rope'),
    JSON.stringify(removedItem.data?.character?.inventory?.map((item: any) => item.id)),
  );

  // O `send` do mestre continua somando no que já existe.
  const bulkItem = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: { name: `Corda do mestre ${suffix}`, category: 'Item Geral', weight: 2, details: {} },
  });
  createdItemIds.push(bulkItem.data?.item?.id);
  await api(`/api/items/${bulkItem.data.item.id}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: locked.characterId, quantity: 2 },
  });
  await api(`/api/items/${bulkItem.data.item.id}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: locked.characterId, quantity: 3 },
  });
  const afterSend = await sheetOf(locked.token);
  check(
    'os envios do mestre se acumulam (2 + 3 = 5)',
    afterSend.inventory.find((item: any) => item.itemId === bulkItem.data.item.id)?.quantity === 5,
    JSON.stringify(afterSend.inventory.map((item: any) => ({ id: item.itemId, q: item.quantity }))),
  );

  // Usar um consumível entra no LOG DE ROLAGENS do mestre como kind 'item'.
  await api('/api/dice/history', { method: 'DELETE', token: masterToken });
  const loggedUse = await api('/api/characters/me/inventory/use', {
    method: 'POST',
    token: locked.token,
    body: { itemInventoryId: 'lock-potion' },
  });
  const history = await api<{ rolls: any[] }>('/api/dice/history', { token: masterToken });
  const itemRoll = (history.data?.rolls ?? []).find((roll: any) => roll.kind === 'item');
  check(
    'o uso do item entra no log de rolagens como kind item',
    loggedUse.status === 200 &&
      itemRoll?.label === 'Item: Poção de teste' &&
      itemRoll?.total === loggedUse.data?.roll?.total,
    JSON.stringify({ log: itemRoll, resposta: loggedUse.data?.roll }),
  );

  // --- 27. Ataque derivado da arma equipada ---------------------------------
  console.log('\n27) Ataque derivado da arma equipada');

  // Reaproveita a ficha da seção 20 (o cadastro é limitado pelo rate limiter).
  // Ladino nível 1 dá o Ataque Furtivo e +2 de proficiência; FOR 16 / DES 18
  // deixam claro qual habilidade cada arma escolhe.
  const duelist = wallet;
  await setCharacterClasses(duelist.userId, [{ classKey: 'rogue', level: 1 }]);

  const weaponItem = (
    id: string,
    name: string,
    details: Record<string, unknown>,
    slot: 'hand1' | 'hand2',
  ) => makeItem(id, name, 'Arma', details, { slot });

  const longsword = weaponItem(
    'a-longsword',
    'Espada longa',
    {
      damageCount: 1,
      damageDie: 8,
      damageType: 'Cortante',
      weaponType: 'melee',
      weaponCategory: 'martial',
      properties: ['versatile'],
      versatileDie: 10,
    },
    'hand1',
  );
  const greataxe = weaponItem(
    'a-greataxe',
    'Machado grande',
    {
      damageCount: 1,
      damageDie: 12,
      damageType: 'Cortante',
      weaponType: 'melee',
      weaponCategory: 'martial',
      properties: ['two-handed'],
    },
    'hand1',
  );
  const club = weaponItem(
    'a-club',
    'Clava',
    {
      damageCount: 1,
      damageDie: 4,
      damageType: 'Concussão',
      weaponType: 'melee',
      weaponCategory: 'simple',
    },
    'hand1',
  );
  const rapier = weaponItem(
    'a-rapier',
    'Rapieira',
    {
      damageCount: 1,
      damageDie: 8,
      damageType: 'Perfurante',
      weaponType: 'melee',
      weaponCategory: 'martial',
      properties: ['finesse'],
    },
    'hand1',
  );
  const shortbow = weaponItem(
    'a-bow',
    'Arco curto',
    {
      damageCount: 1,
      damageDie: 6,
      damageType: 'Perfurante',
      weaponType: 'ranged',
      weaponCategory: 'simple',
      properties: ['ammunition', 'two-handed'],
      ammoType: 'Flecha',
      rangeNormal: 24,
      rangeLong: 96,
    },
    'hand1',
  );
  const javelin = weaponItem(
    'a-javelin',
    'Azagaia',
    {
      damageCount: 1,
      damageDie: 6,
      damageType: 'Perfurante',
      weaponType: 'melee',
      weaponCategory: 'simple',
      properties: ['thrown'],
      rangeNormal: 9,
      rangeLong: 36,
    },
    'hand1',
  );
  const daggerMain = weaponItem(
    'a-dagger1',
    'Adaga',
    {
      damageCount: 1,
      damageDie: 4,
      damageType: 'Perfurante',
      weaponType: 'melee',
      weaponCategory: 'simple',
      properties: ['finesse', 'light'],
    },
    'hand1',
  );
  const daggerOff = weaponItem(
    'a-dagger2',
    'Adaga',
    {
      damageCount: 1,
      damageDie: 4,
      damageType: 'Perfurante',
      weaponType: 'melee',
      weaponCategory: 'simple',
      properties: ['finesse', 'light'],
    },
    'hand2',
  );
  const shield = makeItem('a-shield', 'Escudo', 'Escudo', { armorClassBonus: 2 }, { slot: 'hand2' });
  const battleaxe = weaponItem(
    'a-battleaxe',
    'Machado de batalha',
    {
      damageCount: 1,
      damageDie: 8,
      damageType: 'Cortante',
      weaponType: 'melee',
      weaponCategory: 'martial',
      properties: ['versatile'],
      versatileDie: 10,
      canonicalWeaponId: 'battleaxe',
    },
    'hand1',
  );

  // Proficiências controladas: CATEGORIA simples e o NOME 'Espadas longas'
  // (plural) — nada de marcial genérico.
  await masterPatch(duelist.characterId, {
    strength: 16,
    dexterity: 18,
    proficiencies: { armor: [], weapons: ['Armas simples', 'Espadas longas'], tools: [] },
    inventory: [longsword],
    attacks: [],
  });

  const weaponAttacksOf = async (): Promise<any[]> =>
    ((await sheetOf(duelist.token))?.derivedAttacks ?? []) as any[];

  // Proficiência do item no popup de detalhes: vem calculada pelo servidor.
  const itemProficiencyOf = async (id: string): Promise<boolean | null | undefined> =>
    (await sheetOf(duelist.token))?.inventory?.find((item: any) => item.id === id)?.proficiency
      ?.proficient;

  const longswordAttack = (await weaponAttacksOf()).find(
    (attack) => attack.id === 'weapon:a-longsword',
  );
  check(
    'a arma equipada vira ataque derivado com a habilidade FOR (+3) e a proficiência pelo NOME (+2)',
    longswordAttack?.attackBonus === 5 &&
      longswordAttack?.damage?.bonus === 3 &&
      longswordAttack?.finesse === false &&
      longswordAttack?.ranged === false &&
      /proficiente/.test(longswordAttack?.notes ?? ''),
    JSON.stringify(longswordAttack),
  );
  check(
    'o popup do item traz a proficiência pelo NOME (dados do servidor)',
    (await itemProficiencyOf('a-longsword')) === true,
    JSON.stringify(await itemProficiencyOf('a-longsword')),
  );
  check(
    'versátil com a outra mão LIVRE usa o dado de duas mãos (1d10+3)',
    longswordAttack?.damage?.count === 1 &&
      longswordAttack?.damage?.sides === 10 &&
      longswordAttack?.damage?.type === 'Cortante' &&
      /duas mãos/.test(longswordAttack?.notes ?? ''),
    JSON.stringify(longswordAttack?.damage),
  );

  // Versátil com a outra mão ocupada volta ao dado de uma mão.
  await masterPatch(duelist.characterId, { inventory: [longsword, shield] });
  const versatilOneHand = (await weaponAttacksOf()).find(
    (attack) => attack.id === 'weapon:a-longsword',
  );
  check(
    'versátil com a outra mão OCUPADA volta ao dado de uma mão (1d8), sem bloquear',
    versatilOneHand?.damage?.sides === 8 &&
      versatilOneHand?.blocked === undefined &&
      !/duas mãos/.test(versatilOneHand?.notes ?? ''),
    JSON.stringify(versatilOneHand),
  );

  // Proficiência pela CATEGORIA ('Armas simples') numa arma simples.
  await masterPatch(duelist.characterId, { inventory: [club] });
  const clubAttack = (await weaponAttacksOf()).find((attack) => attack.id === 'weapon:a-club');
  check(
    'a proficiência pela CATEGORIA (Armas simples) soma +2 numa arma simples',
    clubAttack?.attackBonus === 5 && clubAttack?.damage?.bonus === 3,
    JSON.stringify(clubAttack),
  );
  check(
    'o popup do item traz a proficiência pela CATEGORIA (Arma simples)',
    (await itemProficiencyOf('a-club')) === true,
    JSON.stringify(await itemProficiencyOf('a-club')),
  );

  // Arma marcial sem nome nem categoria na lista: SEM proficiência.
  await masterPatch(duelist.characterId, { inventory: [greataxe] });
  const greataxeAttack = (await weaponAttacksOf()).find(
    (attack) => attack.id === 'weapon:a-greataxe',
  );
  check(
    'arma sem categoria nem nome na lista NÃO soma o bônus de proficiência',
    greataxeAttack?.attackBonus === 3 &&/sem proficiência/.test(greataxeAttack?.notes ?? ''),
    JSON.stringify(greataxeAttack),
  );
  check(
    'o popup do item mostra SEM proficiência numa arma sem nome/categoria',
    (await itemProficiencyOf('a-greataxe')) === false,
    JSON.stringify(await itemProficiencyOf('a-greataxe')),
  );

  // Proficiência pelo ID CANÔNICO via RAÇA (o Anão concede 'battleaxe' pelo
  // Treinamento de Combate Anão). A raça GRAVA os ids em `proficiencies.weapons`,
  // somando às proficiências que já estavam na ficha.
  await masterPatch(duelist.characterId, {
    raceId: 'dwarf',
    subraceId: null,
    proficiencies: { armor: [], weapons: ['Armas simples'], tools: [] },
    inventory: [battleaxe],
  });
  const dwarfSheet = await sheetOf(duelist.token);
  check(
    'a raça (Anão) GRAVA os 4 ids canônicos na ficha, sem apagar as demais proficiências',
    JSON.stringify(dwarfSheet?.proficiencies?.weapons) ===
      JSON.stringify(['Armas simples', 'battleaxe', 'handaxe', 'light-hammer', 'warhammer']),
    JSON.stringify(dwarfSheet?.proficiencies?.weapons),
  );
  const dwarfAxe = (await weaponAttacksOf()).find((attack) => attack.id === 'weapon:a-battleaxe');
  check(
    'a raça (Anão) dá proficiência pelo ID canônico da arma gravado na ficha',
    dwarfAxe?.attackBonus === 5 && /proficiente/.test(dwarfAxe?.notes ?? ''),
    JSON.stringify(dwarfAxe),
  );
  check(
    'o popup do item da raça mostra PROFICIENTE pelo ID canônico',
    (await itemProficiencyOf('a-battleaxe')) === true,
    JSON.stringify(await itemProficiencyOf('a-battleaxe')),
  );

  // Sem a raça, os ids GRAVADOS pela raça saem da ficha (aplicar/reverter) e o
  // que não veio da raça é preservado.
  await masterPatch(duelist.characterId, { raceId: null, subraceId: null });
  const noRaceSheet = await sheetOf(duelist.token);
  check(
    'trocar de raça REVERTE os ids gravados, preservando as demais proficiências',
    JSON.stringify(noRaceSheet?.proficiencies?.weapons) === JSON.stringify(['Armas simples']),
    JSON.stringify(noRaceSheet?.proficiencies?.weapons),
  );
  const noRaceAxe = (await weaponAttacksOf()).find((attack) => attack.id === 'weapon:a-battleaxe');
  check(
    'sem a raça, o ID canônico sozinho não dá proficiência',
    noRaceAxe?.attackBonus === 3 && /sem proficiência/.test(noRaceAxe?.notes ?? ''),
    JSON.stringify(noRaceAxe),
  );
  check(
    'o popup do item mostra SEM proficiência quando a raça foi revertida',
    (await itemProficiencyOf('a-battleaxe')) === false,
    JSON.stringify(await itemProficiencyOf('a-battleaxe')),
  );

  // O ataque derivado carrega a proficiência em campo próprio (`proficient`),
  // para a tabela de armas equipadas marcar sem reinterpretar o texto das notas.
  check(
    'o ataque derivado marca proficient (nome/categoria/id canônico/raça)',
    longswordAttack?.proficient === true &&
      clubAttack?.proficient === true &&
      greataxeAttack?.proficient === false &&
      dwarfAxe?.proficient === true &&
      noRaceAxe?.proficient === false,
    JSON.stringify({
      longsword: longswordAttack?.proficient,
      club: clubAttack?.proficient,
      greataxe: greataxeAttack?.proficient,
      dwarfAxe: dwarfAxe?.proficient,
      noRaceAxe: noRaceAxe?.proficient,
    }),
  );

  // Restaura as proficiências controladas para os testes seguintes.
  await masterPatch(duelist.characterId, {
    proficiencies: { armor: [], weapons: ['Armas simples', 'Espadas longas'], tools: [] },
  });

  // Acuidade: DES 18 (+4) vale mais que FOR 16 (+3).
  await masterPatch(duelist.characterId, { inventory: [rapier] });
  const rapierAttack = (await weaponAttacksOf()).find(
    (attack) => attack.id === 'weapon:a-rapier',
  );
  check(
    'acuidade usa a MELHOR habilidade (DES +4 em vez de FOR +3)',
    rapierAttack?.attackBonus === 4 &&
      rapierAttack?.damage?.bonus === 4 &&
      rapierAttack?.finesse === true,
    JSON.stringify(rapierAttack),
  );

  // Arma à distância: DES + proficiência simples.
  await masterPatch(duelist.characterId, { inventory: [shortbow] });
  const bowAttack = (await weaponAttacksOf()).find((attack) => attack.id === 'weapon:a-bow');
  check(
    'arma à distância usa DES (+4) com proficiência (+2) e é marcada como ranged',
    bowAttack?.attackBonus === 6 && bowAttack?.damage?.bonus === 4 && bowAttack?.ranged === true,
    JSON.stringify(bowAttack),
  );

  // Arremesso: variante à distância que continua usando FOR (não DES).
  await masterPatch(duelist.characterId, { inventory: [javelin] });
  const javelinAttacks = await weaponAttacksOf();
  const meleeJavelin = javelinAttacks.find((attack) => attack.id === 'weapon:a-javelin');
  const thrownJavelin = javelinAttacks.find((attack) => attack.id === 'thrown:a-javelin');
  check(
    'arma arremessável ganha a variante de arremesso (ranged) usando FOR, não DES',
    meleeJavelin?.ranged === false &&
      meleeJavelin?.attackBonus === 5 &&
      thrownJavelin?.ranged === true &&
      thrownJavelin?.attackBonus === 5,
    JSON.stringify({ meleeJavelin, thrownJavelin }),
  );

  // Duas mãos com a outra mão ocupada: listado, mas BLOQUEADO.
  await masterPatch(duelist.characterId, { inventory: [greataxe, shield] });
  const blockedGreat = (await weaponAttacksOf()).find(
    (attack) => attack.id === 'weapon:a-greataxe',
  );
  check(
    'duas mãos com a outra mão ocupada: ataque listado mas bloqueado',
    typeof blockedGreat?.blocked === 'string' && (blockedGreat?.blocked ?? '').length > 0,
    JSON.stringify(blockedGreat),
  );

  // Duas armas LEVES: ataque da mão secundária sem o modificador de dano.
  await masterPatch(duelist.characterId, { inventory: [daggerMain, daggerOff] });
  const lightPair = await weaponAttacksOf();
  const daggerMainAttack = lightPair.find((attack) => attack.id === 'weapon:a-dagger1');
  const daggerOffAttack = lightPair.find((attack) => attack.id === 'offhand:a-dagger2');
  check(
    'segunda arma leve: a mão secundária ataca com acuidade (+6) mas sem o modificador de dano (1d4)',
    daggerOffAttack?.attackBonus === 6 &&
      daggerOffAttack?.damage?.count === 1 &&
      daggerOffAttack?.damage?.sides === 4 &&
      daggerOffAttack?.damage?.bonus === 0 &&
      daggerMainAttack?.damage?.bonus === 4,
    JSON.stringify({ daggerMainAttack, daggerOffAttack }),
  );

  // Golpe desarmado: sempre disponível, 1 + FOR de concussão.
  const unarmedAttack = lightPair.find((attack) => attack.id === 'unarmed');
  check(
    'golpe desarmado sempre disponível (1 + FOR de concussão, proficiente)',
    unarmedAttack?.damage?.bonus === 4 &&
      unarmedAttack?.damage?.type === 'Concussão' &&
      unarmedAttack?.attackBonus === 5 &&
      unarmedAttack?.inventoryItemId === undefined,
    JSON.stringify(unarmedAttack),
  );

  // --- Ataque derivado dentro do COMBATE -----------------------------------
  await api('/api/combat/end', { method: 'POST', token: masterToken });
  const trainingDummy = await api('/api/creatures', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Boneco de treino ${suffix}`,
      type: 'Constructo',
      hpMax: 9999,
      armorClass: 10,
      localityIds: [locality.id],
    },
  });
  createdCreatureIds.push(trainingDummy.data.creature.id);

  const derivedCombat = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { entries: [{ creatureId: trainingDummy.data.creature.id, quantity: 1 }] },
  });
  check(
    'combate do ataque derivado iniciado (201)',
    derivedCombat.status === 201,
    JSON.stringify(derivedCombat.data),
  );
  createdCombatIds.push(derivedCombat.data.combat.id);
  for (const combatant of derivedCombat.data.combat.combatants) {
    await api(`/api/combat/initiative/${combatant.id}`, { method: 'POST', token: masterToken });
  }
  const derivedActive = (await api('/api/combat/active', { token: masterToken })).data.combat;
  const dummyCombatant = (derivedActive?.combatants ?? []).find(
    (item: any) => item.kind === 'CREATURE',
  );

  const rollUntilHit = async (
    attackId: string,
    options: { sneak?: boolean; advantage?: boolean; adjacentAlly?: boolean } = {},
  ): Promise<any> => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const shot = await api('/api/combat/attack', {
        method: 'POST',
        token: duelist.token,
        body: {
          attackId,
          targetCombatantId: dummyCombatant.id,
          ...(options.advantage ? { advantage: true } : {}),
          ...(options.adjacentAlly ? { adjacentAlly: true } : {}),
        },
      });
      if (shot.status !== 200 || !shot.data?.result?.hit) continue;
      if (options.sneak && !shot.data.result.sneakAttack) continue;
      return shot.data.result;
    }
    return null;
  };

  await masterPatch(duelist.characterId, { inventory: [longsword] });
  const derivedHit = await rollUntilHit('weapon:a-longsword');
  check(
    'o ataque derivado resolve no combate (nome, bônus e dano da arma)',
    derivedHit !== null &&
      derivedHit.attackName === 'Espada longa' &&
      derivedHit.attackBonus === 5 &&
      derivedHit.damageRolled >= 4 &&
      derivedHit.damageType === 'Cortante',
    JSON.stringify(derivedHit),
  );

  // Arma sutil derivada aciona o Ataque Furtivo do ladino quando o ataque tem
  // a condição tática (aqui, vantagem no ataque).
  await masterPatch(duelist.characterId, { inventory: [rapier] });
  const sneakHit = await rollUntilHit('weapon:a-rapier', { sneak: true, advantage: true });
  check(
    'arma sutil derivada aciona o Ataque Furtivo com vantagem',
    sneakHit !== null &&
      (sneakHit.sneakAttack?.total ?? 0) >= 1 &&
      sneakHit.sneakAttack?.reason === 'vantagem',
    JSON.stringify(sneakHit?.sneakAttack ?? null),
  );

  // Ataque da mão secundária também resolve no combate.
  await masterPatch(duelist.characterId, { inventory: [daggerMain, daggerOff] });
  const offHandHit = await rollUntilHit('offhand:a-dagger2');
  check(
    'o ataque da mão secundária também resolve no combate',
    offHandHit !== null && offHandHit.attackName === 'Adaga (mão secundária)',
    JSON.stringify(offHandHit),
  );

  // Arma de duas mãos com a outra mão ocupada: o combate recusa (400).
  await masterPatch(duelist.characterId, { inventory: [greataxe, shield] });
  const blockedShot = await api('/api/combat/attack', {
    method: 'POST',
    token: duelist.token,
    body: { attackId: 'weapon:a-greataxe', targetCombatantId: dummyCombatant.id },
  });
  check(
    'usar a arma de duas mãos bloqueada é recusado (400)',
    blockedShot.status === 400,
    JSON.stringify({ status: blockedShot.status, data: blockedShot.data }),
  );

  await api('/api/combat/end', { method: 'POST', token: masterToken });

  // --- 28. Downgrade de nível pelo mestre -----------------------------------
  console.log('\n28) Downgrade de nível pelo mestre');

  // Reaproveita a ficha das seções 20/27 (o cadastro é limitado pelo rate
  // limiter). O estado é fixado aqui para os números fecharem: ladino nível 1,
  // CON 10 (mod 0), PV 10 e histórico vazio.
  const downgradee = wallet;

  const resetDowngradee = (data: Record<string, unknown>) =>
    prisma.character.update({ where: { userId: downgradee.userId }, data: data as any });

  await resetDowngradee({
    classes: [{ classKey: 'rogue', subclass: '', level: 1 }],
    levelHistory: [],
    classState: { active: [], used: {}, choices: {} },
    features: [],
    strength: 16,
    dexterity: 18,
    constitution: 10,
    charisma: 10,
    hpMax: 10,
    hpCurrent: 10,
    lastLevelUpRelease: 0,
    proficiencies: {
      armor: ['Armaduras leves'],
      weapons: ['Armas simples', 'Espadas longas'],
      tools: ['Ferramentas de ladrão'],
    },
  });

  const levelDown = (characterId: string, body: unknown, token = masterToken) =>
    api(`/api/characters/${characterId}/level-down`, { method: 'POST', token, body });

  /** Libera o Level Up e aplica um nível, exatamente como o jogador faria. */
  const gainLevel = async (body: any): Promise<any> => {
    await api('/api/game/level-up', { method: 'POST', token: masterToken });
    return api('/api/characters/me/level-up', {
      method: 'POST',
      token: downgradee.token,
      body,
    });
  };

  // --- Caminho COM histórico: cada nível reverte o que deu ------------------
  const sheetL1 = await sheetOf(downgradee.token);
  const levelTwo = await gainLevel(levelUpRequestFor(sheetL1, 'rogue'));
  check(
    'Level Up 2 do ladino aplica a média do dado de vida (PV 10 → 15)',
    levelTwo.status === 200 &&
      levelTwo.data?.character?.classes?.[0]?.level === 2 &&
      levelTwo.data?.character?.hpMax === 15,
    JSON.stringify({ status: levelTwo.status, hp: levelTwo.data?.character?.hpMax }),
  );
  check(
    'o nível ganho entra no HISTÓRICO com o dado, o PV e o total',
    levelTwo.data?.character?.levelHistory?.length === 1 &&
      levelTwo.data?.character?.levelHistory?.[0]?.classKey === 'rogue' &&
      levelTwo.data?.character?.levelHistory?.[0]?.classLevel === 2 &&
      levelTwo.data?.character?.levelHistory?.[0]?.hp?.rolled === false &&
      levelTwo.data?.character?.levelHistory?.[0]?.hp?.total === 5,
    JSON.stringify(levelTwo.data?.character?.levelHistory),
  );

  const sheetL2 = await sheetOf(downgradee.token);
  const levelThree = await gainLevel(levelUpRequestFor(sheetL2, 'rogue'));
  const rogueSubclass: string = levelThree.data?.character?.classes?.[0]?.subclass ?? '';
  check(
    'Level Up 3 escolhe a subclasse do ladino (PV 15 → 20)',
    levelThree.status === 200 && rogueSubclass !== '' && levelThree.data?.character?.hpMax === 20,
    JSON.stringify({
      status: levelThree.status,
      subclass: rogueSubclass,
      hp: levelThree.data?.character?.hpMax,
    }),
  );

  const sheetL3 = await sheetOf(downgradee.token);
  const levelFour = await gainLevel({
    classKey: 'rogue',
    hp: 'average',
    abilityIncreases: [{ ability: 'constitution', amount: 2 }],
  });
  check(
    'Level Up 4 dá Aumento de Atributo e o PV retroativo de CON (PV 20 → 29)',
    levelFour.status === 200 &&
      levelFour.data?.character?.constitution === 12 &&
      levelFour.data?.character?.hpMax === 29,
    JSON.stringify({
      status: levelFour.status,
      con: levelFour.data?.character?.constitution,
      hp: levelFour.data?.character?.hpMax,
    }),
  );

  const downFour = await levelDown(downgradee.characterId, { classKey: 'rogue' });
  check(
    'downgrade do 4º nível devolve o PV, o Aumento de Atributo e a CON (29 → 20)',
    downFour.status === 200 &&
      downFour.data?.character?.hpMax === 20 &&
      downFour.data?.character?.hpCurrent === 20 &&
      downFour.data?.character?.constitution === 10 &&
      downFour.data?.character?.classes?.[0]?.level === 3,
    JSON.stringify({
      status: downFour.status,
      hp: downFour.data?.character?.hpMax,
      con: downFour.data?.character?.constitution,
      classes: downFour.data?.character?.classes,
    }),
  );
  check(
    'a resposta do downgrade descreve o que foi revertido (sem avisos)',
    downFour.data?.levelDown?.hpLost === 9 &&
      downFour.data?.levelDown?.classLevel === 3 &&
      downFour.data?.levelDown?.totalLevel === 3 &&
      downFour.data?.levelDown?.classRemoved === false &&
      downFour.data?.levelDown?.reverted?.abilities?.some(
        (item: any) => item.ability === 'constitution' && item.amount === 2,
      ) === true &&
      (downFour.data?.levelDown?.warnings ?? []).length === 0,
    JSON.stringify(downFour.data?.levelDown),
  );
  check(
    'o registro do nível perdido sai do histórico',
    (downFour.data?.character?.levelHistory ?? []).length === 2,
    JSON.stringify((downFour.data?.character?.levelHistory ?? []).length),
  );

  const downThree = await levelDown(downgradee.characterId, { classKey: 'rogue' });
  check(
    'downgrade do 3º nível tira a subclasse escolhida nele (PV 20 → 15)',
    downThree.status === 200 &&
      downThree.data?.character?.classes?.[0]?.level === 2 &&
      downThree.data?.character?.classes?.[0]?.subclass === '' &&
      downThree.data?.character?.hpMax === 15 &&
      downThree.data?.levelDown?.reverted?.subclass === rogueSubclass,
    JSON.stringify({
      status: downThree.status,
      classes: downThree.data?.character?.classes,
      hp: downThree.data?.character?.hpMax,
    }),
  );

  const downTwo = await levelDown(downgradee.characterId, { classKey: 'rogue' });
  check(
    'downgrade do 2º nível volta a ficha ao estado inicial (PV 10, histórico vazio)',
    downTwo.status === 200 &&
      downTwo.data?.character?.classes?.[0]?.level === 1 &&
      downTwo.data?.character?.hpMax === 10 &&
      (downTwo.data?.character?.levelHistory ?? []).length === 0,
    JSON.stringify({
      status: downTwo.status,
      hp: downTwo.data?.character?.hpMax,
      history: (downTwo.data?.character?.levelHistory ?? []).length,
    }),
  );

  const onlyClassDown = await levelDown(downgradee.characterId, { classKey: 'rogue' });
  check(
    'reduzir a ÚNICA classe do personagem é recusado (400)',
    onlyClassDown.status === 400,
    JSON.stringify({ status: onlyClassDown.status, data: onlyClassDown.data }),
  );

  // --- Nível 1 caindo para 0: a classe SAI da ficha ------------------------
  await masterPatch(downgradee.characterId, { charisma: 14 });
  const bardSheet = await sheetOf(downgradee.token);
  const bardRequest = levelUpRequestFor(bardSheet, 'bard');
  bardRequest.skillChoice = 'performance';
  const bardLevelUp = await gainLevel(bardRequest);
  check(
    'entrar no Bardo por multiclasse concede a perícia e as proficiências da tabela reduzida',
    bardLevelUp.status === 200 &&
      bardLevelUp.data?.character?.skills?.performance?.proficient === true &&
      bardLevelUp.data?.character?.proficiencies?.tools?.includes(
        '1 instrumento musical à sua escolha',
      ) === true,
    JSON.stringify({
      status: bardLevelUp.status,
      skill: bardLevelUp.data?.character?.skills?.performance,
      proficiencies: bardLevelUp.data?.character?.proficiencies,
    }),
  );

  const bardDown = await levelDown(downgradee.characterId, { classKey: 'bard' });
  const afterBardDown = bardDown.data?.character;
  check(
    'downgrade do nível 1 do Bardo REMOVE a classe da ficha',
    bardDown.status === 200 &&
      afterBardDown?.classes?.length === 1 &&
      afterBardDown?.classes?.[0]?.classKey === 'rogue' &&
      bardDown.data?.levelDown?.classRemoved === true,
    JSON.stringify({ status: bardDown.status, classes: afterBardDown?.classes }),
  );
  check(
    'a perícia e a proficiência que só o Bardo dava saem da ficha',
    afterBardDown?.skills?.performance?.proficient === false &&
      afterBardDown?.proficiencies?.tools?.includes('1 instrumento musical à sua escolha') === false,
    JSON.stringify({
      skill: afterBardDown?.skills?.performance,
      tools: afterBardDown?.proficiencies?.tools,
    }),
  );
  check(
    'a proficiência COMPARTILHADA (Armaduras leves) fica — o ladino também a concede',
    afterBardDown?.proficiencies?.armor?.includes('Armaduras leves') === true,
    JSON.stringify(afterBardDown?.proficiencies),
  );

  // --- Níveis ANTERIORES ao histórico: estimativa + avisos -----------------
  await setCharacterClasses(downgradee.userId, [
    { classKey: 'rogue', level: 1 },
    { classKey: 'wizard', level: 3 },
  ]);
  const legacySheet = await sheetOf(downgradee.token);
  const legacyDown = await levelDown(downgradee.characterId, { classKey: 'wizard' });
  check(
    'nível sem histórico: volta 200 com AVISOS e o PV estimado pela média (d6 = 4)',
    legacyDown.status === 200 &&
      legacyDown.data?.character?.classes?.[1]?.level === 2 &&
      legacyDown.data?.character?.hpMax === (legacySheet?.hpMax ?? 0) - 4 &&
      (legacyDown.data?.levelDown?.warnings ?? []).length > 0,
    JSON.stringify({
      status: legacyDown.status,
      hp: legacyDown.data?.character?.hpMax,
      antes: legacySheet?.hpMax,
      warnings: legacyDown.data?.levelDown?.warnings,
    }),
  );

  const manualDown = await levelDown(downgradee.characterId, {
    classKey: 'wizard',
    abilityDecreases: [{ ability: 'intelligence', amount: 1 }],
  });
  check(
    'nos níveis sem histórico o mestre desfaz o Aumento de Atributo à mão',
    manualDown.status === 200 &&
      manualDown.data?.character?.intelligence === (legacySheet?.intelligence ?? 0) - 1 &&
      manualDown.data?.levelDown?.reverted?.abilities?.[0]?.ability === 'intelligence',
    JSON.stringify({
      status: manualDown.status,
      intelligence: manualDown.data?.character?.intelligence,
      reverted: manualDown.data?.levelDown?.reverted?.abilities,
    }),
  );

  const playerDown = await levelDown(
    downgradee.characterId,
    { classKey: 'wizard' },
    downgradee.token,
  );
  check(
    'o jogador NÃO reduz o próprio nível (403)',
    playerDown.status === 403,
    JSON.stringify({ status: playerDown.status, data: playerDown.data }),
  );

  const unknownClassDown = await levelDown(downgradee.characterId, { classKey: 'druid' });
  check(
    'classe que o personagem não tem é recusada (400)',
    unknownClassDown.status === 400,
    JSON.stringify({ status: unknownClassDown.status, data: unknownClassDown.data }),
  );

  const emptyDown = await levelDown(downgradee.characterId, {});
  check(
    'corpo sem a classe é VALIDATION_ERROR (400)',
    emptyDown.status === 400 && emptyDown.data?.error === 'VALIDATION_ERROR',
    JSON.stringify({ status: emptyDown.status, data: emptyDown.data }),
  );

  // --- 29. Vários tipos de dano por ataque e por arma -----------------------
  console.log('\n29) Vários tipos de dano por ataque e por arma');

  // Cada dano é INDEPENDENTE: o principal fica em `damage` e os demais vão em
  // `extraDamages`, cada um com os seus dados e o seu tipo. A ficha, as
  // criaturas e as armas do catálogo usam a MESMA lista, e o combate rola
  // TODAS as parcelas aplicando a defesa do alvo por tipo.
  const multiSheetOwner = downgradee;

  const multiWeapon = await api('/api/items', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Lâmina flamejante ${suffix}`,
      category: 'Arma',
      weight: 2,
      details: {
        damageCount: 1,
        damageDie: 8,
        damageType: 'Cortante',
        attackBonus: 0,
        damageBonus: 0,
        weaponType: 'melee',
        weaponCategory: 'martial',
        properties: [],
        extraDamages: [{ count: 1, sides: 6, bonus: 0, type: 'Fogo' }],
      },
    },
  });
  check(
    'a arma do catálogo guarda o dano ADICIONAL (1d6 de Fogo junto do Cortante)',
    multiWeapon.status === 201 &&
      multiWeapon.data?.item?.details?.extraDamages?.length === 1 &&
      multiWeapon.data.item.details.extraDamages[0].type === 'Fogo' &&
      multiWeapon.data.item.details.extraDamages[0].sides === 6 &&
      multiWeapon.data.item.details.damageType === 'Cortante',
    JSON.stringify(multiWeapon.data?.item?.details),
  );
  const multiWeaponId = multiWeapon.data?.item?.id;
  createdItemIds.push(multiWeaponId);

  await api(`/api/items/${multiWeaponId}/send`, {
    method: 'POST',
    token: masterToken,
    body: { characterId: multiSheetOwner.characterId, quantity: 1 },
  });
  const multiSheet = await sheetOf(multiSheetOwner.token);
  const multiEntry = multiSheet?.inventory?.find((item: any) => item.itemId === multiWeaponId);
  check(
    'o item enviado leva o dano adicional para o inventário do jogador',
    multiEntry?.details?.extraDamages?.length === 1 &&
      multiEntry?.details?.extraDamages?.[0]?.type === 'Fogo',
    JSON.stringify(multiEntry?.details),
  );

  // Equipa a arma: o ataque DERIVADO dela carrega o principal e os extras.
  await masterPatch(multiSheetOwner.characterId, {
    inventory: [
      {
        id: 'multi-blade',
        name: multiEntry?.name ?? 'Lâmina flamejante',
        description: '',
        quantity: 1,
        weight: 2,
        slot: 'hand1',
        backpackX: null,
        backpackY: null,
        imageUrl: '',
        itemId: multiWeaponId,
        category: 'Arma',
        details: multiEntry?.details ?? {},
      },
    ],
  });
  const equippedBladeSheet = await sheetOf(multiSheetOwner.token);
  const bladeAttack = (equippedBladeSheet?.derivedAttacks ?? []).find(
    (attack: any) => attack.id === 'weapon:multi-blade',
  );
  check(
    'o ataque derivado da arma equipada traz o dano principal e os adicionais',
    bladeAttack?.damage?.type === 'Cortante' &&
      bladeAttack?.damage?.sides === 8 &&
      bladeAttack?.extraDamages?.length === 1 &&
      bladeAttack?.extraDamages?.[0]?.type === 'Fogo' &&
      bladeAttack?.extraDamages?.[0]?.sides === 6,
    JSON.stringify(bladeAttack),
  );

  // Ataque da FICHA com três danos: dois rolados e um FIXO (dano de morte 5).
  const multiAttackSaved = await masterPatch(multiSheetOwner.characterId, {
    attacks: [
      {
        id: 'multi',
        name: 'Lâmina flamejante',
        damage: { count: 1, sides: 8, bonus: 3, type: 'Cortante' },
        extraDamages: [
          { count: 1, sides: 6, bonus: 0, type: 'Fogo' },
          { count: 0, sides: 0, bonus: 5, type: 'Necrótico' },
        ],
        attackBonus: 5,
        notes: '',
        finesse: false,
        ranged: false,
      },
    ],
  });
  const multiAttack = multiAttackSaved.data?.character?.attacks?.find(
    (attack: any) => attack.id === 'multi',
  );
  check(
    'a ficha grava o ataque com três danos independentes (dois rolados e um fixo)',
    multiAttackSaved.status === 200 &&
      multiAttack?.damage?.type === 'Cortante' &&
      multiAttack?.extraDamages?.length === 2 &&
      multiAttack?.extraDamages?.[0]?.type === 'Fogo' &&
      multiAttack?.extraDamages?.[1]?.type === 'Necrótico' &&
      multiAttack?.extraDamages?.[1]?.bonus === 5 &&
      multiAttack?.extraDamages?.[1]?.count === 0,
    JSON.stringify(multiAttack),
  );

  // Repetir o tipo é permitido: dois danos de Fogo, calculados um por um.
  const repeatedType = await masterPatch(multiSheetOwner.characterId, {
    attacks: [
      {
        id: 'multi',
        name: 'Lâmina flamejante',
        damage: { count: 1, sides: 8, bonus: 3, type: 'Cortante' },
        extraDamages: [
          { count: 1, sides: 6, bonus: 0, type: 'Fogo' },
          { count: 1, sides: 4, bonus: 0, type: 'Fogo' },
        ],
        attackBonus: 5,
        notes: '',
        finesse: false,
        ranged: false,
      },
    ],
  });
  check(
    'o mesmo tipo de dano pode se repetir (não fica bloqueado)',
    repeatedType.status === 200 &&
      repeatedType.data?.character?.attacks?.[0]?.extraDamages?.length === 2 &&
      repeatedType.data.character.attacks[0].extraDamages.every(
        (damage: any) => damage.type === 'Fogo',
      ),
    JSON.stringify(repeatedType.data?.character?.attacks?.[0]?.extraDamages),
  );

  const tooManyDamages = await masterPatch(multiSheetOwner.characterId, {
    attacks: [
      {
        id: 'multi',
        name: 'Exagerado',
        damage: { count: 1, sides: 6, bonus: 0, type: null },
        extraDamages: Array.from({ length: 11 }, () => ({
          count: 1,
          sides: 6,
          bonus: 0,
          type: 'Fogo',
        })),
        attackBonus: 0,
        notes: '',
        finesse: false,
        ranged: false,
      },
    ],
  });
  check(
    'passar do teto de danos adicionais é recusado (400)',
    tooManyDamages.status === 400,
    JSON.stringify({ status: tooManyDamages.status, data: tooManyDamages.data }),
  );

  // Criatura (bestiário): mesmo formato de ataque, também com vários danos.
  const multiCreature = await api('/api/creatures', {
    method: 'POST',
    token: masterToken,
    body: {
      name: `Elemental duplo ${suffix}`,
      type: 'Elemental',
      hpMax: 60,
      armorClass: 12,
      localityIds: [locality.id],
    },
  });
  createdCreatureIds.push(multiCreature.data.creature.id);
  const creaturePatch = await api(`/api/creatures/${multiCreature.data.creature.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: {
      attacks: [
        {
          id: 'claw',
          name: 'Garra',
          damage: { count: 1, sides: 6, bonus: 2, type: 'Cortante' },
          extraDamages: [{ count: 1, sides: 4, bonus: 0, type: 'Ácido' }],
          attackBonus: 4,
          notes: '',
        },
      ],
    },
  });
  const creatureAttack = creaturePatch.data?.creature?.attacks?.find(
    (attack: any) => attack.id === 'claw',
  );
  check(
    'a criatura do bestiário também guarda vários tipos de dano (Cortante + Ácido)',
    creaturePatch.status === 200 &&
      creatureAttack?.damage?.type === 'Cortante' &&
      creatureAttack?.extraDamages?.length === 1 &&
      creatureAttack?.extraDamages?.[0]?.type === 'Ácido',
    JSON.stringify(creatureAttack),
  );

  // Defesas do alvo por tipo — resistência (½), imunidade (0) e vulnerabilidade
  // (×2) são aplicadas POR PARCELA, cada uma pelo seu próprio tipo.
  const defensesPatch = await api(`/api/creatures/${multiCreature.data.creature.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: { resistances: ['Cortante'], immunities: ['Ácido'], vulnerabilities: ['Fogo'] },
  });
  check(
    'a criatura guarda vulnerabilidades por tipo (×2)',
    defensesPatch.status === 200 &&
      defensesPatch.data?.creature?.vulnerabilities?.join(',') === 'Fogo',
    JSON.stringify(defensesPatch.data?.creature),
  );

  // O combate rola TODAS as parcelas (principal + extras). A arma do jogador é
  // Cortante + Fogo, então o Cortante é resistido (½) e o Fogo é vulnerável (×2).
  const multiCombat = await api('/api/combat', {
    method: 'POST',
    token: masterToken,
    body: { entries: [{ creatureId: multiCreature.data.creature.id, quantity: 1 }] },
  });
  createdCombatIds.push(multiCombat.data.combat.id);
  for (const combatant of multiCombat.data.combat.combatants) {
    await api(`/api/combat/initiative/${combatant.id}`, { method: 'POST', token: masterToken });
  }
  const multiActive = (await api('/api/combat/active', { token: masterToken })).data.combat;
  const multiTarget = (multiActive?.combatants ?? []).find(
    (item: any) => item.kind === 'CREATURE',
  );

  const attackMulti = async (): Promise<any> => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const shot = await api('/api/combat/attack', {
        method: 'POST',
        token: multiSheetOwner.token,
        body: { attackId: 'weapon:multi-blade', targetCombatantId: multiTarget.id },
      });
      if (shot.status === 200 && shot.data?.result?.hit) return shot.data.result;
    }
    return null;
  };
  const component = (result: any, type: string): any =>
    (result?.components ?? []).find((item: any) => item.type === type);

  const multiHit = await attackMulti();
  const multiCortante = component(multiHit, 'Cortante');
  const multiFogo = component(multiHit, 'Fogo');
  check(
    'o combate rola TODAS as parcelas e aplica a defesa POR TIPO (resistência ½ e vulnerabilidade ×2)',
    multiHit !== null &&
      (multiHit.components ?? []).length === 2 &&
      multiCortante?.modifier === 'resistance' &&
      multiCortante?.applied === Math.floor(multiCortante.rolled / 2) &&
      multiFogo?.modifier === 'vulnerability' &&
      multiFogo?.applied === multiFogo.rolled * 2 &&
      multiHit.damageRolled ===
        (multiHit.components ?? []).reduce((sum: number, item: any) => sum + item.applied, 0),
    JSON.stringify(multiHit),
  );

  // Imunidade: agora o Fogo é IMUNE — a parcela é ZERADA, mas o Cortante (sem
  // defesa) entra inteiro; o dano total ignora a parcela imune.
  await api(`/api/creatures/${multiCreature.data.creature.id}`, {
    method: 'PATCH',
    token: masterToken,
    body: { resistances: [], immunities: ['Fogo'], vulnerabilities: [] },
  });
  const immuneHit = await attackMulti();
  const immuneFogo = component(immuneHit, 'Fogo');
  const immuneCortante = component(immuneHit, 'Cortante');
  check(
    'a imunidade ZERA só a parcela do tipo imune (o Cortante entra inteiro)',
    immuneHit !== null &&
      immuneFogo?.modifier === 'immunity' &&
      immuneFogo?.applied === 0 &&
      immuneCortante?.modifier === null &&
      immuneCortante?.applied === immuneCortante.rolled &&
      immuneHit.damageRolled === immuneCortante.rolled,
    JSON.stringify(immuneHit),
  );

  await api('/api/combat/end', { method: 'POST', token: masterToken });

  // 30) Proficiências simples em ferramenta (catálogo do PHB 2014)
  {
    console.log('\n30) Proficiências simples em ferramenta');
    const toolSheet = await masterPatch(multiSheetOwner.characterId, {
      toolProficiencies: ['thieves-tools', 'lute', 'bagpipes'],
    });
    check(
      'o mestre grava toolProficiencies com ids do catálogo (200)',
      toolSheet.status === 200 &&
        JSON.stringify(toolSheet.data?.character?.toolProficiencies) ===
          JSON.stringify(['thieves-tools', 'lute', 'bagpipes']),
      JSON.stringify(toolSheet.data?.character?.toolProficiencies),
    );

    // A ficha recebe as ferramentas JÁ RESOLVIDAS pelo catálogo (nome, categoria
    // e atributo sugerido) para o bloco "Ferramentas e Proficiências".
    const resolvedTools: any[] = toolSheet.data?.character?.tools ?? [];
    const thieves = resolvedTools.find((tool) => tool.id === 'thieves-tools');
    check(
      'a ficha resolve as ferramentas pelo catálogo (nome e categoria)',
      resolvedTools.length === 3 &&
        thieves?.name === 'Ferramentas de Ladrão' &&
        thieves?.category === 'thieves' &&
        thieves?.categoryLabel === 'Ferramentas de Ladrão',
      JSON.stringify(resolvedTools),
    );
    const lute = resolvedTools.find((tool) => tool.id === 'lute');
    check(
      'a ferramenta traz o atributo sugerido do catálogo (Alaúde → Carisma)',
      lute?.defaultAbility === 'charisma' && lute?.categoryLabel === 'Instrumento Musical',
      JSON.stringify(lute),
    );

    const badTool = await masterPatch(multiSheetOwner.characterId, {
      toolProficiencies: ['ferramenta-inexistente'],
    });
    check(
      'id de ferramenta fora do catálogo é recusado (400)',
      badTool.status === 400,
      JSON.stringify(badTool.data),
    );
  }

  // 31) Raridade e sintonização dos itens do catálogo
  {
    console.log('\n31) Raridade e sintonização dos itens');

    const rarityItem = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Anel da Sombra ${suffix}`,
        category: 'Anel',
        weight: 0,
        rarity: 'rare',
        requiresAttunement: true,
        details: { effectRoll: '1d6' },
      },
    });
    const rarityId = rarityItem.data?.item?.id;
    if (rarityId) createdItemIds.push(rarityId);
    check(
      'item guarda a raridade interna (rare) e a sintonização (true)',
      rarityItem.status === 201 &&
        rarityItem.data?.item?.rarity === 'rare' &&
        rarityItem.data?.item?.requiresAttunement === true,
      JSON.stringify(rarityItem.data?.item),
    );

    const plainItem = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: { name: `Corda simples ${suffix}`, category: 'Item Geral' },
    });
    if (plainItem.data?.item?.id) createdItemIds.push(plainItem.data.item.id);
    check(
      'item criado sem raridade nasce com rarity null e requiresAttunement false',
      plainItem.status === 201 &&
        plainItem.data?.item?.rarity === null &&
        plainItem.data?.item?.requiresAttunement === false,
      JSON.stringify(plainItem.data?.item),
    );

    const badRarity = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: { name: `Item inválido ${suffix}`, rarity: 'mitico' },
    });
    check(
      'raridade fora da lista é recusada (400)',
      badRarity.status === 400,
      JSON.stringify(badRarity.data),
    );

    const patchedRarity = await api(`/api/items/${rarityId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { rarity: 'legendary', requiresAttunement: false },
    });
    check(
      'editar atualiza raridade e sintonização independentemente (200)',
      patchedRarity.status === 200 &&
        patchedRarity.data?.item?.rarity === 'legendary' &&
        patchedRarity.data?.item?.requiresAttunement === false,
      JSON.stringify(patchedRarity.data?.item),
    );

    // O inventário do jogador espelha o catálogo: os dois campos descem juntos.
    await api(`/api/items/${rarityId}/send`, {
      method: 'POST',
      token: masterToken,
      body: { characterId: multiSheetOwner.characterId, quantity: 1 },
    });
    const invSheet = await sheetOf(multiSheetOwner.token);
    const invEntry = invSheet?.inventory?.find((entry: any) => entry.itemId === rarityId);
    check(
      'raridade e sintonização chegam ao inventário do jogador (espelho do catálogo)',
      invEntry?.rarity === 'legendary' && invEntry?.requiresAttunement === false,
      JSON.stringify(invEntry),
    );
  }

  // 32) Categoria da Poção (finalidade) no catálogo do mestre
  {
    console.log('\n32) Categoria da poção');

    const potionItem = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção de cura ${suffix}`,
        category: 'Poção',
        details: { effectRoll: '2d4+2', duration: 'instantânea', potionCategory: 'healing' },
      },
    });
    const potionId = potionItem.data?.item?.id;
    if (potionId) createdItemIds.push(potionId);
    check(
      'poção guarda a categoria (healing) e mantém os demais atributos',
      potionItem.status === 201 &&
        potionItem.data?.item?.details?.potionCategory === 'healing' &&
        potionItem.data?.item?.details?.effectRoll === '2d4+2' &&
        potionItem.data?.item?.details?.duration === 'instantânea',
      JSON.stringify(potionItem.data?.item?.details),
    );

    const badPotion = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção inválida ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'inexistente' },
      },
    });
    check(
      'categoria da poção fora da lista é recusada (400)',
      badPotion.status === 400,
      JSON.stringify(badPotion.data),
    );

    const wrongCategory = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Anel com categoria de poção ${suffix}`,
        category: 'Anel',
        details: { effectRoll: '1d6', potionCategory: 'healing' },
      },
    });
    if (wrongCategory.data?.item?.id) createdItemIds.push(wrongCategory.data.item.id);
    check(
      'item de outra categoria NÃO recebe potionCategory (sanitize descarta)',
      wrongCategory.status === 201 &&
        wrongCategory.data?.item?.details?.potionCategory === undefined,
      JSON.stringify(wrongCategory.data?.item?.details),
    );

    const patchedPotion = await api(`/api/items/${potionId}`, {
      method: 'PATCH',
      token: masterToken,
      body: {
        details: { effectRoll: '2d4+2', duration: 'instantânea', potionCategory: 'protection' },
      },
    });
    check(
      'editar a poção atualiza a categoria mantendo os outros atributos (200)',
      patchedPotion.status === 200 &&
        patchedPotion.data?.item?.details?.potionCategory === 'protection' &&
        patchedPotion.data?.item?.details?.effectRoll === '2d4+2',
      JSON.stringify(patchedPotion.data?.item?.details),
    );
  }

  // 33) Poção de Cura automatizada (healingDice) e uso com cura na ficha
  {
    console.log('\n33) Poção de Cura: cura estruturada e uso automático');

    const healingItem = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção de cura maior ${suffix}`,
        category: 'Poção',
        details: {
          potionCategory: 'healing',
          duration: 'instantânea',
          healingDice: { count: 2, sides: 8, bonus: 3 },
        },
      },
    });
    const healingId = healingItem.data?.item?.id;
    if (healingId) createdItemIds.push(healingId);
    check(
      'poção de Cura guarda a cura estruturada (2d8+3)',
      healingItem.status === 201 &&
        healingItem.data?.item?.details?.healingDice?.count === 2 &&
        healingItem.data?.item?.details?.healingDice?.sides === 8 &&
        healingItem.data?.item?.details?.healingDice?.bonus === 3,
      JSON.stringify(healingItem.data?.item?.details),
    );

    // healingDice só existe quando potionCategory é 'healing'.
    const poisonPotion = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção venenosa ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'poison', healingDice: { count: 2, sides: 8, bonus: 3 } },
      },
    });
    if (poisonPotion.data?.item?.id) createdItemIds.push(poisonPotion.data.item.id);
    check(
      'poção que NÃO é de Cura NÃO guarda healingDice (sanitize descarta)',
      poisonPotion.status === 201 && poisonPotion.data?.item?.details?.healingDice === undefined,
      JSON.stringify(poisonPotion.data?.item?.details),
    );

    const badCount = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção inválida A ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'healing', healingDice: { count: 0, sides: 8, bonus: 0 } },
      },
    });
    check('quantidade de dados fora de 1..10 é recusada (400)', badCount.status === 400);

    const badSides = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção inválida B ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'healing', healingDice: { count: 1, sides: 7, bonus: 0 } },
      },
    });
    check('dado de cura fora de d4/d6/d8/d10/d12 é recusado (400)', badSides.status === 400);

    const badBonus = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção inválida C ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'healing', healingDice: { count: 1, sides: 8, bonus: 21 } },
      },
    });
    check('bônus de cura fora de 0..20 é recusado (400)', badBonus.status === 400);

    // Envia a poção ao jogador e prepara uma ficha ferida (PV 1 de 50).
    await api(`/api/items/${healingId}/send`, {
      method: 'POST',
      token: masterToken,
      body: { characterId: multiSheetOwner.characterId, quantity: 1 },
    });
    const stockedHeal = await masterPatch(multiSheetOwner.characterId, { hpMax: 50, hpCurrent: 1 });
    const healEntry = stockedHeal.data?.character?.inventory?.find(
      (entry: any) => entry.itemId === healingId,
    );

    const healUse = await api('/api/characters/me/inventory/use', {
      method: 'POST',
      token: multiSheetOwner.token,
      body: { itemInventoryId: healEntry?.id },
    });
    const healRoll = healUse.data?.roll;
    check(
      'usar a poção de Cura rola kind item rotulado como Cura e aplica o total no HP',
      healUse.status === 200 &&
        healRoll?.kind === 'item' &&
        healRoll?.label === `Cura (Poção de cura maior ${suffix})` &&
        healRoll?.dice?.length === 2 &&
        healRoll?.dice?.every((die: any) => die.sides === 8) &&
        healRoll?.bonus === 3 &&
        healUse.data?.character?.hpCurrent === Math.min(50, 1 + healRoll.total),
      JSON.stringify({ roll: healRoll, hpCurrent: healUse.data?.character?.hpCurrent }),
    );

    // Cura não passa do máximo: ficha cheia + cura grande continua no hpMax.
    const capItem = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção de cura plena ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'healing', healingDice: { count: 10, sides: 12, bonus: 20 } },
      },
    });
    const capId = capItem.data?.item?.id;
    if (capId) createdItemIds.push(capId);
    await api(`/api/items/${capId}/send`, {
      method: 'POST',
      token: masterToken,
      body: { characterId: multiSheetOwner.characterId, quantity: 1 },
    });
    const stockedCap = await masterPatch(multiSheetOwner.characterId, { hpMax: 50, hpCurrent: 50 });
    const capEntry = stockedCap.data?.character?.inventory?.find(
      (entry: any) => entry.itemId === capId,
    );
    const capUse = await api('/api/characters/me/inventory/use', {
      method: 'POST',
      token: multiSheetOwner.token,
      body: { itemInventoryId: capEntry?.id },
    });
    check(
      'a cura nunca ultrapassa o PV máximo (hpCurrent = min(hpMax, ...))',
      capUse.status === 200 && capUse.data?.character?.hpCurrent === 50,
      JSON.stringify({ hpCurrent: capUse.data?.character?.hpCurrent, roll: capUse.data?.roll?.total }),
    );

    // Caso legado: poção de Cura SEM healingDice rola effectRoll e não cura.
    const legacyItem = await api('/api/items', {
      method: 'POST',
      token: masterToken,
      body: {
        name: `Poção de cura antiga ${suffix}`,
        category: 'Poção',
        details: { potionCategory: 'healing', effectRoll: '1d4+1' },
      },
    });
    const legacyId = legacyItem.data?.item?.id;
    if (legacyId) createdItemIds.push(legacyId);
    await api(`/api/items/${legacyId}/send`, {
      method: 'POST',
      token: masterToken,
      body: { characterId: multiSheetOwner.characterId, quantity: 1 },
    });
    const stockedLegacy = await masterPatch(multiSheetOwner.characterId, {
      hpMax: 50,
      hpCurrent: 10,
    });
    const legacyEntry = stockedLegacy.data?.character?.inventory?.find(
      (entry: any) => entry.itemId === legacyId,
    );
    const legacyUse = await api('/api/characters/me/inventory/use', {
      method: 'POST',
      token: multiSheetOwner.token,
      body: { itemInventoryId: legacyEntry?.id },
    });
    check(
      'poção de Cura sem healingDice mantém o comportamento antigo (rola, não aplica)',
      legacyUse.status === 200 &&
        legacyUse.data?.roll?.label === `Item: Poção de cura antiga ${suffix}` &&
        legacyUse.data?.character?.hpCurrent === 10,
      JSON.stringify({ roll: legacyUse.data?.roll, hp: legacyUse.data?.character?.hpCurrent }),
    );
  }

  }

  // 34) Catálogo estruturado de raças: Draconato (Prompt 2.1)
  {
    console.log('\n34) Catálogo estruturado de raças: Draconato');

    const race = getRace('dragonborn');
    check(
      'getRace("dragonborn") devolve a raça e ela está em allRaces()',
      !!race && allRaces().some((r) => r.id === 'dragonborn'),
      JSON.stringify(allRaces().map((r) => r.id)),
    );
    check('nome em PT é Draconato', race?.namePt === 'Draconato', race?.namePt);

    const bonuses = race?.abilityScoreIncrease ?? [];
    check(
      'bônus de atributo: Força +2 e Carisma +1',
      bonuses.length === 2 &&
        bonuses.some((b) => b.ability === 'strength' && b.amount === 2) &&
        bonuses.some((b) => b.ability === 'charisma' && b.amount === 1),
      JSON.stringify(bonuses),
    );
    check('deslocamento 9 m (30 pés)', race?.speed === 9, String(race?.speed));
    check(
      'idiomas: Comum e Dracônico',
      JSON.stringify(race?.languages) === JSON.stringify(['Comum', 'Dracônico']),
      JSON.stringify(race?.languages),
    );

    // Três traços: ancestralidade (descritiva), sopro (recurso) e resistência.
    const traits = race?.traits ?? [];
    check('tem 3 traços', traits.length === 3, JSON.stringify(traits.map((t) => t.id)));
    check(
      'o traço de ancestralidade é descritivo (sem efeito mecânico)',
      !!traits.find((t) => t.id === 'draconic-ancestry')?.description &&
        traits.find((t) => t.id === 'draconic-ancestry')?.mechanicalEffect === undefined,
    );

    const breath = traits.find((t) => t.id === 'breath-weapon')?.mechanicalEffect;
    check(
      'Arma de Sopro é um recurso (1 uso, recarrega no descanso curto)',
      breath?.type === 'resource' && breath?.resource?.recharge === 'short' && breath?.resource?.max === 1,
      JSON.stringify(breath),
    );

    const resist = traits.find((t) => t.id === 'damage-resistance')?.mechanicalEffect;
    check(
      'Resistência a Dano usa resistanceFromChoice apontando para draconic-ancestry',
      resist?.type === 'resistanceFromChoice' && resist?.choiceId === 'draconic-ancestry',
      JSON.stringify(resist),
    );

    // Sem sub-raças.
    check('não tem sub-raças', race?.subraces === undefined, JSON.stringify(race?.subraces));

    // A escolha de ancestralidade: 10 opções com o tipo de dano correto.
    const ancestry = race?.hasChoices?.find((c) => c.id === 'draconic-ancestry');
    check('existe a escolha draconic-ancestry', !!ancestry, JSON.stringify(race?.hasChoices?.map((c) => c.id)));
    check('a ancestralidade tem 10 opções', ancestry?.options.length === 10, String(ancestry?.options.length));

    const expectedDamage: Record<string, string> = {
      black: 'Ácido',
      blue: 'Elétrico',
      brass: 'Fogo',
      bronze: 'Elétrico',
      copper: 'Ácido',
      gold: 'Fogo',
      green: 'Veneno',
      red: 'Fogo',
      silver: 'Frio',
      white: 'Frio',
    };
    const damageOk = (ancestry?.options ?? []).every(
      (o) => expectedDamage[o.id] === o.damageType,
    );
    check(
      'cada uma das 10 cores mapeia para o tipo de dano canônico correto',
      damageOk,
      JSON.stringify(ancestry?.options),
    );
  }

  // 35) Catálogo estruturado de raças: Elfo e sub-raças (Prompt 2.2)
  {
    console.log('\n35) Catálogo estruturado de raças: Elfo');

    const elf = getRace('elf');
    check(
      'getRace("elf") devolve a raça e ela está em allRaces()',
      !!elf && allRaces().some((r) => r.id === 'elf'),
      JSON.stringify(allRaces().map((r) => r.id)),
    );
    check('nome em PT é Elfo', elf?.namePt === 'Elfo', elf?.namePt);
    check(
      'bônus de atributo: Destreza +2',
      elf?.abilityScoreIncrease.length === 1 &&
        elf?.abilityScoreIncrease[0]?.ability === 'dexterity' &&
        elf?.abilityScoreIncrease[0]?.amount === 2,
      JSON.stringify(elf?.abilityScoreIncrease),
    );
    check('deslocamento 9 m (30 pés)', elf?.speed === 9, String(elf?.speed));
    check('visão no escuro 18 m (60 pés)', elf?.darkvision === 18, String(elf?.darkvision));
    check(
      'idiomas: Comum e Élfico',
      JSON.stringify(elf?.languages) === JSON.stringify(['Comum', 'Élfico']),
      JSON.stringify(elf?.languages),
    );

    // Traços da raça base: Sentidos Aguçados (perícia), Feérica ('other') e Transe.
    const baseTraits = elf?.traits ?? [];
    check('a raça base tem 3 traços', baseTraits.length === 3, JSON.stringify(baseTraits.map((t) => t.id)));
    const keen = baseTraits.find((t) => t.id === 'keen-senses')?.mechanicalEffect;
    check(
      'Sentidos Aguçados concede Percepção (skillProficiency → perception)',
      keen?.type === 'skillProficiency' && keen?.target === 'perception',
      JSON.stringify(keen),
    );
    const fey = baseTraits.find((t) => t.id === 'fey-ancestry')?.mechanicalEffect;
    check(
      'Ancestralidade Feérica vai como other (vantagem/imunidade não modeladas)',
      fey?.type === 'other',
      JSON.stringify(fey),
    );
    check(
      'Transe é textual (sem efeito mecânico)',
      baseTraits.find((t) => t.id === 'trance')?.mechanicalEffect === undefined,
    );

    // Sub-raças: Alto Elfo, Elfo da Floresta e Drow.
    const subIds = (elf?.subraces ?? []).map((s) => s.id);
    check(
      'tem 3 sub-raças (high-elf, wood-elf, drow-elf)',
      JSON.stringify(subIds) === JSON.stringify(['high-elf', 'wood-elf', 'drow-elf']),
      JSON.stringify(subIds),
    );
    check(
      'getSubrace("elf", "wood-elf") funciona',
      getSubrace('elf', 'wood-elf')?.namePt === 'Elfo da Floresta',
      getSubrace('elf', 'wood-elf')?.namePt,
    );

    const high = elf?.subraces?.find((s) => s.id === 'high-elf');
    check(
      'Alto Elfo: Inteligência +1, arma élfica e o truque',
      high?.abilityScoreIncrease[0]?.ability === 'intelligence' &&
        high?.abilityScoreIncrease[0]?.amount === 1 &&
        high?.traits.some((t) => t.id === 'elven-weapon-training') &&
        high?.traits.some((t) => t.id === 'high-elf-cantrip'),
      JSON.stringify(high?.traits.map((t) => t.id)),
    );

    const wood = elf?.subraces?.find((s) => s.id === 'wood-elf');
    check(
      'Elfo da Floresta: Sabedoria +1 e Passo Ligeiro (10,5 m)',
      wood?.abilityScoreIncrease[0]?.ability === 'wisdom' &&
        wood?.abilityScoreIncrease[0]?.amount === 1 &&
        wood?.speed === 10.5 &&
        wood?.traits.some((t) => t.id === 'fleet-of-foot'),
      JSON.stringify({ asi: wood?.abilityScoreIncrease, speed: wood?.speed }),
    );

    const drow = elf?.subraces?.find((s) => s.id === 'drow-elf');
    check(
      'Drow: Carisma +1, visão no escuro 36 m e Magia Drow',
      drow?.abilityScoreIncrease[0]?.ability === 'charisma' &&
        drow?.abilityScoreIncrease[0]?.amount === 1 &&
        drow?.darkvision === 36 &&
        drow?.traits.some((t) => t.id === 'drow-magic'),
      JSON.stringify({ asi: drow?.abilityScoreIncrease, dv: drow?.darkvision }),
    );
  }

  // 36) Catálogo estruturado de raças: Anão + Robustez Anã (Prompt 2.5)
  {
    console.log('\n36) Catálogo estruturado de raças: Anão');

    const dwarf = getRace('dwarf');
    check(
      'getRace("dwarf") devolve a raça e ela está em allRaces()',
      !!dwarf && allRaces().some((r) => r.id === 'dwarf'),
      JSON.stringify(allRaces().map((r) => r.id)),
    );
    check('nome em PT é Anão', dwarf?.namePt === 'Anão', dwarf?.namePt);
    check(
      'bônus de atributo: Constituição +2',
      dwarf?.abilityScoreIncrease.length === 1 &&
        dwarf?.abilityScoreIncrease[0]?.ability === 'constitution' &&
        dwarf?.abilityScoreIncrease[0]?.amount === 2,
      JSON.stringify(dwarf?.abilityScoreIncrease),
    );
    check('deslocamento 7,5 m (25 pés)', dwarf?.speed === 7.5, String(dwarf?.speed));
    check('visão no escuro 18 m (60 pés)', dwarf?.darkvision === 18, String(dwarf?.darkvision));
    check(
      'idiomas: Comum e Anão',
      JSON.stringify(dwarf?.languages) === JSON.stringify(['Comum', 'Anão']),
      JSON.stringify(dwarf?.languages),
    );
    check(
      'a descrição cita que armadura pesada não reduz o deslocamento',
      typeof dwarf?.description === 'string' && /armadura pesada/.test(dwarf.description),
      dwarf?.description,
    );

    // Resiliência Anã: DOIS efeitos (resistência legível + vantagem como 'other').
    const resilience =
      dwarf?.traits.find((t) => t.id === 'dwarven-resilience')?.mechanicalEffects ?? [];
    check(
      'Resiliência Anã tem resistência a Veneno + vantagem (other)',
      resilience.length === 2 &&
        resilience.some(
          (e) =>
            e.type === 'resistance' &&
            JSON.stringify(e.damageTypes) === JSON.stringify(['Veneno']),
        ) &&
        resilience.some((e) => e.type === 'other'),
      JSON.stringify(resilience),
    );
    check(
      'Treinamento de Combate Anão concede os 4 ids canônicos; Conhecimento de Pedra é textual',
      (() => {
        const combat = dwarf?.traits.find((t) => t.id === 'dwarven-combat-training')?.mechanicalEffect;
        return (
          combat?.type === 'weaponProficiency' &&
          JSON.stringify(combat?.targets) ===
            JSON.stringify(['battleaxe', 'handaxe', 'light-hammer', 'warhammer']) &&
          dwarf?.traits.find((t) => t.id === 'stonecunning')?.mechanicalEffect === undefined
        );
      })(),
      JSON.stringify(
        dwarf?.traits.find((t) => t.id === 'dwarven-combat-training')?.mechanicalEffect,
      ),
    );

    const toolChoice = dwarf?.hasChoices?.find((c) => c.id === 'dwarf-tool-proficiency');
    check(
      'a escolha de ferramenta traz as 3 ferramentas do PHB',
      JSON.stringify(toolChoice?.options.map((o) => o.id)) ===
        JSON.stringify(['smith-tools', 'brewer-supplies', 'mason-tools']),
      JSON.stringify(toolChoice?.options),
    );

    const subIds = (dwarf?.subraces ?? []).map((s) => s.id);
    check(
      'tem 2 sub-raças (hill-dwarf, mountain-dwarf)',
      JSON.stringify(subIds) === JSON.stringify(['hill-dwarf', 'mountain-dwarf']),
      JSON.stringify(subIds),
    );

    const hill = dwarf?.subraces?.find((s) => s.id === 'hill-dwarf');
    const toughness = hill?.traits.find((t) => t.id === 'dwarven-toughness')?.mechanicalEffect;
    check(
      'Anão da Colina: Sabedoria +1 e Robustez Anã (+1 PV/nível)',
      hill?.abilityScoreIncrease[0]?.ability === 'wisdom' &&
        hill?.abilityScoreIncrease[0]?.amount === 1 &&
        toughness?.type === 'hpBonus' &&
        toughness?.value === 1 &&
        toughness?.perLevel === true,
      JSON.stringify(toughness),
    );

    const mountain = dwarf?.subraces?.find((s) => s.id === 'mountain-dwarf');
    check(
      'Anão da Montanha: Força +2 e treino de armadura (texto)',
      mountain?.abilityScoreIncrease[0]?.ability === 'strength' &&
        mountain?.abilityScoreIncrease[0]?.amount === 2 &&
        mountain?.traits.some((t) => t.id === 'dwarven-armor-training') &&
        mountain?.traits.find((t) => t.id === 'dwarven-armor-training')?.mechanicalEffect ===
          undefined,
      JSON.stringify(mountain?.traits.map((t) => t.id)),
    );

    // Helper: o hpBonus de raça escala pelo NÍVEL TOTAL do personagem.
    check(
      'raceHpBonus: Anão da Colina = +1×nível; base/Montanha/outras raças = 0',
      raceHpBonus('dwarf', 'hill-dwarf', 5) === 5 &&
        raceHpBonus('dwarf', 'mountain-dwarf', 5) === 0 &&
        raceHpBonus('dwarf', null, 5) === 0 &&
        raceHpBonus('dragonborn', null, 5) === 0 &&
        raceHpBonusDelta(
          { raceId: 'dwarf', subraceId: 'mountain-dwarf' },
          { raceId: 'dwarf', subraceId: 'hill-dwarf' },
          3,
        ) === 3,
      String(raceHpBonus('dwarf', 'hill-dwarf', 5)),
    );

    // Integração: o mestre grava raceId/subraceId e a Robustez Anã aplica/reverte.
    // Dono novo e autossuficiente (a ficha do jogador de cima pode ter sido
    // recriada por outra seção).
    const robustUsername = `anao_${suffix}`;
    createdUsernames.push(robustUsername);
    await api('/api/auth/register', {
      method: 'POST',
      body: { username: robustUsername, displayName: 'Anão Teste', password: 'senha-forte-123' },
    });
    const robustLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: robustUsername, password: 'senha-forte-123' },
    });
    const robustCreated = await api('/api/characters/me', {
      method: 'POST',
      token: robustLogin.data?.token,
    });
    const robustCharId = robustCreated.data?.character?.id;
    const robustLevel = 4;
    await prisma.character.update({
      where: { id: robustCharId },
      data: {
        classes: [{ classKey: 'fighter', level: robustLevel, subclass: null }] as any,
        hpMax: 40,
        hpCurrent: 40,
        raceId: null,
        subraceId: null,
      },
    });

    const applied = await api(`/api/characters/${robustCharId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { raceId: 'dwarf', subraceId: 'hill-dwarf' },
    });
    check(
      'escolher Anão da Colina aplica +1×nível ao PV máximo e ao atual',
      applied.status === 200 &&
        applied.data?.character?.raceId === 'dwarf' &&
        applied.data?.character?.subraceId === 'hill-dwarf' &&
        applied.data?.character?.hpMax === 44 &&
        applied.data?.character?.hpCurrent === 44,
      JSON.stringify({
        hpMax: applied.data?.character?.hpMax,
        hp: applied.data?.character?.hpCurrent,
        subraceId: applied.data?.character?.subraceId,
      }),
    );

    const reverted = await api(`/api/characters/${robustCharId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { subraceId: 'mountain-dwarf' },
    });
    check(
      'trocar para Anão da Montanha REVERTE o bônus',
      reverted.status === 200 &&
        reverted.data?.character?.subraceId === 'mountain-dwarf' &&
        reverted.data?.character?.hpMax === 40,
      JSON.stringify({ hpMax: reverted.data?.character?.hpMax }),
    );

    const reapplied = await api(`/api/characters/${robustCharId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { subraceId: 'hill-dwarf' },
    });
    check(
      'voltar a Anão da Colina reaplica o bônus',
      reapplied.status === 200 && reapplied.data?.character?.hpMax === 44,
      JSON.stringify({ hpMax: reapplied.data?.character?.hpMax }),
    );

    const cleared = await api(`/api/characters/${robustCharId}`, {
      method: 'PATCH',
      token: masterToken,
      body: { subraceId: null, raceId: null },
    });
    check(
      'remover a raça/sub-raça reverte o bônus do Anão da Colina',
      cleared.status === 200 &&
        cleared.data?.character?.raceId === null &&
        cleared.data?.character?.hpMax === 40,
      JSON.stringify({ hpMax: cleared.data?.character?.hpMax, raceId: cleared.data?.character?.raceId }),
    );
  }

  // 37) Catálogo estruturado de raças: Humano (Prompt 2.4)
  {
    console.log('\n37) Catálogo estruturado de raças: Humano');

    const human = getRace('human');
    check(
      'getRace("human") devolve a raça e ela está em allRaces()',
      !!human && allRaces().some((r) => r.id === 'human'),
      JSON.stringify(allRaces().map((r) => r.id)),
    );
    check('nome em PT é Humano', human?.namePt === 'Humano', human?.namePt);

    const abilityKeys = [
      'strength',
      'dexterity',
      'constitution',
      'intelligence',
      'wisdom',
      'charisma',
    ];
    const bonuses = human?.abilityScoreIncrease ?? [];
    check(
      'bônus de atributo: +1 nos seis (chaves em inglês)',
      bonuses.length === 6 &&
        abilityKeys.every((k) => bonuses.some((b) => b.ability === k && b.amount === 1)),
      JSON.stringify(bonuses),
    );
    check('deslocamento 9 m (30 pés)', human?.speed === 9, String(human?.speed));
    check('sem visão no escuro', human?.darkvision === undefined, String(human?.darkvision));
    check(
      'sem traços',
      (human?.traits ?? []).length === 0,
      JSON.stringify(human?.traits?.map((t) => t.id)),
    );
    check('sem sub-raças', human?.subraces === undefined);
    check(
      'idiomas: Comum + 1 à escolha',
      JSON.stringify(human?.languages) === JSON.stringify(['Comum']) &&
        human?.bonusLanguageChoices === 1,
      JSON.stringify({ languages: human?.languages, extra: human?.bonusLanguageChoices }),
    );
    check(
      'a descrição existe (compêndio)',
      typeof human?.description === 'string' && human.description.length > 0,
      human?.description,
    );
  }

  // 38) Catálogo estruturado de raças: Halfling + Sortudo (Prompt 2.3)
  {
    console.log('\n38) Catálogo estruturado de raças: Halfling');

    const halfling = getRace('halfling');
    check(
      'getRace("halfling") devolve a raça e ela está em allRaces()',
      !!halfling && allRaces().some((r) => r.id === 'halfling'),
      JSON.stringify(allRaces().map((r) => r.id)),
    );
    check('nome em PT é Halfling', halfling?.namePt === 'Halfling', halfling?.namePt);
    check(
      'bônus de atributo: Destreza +2',
      halfling?.abilityScoreIncrease[0]?.ability === 'dexterity' &&
        halfling?.abilityScoreIncrease[0]?.amount === 2,
      JSON.stringify(halfling?.abilityScoreIncrease),
    );
    check('deslocamento 7,5 m (25 pés)', halfling?.speed === 7.5, String(halfling?.speed));
    check('tamanho Pequeno', halfling?.size === 'Small', String(halfling?.size));
    check('sem visão no escuro', halfling?.darkvision === undefined, String(halfling?.darkvision));

    const lucky = halfling?.traits.find((t) => t.id === 'lucky')?.mechanicalEffect;
    check(
      'Sortudo é um efeito luckyReroll (máquina-legível)',
      lucky?.type === 'luckyReroll',
      JSON.stringify(lucky),
    );
    const brave = halfling?.traits.find((t) => t.id === 'brave')?.mechanicalEffect;
    check('Corajoso vai como other', brave?.type === 'other', JSON.stringify(brave));

    const subIds = (halfling?.subraces ?? []).map((s) => s.id);
    check(
      'tem 2 sub-raças (lightfoot-halfling, stout-halfling)',
      JSON.stringify(subIds) === JSON.stringify(['lightfoot-halfling', 'stout-halfling']),
      JSON.stringify(subIds),
    );
    const lightfoot = halfling?.subraces?.find((s) => s.id === 'lightfoot-halfling');
    check(
      'Pés-Leves: Carisma +1 e Furtivo por Natureza',
      lightfoot?.abilityScoreIncrease[0]?.ability === 'charisma' &&
        lightfoot?.abilityScoreIncrease[0]?.amount === 1 &&
        lightfoot?.traits.some((t) => t.id === 'naturally-stealthy'),
      JSON.stringify(lightfoot?.traits.map((t) => t.id)),
    );
    const stout = halfling?.subraces?.find((s) => s.id === 'stout-halfling');
    const stoutRes =
      stout?.traits.find((t) => t.id === 'stout-resilience')?.mechanicalEffects ?? [];
    check(
      'Robusto: Constituição +1 e Resiliência Robusta (resistência Veneno + other)',
      stout?.abilityScoreIncrease[0]?.ability === 'constitution' &&
        stout?.abilityScoreIncrease[0]?.amount === 1 &&
        stoutRes.length === 2 &&
        stoutRes.some(
          (e) =>
            e.type === 'resistance' &&
            JSON.stringify(e.damageTypes) === JSON.stringify(['Veneno']),
        ) &&
        stoutRes.some((e) => e.type === 'other'),
      JSON.stringify(stoutRes),
    );

    // Helper puro: quem tem o Sortudo (por id do catálogo ou pelo texto livre).
    check(
      'hasLuckyReroll: Halfling (id ou texto) sim; as outras raças não',
      hasLuckyReroll({ raceId: 'halfling' }) === true &&
        hasLuckyReroll({ race: 'Halfling (Pés-Leves)' }) === true &&
        hasLuckyReroll({ race: 'Halfling (Robusto)' }) === true &&
        hasLuckyReroll({ raceId: 'dwarf', subraceId: 'hill-dwarf' }) === false &&
        hasLuckyReroll({ race: 'Anão' }) === false &&
        hasLuckyReroll({}) === false,
    );

    // Integração: o flag `lucky` do pool liga no 1 natural de um Halfling.
    const halfUsername = `halfling_${suffix}`;
    createdUsernames.push(halfUsername);
    await api('/api/auth/register', {
      method: 'POST',
      body: { username: halfUsername, displayName: 'Halfling Teste', password: 'senha-forte-123' },
    });
    const halfLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: halfUsername, password: 'senha-forte-123' },
    });
    const halfToken: string = halfLogin.data?.token;
    const halfCreated = await api('/api/characters/me', { method: 'POST', token: halfToken });
    const halfCharId = halfCreated.data?.character?.id;
    await prisma.character.update({ where: { id: halfCharId }, data: { raceId: 'halfling' } });

    // 50 d20 numa rolagem: garante que um 1 natural apareça em poucas rolagens.
    const manyD20 = {
      method: 'POST',
      token: halfToken,
      body: { dice: Array.from({ length: 50 }, () => ({ sides: 20 })), kind: 'free' },
    };
    let halflingConsistent = true;
    let sawOne = false;
    for (let i = 0; i < 10 && !sawOne; i += 1) {
      const rolled = await api('/api/dice/roll', manyD20);
      const dice = rolled.data?.roll?.dice ?? [];
      const hasOne = dice.some((d: any) => d.sides === 20 && !d.dropped && d.value === 1);
      if (Boolean(rolled.data?.roll?.lucky) !== hasOne) halflingConsistent = false;
      if (hasOne) sawOne = true;
    }
    check(
      'Sortudo: o flag lucky do Halfling bate com "1 natural" em cada rolagem',
      halflingConsistent,
    );
    check('Sortudo: o Halfling recebeu lucky=true ao sair um 1 natural', sawOne);

    // Sem a raça Halfling o flag nunca liga (mesmo saindo 1 natural).
    await prisma.character.update({
      where: { id: halfCharId },
      data: { raceId: null, subraceId: null, race: '' },
    });
    let plainNeverLucky = true;
    let sawOnePlain = false;
    for (let i = 0; i < 10 && !sawOnePlain; i += 1) {
      const rolled = await api('/api/dice/roll', manyD20);
      if (rolled.data?.roll?.lucky) plainNeverLucky = false;
      const dice = rolled.data?.roll?.dice ?? [];
      if (dice.some((d: any) => d.sides === 20 && !d.dropped && d.value === 1)) sawOnePlain = true;
    }
    check('Sortudo: sem a raça Halfling o flag lucky nunca liga', plainNeverLucky);
    check('Sortudo: a rolagem de controle também teve um 1 natural', sawOnePlain);
  }

  // 39) Catálogo estruturado de raças: Gnomo, Meio-Elfo, Meio-Orc e Tiefling
  {
    console.log('\n39) Catálogo estruturado de raças: Gnomo / Meio-Elfo / Meio-Orc / Tiefling');
    check('o catálogo tem 9 raças', allRaces().length === 9, String(allRaces().length));

    // --- Gnomo ---------------------------------------------------------------
    const gnome = getRace('gnome');
    check(
      'Gnomo: Int+2, 7,5 m, Pequeno, visão no escuro 18 m',
      gnome?.namePt === 'Gnomo' &&
        gnome?.abilityScoreIncrease[0]?.ability === 'intelligence' &&
        gnome?.abilityScoreIncrease[0]?.amount === 2 &&
        gnome?.speed === 7.5 &&
        gnome?.size === 'Small' &&
        gnome?.darkvision === 18,
      JSON.stringify({ asi: gnome?.abilityScoreIncrease, speed: gnome?.speed, size: gnome?.size }),
    );
    const cunning = gnome?.traits.find((t) => t.id === 'gnome-cunning')?.mechanicalEffect;
    check(
      'Astúcia Gnômica: saveAdvantage INT/SAB/CAR contra magia',
      cunning?.type === 'saveAdvantage' &&
        JSON.stringify(cunning.abilities) ===
          JSON.stringify(['intelligence', 'wisdom', 'charisma']) &&
        cunning.condition === 'magic',
      JSON.stringify(cunning),
    );
    const forest = gnome?.subraces?.find((s) => s.id === 'forest-gnome');
    check(
      'Gnomo da Floresta: Des+1, Ilusionista Natural e Falar com Pequenos Animais',        forest?.abilityScoreIncrease[0]?.ability === 'dexterity' &&
        forest?.abilityScoreIncrease[0]?.amount === 1 &&
        (forest?.traits ?? []).some((t) => t.id === 'natural-illusionist') &&
        (forest?.traits ?? []).some((t) => t.id === 'speak-with-small-beasts'),
      JSON.stringify(forest?.traits.map((t) => t.id)),
    );
    const rock = gnome?.subraces?.find((s) => s.id === 'rock-gnome');
    const tinker = rock?.traits.find((t) => t.id === 'tinker')?.mechanicalEffect;
    check(
      'Gnomo das Rochas: Con+1 e ferramenta de funileiro (toolProficiency → tinker-tools)',
      rock?.abilityScoreIncrease[0]?.ability === 'constitution' &&
        rock?.abilityScoreIncrease[0]?.amount === 1 &&
        tinker?.type === 'toolProficiency' &&
        tinker?.target === 'tinker-tools' &&
        (rock?.traits ?? []).some((t) => t.id === 'artificers-lore'),
      JSON.stringify(tinker),
    );

    // --- Meio-Elfo -----------------------------------------------------------
    const halfElf = getRace('half-elf');
    check(
      'Meio-Elfo: Car+2, 9 m, visão no escuro 18 m, sem sub-raças',
      halfElf?.namePt === 'Meio-Elfo' &&
        halfElf?.abilityScoreIncrease[0]?.ability === 'charisma' &&
        halfElf?.abilityScoreIncrease[0]?.amount === 2 &&
        halfElf?.speed === 9 &&
        halfElf?.darkvision === 18 &&
        halfElf?.subraces === undefined,
      JSON.stringify(halfElf?.abilityScoreIncrease),
    );
    check(
      'Meio-Elfo: Ancestralidade Feérica (reuso) e Versatilidade de Perícia',
      (halfElf?.traits ?? []).some((t) => t.id === 'fey-ancestry') &&
        (halfElf?.traits ?? []).some((t) => t.id === 'skill-versatility'),
      JSON.stringify(halfElf?.traits.map((t) => t.id)),
    );
    const abilityChoice = halfElf?.hasChoices?.find((c) => c.id === 'half-elf-ability-1');
    const skillChoice = halfElf?.hasChoices?.find((c) => c.id === 'half-elf-skill-1');
    check(
      'Meio-Elfo: 4 escolhas (2 de atributo + 2 de perícia)',
      JSON.stringify(halfElf?.hasChoices?.map((c) => c.id)) ===
        JSON.stringify([
          'half-elf-ability-1',
          'half-elf-ability-2',
          'half-elf-skill-1',
          'half-elf-skill-2',
        ]),
      JSON.stringify(halfElf?.hasChoices?.map((c) => c.id)),
    );
    check(
      'Meio-Elfo: a escolha de atributo exclui Carisma (5 opções)',
      JSON.stringify(abilityChoice?.options.map((o) => o.id)) ===
        JSON.stringify(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom']),
      JSON.stringify(abilityChoice?.options.map((o) => o.id)),
    );
    check(
      'Meio-Elfo: a escolha de perícia traz as 18 perícias',
      skillChoice?.options.length === 18 &&
        skillChoice.options.some((o) => o.id === 'perception') &&
        skillChoice.options.some((o) => o.id === 'stealth'),
      String(skillChoice?.options.length),
    );

    // --- Meio-Orc ------------------------------------------------------------
    const halfOrc = getRace('half-orc');
    check(
      'Meio-Orc: For+2/Con+1, 9 m, visão no escuro 18 m, sem sub-raças',
      halfOrc?.namePt === 'Meio-Orc' &&
        JSON.stringify(halfOrc?.abilityScoreIncrease) ===
          JSON.stringify([
            { ability: 'strength', amount: 2 },
            { ability: 'constitution', amount: 1 },
          ]) &&
        halfOrc?.darkvision === 18 &&
        halfOrc?.subraces === undefined,
      JSON.stringify(halfOrc?.abilityScoreIncrease),
    );
    const menacing = halfOrc?.traits.find((t) => t.id === 'menacing')?.mechanicalEffect;
    check(
      'Ameaçador: skillProficiency → intimidation',
      menacing?.type === 'skillProficiency' && menacing?.target === 'intimidation',
      JSON.stringify(menacing),
    );
    check(
      'Resistência Implacável e Ataques Selvagens vão como other (TODO)',
      halfOrc?.traits.find((t) => t.id === 'relentless-endurance')?.mechanicalEffect?.type ===
        'other' &&
        halfOrc?.traits.find((t) => t.id === 'savage-attacks')?.mechanicalEffect?.type === 'other',
    );

    // --- Tiefling ------------------------------------------------------------
    const tiefling = getRace('tiefling');
    check(
      'Tiefling: Car+2/Int+1, 9 m, visão no escuro 18 m, sem sub-raças',
      tiefling?.namePt === 'Tiefling' &&
        JSON.stringify(tiefling?.abilityScoreIncrease) ===
          JSON.stringify([
            { ability: 'charisma', amount: 2 },
            { ability: 'intelligence', amount: 1 },
          ]) &&
        tiefling?.darkvision === 18 &&
        tiefling?.subraces === undefined,
      JSON.stringify(tiefling?.abilityScoreIncrease),
    );
    const hellish = tiefling?.traits.find((t) => t.id === 'hellish-resistance')?.mechanicalEffect;
    check(
      'Resistência Infernal: resistance → Fogo',
      hellish?.type === 'resistance' &&
        JSON.stringify(hellish.damageTypes) === JSON.stringify(['Fogo']),
      JSON.stringify(hellish),
    );
    check(
      'Legado Infernal é descritivo (sem efeito mecânico)',
      tiefling?.traits.find((t) => t.id === 'infernal-legacy')?.mechanicalEffect === undefined &&
        tiefling?.traits.find((t) => t.id === 'infernal-legacy')?.mechanicalEffects === undefined,
    );
  }

  // 40) Raças personalizadas do mestre + integração do assistente (Prompt 2.10)
  {
    console.log('\n40) Raças personalizadas do mestre e integração do assistente');

    // --- Catálogo do assistente derivado das 9 raças fixas ------------------
    check(
      'o catálogo do assistente tem 18 linhagens (9 raças + 9 sub-raças)',
      RACE_CATALOG.length === 18,
      String(RACE_CATALOG.length),
    );
    const hillDwarfOption = RACE_CATALOG.find((race) => race.key === 'dwarf:hill-dwarf');
    check(
      'a opção do Anão da Colina aponta raceId/subraceId e pede a ferramenta',
      hillDwarfOption?.raceId === 'dwarf' &&
        hillDwarfOption?.subraceId === 'hill-dwarf' &&
        (hillDwarfOption?.choices ?? []).some(
          (choice) => choice.id === 'dwarf-tool-proficiency' && choice.apply === 'tool',
        ),
      JSON.stringify({ raceId: hillDwarfOption?.raceId, subraceId: hillDwarfOption?.subraceId }),
    );
    const halfElfOption = RACE_CATALOG.find((race) => race.key === 'half-elf');
    check(
      'a opção do Meio-Elfo pede 2 atributos e 2 perícias',
      halfElfOption?.abilityChoice === 2 &&
        (halfElfOption?.choices ?? []).filter((choice) => choice.apply === 'skill').length === 2,
      JSON.stringify(halfElfOption?.choices?.map((choice) => choice.id)),
    );

    // Um jogador novo para percorrer o passo 3 (a ficha do rookie já fechou).
    const racesUsername = `racas_${suffix}`;
    createdUsernames.push(racesUsername);
    const racesReg = await api('/api/auth/register', {
      method: 'POST',
      body: { username: racesUsername, displayName: 'Raças Teste', password: 'senha-forte-123' },
    });
    const racesToken: string = racesReg.data?.token;
    testsPlayerToken = racesToken;
    check('jogador novo para o teste de raças (201)', racesReg.status === 201 && Boolean(racesToken));

    // --- CRUD da raça personalizada (mestre) --------------------------------
    const createdRace = await api('/api/custom-races', {
      method: 'POST',
      token: masterToken,
      body: {
        name: 'Gigante da Névoa (teste)',
        description: 'Raça de teste do smoke.',
        abilityScoreIncrease: [
          { ability: 'strength', amount: 2 },
          { ability: 'wisdom', amount: 1 },
        ],
        speed: 10.5,
        size: 'Medium',
        darkvision: 18,
        damageResistances: ['Frio'],
        languages: ['Comum', 'Gigante'],
        bonusLanguageChoices: 0,
        traits: [{ name: 'Passo da Névoa', description: 'A névoa não atrapalha seu movimento.' }],
      },
    });
    const customRaceId: string | undefined = createdRace.data?.customRace?.id;
    if (typeof customRaceId === 'string') createdCustomRaceIds.push(customRaceId);
    check(
      'o mestre cria uma raça personalizada (201)',
      createdRace.status === 201 && typeof customRaceId === 'string',
      JSON.stringify(createdRace.data),
    );
    const customList = await api('/api/custom-races', { token: racesToken });
    check(
      'a raça personalizada aparece na lista de qualquer usuário',
      (customList.data?.customRaces ?? []).some(
        (race: any) => race.id === customRaceId && race.damageResistances?.[0] === 'Frio',
      ),
      JSON.stringify({ status: customList.status, data: customList.data }),
    );
    const racedCompendium = await api('/api/compendium', { token: racesToken });
    check(
      'a raça personalizada entra no compêndio junto das 9 raças',
      (racedCompendium.data?.compendium?.races ?? []).some(
        (race: any) => race.key === `custom:${customRaceId}`,
      ),
      JSON.stringify({
        status: racedCompendium.status,
        keys: (racedCompendium.data?.compendium?.races ?? []).map((race: any) => race.key),
      }),
    );
    const playerCreateRace = await api('/api/custom-races', {
      method: 'POST',
      token: racesToken,
      body: { name: 'X' },
    });
    check(
      'jogador não pode criar raça personalizada (403)',
      playerCreateRace.status === 403,
      `status ${playerCreateRace.status} ${JSON.stringify(playerCreateRace.data)}`,
    );

    // --- Efeitos da raça fixa entram na ficha pelo passo 3 ------------------
    const tieflingStep = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: { step: 3, race: 'Tiefling' },
    });
    check(
      'Tiefling: resistência a Fogo, visão no escuro e idiomas entram na ficha',
      tieflingStep.status === 200 &&
        (tieflingStep.data?.character?.raceResistances ?? []).includes('Fogo') &&
        tieflingStep.data?.character?.darkvision === 18 &&
        (tieflingStep.data?.character?.languages ?? []).includes('Comum') &&
        tieflingStep.data?.character?.raceId === 'tiefling',
      JSON.stringify({
        resistances: tieflingStep.data?.character?.raceResistances,
        darkvision: tieflingStep.data?.character?.darkvision,
      }),
    );

    const dwarfStep = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: {
        step: 3,
        race: 'Anão (Anão da Colina)',
        raceChoices: { 'dwarf-tool-proficiency': 'smith-tools' },
      },
    });
    check(
      'Anão da Colina: 7,5 m, visão no escuro, resistência a Veneno e ferramenta escolhida',
      dwarfStep.status === 200 &&
        dwarfStep.data?.character?.speed === 7.5 &&
        dwarfStep.data?.character?.darkvision === 18 &&
        (dwarfStep.data?.character?.raceResistances ?? []).includes('Veneno') &&
        (dwarfStep.data?.character?.toolProficiencies ?? []).includes('smith-tools') &&
        dwarfStep.data?.character?.raceId === 'dwarf' &&
        dwarfStep.data?.character?.subraceId === 'hill-dwarf',
      JSON.stringify({
        speed: dwarfStep.data?.character?.speed,
        tools: dwarfStep.data?.character?.toolProficiencies,
        raceId: dwarfStep.data?.character?.raceId,
      }),
    );
    check(
      'Anão sem a ferramenta escolhida é recusado (400)',
      (
        await api('/api/characters/me/creation', {
          method: 'PATCH',
          token: racesToken,
          body: { step: 3, race: 'Anão' },
        })
      ).status === 400,
    );

    const drowStep = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: { step: 3, race: 'Elfo (Drow)' },
    });
    check(
      'Drow: perícia racial Percepção e visão no escuro 36 m',
      drowStep.status === 200 &&
        drowStep.data?.character?.skills?.perception?.proficient === true &&
        drowStep.data?.character?.darkvision === 36,
      JSON.stringify({
        darkvision: drowStep.data?.character?.darkvision,
        perception: drowStep.data?.character?.skills?.perception,
      }),
    );

    // --- Idioma à escolha (Humano) ------------------------------------------
    const humanNoLanguage = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: { step: 3, race: 'Humano' },
    });
    check('Humano exige o idioma à escolha (400)', humanNoLanguage.status === 400);

    const humanLanguage = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: { step: 3, race: 'Humano', languageChoices: ['Gigante'] },
    });
    check(
      'Humano: o idioma à escolha entra na ficha junto de Comum',
      humanLanguage.status === 200 &&
        (humanLanguage.data?.character?.languages ?? []).includes('Comum') &&
        (humanLanguage.data?.character?.languages ?? []).includes('Gigante') &&
        JSON.stringify(humanLanguage.data?.creation?.languageChoices) === JSON.stringify(['Gigante']),
      JSON.stringify(humanLanguage.data?.character?.languages),
    );
    check(
      'idioma fixo da raça não pode ser escolhido (400)',
      (
        await api('/api/characters/me/creation', {
          method: 'PATCH',
          token: racesToken,
          body: { step: 3, race: 'Humano', languageChoices: ['Comum'] },
        })
      ).status === 400,
    );
    check(
      'idioma fora do catálogo é recusado (400)',
      (
        await api('/api/characters/me/creation', {
          method: 'PATCH',
          token: racesToken,
          body: { step: 3, race: 'Humano', languageChoices: ['Klingon'] },
        })
      ).status === 400,
    );

    const halfElfStep = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: {
        step: 3,
        race: 'Meio-Elfo',
        abilityChoices: ['strength', 'constitution'],
        raceChoices: { 'half-elf-skill-1': 'arcana', 'half-elf-skill-2': 'stealth' },
        languageChoices: ['Gigante'],
      },
    });
    check(
      'Meio-Elfo: as 2 perícias escolhidas viram proficiência',
      halfElfStep.status === 200 &&
        halfElfStep.data?.character?.skills?.arcana?.proficient === true &&
        halfElfStep.data?.character?.skills?.stealth?.proficient === true &&
        halfElfStep.data?.character?.raceChoices?.['half-elf-skill-1'] === 'arcana',
      JSON.stringify(halfElfStep.data?.character?.raceChoices),
    );

    // --- Raça personalizada aplicada pelo assistente ------------------------
    const customStep = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: racesToken,
      body: { step: 3, race: 'Gigante da Névoa (teste)' },
    });
    check(
      'escolher a raça personalizada aplica customRaceId, velocidade e resistência',
      customStep.status === 200 &&
        customStep.data?.character?.customRaceId === customRaceId &&
        customStep.data?.character?.speed === 10.5 &&
        (customStep.data?.character?.raceResistances ?? []).includes('Frio') &&
        (customStep.data?.character?.languages ?? []).includes('Gigante'),
      JSON.stringify({
        customRaceId: customStep.data?.character?.customRaceId,
        speed: customStep.data?.character?.speed,
      }),
    );

    // --- Remoção: as fichas que usavam a raça ficam sem raça ----------------
    const removedRace = await api(`/api/custom-races/${customRaceId}`, {
      method: 'DELETE',
      token: masterToken,
    });
    check('o mestre remove a raça personalizada (204)', removedRace.status === 204);
    const afterRemove = await api('/api/characters/me/creation', { token: racesToken });
    check(
      'a ficha que usava a raça personalizada fica sem raça',
      afterRemove.data?.character?.customRaceId === null &&
        afterRemove.data?.character?.race === '',
      JSON.stringify(afterRemove.data?.character?.customRaceId),
    );
  }

  // 41) Antecedentes do PHB (catálogo estruturado + integração com ferramentas)
  {
    console.log('\n41) Antecedentes do PHB e integração com as ferramentas');

    // Reaproveita o jogador da seção 40 (a criação dele segue aberta): criar
    // mais uma conta estouraria o limitador de auth de produção.
    const bgToken = testsPlayerToken;
    check('jogador reaproveitado para o teste de antecedentes', Boolean(bgToken));

    // --- Catálogo estruturado ----------------------------------------------
    const bgState = await api('/api/characters/me/creation', { token: bgToken });
    const bgCatalog: any[] = bgState.data?.creation?.backgroundCatalog ?? [];
    check(
      'o catálogo de antecedentes tem 13, cada um com característica e 2 perícias',
      bgCatalog.length === 13 &&
        bgCatalog.every((item) => (item.skills ?? []).length === 2 && item.feature?.name),
      JSON.stringify(bgCatalog.map((item) => item.key)),
    );
    const sageOpt = bgCatalog.find((item) => item.key === 'sage');
    check(
      'o Sábio concede 2 idiomas à escolha e nenhuma ferramenta',
      sageOpt?.languageChoices === 2 && (sageOpt?.toolProficiencies ?? []).length === 0,
      JSON.stringify({ languages: sageOpt?.languageChoices, tools: sageOpt?.toolProficiencies }),
    );
    const entertainerOpt = bgCatalog.find((item) => item.key === 'entertainer');
    check(
      'o Artista resolve o instrumento musical do catálogo (9 opções)',
      entertainerOpt?.toolChoices?.[0]?.options?.length === 9 &&
        entertainerOpt?.toolChoices?.[0]?.options?.some((option: any) => option.id === 'lute') &&
        (entertainerOpt?.toolProficiencies ?? []).includes('disguise-kit'),
      JSON.stringify(entertainerOpt?.toolChoices),
    );
    const criminalOpt = bgCatalog.find((item) => item.key === 'criminal');
    check(
      'o Criminoso concede thieves-tools + gaming-set FIXOS (sem escolha)',
      (criminalOpt?.toolProficiencies ?? []).includes('thieves-tools') &&
        (criminalOpt?.toolProficiencies ?? []).includes('gaming-set') &&
        (criminalOpt?.toolChoices ?? []).length === 0,
      JSON.stringify(criminalOpt?.toolProficiencies),
    );

    // --- Passo 3 (raça Tiefling: Comum + Infernal, sem escolhas) ------------
    await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 1, mode: 'new' },
    });
    await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 2, name: 'Teste dos Antecedentes', alignment: 'Neutro' },
    });
    const bgRace = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 3, race: 'Tiefling' },
    });
    check(
      'a raça concede os idiomas fixos antes do antecedente (Comum + Infernal)',
      bgRace.status === 200 &&
        ['Comum', 'Infernal'].every((name) =>
          (bgRace.data?.character?.languages ?? []).includes(name),
        ),
      JSON.stringify(bgRace.data?.character?.languages),
    );

    // --- Ferramenta por categoria: Artista ---------------------------------
    const entertainerMissing = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 4, background: 'Artista' },
    });
    check(
      'o Artista sem a escolha do instrumento é recusado (400)',
      entertainerMissing.status === 400,
      JSON.stringify(entertainerMissing.data),
    );

    const entertainerBad = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 4, background: 'Artista', backgroundToolChoices: { 'entertainer-instrument': 'thieves-tools' } },
    });
    check(
      'ferramenta fora da categoria do antecedente é recusada (400)',
      entertainerBad.status === 400,
      JSON.stringify(entertainerBad.data),
    );

    const entertainerOk = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: {
        step: 4,
        background: 'Artista',
        backgroundToolChoices: { 'entertainer-instrument': 'lute' },
      },
    });
    check(
      'a ferramenta escolhida entra junto da fixa (disguise-kit + lute)',
      entertainerOk.status === 200 &&
        (entertainerOk.data?.character?.toolProficiencies ?? []).includes('disguise-kit') &&
        (entertainerOk.data?.character?.toolProficiencies ?? []).includes('lute'),
      JSON.stringify(entertainerOk.data?.character?.toolProficiencies),
    );
    check(
      'a característica do antecedente entra na ficha com source background',
      (entertainerOk.data?.character?.features ?? []).some(
        (feature: any) =>
          feature.source === 'background' && feature.name === 'Sob Demanda Popular',
      ),
      JSON.stringify(entertainerOk.data?.character?.features),
    );

    // --- Ferramentas FIXAS: Criminoso --------------------------------------
    const criminalStep = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 4, background: 'Criminoso' },
    });
    check(
      'trocar para o Criminoso dá as ferramentas fixas e troca a característica',
      criminalStep.status === 200 &&
        (criminalStep.data?.character?.toolProficiencies ?? []).includes('thieves-tools') &&
        (criminalStep.data?.character?.toolProficiencies ?? []).includes('gaming-set') &&
        !(criminalStep.data?.character?.toolProficiencies ?? []).includes('lute') &&
        (criminalStep.data?.character?.features ?? []).some(
          (feature: any) => feature.source === 'background' && feature.name === 'Contato Criminoso',
        ),
      JSON.stringify(criminalStep.data?.character?.toolProficiencies),
    );

    // --- Idiomas à escolha: Sábio ------------------------------------------
    const sageMissing = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 4, background: 'Sábio' },
    });
    check('o Sábio sem os 2 idiomas é recusado (400)', sageMissing.status === 400);

    const sageOk = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 4, background: 'Sábio', backgroundLanguageChoices: ['Élfico', 'Anão'] },
    });
    check(
      'os idiomas do Sábio entram junto dos idiomas fixos da raça',
      sageOk.status === 200 &&
        ['Élfico', 'Anão'].every((name) =>
          (sageOk.data?.character?.languages ?? []).includes(name),
        ) &&
        (sageOk.data?.character?.languages ?? []).includes('Infernal'),
      JSON.stringify(sageOk.data?.character?.languages),
    );

    // --- Ferramenta + idioma juntos: Artesão de Guilda ---------------------
    const guildBad = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: {
        step: 4,
        background: 'Artesão de Guilda',
        backgroundToolChoices: { 'guild-artisan-tool': 'smith-tools' },
      },
    });
    check('o Artesão de Guilda sem o idioma à escolha é recusado (400)', guildBad.status === 400);

    const guildOk = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: {
        step: 4,
        background: 'Artesão de Guilda',
        backgroundToolChoices: { 'guild-artisan-tool': 'smith-tools' },
        backgroundLanguageChoices: ['Anão'],
      },
    });
    check(
      'o Artesão de Guilda aplica a ferramenta e o idioma escolhidos (200)',
      guildOk.status === 200 &&
        (guildOk.data?.character?.toolProficiencies ?? []).includes('smith-tools') &&
        (guildOk.data?.character?.languages ?? []).includes('Anão'),
      JSON.stringify({
        tools: guildOk.data?.character?.toolProficiencies,
        languages: guildOk.data?.character?.languages,
      }),
    );

    // --- Voltar ao passo 3 não apaga o que o antecedente concedeu ----------
    const backToRace = await api('/api/characters/me/creation', {
      method: 'PATCH',
      token: bgToken,
      body: { step: 3, race: 'Tiefling' },
    });
    check(
      'voltar ao passo 3 mantém as ferramentas e os idiomas do antecedente',
      backToRace.status === 200 &&
        (backToRace.data?.character?.toolProficiencies ?? []).includes('smith-tools') &&
        (backToRace.data?.character?.languages ?? []).includes('Anão'),
      JSON.stringify({
        tools: backToRace.data?.character?.toolProficiencies,
        languages: backToRace.data?.character?.languages,
      }),
    );
  }

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

  if (createdCustomRaceIds.length > 0) {
    // As fichas que apontavam para elas ficam sem raça antes de a raça sair (FK).
    await prisma.character.updateMany({
      where: { customRaceId: { in: createdCustomRaceIds } },
      data: { customRaceId: null },
    });
    await prisma.customRace.deleteMany({ where: { id: { in: createdCustomRaceIds } } });
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
