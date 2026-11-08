import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { hashPassword } from '../lib/password.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { characterDerivedAttacks } from '../modules/characters/characters.dto.js';
import { remainingMovementFeet } from '../modules/combat/spatial/spatial-movement.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import {
  diffProtectedGameState,
  restoreProtectedGameState,
  snapshotProtectedGameState,
} from './support/protected-state.js';

/**
 * FASE 6.6M.9 — COMBAT PLAYABILITY GOLDEN PATH.
 *
 * Prova, de ponta a ponta e contra HTTP + Socket.io REAIS, que uma sessão de
 * combate pode começar, progredir e terminar sem divergência entre Mestre,
 * jogadores e servidor:
 *
 *   preparação → início → iniciativa → turno do jogador (alcance, ataque,
 *   economia) → movimento (preview/commit, inválido não muda nada) → alternância
 *   de turnos (autorização) → realtime/reconexão → dano, 0 PV e Teste contra a
 *   Morte → encerramento do combate.
 *
 * Regras de escopo:
 *   • reusa SÓ os resolvers existentes (nenhuma regra nova, nenhum atalho de
 *     escrita): as rotas de combate/movimento/morte/dados fazem todo o trabalho;
 *   • nada de assert dependente de resultado aleatório específico — o teste
 *     compara o DTO com a MATEMÁTICA que o próprio servidor devolveu;
 *   • fixtures 100% próprias e apagadas no fim; estado real fotografado ANTES e
 *     conferido DEPOIS (`support/protected-state.ts`).
 *
 * SEGURANÇA (obrigatória antes de qualquer escrita):
 *   • `DATABASE_URL` explícito, com schema iniciado por `smoke_`;
 *   • o schema precisa estar VAZIO de fichas/combates (nada de dado real);
 *   • fixture SENTINELA: a conta criada por Prisma é autenticada por HTTP; se o
 *     login não devolver a MESMA conta, o servidor HTTP aponta para outro banco
 *     e a execução para antes de qualquer outra escrita;
 *   • `PLAYABLE_BASE_URL` aponta para o servidor de teste.
 *
 * Uso:
 *   DATABASE_URL='postgresql://user:pass@host:5432/db?schema=smoke_playable' \
 *   PLAYABLE_BASE_URL='http://localhost:3101' \
 *   npx tsx src/scripts/smoke-combat-playable.ts
 */

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

const BASE_URL = (process.env.PLAYABLE_BASE_URL ?? '').replace(/\/$/, '');

let failures = 0;
const failed: { label: string; detail: string }[] = [];
const check: Check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`✔ ${label}`);
    return;
  }
  failures += 1;
  failed.push({ label, detail });
  console.log(`✘ ${label}${detail ? `\n    ${detail}` : ''}`);
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function requireSmokeDatabase(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    console.error('ABORTADO: defina DATABASE_URL apontando para um schema descartável.');
    process.exit(2);
  }
  let schema = '';
  try {
    schema = new URL(url).searchParams.get('schema') ?? '';
  } catch {
    console.error('ABORTADO: DATABASE_URL inválida.');
    process.exit(2);
  }
  if (!schema) {
    console.error(
      'ABORTADO: DATABASE_URL precisa declarar `?schema=<descartável>` — sem isso o script não comprova isolamento.',
    );
    process.exit(2);
  }
  if (!/^smoke_[a-z0-9_]+$/.test(schema)) {
    console.error(`ABORTADO: o schema "${schema}" não identifica um ambiente de smoke. Use smoke_<nome>.`);
    process.exit(2);
  }
  if (!BASE_URL) {
    console.error('ABORTADO: defina PLAYABLE_BASE_URL (servidor de teste com o MESMO banco).');
    process.exit(2);
  }
  return schema;
}

async function http(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<HttpResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let data: Record<string, any> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

/** Conexão real com o hub: nada de simular evento no cliente. */
async function connectSocket(token: string): Promise<Socket> {
  const socket = io(BASE_URL, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ao conectar no socket')), 8000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
  return socket;
}

/** Espera o PRÓXIMO `combat:updated` que satisfaça o predicado. */
function nextCombatUpdate(
  socket: Socket,
  predicate: (combat: CombatDto) => boolean = () => true,
  timeoutMs = 6000,
): Promise<CombatDto | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off('combat:updated', handler);
      resolve(null);
    }, timeoutMs);
    function handler(payload: { combat?: CombatDto }): void {
      const combat = payload?.combat;
      if (!combat || !predicate(combat)) return;
      clearTimeout(timer);
      socket.off('combat:updated', handler);
      resolve(combat);
    }
    socket.on('combat:updated', handler);
  });
}

const combatantOfCharacter = (combat: CombatDto, characterId: string) =>
  combat.combatants.find((item) => item.characterId === characterId) ?? null;

/** Espera um evento pontual do socket (ex.: `combat:ended`). */
function nextSocketEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 6000,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      resolve(null);
    }, timeoutMs);
    function handler(payload: T): void {
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    }
    socket.on(event, handler as never);
  });
}

/** Trilha de eventos por conexão (diagnóstico de realtime no relatório). */
const eventLog: string[] = [];
function attachEventLog(socket: Socket, label: string): void {
  socket.on('combat:updated', (payload: { combat?: CombatDto }) =>
    eventLog.push(`${label}:updated:${payload?.combat?.version}`),
  );
  socket.on('combat:ended', (payload: { combatId?: string }) =>
    eventLog.push(`${label}:ended:${payload?.combatId}`),
  );
  socket.on('combat:movement-visual', () => eventLog.push(`${label}:movement-visual`));
}

