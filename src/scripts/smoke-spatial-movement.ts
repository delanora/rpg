import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import {
  evaluateMovementPath,
  hostilePassageAllowed,
  movementRelationOf,
  normalizeSideKey,
  remainingMovementFeet,
  sizeOrderOf,
  type MovementParticipant,
} from '../modules/combat/spatial/spatial-movement.js';
import { walkingMovementTerrain } from '../modules/combat/spatial/movement-terrain.js';
import {
  administrativeMovementGate,
  unavailableMovementGate,
} from '../modules/combat/spatial/movement-reaction-gate.js';
import { spatialSceneOf } from '../modules/combat/spatial/spatial.types.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

/**
 * FASE 6.6L.3 — MOVEMENT + OCCUPANCY FOUNDATION (PHB 2014).
 *
 * Prova que o servidor passou a compreender MOVIMENTO VOLUNTÁRIO:
 *  • caminho EXPLÍCITO passo a passo (nunca "de A para Z", nunca pathfinding);
 *  • passo 5 pés (Small+) e 2,5 pés (Tiny), diagonal com o mesmo custo;
 *  • custo derivado (crawling e difficult terrain SEPARADOS, fontes de difficult
 *    não acumulam), consumo do MESMO `movementRemaining` do turno;
 *  • passagem por não hostil liberada e por hostil só com ≥ 2 tamanhos (2014);
 *  • destino final nunca sobre outra criatura; relação desconhecida recusada;
 *  • side/hostility como estado do COMBATANTE definido só pelo Mestre;
 *  • preview read-only, commit revalidado, idempotente e com versão;
 *  • Reaction Gate bloqueando movimento de jogador (OA ainda não existe).
 *
 * NÃO implementa (e o smoke verifica a ausência): Opportunity Attack/Reaction,
 * pathfinding, paredes, terreno ambiental desenhado, squeezing, voo/natação/
 * escalada, movimento forçado, teleporte e arrastar agarrão.
 */
