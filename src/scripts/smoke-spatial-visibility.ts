import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import {
  isSpatiallyVisible,
  spatialVisibilityOf,
} from '../modules/combat/spatial/spatial-visibility.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

/**
 * FASE 6.6L.3.2 — PUBLIC SPATIAL VISIBILITY / NPC GRID PROJECTION.
 *
 * O bug corrigido: o DTO do jogador tratava TODO combatente que não fosse
 * personagem como privado (`spatial = null`, `imageUrl = null`), então nenhum
 * NPC/criatura aparecia no grid do jogador. A correção separa duas políticas:
 *
 *  • ESTADO MECÂNICO privado (`kind !== CHARACTER`) — PV, CA, morte, economia;
 *  • PRESENÇA ESPACIAL por INSTÂNCIA (`spatialVisibility`) — token, imagem,
 *    posição, tamanho e espaço ocupado.
 *
 * O que este smoke prova:
 *  • default `public` (inclusive em combatente legado, sem valor explícito);
 *  • NPC público aparece no grid com imagem/`?` e SEM stats;
 *  • `master-only` some do jogador (inclusive imagem) e nada de `?` fantasma;
 *  • distância/alcance seguem a visibilidade (public mede, master-only sanitiza);
 *  • ocupante oculto CONTINUA bloqueando o movimento (mecânica intacta);
 *  • reactor oculto não vaza identidade; reactor público não vira "oculto" só
 *    pelo tipo (autoridade continua do Mestre);
 *  • hide/reveal em tempo real pelo mesmo PATCH, com versão e idempotência;
 *  • só o Mestre altera; payload strict; template/ficha nunca são tocados.
 *
 * NÃO implementa: Fog of War, visão/cone, paredes, LoS, luz, darkvision, Hide
 * Action, Stealth, Invisible automático, iniciativa secreta e Drag & Drop.
 */
