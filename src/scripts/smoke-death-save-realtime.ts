import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { setBroadcaster } from '../realtime/hub.js';
import { applyDeathSave, type DeathActor } from '../modules/death/death.service.js';
import { deathStateOf, type DeathState } from '../modules/shared/death.js';
import { GRID_CELL_SIZE_FEET } from '../modules/combat/spatial/spatial.types.js';
import type { CombatDto, CombatantDto } from '../modules/combat/combat.dto.js';
import type { DeathDto } from '../modules/death/death.service.js';
import type { MechanicalEntity } from '../modules/shared/conditions.js';

/**
 * SMOKE 6.6M.8.3 — TESTE CONTRA A MORTE: REALTIME + ENCERRAR TURNO.
 *
 * Duas regressões são provadas aqui, com servidor de verdade (HTTP + Socket.io):
 *
 *  1. CONTABILIZAÇÃO SEM F5: depois de `POST /api/dice/roll` (kind
 *     `death-save`), o que os DOIS clientes recebem (`combat:updated`,
 *     `death:updated`, `sheet:updated`) precisa carregar o contador novo, o
 *     `saveTurnKey` do turno e a versão da ficha — e ser IDÊNTICO ao que um F5
 *     lê (`GET /api/combat/active` / `GET /api/death/...`).
 *  2. ENCERRAR TURNO: o SERVIDOR decide. Antes do Teste obrigatório recusa
 *     (`DEATH_SAVE_PENDING`); depois do Teste aceita; estabilizado aceita;
 *     com decisão do Mestre pendente o jogador não avança (o Mestre avança com
 *     confirmação explícita). Encerrar o turno nunca rola outro Teste.
 *
 * SEGURANÇA DOS DADOS: o script NUNCA roda em banco de verdade. Exige
 * `DATABASE_URL` com `?schema=` cujo nome contenha "smoke" e um servidor
 * apontando para o MESMO schema (`DEATH_RT_SMOKE_BASE_URL`). Todas as fixtures
 * são próprias e só os IDs criados aqui são apagados no fim.
 *
 * Uso:
 *   DEATH_RT_SMOKE_BASE_URL=http://localhost:3100 \
 *   DATABASE_URL=postgresql://.../grimorio?schema=death_rt_smoke \
 *   npx tsx src/scripts/smoke-death-save-realtime.ts
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`✔ ${label}`);
  else {
    failures += 1;
    console.log(`✘ ${label}${detail ? `\n    ${detail}` : ''}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Captured {
  event: string;
  role: 'player' | 'master';
  payload: any;
}

async function main(): Promise<void> {
  const baseUrl = process.env.DEATH_RT_SMOKE_BASE_URL ?? '';
  if (!baseUrl) {
    console.error('ABORTADO: defina DEATH_RT_SMOKE_BASE_URL (servidor no schema descartável).');
    process.exit(2);
  }
  // Guarda PRIMÁRIA: o nome do schema precisa declarar que é descartável. A
  // ausência de combates ativos não prova nada sobre o banco ser de teste.
  const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '';
  if (!/smoke/i.test(schema) || schema === 'public') {
    console.error(
      `ABORTADO: DATABASE_URL precisa de ?schema=<algo com "smoke"> (recebido: "${schema || 'nenhum'}").`,
    );
    process.exit(2);
  }

  // Este processo roda os casos DETERMINÍSTICOS chamando o serviço direto (sem
  // `io`): o broadcaster no-op evita o ruído "camada de tempo real não
  // inicializada" sem inventar publicação nenhuma.
  setBroadcaster({
    toUser: () => undefined,
    toMasters: () => undefined,
    toPlayers: () => undefined,
    toTable: () => undefined,
    disconnectUser: () => undefined,
    presence: () => undefined,
  });

  const suffix = randomUUID().slice(0, 8);
  const sockets: Socket[] = [];
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const regionIds: string[] = [];
  const localityIds: string[] = [];
  const sceneIds: string[] = [];
  const combatIds: string[] = [];
  const events: Captured[] = [];

  const connect = async (token: string, role: 'player' | 'master'): Promise<Socket> => {
    const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'], auth: { token } });
    sockets.push(socket);
    for (const event of ['combat:updated', 'death:updated', 'sheet:updated', 'dice:roll']) {
      socket.on(event, (payload: unknown) => events.push({ event, role, payload }));
    }
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  };

  const request = async (
    path: string,
    body: unknown | undefined,
    auth: string,
  ): Promise<{ status: number; data: any }> => {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json().catch(() => ({}))) as any };
  };

  try {
    const master = await prisma.user.create({
      data: { username: `drx_m_${suffix}`, displayName: 'Mestre Realtime', passwordHash: 'fixture', role: 'MASTER' },
    });
    const player = await prisma.user.create({
      data: { username: `drx_p_${suffix}`, displayName: 'Jogador Realtime', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, player.id);
    const masterToken = signToken({
      sub: master.id,
      username: master.username,
      displayName: master.displayName,
      role: master.role,
    });
    const playerToken = signToken({
      sub: player.id,
      username: player.username,
      displayName: player.displayName,
      role: player.role,
    });
    const masterActor: DeathActor = { userId: master.id, username: master.username, role: 'MASTER' };
    const playerActor: DeathActor = { userId: player.id, username: player.username, role: 'PLAYER' };

    const region = await prisma.region.create({ data: { name: `Região RT ${suffix}` } });
    regionIds.push(region.id);
    const locality = await prisma.locality.create({ data: { name: `Local RT ${suffix}`, regionId: region.id } });
    localityIds.push(locality.id);
    const scene = await prisma.scene.create({
      data: {
        localityId: locality.id,
        name: `Cripta RT ${suffix}`,
        spatialConfig: { mode: 'grid-2d', widthFeet: 30, heightFeet: 24, cellSizeFeet: GRID_CELL_SIZE_FEET },
        backgroundImageUrl: `/uploads/scenes/rt-${suffix}.png`,
      },
    });
    sceneIds.push(scene.id);
    await prisma.spatialObstacle.create({
      data: {
        sceneId: scene.id,
        kind: 'wall',
        startXFeet: 6,
        startYFeet: 6,
        endXFeet: 12,
        endYFeet: 6,
      },
    });

    const character = await prisma.character.create({
      data: {
        userId: player.id,
        name: 'Herói Realtime',
        hpMax: 20,
        hpCurrent: 0,
        speed: 9,
        raceId: 'human',
        classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
        deathState: deathStateOf({ deathSaves: true }) as never,
      },
    });
    characterIds.push(character.id);
    const npc = await prisma.creature.create({
      data: {
        name: `Sombra RT ${suffix}`,
        kind: 'CREATURE',
        type: 'Morto-vivo',
        size: 'Medium',
        hpCurrent: 13,
        hpMax: 13,
        armorClass: 13,
        speed: 9,
      },
    });
    creatureIds.push(npc.id);

    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        round: 1,
        currentIndex: 0,
        turnSequence: 1,
        localityId: locality.id,
        sceneId: scene.id,
        spatialConfig: { mode: 'assisted', widthFeet: 45, heightFeet: 45, cellSizeFeet: GRID_CELL_SIZE_FEET },
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: character.id,
              ownerUserId: player.id,
              name: character.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 2,
              spatialPosition: { xFeet: 6, yFeet: 6 },
            },
            {
              kind: 'CREATURE',
              creatureId: npc.id,
              name: npc.name,
              hpCurrent: 13,
              hpMax: 13,
              armorClass: 13,
              initiative: 10,
              dexterityMod: 1,
              spatialVisibility: 'master-only',
              spatialPosition: { xFeet: 18, yFeet: 6 },
            },
          ],
        },
      },
    });
    combatIds.push(combat.id);

    const entity: MechanicalEntity = { kind: 'character', id: character.id };
    const turnKey = (round = 1, index = 0): string => `${combat.id}:${round}:${index}`;
    const playerSocket = await connect(playerToken, 'player');
    const masterSocket = await connect(masterToken, 'master');

    /** Ressincroniza o cenário: ficha a 0 PV no fluxo e turno de volta no herói. */
    const reset = async (death: DeathState, round = 1): Promise<void> => {
      await prisma.character.update({
        where: { id: character.id },
        data: { deathState: death as never, hpCurrent: 0, version: { increment: 1 } },
      });
      await prisma.combat.update({
        where: { id: combat.id },
        data: { status: 'ACTIVE', endedAt: null, round, currentIndex: 0, version: { increment: 1 } },
      });
    };
    const nextTurn = async (auth: string, skipDeathSave = false) => {
      const current = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id }, select: { version: true } });
      return request(
        '/combat/next-turn',
        { combatId: combat.id, expectedVersion: current.version, operationId: randomUUID(), ...(skipDeathSave ? { skipDeathSave: true } : {}) },
        auth,
      );
    };
    const rollDeathSave = (auth: string) =>
      request('/dice/roll', { kind: 'death-save', entity, dice: [{ sides: 20 }], label: 'Teste contra a Morte' }, auth);
    const clearEvents = (): void => {
      events.length = 0;
    };
    const eventsOf = (event: string, role?: 'player' | 'master'): Captured[] =>
      events.filter((item) => item.event === event && (!role || item.role === role));
    const lastOf = (event: string, role?: 'player' | 'master'): any => eventsOf(event, role).at(-1)?.payload ?? null;
    const ownCombatant = (dto: CombatDto | null): CombatantDto | undefined =>
      dto?.combatants.find((item) => item.ownerUserId === player.id);

    // ---------------------------------------------------------------- SC400
    {
      const active = await request('/combat/active', undefined, playerToken);
      check(
        'SC400) fixture: cena grid-2d viva, turno do personagem e Teste contra a Morte elegível',
        active.status === 200 &&
          active.data.combat?.sceneId === scene.id &&
          active.data.combat?.spatial.mode === 'grid-2d' &&
          active.data.combat?.currentCombatantId === ownCombatant(active.data.combat)?.id &&
          ownCombatant(active.data.combat)?.deathState?.deathSaves === true &&
          ownCombatant(active.data.combat)?.deathState?.saveTurnKey === null &&
          active.data.combat?.combatants.find((item: CombatantDto) => item.kind === 'CREATURE')?.hpCurrent === null,
        JSON.stringify({ status: active.status, mode: active.data.combat?.spatial?.mode }),
      );
    }

    // ---------------------------------------------------------------- SC401
    {
      clearEvents();
      const response = await nextTurn(playerToken);
      await sleep(400);
      check(
        'SC401) antes do Teste obrigatório o SERVIDOR recusa encerrar o turno (DEATH_SAVE_PENDING)',
        response.status === 409 && response.data.error === 'DEATH_SAVE_PENDING' && eventsOf('death:updated').length === 0,
        JSON.stringify(response.data),
      );
      await sleep(300);
      clearEvents();
      const roll = await rollDeathSave(playerToken);
      const responseAfterRoll = await nextTurn(playerToken);
      check(
        'SC402) depois do Teste o SERVIDOR aceita encerrar o turno (quem decide é o servidor)',
        (roll.status === 200 || roll.status === 201) && responseAfterRoll.status === 200,
        JSON.stringify({ roll: roll.status, next: responseAfterRoll.status, body: responseAfterRoll.data }),
      );
    }

    // ---------------------------------------------------------------- SC403
    // Rolagem pelo caminho REAL (bandeja → HTTP → socket), contadores sem F5.
    await reset(deathStateOf({ deathSaves: true }));
    await sleep(300);
    clearEvents();
    const versionBeforeRoll = (
      await prisma.character.findUniqueOrThrow({ where: { id: character.id }, select: { version: true } })
    ).version;
    const rollResponse = await rollDeathSave(playerToken);
    await sleep(1200);
    const rollValue = Number(rollResponse.data?.roll?.dice?.[0]?.value ?? 0);
    const expected = rollValue === 20
      ? { revived: true, successes: 0, failures: 0 }
      : rollValue === 1
        ? { revived: false, successes: 0, failures: 2 }
        : rollValue >= 10
          ? { revived: false, successes: 1, failures: 0 }
          : { revived: false, successes: 0, failures: 1 };
    const playerCombat = lastOf('combat:updated', 'player')?.combat as CombatDto | null;
    const playerDeath = lastOf('death:updated', 'player')?.death as DeathDto | null;
    const playerSheet = lastOf('sheet:updated', 'player');
    check(
      'SC403) `combat:updated` chega ao jogador com o contador NOVO e a chave do turno (sem F5)',
      (rollResponse.status === 200 || rollResponse.status === 201) &&
        Boolean(playerCombat) &&
        ownCombatant(playerCombat)?.deathState?.successes === expected.successes &&
        ownCombatant(playerCombat)?.deathState?.failures === expected.failures &&
        (expected.revived ||
          ownCombatant(playerCombat)?.deathState?.saveTurnKey === turnKey()),
      JSON.stringify({
        rollValue,
        expected,
        received: ownCombatant(playerCombat)?.deathState ?? null,
      }),
    );
    check(
      'SC404) `death:updated` e `sheet:updated` contam a MESMA coisa (uma única verdade)',
      Boolean(playerDeath) &&
        playerDeath!.death.successes === expected.successes &&
        playerDeath!.death.failures === expected.failures &&
        Boolean(playerSheet) &&
        playerSheet.character.deathState.successes === expected.successes &&
        playerSheet.character.deathState.failures === expected.failures &&
        playerSheet.character.version > versionBeforeRoll,
      JSON.stringify({ death: playerDeath?.death ?? null, sheetVersion: playerSheet?.character?.version ?? null }),
    );
    check(
      'SC405) o evento é IDÊNTICO ao F5 (`GET /api/combat/active` e `GET /api/death/...`)',
      await (async () => {
        const active = await request('/combat/active', undefined, playerToken);
        const death = await request(`/death/${entity.kind}/${entity.id}`, undefined, playerToken);
        return (
          active.status === 200 &&
          death.status === 200 &&
          JSON.stringify(active.data.combat) === JSON.stringify(playerCombat) &&
          JSON.stringify(death.data.death.death) === JSON.stringify(playerDeath?.death ?? null)
        );
      })(),
      'projeção do evento divergiu da leitura canônica',
    );
    check(
      'SC406) mapa, paredes, tokens e cena continuam intactos na publicação do Teste',
      Boolean(playerCombat) &&
        playerCombat!.sceneId === scene.id &&
        playerCombat!.sceneBackgroundImageUrl === `/uploads/scenes/rt-${suffix}.png` &&
        playerCombat!.spatial.mode === 'grid-2d' &&
        playerCombat!.obstacles.length === 1 &&
        // A visão do JOGADOR tem só o token dele: o NPC é `master-only`
        // (presente na iniciativa, sem geometria exposta).
        playerCombat!.combatants.filter((item) => item.kind === 'CHARACTER' && item.spatial?.position).length === 1 &&
        playerCombat!.combatants.filter((item) => item.kind === 'CREATURE' && item.spatial === null).length === 1,
      JSON.stringify({ mode: playerCombat?.spatial.mode, obstacles: playerCombat?.obstacles.length }),
    );
    check(
      'SC407) os DOIS clientes recebem o mesmo contador e o jogador não vê estado privado do NPC',
      Boolean(playerCombat) &&
        JSON.stringify(lastOf('combat:updated', 'master')?.combat) !== 'null' &&
        (lastOf('combat:updated', 'master')?.combat.combatants.find((item: CombatantDto) => item.kind === 'CREATURE')?.hpCurrent ?? null) !== null &&
        (playerCombat!.combatants.find((item) => item.kind === 'CREATURE')?.hpCurrent ?? null) === null &&
        ownCombatant(playerCombat)?.deathState?.successes ===
          (lastOf('death:updated', 'master')?.death.death.successes ?? -1),
      JSON.stringify({ player: ownCombatant(playerCombat)?.deathState, master: lastOf('death:updated', 'master')?.death?.death }),
    );

    // ---------------------------------------------------------------- SC408
    // Segundo pedido no MESMO turno: recusado, sem segundo resultado.
    clearEvents();
    const secondRoll = await rollDeathSave(playerToken);
    await sleep(600);
    check(
      'SC408) segundo Teste no mesmo turno é recusado e não publica contador novo',
      secondRoll.status === 409 && eventsOf('death:updated').length === 0 && eventsOf('dice:roll').length === 0,
      JSON.stringify({ status: secondRoll.status, error: secondRoll.data?.error }),
    );

    // ---------------------------------------------------------------- SC409
    // NAT 1 (duas falhas) e NAT 20 (1 PV) determinísticos.
    await reset(deathStateOf({ deathSaves: true }));
    const naturalOne = await applyDeathSave(playerActor, entity, 1);
    check(
      'SC409) 1 natural registra DUAS falhas e mantém o Teste do turno já rolado',
      naturalOne.naturalOne && naturalOne.failures === 2 && naturalOne.successes === 0,
      JSON.stringify(naturalOne),
    );
    await reset(deathStateOf({ deathSaves: true, failures: 2 }));
    const naturalTwenty = await applyDeathSave(playerActor, entity, 20);
    const afterRevive = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    check(
      'SC410) 20 natural devolve 1 PV, encerra o ciclo e libera o turno',
      naturalTwenty.naturalTwenty &&
        naturalTwenty.revived &&
        afterRevive.hpCurrent === 1 &&
        deathStateOf(afterRevive.deathState).deathSaves === false,
      JSON.stringify({ result: naturalTwenty, hp: afterRevive.hpCurrent }),
    );

    // ---------------------------------------------------------------- SC411
    // ESTABILIZADO: a partir daqui quem decide encerrar é o servidor.
    await reset(deathStateOf({ deathSaves: true, successes: 2 }));
    const stabilized = await applyDeathSave(playerActor, entity, 15);
    clearEvents();
    const stabilizedEnd = await nextTurn(playerToken);
    await sleep(500);
    const stabilizedState = deathStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).deathState,
    );
    check(
      'SC411) Estabilizado a 0 PV PODE encerrar o próprio turno (sem Teste novo)',
      stabilized.stabilized &&
        stabilizedEnd.status === 200 &&
        eventsOf('dice:roll').length === 0 &&
        stabilizedState.stabilized &&
        stabilizedState.successes === 3,
      JSON.stringify({ stabilized: stabilized.stabilized, status: stabilizedEnd.status, death: stabilizedState }),
    );

    // ---------------------------------------------------------------- SC412
    // TRÊS FALHAS: a decisão é do Mestre. O jogador não avança; o Mestre sim,
    // com confirmação explícita — nada é inventado no caminho.
    await reset(deathStateOf({ deathSaves: true, failures: 2 }));
    clearEvents();
    const thirdFailure = await applyDeathSave(playerActor, entity, 5);
    const playerEnded = await nextTurn(playerToken);
    const afterPending = deathStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).deathState,
    );
    const masterEnded = await nextTurn(masterToken);
    check(
      'SC412) 3ª falha abre a decisão do Mestre: o turno avança e a decisão CONTINUA dele (nada é resolvido sozinho)',
      Boolean(thirdFailure.pending) &&
        playerEnded.status === 200 &&
        afterPending.pending?.id === thirdFailure.pending?.id &&
        masterEnded.status === 200 &&
        eventsOf('dice:roll').length === 0,
      JSON.stringify({
        pending: thirdFailure.pending,
        player: playerEnded.status,
        pendingAfter: afterPending.pending,
        master: masterEnded.status,
      }),
    );

    // ---------------------------------------------------------------- SC413
    // RECONNECT: uma sessão nova lê exatamente o que o servidor publicou.
    const reconnectEvents: Captured[] = [];
    const reconnectSocket = await connect(playerToken, 'player');
    reconnectSocket.on('combat:updated', () => undefined);
    await sleep(300);
    const reconnectCombat = await request('/combat/active', undefined, playerToken);
    const reconnectDeath = await request(`/death/${entity.kind}/${entity.id}`, undefined, masterToken);
    check(
      'SC413) reconnect/F5 lê o MESMO estado do servidor (contador, pendência e cena)',
      reconnectCombat.status === 200 &&
        reconnectCombat.data.combat.sceneId === scene.id &&
        reconnectCombat.data.combat.spatial.mode === 'grid-2d' &&
        reconnectDeath.data.death.death.failures === 3 &&
        Boolean(reconnectDeath.data.death.pending) &&
        reconnectEvents.length === 0,
      JSON.stringify({ failures: reconnectDeath.data?.death?.death?.failures }),
    );

    // ---------------------------------------------------------------- SC414
    check(
      'SC414) nenhum Teste foi duplicado: o segundo pedido não publicou rolagem nenhuma',
      secondRoll.status === 409 && eventsOf('dice:roll').length === 0,
      JSON.stringify({ second: secondRoll.status, rolls: eventsOf('dice:roll').length }),
    );
    check(
      'SC415) o jogador não recebeu nenhum payload privado de NPC no ciclo de morte',
      events
        .filter((item) => item.role === 'player' && item.event === 'death:updated')
        .every((item) => item.payload?.death?.kind === 'character'),
      JSON.stringify(events.filter((item) => item.role === 'player' && item.event === 'death:updated').map((item) => item.payload?.death?.kind)),
    );

  } finally {
    sockets.forEach((socket) => socket.disconnect());
    const safely = async (task: () => Promise<unknown>): Promise<void> => {
      try {
        await task();
      } catch {
        /* limpeza best-effort: só IDs criados por esta execução */
      }
    };
    await safely(() => prisma.combatOperation.deleteMany({ where: { combatId: { in: combatIds } } }));
    await safely(() => prisma.combatant.deleteMany({ where: { combatId: { in: combatIds } } }));
    await safely(() => prisma.combat.deleteMany({ where: { id: { in: combatIds } } }));
    await safely(() => prisma.character.deleteMany({ where: { id: { in: characterIds } } }));
    await safely(() => prisma.creature.deleteMany({ where: { id: { in: creatureIds } } }));
    await safely(() => prisma.spatialObstacle.deleteMany({ where: { sceneId: { in: sceneIds } } }));
    await safely(() => prisma.scene.deleteMany({ where: { id: { in: sceneIds } } }));
    await safely(() => prisma.locality.deleteMany({ where: { id: { in: localityIds } } }));
    await safely(() => prisma.region.deleteMany({ where: { id: { in: regionIds } } }));
    await safely(() => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.log(`FALHOU — ${failures} item(ns).`);
    process.exit(1);
  }
  console.log('OK — Teste contra a Morte sincronizado e fim de turno liberado pelo servidor.');
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error('ERRO FATAL:', error);
  process.exit(1);
});