export async function smokeSpatialMovement(baseUrl: string, check: Check): Promise<void> {
  console.log('\n90) Fase 6.6L.3 — Movement + Occupancy Foundation');

  // =====================================================================
  // A–H — ENGINE PURA (passos, custo, difficult terrain, crawling, lado)
  // =====================================================================
  const grid = spatialSceneOf({
    mode: 'grid-2d',
    widthFeet: 200,
    heightFeet: 200,
    cellSizeFeet: 5,
  });
  const participant = (
    id: string,
    x: number,
    y: number,
    size: MovementParticipant['size'],
    sideKey: string | null = null,
  ): MovementParticipant => ({
    combatantId: id,
    name: id,
    position: { xFeet: x, yFeet: y },
    size,
    sideKey,
  });
  const path = (...pairs: [number, number][]) =>
    pairs.map(([xFeet, yFeet]) => ({ xFeet, yFeet }));
  const evaluate = (
    mover: MovementParticipant,
    others: MovementParticipant[],
    steps: ReturnType<typeof path>,
    options: { prone?: boolean; remaining?: number } = {},
  ) =>
    evaluateMovementPath({
      scene: grid,
      mover,
      others,
      path: steps,
      prone: options.prone ?? false,
      movementRemainingFeet: options.remaining ?? 30,
      terrain: walkingMovementTerrain,
      revealBlockers: true,
    });

  const mediumHero = participant('puro-heroi', 0, 0, 'medium', 'heroes');
  check(
    '90.A) passo Small+ 5 pés reto/diagonal é válido e custa 5 (sem Euclidiana)',
    evaluate(mediumHero, [], path([5, 0])).legal &&
      evaluate(mediumHero, [], path([5, 0])).totalCostFeet === 5 &&
      evaluate(mediumHero, [], path([5, 5])).totalCostFeet === 5 &&
      evaluate(mediumHero, [], path([5, 5])).status === 'ok',
  );
  check(
    '90.B) salto de 10 pés num único passo é recusado (servidor não faz pathfinding)',
    evaluate(mediumHero, [], path([10, 0])).blocker?.code ===
      'MOVEMENT_STEP_NOT_CONTIGUOUS' &&
      evaluate(mediumHero, [], path([10, 0])).destination === null,
  );
  const tinyPure = participant('puro-tiny', 0, 0, 'tiny');
  check(
    '90.C) Tiny mantém passo de 2,5 pés (reto e diagonal) e recusa 5 num passo',
    evaluate(tinyPure, [], path([2.5, 0])).totalCostFeet === 2.5 &&
      evaluate(tinyPure, [], path([2.5, 2.5])).totalCostFeet === 2.5 &&
      evaluate(tinyPure, [], path([5, 0])).blocker?.code ===
        'MOVEMENT_STEP_NOT_CONTIGUOUS',
  );
  check(
    '90.D) quatro passos Tiny = 10 pés de distância e 10 de custo',
    evaluate(tinyPure, [], path([2.5, 0], [5, 0], [7.5, 0], [10, 0]))
      .totalDistanceFeet === 10 &&
      evaluate(tinyPure, [], path([2.5, 0], [5, 0], [7.5, 0], [10, 0]))
        .totalCostFeet === 10,
  );
  check(
    '90.E) dois passos diagonais = 10 de distância e 10 de custo',
    evaluate(mediumHero, [], path([5, 5], [10, 10])).totalDistanceFeet === 10 &&
      evaluate(mediumHero, [], path([5, 5], [10, 10])).totalCostFeet === 10,
  );
  const allyPure = participant('puro-aliado', 5, 5, 'medium', 'heroes');
  const throughAlly = evaluate(mediumHero, [allyPure], path([5, 5], [10, 5]));
  check(
    '90.F) espaço de aliado é difficult terrain: 5 pés custam 10 (passagem permitida)',
    throughAlly.legal &&
      throughAlly.steps[0].difficultTerrain &&
      throughAlly.steps[0].costFeet === 10 &&
      throughAlly.steps[1].costFeet === 5 &&
      throughAlly.totalCostFeet === 15,
  );
  const twoAllies = [
    participant('puro-a1', 5, 5, 'medium', 'heroes'),
    participant('puro-a2', 5, 6, 'medium', 'heroes'),
  ];
  const twoAlliesStep = evaluate(mediumHero, twoAllies, path([5, 5], [10, 5]));
  check(
    '90.G) DUAS fontes de difficult terrain NÃO acumulam (continua 2×, não 3×)',
    twoAlliesStep.steps[0].costFeet === 10 &&
      twoAlliesStep.steps[0].difficultTerrainSources.length === 1 &&
      twoAlliesStep.steps[0].costFeet !== 15,
  );
  check(
    '90.H) order de tamanho (Tiny 0 … Gargantuan 5) e relação de lado canônica',
    sizeOrderOf('tiny') === 0 &&
      sizeOrderOf('small') === 1 &&
      sizeOrderOf('medium') === 2 &&
      sizeOrderOf('large') === 3 &&
      sizeOrderOf('huge') === 4 &&
      sizeOrderOf('gargantuan') === 5 &&
      movementRelationOf('heroes', 'heroes') === 'same' &&
      movementRelationOf('heroes', 'monsters') === 'hostile' &&
      movementRelationOf('heroes', null) === 'unknown' &&
      movementRelationOf(null, null) === 'unknown' &&
      normalizeSideKey('  ORCS ') === 'orcs' &&
      normalizeSideKey('   ') === null,
  );

  // Crawling × difficult terrain (composição exata do PHB 2014).
  check(
    '90.I) crawling: 5 pés custam 10 · crawl + criatura custam 15',
    evaluate(mediumHero, [], path([5, 0]), { prone: true }).steps[0].costFeet === 10 &&
      evaluate(mediumHero, [allyPure], path([5, 5], [10, 5]), { prone: true }).steps[0]
        .costFeet === 15,
  );
  check(
    '90.J) Tiny crawling + difficult preserva fração: 2,5 pés custam 7,5',
    evaluate(
      participant('puro-tiny2', 0, 0, 'tiny', 'heroes'),
      [participant('puro-tiny-aliado', 2.5, 0, 'tiny', 'heroes')],
      path([2.5, 0], [5, 0]),
      { prone: true },
    ).steps[0].costFeet === 7.5,
  );
  check(
    '90.K) passagem hostil: mesmo tamanho e 1 categoria bloqueiam; 2 categorias liberam',
    !hostilePassageAllowed('medium', 'medium') &&
      !hostilePassageAllowed('medium', 'large') &&
      hostilePassageAllowed('medium', 'huge') &&
      hostilePassageAllowed('medium', 'tiny') &&
      hostilePassageAllowed('large', 'small') &&
      !hostilePassageAllowed('large', 'medium'),
  );
  check(
    '90.L) destino final sobre QUALQUER criatura é recusado (mesmo aliada)',
    evaluate(mediumHero, [allyPure], path([5, 5], [10, 5])).legal === true &&
      evaluate(mediumHero, [participant('puro-aliado-fim', 10, 5, 'medium', 'heroes')], path([5, 5], [10, 5]))
        .blocker?.code === 'MOVEMENT_DESTINATION_OCCUPIED',
  );
  check(
    '90.M) relação desconhecida recusa passagem e o bloqueador é ANÔNIMO sem reveal',
    evaluate(mediumHero, [participant('puro-desconhecido', 5, 5, 'medium', null)], path([5, 5], [10, 5]))
      .blocker?.code === 'MOVEMENT_RELATION_UNKNOWN' &&
      evaluateMovementPath({
        scene: grid,
        mover: mediumHero,
        others: [participant('puro-oculto', 5, 5, 'medium', null)],
        path: path([5, 5], [10, 5]),
        prone: false,
        movementRemainingFeet: 30,
        terrain: walkingMovementTerrain,
        revealBlockers: false,
      }).blocker?.combatantId === null,
  );
  const unaffordable = evaluate(
    mediumHero,
    [participant('puro-a3', 5, 0, 'medium', 'heroes')],
    path([5, 0], [10, 0]),
    { remaining: 10 },
  );
  check(
    '90.N) custo acima do restante é LEGAL mas não pagável (nunca commit parcial)',
    unaffordable.legal === true &&
      unaffordable.affordable === false &&
      unaffordable.blocker === null &&
      unaffordable.totalCostFeet === 15,
  );
  check(
    '90.O) saldo em pés deriva do orçamento em metros (9 m = 30 pés) e preserva 0,5',
    remainingMovementFeet(9, 0) === 30 &&
      remainingMovementFeet(9, 4.5) === 15 &&
      remainingMovementFeet(9, 4.25) === 15.83 &&
      remainingMovementFeet(9, 9) === 0,
  );
  check(
    '90.P) cena assistida não avalia movimento (nunca 0 pé fingido)',
    evaluateMovementPath({
      scene: spatialSceneOf({ mode: 'assisted' }),
      mover: mediumHero,
      others: [],
      path: path([5, 0]),
      prone: false,
      movementRemainingFeet: 30,
      terrain: walkingMovementTerrain,
      revealBlockers: true,
    }).blocker?.code === 'MOVEMENT_NOT_ASSESSED',
  );

  // =====================================================================
  // FIXTURES (contas/cenas próprias; nada real é tocado)
  // =====================================================================
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  let customRaceId: string | null = null;

  try {
    await (async () => {
      const master = await prisma.user.create({
        data: {
          username: `mv_m_${suffix}`,
          displayName: 'Mestre Movimento',
          passwordHash: 'fixture',
          role: 'MASTER',
        },
      });
      const player = await prisma.user.create({
        data: {
          username: `mv_p_${suffix}`,
          displayName: 'Jogador Movimento',
          passwordHash: 'fixture',
          role: 'PLAYER',
        },
      });
      const allyUser = await prisma.user.create({
        data: {
          username: `mv_a_${suffix}`,
          displayName: 'Aliado Movimento',
          passwordHash: 'fixture',
          role: 'PLAYER',
        },
      });
      const fairyUser = await prisma.user.create({
        data: {
          username: `mv_f_${suffix}`,
          displayName: 'Fada Movimento',
          passwordHash: 'fixture',
          role: 'PLAYER',
        },
      });
      userIds.push(master.id, player.id, allyUser.id, fairyUser.id);
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

      const customRace = await prisma.customRace.create({
        data: { name: `Minúsculo Movimento ${suffix}`, size: 'Tiny', speed: 9 },
      });
      customRaceId = customRace.id;

      const swordId = `mv-sword-${suffix}`;
      const hero = await prisma.character.create({
        data: {
          userId: player.id,
          name: 'Guerreiro Movimento',
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          raceId: 'human',
          strength: 16,
          dexterity: 12,
          inventory: [
            {
              id: swordId,
              name: 'Espada Longa',
              description: '',
              quantity: 1,
              weight: 3,
              slot: 'hand1',
              backpackX: null,
              backpackY: null,
              imageUrl: '',
              itemId: '',
              category: 'Arma',
              rarity: null,
              requiresAttunement: false,
              attuned: false,
              details: {
                weaponType: 'melee',
                weaponCategory: 'martial',
                damageCount: 1,
                damageDie: 8,
                damageType: 'Cortante',
                properties: [],
              },
              campSupply: { enabled: false, value: 0 },
            },
          ] as never,
          attacks: [],
        },
      });
      const ally = await prisma.character.create({
        data: {
          userId: allyUser.id,
          name: 'Aliada Movimento',
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          raceId: 'human',
        },
      });
      const fairy = await prisma.character.create({
        data: {
          userId: fairyUser.id,
          name: 'Fada Movimento',
          hpCurrent: 10,
          hpMax: 10,
          speed: 9,
          customRaceId: customRace.id,
        },
      });
      characterIds.push(hero.id, ally.id, fairy.id);

      // Lado é estado do COMBATANTE: o template da criatura nunca recebe side.
      const creature = (name: string, size: string) =>
        prisma.creature.create({
          data: {
            name,
            kind: 'NPC',
            type: 'Humanoide',
            size,
            hpCurrent: 50,
            hpMax: 50,
            speed: 9,
            armorClass: 12,
          },
        });
      const grunt = await creature('Bruto Movimento', 'Medium');
      const ogre = await creature('Ogro Movimento', 'Large');
      const titan = await creature('Titã Movimento', 'Huge');
      const imp = await creature('Diabrete Movimento', 'Tiny');
      const mystery = await creature('Mistério Movimento', 'Medium');
      const hidden = await creature('Espião Oculto Movimento', 'Medium');
      creatureIds.push(grunt.id, ogre.id, titan.id, imp.id, mystery.id, hidden.id);

      const combat = await prisma.combat.create({
        data: {
          status: 'ACTIVE',
          round: 1,
          currentIndex: 0,
          turnSequence: 1,
          spatialConfig: {
            mode: 'grid-2d',
            widthFeet: 200,
            heightFeet: 200,
            cellSizeFeet: 5,
          } as never,
          combatants: {
            create: [
              {
                kind: 'CHARACTER',
                characterId: hero.id,
                ownerUserId: player.id,
                name: hero.name,
                initiative: 100,
                dexterityMod: 1,
                turnEconomy: onTurnStart(9) as never,
                spatialPosition: { xFeet: 0, yFeet: 120 } as never,
              },
              {
                kind: 'CHARACTER',
                characterId: ally.id,
                ownerUserId: allyUser.id,
                name: ally.name,
                initiative: 90,
                dexterityMod: 1,
                turnEconomy: onTurnStart(9) as never,
                spatialPosition: { xFeet: 20, yFeet: 120 } as never,
                sideKey: 'heroes',
              },
              {
                kind: 'CHARACTER',
                characterId: fairy.id,
                ownerUserId: fairyUser.id,
                name: fairy.name,
                initiative: 80,
                dexterityMod: 3,
                turnEconomy: onTurnStart(9) as never,
                spatialPosition: { xFeet: 150, yFeet: 150 } as never,
              },
              {
                kind: 'NPC',
                creatureId: grunt.id,
                name: grunt.name,
                hpCurrent: 50,
                hpMax: 50,
                armorClass: 12,
                initiative: 70,
                dexterityMod: 1,
                spatialPosition: { xFeet: 40, yFeet: 120 } as never,
                sideKey: 'monsters',
              },
              {
                kind: 'NPC',
                creatureId: ogre.id,
                name: ogre.name,
                hpCurrent: 50,
                hpMax: 50,
                armorClass: 12,
                initiative: 60,
                dexterityMod: 1,
                spatialPosition: { xFeet: 50, yFeet: 120 } as never,
                sideKey: 'monsters',
              },
              {
                kind: 'NPC',
                creatureId: titan.id,
                name: titan.name,
                hpCurrent: 50,
                hpMax: 50,
                armorClass: 12,
                initiative: 50,
                dexterityMod: 1,
                spatialPosition: { xFeet: 70, yFeet: 120 } as never,
                sideKey: 'monsters',
              },
              {
                kind: 'NPC',
                creatureId: imp.id,
                name: imp.name,
                hpCurrent: 20,
                hpMax: 20,
                armorClass: 12,
                initiative: 40,
                dexterityMod: 3,
                spatialPosition: { xFeet: 90, yFeet: 120 } as never,
                sideKey: 'monsters',
              },
              {
                kind: 'NPC',
                creatureId: mystery.id,
                name: mystery.name,
                hpCurrent: 30,
                hpMax: 30,
                armorClass: 12,
                initiative: 30,
                dexterityMod: 0,
                spatialPosition: { xFeet: 30, yFeet: 140 } as never,
              },
              {
                kind: 'NPC',
                creatureId: hidden.id,
                name: hidden.name,
                hpCurrent: 20,
                hpMax: 20,
                armorClass: 12,
                initiative: 10,
                dexterityMod: 0,
                spatialPosition: { xFeet: 170, yFeet: 170 } as never,
              },
            ],
          },
        },
        include: { combatants: true },
      });
      combatIds.push(combat.id);
      const heroCombatant = combat.combatants.find((item) => item.characterId === hero.id)!;
      const fairyCombatant = combat.combatants.find((item) => item.characterId === fairy.id)!;
      const gruntCombatant = combat.combatants.find((item) => item.creatureId === grunt.id)!;
      const hiddenCombatant = combat.combatants.find((item) => item.creatureId === hidden.id)!;

      async function request(
        method: 'GET' | 'PATCH' | 'POST',
        endpoint: string,
        body?: unknown,
        auth: string = masterToken,
      ): Promise<HttpResult> {
        const response = await fetch(`${baseUrl}/api${endpoint}`, {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = (await response.json().catch(() => ({}))) as Record<string, any>;
        return { status: response.status, data };
      }

      let state = (await request('GET', '/combat/active')).data.combat as Record<string, any>;
      const operation = () => ({
        expectedVersion: state.version,
        operationId: randomUUID(),
      });
      const combatantOf = (id: string) =>
        state.combatants.find((item: any) => item.id === id);

      async function refresh(): Promise<void> {
        state = (await request('GET', '/combat/active')).data.combat;
      }

      const mechanicalState = (conditions: string[], exhaustionLevel = 0) => ({
        conditions: conditions.map((condition) => ({
          id: `sm-${condition}`,
          condition,
          sourceType: 'manual',
          sourceLabel: 'Teste',
          appliedBy: 'smoke',
          appliedAt: new Date().toISOString(),
        })),
        exhaustionLevel,
        log: [],
      });

      /** Reset de fixture: posição + economia + estado mecânico da ficha. */
      async function resetHero(
        xFeet: number,
        yFeet: number,
        options: { meters?: number; conditions?: string[]; exhaustionLevel?: number } = {},
      ): Promise<void> {
        await prisma.combatant.update({
          where: { id: heroCombatant.id },
          data: {
            spatialPosition: { xFeet, yFeet } as never,
            turnEconomy: onTurnStart(options.meters ?? 9) as never,
          },
        });
        await prisma.character.update({
          where: { id: hero.id },
          data: {
            mechanicalState: mechanicalState(
              options.conditions ?? [],
              options.exhaustionLevel ?? 0,
            ) as never,
            version: { increment: 1 },
          },
        });
        await prisma.combat.update({
          where: { id: combat.id },
          data: { version: { increment: 1 } },
        });
        await refresh();
      }

      async function preview(
        combatantId: string,
        steps: ReturnType<typeof path>,
        auth: string = masterToken,
      ): Promise<HttpResult> {
        return request(
          'POST',
          `/combat/${combat.id}/spatial/movement-preview`,
          { combatantId, path: steps },
          auth,
        );
      }

      async function move(
        combatantId: string,
        steps: ReturnType<typeof path>,
        auth: string = masterToken,
        op: { expectedVersion: number; operationId: string } = operation(),
      ): Promise<HttpResult> {
        const response = await request(
          'POST',
          `/combat/${combat.id}/spatial/movement`,
          { combatantId, path: steps, ...op },
          auth,
        );
        if (response.data.combat) state = response.data.combat;
        return response;
      }

      async function place(combatantId: string, xFeet: number, yFeet: number) {
        const response = await request(
          'PATCH',
          `/combat/${combat.id}/combatants/${combatantId}/spatial-position`,
          { position: { xFeet, yFeet }, ...operation() },
        );
        if (response.data.combat) state = response.data.combat;
        return response;
      }

      async function setSide(combatantId: string, sideKey: string | null, op = operation()) {
        const response = await request(
          'PATCH',
          `/combat/${combat.id}/combatants/${combatantId}/side`,
          { sideKey, ...op },
        );
        if (response.data.combat) state = response.data.combat;
        return response;
      }

      async function advanceTo(combatantId: string): Promise<boolean> {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const turn = await request('POST', '/combat/next-turn', {
            combatId: combat.id,
            ...operation(),
            skipDeathSave: true,
          });
          if (turn.status !== 200) return false;
          state = turn.data.combat;
          if (state.currentCombatantId === combatantId) return true;
        }
        return false;
      }

      const movementOf = (response: HttpResult) => response.data.movement;
      const blockerOf = (response: HttpResult) => response.data.movement?.blocker;

      // =====================================================================
      // 119 — SIDES (hostilidade explícita do encontro)
      // =====================================================================
      check(
        '90.Q) combates legados/novos começam com side NULL (nunca inferido)',
        combatantOf(heroCombatant.id).sideKey === null &&
          combatantOf(hiddenCombatant.id).sideKey === null,
      );
      const playerSideAttempt = await request(
        'PATCH',
        `/combat/${combat.id}/combatants/${heroCombatant.id}/side`,
        { sideKey: 'heroes', ...operation() },
        playerToken,
      );
      check(
        '90.R) só o MESTRE define lado: PLAYER recebe 403 e o combatente segue sem lado',
        playerSideAttempt.status === 403 &&
          (await prisma.combatant.findUniqueOrThrow({
            where: { id: heroCombatant.id },
            select: { sideKey: true },
          })).sideKey === null,
        JSON.stringify(playerSideAttempt.data),
      );
      const sideOp = { expectedVersion: state.version, operationId: randomUUID() };
      const sideSet = await setSide(heroCombatant.id, 'heroes', sideOp);
      check(
        '90.S) lado persiste no COMBATANTE e a ficha global não recebe lado',
        sideSet.status === 200 &&
          sideSet.data.combat.combatants.find((item: any) => item.id === heroCombatant.id)
            .sideKey === 'heroes' &&
          (await prisma.combatant.findUniqueOrThrow({ where: { id: heroCombatant.id } }))
            .sideKey === 'heroes' &&
          !('sideKey' in (await prisma.character.findUniqueOrThrow({ where: { id: hero.id } }))),
        JSON.stringify({ status: sideSet.status }),
      );
      const sideReplay = await setSide(heroCombatant.id, 'heroes', sideOp);
      check(
        '90.T) retry do lado devolve o snapshot (não reaplica nem estoura a versão)',
        sideReplay.status === 200 &&
          sideReplay.data.combat.version === sideSet.data.combat.version,
        JSON.stringify({ first: sideSet.data.combat?.version, retry: sideReplay.data.combat?.version }),
      );
      const sideStale = await setSide(heroCombatant.id, 'heroes', {
        expectedVersion: state.version - 1,
        operationId: randomUUID(),
      });
      const sideReused = await setSide(heroCombatant.id, 'monsters', {
        expectedVersion: state.version,
        operationId: sideOp.operationId,
      });
      check(
        '90.U) lado: versão velha dá 409 e operationId reutilizado com outro payload também',
        sideStale.status === 409 && sideReused.status === 409 &&
          (sideReused.data.error === 'IDEMPOTENCY_KEY_REUSED' || sideReused.status === 409),
        JSON.stringify({ stale: sideStale.status, reused: sideReused.status }),
      );
      const playerView = (await request('GET', '/combat/active', undefined, playerToken))
        .data.combat as Record<string, any>;
      check(
        '90.V) DTO do jogador NÃO recebe mapa de lados (Master-only nesta fase)',
        playerView.combatants.every((item: any) => item.sideKey === null) &&
          combatantOf(heroCombatant.id).sideKey === 'heroes',
      );

      // =====================================================================
      // 120 — MOVIMENTO NORMAL
      // =====================================================================
      check(
        '90.W) o turno atual é do personagem que vai se mover',
        state.currentCombatantId === heroCombatant.id,
      );
      await resetHero(0, 120);
      const stepFive = await move(heroCombatant.id, path([5, 120]));
      check(
        '90.X) mover 5 pés: posição, custo e movimento restante corretos',
        stepFive.status === 200 &&
          movementOf(stepFive).totalCostFeet === 5 &&
          movementOf(stepFive).movementRemainingAfterFeet === 25 &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 5,
        JSON.stringify(movementOf(stepFive)),
      );
      const diagonal = await move(heroCombatant.id, path([10, 125]));
      check(
        '90.Y) passo diagonal custa 5 (nunca Euclidiana) e o realtime recebe a nova posição',
        diagonal.status === 200 &&
          movementOf(diagonal).totalCostFeet === 5 &&
          movementOf(diagonal).totalDistanceFeet === 5 &&
          diagonal.data.combat.combatants.find((item: any) => item.id === heroCombatant.id)
            .spatial.position.yFeet === 125 &&
          diagonal.data.combat.version === stepFive.data.combat.version + 1,
      );
      const twoSteps = await move(heroCombatant.id, path([15, 130], [20, 135]));
      check(
        '90.Z) dois passos = 10 de distância e 10 de custo; restante acompanha',
        twoSteps.status === 200 &&
          movementOf(twoSteps).totalDistanceFeet === 10 &&
          movementOf(twoSteps).totalCostFeet === 10 &&
          movementOf(twoSteps).movementRemainingAfterFeet === 10 &&
          movementOf(twoSteps).steps.length === 2,
        JSON.stringify(movementOf(twoSteps)),
      );

      // =====================================================================
      // 123 — ALIADO (nonhostile)
      // =====================================================================
      // Começa em (10,120) para o caminho continuar passo a passo até (25,120).
      await resetHero(10, 120);
      const throughAllyHttp = await move(heroCombatant.id, path([15, 120], [20, 120], [25, 120]));
      check(
        '90.AA) atravessar aliado é permitido e aquele passo custa o DOBRO',
        throughAllyHttp.status === 200 &&
          movementOf(throughAllyHttp).steps[1].difficultTerrain === true &&
          movementOf(throughAllyHttp).steps[1].costFeet === 10 &&
          movementOf(throughAllyHttp).totalCostFeet === 20 &&
          movementOf(throughAllyHttp).movementRemainingAfterFeet === 10,
        JSON.stringify(movementOf(throughAllyHttp)),
      );
      await resetHero(15, 120);
      const finishOnAlly = await move(heroCombatant.id, path([20, 120]));
      check(
        '90.AB) terminar o movimento no espaço do aliado é RECUSADO (409) e nada se move',
        finishOnAlly.status === 409 &&
          movementOf(finishOnAlly) === undefined &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 15 &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 0,
        JSON.stringify(finishOnAlly.data),
      );

      // =====================================================================
      // 124 — HOSTIL (size difference)
      // =====================================================================
      await resetHero(35, 120);
      const sameSize = await move(heroCombatant.id, path([40, 120], [45, 120]));
      check(
        '90.AC) hostil do MESMO tamanho não pode ser atravessado',
        sameSize.status === 409 && sameSize.data.error === 'MOVEMENT_PATH_BLOCKED',
        JSON.stringify(sameSize.data),
      );
      await resetHero(45, 120);
      const oneSize = await move(heroCombatant.id, path([50, 120], [60, 120]));
      check(
        '90.AD) hostil com UMA categoria de diferença também não (regra 2014)',
        oneSize.status === 409 && oneSize.data.error === 'MOVEMENT_PATH_BLOCKED',
        JSON.stringify(oneSize.data),
      );
      // Huge ocupa 15 pés: atravessar custa 3 passos difíceis + 1 livre. O
      // orçamento maior é FIXTURE (o Mestre pode conceder movimento).
      await resetHero(65, 120, { meters: 15 });
      const twoSizes = await move(
        heroCombatant.id,
        path([70, 120], [75, 120], [80, 120], [85, 120]),
      );
      check(
        '90.AE) hostil com DUAS categorias é atravessável e aqueles passos são difficult',
        twoSizes.status === 200 &&
          movementOf(twoSizes).steps[0].difficultTerrain === true &&
          movementOf(twoSizes).steps[0].costFeet === 10 &&
          movementOf(twoSizes).steps[3].costFeet === 5 &&
          movementOf(twoSizes).totalCostFeet === 35 &&
          movementOf(twoSizes).movementRemainingAfterFeet === 15,
        JSON.stringify(movementOf(twoSizes)),
      );
      await resetHero(85, 120);
      const throughTiny = await move(heroCombatant.id, path([90, 120], [95, 120]));
      check(
        '90.AF) criatura hostil MENOR (Tiny) também é atravessável, com custo dobrado',
        throughTiny.status === 200 &&
          movementOf(throughTiny).steps[0].costFeet === 10 &&
          movementOf(throughTiny).steps[1].costFeet === 5,
        JSON.stringify(movementOf(throughTiny)),
      );
      await resetHero(25, 140);
      const unknownRelation = await move(heroCombatant.id, path([30, 140], [35, 140]));
      check(
        '90.AG) lado desconhecido recusa a adjudicação (não assume aliado nem hostil)',
        unknownRelation.status === 409 &&
          unknownRelation.data.error === 'MOVEMENT_RELATION_UNKNOWN' &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 25,
        JSON.stringify(unknownRelation.data),
      );

      // =====================================================================
      // 127 — BOUNDS / CANONICAL / SEM PATHFINDING
      // =====================================================================
      await resetHero(190, 120);
      const edgeOk = await preview(heroCombatant.id, path([195, 120]));
      const outOfBounds = await preview(heroCombatant.id, path([195, 120], [200, 120]));
      const outOfBoundsCommit = await move(heroCombatant.id, path([195, 120], [200, 120]));
      check(
        '90.AH) borda exata é válida e passo que sai da cena é recusado (sem commit parcial)',
        edgeOk.data.movement.legal === true &&
          outOfBounds.data.movement.blocker.code === 'MOVEMENT_OUT_OF_BOUNDS' &&
          outOfBoundsCommit.status === 400 &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 190,
        JSON.stringify({ edge: edgeOk.data.movement.status, out: outOfBounds.data.movement.blocker }),
      );
      const notCanonical = await preview(heroCombatant.id, path([192.5, 120]));
      const jump = await preview(heroCombatant.id, path([205, 120]));
      check(
        '90.AI) passo não canônico e salto são recusados (servidor NÃO redireciona)',
        notCanonical.data.movement.blocker.code === 'MOVEMENT_STEP_NOT_CANONICAL' &&
          jump.data.movement.blocker.code === 'MOVEMENT_STEP_NOT_CONTIGUOUS' &&
          jump.data.movement.destination === null,
        JSON.stringify({ canonical: notCanonical.data.movement.blocker, jump: jump.data.movement.blocker }),
      );

      // =====================================================================
      // 125 — PRONE (crawling) e STANDING (motor de Conditions existente)
      // =====================================================================
      await resetHero(0, 120, { conditions: ['prone'] });
      const crawlPreview = await preview(heroCombatant.id, path([5, 120]));
      const crawlCommit = await move(heroCombatant.id, path([5, 120]));
      check(
        '90.AJ) Caído (Prone) usa crawling: 5 pés custam 10 e o saldo cai igual',
        crawlPreview.data.movement.steps[0].crawling === true &&
          crawlPreview.data.movement.steps[0].costFeet === 10 &&
          crawlCommit.status === 200 &&
          movementOf(crawlCommit).movementRemainingAfterFeet === 20,
        JSON.stringify(movementOf(crawlCommit)),
      );
      await resetHero(15, 120, { conditions: ['prone'] });
      const crawlDifficult = await preview(heroCombatant.id, path([20, 120], [25, 120]));
      check(
        '90.AK) crawling + difficult terrain = 3× (5 pés custam 15, nunca 20)',
        crawlDifficult.data.movement.steps[0].crawling === true &&
          crawlDifficult.data.movement.steps[0].difficultTerrain === true &&
          crawlDifficult.data.movement.steps[0].costFeet === 15,
        JSON.stringify(crawlDifficult.data.movement.steps[0]),
      );
      await resetHero(0, 120, { conditions: ['prone'] });
      const heroVersion = (
        await prisma.character.findUniqueOrThrow({
          where: { id: hero.id },
          select: { version: true },
        })
      ).version;
      const stand = await request(
        'POST',
        '/mechanical/mutate',
        {
          entity: { kind: 'character', id: hero.id },
          action: 'stand',
          expectedVersion: heroVersion,
          expectedCombatVersion: state.version,
          operationId: randomUUID(),
        },
        playerToken,
      );
      await refresh();
      check(
        '90.AL) levantar reusa o motor de Conditions e gasta METADE do deslocamento',
        stand.status === 200 &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 4.5 &&
          remainingMovementFeet(
            combatantOf(heroCombatant.id).turnEconomy.movementBudget,
            combatantOf(heroCombatant.id).turnEconomy.movementUsed,
          ) === 15,
        JSON.stringify({
          status: stand.status,
          economy: combatantOf(heroCombatant.id).turnEconomy,
        }),
      );
      const afterStandOk = await move(heroCombatant.id, path([5, 120]));
      const afterStandFail = await move(heroCombatant.id, path([5, 125], [5, 130], [5, 135], [5, 140]));
      check(
        '90.AM) depois de levantar, o movimento espacial vê o saldo REAL (5 cabe, 20 não)',
        afterStandOk.status === 200 &&
          movementOf(afterStandOk).movementRemainingAfterFeet === 10 &&
          afterStandFail.status === 409 &&
          afterStandFail.data.error === 'MOVEMENT_INSUFFICIENT_REMAINING' &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 6,
        JSON.stringify({ ok: afterStandOk.status, fail: afterStandFail.data?.error }),
      );
      await resetHero(0, 120, { conditions: ['grappled'] });
      const grappledStand = await request(
        'POST',
        '/mechanical/mutate',
        {
          entity: { kind: 'character', id: hero.id },
          action: 'stand',
          expectedCombatVersion: state.version,
          expectedVersion: (
            await prisma.character.findUniqueOrThrow({
              where: { id: hero.id },
              select: { version: true },
            })
          ).version,
          operationId: randomUUID(),
        },
        playerToken,
      );
      const grappledMove = await move(heroCombatant.id, path([5, 120]));
      check(
        '90.AN) deslocamento efetivo 0 (Agarrado) bloqueia mover e levantar',
        grappledStand.status === 409 &&
          grappledMove.status === 409 &&
          grappledMove.data.error === 'MOVEMENT_SPEED_ZERO',
        JSON.stringify({ stand: grappledStand.status, move: grappledMove.data?.error }),
      );

      // =====================================================================
      // 126 — EFFECTIVE SPEED
      // =====================================================================
      await resetHero(0, 120, { exhaustionLevel: 2 });
      const exhaustedPreview = await preview(heroCombatant.id, path([5, 120], [10, 120]));
      const exhaustedShort = await preview(heroCombatant.id, path([5, 120]));
      const exhaustedLong = await preview(
        heroCombatant.id,
        path([5, 120], [5, 125], [5, 130]),
      );
      check(
        '90.AO) Exaustão 2 reduz o deslocamento efetivo (9 m → 4 m → 13,33 pés)',
        exhaustedPreview.data.movement.movementRemainingFeet === 13.33 &&
          exhaustedPreview.data.movement.affordable === true &&
          exhaustedLong.data.movement.affordable === false &&
          exhaustedShort.data.movement.totalCostFeet === 5,
        JSON.stringify({
          remaining: exhaustedPreview.data.movement.movementRemainingFeet,
          long: exhaustedLong.data.movement.affordable,
        }),
      );
      await resetHero(0, 120);
      const exactRemaining = await move(heroCombatant.id, path([5, 120], [5, 125], [5, 130], [5, 135], [5, 140], [5, 145]));
      const overRemaining = await move(heroCombatant.id, path([10, 145]));
      check(
        '90.AP) gastar o restante EXATO é válido e o excedente é recusado (saldo 0)',
        exactRemaining.status === 200 &&
          movementOf(exactRemaining).movementRemainingAfterFeet === 0 &&
          overRemaining.status === 409 &&
          overRemaining.data.error === 'MOVEMENT_INSUFFICIENT_REMAINING' &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 9,
        JSON.stringify({
          exact: movementOf(exactRemaining)?.movementRemainingAfterFeet,
          over: overRemaining.data?.error,
        }),
      );

      // =====================================================================
      // 121 — MOVIMENTO FRAGMENTADO (não é uma "Move Action")
      // =====================================================================
      await resetHero(0, 130);
      const fragmentFirst = await move(heroCombatant.id, path([5, 130], [10, 130]));
      const dodge = await request('POST', '/combat/action', {
        combatId: combat.id,
        combatantId: heroCombatant.id,
        action: 'dodge',
        ...operation(),
      });
      // A Ação incrementa a versão do combate: sem adotar a resposta, o trecho
      // seguinte sairia com versão velha (409 de concorrência).
      if (dodge.data.combat) state = dodge.data.combat;
      const afterAction = combatantOf(heroCombatant.id).turnEconomy;
      const fragmentSecond = await move(
        heroCombatant.id,
        path([15, 130], [20, 130], [25, 130], [30, 130]),
      );
      const economyEnd = combatantOf(heroCombatant.id).turnEconomy;
      check(
        '90.AQ) mover 10 → agir → mover 20 no MESMO turno (Action não reseta movimento)',
        fragmentFirst.status === 200 &&
          movementOf(fragmentFirst).movementRemainingAfterFeet === 20 &&
          dodge.status === 200 &&
          afterAction.actionsUsed === 1 &&
          afterAction.movementUsed === 3 &&
          fragmentSecond.status === 200 &&
          movementOf(fragmentSecond).totalCostFeet === 20 &&
          movementOf(fragmentSecond).movementRemainingAfterFeet === 0 &&
          economyEnd.movementUsed === 9 &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 30,
        JSON.stringify({ afterAction, economyEnd }),
      );

      // =====================================================================
      // 128 — IDEMPOTÊNCIA / VERSÃO / NO-OP
      // =====================================================================
      await resetHero(0, 120);
      const fixedOp = { expectedVersion: state.version, operationId: randomUUID() };
      const idempotentFirst = await move(heroCombatant.id, path([5, 120]), masterToken, fixedOp);
      const idempotentRetry = await move(heroCombatant.id, path([5, 120]), masterToken, fixedOp);
      check(
        '90.AR) retry do MESMO caminho não move de novo (snapshot + replayed)',
        idempotentFirst.status === 200 &&
          idempotentRetry.status === 200 &&
          idempotentRetry.data.replayed === true &&
          movementOf(idempotentRetry).movementRemainingAfterFeet ===
            movementOf(idempotentFirst).movementRemainingAfterFeet &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 5 &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 1.5,
        JSON.stringify({
          first: movementOf(idempotentFirst).movementRemainingAfterFeet,
          retry: idempotentRetry.data.replayed,
        }),
      );
      const reusedKey = await move(heroCombatant.id, path([10, 120]), masterToken, fixedOp);
      check(
        '90.AS) mesma chave com caminho DIFERENTE é reutilização de chave (409)',
        reusedKey.status === 409 &&
          reusedKey.data.error === 'IDEMPOTENCY_KEY_REUSED' &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 5,
        JSON.stringify(reusedKey.data),
      );
      const staleVersion = await move(heroCombatant.id, path([10, 120]), masterToken, {
        expectedVersion: state.version - 1,
        operationId: randomUUID(),
      });
      check(
        '90.AT) versão velha é recusada e a posição antiga não é reaplicada',
        staleVersion.status === 409 &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 5 &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 1.5,
        JSON.stringify(staleVersion.data),
      );
      const versionBeforeNoOp = state.version;
      const emptyPath = await move(heroCombatant.id, []);
      check(
        '90.AU) caminho vazio é NO-OP: nenhuma operação, versão ou gasto novo',
        emptyPath.status === 200 &&
          movementOf(emptyPath).totalCostFeet === 0 &&
          emptyPath.data.combat.version === versionBeforeNoOp &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 1.5,
        JSON.stringify({ version: emptyPath.data.combat?.version, before: versionBeforeNoOp }),
      );

      // =====================================================================
      // 129 — DISTÂNCIA E ALCANCE DEPOIS DO MOVIMENTO
      // =====================================================================
      await resetHero(5, 120);
      const distanceBefore = await request(
        'GET',
        `/combat/${combat.id}/spatial/distance?fromCombatantId=${heroCombatant.id}&toCombatantId=${gruntCombatant.id}`,
      );
      const rangeBefore = await request(
        'GET',
        `/combat/${combat.id}/spatial/range-preview?fromCombatantId=${heroCombatant.id}` +
          `&toCombatantId=${gruntCombatant.id}&attackId=${encodeURIComponent(`weapon:${swordId}`)}`,
      );
      const distanceMove = await move(
        heroCombatant.id,
        path([10, 125], [15, 125], [20, 125], [25, 125], [30, 125], [35, 125]),
      );
      const distanceAfter = await request(
        'GET',
        `/combat/${combat.id}/spatial/distance?fromCombatantId=${heroCombatant.id}&toCombatantId=${gruntCombatant.id}`,
      );
      const rangeAfter = await request(
        'GET',
        `/combat/${combat.id}/spatial/range-preview?fromCombatantId=${heroCombatant.id}` +
          `&toCombatantId=${gruntCombatant.id}&attackId=${encodeURIComponent(`weapon:${swordId}`)}`,
      );
      check(
        '90.AV) 6.6L.2 passa a responder a NOVA posição (sem cache) e o alcance acompanha',
        distanceMove.status === 200 &&
          distanceBefore.data.distance.distanceFeet === 35 &&
          distanceAfter.data.distance.distanceFeet === 5 &&
          rangeBefore.data.range.status === 'out-of-range' &&
          rangeAfter.data.range.status === 'in-range',
        JSON.stringify({
          before: distanceBefore.data.distance.distanceFeet,
          after: distanceAfter.data.distance.distanceFeet,
          range: [rangeBefore.data.range.status, rangeAfter.data.range.status],
        }),
      );

      // =====================================================================
      // 130 — PRIVACIDADE (criatura oculta ocupa, mas não se identifica)
      // =====================================================================
      await resetHero(160, 170);
      const hiddenPath = path([165, 170], [170, 170], [175, 170]);
      const masterPrivacy = await preview(heroCombatant.id, hiddenPath);
      const playerPrivacy = await preview(heroCombatant.id, hiddenPath, playerToken);
      const playerFinal = await preview(heroCombatant.id, path([165, 170], [170, 170]), playerToken);
      const playerPayload = JSON.stringify(playerPrivacy.data);
      check(
        '90.AW) criatura oculta CONTINUA ocupando o espaço na mecânica (bloqueia o Mestre)',
        masterPrivacy.data.movement.blocker.code === 'MOVEMENT_RELATION_UNKNOWN' &&
          masterPrivacy.data.movement.blocker.combatantId === hiddenCombatant.id &&
          masterPrivacy.data.movement.blocker.combatantName === 'Espião Oculto Movimento',
        JSON.stringify(masterPrivacy.data.movement.blocker),
      );
      check(
        '90.AX) resposta do jogador não revela ID, nome nem espaço de quem bloqueia',
        playerPrivacy.data.movement.blocker.code === 'MOVEMENT_RELATION_UNKNOWN' &&
          playerPrivacy.data.movement.blocker.combatantId === null &&
          playerPrivacy.data.movement.blocker.combatantName === null &&
          !playerPayload.includes(hiddenCombatant.id) &&
          !playerPayload.includes('Espião Oculto') &&
          !/occupiedSpace|tokenImageRef/.test(playerPayload) &&
          playerView.combatants.find((item: any) => item.id === hiddenCombatant.id).spatial === null,
        playerPayload,
      );
      check(
        '90.AY) destino ocupado também é sanitizado para o jogador',
        playerFinal.data.movement.blocker.code === 'MOVEMENT_DESTINATION_OCCUPIED' &&
          playerFinal.data.movement.blocker.combatantId === null &&
          !JSON.stringify(playerFinal.data).includes('Espião Oculto'),
      );

      // =====================================================================
      // 131 — REACTION GATE (nenhum bypass de Opportunity Attack)
      // =====================================================================
      const playerCommit = await move(heroCombatant.id, path([165, 170]), playerToken);
      check(
        '90.AZ) PLAYER não tem movimento voluntário antes do Reaction Gate (409, nada muda)',
        playerCommit.status === 409 &&
          playerCommit.data.error === 'MOVEMENT_REACTION_GATE_UNAVAILABLE' &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 160 &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === 0,
        JSON.stringify(playerCommit.data),
      );
      const adminGate = administrativeMovementGate.evaluate({
        moverCombatantId: heroCombatant.id,
        path: path([165, 170]),
      });
      const playerGate = unavailableMovementGate.evaluate({
        moverCombatantId: heroCombatant.id,
        path: path([165, 170]),
      });
      check(
        '90.BA) o gate é EXPLÍCITO: Mestre usa política administrativa e nunca é player-safe',
        adminGate.status === 'clear' &&
          adminGate.policy === 'administrative-no-reaction' &&
          adminGate.playerSafe === false &&
          playerGate.status === 'unavailable',
      );
      const placementBefore = combatantOf(heroCombatant.id).turnEconomy.movementUsed;
      const placement = await place(heroCombatant.id, 0, 120);
      check(
        '90.BB) placement do Mestre continua SEPARADO: muda posição sem consumir movimento',
        placement.status === 200 &&
          combatantOf(heroCombatant.id).spatial.position.xFeet === 0 &&
          combatantOf(heroCombatant.id).turnEconomy.movementUsed === placementBefore,
        JSON.stringify({
          before: placementBefore,
          after: combatantOf(heroCombatant.id).turnEconomy.movementUsed,
        }),
      );
      check(
        '90.BC) nenhuma Opportunity Attack é inventada/resolvida no commit',
        movementOf(distanceMove).reactionPolicy === 'administrative-no-reaction' &&
          movementOf(distanceMove).playerSafe === false &&
          !('opportunityAttack' in movementOf(distanceMove)) &&
          !('reaction' in movementOf(distanceMove)),
        JSON.stringify(movementOf(distanceMove).reactionPolicy),
      );

      // =====================================================================
      // 132 — FORA DE ESCOPO (ausências verificadas)
      // =====================================================================
      check(
        '90.BD) sem paredes/obstáculos/terreno desenhado na cena nem no payload',
        Object.keys(state.spatial).sort().join(',') ===
          'cellSizeFeet,heightFeet,mode,widthFeet' &&
          !('walls' in state.spatial) &&
          !('obstacles' in state.spatial) &&
          !('terrain' in movementOf(distanceMove)),
      );
      check(
        '90.BE) provider de terreno de produção NÃO inventa difficult terrain ambiental',
        walkingMovementTerrain.difficultAt({ xFeet: 0, yFeet: 0 }, 'medium') === 'normal' &&
          walkingMovementTerrain.difficultAt({ xFeet: 95, yFeet: 95 }, 'tiny') === 'normal' &&
          movementOf(distanceMove).steps.every(
            (step: any) => !step.difficultTerrainSources.includes('environmental'),
          ),
      );
      check(
        '90.BF) só caminhada 2D: sem voo, verticalidade, squeezing, movimento forçado nem AoE',
        movementOf(distanceMove).movementMode === 'walking' &&
          !/squeez|flying|flySpeed|altitude|elevation|forced|teleport|push|pull|area|radius|cone/i.test(
            JSON.stringify(movementOf(distanceMove)),
          ),
      );
      check(
        '90.BG) Cover e AoE continuam separados: o movimento não persiste cobertura nem área',
        state.spatial.mode === 'grid-2d' &&
          Object.keys(rangeAfter.data.range).sort().join(',') ===
            'actionName,algorithm,band,distanceFeet,longRangeFeet,normalRangeFeet,reachFeet,reason,status' &&
          !('cover' in movementOf(distanceMove)) &&
          !('area' in movementOf(distanceMove)),
        JSON.stringify(Object.keys(rangeAfter.data.range).sort()),
      );

      // =====================================================================
      // 122 — TINY (precisão de 2,5 pés no movimento)
      // =====================================================================
      check(
        '90.BH) o turno chegou à personagem Minúscula',
        await advanceTo(fairyCombatant.id),
      );
      await prisma.combatant.update({
        where: { id: fairyCombatant.id },
        data: { turnEconomy: onTurnStart(9) as never },
      });
      await prisma.combat.update({
        where: { id: combat.id },
        data: { version: { increment: 1 } },
      });
      await refresh();
      const tinyStep = await move(fairyCombatant.id, path([152.5, 150]));
      const tinyDiagonal = await move(fairyCombatant.id, path([155, 152.5]));
      const tinyFour = await move(
        fairyCombatant.id,
        path([157.5, 152.5], [160, 152.5], [162.5, 152.5], [165, 152.5]),
      );
      check(
        '90.BI) Tiny: 2,5 reto e diagonal custam 2,5 (sem arredondar para 5)',
        tinyStep.status === 200 &&
          movementOf(tinyStep).totalCostFeet === 2.5 &&
          movementOf(tinyStep).movementRemainingAfterFeet === 27.5 &&
          tinyDiagonal.status === 200 &&
          movementOf(tinyDiagonal).totalCostFeet === 2.5 &&
          movementOf(tinyDiagonal).movementRemainingAfterFeet === 25,
        JSON.stringify({
          step: movementOf(tinyStep)?.totalCostFeet,
          remaining: movementOf(tinyStep)?.movementRemainingAfterFeet,
        }),
      );
      check(
        '90.BJ) Tiny: quatro passos = 10 de distância/custo e fração preservada',
        tinyFour.status === 200 &&
          movementOf(tinyFour).totalDistanceFeet === 10 &&
          movementOf(tinyFour).totalCostFeet === 10 &&
          movementOf(tinyFour).movementRemainingAfterFeet === 15 &&
          combatantOf(fairyCombatant.id).spatial.position.xFeet === 165,
        JSON.stringify(movementOf(tinyFour)),
      );
      check(
        '90.BK) Tiny foi recusado ao tentar um passo de 5 pés (não é Small)',
        (await preview(fairyCombatant.id, path([170, 152.5]))).data.movement.blocker.code ===
          'MOVEMENT_STEP_NOT_CONTIGUOUS',
      );
    })();
  } finally {
    if (combatIds.length) {
      await prisma.combatOperation
        .deleteMany({ where: { combatId: { in: combatIds } } })
        .catch(() => undefined);
      await prisma.combatant
        .deleteMany({ where: { combatId: { in: combatIds } } })
        .catch(() => undefined);
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } }).catch(() => undefined);
    }
    if (customRaceId) {
      await prisma.character
        .updateMany({ where: { customRaceId }, data: { customRaceId: null } })
        .catch(() => undefined);
      await prisma.customRace.delete({ where: { id: customRaceId } }).catch(() => undefined);
    }
    if (characterIds.length) {
      await prisma.character
        .deleteMany({ where: { id: { in: characterIds } } })
        .catch(() => undefined);
    }
    if (creatureIds.length) {
      await prisma.creature
        .deleteMany({ where: { id: { in: creatureIds } } })
        .catch(() => undefined);
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