export async function smokeSpatialVisibility(baseUrl: string, check: Check): Promise<void> {
  console.log('\n102) Fase 6.6L.3.2 — Public Spatial Visibility / NPC Grid Projection');

  // =====================================================================
  // A–B — DOMÍNIO PURO DA VISIBILIDADE ESPACIAL
  // =====================================================================
  check(
    '102.A) leitura tolerante: ausente/inválido cai em PUBLIC — nunca oculto por omissão',
    spatialVisibilityOf(undefined) === 'public' &&
      spatialVisibilityOf(null) === 'public' &&
      spatialVisibilityOf('') === 'public' &&
      spatialVisibilityOf('hidden') === 'public' &&
      spatialVisibilityOf('public') === 'public',
  );
  check(
    '102.B) `master-only` é o ÚNICO valor que esconde a presença espacial',
    spatialVisibilityOf('master-only') === 'master-only' &&
      isSpatiallyVisible('public') === true &&
      isSpatiallyVisible('master-only') === false,
  );

  // =====================================================================
  // FIXTURES — contas, ficha, criaturas e combate criados no banco
  // =====================================================================
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const combatIds: string[] = [];
  const creatureIds: string[] = [];
  const characterIds: string[] = [];
  try {
    const master = await prisma.user.create({
      data: {
        username: `sv_m_${suffix}`,
        displayName: 'Mestre SV',
        passwordHash: 'fixture',
        role: 'MASTER',
      },
    });
    const owner = await prisma.user.create({
      data: {
        username: `sv_p_${suffix}`,
        displayName: 'Jogador SV',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    userIds.push(master.id, owner.id);
    const masterToken = signToken({
      sub: master.id,
      username: master.username,
      displayName: master.displayName,
      role: master.role,
    });
    const playerToken = signToken({
      sub: owner.id,
      username: owner.username,
      displayName: owner.displayName,
      role: owner.role,
    });

    const sword = {
      id: 'sv-sword',
      name: 'Espada Longa',
      category: 'Arma',
      slot: 'hand1',
      details: {
        weaponType: 'melee',
        weaponCategory: 'martial',
        damageCount: 1,
        damageDie: 8,
        damageType: 'Cortante',
        properties: ['versatile'],
        versatileDie: 10,
      },
    };
    const hero = await prisma.character.create({
      data: {
        userId: owner.id,
        name: 'Herói SV',
        classes: [{ classKey: 'fighter', level: 5, subclass: '' }],
        hpMax: 40,
        hpCurrent: 40,
        speed: 30,
        raceId: 'human',
        strength: 12,
        dexterity: 12,
        inventory: inventoryListSchema.parse([sword]),
      },
    });
    characterIds.push(hero.id);

    // NPC PÚBLICO com imagem real atribuída pelo Mestre.
    const publicNpc = await prisma.creature.create({
      data: {
        name: 'Goblin Visível',
        kind: 'CREATURE',
        hpMax: 12,
        hpCurrent: 12,
        armorClass: 13,
        speed: 9,
        size: 'Medium',
        imageUrl: '/uploads/creatures/sv-goblin.png',
      },
    });
    // NPC público SEM imagem: `?` no grid, nunca "oculto".
    const facelessNpc = await prisma.creature.create({
      data: {
        name: 'Sombra sem Retrato',
        kind: 'CREATURE',
        hpMax: 10,
        hpCurrent: 10,
        armorClass: 12,
        speed: 9,
        size: 'Medium',
      },
    });
    // NPC que começa `master-only`: Large, sem imagem e com arma corpo a corpo
    // (é o reactor da Opportunity Attack da seção 102.Q).
    const secretNpc = await prisma.creature.create({
      data: {
        name: 'Ogro Secreto',
        kind: 'NPC',
        hpMax: 40,
        hpCurrent: 40,
        armorClass: 14,
        speed: 9,
        size: 'Large',
        inventory: inventoryListSchema.parse([{ ...sword, id: 'sv-ogro-porrete' }]),
      },
    });
    // Combatente criado SEM `spatialVisibility` explícito (default do banco).
    const defaultNpc = await prisma.creature.create({
      data: {
        name: 'Morcego Legado',
        kind: 'CREATURE',
        hpMax: 8,
        hpCurrent: 8,
        armorClass: 11,
        speed: 9,
        size: 'Small',
      },
    });
    creatureIds.push(publicNpc.id, facelessNpc.id, secretNpc.id, defaultNpc.id);

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
              kind: 'CHARACTER',
              characterId: hero.id,
              ownerUserId: owner.id,
              name: hero.name,
              initiative: 30,
              dexterityMod: 1,
              sideKey: 'heroes',
              spatialPosition: { xFeet: 195, yFeet: 100 },
              turnEconomy: onTurnStart(30),
            },
            {
              kind: 'CREATURE',
              creatureId: publicNpc.id,
              name: publicNpc.name,
              hpCurrent: 12,
              hpMax: 12,
              armorClass: 13,
              initiative: 20,
              dexterityMod: 1,
              sideKey: 'monsters',
              spatialPosition: { xFeet: 100, yFeet: 100 },
              turnEconomy: onTurnStart(30),
            },
            {
              kind: 'CREATURE',
              creatureId: facelessNpc.id,
              name: facelessNpc.name,
              hpCurrent: 10,
              hpMax: 10,
              armorClass: 12,
              initiative: 15,
              dexterityMod: 1,
              sideKey: 'monsters',
              spatialPosition: { xFeet: 120, yFeet: 120 },
              turnEconomy: onTurnStart(30),
            },
            {
              kind: 'NPC',
              creatureId: secretNpc.id,
              name: secretNpc.name,
              hpCurrent: 40,
              hpMax: 40,
              armorClass: 14,
              initiative: 10,
              dexterityMod: 1,
              sideKey: 'monsters',
              spatialVisibility: 'master-only',
              spatialPosition: { xFeet: 200, yFeet: 100 },
              turnEconomy: onTurnStart(30),
            },
            {
              kind: 'CREATURE',
              creatureId: defaultNpc.id,
              name: defaultNpc.name,
              hpCurrent: 8,
              hpMax: 8,
              armorClass: 11,
              initiative: 5,
              dexterityMod: 0,
              sideKey: 'monsters',
              spatialPosition: { xFeet: 150, yFeet: 60 },
              turnEconomy: onTurnStart(30),
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);
    const combatantIdOf = (characterId: string | null, creatureId: string | null): string =>
      combat.combatants.find((item) =>
        characterId ? item.characterId === characterId : item.creatureId === creatureId,
      )!.id;
    const heroCombatantId = combatantIdOf(hero.id, null);
    const publicCombatantId = combatantIdOf(null, publicNpc.id);
    const facelessCombatantId = combatantIdOf(null, facelessNpc.id);
    const secretCombatantId = combatantIdOf(null, secretNpc.id);
    const defaultCombatantId = combatantIdOf(null, defaultNpc.id);

    const versionNow = async (): Promise<number> =>
      (await prisma.combat.findUnique({ where: { id: combat.id }, select: { version: true } }))!
        .version;

    async function request(
      path: string,
      method: 'GET' | 'POST' | 'PATCH',
      payload: unknown,
      token: string,
    ): Promise<HttpResult> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> };
    }

    const dtoOf = async (token: string): Promise<Record<string, any> | null> =>
      (await request('/combat/active', 'GET', undefined, token)).data.combat ?? null;
    const combatantOf = (dto: Record<string, any> | null, id: string) =>
      (dto?.combatants ?? []).find((item: any) => item.id === id) ?? null;
    const distance = async (fromId: string, toId: string, token = playerToken) =>
      request(
        `/combat/${combat.id}/spatial/distance?fromCombatantId=${fromId}&toCombatantId=${toId}`,
        'GET',
        undefined,
        token,
      );
    const rangePreview = async (attackId: string, fromId: string, toId: string) =>
      request(
        `/combat/${combat.id}/spatial/range-preview?fromCombatantId=${fromId}&toCombatantId=${toId}&attackId=${encodeURIComponent(attackId)}`,
        'GET',
        undefined,
        playerToken,
      );
    const setVisibility = async (
      combatantId: string,
      spatialVisibility: 'public' | 'master-only',
      options: { expectedVersion?: number; operationId?: string; extra?: Record<string, unknown> } = {},
    ) =>
      request(
        `/combat/${combat.id}/combatants/${combatantId}/spatial-visibility`,
        'PATCH',
        {
          spatialVisibility,
          expectedVersion: options.expectedVersion ?? (await versionNow()),
          operationId: options.operationId ?? randomUUID(),
          ...(options.extra ?? {}),
        },
        masterToken,
      );

    // =====================================================================
    // 102.C–102.H — DTO: DEFAULT, PROJEÇÃO PÚBLICA E PRIVACIDADE MECÂNICA
    // =====================================================================
    const storedDefault = await prisma.combatant.findUnique({
      where: { id: defaultCombatantId },
      select: { spatialVisibility: true },
    });
    check(
      '102.C) combatente criado sem valor explícito é `public` no banco (legado não precisa de edição)',
      storedDefault?.spatialVisibility === 'public',
      JSON.stringify(storedDefault),
    );

    const playerDto = await dtoOf(playerToken);
    const publicSeen = combatantOf(playerDto, publicCombatantId);
    check(
      '102.D) jogador recebe o NPC PÚBLICO com spatial completo (posição, tamanho, footprint e token)',
      publicSeen?.spatial?.position?.xFeet === 100 &&
        publicSeen?.spatial?.position?.yFeet === 100 &&
        publicSeen?.spatial?.baseSize === 'medium' &&
        publicSeen?.spatial?.effectiveSize === 'medium' &&
        publicSeen?.spatial?.occupiedSpace?.widthFeet === 5 &&
        publicSeen?.spatial?.occupiedSpace?.heightFeet === 5 &&
        publicSeen?.spatialVisibility === 'public',
      JSON.stringify(publicSeen?.spatial),
    );
    check(
      '102.E) stats do NPC público continuam PRIVADOS (PV/PV máx/CA/deathState ocultos)',
      publicSeen?.hpCurrent === null &&
        publicSeen?.hpMax === null &&
        publicSeen?.armorClass === null &&
        publicSeen?.deathState === null &&
        publicSeen?.statsHidden === true &&
        publicSeen?.sideKey === null &&
        publicSeen?.spatial !== null,
      JSON.stringify({
        hpCurrent: publicSeen?.hpCurrent,
        armorClass: publicSeen?.armorClass,
        statsHidden: publicSeen?.statsHidden,
      }),
    );
    const facelessSeen = combatantOf(playerDto, facelessCombatantId);
    check(
      '102.F) NPC público SEM imagem: `spatial` existe e `tokenImageRef` é null (o `?` não significa oculto)',
      facelessSeen?.spatial !== null &&
        facelessSeen?.spatial?.tokenImageRef === null &&
        facelessSeen?.imageUrl === null &&
        facelessSeen?.spatialVisibility === 'public',
      JSON.stringify({ spatial: facelessSeen?.spatial, imageUrl: facelessSeen?.imageUrl }),
    );
    check(
      '102.G) NPC público COM imagem: o jogador recebe a imagem real do token',
      publicSeen?.spatial?.tokenImageRef === '/uploads/creatures/sv-goblin.png' &&
        publicSeen?.imageUrl === '/uploads/creatures/sv-goblin.png',
      JSON.stringify({ token: publicSeen?.spatial?.tokenImageRef, image: publicSeen?.imageUrl }),
    );
    const secretSeen = combatantOf(playerDto, secretCombatantId);
    const masterDto = await dtoOf(masterToken);
    const secretMaster = combatantOf(masterDto, secretCombatantId);
    check(
      '102.H) MASTER vê o spatial completo (público e master-only) e o jogador não vê o master-only',
      secretMaster?.spatial?.position?.xFeet === 200 &&
        secretMaster?.spatial?.effectiveSize === 'large' &&
        secretMaster?.spatialVisibility === 'master-only' &&
        secretSeen?.spatial === null &&
        secretSeen?.imageUrl === null &&
        secretSeen?.spatialVisibility === 'master-only',
      JSON.stringify({ master: secretMaster?.spatial, player: secretSeen?.spatial }),
    );

    // =====================================================================
    // 102.I–102.K — DISTÂNCIA/ALCANCE SEGUEM A VISIBILIDADE; PLAYER É 403
    // =====================================================================
    const publicDistance = await distance(heroCombatantId, publicCombatantId);
    check(
      '102.I) jogador mede distância até NPC PÚBLICO (known), não até o master-only',
      publicDistance.status === 200 &&
        publicDistance.data.distance.status === 'known' &&
        publicDistance.data.distance.distanceFeet === 95,
      JSON.stringify(publicDistance.data),
    );
    const publicRange = await rangePreview('weapon:sv-sword', heroCombatantId, publicCombatantId);
    const hiddenRange = await rangePreview('weapon:sv-sword', heroCombatantId, secretCombatantId);
    check(
      '102.J) range-preview do NPC público devolve faixa/alcance do SERVIDOR; master-only não vaza nada',
      publicRange.status === 200 &&
        publicRange.data.range.status === 'out-of-range' &&
        publicRange.data.range.distanceFeet === 95 &&
        publicRange.data.range.actionName === 'Espada Longa' &&
        hiddenRange.status === 200 &&
        hiddenRange.data.range.status === 'unknown' &&
        hiddenRange.data.range.distanceFeet === null &&
        hiddenRange.data.range.actionName === null &&
        hiddenRange.data.range.reason === 'not-visible',
      JSON.stringify({ public: publicRange.data.range, hidden: hiddenRange.data.range }),
    );
    const playerPatch = await request(
      `/combat/${combat.id}/combatants/${secretCombatantId}/spatial-visibility`,
      'PATCH',
      { spatialVisibility: 'public', expectedVersion: await versionNow(), operationId: randomUUID() },
      playerToken,
    );
    const secretAfterPlayer = await prisma.combatant.findUnique({
      where: { id: secretCombatantId },
      select: { spatialVisibility: true },
    });
    check(
      '102.K) PLAYER não altera visibilidade (403, nada muda) — controle é MASTER-only',
      playerPatch.status === 403 && secretAfterPlayer?.spatialVisibility === 'master-only',
      JSON.stringify({ status: playerPatch.status, stored: secretAfterPlayer }),
    );

    // =====================================================================
    // 102.L–102.O — HIDE: DTO, DISTÂNCIA E ALCANCE SANITIZADOS
    // =====================================================================
    const versionBeforeHide = await versionNow();
    const hideResponse = await setVisibility(publicCombatantId, 'master-only');
    const versionAfterHide = await versionNow();
    const playerAfterHide = await dtoOf(playerToken);
    const publicHidden = combatantOf(playerAfterHide, publicCombatantId);
    check(
      '102.L) MASTER oculta: versão incrementa e o jogador perde spatial E imagem no mesmo DTO',
      hideResponse.status === 200 &&
        versionAfterHide === versionBeforeHide + 1 &&
        publicHidden?.spatial === null &&
        publicHidden?.imageUrl === null &&
        publicHidden?.spatialVisibility === 'master-only',
      JSON.stringify({ status: hideResponse.status, spatial: publicHidden?.spatial }),
    );
    const masterAfterHide = await dtoOf(masterToken);
    const publicHiddenMaster = combatantOf(masterAfterHide, publicCombatantId);
    check(
      '102.M) MASTER continua vendo o token oculto (posição e tamanho intactos)',
      publicHiddenMaster?.spatial?.position?.xFeet === 100 &&
        publicHiddenMaster?.spatial?.effectiveSize === 'medium',
      JSON.stringify(publicHiddenMaster?.spatial),
    );
    const hiddenDistance = await distance(heroCombatantId, publicCombatantId);
    check(
      '102.N) distância até master-only é sanitizada (unknown/not-visible, sem número)',
      hiddenDistance.status === 200 &&
        hiddenDistance.data.distance.status === 'unknown' &&
        hiddenDistance.data.distance.distanceFeet === null &&
        hiddenDistance.data.distance.reason === 'not-visible',
      JSON.stringify(hiddenDistance.data),
    );
    const hiddenRangeNow = await rangePreview('weapon:sv-sword', heroCombatantId, publicCombatantId);
    check(
      '102.O) range-preview de master-only não revela distância, faixa nem nome da ação',
      hiddenRangeNow.status === 200 &&
        hiddenRangeNow.data.range.distanceFeet === null &&
        hiddenRangeNow.data.range.band === null &&
        hiddenRangeNow.data.range.actionName === null,
      JSON.stringify(hiddenRangeNow.data.range),
    );

    // =====================================================================
    // 102.P — OCUPANTE OCULTO CONTINUA BLOQUEANDO MECANICAMENTE
    // =====================================================================
    const occupiedPreview = await request(
      `/combat/${combat.id}/spatial/movement-preview`,
      'POST',
      { combatantId: heroCombatantId, path: [{ xFeet: 200, yFeet: 100 }] },
      playerToken,
    );
    const occupiedJson = JSON.stringify(occupiedPreview.data);
    check(
      '102.P) ocupante master-only continua bloqueando o movimento, com diagnóstico SEM identidade',
      occupiedPreview.status === 200 &&
        occupiedPreview.data.movement.legal === false &&
        occupiedPreview.data.movement.blocker?.code === 'MOVEMENT_DESTINATION_OCCUPIED' &&
        !occupiedJson.includes('Ogro Secreto') &&
        !occupiedJson.includes(secretCombatantId) &&
        !occupiedJson.includes('Ogro'),
      occupiedJson.slice(0, 400),
    );

    // =====================================================================
    // 102.Q — REACTOR OCULTO: JANELA EXISTE, JOGADOR SÓ VÊ "AGUARDA MESTRE"
    // =====================================================================
    const commit = await request(
      `/combat/${combat.id}/spatial/movement`,
      'POST',
      {
        combatantId: heroCombatantId,
        path: [{ xFeet: 190, yFeet: 100 }],
        expectedVersion: await versionNow(),
        operationId: randomUUID(),
      },
      playerToken,
    );
    const hiddenReadModel = await request(
      `/combat/${combat.id}/reaction-opportunities`,
      'GET',
      undefined,
      playerToken,
    );
    const hiddenReadJson = JSON.stringify(hiddenReadModel.data);
    const masterReadModel = await request(
      `/combat/${combat.id}/reaction-opportunities`,
      'GET',
      undefined,
      masterToken,
    );
    check(
      '102.Q) reactor master-only abre janela (Master vê) e o jogador recebe só awaitingMaster, sem nome/arma/alcance/id',
      commit.status === 200 &&
        commit.data.pending?.opportunities === 1 &&
        masterReadModel.data.opportunities.length === 1 &&
        masterReadModel.data.opportunities[0].reactorCombatantId === secretCombatantId &&
        hiddenReadModel.status === 200 &&
        hiddenReadModel.data.opportunities.length === 0 &&
        hiddenReadModel.data.movement?.awaitingMaster === true &&
        !hiddenReadJson.includes('Ogro Secreto') &&
        !hiddenReadJson.includes(secretCombatantId),
      hiddenReadJson.slice(0, 400),
    );

    // =====================================================================
    // 102.R–102.S — REVEAL MID-COMBAT: NPC PÚBLICO NÃO É "OCULTO" POR TIPO
    // =====================================================================
    const revealResponse = await setVisibility(secretCombatantId, 'public');
    const playerAfterReveal = await dtoOf(playerToken);
    const secretRevealed = combatantOf(playerAfterReveal, secretCombatantId);
    const readAfterReveal = await request(
      `/combat/${combat.id}/reaction-opportunities`,
      'GET',
      undefined,
      playerToken,
    );
    check(
      '102.R) reactor REVELADO é presença conhecida (Large 10×10) — o jogador não ganha a Reação, que continua do Mestre',
      revealResponse.status === 200 &&
        secretRevealed?.spatial?.position?.xFeet === 200 &&
        secretRevealed?.spatial?.effectiveSize === 'large' &&
        secretRevealed?.spatial?.occupiedSpace?.widthFeet === 10 &&
        secretRevealed?.spatial?.occupiedSpace?.heightFeet === 10 &&
        secretRevealed?.spatialVisibility === 'public' &&
        readAfterReveal.data.opportunities.length === 0 &&
        readAfterReveal.data.movement?.awaitingMaster === true,
      JSON.stringify({
        spatial: secretRevealed?.spatial,
        opportunities: readAfterReveal.data.opportunities?.length,
        awaiting: readAfterReveal.data.movement?.awaitingMaster,
      }),
    );
    check(
      '102.S) NPC público SEM retrato mostra `?` (tokenImageRef null) — ausência de imagem nunca é ausência de presença',
      secretRevealed?.spatial?.tokenImageRef === null && secretRevealed?.spatial !== null,
      JSON.stringify(secretRevealed?.spatial),
    );

    // =====================================================================
    // 102.T–102.U — IDEMPOTÊNCIA, CHAVE REUTILIZADA E VERSÃO
    // =====================================================================
    const idempotentKey = randomUUID();
    const idempotentVersion = await versionNow();
    const firstToggle = await setVisibility(facelessCombatantId, 'master-only', {
      expectedVersion: idempotentVersion,
      operationId: idempotentKey,
    });
    const versionAfterFirstToggle = await versionNow();
    const replay = await setVisibility(facelessCombatantId, 'master-only', {
      expectedVersion: idempotentVersion,
      operationId: idempotentKey,
    });
    const versionAfterReplay = await versionNow();
    const reusedKey = await setVisibility(facelessCombatantId, 'public', {
      operationId: idempotentKey,
    });
    check(
      '102.T) replay do mesmo operationId devolve o estado salvo sem nova escrita; valor diferente é 409',
      firstToggle.status === 200 &&
        replay.status === 200 &&
        versionAfterFirstToggle === versionAfterReplay &&
        reusedKey.status === 409 &&
        reusedKey.data.error === 'IDEMPOTENCY_KEY_REUSED',
      JSON.stringify({ replay: replay.status, reused: reusedKey.status, versionAfterReplay }),
    );
    const stale = await setVisibility(facelessCombatantId, 'public', {
      expectedVersion: (await versionNow()) - 1,
    });
    const facelessAfterStale = await prisma.combatant.findUnique({
      where: { id: facelessCombatantId },
      select: { spatialVisibility: true },
    });
    check(
      '102.U) expectedVersion desatualizada é 409 e não altera nada',
      stale.status === 409 && facelessAfterStale?.spatialVisibility === 'master-only',
      JSON.stringify({ status: stale.status, stored: facelessAfterStale }),
    );

    // =====================================================================
    // 102.V — RETOMADA DO MOVIMENTO DEPOIS DA RECUSA DA JANELA
    // =====================================================================
    const pendingRow = await prisma.reactionOpportunity.findFirst({
      where: { combatId: combat.id, status: 'pending' },
      select: { id: true },
    });
    const decline = pendingRow
      ? await request(
          `/combat/${combat.id}/reaction-opportunities/${pendingRow.id}/decline`,
          'POST',
          { combatId: combat.id, expectedVersion: await versionNow(), operationId: randomUUID() },
          masterToken,
        )
      : null;
    const heroPosition = await prisma.combatant.findUnique({
      where: { id: heroCombatantId },
      select: { spatialPosition: true },
    });
    check(
      '102.V) recusa do Mestre fecha a janela e o movimento PAUSADO continua (posição avança para o passo provocador)',
      Boolean(pendingRow) &&
        decline?.status === 200 &&
        (heroPosition?.spatialPosition as any)?.xFeet === 190 &&
        (await prisma.reactionOpportunity.count({
          where: { combatId: combat.id, status: 'pending' },
        })) === 0,
      JSON.stringify({ decline: decline?.status, position: heroPosition?.spatialPosition }),
    );

    // =====================================================================
    // 102.W — PAYLOAD STRICT, SEM EFEITO NO TEMPLATE/FICHA, SEM LoS/FOW
    // =====================================================================
    const strict = await setVisibility(publicCombatantId, 'public', {
      extra: { position: { xFeet: 5, yFeet: 5 } },
    });
    const templateAfter = await prisma.creature.findUnique({
      where: { id: secretNpc.id },
      select: { imageUrl: true, size: true },
    });
    const heroAfter = await prisma.character.findUnique({
      where: { id: hero.id },
      select: { hpCurrent: true },
    });
    check(
      '102.W) payload strict (campo extra é 400) e nada é escrito no template/ficha — visibilidade é só da instância',
      strict.status === 400 &&
        templateAfter?.size === 'Large' &&
        templateAfter?.imageUrl === '' &&
        heroAfter?.hpCurrent === 40,
      JSON.stringify({ strict: strict.status, template: templateAfter, hero: heroAfter }),
    );
  } finally {
    if (combatIds.length > 0) {
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
    }
    if (characterIds.length > 0) {
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    }
    if (creatureIds.length > 0) {
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
}