async function main(): Promise<void> {
  const schema = requireSmokeDatabase();
  console.log(`\n△ Golden Path de sessão jogável — schema "${schema}" · ${BASE_URL}`);

  // --- Guarda de isolamento: schema vazio (nenhum dado da campanha) ----------
  const [characters, creatures, combats] = await Promise.all([
    prisma.character.count(),
    prisma.creature.count(),
    prisma.combat.count(),
  ]);
  if (characters > 0 || creatures > 0 || combats > 0) {
    console.error(
      `ABORTADO: o schema já tem ${characters} ficha(s), ${creatures} NPC(s) e ${combats} combate(s). ` +
        'Este Golden Path exige um schema descartável VAZIO.',
    );
    process.exit(2);
  }
  const before = await snapshotProtectedGameState();

  const suffix = randomUUID().slice(0, 8);
  const password = `golden-${suffix}`;
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  const sceneIds: string[] = [];
  const localityIds: string[] = [];
  const regionIds: string[] = [];

  const sockets: Socket[] = [];
  try {
    // =====================================================================
    // SENTINELA: a conta criada localmente é a MESMA que o HTTP autentica.
    // =====================================================================
    const sentinelPassword = `${password}-sentinel`;
    const sentinel = await prisma.user.create({
      data: {
        username: `golden_sentinel_${suffix}`,
        displayName: 'Sentinela Golden Path',
        passwordHash: await hashPassword(sentinelPassword),
        role: 'PLAYER',
      },
    });
    userIds.push(sentinel.id);
    const login = await http('/api/auth/login', {
      body: { username: sentinel.username, password: sentinelPassword },
    });
    check(
      'GP01) sentinela: o servidor HTTP autentica a conta criada neste banco (isolamento comprovado)',
      login.status === 200 && login.data.user?.id === sentinel.id,
      `status=${login.status} ${JSON.stringify(login.data).slice(0, 300)}`,
    );
    if (login.data.user?.id !== sentinel.id) {
      console.error('ABORTADO: o servidor HTTP não compartilha o banco do script. Nenhuma fixture extra foi criada.');
      await prisma.user.deleteMany({ where: { id: sentinel.id } });
      process.exit(2);
    }

    // =====================================================================
    // 1) PREPARAÇÃO DA SESSÃO — fixtures próprias
    // =====================================================================
    const master = await prisma.user.create({
      data: {
        username: `golden_m_${suffix}`,
        displayName: 'Mestre Golden Path',
        passwordHash: await hashPassword(password),
        role: 'MASTER',
      },
    });
    userIds.push(master.id);
    const playerOne = await prisma.user.create({
      data: {
        username: `golden_p1_${suffix}`,
        displayName: 'Jogador Um',
        passwordHash: await hashPassword(password),
        role: 'PLAYER',
      },
    });
    userIds.push(playerOne.id);
    const playerTwo = await prisma.user.create({
      data: {
        username: `golden_p2_${suffix}`,
        displayName: 'Jogador Dois',
        passwordHash: await hashPassword(password),
        role: 'PLAYER',
      },
    });
    userIds.push(playerTwo.id);

    const tokenOf = (user: { id: string; username: string; displayName: string; role: string }) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'PLAYER' | 'MASTER',
      });
    const masterToken = tokenOf(master);
    const p1Token = tokenOf(playerOne);
    const p2Token = tokenOf(playerTwo);

    // ARMAS reais (arma marcial corpo a corpo, 1d8) e PV suficientes.
    const inventoryFor = (tag: string) =>
      inventoryListSchema.parse([
        {
          id: `espada-${tag}`,
          name: 'Espada Longa',
          slot: 'hand1',
          category: 'Arma',
          details: {
            weaponType: 'melee',
            weaponCategory: 'martial',
            damageDie: 8,
            damageType: 'Cortante',
            versatileDie: 10,
            properties: ['versatile'],
          },
        },
      ]);

    const characterOne = await prisma.character.create({
      data: {
        userId: playerOne.id,
        name: `Herói Um ${suffix}`,
        classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
        hpMax: 40,
        hpCurrent: 40,
        speed: 9,
        dexterity: 14,
        strength: 16,
        raceId: 'human',
        inventory: inventoryFor('um'),
      },
    });
    characterIds.push(characterOne.id);
    const characterTwo = await prisma.character.create({
      data: {
        userId: playerTwo.id,
        name: `Herói Dois ${suffix}`,
        classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
        hpMax: 40,
        hpCurrent: 40,
        speed: 7.5,
        dexterity: 12,
        strength: 16,
        raceId: 'human',
        inventory: inventoryFor('dois'),
      },
    });
    characterIds.push(characterTwo.id);

    const creature = await prisma.creature.create({
      data: {
        name: `Goblin ${suffix}`,
        kind: 'CREATURE',
        type: 'Humanoide',
        size: 'Medium',
        hpCurrent: 30,
        hpMax: 30,
        armorClass: 12,
        speed: 9,
        dexterity: 12,
      },
    });
    creatureIds.push(creature.id);

    const region = await prisma.region.create({ data: { name: `Região Golden ${suffix}` } });
    regionIds.push(region.id);
    const locality = await prisma.locality.create({
      data: { name: `Localidade Golden ${suffix}`, regionId: region.id },
    });
    localityIds.push(locality.id);

    // CENA grid-2d com imagem de teste + UMA parede (via API do Mestre).
    const sceneCreate = await http(`/api/localities/${locality.id}/scenes`, {
      token: masterToken,
      body: {
        name: `Cripta Golden ${suffix}`,
        spatialConfig: { mode: 'grid-2d', widthFeet: 40, heightFeet: 40 },
        backgroundImageUrl: `/uploads/scenes/golden-${suffix}.png`,
      },
    });
    const sceneId = String(sceneCreate.data.scene?.id ?? '');
    if (sceneId) sceneIds.push(sceneId);
    check(
      'GP02) Mestre cria a cena grid-2d com imagem de teste',
      sceneCreate.status === 201 &&
        sceneCreate.data.scene?.spatialConfig?.mode === 'grid-2d' &&
        sceneCreate.data.scene?.backgroundImageUrl === `/uploads/scenes/golden-${suffix}.png`,
      `status=${sceneCreate.status} ${JSON.stringify(sceneCreate.data).slice(0, 300)}`,
    );

    const sceneRead = await http(`/api/scenes/${sceneId}`, { token: masterToken });
    const wall = await http(`/api/scenes/${sceneId}/spatial/obstacles`, {
      token: masterToken,
      body: {
        start: { xFeet: 35, yFeet: 0 },
        end: { xFeet: 35, yFeet: 40 },
        expectedVersion: Number(sceneRead.data.scene?.version ?? 0),
        operationId: randomUUID(),
      },
    });
    check(
      'GP03) parede criada na cena e o jogador NÃO administra cena',
      wall.status === 200 &&
        (wall.data.scene?.obstacles ?? []).some(
          (item: any) => item.startXFeet === 35 || item.start?.xFeet === 35,
        ) &&
        (await http(`/api/scenes/${sceneId}/spatial/obstacles`, {
          token: p1Token,
          body: {
            start: { xFeet: 30, yFeet: 0 },
            end: { xFeet: 30, yFeet: 10 },
            expectedVersion: 0,
            operationId: randomUUID(),
          },
        })).status === 403,
      `status=${wall.status} ${JSON.stringify(wall.data).slice(0, 300)}`,
    );

    // Propriedade da ficha: cada jogador só lê a própria ficha pelo endpoint /me.
    const sheetOne = await http('/api/characters/me', { token: p1Token });
    const sheetTwo = await http('/api/characters/me', { token: p2Token });
    check(
      'GP04) propriedade das fichas: /me devolve a ficha do próprio token (nunca a do outro jogador)',
      sheetOne.status === 200 &&
        sheetOne.data.character?.id === characterOne.id &&
        sheetTwo.data.character?.id === characterTwo.id &&
        sheetOne.data.character?.id !== sheetTwo.data.character?.id,
      JSON.stringify({
        um: sheetOne.data.character?.id,
        dois: sheetTwo.data.character?.id,
      }),
    );
    const attackIdOne = characterDerivedAttacks(characterOne).find((item) =>
      item.id.startsWith('weapon:'),
    )?.id;
    const attackIdTwo = characterDerivedAttacks(characterTwo).find((item) =>
      item.id.startsWith('weapon:'),
    )?.id;
    check(
      'GP05) Hotbar/ataque derivados do servidor: a arma da ficha vira um ataque estável',
      Boolean(attackIdOne) &&
        Array.isArray(sheetOne.data.character?.derivedAttacks) &&
        (sheetOne.data.character?.derivedAttacks ?? []).some(
          (item: any) => item.id === attackIdOne,
        ) &&
        'hotbar' in (sheetOne.data.character ?? {}),
      `${attackIdOne} · derived=${JSON.stringify(sheetOne.data.character?.derivedAttacks ?? []).slice(0, 200)}`,
    );

    // =====================================================================
    // 2) INÍCIO DO COMBATE (fluxo real) + realtime de cada papel
    // =====================================================================
    const p1Socket = await connectSocket(p1Token);
    const p2Socket = await connectSocket(p2Token);
    const masterSocket = await connectSocket(masterToken);
    sockets.push(p1Socket, p2Socket, masterSocket);
    attachEventLog(p1Socket, 'p1');
    attachEventLog(p2Socket, 'p2');
    attachEventLog(masterSocket, 'mestre');

    const start = await http('/api/combat', {
      token: masterToken,
      body: { sceneId, localityId: locality.id, entries: [{ creatureId: creature.id, quantity: 1 }] },
    });
    let combat = start.data.combat as CombatDto | undefined;
    if (combat) combatIds.push(combat.id);
    const p1Id = combat ? combatantOfCharacter(combat, characterOne.id)?.id : undefined;
    const p2Id = combat ? combatantOfCharacter(combat, characterTwo.id)?.id : undefined;
    const npcId = combat?.combatants.find((item) => item.creatureId === creature.id)?.id;
    check(
      'GP06) Mestre inicia o combate com a CENA: participantes na ordem e aguardando iniciativa',
      start.status === 201 &&
        combat?.status === 'PENDING_INITIATIVE' &&
        combat?.sceneId === sceneId &&
        combat?.spatial.mode === 'grid-2d' &&
        combat?.obstacles.length === 1 &&
        Boolean(p1Id && p2Id && npcId),
      `status=${start.status} ${JSON.stringify(start.data).slice(0, 400)}`,
    );
    check(
      'GP07) o jogador NÃO inicia combate (autorização por papel)',
      (await http('/api/combat', {
        token: p1Token,
        body: { sceneId, entries: [{ creatureId: creature.id, quantity: 1 }] },
      })).status === 403,
    );

    // POSIÇÕES válidas (placement é SETUP do Mestre).
    const place = async (combatantId: string, xFeet: number, yFeet: number) => {
      const current = await http('/api/combat/active', { token: masterToken });
      const version = Number(current.data.combat?.version ?? 0);
      return http(`/api/combat/${combat!.id}/combatants/${combatantId}/spatial-position`, {
        method: 'PATCH',
        token: masterToken,
        body: { position: { xFeet, yFeet }, expectedVersion: version, operationId: randomUUID() },
      });
    };
    await place(p1Id!, 5, 5);
    await place(p2Id!, 25, 25);
    const placed = await place(npcId!, 10, 5);
    combat = placed.data.combat as CombatDto;
    check(
      'GP08) posições espaciais válidas publicadas na cena (5 pés entre Herói Um e o Goblin)',
      placed.status === 200 &&
        combat.combatants.every((item) => item.spatial?.position) &&
        combat.combatants.find((item) => item.id === p1Id)?.spatial?.position?.xFeet === 5,
      JSON.stringify(combat.combatants.map((item) => item.spatial?.position)),
    );

    // =====================================================================
    // 3) INICIATIVA — o servidor rola, ordena e ativa o primeiro turno
    // =====================================================================
    const p1Update = nextCombatUpdate(p1Socket);
    const rollOne = await http('/api/combat/initiative', { token: p1Token, body: {} });
    check(
      'GP09) jogador rola a própria iniciativa e recebe o combate por realtime',
      rollOne.status === 200 && (await p1Update) !== null,
    );
    await http('/api/combat/initiative', { token: p2Token, body: {} });
    const initiativeNpc = await http(`/api/combat/initiative/${npcId}`, {
      token: masterToken,
      body: {},
    });
    const afterInitiative = initiativeNpc.data.combat as CombatDto;
    combat = afterInitiative;
    const persisted = await prisma.combat.findUniqueOrThrow({
      where: { id: afterInitiative.id },
      select: { version: true, currentIndex: true, round: true, status: true },
    });
    const maxInitiative = Math.max(
      ...afterInitiative.combatants.map((item) => item.initiative ?? -1),
    );
    const currentOnStart = afterInitiative.combatants.find(
      (item) => item.id === afterInitiative.currentCombatantId,
    );
    check(
      'GP10) ordem calculada/persistida pelo servidor: todos rolaram, o maior recebe o turno',
      afterInitiative.status === 'ACTIVE' &&
        afterInitiative.combatants.every((item) => item.initiative !== null) &&
        currentOnStart?.initiative === maxInitiative &&
        persisted.currentIndex === afterInitiative.currentIndex &&
        persisted.round === afterInitiative.round,
      JSON.stringify({
        ordem: afterInitiative.combatants.map((item) => `${item.name}:${item.initiative}`),
        atual: currentOnStart?.name,
      }),
    );

    // =====================================================================
    // 4) TURNO DO JOGADOR — alcance, ataque real e economia
    // =====================================================================
    // Garante que o turno esteja com o Herói Um (o Mestre avança se preciso).
    let guard = 0;
    while (combat.currentCombatantId !== p1Id && guard < 4) {
      const advanced = await http('/api/combat/next-turn', {
        token: masterToken,
        body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
      });
      combat = advanced.data.combat as CombatDto;
      guard += 1;
    }
    check(
      'GP11) turno do Herói Um ativo com economia inicializada (1 Ação, 30 pés, Reação)',
      combat.currentCombatantId === p1Id &&
        combat.combatants.find((item) => item.id === p1Id)?.turnEconomy.actionsUsed === 0 &&
        combat.combatants.find((item) => item.id === p1Id)?.turnEconomy.movementBudget === 9,
    );

    const rangePreview = await http(
      `/api/combat/${combat.id}/spatial/range-preview?fromCombatantId=${p1Id}&toCombatantId=${npcId}&attackId=${encodeURIComponent(attackIdOne!)}`,
      { token: p1Token },
    );
    check(
      'GP12) alcance assistido pela arma (5 pés = dentro do reach, sem cálculo do cliente)',
      rangePreview.status === 200 &&
        rangePreview.data.range?.status === 'in-range' &&
        rangePreview.data.range?.distanceFeet === 5,
      JSON.stringify(rangePreview.data).slice(0, 300),
    );

    const operation = () => ({
      combatId: combat!.id,
      expectedVersion: combat!.version,
      operationId: randomUUID(),
    });
    // Alvo fora do alcance: recusa ANTES de gastar Ação/rolar dado.
    const outOfRange = await http('/api/combat/attack', {
      token: p1Token,
      body: { ...operation(), targetCombatantId: p2Id, attackId: attackIdOne },
    });
    const afterOutOfRange = (await http('/api/combat/active', { token: masterToken }))
      .data.combat as CombatDto;
    check(
      'GP13) alvo fora do alcance é recusado sem gastar Ação nem alterar o alvo',
      outOfRange.status === 409 &&
        (outOfRange.data.error === 'TARGET_OUT_OF_RANGE' ||
          outOfRange.data.error === 'TARGET_OUT_OF_REACH') &&
        afterOutOfRange.combatants.find((item) => item.id === p1Id)?.turnEconomy.actionsUsed === 0 &&
        afterOutOfRange.combatants.find((item) => item.id === p2Id)?.hpCurrent === 40,
      `status=${outOfRange.status} ${JSON.stringify(outOfRange.data).slice(0, 200)}`,
    );
    combat = afterOutOfRange;

    const targetBefore = combat.combatants.find((item) => item.id === npcId)!;
    const attackBody = { ...operation(), targetCombatantId: npcId, attackId: attackIdOne };
    const socketAtkVersions = [combat.version];
    // A versão-base é CAPTURADA: o predicado não pode ler a variável `combat`
    // depois de ela ser reatribuída com o próprio resultado da operação.
    const attackBaseVersion = combat.version;
    const attackUpdate = nextCombatUpdate(p1Socket, (next) => next.version > attackBaseVersion);
    const attack = await http('/api/combat/attack', { token: p1Token, body: attackBody });
    // O DTO do JOGADOR oculta PV/CA de criatura/NPC (privacidade no servidor), então
    // a conferência de dano lê a visão autoritativa do Mestre — a mesma versão.
    const playerAfterAttack = attack.data.combat as CombatDto;
    const masterAfterAttack = (await http('/api/combat/active', { token: masterToken }))
      .data.combat as CombatDto;
    const attackResult = attack.data.result ?? {};
    const natural = Number(attackResult.attackRoll);
    const expectedHit =
      natural === 20
        ? true
        : natural === 1
          ? false
          : attackResult.attackTotal >= (targetBefore.armorClass ?? 0);
    const targetAfter = masterAfterAttack.combatants.find((item) => item.id === npcId)!;
    const attackTotalOk =
      attackResult.attackTotal === natural + Number(attackResult.attackBonus);
    const hpOk = expectedHit
      ? Number(attackResult.damageRolled) > 0 &&
        targetAfter.hpCurrent ===
          (targetBefore.hpCurrent ?? 0) - Number(attackResult.damageRolled)
      : targetAfter.hpCurrent === targetBefore.hpCurrent;
    check(
      'GP14) ataque real pelo resolver: acerto/dano coerentes com o resultado do PRÓPRIO servidor',
      attack.status === 200 &&
        playerAfterAttack.version === masterAfterAttack.version &&
        natural >= 1 &&
        natural <= 20 &&
        attackTotalOk &&
        attackResult.hit === expectedHit &&
        hpOk,
      JSON.stringify({
        natural,
        total: attackResult.attackTotal,
        bonus: attackResult.attackBonus,
        caInformada: attackResult.targetArmorClass,
        hit: attackResult.hit,
        expectedHit,
        attackTotalOk,
        hpOk,
        hpAntes: targetBefore.hpCurrent,
        hpDepois: targetAfter.hpCurrent,
        dano: attackResult.damageRolled,
        versaoJogador: playerAfterAttack.version,
        versaoMestre: masterAfterAttack.version,
      }),
    );
    check(
      'GP15) Attack Action consome UMA Ação e o turno continua autoritativo',
      masterAfterAttack.combatants.find((item) => item.id === p1Id)?.turnEconomy.actionsUsed ===
        1 &&
        masterAfterAttack.combatants.find((item) => item.id === p1Id)?.turnEconomy.attackAction
          ?.attacksMade === 1 &&
        masterAfterAttack.combatants.find((item) => item.id === p1Id)?.turnEconomy.attackAction
          ?.attacksAllowed === 1,
      JSON.stringify(masterAfterAttack.combatants.find((item) => item.id === p1Id)?.turnEconomy),
    );
    const eventAfterAttack = await attackUpdate;
    check(
      'GP16) `combat:updated` chega ao jogador com a MESMA versão persistida e sem PV de NPC',
      eventAfterAttack !== null &&
        eventAfterAttack.version === masterAfterAttack.version &&
        eventAfterAttack.combatants.find((item) => item.id === npcId)?.hpCurrent === null &&
        targetAfter.hpCurrent !== null,
      JSON.stringify({
        evento: eventAfterAttack?.version,
        dto: masterAfterAttack.version,
        hpOculto: eventAfterAttack?.combatants.find((item) => item.id === npcId)?.hpCurrent,
      }),
    );
    socketAtkVersions.push(masterAfterAttack.version);
    combat = masterAfterAttack;

    // Retry com a MESMA operationId: devolve snapshot, não aplica dano de novo.
    const replay = await http('/api/combat/attack', { token: p1Token, body: attackBody });
    const afterReplay = (await http('/api/combat/active', { token: masterToken }))
      .data.combat as CombatDto;
    check(
      'GP17) retry idempotente não duplica ataque, dano nem consumo de Ação',
      replay.status === 200 &&
        replay.data.replayed === true &&
        replay.data.result?.attackRoll === attackResult.attackRoll &&
        afterReplay.combatants.find((item) => item.id === npcId)?.hpCurrent === targetAfter.hpCurrent &&
        afterReplay.combatants.find((item) => item.id === p1Id)?.turnEconomy.actionsUsed === 1,
      JSON.stringify({ replayed: replay.data.replayed, hp: afterReplay.combatants.find((item) => item.id === npcId)?.hpCurrent }),
    );
    combat = afterReplay;

    // Sem Ação restante, executar outro ataque é recusado.
    const noAction = await http('/api/combat/attack', {
      token: p1Token,
      body: { ...operation(), targetCombatantId: npcId, attackId: attackIdOne },
    });
    const afterNoAction = (await http('/api/combat/active', { token: masterToken }))
      .data.combat as CombatDto;
    check(
      'GP18) sem recurso não há execução adicional (Ação já gasta) e nada muda',
      noAction.status === 409 &&
        afterNoAction.combatants.find((item) => item.id === npcId)?.hpCurrent ===
          combat.combatants.find((item) => item.id === npcId)?.hpCurrent &&
        afterNoAction.combatants.find((item) => item.id === p1Id)?.turnEconomy.actionsUsed === 1,
      `status=${noAction.status} ${JSON.stringify(noAction.data).slice(0, 200)}`,
    );
    combat = afterNoAction;

    // =====================================================================
    // 5) MOVIMENTO — preview, commit, inválido e idempotência
    // =====================================================================
    const p1BeforeMove = combat.combatants.find((item) => item.id === p1Id)!;
    const stepPath = [
      { xFeet: 5, yFeet: 10 },
      { xFeet: 10, yFeet: 10 },
    ];
    const preview = await http(`/api/combat/${combat.id}/spatial/movement-preview`, {
      token: p1Token,
      body: { combatantId: p1Id, path: stepPath },
    });
    check(
      'GP06.P) preview read-only do caminho (2 passos de 5 pés = 10 pés) sem gravar nada',
      preview.status === 200 &&
        preview.data.movement?.legal === true &&
        preview.data.movement?.totalCostFeet === 10 &&
        (await http('/api/combat/active', { token: masterToken })).data.combat?.version ===
          combat.version,
      JSON.stringify(preview.data).slice(0, 300),
    );

    // `movementCommitSchema` é `.strict()`: o id do combate vive na URL, não no corpo.
    const moveBody = {
      combatantId: p1Id,
      path: stepPath,
      expectedVersion: combat.version,
      operationId: randomUUID(),
    };
    const moveBaseVersion = combat.version;
    const moveUpdate = nextCombatUpdate(p1Socket, (next) => next.version > moveBaseVersion);
    const move = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: p1Token,
      body: moveBody,
    });
    const movedCombat = move.data.combat as CombatDto | undefined;
    check(
      'GP19.0) commit do movimento devolve o combate autoritativo',
      move.status === 200 && Boolean(movedCombat),
      `status=${move.status} ${JSON.stringify(move.data).slice(0, 400)}`,
    );
    if (!movedCombat) throw new Error(`movement commit falhou (${move.status})`);
    combat = movedCombat;
    const p1AfterMove = combat.combatants.find((item) => item.id === p1Id)!;
    const moved = move.data.movement ?? {};
    check(
      'GP19) commit grava a posição e publica o evento com a MESMA versão persistida',
      move.status === 200 &&
        p1AfterMove.spatial?.position?.xFeet === 10 &&
        p1AfterMove.spatial?.position?.yFeet === 10 &&
        (await moveUpdate) !== null,
      JSON.stringify({
        posicao: p1AfterMove.spatial?.position,
        eventos: eventLog.slice(-6),
      }),
    );
    // A ficha/economia legadas persistem METROS; o caminho e seu DTO usam PÉS.
    // Antes, speed: 30 representava 30 m, não os 30 pés presumidos pelo teste.
    check(
      'GP19.U) orçamento 9 m − custo 3 m = 6 m (30 pés − 10 pés = 20 pés)',
      moved.totalCostFeet === 10 &&
        moved.movementRemainingAfterFeet === 20 &&
        p1AfterMove.turnEconomy.movementBudget === 9 &&
        p1AfterMove.turnEconomy.movementUsed === 3,
      JSON.stringify({
        custoFeet: moved.totalCostFeet,
        restanteFeet: moved.movementRemainingAfterFeet,
        economia: p1AfterMove.turnEconomy,
      }),
    );

    // Caminho livre de paredes/ocupantes: a recusa aqui precisa ser pelo saldo.
    const caminhoExcedente = [
      { xFeet: 15, yFeet: 10 }, { xFeet: 20, yFeet: 10 }, { xFeet: 25, yFeet: 10 },
      { xFeet: 25, yFeet: 15 }, { xFeet: 25, yFeet: 20 },
    ];
    const excedente = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: p1Token,
      body: { combatantId: p1Id, path: caminhoExcedente,
        expectedVersion: combat.version, operationId: randomUUID() },
    });
    const aposExcedente = (await http('/api/combat/active', { token: masterToken })).data.combat;
    check('GP19.S) caminho de 25 pés excede saldo de 20: servidor recusa sem mudar estado',
      excedente.status === 409 && excedente.data.error === 'MOVEMENT_INSUFFICIENT_REMAINING' &&
      aposExcedente.version === combat.version &&
      same(aposExcedente.combatants.find((item: any) => item.id === p1Id)?.turnEconomy, p1AfterMove.turnEconomy) &&
      same(aposExcedente.combatants.find((item: any) => item.id === p1Id)?.spatial, p1AfterMove.spatial),
      JSON.stringify(excedente.data));

    const invalidPath = [{ xFeet: 20, yFeet: 10 }];
    const invalidPreview = await http(`/api/combat/${combat.id}/spatial/movement-preview`, {
      token: p1Token,
      body: { combatantId: p1Id, path: invalidPath },
    });
    const invalidCommit = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: p1Token,
      body: {
        combatantId: p1Id,
        path: invalidPath,
        expectedVersion: combat.version,
        operationId: randomUUID(),
      },
    });
    const afterInvalid = (await http('/api/combat/active', { token: masterToken }))
      .data.combat as CombatDto;
    check(
      'GP20) movimento inválido (salto de 10 pés num passo) não altera posição, Movimento nem versão',
      invalidPreview.data.movement?.legal === false &&
        invalidCommit.status >= 400 &&
        afterInvalid.version === combat.version &&
        afterInvalid.combatants.find((item) => item.id === p1Id)?.spatial?.position?.xFeet === 10 &&
        afterInvalid.combatants.find((item) => item.id === p1Id)?.turnEconomy.movementUsed ===
          p1AfterMove.turnEconomy.movementUsed,
      JSON.stringify({ preview: invalidPreview.data.movement?.blocker, commit: invalidCommit.status }),
    );
    combat = afterInvalid;

    const replayMove = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: p1Token,
      body: moveBody,
    });
    check(
      'GP21) retry do mesmo commit de movimento devolve snapshot (replayed) sem segundo gasto',
      replayMove.status === 200 && replayMove.data.replayed === true,
      JSON.stringify(replayMove.data).slice(0, 200),
    );

    // =====================================================================
    // 6) ALTERNÂNCIA DE TURNOS — autorização e avanço autoritativo
    // =====================================================================
    const denied = await http('/api/combat/next-turn', {
      token: p2Token,
      body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
    });
    check(
      'GP22) outro jogador NÃO encerra turno alheio (403) e o estado não muda',
      denied.status === 403 &&
        (await http('/api/combat/active', { token: masterToken })).data.combat?.version ===
          combat.version,
      `status=${denied.status}`,
    );

    const beforeEnd = combat;
    const endUpdate = nextCombatUpdate(p2Socket);
    const ended = await http('/api/combat/next-turn', {
      token: p1Token,
      body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
    });
    combat = ended.data.combat as CombatDto;
    check(
      'GP23) o dono encerra o próprio turno: índice/rodada avançam e o realtime avisa a mesa',
      ended.status === 200 &&
        combat.currentCombatantId !== beforeEnd.currentCombatantId &&
        (combat.round > beforeEnd.round ||
          (combat.round === beforeEnd.round && combat.currentIndex !== beforeEnd.currentIndex)) &&
        (await endUpdate) !== null,
      JSON.stringify({
        antes: { rodada: beforeEnd.round, indice: beforeEnd.currentIndex },
        depois: { rodada: combat.round, indice: combat.currentIndex },
      }),
    );

    // Chega ao turno do Herói Dois para o ciclo de morte (economia recomeça).
    guard = 0;
    while (combat.currentCombatantId !== p2Id && guard < 4) {
      const advanced = await http('/api/combat/next-turn', {
        token: masterToken,
        body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
      });
      combat = advanced.data.combat as CombatDto;
      guard += 1;
    }
    const p2Economy = combat.combatants.find((item) => item.id === p2Id)?.turnEconomy;
    check(
      'GP24) novo turno do Herói Dois recomeça a economia (Ação/Movimento/Reação)',
      combat.currentCombatantId === p2Id &&
        p2Economy?.actionsUsed === 0 &&
        p2Economy?.movementUsed === 0 &&
        p2Economy?.reactionAvailable === true,
      JSON.stringify(p2Economy),
    );

    // O segundo personagem preserva 7,5 m (25 pés), inclusive ao misturar APIs.
    const segundoMovimento = await http('/api/combat/action', {
      token: p2Token,
      body: { combatId: combat.id, combatantId: p2Id, action: 'move', distance: 3,
        expectedVersion: combat.version, operationId: randomUUID() },
    });
    if (segundoMovimento.data.combat) combat = segundoMovimento.data.combat as CombatDto;
    const economiaSegundo = combat.combatants.find((item) => item.id === p2Id)!.turnEconomy;
    check('GP24.U) personagem de 7,5 m: mover 3 m pela Action Economy deixa 15 pés',
      segundoMovimento.status === 200 && economiaSegundo.movementBudget === 7.5 &&
      economiaSegundo.movementUsed === 3 && remainingMovementFeet(7.5, economiaSegundo.movementUsed) === 15,
      JSON.stringify(economiaSegundo));

    const segundoEspacial = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: p2Token,
      body: { combatantId: p2Id, path: [{ xFeet: 25, yFeet: 30 }, { xFeet: 25, yFeet: 35 }],
        expectedVersion: combat.version, operationId: randomUUID() },
    });
    if (segundoEspacial.data.combat) combat = segundoEspacial.data.combat as CombatDto;
    check('GP24.E) API de economia e motor espacial compartilham saldo: 25 − 10 − 10 = 5 pés',
      segundoEspacial.status === 200 && segundoEspacial.data.movement?.movementRemainingAfterFeet === 5 &&
      combat.combatants.find((item) => item.id === p2Id)?.turnEconomy.movementUsed === 6,
      JSON.stringify(segundoEspacial.data.movement));

    // =====================================================================
    // 7) RECONEXÃO em ponto intermediário — sem segundo store no cliente
    // =====================================================================
    const midCombat = combat;
    p1Socket.disconnect();
    const reloaded = (await http('/api/combat/active', { token: p1Token }))
      .data.combat as CombatDto;
    const prismaRow = await prisma.combat.findUniqueOrThrow({
      where: { id: midCombat.id },
      select: { version: true, currentIndex: true, round: true },
    });
    check(
      'GP25) reconexão/refresh reproduz o estado persistido (versão, turno e economia)',
      reloaded.version === midCombat.version &&
        reloaded.currentCombatantId === midCombat.currentCombatantId &&
        prismaRow.version === midCombat.version &&
        prismaRow.currentIndex === midCombat.currentIndex &&
        prismaRow.round === midCombat.round &&
        same(
          reloaded.combatants.find((item) => item.id === p1Id)?.turnEconomy,
          midCombat.combatants.find((item) => item.id === p1Id)?.turnEconomy,
        ),
      JSON.stringify({ dto: midCombat.version, http: reloaded.version, banco: prismaRow.version }),
    );
    const p1SocketAgain = await connectSocket(p1Token);
    sockets.push(p1SocketAgain);
    attachEventLog(p1SocketAgain, 'p1r');
    check(
      'GP26) nova conexão volta a receber `combat:updated` (canal de notificação, não de escrita)',
      await (async () => {
        const waiting = nextCombatUpdate(p1SocketAgain);
        const bumped = await http('/api/combat/next-turn', {
          token: masterToken,
          body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
        });
        combat = bumped.data.combat as CombatDto;
        return bumped.status === 200 && (await waiting) !== null;
      })(),
    );

    // Privacidade: o DTO do jogador NÃO traz números nem morte de criatura/NPC.
    const playerView = (await http('/api/combat/active', { token: p1Token })).data
      .combat as CombatDto;
    const masterView = (await http('/api/combat/active', { token: masterToken })).data
      .combat as CombatDto;
    const npcForPlayer = playerView.combatants.find((item) => item.id === npcId)!;
    const npcForMaster = masterView.combatants.find((item) => item.id === npcId)!;
    check(
      'GP27) privacidade de NPC: PV/CA e ciclo de morte são privados do Mestre',
      npcForPlayer.hpCurrent === null &&
        npcForPlayer.armorClass === null &&
        npcForPlayer.deathState === null &&
        npcForPlayer.statsHidden === true &&
        npcForMaster.hpCurrent !== null &&
        npcForMaster.statsHidden === false,
      JSON.stringify({
        jogador: { hp: npcForPlayer.hpCurrent, ca: npcForPlayer.armorClass, oculto: npcForPlayer.statsHidden },
        mestre: { hp: npcForMaster.hpCurrent },
      }),
    );

    // =====================================================================
    // 8) DANO, 0 PV E TESTE CONTRA A MORTE (motores existentes)
    // =====================================================================
    // O Herói Dois cai a 0 PV por operação AUTORIZADA do Mestre (dano manual).
    guard = 0;
    while (combat.currentCombatantId !== p2Id && guard < 4) {
      const advanced = await http('/api/combat/next-turn', {
        token: masterToken,
        body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
      });
      combat = advanced.data.combat as CombatDto;
      guard += 1;
    }
    // Dano EXATO até 0 PV: um valor acima do PV máximo seria morte instantânea
    // (PHB 2014) e este trecho precisa do ciclo de Testes contra a Morte.
    const p2BeforeZero = combat.combatants.find((item) => item.id === p2Id)!;
    const zeroed = await http('/api/combat/hp', {
      token: masterToken,
      body: {
        combatantId: p2Id,
        amount: Math.max(1, p2BeforeZero.hpCurrent ?? 1),
        mode: 'damage',
      },
    });
    combat = zeroed.data.combat as CombatDto;
    const p2Death = combat.combatants.find((item) => item.id === p2Id)!;
    const unconscious = (p2Death.mechanicalState?.conditions ?? []).some(
      (item: any) => item.id === 'unconscious' || item.condition === 'unconscious',
    );
    check(
      'GP28) 0 PV na operação existente: Inconsciente + ciclo de morte, sem F5',
      zeroed.status === 200 &&
        p2Death.hpCurrent === 0 &&
        p2Death.deathState?.deathSaves === true &&
        p2Death.deathBlocksActions === true &&
        unconscious,
      JSON.stringify({
        hp: p2Death.hpCurrent,
        morte: p2Death.deathState,
        condicoes: p2Death.mechanicalState?.conditions,
      }),
    );
    check(
      'GP29) ficha do Herói Dois reflete o dano (nenhum valor paralelo no cliente)',
      (await http('/api/characters/me', { token: p2Token })).data.character?.hpCurrent === 0,
    );

    // Exige o turno do Herói Dois (o dano pode ter chegado no turno dele ou não).
    guard = 0;
    while (combat.currentCombatantId !== p2Id && guard < 4) {
      const advanced = await http('/api/combat/next-turn', {
        token: masterToken,
        body: {
          combatId: combat.id,
          expectedVersion: combat.version,
          operationId: randomUUID(),
          skipDeathSave: true,
        },
      });
      combat = advanced.data.combat as CombatDto;
      guard += 1;
    }
    const attackAsDying = await http('/api/combat/attack', {
      token: p2Token,
      body: {
        combatId: combat.id,
        expectedVersion: combat.version,
        operationId: randomUUID(),
        targetCombatantId: npcId,
        attackId: attackIdTwo ?? attackIdOne,
      },
    });
    const moveAsDying = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: p2Token,
      body: { combatantId: p2Id, path: [{ xFeet: 30, yFeet: 25 }], expectedVersion: combat.version, operationId: randomUUID() },
    });
    check(
      'GP30) a 0 PV não há ataque nem movimento (impedimento no servidor)',
      attackAsDying.status === 409 && moveAsDying.status >= 400,
      JSON.stringify({ ataque: attackAsDying.status, movimento: moveAsDying.status }),
    );

    const endBeforeSave = await http('/api/combat/next-turn', {
      token: p2Token,
      body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
    });
    check(
      'GP31) encerrar turno sem rolar o Teste Contra a Morte é recusado (409 DEATH_SAVE_PENDING)',
      endBeforeSave.status === 409 && endBeforeSave.data.error === 'DEATH_SAVE_PENDING',
      `status=${endBeforeSave.status} ${JSON.stringify(endBeforeSave.data).slice(0, 200)}`,
    );

    const beforeRoll = (await http('/api/combat/active', { token: masterToken }))
      .data.combat.combatants.find((item: any) => item.id === p2Id).deathState;
    // O pool é obrigatório no schema (o servidor sempre rola UM d20 e ignora o resto).
    const deathRoll = await http('/api/dice/roll', {
      token: p2Token,
      body: { kind: 'death-save', dice: [{ sides: 20 }] },
    });
    const rolled = Number(deathRoll.data.roll?.dice?.[0]?.value);
    const secondRoll = await http('/api/dice/roll', {
      token: p2Token,
      body: { kind: 'death-save', dice: [{ sides: 20 }] },
    });
    const afterDeathState = (await http('/api/combat/active', { token: masterToken }))
      .data.combat.combatants.find((item: any) => item.id === p2Id);
    const death = afterDeathState.deathState;
    const expectedDelta =
      rolled === 20
        ? { successes: 0, failures: 0, revived: true }
        : rolled === 1
          ? { successes: 0, failures: 2, revived: false }
          : rolled >= 10
            ? { successes: 1, failures: 0, revived: false }
            : { successes: 0, failures: 1, revived: false };
    const deltaOk =
      rolled === 20
        ? afterDeathState.hpCurrent === 1 && death?.deathSaves === false
        : death?.successes === (beforeRoll?.successes ?? 0) + expectedDelta.successes &&
          death?.failures === (beforeRoll?.failures ?? 0) + expectedDelta.failures;
    check(
      'GP32) Teste Contra a Morte é do SERVIDOR, aplicado uma única vez por turno (regra do PHB)',
      deathRoll.status === 201 &&
        deathRoll.data.roll?.kind === 'death-save' &&
        rolled >= 1 &&
        rolled <= 20 &&
        deltaOk &&
        secondRoll.status === 409,
      JSON.stringify({ rolado: rolled, antes: beforeRoll, depois: death, segundo: secondRoll.status }),
    );
    check(
      'GP33) Registro/estado de morte publicado para o Mestre e decisão pendente respeitada',
      (death?.successes ?? 0) + (death?.failures ?? 0) <= 4 &&
        (death?.failures === 3 ? death?.pending !== null : true) &&
        (death?.successes === 3 ? death?.stabilized === true : true),
      JSON.stringify(death),
    );

    // Depois de rolar, o turno pode ser encerrado (sucesso/falha/estabilização).
    const endAfterSave = await http('/api/combat/next-turn', {
      token: p2Token,
      body: { combatId: combat.id, expectedVersion: (await http('/api/combat/active', { token: masterToken })).data.combat.version, operationId: randomUUID() },
    });
    check(
      'GP34) encerramento liberado depois do Teste contra a Morte',
      endAfterSave.status === 200,
      `status=${endAfterSave.status} ${JSON.stringify(endAfterSave.data).slice(0, 200)}`,
    );
    combat = (endAfterSave.data.combat ?? combat) as CombatDto;

    // NPC usa o mesmo contrato: 9 m de base, 10 pés percorridos, 20 restantes.
    guard = 0;
    while (combat.currentCombatantId !== npcId && guard++ < 4) {
      const avancar = await http('/api/combat/next-turn', {
        token: masterToken,
        body: { combatId: combat.id, expectedVersion: combat.version, operationId: randomUUID() },
      });
      if (!avancar.data.combat) throw new Error('Não foi possível chegar ao turno do NPC');
      combat = avancar.data.combat as CombatDto;
    }
    const movimentoNpc = await http(`/api/combat/${combat.id}/spatial/movement`, {
      token: masterToken,
      body: { combatantId: npcId, path: [{ xFeet: 15, yFeet: 5 }, { xFeet: 20, yFeet: 5 }],
        expectedVersion: combat.version, operationId: randomUUID() },
    });
    if (movimentoNpc.data.combat) combat = movimentoNpc.data.combat as CombatDto;
    const economiaNpc = combat.combatants.find((item) => item.id === npcId)!.turnEconomy;
    check('GP34.N) NPC de 9 m compartilha conversão e orçamento: 30 − 10 = 20 pés',
      movimentoNpc.status === 200 && movimentoNpc.data.movement?.movementRemainingAfterFeet === 20 &&
      economiaNpc.movementBudget === 9 && economiaNpc.movementUsed === 3,
      JSON.stringify({ economiaNpc, movimento: movimentoNpc.data.movement }));

    // =====================================================================
    // 9) ENCERRAMENTO DO COMBATE
    // =====================================================================
    // Encerrar publica `combat:ended` (evento próprio), não `combat:updated`.
    const endUpdateForPlayer = nextSocketEvent<{ combatId: string }>(
      p1SocketAgain,
      'combat:ended',
    );
    const finalEnd = await http('/api/combat/end', { token: masterToken, body: {} });
    const noActive = await http('/api/combat/active', { token: p1Token });
    const activeRow = await prisma.combat.findUniqueOrThrow({
      where: { id: combat.id },
      select: { status: true, endedAt: true },
    });
    check(
      'GP35) Mestre encerra o combate: persistência, realtime e nenhum turno ativo',
      finalEnd.status === 200 &&
        activeRow.status === 'ENDED' &&
        activeRow.endedAt !== null &&
        noActive.data.combat === null &&
        (await endUpdateForPlayer)?.combatId === combat.id,
      JSON.stringify({ end: finalEnd.data, status: activeRow.status, ativo: noActive.data.combat }),
    );
    const postCombatAttack = await http('/api/combat/attack', {
      token: p1Token,
      body: {
        combatId: combat.id,
        expectedVersion: combat.version,
        operationId: randomUUID(),
        targetCombatantId: npcId!,
        attackId: attackIdOne!,
      },
    });
    check(
      'GP36) nenhuma ação é autorizada usando a sessão encerrada',
      postCombatAttack.status >= 400,
      `status=${postCombatAttack.status} ${JSON.stringify(postCombatAttack.data).slice(0, 200)}`,
    );

    // Consequências LEGÍTIMAS preservadas: o dano da sessão fica; nada é curado.
    const sheetAfter = await http('/api/characters/me', { token: p2Token });
    const p1SheetAfter = await http('/api/characters/me', { token: p1Token });
    check(
      'GP37) fichas mantêm só as consequências reais (sem cura/descanso automáticos)',
      sheetAfter.data.character?.hpCurrent === (rolled === 20 ? 1 : 0) &&
        p1SheetAfter.data.character?.hpCurrent === 40 &&
        p1SheetAfter.data.character?.id === characterOne.id,
      JSON.stringify({
        um: p1SheetAfter.data.character?.hpCurrent,
        dois: sheetAfter.data.character?.hpCurrent,
      }),
    );

    // Divisão de versão: cada mutação autoritativa incrementou `Combat.version`.
    check(
      'GP38) toda mutação relevante incrementou a versão do combate (sem dois estados na mesma versão)',
      socketAtkVersions.length === 2 && socketAtkVersions[1] > socketAtkVersions[0],
      JSON.stringify(socketAtkVersions),
    );
  } finally {
    for (const socket of sockets) {
      try {
        socket.disconnect();
      } catch {
        // conexão já encerrada
      }
    }

    // --- Limpeza: SÓ os IDs criados por esta execução ----------------------
    for (const combatId of combatIds) {
      for (const remove of [
        () => prisma.combatOperation.deleteMany({ where: { combatId } }),
        () => prisma.movementIntent.deleteMany({ where: { combatId } }),
        () => prisma.spellCast.deleteMany({ where: { combatId } }),
      ]) {
        try {
          await remove();
        } catch {
          // dependência opcional nesta sessão
        }
      }
    }
    for (const sceneId of sceneIds) {
      await prisma.scene.deleteMany({ where: { id: sceneId } }).catch(() => undefined);
    }
    for (const combatId of combatIds) {
      await prisma.combat.deleteMany({ where: { id: combatId } }).catch(() => undefined);
    }
    for (const id of localityIds) {
      await prisma.locality.deleteMany({ where: { id } }).catch(() => undefined);
    }
    for (const id of regionIds) {
      await prisma.region.deleteMany({ where: { id } }).catch(() => undefined);
    }
    for (const id of characterIds) {
      await prisma.character.deleteMany({ where: { id } }).catch(() => undefined);
    }
    for (const id of creatureIds) {
      await prisma.creature.deleteMany({ where: { id } }).catch(() => undefined);
    }
    for (const id of userIds) {
      await prisma.user.deleteMany({ where: { id } }).catch(() => undefined);
    }

    // --- Integridade do estado real: ANTES = DEPOIS -----------------------
    const after = await diffProtectedGameState(before);
    let leftovers = 0;
    for (const ids of [userIds, characterIds, creatureIds, combatIds, sceneIds, localityIds, regionIds]) {
      for (const id of ids) {
        const found =
          (await prisma.user.count({ where: { id } })) +
          (await prisma.character.count({ where: { id } })) +
          (await prisma.creature.count({ where: { id } })) +
          (await prisma.combat.count({ where: { id } })) +
          (await prisma.scene.count({ where: { id } })) +
          (await prisma.locality.count({ where: { id } })) +
          (await prisma.region.count({ where: { id } }));
        leftovers += found;
      }
    }
    const restored = after.total > 0
      ? await restoreProtectedGameState(before, after)
      : { restored: 0, refused: [] };
    check(
      'GP39) integridade: nenhuma ficha/NPC real mudou e nenhuma fixture ficou no banco',
      after.total === 0 && leftovers === 0 && restored.refused.length === 0,
      JSON.stringify({ diff: after.description, leftovers, refused: restored.refused }),
    );
  }

  await prisma.$disconnect();

  if (failures > 0) {
    console.log(`\n✘ Golden Path: ${failures} verificação(ões) falharam.`);
    for (const item of failed) console.log(`  • ${item.label}`);
    console.log(
      '\nPreencha o relatório com a PRIMEIRA lacuna P0 acima (severidade + causa) antes de encerrar a microfase.',
    );
    process.exit(1);
  }
  console.log('\n✔ Golden Path de sessão jogável: TODAS as verificações passaram.');
}

main().catch(async (error) => {
  console.error('\n✘ Golden Path abortou:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
