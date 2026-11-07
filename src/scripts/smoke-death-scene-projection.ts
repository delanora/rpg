import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { setBroadcaster } from '../realtime/hub.js';
import type { Broadcaster } from '../realtime/broadcast.js';
import { ServerEvents } from '../realtime/events.js';
import {
  applyDeathSave,
  overrideDeath,
  resolveDeathPending,
  type DeathActor,
} from '../modules/death/death.service.js';
import { loadCombatById } from '../modules/combat/combat-load.js';
import { hideMasterPrivateState, toCombatDto, type CombatDto } from '../modules/combat/combat.dto.js';
import { GRID_CELL_SIZE_FEET } from '../modules/combat/spatial/spatial.types.js';
import { deathStateOf, type DeathState } from '../modules/shared/death.js';
import type { MechanicalEntity } from '../modules/shared/conditions.js';

/**
 * SMOKE 6.6M.8.2 — PROJEÇÃO DE CENA NO REALTIME DO CICLO DE MORTE.
 *
 * Reproduz a regressão relatada: com uma Scene `grid-2d` ativa, rolar um Teste
 * contra a Morte publicava `combat:updated` a partir de um carregamento SEM
 * `scene`, então `effectiveSceneConfigOf()` caía no `Combat.spatialConfig`
 * legado (`assisted`) e o grid desaparecia até um F5.
 *
 * O que é verificado aqui, no payload REAL que o servidor publica:
 *   • `combat.id`, `sceneId`, `sceneName`, imagem de fundo, paredes/obstáculos;
 *   • `spatial` (modo, dimensões) e a projeção de CADA combatente;
 *   • versão do combate e atualização do ciclo de morte;
 *   • visão do jogador sem estado privado de NPC;
 *   • combate LEGADO de verdade (sem cena) continua assistido;
 *   • o evento publicado é idêntico ao caminho do F5 (`loadCombatById`), que é
 *     o mesmo carregador usado por `/api/combat/active`.
 *
 * Fixtures 100% próprias (contas, cena, combate) e apagadas no fim. Nunca roda
 * sobre dado real: exige um banco/schema descartável (`DATABASE_URL` próprio) e
 * recusa rodar se houver qualquer outro combate ativo no banco.
 *
 * Uso:
 *   DATABASE_URL=<banco descartável> npx tsx src/scripts/smoke-death-scene-projection.ts
 *   # opcional: comparar com o F5 de verdade (`GET /api/combat/active`)
 *   SCENE_SMOKE_BASE_URL=http://localhost:3100 DATABASE_URL=<descartável> npx tsx src/scripts/...
 */

type Check = (label: string, condition: boolean, detail?: string) => void;

interface CapturedEvent {
  event: string;
  view: 'master' | 'players';
  combat: CombatDto;
}

