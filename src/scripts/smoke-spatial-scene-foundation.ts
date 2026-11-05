import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import {
  SIZE_FOOTPRINT_FEET,
  baseSizeOfRaceSize,
  effectiveSizeOf,
} from '../modules/combat/spatial/spatial-size.js';
import {
  occupiedSpaceOf,
  occupiedSpacesOverlap,
  spaceWithinScene,
} from '../modules/combat/spatial/occupied-space.js';
import {
  GRID_CELL_SIZE_FEET,
  defaultSpatialScene,
  spatialSceneOf,
} from '../modules/combat/spatial/spatial.types.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FASE 6.6L.1 — SCENE COORDINATES + OCCUPIED SPACES (PHB 2014).
 *
 * Prova a PRIMEIRA verdade espacial persistente do projeto:
 *  • cena assistida por padrão (combates existentes não mudam);
 *  • só o MASTER configura a cena e posiciona combatentes;
 *  • posição 2D em PÉS, âncora top-left, `null` = unplaced (nunca 0,0);
 *  • tamanho vem da RAÇA (personagem) ou do cadastro (NPC/criatura), nunca do
 *    placement; Small ≠ Medium; Tiny 2,5 pés; Large 10 pés;
 *  • espaço ocupado é DERIVADO e precisa caber na cena;
 *  • idempotência/versão/concorrência e realtime só DEPOIS do commit;
 *  • privacidade: jogador não recebe posição/tamanho/imagem de criatura;
 *  • NADA de distância, alcance, movimento, colisão, Cover ou área geométrica.
 */
