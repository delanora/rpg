import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import {
  canConfirmOpportunityVisibility,
  detectReachBoundaries,
  movementReactionRiskOf,
  opportunityEligibility,
  opportunityOptionsOf,
  opportunityVisibilityOf,
  orderOpportunityReactors,
  type OpportunityAttackProfile,
  type ReachThreat,
} from '../modules/combat/spatial/opportunity-attack.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

/**
 * FASE 6.6L.3.1 — MOVEMENT REACTION GATE / OPPORTUNITY ATTACK (PHB 2014).
 *
 * Prova que o movimento voluntário deixou de ser sempre atômico:
 *  • o passo que faria a criatura SAIR do alcance é PAUSADO antes de acontecer;
 *  • reach é POR ATAQUE (espada 5 e lança 10 abrem janelas diferentes);
 *  • só lado hostil conhecido, Reação disponível, reactor capaz e que VÊ;
 *  • recusar não gasta a Reação; atacar gasta UMA e usa o resolver único;
 *  • o ataque resolve ANTES de sair do alcance e o movimento é revalidado;
 *  • várias janelas na mesma posição seguem a ordem de INICIATIVA, uma por vez;
 *  • 0 PV interrompe o movimento e cancela as janelas restantes;
 *  • a janela é PERSISTIDA (read model por HTTP + banco), não memória do React;
 *  • idempotência e concorrência não duplicam janela nem rerrolam ataque;
 *  • privacidade: o movente nunca recebe identidade do reactor oculto.
 *
 * NÃO implementa (e o teste de UI verifica a ausência): Sentinel, Polearm
 * Master, War Caster, magia como OA, Shield/Counterspell, LoS/cobertura
 * geométrica, pathfinding e Drag & Drop.
 */