let failures = 0;
const check: Check = (label, condition, detail) => {
  if (condition) console.log(`✔ ${label}`);
  else {
    failures += 1;
    console.log(`✘ ${label}${detail ? `\n    ${detail}` : ''}`);
  }
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
  const baseUrl = process.env.SCENE_SMOKE_BASE_URL ?? '';

  // --- Guarda de segurança: este teste NUNCA convive com dado real ----------
  const active = await prisma.combat.findMany({ where: { status: { not: 'ENDED' } }, select: { id: true } });
  if (active.length > 0) {
    console.error(
      `ABORTADO: há ${active.length} combate(s) ativo(s) neste banco. Rode este smoke em um banco/schema descartável.`,
    );
    process.exit(2);
  }

  const events: CapturedEvent[] = [];
  let view: 'master' | 'players' = 'master';
  const broadcaster: Broadcaster = {
    toUser: () => undefined,
    toMasters: (event, payload) => {
      view = 'master';
      if (event === ServerEvents.COMBAT_UPDATED) capture(event, payload);
    },
    toPlayers: (event, payload) => {
      view = 'players';
      if (event === ServerEvents.COMBAT_UPDATED) capture(event, payload);
    },
    toTable: () => undefined,
    disconnectUser: () => undefined,
    presence: () => undefined,
  };
  function capture(event: string, payload: unknown): void {
    const combat = (payload as { combat?: CombatDto }).combat;
    if (combat) events.push({ event, view, combat });
  }
  setBroadcaster(broadcaster);

  const suffix = randomUUID().slice(0, 8);
  const characterIds: string[] = [];
  const userIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  const sceneIds: string[] = [];
  const localityIds: string[] = [];
  const regionIds: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `scene_m_${suffix}`, displayName: 'Mestre Cena', passwordHash: 'fixture', role: 'MASTER' },
    });
    userIds.push(master.id);
    const player = await prisma.user.create({
      data: { username: `scene_p_${suffix}`, displayName: 'Jogador Cena', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(player.id);
    const masterActor: DeathActor = { userId: master.id, username: master.username, role: 'MASTER' };
    const playerActor: DeathActor = { userId: player.id, username: player.username, role: 'PLAYER' };

    const region = await prisma.region.create({ data: { name: `Região Cena ${suffix}` } });
    regionIds.push(region.id);
    const locality = await prisma.locality.create({ data: { name: `Localidade Cena ${suffix}`, regionId: region.id } });
    localityIds.push(locality.id);

    // --- SCENE grid-2d com imagem e UMA parede ----------------------------
    const scene = await prisma.scene.create({
      data: {
        localityId: locality.id,
        name: `Cripta ${suffix}`,
        spatialConfig: {
          mode: 'grid-2d',
          widthFeet: 30,
          heightFeet: 24,
          cellSizeFeet: GRID_CELL_SIZE_FEET,
        },
        backgroundImageUrl: `/uploads/scenes/fixture-${suffix}.png`,
      },
    });
    sceneIds.push(scene.id);
    const wall = await prisma.spatialObstacle.create({
      data: {
        sceneId: scene.id,
        kind: 'wall',
        startXFeet: 6,
        startYFeet: 6,
        endXFeet: 12,
        endYFeet: 6,
      },
    });

    // --- Ficha a 0 PV no fluxo de Testes contra a Morte -------------------
    const character = await prisma.character.create({
      data: {
        userId: player.id,
        name: 'Herói da Cripta',
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
        name: `Espectro ${suffix}`,
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
        // LEGADO proposital: se alguém ler `Combat.spatialConfig` em vez da
        // cena, publica `assisted` e o grid cai. A cena é a única fonte.
        spatialConfig: {
          mode: 'assisted',
          widthFeet: 45,
          heightFeet: 45,
          cellSizeFeet: GRID_CELL_SIZE_FEET,
        },
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
              // NPC privado: o jogador NÃO recebe o estado mecânico dele.
              spatialVisibility: 'master-only',
              spatialPosition: { xFeet: 18, yFeet: 6 },
            },
          ],
        },
      },
    });
    combatIds.push(combat.id);

    const masterDto = toCombatDto(await loadCombatById(combat.id), 'MASTER');
    const playerDto = hideMasterPrivateState(masterDto);
    const characterEntity: MechanicalEntity = { kind: 'character', id: character.id };
    const lastEvent = (eventView: 'master' | 'players'): CombatDto | null => {
      const found = [...events].reverse().find((item) => item.view === eventView);
      return found ? found.combat : null;
    };
    const syncTurnKey = async (next: DeathState): Promise<void> => {
      await prisma.character.update({
        where: { id: character.id },
        data: { deathState: next as never },
      });
    };

    // ---------------------------------------------------------------- SC300
    check(
      'SC300) fixture: Scene grid-2d com imagem e parede, combate apontando para ela',
      masterDto.sceneId === scene.id &&
        masterDto.spatial.mode === 'grid-2d' &&
        masterDto.sceneBackgroundImageUrl === `/uploads/scenes/fixture-${suffix}.png` &&
        masterDto.obstacles.length === 1 &&
        masterDto.obstacles[0]?.id === wall.id &&
        masterDto.combatants.filter((item) => item.spatial?.position).length === 2,
      JSON.stringify({
        sceneId: masterDto.sceneId,
        mode: masterDto.spatial.mode,
        obstacles: masterDto.obstacles.length,
      }),
    );

    // ---------------------------------------------------------------- SC301
    events.length = 0;
    const success = await applyDeathSave(playerActor, characterEntity, 15);
    const afterSuccessMaster = lastEvent('master');
    const afterSuccessPlayer = lastEvent('players');
    check(
      'SC301) Teste com SUCESSO: `combat:updated` mantém a MESMA cena e o MESMO grid',
      Boolean(afterSuccessMaster) &&
        afterSuccessMaster!.id === combat.id &&
        afterSuccessMaster!.sceneId === scene.id &&
        afterSuccessMaster!.sceneName === scene.name &&
        afterSuccessMaster!.sceneBackgroundImageUrl === masterDto.sceneBackgroundImageUrl &&
        afterSuccessMaster!.spatial.mode === 'grid-2d' &&
        same(afterSuccessMaster!.spatial, masterDto.spatial),
      JSON.stringify({ mode: afterSuccessMaster?.spatial.mode, sceneId: afterSuccessMaster?.sceneId }),
    );
    check(
      'SC302) paredes, tokens, tamanhos e posições sobrevivem à publicação',
      Boolean(afterSuccessMaster) &&
        same(afterSuccessMaster!.obstacles, masterDto.obstacles) &&
        same(
          afterSuccessMaster!.combatants.map((item) => [item.id, item.spatial, item.spatialVisibility]),
          masterDto.combatants.map((item) => [item.id, item.spatial, item.spatialVisibility]),
        ),
      JSON.stringify(afterSuccessMaster?.obstacles),
    );
    check(
      'SC303) a rolagem muda SÓ o que ela muda: ciclo de morte e versão do combate',
      success.successes === 1 &&
        success.failures === 0 &&
        afterSuccessMaster!.round === masterDto.round &&
        afterSuccessMaster!.currentIndex === masterDto.currentIndex &&
        afterSuccessMaster!.currentCombatantId === masterDto.currentCombatantId &&
        afterSuccessMaster!.version >= masterDto.version,
      JSON.stringify({
        success: success.successes,
        version: [masterDto.version, afterSuccessMaster?.version],
      }),
    );
    check(
      'SC304) o evento é idêntico ao caminho do F5 (`loadCombatById` → `toCombatDto`)',
      same(
        afterSuccessMaster,
        toCombatDto(await loadCombatById(combat.id), 'MASTER'),
      ),
      'projeção do evento divergiu da leitura canônica',
    );
    check(
      'SC305) privacidade: a visão do JOGADOR continua sem estado privado do NPC e igual ao F5',
      Boolean(afterSuccessPlayer) &&
        same(afterSuccessPlayer, hideMasterPrivateState(toCombatDto(await loadCombatById(combat.id), 'MASTER'))) &&
        afterSuccessPlayer!.combatants.find((item) => item.id === masterDto.combatants[1]?.id)?.hpCurrent === null,
      JSON.stringify(afterSuccessPlayer?.combatants.map((item) => [item.name, item.hpCurrent])),
    );

    // ---------------------------------------------------------------- SC306
    await syncTurnKey(deathStateOf({ deathSaves: true, successes: 1, saveTurnKey: null }));
    events.length = 0;
    const failure = await applyDeathSave(playerActor, characterEntity, 5);
    const afterFailure = lastEvent('master');
    check(
      'SC306) Teste com FALHA mantém cena, grid e obstáculos (e conta 1 falha)',
      failure.failures === 1 &&
        Boolean(afterFailure) &&
        afterFailure!.sceneId === scene.id &&
        afterFailure!.spatial.mode === 'grid-2d' &&
        same(afterFailure!.obstacles, masterDto.obstacles),
      JSON.stringify({ failures: failure.failures, mode: afterFailure?.spatial.mode }),
    );

    // ---------------------------------------------------------------- SC307
    await syncTurnKey(deathStateOf({ deathSaves: true, saveTurnKey: null }));
    events.length = 0;
    const naturalOne = await applyDeathSave(playerActor, characterEntity, 1);
    const afterNaturalOne = lastEvent('master');
    check(
      'SC307) 1 natural (2 falhas) não altera a projeção espacial',
      naturalOne.naturalOne &&
        naturalOne.failures === 2 &&
        Boolean(afterNaturalOne) &&
        afterNaturalOne!.sceneId === scene.id &&
        afterNaturalOne!.spatial.mode === 'grid-2d',
      JSON.stringify({ failures: naturalOne.failures, mode: afterNaturalOne?.spatial.mode }),
    );

    // ---------------------------------------------------------------- SC308
    await syncTurnKey(deathStateOf({ deathSaves: true, failures: 2, saveTurnKey: null }));
    events.length = 0;
    const naturalTwenty = await applyDeathSave(playerActor, characterEntity, 20);
    const afterNaturalTwenty = lastEvent('master');
    check(
      'SC308) 20 natural (volta a 1 PV) publica a cena intacta e o DTO do F5 igual',
      naturalTwenty.revived &&
        Boolean(afterNaturalTwenty) &&
        afterNaturalTwenty!.sceneId === scene.id &&
        same(afterNaturalTwenty!.spatial, masterDto.spatial) &&
        same(afterNaturalTwenty, toCombatDto(await loadCombatById(combat.id), 'MASTER')),
      JSON.stringify({ mode: afterNaturalTwenty?.spatial.mode }),
    );

    // ---------------------------------------------------------------- SC309
    // Terceira falha → decisão pendente do Mestre (o alvo volta a 0 PV).
    await prisma.character.update({
      where: { id: character.id },
      data: {
        hpCurrent: 0,
        deathState: deathStateOf({ deathSaves: true, failures: 2, saveTurnKey: null }) as never,
      },
    });
    events.length = 0;
    const thirdFailure = await applyDeathSave(playerActor, characterEntity, 5);
    const afterThird = lastEvent('master');
    check(
      'SC309) 3ª falha abre a decisão do Mestre sem derrubar a cena',
      Boolean(thirdFailure.pending) &&
        Boolean(afterThird) &&
        afterThird!.sceneId === scene.id &&
        afterThird!.spatial.mode === 'grid-2d',
      JSON.stringify({ pending: thirdFailure.pending?.kind, mode: afterThird?.spatial.mode }),
    );

    // ---------------------------------------------------------------- SC310
    const pendingRow = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    events.length = 0;
    const stabilized = await resolveDeathPending(masterActor, {
      entity: characterEntity,
      decision: 'leave-stabilized',
      expectedVersion: pendingRow.version,
      operationId: randomUUID(),
    });
    const afterStabilize = lastEvent('master');
    check(
      'SC310) decisão "estabilizar" do Mestre preserva cena e grid',
      stabilized.death.death.stabilized &&
        Boolean(afterStabilize) &&
        afterStabilize!.sceneId === scene.id &&
        afterStabilize!.spatial.mode === 'grid-2d' &&
        same(afterStabilize!.obstacles, masterDto.obstacles),
      JSON.stringify({ mode: afterStabilize?.spatial.mode }),
    );

    // ---------------------------------------------------------------- SC311
    const stabilizedRow = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    events.length = 0;
    const revived = await overrideDeath(masterActor, {
      entity: characterEntity,
      action: 'revive',
      expectedVersion: stabilizedRow.version,
      operationId: randomUUID(),
    });
    const afterRevive = lastEvent('master');
    const combatRow = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    check(
      'SC311) reviver pelo Mestre: cena intacta e `combat.version` do evento é a versão gravada',
      revived.death.hpCurrent === 1 &&
        Boolean(afterRevive) &&
        afterRevive!.sceneId === scene.id &&
        afterRevive!.version === combatRow.version &&
        afterRevive!.round === combatRow.round &&
        afterRevive!.currentIndex === combatRow.currentIndex,
      JSON.stringify({ version: [afterRevive?.version, combatRow.version] }),
    );

    // ---------------------------------------------------------------- SC312
    // Reconnect/F5: o caminho canônico continua trazendo a cena inteira.
    const reloaded = toCombatDto(await loadCombatById(combat.id), 'MASTER');
    check(
      'SC312) reconnect/F5 (sem cache do cliente) reconstrói a MESMA cena do evento',
      reloaded.sceneId === scene.id &&
        same(reloaded.spatial, masterDto.spatial) &&
        same(reloaded.obstacles, masterDto.obstacles) &&
        same(
          reloaded.combatants.map((item) => item.spatial),
          masterDto.combatants.map((item) => item.spatial),
        ),
      JSON.stringify(reloaded.spatial),
    );

    // ---------------------------------------------------------------- SC313
    // Combate LEGADO (sem cena): continua assistido, sem inventar grid.
    await prisma.combat.update({ where: { id: combat.id }, data: { status: 'ENDED', endedAt: new Date() } });
    const legacy = await prisma.combat.create({
      data: {
        status: 'PENDING_INITIATIVE',
        spatialConfig: { mode: 'assisted', widthFeet: 45, heightFeet: 45, cellSizeFeet: GRID_CELL_SIZE_FEET },
      },
    });
    combatIds.push(legacy.id);
    const legacyDto = toCombatDto(await loadCombatById(legacy.id), 'MASTER');
    check(
      'SC313) combate legado sem `sceneId` continua assistido (nenhum grid inventado)',
      legacyDto.sceneId === null &&
        legacyDto.spatial.mode === 'assisted' &&
        legacyDto.obstacles.length === 0 &&
        legacyDto.sceneBackgroundImageUrl === null,
      JSON.stringify(legacyDto.spatial),
    );
    // O índice `combats_one_active_key` permite um só combate não encerrado por
    // banco: fecha o legado antes de reabrir o principal para o F5.
    await prisma.combat.update({ where: { id: legacy.id }, data: { status: 'ENDED', endedAt: new Date() } });

    // ---------------------------------------------------------------- SC314
    // F5 de VERDADE (opcional): a rota `/api/combat/active` usa o mesmo loader.
    if (baseUrl) {
      const token = signToken({
        sub: master.id,
        username: master.username,
        displayName: master.displayName,
        role: master.role,
      });
      // O combate principal está ENDED neste ponto: reabre só para a leitura.
      await prisma.combat.update({ where: { id: combat.id }, data: { status: 'ACTIVE', endedAt: null } });
      const response = await fetch(`${baseUrl}/api/combat/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({}))) as { combat?: CombatDto };
      check(
        'SC314) `GET /api/combat/active` devolve a MESMA projeção publicada no evento',
        response.status === 200 &&
          body.combat?.id === combat.id &&
          body.combat?.sceneId === scene.id &&
          body.combat?.spatial.mode === 'grid-2d' &&
          same(body.combat?.obstacles, masterDto.obstacles),
        JSON.stringify({ status: response.status, mode: body.combat?.spatial.mode }),
      );
    } else {
      console.log('• SC314) comparado só com o carregador canônico (SCENE_SMOKE_BASE_URL não definido)');
    }

    // ---------------------------------------------------------------- SC315
    check(
      'SC315) nenhum evento publicado deixou a cena em `assisted` com Scene grid-2d viva',
      events.every(
        (item) => item.combat.sceneId !== scene.id || item.combat.spatial.mode === 'grid-2d',
      ),
      events
        .filter((item) => item.combat.sceneId === scene.id && item.combat.spatial.mode !== 'grid-2d')
        .map((item) => `${item.view}:${item.combat.spatial.mode}`)
        .join(', '),
    );
  } finally {
    // Limpeza: só as fixtures desta execução.
    await prisma.combatOperation.deleteMany({ where: { combatId: { in: combatIds } } });
    await prisma.combatant.deleteMany({ where: { combatId: { in: combatIds } } });
    await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
    await prisma.deathOperation.deleteMany({ where: { entityId: { in: characterIds } } });
    await prisma.scene.deleteMany({ where: { id: { in: sceneIds } } });
    await prisma.locality.deleteMany({ where: { id: { in: localityIds } } });
    await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nOK — projeção de cena preservada.' : `\nFALHOU — ${failures} item(ns).`);
  if (failures > 0) process.exit(1);
}

void main();