export async function smokeSpatialScene(baseUrl: string, check: Check): Promise<void> {
  console.log('\n88) Fase 6.6L.1 — Scene Coordinates + Occupied Spaces');

  // ===================================================================
  // A–E — REGRAS PURAS (tamanho, espaço, bounds, sobreposição, unplaced)
  // ===================================================================
  check(
    '88.A) footprints do PHB: Tiny 2,5 · Small/Medium 5 · Large 10 · Huge 15 · Gargantuan 20',
    SIZE_FOOTPRINT_FEET.tiny.widthFeet === 2.5 &&
      SIZE_FOOTPRINT_FEET.small.widthFeet === 5 &&
      SIZE_FOOTPRINT_FEET.medium.widthFeet === 5 &&
      SIZE_FOOTPRINT_FEET.large.widthFeet === 10 &&
      SIZE_FOOTPRINT_FEET.huge.widthFeet === 15 &&
      SIZE_FOOTPRINT_FEET.gargantuan.widthFeet === 20 &&
      SIZE_FOOTPRINT_FEET.tiny.heightFeet === 2.5 &&
      SIZE_FOOTPRINT_FEET.gargantuan.heightFeet === 20,
  );
  check(
    '88.B) tamanho EFETIVO é contrato próprio e hoje é igual ao BASE (all six)',
    (['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const).every(
      (size) => effectiveSizeOf(size) === size,
    ) &&
      baseSizeOfRaceSize('Small') === 'small' &&
      baseSizeOfRaceSize('Medium') === 'medium' &&
      // Raça ausente/legada cai em Medium EXPLÍCITO — nunca pelo nome.
      baseSizeOfRaceSize(null) === 'medium' &&
      baseSizeOfRaceSize('Halfling') === 'medium',
  );
  const mediumSpace = occupiedSpaceOf({ xFeet: 10, yFeet: 15 }, 'medium')!;
  const largeSpace = occupiedSpaceOf({ xFeet: 10, yFeet: 15 }, 'large')!;
  check(
    '88.C) occupiedSpace derivado: Medium 10..15/15..20 e Large 10..20/15..25',
    mediumSpace.minXFeet === 10 &&
      mediumSpace.maxXFeet === 15 &&
      mediumSpace.minYFeet === 15 &&
      mediumSpace.maxYFeet === 20 &&
      mediumSpace.widthFeet === 5 &&
      largeSpace.maxXFeet === 20 &&
      largeSpace.maxYFeet === 25 &&
      largeSpace.widthFeet === 10,
  );
  const scene100 = defaultSpatialScene();
  check(
    '88.D) bounds: Medium em 95/95 cabe em 100×100; Large em 95 NÃO cabe; null = unplaced (nunca 0,0)',
    spaceWithinScene(occupiedSpaceOf({ xFeet: 95, yFeet: 95 }, 'medium')!, scene100) &&
      !spaceWithinScene(occupiedSpaceOf({ xFeet: 95, yFeet: 95 }, 'large')!, scene100) &&
      occupiedSpaceOf(null, 'medium') === null &&
      spatialSceneOf(null).mode === 'assisted' &&
      spatialSceneOf({ mode: 'nonsense' }).mode === 'assisted',
  );
  const base = occupiedSpaceOf({ xFeet: 0, yFeet: 0 }, 'medium')!;
  check(
    '88.E) overlap: separado/tocando = false; parcial/total = true (tocar borda não sobrepõe)',
    !occupiedSpacesOverlap(base, occupiedSpaceOf({ xFeet: 5, yFeet: 0 }, 'medium')!) &&
      !occupiedSpacesOverlap(base, occupiedSpaceOf({ xFeet: 10, yFeet: 10 }, 'medium')!) &&
      occupiedSpacesOverlap(base, occupiedSpaceOf({ xFeet: 2, yFeet: 2 }, 'medium')!) &&
      occupiedSpacesOverlap(base, occupiedSpaceOf({ xFeet: 0, yFeet: 0 }, 'small')!),
  );

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  let customRaceId: string | null = null;
  let combatId: string | null = null;
  const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'] });

  try {
    // ===================================================================
    // FIXTURES (contas próprias; nenhum dado real é tocado)
    // ===================================================================
    const master = await prisma.user.create({
      data: {
        username: `sp_m_${suffix}`,
        displayName: 'Mestre Espacial',
        passwordHash: 'fixture',
        role: 'MASTER',
      },
    });
    const player = await prisma.user.create({
      data: {
        username: `sp_p_${suffix}`,
        displayName: 'Halfling Espacial',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    const humanUser = await prisma.user.create({
      data: {
        username: `sp_h_${suffix}`,
        displayName: 'Humano Espacial',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    const customUser = await prisma.user.create({
      data: {
        username: `sp_c_${suffix}`,
        displayName: 'Homebrew Espacial',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    userIds.push(master.id, player.id, humanUser.id, customUser.id);

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
      data: { name: `Pequenino ${suffix}`, size: 'Small', speed: 7.5 },
    });
    customRaceId = customRace.id;

    const halfling = await prisma.character.create({
      data: {
        userId: player.id,
        name: 'Halfling Espacial',
        hpCurrent: 30,
        hpMax: 30,
        speed: 7.5,
        raceId: 'halfling',
        avatarUrl: '/uploads/characters/avatar-spatial.png',
      },
    });
    const human = await prisma.character.create({
      data: {
        userId: humanUser.id,
        name: 'Humano Espacial',
        hpCurrent: 30,
        hpMax: 30,
        speed: 9,
        raceId: 'human',
      },
    });
    const homebrew = await prisma.character.create({
      data: {
        userId: customUser.id,
        name: 'Homebrew Espacial',
        hpCurrent: 30,
        hpMax: 30,
        speed: 7.5,
        customRaceId: customRace.id,
      },
    });
    characterIds.push(halfling.id, human.id, homebrew.id);

    const bite = {
      id: 'bite',
      name: 'Mordida',
      damage: { count: 1, sides: 4, bonus: 0, type: 'Perfurante' },
      attackBonus: 30,
      notes: '',
      finesse: false,
      ranged: false,
    };
    const ogre = await prisma.creature.create({
      data: {
        name: 'Ogro Espacial',
        kind: 'CREATURE',
        type: 'Gigante',
        size: 'Large',
        hpCurrent: 60,
        hpMax: 60,
        speed: 12,
        attacks: [bite],
        // Sem imagem: o futuro Grid usa o fallback `?`.
        imageUrl: '',
      },
    });
    const npc = await prisma.creature.create({
      data: {
        name: 'NPC Espacial',
        kind: 'NPC',
        type: 'Humanoide',
        size: 'Medium',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        imageUrl: '/uploads/creatures/npc-spatial.png',
      },
    });
    creatureIds.push(ogre.id, npc.id);

    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        round: 1,
        currentIndex: 0,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CREATURE',
              creatureId: ogre.id,
              name: ogre.name,
              // 6.6L.3.2: a criatura DESTE cenário é oculta de propósito — a
              // projeção espacial agora é por instância, não por tipo.
              spatialVisibility: 'master-only',
              hpCurrent: 60,
              hpMax: 60,
              armorClass: 11,
              initiative: 100,
              dexterityMod: 1,
              turnEconomy: onTurnStart(12) as never,
            },
            {
              kind: 'CHARACTER',
              characterId: halfling.id,
              ownerUserId: player.id,
              name: halfling.name,
              initiative: 20,
              dexterityMod: 3,
            },
            {
              kind: 'CHARACTER',
              characterId: human.id,
              ownerUserId: humanUser.id,
              name: human.name,
              initiative: 15,
              dexterityMod: 1,
            },
            {
              kind: 'CHARACTER',
              characterId: homebrew.id,
              ownerUserId: customUser.id,
              name: homebrew.name,
              initiative: 10,
              dexterityMod: 2,
            },
            {
              kind: 'NPC',
              creatureId: npc.id,
              name: npc.name,
              hpCurrent: 20,
              hpMax: 20,
              armorClass: 12,
              initiative: 5,
              dexterityMod: 0,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatId = combat.id;
    const combatantOf = (kind: 'character' | 'creature', id: string) =>
      combat.combatants.find((item) =>
        kind === 'character' ? item.characterId === id : item.creatureId === id,
      )!;
    const ogreCombatant = combatantOf('creature', ogre.id);
    const halflingCombatant = combatantOf('character', halfling.id);
    const npcCombatant = combatantOf('creature', npc.id);

    async function request(
      method: 'GET' | 'PATCH' | 'POST',
      path: string,
      body?: unknown,
      auth: string = masterToken,
    ): Promise<HttpResult> {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, any>;
      return { status: response.status, data };
    }

    let state = (await request('GET', '/combat/active')).data.combat as Record<string, any>;
    const operation = () => ({ expectedVersion: state.version, operationId: randomUUID() });

    async function configure(
      body: Record<string, unknown>,
      auth: string = masterToken,
      extra: Record<string, unknown> = {},
    ): Promise<HttpResult> {
      const response = await request(
        'PATCH',
        `/combat/${combatId}/spatial-config`,
        { mode: 'grid-2d', widthFeet: 120, heightFeet: 80, ...operation(), ...body, ...extra },
        auth,
      );
      if (response.data.combat) state = response.data.combat;
      return response;
    }

    async function place(
      combatantId: string,
      position: Record<string, number> | null,
      auth: string = masterToken,
      extra: Record<string, unknown> = {},
    ): Promise<HttpResult> {
      const response = await request(
        'PATCH',
        `/combat/${combatId}/combatants/${combatantId}/spatial-position`,
        { position, ...operation(), ...extra },
        auth,
      );
      if (response.data.combat) state = response.data.combat;
      return response;
    }

    const spatialOf = (combatDto: Record<string, any>, id: string) =>
      (combatDto.combatants as any[]).find((item) => item.id === id)?.spatial;

    // ===================================================================
    // A–G — CENA: assisted por padrão, MASTER-only, grid-2d, bounds/resize
    // ===================================================================
    check(
      '88.A.1) combate começa ASSISTED com cena padrão e célula de 5 pés',
      state.spatial.mode === 'assisted' &&
        state.spatial.widthFeet === 100 &&
        state.spatial.heightFeet === 100 &&
        state.spatial.cellSizeFeet === GRID_CELL_SIZE_FEET,
    );
    check(
      '88.B.1) PLAYER não configura a cena (403)',
      (await configure({ widthFeet: 60, heightFeet: 60 }, playerToken)).status === 403,
    );
    const configured = await configure({ widthFeet: 120, heightFeet: 80 });
    check(
      '88.C.1) MASTER ativa grid-2d com dimensões em PÉS (persistidas)',
      configured.status === 200 &&
        configured.data.combat.spatial.mode === 'grid-2d' &&
        configured.data.combat.spatial.widthFeet === 120 &&
        configured.data.combat.spatial.heightFeet === 80,
    );
    const reloaded = (await request('GET', '/combat/active')).data.combat as Record<string, any>;
    state = reloaded;
    check(
      '88.D.1) largura/altura e cellSize persistem após reload (5 pés fixo)',
      reloaded.spatial.widthFeet === 120 &&
        reloaded.spatial.heightFeet === 80 &&
        reloaded.spatial.cellSizeFeet === 5,
    );
    check(
      '88.F.1) dimensões inválidas são rejeitadas (0, negativa, texto e campo extra)',
      (await configure({ widthFeet: 0 })).status === 400 &&
        (await configure({ widthFeet: -10 })).status === 400 &&
        (await configure({ widthFeet: '120' })).status === 400 &&
        (await configure({ cellSizeFeet: 10 })).status === 400,
    );
    // Ogro Large em x=25 termina em 35: reduzir a cena para 30 NÃO pode movê-lo.
    const placeOgre = await place(ogreCombatant.id, { xFeet: 25, yFeet: 10 });
    const resizeConflict = await configure({ widthFeet: 30 });
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '88.G.1) resize que jogaria alguém fora é REJEITADO e não move ninguém',
      placeOgre.status === 200 &&
        resizeConflict.status === 409 &&
        resizeConflict.data.error === 'SPATIAL_SCENE_RESIZE_CONFLICT' &&
        state.spatial.widthFeet === 120 &&
        spatialOf(state, ogreCombatant.id).position.xFeet === 25,
    );

    // ===================================================================
    // H–Q — PLACEMENT: MASTER, derivado, unplace, isolamento
    // ===================================================================
    check(
      '88.H.1) PLAYER não posiciona combatente (403, sem setPosition livre)',
      (await place(halflingCombatant.id, { xFeet: 0, yFeet: 0 }, playerToken)).status === 403,
    );
    const placedHalfling = await place(halflingCombatant.id, { xFeet: 10, yFeet: 15 });
    const halflingSpatial = spatialOf(placedHalfling.data.combat, halflingCombatant.id);
    check(
      '88.I.1) MASTER posiciona Character; espaço ocupado é DERIVADO (Small 5×5)',
      placedHalfling.status === 200 &&
        halflingSpatial.position.xFeet === 10 &&
        halflingSpatial.position.yFeet === 15 &&
        halflingSpatial.occupiedSpace.minXFeet === 10 &&
        halflingSpatial.occupiedSpace.maxXFeet === 15 &&
        halflingSpatial.occupiedSpace.maxYFeet === 20,
    );
    const placedNpc = await place(npcCombatant.id, { xFeet: 60, yFeet: 10 });
    check(
      '88.J.1) MASTER posiciona instância de NPC/Creature',
      placedNpc.status === 200 &&
        spatialOf(placedNpc.data.combat, npcCombatant.id).position.xFeet === 60,
    );
    const ogreRow = await prisma.creature.findUniqueOrThrow({ where: { id: ogre.id } });
    const halflingRow = await prisma.character.findUniqueOrThrow({ where: { id: halfling.id } });
    check(
      '88.K.1) o TEMPLATE da criatura não recebe posição (nem coluna de espaço)',
      !('spatialPosition' in ogreRow) && !('position' in ogreRow),
    );
    check(
      '88.L.1) a FICHA global não recebe posição de combate',
      !('spatialPosition' in halflingRow) &&
        !('xFeet' in halflingRow) &&
        !('position' in halflingRow),
    );
    check(
      '88.N.1) Large ocupa 10×10 pés (derivado do cadastro do Mestre)',
      spatialOf(state, ogreCombatant.id).baseSize === 'large' &&
        spatialOf(state, ogreCombatant.id).occupiedSpace.widthFeet === 10 &&
        spatialOf(state, ogreCombatant.id).occupiedSpace.heightFeet === 10,
    );
    const outOfBounds = await place(ogreCombatant.id, { xFeet: 115, yFeet: 10 });
    check(
      '88.O.1) fora dos limites é rejeitado (Large em 115 termina em 125 > 120)',
      outOfBounds.status === 400 && outOfBounds.data.error === 'SPATIAL_POSITION_OUT_OF_BOUNDS',
    );
    check(
      '88.M.1) posição null = UNPLACED (nunca 0,0)',
      (await place(npcCombatant.id, null)).status === 200 &&
        spatialOf(state, npcCombatant.id).position === null &&
        spatialOf(state, npcCombatant.id).occupiedSpace === null,
    );
    check(
      '88.Q.1) unplace NÃO remove o combatente da iniciativa',
      state.combatants.some((item: any) => item.id === npcCombatant.id),
    );

    // ===================================================================
    // R–W — TAMANHO: raça canônica, raça custom, cadastro, reload
    // ===================================================================
    check(
      '88.R.1) Character Small vem da RAÇA estruturada (Halfling), sem hardcode de nome',
      spatialOf(state, halflingCombatant.id).baseSize === 'small',
    );
    const humanCombatant = combatantOf('character', human.id);
    const homebrewCombatant = combatantOf('character', homebrew.id);
    check(
      '88.S.1) Character Medium vem da raça e Small/Medium seguem tipos DISTINTOS',
      spatialOf(state, humanCombatant.id).baseSize === 'medium' &&
        spatialOf(state, halflingCombatant.id).baseSize !==
          spatialOf(state, humanCombatant.id).baseSize,
    );
    check(
      '88.S.2) raça CUSTOM (homebrew) fornece size estruturado ao Character',
      spatialOf(state, homebrewCombatant.id).baseSize === 'small',
    );
    check(
      '88.T.1) placement NÃO aceita tamanho/occupiedSpace do cliente (400)',
      (await place(halflingCombatant.id, { xFeet: 0, yFeet: 0 }, masterToken, { size: 'large' }))
        .status === 400 &&
        (
          await place(halflingCombatant.id, { xFeet: 0, yFeet: 0 }, masterToken, {
            occupiedSpace: { minXFeet: 0, minYFeet: 0 },
          })
        ).status === 400,
    );
    const npcSized = await request('PATCH', `/creatures/${npc.id}`, { size: 'Large' });
    check(
      '88.U.1) NPC: MASTER define tamanho no cadastro e ele persiste',
      npcSized.status === 200 &&
        npcSized.data.creature.size === 'Large' &&
        (await request('GET', `/creatures/${npc.id}`)).data.creature.size === 'Large' &&
        (await request('PATCH', `/creatures/${npc.id}`, { size: 'Colossal' })).status === 400,
    );
    const ogreSized = await request('PATCH', `/creatures/${ogre.id}`, { size: 'Huge' });
    check(
      '88.V.1) Creature: tamanho definido pelo Mestre persiste e alimenta o DTO de combate',
      ogreSized.status === 200 &&
        ogreSized.data.creature.size === 'Huge' &&
        (await request('GET', `/creatures/${ogre.id}`)).data.creature.size === 'Huge',
    );
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '88.W.1) reload mantém tamanho do NPC e o espaço ocupado deriva do cadastro',
      spatialOf(state, npcCombatant.id).baseSize === 'large' &&
        spatialOf(state, ogreCombatant.id).baseSize === 'huge' &&
        spatialOf(state, ogreCombatant.id).occupiedSpace.widthFeet === 15,
    );

    // ===================================================================
    // X–AC — IMAGEM DO TOKEN: retrato/imagem existentes, null = fallback
    // ===================================================================
    check(
      '88.X.1) Character usa o RETRATO da ficha como token (sem upload separado)',
      spatialOf(state, halflingCombatant.id).tokenImageRef ===
        '/uploads/characters/avatar-spatial.png',
    );
    check(
      '88.Y.1) NPC usa a imagem cadastrada pelo Mestre',
      spatialOf(state, npcCombatant.id).tokenImageRef === '/uploads/creatures/npc-spatial.png',
    );
    check(
      '88.AA.1) criatura sem imagem → tokenImageRef null (fallback `?` na UI futura)',
      spatialOf(state, ogreCombatant.id).tokenImageRef === null,
    );
    check(
      '88.AB.1) o DTO espacial tem EXATAMENTE os cinco campos previstos (sem 2ª imagem)',
      JSON.stringify(Object.keys(spatialOf(state, halflingCombatant.id)).sort()) ===
        JSON.stringify(
          ['baseSize', 'effectiveSize', 'occupiedSpace', 'position', 'tokenImageRef'].sort(),
        ),
    );
    const ogreWithImage = await prisma.creature.update({
      where: { id: ogre.id },
      data: { imageUrl: '/uploads/creatures/ogre-spatial.png' },
    });
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '88.AC.1) imagem NÃO altera tamanho/footprint (Huge continua 15×15)',
      ogreWithImage.size === 'Huge' &&
        spatialOf(state, ogreCombatant.id).effectiveSize === 'huge' &&
        spatialOf(state, ogreCombatant.id).occupiedSpace.widthFeet === 15,
    );

    // ===================================================================
    // AD–AG — IDEMPOTÊNCIA, VERSÃO E CONCORRÊNCIA
    // ===================================================================
    const retryOp = randomUUID();
    const retryBody = { position: { xFeet: 70, yFeet: 40 }, ...operation() };
    retryBody.operationId = retryOp;
    const firstPlace = await request(
      'PATCH',
      `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`,
      retryBody,
    );
    state = firstPlace.data.combat;
    const retryPlace = await request(
      'PATCH',
      `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`,
      retryBody,
    );
    check(
      '88.AD.1) retry idêntico devolve a MESMA posição sem nova versão',
      firstPlace.status === 200 &&
        retryPlace.status === 200 &&
        retryPlace.data.combat.version === firstPlace.data.combat.version &&
        spatialOf(retryPlace.data.combat, halflingCombatant.id).position.xFeet === 70,
    );
    const reused = await request(
      'PATCH',
      `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`,
      { ...retryBody, position: { xFeet: 0, yFeet: 0 } },
    );
    check(
      '88.AE.1) mesma operationId com posição diferente → 409 IDEMPOTENCY_KEY_REUSED',
      reused.status === 409 && reused.data.error === 'IDEMPOTENCY_KEY_REUSED',
      JSON.stringify({ status: reused.status, data: reused.data }),
    );
    const stale = await request(
      'PATCH',
      `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`,
      { position: { xFeet: 5, yFeet: 5 }, expectedVersion: state.version - 1, operationId: randomUUID() },
    );
    check('88.AF.1) expectedVersion velho → 409 CONFLICT', stale.status === 409);
    const concurrentBody = { position: { xFeet: 20, yFeet: 30 } };
    const concurrent = await Promise.all([
      request('PATCH', `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`, {
        ...concurrentBody,
        expectedVersion: state.version,
        operationId: randomUUID(),
      }),
      request('PATCH', `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`, {
        ...concurrentBody,
        expectedVersion: state.version,
        operationId: randomUUID(),
      }),
    ]);
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '88.AG.1) duas posições concorrentes: UM vence e o outro recebe 409',
      concurrent.filter((item) => item.status === 200).length === 1 &&
        concurrent.filter((item) => item.status === 409).length === 1 &&
        spatialOf(state, halflingCombatant.id).position.xFeet === 20,
    );

    // ===================================================================
    // AH–AI — REALTIME: só depois do commit
    // ===================================================================
    socket.auth = { token: masterToken };
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    const beforePosition = state.version;
    const positionEvent = new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      const handler = (payload: any) => {
        if (payload?.combat?.version > beforePosition) {
          clearTimeout(timer);
          socket.off('combat:updated', handler);
          resolve(payload);
        }
      };
      socket.on('combat:updated', handler);
    });
    await place(ogreCombatant.id, { xFeet: 40, yFeet: 15 });
    const eventPayload = await positionEvent;
    check(
      '88.AH.1) placement publica combat:updated DEPOIS do commit com a posição nova',
      Boolean(eventPayload) &&
        spatialOf(eventPayload!.combat, ogreCombatant.id).position.xFeet === 40,
    );
    let eventCount = 0;
    const countEvent = () => {
      eventCount += 1;
    };
    socket.on('combat:updated', countEvent);
    await request(
      'PATCH',
      `/combat/${combatId}/combatants/${halflingCombatant.id}/spatial-position`,
      {
        position: { xFeet: 500, yFeet: 500 },
        expectedVersion: (await request('GET', '/combat/active')).data.combat.version,
        operationId: randomUUID(),
      },
    );
    await sleep(900);
    socket.off('combat:updated', countEvent);
    check('88.AI.1) requisição inválida NÃO publica realtime', eventCount === 0);

    // ===================================================================
    // AJ–AN — PRIVACIDADE: criatura não vaza posição/tamanho/imagem
    // ===================================================================
    const masterView = (await request('GET', '/combat/active')).data.combat as Record<string, any>;
    const playerView = (await request('GET', '/combat/active', undefined, playerToken))
      .data.combat as Record<string, any>;
    const playerOgre = playerView.combatants.find((item: any) => item.id === ogreCombatant.id);
    check(
      '88.AJ.1) MASTER vê os dados espaciais da criatura',
      spatialOf(masterView, ogreCombatant.id).position !== null &&
        spatialOf(masterView, ogreCombatant.id).effectiveSize === 'huge',
    );
    check(
      '88.AK.1) PLAYER NÃO recebe posição/ocupação de criatura MASTER-ONLY (null no servidor)',
      playerOgre.spatial === null,
    );
    check(
      '88.AL.1) PLAYER NÃO recebe imagem de token de criatura MASTER-ONLY',
      playerOgre.imageUrl === null && playerOgre.spatial === null,
    );
    check(
      '88.AM.1) PLAYER NÃO recebe tamanho nem occupiedSpace de criatura MASTER-ONLY',
      playerOgre.spatial === null && playerOgre.statsHidden === true,
    );
    check(
      '88.AN.1) nenhum combatente/array extra vaza na visão do jogador',
      playerView.combatants.length === masterView.combatants.length &&
        !('spatialConfig' in playerView),
    );

    // ===================================================================
    // AO–AS — BACKWARD COMPATIBILITY
    // ===================================================================
    const attack = await request('POST', '/combat/attack', {
      combatId,
      expectedVersion: state.version,
      operationId: randomUUID(),
      attackerCombatantId: ogreCombatant.id,
      targetCombatantId: halflingCombatant.id,
      attackId: 'bite',
    });
    state = attack.data.combat ?? state;
    // PHB 2014: 1 natural SEMPRE erra, independentemente do bônus. A fixture
    // não pode tratar esse caso legítimo como regressão (era um flake de 1/20):
    // aqui exigimos dano aplicado OU o miss correto do 1 natural, nunca um
    // acerto sem dano.
    const attackResult = attack.data.result;
    const naturalOne = attackResult?.attackRoll === 1;
    check(
      '88.AO.1) ataque em combate com cena continua funcionando (dano aplicado, salvo 1 natural)',
      attack.status === 200 &&
        typeof attackResult?.targetHpCurrent === 'number' &&
        (naturalOne
          ? attackResult.hit === false && attackResult.targetHpCurrent === 30
          : attackResult.targetHpCurrent < 30),
      JSON.stringify({ status: attack.status, data: attack.data }),
    );
    check(
      '88.AQ.1) Cover continua ASSISTIDO (`not-assessed`) — posição NÃO infere cobertura',
      attack.data.result?.cover?.status === 'not-assessed',
    );
    check(
      '88.AS.1) Action Economy inalterada (ataque gasta UMA Ação)',
      state.combatants.find((item: any) => item.id === ogreCombatant.id)?.turnEconomy
        .actionsUsed === 1,
    );
    check(
      '88.AP.1) resolução de magias segue disponível para o combate',
      (await request('GET', `/${'combat'}/${combatId}/resolution-requests`)).status === 200 &&
        (await request('GET', `/combat/${combatId}/resolution-requests`)).status === 200,
    );
    const backToAssisted = await configure({ mode: 'assisted' });
    state = backToAssisted.data.combat;
    check(
      '88.AR.1) voltar para assisted NÃO apaga posições (só deixa de ser fonte autoritativa)',
      backToAssisted.status === 200 &&
        state.spatial.mode === 'assisted' &&
        state.spatial.widthFeet === 120 &&
        spatialOf(state, ogreCombatant.id).position.xFeet === 40,
    );
    check(
      '88.AR.2) `assisted` continua sem geometria/alcance (nenhum campo de distância/range)',
      state.spatial.mode === 'assisted' &&
        !('distanceFeet' in spatialOf(state, ogreCombatant.id)) &&
        !('rangeFeet' in spatialOf(state, ogreCombatant.id)),
    );
  } finally {
    socket.close();
    // Cleanup LIMITADO aos IDs desta execução (nada de dados reais).
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } }).catch(() => undefined);
      await prisma.combatant.deleteMany({ where: { combatId } }).catch(() => undefined);
      await prisma.combat.delete({ where: { id: combatId } }).catch(() => undefined);
    }
    if (customRaceId) {
      await prisma.character.updateMany({ where: { customRaceId }, data: { customRaceId: null } }).catch(() => undefined);
      await prisma.customRace.delete({ where: { id: customRaceId } }).catch(() => undefined);
    }
    if (characterIds.length) {
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } }).catch(() => undefined);
    }
    if (creatureIds.length) {
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } }).catch(() => undefined);
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