export async function smokeOpportunityAttacks(
  baseUrl: string,
  check: Check,
): Promise<void> {
  console.log('\n91) Fase 6.6L.3.1 — Movement Reaction Gate / Opportunity Attack');

  // =====================================================================
  // A–K — MOTOR PURO (boundaries de reach POR ATAQUE e elegibilidade)
  // =====================================================================
  const body = (xFeet: number, yFeet: number, size: 'tiny' | 'small' | 'medium' | 'large' | 'huge' = 'medium') => ({
    position: { xFeet, yFeet },
    size,
  });
  const attack = (attackId: string, reachFeet: number): OpportunityAttackProfile => ({
    attackId,
    attackName: attackId,
    reachFeet,
  });
  const threat = (
    reactorCombatantId: string,
    xFeet: number,
    yFeet: number,
    attacks: OpportunityAttackProfile[],
    size: 'tiny' | 'small' | 'medium' | 'large' | 'huge' = 'medium',
  ): ReachThreat => ({
    reactorCombatantId,
    reactorName: reactorCombatantId,
    body: body(xFeet, yFeet, size),
    attacks,
  });
  const steps = (...pairs: [number, number][]) =>
    pairs.map(([xFeet, yFeet]) => ({ xFeet, yFeet }));
  const boundariesOf = (mover: ReturnType<typeof body>, path: { xFeet: number; yFeet: number }[], threats: ReachThreat[]) =>
    detectReachBoundaries({ mover, path, threats });

  const sword = attack('sword', 5);
  const lance = attack('lance', 10);
  // Distância do motor da 6.6L.2: bordas que se TOCAM já são 5 pés (adjacente).
  // Por isso sair do alcance 5 é 5 → 10, e não 0 → 5.
  const reactor5 = threat('reator-5', 200, 100, [sword]);
  const basic = boundariesOf(body(195, 100), steps([190, 100]), [reactor5]);
  check(
    '91.A) sair de 5 para 10 pés provoca UMA janela, com o ataque de alcance 5',
    basic.length === 1 &&
      basic[0].stepIndex === 0 &&
      basic[0].attacks.length === 1 &&
      basic[0].attacks[0].attackId === 'sword' &&
      basic[0].attacks[0].distanceBeforeFeet === 5,
    JSON.stringify(basic),
  );
  check(
    '91.B) permanecer no alcance (5 → 5) e ENTRAR no alcance (10 → 5) não provoca nada',
    boundariesOf(body(195, 100), steps([195, 105]), [reactor5]).length === 0 &&
      boundariesOf(body(190, 100), steps([195, 100]), [reactor5]).length === 0 &&
      // já fora do alcance: continuar andando não provoca
      boundariesOf(body(185, 100), steps([180, 100]), [reactor5]).length === 0,
  );
  const multiReach = threat('reator-multi', 200, 100, [sword, lance]);
  const atFive = boundariesOf(body(195, 100), steps([190, 100], [185, 100]), [multiReach]);
  check(
    '91.C) multi-reach: sair de 5 oferece SÓ a espada; sair de 10 abre a SEGUNDA janela com a lança',
    atFive.length === 2 &&
      atFive[0].stepIndex === 0 &&
      atFive[0].attacks.map((item) => item.attackId).join(',') === 'sword' &&
      atFive[1].stepIndex === 1 &&
      atFive[1].attacks.map((item) => item.attackId).join(',') === 'lance',
    JSON.stringify(atFive.map((item) => [item.stepIndex, item.attacks.map((a) => a.attackId)])),
  );
  check(
    '91.D) dois ataques com o MESMO alcance viram opções da MESMA janela',
    boundariesOf(body(195, 100), steps([190, 100]), [
      threat('reator-duplo', 200, 100, [sword, attack('sword2', 5)]),
    ])[0].attacks.length === 2,
  );
  const tinyBoundary = boundariesOf(body(195, 100, 'tiny'), steps([192.5, 100]), [
    threat('reator-tiny', 200, 100, [sword]),
  ]);
  check(
    '91.E) Tiny mantém boundary de 2,5 pés (5 → 7,5) sem arredondar para 5',
    tinyBoundary.length === 1 && tinyBoundary[0].attacks[0].distanceBeforeFeet === 5,
    JSON.stringify(tinyBoundary),
  );
  const largeBoundary = boundariesOf(body(190, 100, 'large'), steps([185, 100]), [
    threat('reator-large', 200, 100, [sword]),
  ]);
  check(
    '91.F) Large usa footprint (borda mais próxima): sair do alcance na distância real',
    largeBoundary.length === 1 && largeBoundary[0].attacks[0].distanceBeforeFeet === 5,
    JSON.stringify(largeBoundary),
  );

  const eligible = (patch: Partial<Parameters<typeof opportunityEligibility>[0]>) =>
    opportunityEligibility({
      relation: 'hostile',
      reactionAvailable: true,
      canAct: true,
      disengaging: false,
      visibility: 'known-visible',
      hasMeleeOption: true,
      ...patch,
    });
  check(
    '91.G) elegibilidade: só hostil conhecido, com Reação, capaz, que vê e com ataque corpo a corpo',
    eligible({}).eligible &&
      !eligible({ relation: 'same' }).eligible &&
      !eligible({ relation: 'unknown' }).eligible &&
      !eligible({ reactionAvailable: false }).eligible &&
      !eligible({ canAct: false }).eligible &&
      !eligible({ disengaging: true }).eligible &&
      !eligible({ visibility: 'known-not-visible' }).eligible &&
      !eligible({ hasMeleeOption: false }).eligible,
  );
  check(
    '91.H) visão: fato autoritativo manda; geometria ausente vira UNKNOWN, nunca visível por omissão',
    opportunityVisibilityOf({ canSeeMover: false, occludersExist: false }) ===
      'known-not-visible' &&
      opportunityVisibilityOf({ canSeeMover: true, occludersExist: false }) ===
        'known-visible' &&
      opportunityVisibilityOf({ canSeeMover: true, occludersExist: true }) === 'unknown' &&
      canConfirmOpportunityVisibility('unknown') &&
      !canConfirmOpportunityVisibility('known-not-visible'),
  );
  check(
    '91.I) reactors são ordenados pela INICIATIVA e o risco nunca promete caminho seguro',
    orderOpportunityReactors([
      { reactorCombatantId: 'b', orderIndex: 2 },
      { reactorCombatantId: 'a', orderIndex: 1 },
    ])[0].reactorCombatantId === 'a' &&
      movementReactionRiskOf({ possible: true, relationUnknown: true, awaitingMaster: true }) ===
        'possible' &&
      movementReactionRiskOf({ possible: false, relationUnknown: true, awaitingMaster: false }) ===
        'relation-unknown' &&
      movementReactionRiskOf({ possible: false, relationUnknown: false, awaitingMaster: true }) ===
        'master-adjudication-required',
  );
  check(
    '91.J) opções da janela carregam o id do ATAQUE e o alcance daquele ataque',
    opportunityOptionsOf(basic[0])[0]?.attackId === 'sword' &&
      opportunityOptionsOf(basic[0])[0]?.reachFeet === 5 &&
      opportunityOptionsOf(atFive[1])[0]?.reachFeet === 10,
  );

  // =====================================================================
  // FIXTURES — contas, fichas, NPC e combates criados direto no banco
  // =====================================================================
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const createdCombats: string[] = [];
  const creatureIds: string[] = [];
  const characterIds: string[] = [];
  try {
    const master = await prisma.user.create({
      data: { username: `oa_m_${suffix}`, displayName: 'Mestre OA', passwordHash: 'fixture', role: 'MASTER' },
    });
    const moverOwner = await prisma.user.create({
      data: { username: `oa_pm_${suffix}`, displayName: 'Movente OA', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const reactorOwner = await prisma.user.create({
      data: { username: `oa_pr_${suffix}`, displayName: 'Reator OA', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, moverOwner.id, reactorOwner.id);
    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });
    const moverToken = signToken({
      sub: moverOwner.id, username: moverOwner.username, displayName: moverOwner.displayName, role: moverOwner.role,
    });
    const reactorToken = signToken({
      sub: reactorOwner.id, username: reactorOwner.username, displayName: reactorOwner.displayName, role: reactorOwner.role,
    });

    const sw = { id: 'oa-sword', name: 'Espada Longa', category: 'Arma', slot: 'hand1', details: {
      weaponType: 'melee', weaponCategory: 'martial', damageCount: 1, damageDie: 8, damageType: 'Cortante',
      properties: ['versatile'], versatileDie: 10,
    } };
    const lc = { id: 'oa-lance', name: 'Lança de Justa', category: 'Arma', slot: 'hand2', details: {
      weaponType: 'melee', weaponCategory: 'martial', damageCount: 1, damageDie: 10, damageType: 'Perfurante',
      // `reach` dá +5 pés de alcance no MESMO derivador da 6.6L.2.
      properties: ['reach'],
    } };

    const mover = await prisma.character.create({
      data: {
        userId: moverOwner.id, name: 'Movente OA', classes: [{ classKey: 'fighter', level: 5, subclass: '' }],
        hpMax: 40, hpCurrent: 40, speed: 30, raceId: 'human', strength: 10, dexterity: 10,
        armorClass: 0, // AC determinística: a janela/rolagem é o que importa aqui
      },
    });
    characterIds.push(mover.id);
    const reactor = await prisma.character.create({
      data: {
        userId: reactorOwner.id, name: 'Reator OA', classes: [{ classKey: 'fighter', level: 5, subclass: '' }],
        hpMax: 60, hpCurrent: 60, speed: 30, raceId: 'human', strength: 20, dexterity: 12,
        inventory: inventoryListSchema.parse([sw, lc]),
      },
    });
    characterIds.push(reactor.id);

    let combatId = '';
    let moverCombatantId = '';
    let reactorCombatantId = '';
    let npcCombatantId = '';
    let npcCreatureId = '';

    const versionNow = async (): Promise<number> =>
      (await prisma.combat.findUnique({ where: { id: combatId }, select: { version: true } }))!.version;

    async function request(path: string, payload: unknown, token: string): Promise<HttpResult> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> };
    }

    const resetCharacters = async (options: { moverHp?: number } = {}) => {
      await prisma.character.update({
        where: { id: mover.id },
        data: {
          hpCurrent: options.moverHp ?? 40,
          deathState: {},
          mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] },
        },
      });
      await prisma.character.update({
        where: { id: reactor.id },
        data: {
          mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] },
        },
      });
    };

    /**
     * Cenário novo: mover (personagem do jogador A) e 1–2 reactors, cada um com
     * a própria posição de grid. Sempre começa do zero (combate anterior é
     * apagado) para que nenhum teste dependa do anterior.
     */
    const scenario = async (options: {
      reactorAt?: [number, number];
      npcAt?: [number, number];
      moverAt?: [number, number];
      reactorMechanical?: unknown;
      reactorReaction?: boolean;
      reactorSide?: string | null;
      moverSide?: string | null;
      moverHp?: number;
    } = {}) => {
      // `null` é um VALOR (lado desconhecido), então não pode cair no default.
      const reactorSide = options.reactorSide === undefined ? 'monsters' : options.reactorSide;
      const moverSide = options.moverSide === undefined ? 'heroes' : options.moverSide;
      if (createdCombats.length > 0) {
        await prisma.combat.deleteMany({ where: { id: { in: createdCombats } } });
        createdCombats.length = 0;
      }
      await resetCharacters({ moverHp: options.moverHp });
      if (options.reactorMechanical !== undefined) {
        await prisma.character.update({
          where: { id: reactor.id },
          data: { mechanicalState: options.reactorMechanical as never },
        });
      }
      const reactorAt = options.reactorAt ?? [200, 100];
      const moverAt = options.moverAt ?? [195, 100];
      const combat = await prisma.combat.create({
        data: {
          status: 'ACTIVE',
          round: 1,
          currentIndex: 0,
          turnSequence: 1,
          spatialConfig: { mode: 'grid-2d', widthFeet: 400, heightFeet: 400, cellSizeFeet: 5 },
          combatants: {
            create: [
              {
                kind: 'CHARACTER', characterId: mover.id, ownerUserId: moverOwner.id, name: mover.name,
                initiative: 30, dexterityMod: 0, sideKey: moverSide,
                spatialPosition: { xFeet: moverAt[0], yFeet: moverAt[1] },
                turnEconomy: onTurnStart(30),
              },
              {
                kind: 'CHARACTER', characterId: reactor.id, ownerUserId: reactorOwner.id, name: reactor.name,
                initiative: 20, dexterityMod: 1, sideKey: reactorSide,
                spatialPosition: { xFeet: reactorAt[0], yFeet: reactorAt[1] },
                turnEconomy: { ...onTurnStart(30), reactionAvailable: options.reactorReaction ?? true },
              },
            ],
          },
        },
        include: { combatants: true },
      });
      createdCombats.push(combat.id);
      combatId = combat.id;
      moverCombatantId = combat.combatants.find((item) => item.characterId === mover.id)!.id;
      reactorCombatantId = combat.combatants.find((item) => item.characterId === reactor.id)!.id;
      npcCombatantId = '';
      if (options.npcAt) {
        if (!npcCreatureId) {
          const npc = await prisma.creature.create({
            data: {
              name: 'Capanga OA', kind: 'NPC', hpMax: 40, hpCurrent: 40, speed: 9,
              inventory: inventoryListSchema.parse([{ ...sw, id: 'oa-npc-sword' }]),
            },
          });
          npcCreatureId = npc.id;
          creatureIds.push(npc.id);
        }
        const npcCombatant = await prisma.combatant.create({
          data: {
            combatId: combat.id, kind: 'CREATURE', creatureId: npcCreatureId, name: 'Capanga OA',
            hpCurrent: 40, hpMax: 40, armorClass: 12, initiative: 10, dexterityMod: 1,
            sideKey: 'monsters', spatialPosition: { xFeet: options.npcAt[0], yFeet: options.npcAt[1] },
            turnEconomy: onTurnStart(30),
          },
        });
        npcCombatantId = npcCombatant.id;
      }
      return { combatId, moverCombatantId, reactorCombatantId, npcCombatantId };
    };

    const move = async (
      path: { xFeet: number; yFeet: number }[],
      token = moverToken,
      operationId = randomUUID(),
    ) =>
      request(
        `/combat/${combatId}/spatial/movement`,
        { combatantId: moverCombatantId, path, expectedVersion: await versionNow(), operationId },
        token,
      );

    const readModel = async (token = masterToken): Promise<HttpResult> =>
      request(`/combat/${combatId}/reaction-opportunities`, undefined, token);

    const countOpportunities = async (status = 'pending'): Promise<number> =>
      prisma.reactionOpportunity.count({ where: { combatId, status } });

    const opportunityOf = (data: Record<string, any>, reactorCombatant?: string) => {
      const list: any[] = data.opportunities ?? [];
      return list.find((item) => !reactorCombatant || item.reactorCombatantId === reactorCombatant) ?? null;
    };

    const attackReaction = async (
      opportunityId: string,
      attackId: string,
      token = reactorToken,
      operationId = randomUUID(),
      // Versão FIXA quando o teste precisa provar replay (a idempotência é
      // conferida com o MESMO payload, inclusive a versão esperada).
      fixedVersion?: number,
    ) =>
      request(
        `/combat/${combatId}/reaction-opportunities/${opportunityId}/attack`,
        {
          combatId,
          attackId,
          expectedVersion: fixedVersion ?? (await versionNow()),
          operationId,
        },
        token,
      );

    const declineReaction = async (
      opportunityId: string,
      token = reactorToken,
      operationId = randomUUID(),
    ) =>
      request(
        `/combat/${combatId}/reaction-opportunities/${opportunityId}/decline`,
        { combatId, expectedVersion: await versionNow(), operationId },
        token,
      );

    const positionOf = async (combatantId: string) => {
      const row = await prisma.combatant.findUnique({
        where: { id: combatantId },
        select: { spatialPosition: true },
      });
      return row?.spatialPosition as { xFeet: number; yFeet: number } | null;
    };
    const economyOfCombatant = async (combatantId: string) =>
      (await prisma.combatant.findUnique({ where: { id: combatantId }, select: { turnEconomy: true } }))!
        .turnEconomy as Record<string, any>;

    // =====================================================================
    // 92) OA BÁSICA, PREVIEW, PRIVACIDADE E BLOQUEIOS
    // =====================================================================
    console.log('\n92) Janela básica de 5 pés, preview e privacidade');
    await scenario();
    const previewPlayer = await request(
      `/combat/${combatId}/spatial/movement-preview`,
      { combatantId: moverCombatantId, path: steps([190, 100]) },
      moverToken,
    );
    const previewMaster = await request(
      `/combat/${combatId}/spatial/movement-preview`,
      { combatantId: moverCombatantId, path: steps([190, 100]) },
      masterToken,
    );
    check(
      '92.A) preview do jogador avisa que há risco de Reação SEM citar reactor/arma/alcance',
      previewPlayer.status === 200 &&
        previewPlayer.data.reaction.risk === 'possible' &&
        previewPlayer.data.reaction.boundaries.length === 0 &&
        !JSON.stringify(previewPlayer.data).includes(reactorCombatantId),
      JSON.stringify(previewPlayer.data.reaction),
    );
    check(
      '92.B) preview do Mestre traz o diagnóstico completo (passo, reactor e ataques)',
      previewMaster.data.reaction.boundaries.length === 1 &&
        previewMaster.data.reaction.boundaries[0].reactorCombatantId === reactorCombatantId &&
        previewMaster.data.reaction.boundaries[0].options.map((item: any) => item.attackId).join(',') ===
          'weapon:oa-sword',
      JSON.stringify(previewMaster.data.reaction.boundaries),
    );

    const basicMove = await move(steps([190, 100]));
    check(
      '92.C) o movimento PAUSA antes do passo: posição e custo continuam na posição anterior',
      basicMove.status === 200 &&
        basicMove.data.pending?.combatantId === moverCombatantId &&
        basicMove.data.pending.opportunities === 1 &&
        basicMove.data.movement.totalCostFeet === 0 &&
        (await positionOf(moverCombatantId))?.xFeet === 195,
      JSON.stringify(basicMove.data.pending ?? basicMove.data),
    );
    check(
      '92.D) a janela nasce PENDENTE, com a opção do ataque que está sendo deixado',
      basicMove.data.combat.combatants.find((item: any) => item.id === reactorCombatantId).turnEconomy
        .reactionAvailable === true && (await countOpportunities()) === 1,
    );

    const reactorView = await readModel(reactorToken);
    const reactorOpportunity = opportunityOf(reactorView.data, reactorCombatantId);
    check(
      '92.E) o dono do reactor vê a janela actionable, com o gatilho e a opção válida',
      reactorView.status === 200 &&
        reactorOpportunity !== null &&
        reactorOpportunity.actionable === true &&
        reactorOpportunity.status === 'pending' &&
        reactorOpportunity.visibilityStatus === 'known-visible' &&
        reactorOpportunity.options.length === 1 &&
        reactorOpportunity.options[0].attackId === 'weapon:oa-sword' &&
        typeof reactorOpportunity.trigger === 'string' &&
        reactorOpportunity.trigger.length > 0,
      JSON.stringify(reactorOpportunity),
    );
    const moverView = await readModel(moverToken);
    const moverViewText = JSON.stringify(moverView.data);
    check(
      '92.F) o movente NÃO recebe a janela nem a identidade do reactor: só "aguardando o Mestre"',
      moverView.data.opportunities.length === 0 &&
        moverView.data.movement?.combatantId === moverCombatantId &&
        moverView.data.movement.awaitingMaster === true &&
        !moverViewText.includes(reactorCombatantId) &&
        !moverViewText.includes('Espada Longa') &&
        !moverViewText.includes('Lança'),
      moverViewText,
    );
    const nextTurnBlocked = await request(
      `/combat/next-turn`,
      { combatId, expectedVersion: await versionNow(), operationId: randomUUID() },
      moverToken,
    );
    check(
      '92.G) nada de avançar turno com movimento pausado (409 MOVEMENT_REACTION_PENDING)',
      nextTurnBlocked.status === 409 &&
        nextTurnBlocked.data.error === 'MOVEMENT_REACTION_PENDING',
      JSON.stringify(nextTurnBlocked.data),
    );
    const secondCommit = await move(steps([195, 105]));
    check(
      '92.H) o mesmo mover não inicia outro movimento enquanto a janela está aberta',
      secondCommit.status === 409 && secondCommit.data.error === 'MOVEMENT_PENDING_REACTION',
      JSON.stringify(secondCommit.data),
    );
    const otherPlayerDecline = await declineReaction(reactorOpportunity.id, reactorToken);
    const afterDecline = await readModel(reactorToken);
    check(
      '92.I) recusar NÃO gasta a Reação, fecha a janela e o movimento CONTINUA até o destino',
      otherPlayerDecline.status === 200 &&
        otherPlayerDecline.data.reason === 'declined' &&
        afterDecline.data.opportunities.length === 0 &&
        afterDecline.data.movement === null &&
        (await economyOfCombatant(reactorCombatantId)).reactionAvailable === true &&
        (await positionOf(moverCombatantId))?.xFeet === 190 &&
        (await countOpportunities()) === 0,
      JSON.stringify({ status: otherPlayerDecline.status, data: otherPlayerDecline.data }),
    );
    check(
      '92.J) 6.6L.2 passa a responder a posição nova depois da retomada (sem cache)',
      (await request(
        `/combat/${combatId}/spatial/distance?fromCombatantId=${moverCombatantId}&toCombatantId=${reactorCombatantId}`,
        undefined,
        masterToken,
      )).data.distance.distanceFeet === 10,
    );

    // =====================================================================
    // 93) EXECUTAR: um ataque, UMA Reação, MESMO resolver, movimento segue
    // =====================================================================
    console.log('\n93) Execução da Reação e segunda janela com alcance maior');
    await scenario();
    const twoSteps = await move(steps([190, 100], [185, 100]));
    const firstWindow = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
    const firstDecline = await declineReaction(firstWindow.id);
    const laneWindow = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
    check(
      '93.A) recusar a janela de 5 continua o caminho e abre a de 10 pés com a LANÇA',
      firstDecline.status === 200 &&
        twoSteps.data.pending !== null &&
        (await positionOf(moverCombatantId))?.xFeet === 190 &&
        laneWindow !== null &&
        laneWindow.options.length === 1 &&
        laneWindow.options[0].attackId === 'weapon:oa-lance' &&
        laneWindow.reachFeet === 10,
      JSON.stringify({ decline: firstDecline.data, lane: laneWindow }),
    );
    const executed = await attackReaction(laneWindow.id, 'weapon:oa-lance');
    const executedEconomy = await economyOfCombatant(reactorCombatantId);
    const executedResult = executed.data.result ?? {};
    check(
      '93.B) o ataque usa o resolver ÚNICO: rola 1d20 contra a CA e devolve o resultado auditável',
      executed.status === 200 &&
        typeof executedResult.attackTotal === 'number' &&
        typeof executedResult.targetArmorClass === 'number' &&
        typeof executedResult.hit === 'boolean' &&
        executedResult.attackName === 'Lança de Justa',
      JSON.stringify(executedResult),
    );
    check(
      '93.C) a Reação é consumida no MESMO commit do ataque e o dano é real (ou 0 no erro)',
      executedEconomy.reactionAvailable === false &&
        (executedResult.hit
          ? (executedResult.damageRolled as number) > 0 &&
            executed.data.combat.combatants.find((item: any) => item.id === moverCombatantId)
              .hpCurrent < 40
          : (executedResult.damageRolled as number) === 0),
      JSON.stringify({ economy: executedEconomy, damage: executedResult.damageRolled }),
    );
    check(
      '93.D) depois da Reação o movimento é revalidado e continua até o destino',
      executed.data.reaction?.moverDefeated === false &&
        (await positionOf(moverCombatantId))?.xFeet === 185 &&
        (await countOpportunities()) === 0 &&
        (await readModel(reactorToken)).data.movement === null &&
        (await prisma.movementIntent.findFirst({
          where: { combatId, combatantId: moverCombatantId },
          orderBy: { createdAt: 'desc' },
        }))?.status === 'committed',
      JSON.stringify(executed.data.reaction),
    );

    // =====================================================================
    // 94) SEM JANELA: Reação gasta, mesmo lado, lado desconhecido, condições
    // =====================================================================
    console.log('\n94) Quando NÃO existe Opportunity Attack');
    await scenario({ reactorReaction: false });
    const usedReaction = await move(steps([190, 100]));
    check(
      '94.A) Reaction indisponível não abre janela (movimento conclui)',
      usedReaction.status === 200 &&
        usedReaction.data.pending === null &&
        (await positionOf(moverCombatantId))?.xFeet === 190 &&
        (await countOpportunities()) === 0,
      JSON.stringify(usedReaction.data.pending),
    );
    await scenario({ reactorSide: 'heroes' });
    const sameSide = await move(steps([190, 100]));
    check(
      '94.B) mesmo lado conhecido não provoca; a Reação do aliado continua disponível',
      sameSide.data.pending === null && (await economyOfCombatant(reactorCombatantId)).reactionAvailable === true,
    );
    await scenario({ reactorSide: null });
    const unknownSidePreview = await request(
      `/combat/${combatId}/spatial/movement-preview`,
      { combatantId: moverCombatantId, path: steps([190, 100]) },
      moverToken,
    );
    const unknownSide = await move(steps([190, 100]));
    check(
      '94.C) lado desconhecido NUNCA vira janela e o preview declara o risco (nunca "seguro")',
      unknownSide.data.pending === null &&
        unknownSidePreview.data.reaction.risk === 'relation-unknown' &&
        (await countOpportunities()) === 0,
      JSON.stringify(unknownSidePreview.data.reaction),
    );
    const incapacitatedState = {
      conditions: [
        {
          id: `oa-paralyzed-${suffix}`,
          condition: 'paralyzed',
          sourceType: 'manual',
          sourceLabel: 'Smoke OA',
          appliedAt: new Date().toISOString(),
        },
      ],
      exhaustionLevel: 0,
      log: [],
    };
    await scenario({ reactorMechanical: incapacitatedState });
    const incapacitated = await move(steps([190, 100]));
    check(
      '94.D) reactor Incapacitado não recebe janela (não pode fazer Reações)',
      incapacitated.data.pending === null && (await countOpportunities()) === 0,
      JSON.stringify(incapacitated.data.pending),
    );
    const blindedState = {
      conditions: [
        {
          id: `oa-blinded-${suffix}`,
          condition: 'blinded',
          sourceType: 'manual',
          sourceLabel: 'Smoke OA',
          appliedAt: new Date().toISOString(),
        },
      ],
      exhaustionLevel: 0,
      log: [],
    };
    await scenario({ reactorMechanical: blindedState });
    const blinded = await move(steps([190, 100]));
    check(
      '94.E) reactor que NÃO VÊ o movente não abre janela (fato autoritativo, sem confirmação)',
      blinded.data.pending === null && (await countOpportunities()) === 0,
    );

    // =====================================================================
    // 95) DESENGAJAR
    // =====================================================================
    console.log('\n95) Desengajar');
    await scenario();
    const disengage = await request(
      `/combat/action`,
      {
        combatId,
        combatantId: moverCombatantId,
        action: 'disengage',
        expectedVersion: await versionNow(),
        operationId: randomUUID(),
      },
      moverToken,
    );
    const disengageMove = await move(steps([190, 100]));
    check(
      '95.A) Desengajar suprime a OA do movimento DAQUELE combatente e não desliga a Reação do inimigo',
      disengage.status === 200 &&
        disengageMove.status === 200 &&
        disengageMove.data.pending === null &&
        (await positionOf(moverCombatantId))?.xFeet === 190 &&
        (await economyOfCombatant(moverCombatantId)).disengaging === true &&
        (await economyOfCombatant(reactorCombatantId)).reactionAvailable === true &&
        (await countOpportunities()) === 0,
      JSON.stringify({ disengage: disengage.data.combat ? 'ok' : disengage.data, move: disengageMove.data.pending }),
    );

    // =====================================================================
    // 96) MÚLTIPLOS REACTORS, ORDEM DE INICIATIVA E AUTORIDADE
    // =====================================================================
    console.log('\n96) Fila de reactors e autoridade da Reação');
    await scenario({ npcAt: [200, 105] });
    const multiMove = await move(steps([190, 100]));
    const masterView = await readModel(masterToken);
    const queue = masterView.data.opportunities as any[];
    const playerOpportunity = opportunityOf(masterView.data, reactorCombatantId);
    const npcOpportunity = opportunityOf(masterView.data, npcCombatantId);
    check(
      '96.A) dois reactors no mesmo passo geram DUAS janelas, ambas pendentes',
      multiMove.data.pending !== null &&
        multiMove.data.pending.opportunities === 2 &&
        queue.length === 2 &&
        (await countOpportunities()) === 2,
      JSON.stringify(queue.map((item) => [item.reactorName, item.orderIndex])),
    );
    check(
      '96.B) a ordem é a da INICIATIVA e só a PRIMEIRA é actionable',
      playerOpportunity?.orderIndex === 1 &&
        npcOpportunity?.orderIndex === 2 &&
        playerOpportunity?.actionable === true &&
        npcOpportunity?.actionable === false,
      JSON.stringify({ player: playerOpportunity?.actionable, npc: npcOpportunity?.actionable }),
    );
    const playerTriesNpc = await attackReaction(npcOpportunity.id, 'weapon:oa-npc-sword', reactorToken);
    check(
      '96.C) o jogador NÃO resolve a janela de um NPC (403, autoridade do Mestre)',
      playerTriesNpc.status === 403 && playerTriesNpc.data.error !== undefined,
      JSON.stringify(playerTriesNpc.data),
    );
    const declineFirst = await declineReaction(playerOpportunity.id);
    const afterFirst = await readModel(masterToken);
    const npcNow = opportunityOf(afterFirst.data, npcCombatantId);
    check(
      '96.D) recusada a primeira, a SEGUNDA vira actionable (mesma posição do movente)',
      declineFirst.status === 200 &&
        npcNow?.actionable === true &&
        (await positionOf(moverCombatantId))?.xFeet === 195 &&
        (await countOpportunities()) === 1,
      JSON.stringify(npcNow),
    );
    const masterDecline = await declineReaction(npcOpportunity.id, masterToken);
    check(
      '96.E) Mestre pode recusar pela criatura (auditável) e o movimento continua',
      masterDecline.status === 200 &&
        masterDecline.data.reason === 'master-declined' &&
        (await positionOf(moverCombatantId))?.xFeet === 190 &&
        (await countOpportunities()) === 0,
      JSON.stringify(masterDecline.data),
    );
    const npcRow = await prisma.reactionOpportunity.findUnique({ where: { id: npcOpportunity.id } });
    check(
      '96.F) a recusa do Mestre fica registrada com motivo próprio',
      (npcRow?.resolution as any)?.kind === 'master-declined',
      JSON.stringify(npcRow?.resolution),
    );

    // =====================================================================
    // 97) 0 PV NO ATAQUE DE OPORTUNIDADE
    // =====================================================================
    console.log('\n97) Ataque de Oportunidade que derruba o movente');
    let downed: HttpResult | null = null;
    for (let attempt = 0; attempt < 5 && downed === null; attempt += 1) {
      await scenario({ moverHp: 1, npcAt: [200, 105] });
      const pausedMove = await move(steps([190, 100], [185, 100]));
      if (pausedMove.status !== 200 || !pausedMove.data.pending) continue;
      const window = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
      const hit = await attackReaction(window.id, 'weapon:oa-sword');
      if (hit.status === 200 && hit.data.result?.hit) downed = hit;
    }
    check(
      '97.A) o ataque que derruba o movente a 0 PV interrompe o movimento (sem teletransporte)',
      downed !== null &&
        downed.data.reaction?.moverDefeated === true &&
        (await positionOf(moverCombatantId))?.xFeet === 195,
      JSON.stringify(downed?.data?.reaction ?? null),
    );
    const interruptedIntent = await prisma.movementIntent.findFirst({
      where: { combatId, combatantId: moverCombatantId },
      orderBy: { createdAt: 'desc' },
    });
    check(
      '97.B) o intent fica INTERROMPIDO e os passos posteriores não foram aplicados',
      interruptedIntent?.status === 'interrupted' &&
        interruptedIntent?.reason === 'mover-cannot-continue' &&
        (await positionOf(moverCombatantId))?.xFeet === 195,
      JSON.stringify({ status: interruptedIntent?.status, reason: interruptedIntent?.reason }),
    );
    check(
      '97.C) a janela restante do mesmo boundary é cancelada (nada de reação inútil)',
      (await prisma.reactionOpportunity.findFirst({ where: { combatId, reactorCombatantId: npcCombatantId } }))
        ?.status === 'cancelled' &&
        (await countOpportunities()) === 0,
    );
    const moveAfterDown = await move(steps([190, 100]));
    check(
      '97.D) movente a 0 PV não inicia movimento novo',
      moveAfterDown.status === 409 || moveAfterDown.status === 403,
      JSON.stringify(moveAfterDown.data),
    );

    // =====================================================================
    // 98) IDEMPOTÊNCIA E CONCORRÊNCIA
    // =====================================================================
    console.log('\n98) Idempotência e concorrência');
    await scenario();
    const fixedOperation = randomUUID();
    // O retry manda TAMBÉM a mesma versão esperada: idempotência é resolvida
    // antes da guarda de versão (senão o replay viraria um 409 de conflito).
    const fixedVersion = await versionNow();
    const retryPayload = {
      combatantId: moverCombatantId,
      path: steps([190, 100]),
      expectedVersion: fixedVersion,
      operationId: fixedOperation,
    };
    const firstPass = await request(`/combat/${combatId}/spatial/movement`, retryPayload, moverToken);
    const replayPass = await request(`/combat/${combatId}/spatial/movement`, retryPayload, moverToken);
    check(
      '98.A) retry do MESMO movimento devolve o snapshot e NÃO duplica a janela',
      firstPass.status === 200 &&
        replayPass.status === 200 &&
        replayPass.data.replayed === true &&
        (await countOpportunities()) === 1 &&
        (await prisma.movementIntent.count({ where: { combatId, combatantId: moverCombatantId } })) === 1,
      JSON.stringify({ first: firstPass.data.pending, replay: replayPass.data.replayed }),
    );
    const window98 = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
    const fixedReaction = randomUUID();
    const reactionVersion = await versionNow();
    const reactionFirst = await attackReaction(
      window98.id, 'weapon:oa-sword', reactorToken, fixedReaction, reactionVersion,
    );
    const hpAfterFirst = (await prisma.character.findUnique({ where: { id: mover.id }, select: { hpCurrent: true } }))!
      .hpCurrent;
    const reactionReplay = await attackReaction(
      window98.id, 'weapon:oa-sword', reactorToken, fixedReaction, reactionVersion,
    );
    const hpAfterReplay = (await prisma.character.findUnique({ where: { id: mover.id }, select: { hpCurrent: true } }))!
      .hpCurrent;
    check(
      '98.B) retry da MESMA Reação não rerrola: mesmo HP, UMA operação registrada e Reação gasta uma vez',
      reactionFirst.status === 200 &&
        reactionReplay.status === 200 &&
        hpAfterFirst === hpAfterReplay &&
        (await prisma.combatOperation.count({ where: { combatId, operationId: fixedReaction } })) === 1 &&
        (await economyOfCombatant(reactorCombatantId)).reactionAvailable === false,
      JSON.stringify({ hpAfterFirst, hpAfterReplay, replay: reactionReplay.data }),
    );
    const reusedKey = await (async () => {
      await scenario();
      const first = await move(steps([190, 100]));
      const window = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
      const used = randomUUID();
      await attackReaction(window.id, 'weapon:oa-sword', reactorToken, used);
      return { first, different: await attackReaction(window.id, 'weapon:oa-lance', reactorToken, used) };
    })();
    check(
      '98.C) mesma operationId com OUTRO ataque é 409 IDEMPOTENCY_KEY_REUSED',
      reusedKey.different.status === 409 &&
        reusedKey.different.data.error === 'IDEMPOTENCY_KEY_REUSED',
      JSON.stringify(reusedKey.different.data),
    );
    await scenario();
    await move(steps([190, 100]));
    const raceWindow = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
    const both = await Promise.all([
      declineReaction(raceWindow.id),
      declineReaction(raceWindow.id),
    ]);
    check(
      '98.D) duas respostas simultâneas para a MESMA janela: uma vence, a outra é 409',
      both.filter((item) => item.status === 200).length === 1 &&
        both.filter((item) => item.status === 409).length === 1,
      JSON.stringify(both.map((item) => item.status)),
    );

    // 6.6M.3.1.4.3.1 — CHECKPOINT antes da Reação: trajeto de 2 passos em que
    // o provocador é o SEGUNDO (o prefixo consumiu 5 pés) e a RETOMADA depois
    // da Reação. Lê o Registro PERSISTIDO, não o formatter isolado.
    const persistedMoveLogs = async (): Promise<string[]> => {
      const row = await prisma.combat.findUniqueOrThrow({
        where: { id: combatId },
        select: { economyLog: true },
      });
      const entries = (row.economyLog ?? []) as { action?: string; message: string }[];
      return entries
        .filter((entry) => entry.action === 'move')
        .map((entry) => entry.message);
    };
    const feetText = /p[ée]s?\b|\bfeet\b|\bft\b/i;
    await scenario();
    const interrupted = await move(steps([195, 105], [190, 105]));
    await readModel(reactorToken);
    const checkpointMessages = await persistedMoveLogs();
    check(
      '98.E) checkpoint antes da Reação grava METROS no Registro (pés só no domínio)',
      interrupted.status === 200 &&
        interrupted.data.pending !== null &&
        // Orçamento do cenário = 30 m; o prefixo consumiu 5 pés (1,5 m).
        checkpointMessages.at(-1) ===
          'Moveu 1,5 m (custo 1,5 m) — restam 28,5 m. Movimento interrompido: aguardando Reação.' &&
        checkpointMessages.every((message) => !feetText.test(message)),
      JSON.stringify({ status: interrupted.status, logs: checkpointMessages.slice(-2) }),
    );
    const resumeWindow = opportunityOf((await readModel(reactorToken)).data, reactorCombatantId);
    const declinedForResume = resumeWindow ? await declineReaction(resumeWindow.id) : null;
    const resumedMessages = await persistedMoveLogs();
    check(
      '98.F) a RETOMADA depois da Reação também grava metros (nenhum pés/ft no Registro)',
      declinedForResume?.status === 200 &&
        resumedMessages.length > checkpointMessages.length &&
        resumedMessages.every((message) => !feetText.test(message)) &&
        /restam \d+(,\d+)? m\./.test(resumedMessages.at(-1) ?? ''),
      JSON.stringify({ status: declinedForResume?.status, logs: resumedMessages.slice(-2) }),
    );

    // =====================================================================
    // 99) PERSISTÊNCIA, RECONNECT E ADJUDICAÇÃO DE VISÃO
    // =====================================================================
    console.log('\n99) Read model persistido, reconnect e visão do Mestre');
    await scenario();
    await move(steps([190, 100]));
    const firstRead = await readModel(reactorToken);
    const secondRead = await readModel(reactorToken);
    check(
      '99.A) a janela sobrevive a uma leitura nova (estado no BANCO, não em memória do React)',
      firstRead.data.opportunities.length === 1 &&
        secondRead.data.opportunities.length === 1 &&
        firstRead.data.opportunities[0].id === secondRead.data.opportunities[0].id &&
        (await prisma.reactionOpportunity.count({ where: { combatId, status: 'pending' } })) === 1,
      JSON.stringify(firstRead.data.opportunities.map((item: any) => item.id)),
    );
    const pendingIntentRow = await prisma.movementIntent.findFirst({
      where: { combatId, status: 'pending-reaction' },
    });
    check(
      '99.B) o movimento pausado é recuperável do banco (caminho restante persistido)',
      Array.isArray(pendingIntentRow?.remainingPath) &&
        (pendingIntentRow?.remainingPath as any[]).length === 1 &&
        (pendingIntentRow?.checkpoint as any)?.xFeet === 195,
      JSON.stringify(pendingIntentRow?.remainingPath),
    );
    const unknownFixture = await prisma.reactionOpportunity.create({
      data: {
        combatId,
        movementIntentId: pendingIntentRow!.id,
        moverCombatantId,
        reactorCombatantId: npcCombatantId || reactorCombatantId,
        reactorUserId: null,
        boundaryIndex: 0,
        reachFeet: 5,
        options: [],
        visibilityStatus: 'unknown',
        orderIndex: 99,
      },
    });
    const playerCannotAdjudicate = await request(
      `/combat/${combatId}/reaction-opportunities/${unknownFixture.id}/visibility`,
      { combatId, visible: true, expectedVersion: await versionNow(), operationId: randomUUID() },
      reactorToken,
    );
    const masterVisible = await request(
      `/combat/${combatId}/reaction-opportunities/${unknownFixture.id}/visibility`,
      { combatId, visible: true, expectedVersion: await versionNow(), operationId: randomUUID() },
      masterToken,
    );
    const confirmedRow = await prisma.reactionOpportunity.findUnique({ where: { id: unknownFixture.id } });
    check(
      '99.C) visão UNKNOWN exige o Mestre: jogador recebe 403 e a confirmação é auditada',
      playerCannotAdjudicate.status === 403 &&
        masterVisible.status === 200 &&
        confirmedRow?.visibilityStatus === 'known-visible' &&
        typeof confirmedRow?.visibilityConfirmedBy === 'string',
      JSON.stringify({ player: playerCannotAdjudicate.status, master: masterVisible.status }),
    );
    const knownNotVisible = await prisma.reactionOpportunity.create({
      data: {
        combatId,
        movementIntentId: pendingIntentRow!.id,
        moverCombatantId,
        reactorCombatantId,
        reactorUserId: reactorOwner.id,
        boundaryIndex: 0,
        reachFeet: 5,
        options: [],
        visibilityStatus: 'known-not-visible',
        orderIndex: 98,
      },
    });
    const overrideAttempt = await request(
      `/combat/${combatId}/reaction-opportunities/${knownNotVisible.id}/visibility`,
      { combatId, visible: true, expectedVersion: await versionNow(), operationId: randomUUID() },
      masterToken,
    );
    check(
      '99.D) fato autoritativo "não vê" NUNCA é sobrescrito por confirmação do Mestre',
      overrideAttempt.status === 409 &&
        overrideAttempt.data.error === 'OPPORTUNITY_VISIBILITY_FINAL',
      JSON.stringify(overrideAttempt.data),
    );
    const asUnknown = await prisma.reactionOpportunity.findUnique({ where: { id: unknownFixture.id } });
    check(
      '99.E) depois de confirmada, a janela deixa de aceitar nova adjudicação de visão',
      asUnknown?.visibilityStatus === 'known-visible' &&
        (await request(
          `/combat/${combatId}/reaction-opportunities/${unknownFixture.id}/visibility`,
          { combatId, visible: false, expectedVersion: await versionNow(), operationId: randomUUID() },
          masterToken,
        )).status === 409,
    );

    // =====================================================================
    // 100) LIMPEZA DO COMBATE
    // =====================================================================
    console.log('\n100) Fim do combate cancela o que estava pendente');
    await scenario();
    await move(steps([190, 100]));
    const beforeEnd = await countOpportunities();
    const ended = await request('/combat/end', {}, masterToken);
    const intentsAfterEnd = await prisma.movementIntent.findMany({ where: { combatId } });
    check(
      '100.A) encerrar o combate cancela janelas e intents (sem mesa travada)',
      beforeEnd === 1 &&
        ended.status === 200 &&
        ended.data.combatId === combatId &&
        (await countOpportunities()) === 0 &&
        intentsAfterEnd.every((item) => item.status === 'cancelled'),
      JSON.stringify({ status: ended.status, data: ended.data, intents: intentsAfterEnd.map((item) => item.status) }),
    );

    // =====================================================================
    // 101) AUSÊNCIAS FORA DE ESCOPO
    // =====================================================================
    console.log('\n101) Fora de escopo nesta fase');
    check(
      '101.A) nenhuma Reação automática: a janela fica pendente sem timeout nem resposta inventada',
      await (async () => {
        await scenario();
        await move(steps([190, 100]));
        await new Promise((resolve) => setTimeout(resolve, 600));
        const still = await readModel(reactorToken);
        return still.data.opportunities.length === 1 && still.data.opportunities[0].status === 'pending';
      })(),
    );
    check(
      '101.B) sem pathfinding/LoS/teleporte no fluxo: o passo é o caminho recebido ou o movimento para',
      (await prisma.movementIntent.count({ where: { combatId } })) >= 1 &&
        !/pathfind|dijkstra|lineOfSight|walls/i.test(JSON.stringify(await readModel(masterToken))),
    );
  } finally {
    if (createdCombats.length > 0) {
      await prisma.combat.deleteMany({ where: { id: { in: createdCombats } } });
    }
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
