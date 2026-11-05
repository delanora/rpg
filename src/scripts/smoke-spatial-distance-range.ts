import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import type { CombatSourced } from '../modules/combat/combat.dto.js';
import {
  combatSpatialIndex,
  evaluateEntityDistance,
  evaluateEntityRange,
  gridAreaSpatialProvider,
  gridSpatialProvider,
} from '../modules/combat/spatial/spatial-distance.service.js';
import {
  SPATIAL_DISTANCE_ALGORITHM,
  bodyDistanceFeet,
  evaluateSpatialDistance,
  isGridAligned,
  type SpatialDistanceEvaluation,
} from '../modules/combat/spatial/spatial-distance.js';
import { evaluateRange, weaponRangeOf } from '../modules/combat/spatial/spatial-range.js';
import { spatialSceneOf } from '../modules/combat/spatial/spatial.types.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { validateTargeting } from '../modules/spells/execution/spell-targeting.service.js';
import { SACRED_FLAME_SPELL_ID } from '../modules/spells/execution/sacred-flame.js';
import { BLESS_SPELL_ID } from '../modules/effects/definitions/bless.js';
import { HOLD_PERSON_SPELL_ID } from '../modules/effects/definitions/hold-person.js';
import { HEALING_WORD_SPELL_ID } from '../modules/spells/execution/healing-word.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, any>;
}

/**
 * FASE 6.6L.2 — DISTANCE + RANGE FOUNDATION (PHB 2014).
 *
 * Prova que o servidor passou a saber:
 *  • a distância PHB-grid entre espaços OCUPADOS (nunca centro→centro, nunca
 *    euclidiana, diagonal adjacente = 5 pés, shortest route);
 *  • a precisão de 2,5 pés do Tiny (sem virar Small e sem arredondar para 5);
 *  • o alinhamento canônico novo (Small+ 5 pés, Tiny 2,5 pés);
 *  • reach/alcance normal/longo de arma, com long range → desvantagem;
 *  • alcance numérico de magia e alcance até a ORIGEM resolvida de área;
 *  • privacidade da distância (PLAYER nunca descobre criatura oculta).
 *
 * NÃO implementa (e o smoke verifica a ausência): movimento/path, colisão,
 * linha de visão, cobertura geométrica e membership de área.
 */
export async function smokeSpatialDistance(baseUrl: string, check: Check): Promise<void> {
  console.log('\n89) Fase 6.6L.2 — Distance + Range Foundation');

  // ===================================================================
  // A–L — DISTÂNCIA PURA (PHB grid + footprint precision)
  // ===================================================================
  const grid = spatialSceneOf({
    mode: 'grid-2d',
    widthFeet: 400,
    heightFeet: 400,
    cellSizeFeet: 5,
  });
  const assisted = spatialSceneOf({ mode: 'assisted' });
  const body = (x: number, y: number, size: string) => ({
    position: { xFeet: x, yFeet: y },
    size: size as never,
  });
  const between = (a: ReturnType<typeof body>, b: ReturnType<typeof body>) =>
    bodyDistanceFeet(a, b);

  const assistedEvaluation = evaluateSpatialDistance(
    assisted,
    body(0, 0, 'medium'),
    body(5, 0, 'medium'),
  );
  check(
    '89.A) assisted NÃO inventa distância: `not-assessed` (nunca 0 pé nem falha)',
    assistedEvaluation.status === 'not-assessed' && assistedEvaluation.reason === 'assisted-mode',
  );
  const unplaced = evaluateSpatialDistance(
    grid,
    { position: null, size: 'medium' },
    body(5, 0, 'medium'),
  );
  check(
    '89.B) unplaced (origem ou alvo) → `unknown`, nunca 0 pé',
    unplaced.status === 'unknown' &&
      unplaced.reason === 'source-unplaced' &&
      evaluateSpatialDistance(grid, body(0, 0, 'medium'), body(5, 0, 'medium')).status === 'known',
  );
  check(
    '89.C) adjacente horizontal/vertical = 5 e duas células = 10',
    between(body(0, 0, 'medium'), body(5, 0, 'medium')) === 5 &&
      between(body(0, 0, 'medium'), body(0, 5, 'medium')) === 5 &&
      between(body(0, 0, 'medium'), body(10, 0, 'medium')) === 10 &&
      between(body(0, 0, 'medium'), body(0, 10, 'medium')) === 10,
  );
  check(
    '89.D) diagonal adjacente = 5 e 2×2 diagonais = 10 (NÃO euclidiana)',
    between(body(0, 0, 'medium'), body(5, 5, 'medium')) === 5 &&
      between(body(0, 0, 'medium'), body(10, 10, 'medium')) === 10,
  );
  check(
    '89.E) Large usa a borda MAIS PRÓXIMA do footprint (10,0 → 5 e 15,0 → 10)',
    between(body(0, 0, 'large'), body(10, 0, 'medium')) === 5 &&
      between(body(0, 0, 'large'), body(15, 0, 'medium')) === 10 &&
      between(body(10, 0, 'medium'), body(0, 0, 'large')) === 5,
  );
  check(
    '89.F) Huge e Gargantuan medem do quadrado ocupado mais próximo (não do centro)',
    between(body(0, 0, 'huge'), body(20, 0, 'medium')) === 10 &&
      between(body(0, 0, 'gargantuan'), body(25, 0, 'medium')) === 10 &&
      between(body(0, 0, 'gargantuan'), body(20, 0, 'medium')) === 5,
  );
  check(
    '89.G) Tiny preserva 2,5 pés: 2,5 → 2,5 · diagonal 2,5 → 2,5 · 5,5 → 5',
    between(body(0, 0, 'tiny'), body(2.5, 0, 'tiny')) === 2.5 &&
      between(body(0, 0, 'tiny'), body(2.5, 2.5, 'tiny')) === 2.5 &&
      between(body(0, 0, 'tiny'), body(5, 5, 'tiny')) === 5,
  );
  check(
    '89.H) Tiny NÃO é arredondado para 5 pés nem convertido em Small',
    between(body(0, 0, 'tiny'), body(2.5, 0, 'tiny')) !== 5 &&
      between(body(0, 0, 'tiny'), body(2.5, 0, 'tiny')) !== 0,
  );
  check(
    '89.I) Medium × Tiny: 5 → 5 pés e 7,5 → 7,5 pés (precisão real)',
    between(body(0, 0, 'medium'), body(5, 0, 'tiny')) === 5 &&
      between(body(0, 0, 'medium'), body(7.5, 0, 'tiny')) === 7.5,
  );
  check(
    '89.J) Large × Tiny mede do quadrado da Large, não do centro',
    between(body(0, 0, 'large'), body(10, 0, 'tiny')) === 5 &&
      between(body(0, 0, 'large'), body(12.5, 0, 'tiny')) === 7.5,
  );
  check(
    '89.K) overlap real = 0 e quadrados que apenas se TOCAM = 5',
    between(body(0, 0, 'medium'), body(2.5, 2.5, 'tiny')) === 0 &&
      between(body(0, 0, 'medium'), body(5, 0, 'medium')) === 5,
  );
  check(
    '89.L) simetria em todos os tamanhos: d(A,B) === d(B,A)',
    [
      ['tiny', 'medium'],
      ['large', 'tiny'],
      ['huge', 'medium'],
      ['gargantuan', 'small'],
      ['medium', 'medium'],
    ].every(([a, b]) => {
      const first = between(body(0, 0, a), body(15, 10, b));
      const second = between(body(15, 10, b), body(0, 0, a));
      return first !== null && first === second;
    }),
  );

  // ===================================================================
  // M–Q — ALINHAMENTO CANÔNICO
  // ===================================================================
  check(
    '89.M) alinhamento: Small+ múltiplos de 5 pés',
    isGridAligned({ xFeet: 10, yFeet: 25 }, 'medium') &&
      isGridAligned({ xFeet: 0, yFeet: 0 }, 'large') &&
      !isGridAligned({ xFeet: 2.5, yFeet: 0 }, 'medium'),
  );
  check(
    '89.N) alinhamento: Tiny aceita múltiplos de 2,5 pés',
    isGridAligned({ xFeet: 2.5, yFeet: 7.5 }, 'tiny') &&
      isGridAligned({ xFeet: 5, yFeet: 0 }, 'tiny') &&
      !isGridAligned({ xFeet: 3.5, yFeet: 0 }, 'tiny'),
  );
  const legacy = evaluateSpatialDistance(grid, body(2.5, 0, 'medium'), body(20, 0, 'medium'));
  check(
    '89.Q) posição legada fora da malha NÃO é arredondada: vira `unknown` auditável',
    legacy.status === 'unknown' && legacy.reason === 'source-not-canonical',
  );

  // ===================================================================
  // R–X — RANGE (alcance) PURO
  // ===================================================================
  const known = (feet: number): SpatialDistanceEvaluation => ({
    status: 'known',
    distanceFeet: feet,
    provenance: 'grid-2d',
    algorithm: SPATIAL_DISTANCE_ALGORITHM,
  });
  check(
    '89.R) alcance é INCLUSIVO: 30/30 passa; 32,5/30 falha',
    evaluateRange({ distance: known(30), normalRangeFeet: 30 }).status === 'in-range' &&
      evaluateRange({ distance: known(32.5), normalRangeFeet: 30 }).status === 'out-of-range',
  );
  check(
    '89.S) arma normal 30/longo 120: 30 normal · 32,5 longo · 120 longo · 122,5 fora',
    evaluateRange({ distance: known(30), normalRangeFeet: 30, longRangeFeet: 120 }).band ===
      'normal' &&
      evaluateRange({ distance: known(32.5), normalRangeFeet: 30, longRangeFeet: 120 }).band ===
        'long' &&
      evaluateRange({ distance: known(120), normalRangeFeet: 30, longRangeFeet: 120 }).band ===
        'long' &&
      evaluateRange({ distance: known(122.5), normalRangeFeet: 30, longRangeFeet: 120 }).status ===
        'out-of-range',
  );
  check(
    '89.T) melee: reach 5 (5 passa, 7,5 falha) e reach 10 (10 passa, 12,5 falha)',
    evaluateRange({ distance: known(5), reachFeet: 5 }).status === 'in-range' &&
      evaluateRange({ distance: known(7.5), reachFeet: 5 }).status === 'out-of-range' &&
      evaluateRange({ distance: known(10), reachFeet: 10 }).status === 'in-range' &&
      evaluateRange({ distance: known(12.5), reachFeet: 10 }).status === 'out-of-range',
  );
  check(
    '89.U) alcance UNKNOWN (assisted/unplaced) continua UNKNOWN — nunca falha',
    evaluateRange({
      distance: { status: 'not-assessed', reason: 'assisted-mode' },
      reachFeet: 5,
    }).status === 'unknown' &&
      evaluateRange({
        distance: { status: 'unknown', reason: 'target-unplaced' },
        normalRangeFeet: 30,
        longRangeFeet: 120,
      }).status === 'unknown',
  );
  const longbow = weaponRangeOf(
    {
      weaponType: 'ranged',
      properties: ['two-handed', 'ammunition'],
      rangeNormal: 45,
      rangeLong: 180,
    },
    'ranged',
  );
  const dagger = weaponRangeOf(
    { weaponType: 'melee', properties: ['light', 'thrown'], rangeNormal: 6, rangeLong: 18 },
    'ranged',
  );
  const glaive = weaponRangeOf({ properties: ['reach', 'two-handed'] }, 'melee');
  const longsword = weaponRangeOf({ properties: [] }, 'melee');
  check(
    '89.V) arma à distância converte METROS → PÉS (45/180 m = 150/600)',
    longbow?.normalRangeFeet === 150 && longbow?.longRangeFeet === 600,
  );
  check(
    '89.W) arremesso usa os alcances da arma lançada (6/18 m = 20/60)',
    dagger?.normalRangeFeet === 20 && dagger?.longRangeFeet === 60,
  );
  check(
    '89.X) reach vem da PROPRIEDADE estruturada (+5): glaive 10 pés, arma comum 5',
    glaive?.reachFeet === 10 && longsword?.reachFeet === 5,
  );

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatIds: string[] = [];
  let customRaceId: string | null = null;

  try {
    // ===================================================================
    // FIXTURES (contas próprias; nada real é tocado)
    // ===================================================================
    const master = await prisma.user.create({
      data: {
        username: `dr_m_${suffix}`,
        displayName: 'Mestre Distância',
        passwordHash: 'fixture',
        role: 'MASTER',
      },
    });
    const player = await prisma.user.create({
      data: {
        username: `dr_p_${suffix}`,
        displayName: 'Jogadora Distância',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    const allyUser = await prisma.user.create({
      data: {
        username: `dr_a_${suffix}`,
        displayName: 'Aliado Distância',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    const fairyUser = await prisma.user.create({
      data: {
        username: `dr_f_${suffix}`,
        displayName: 'Fada Distância',
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
      data: { name: `Minúsculo ${suffix}`, size: 'Tiny', speed: 7.5 },
    });
    customRaceId = customRace.id;

    const inventoryItem = (
      id: string,
      name: string,
      slot: string | null,
      details: Record<string, unknown>,
    ) => ({
      id,
      name,
      description: '',
      quantity: 1,
      weight: 0,
      slot,
      backpackX: null,
      backpackY: null,
      imageUrl: '',
      itemId: '',
      category: 'Arma',
      rarity: null,
      requiresAttunement: false,
      attuned: false,
      details,
      campSupply: { enabled: false, value: 0 },
    });
    const swordId = `dr-sword-${suffix}`;
    const bowId = `dr-bow-${suffix}`;
    const arrowsId = `dr-arrows-${suffix}`;

    const melee = await prisma.character.create({
      data: {
        userId: player.id,
        name: 'Guerreiro Distância',
        hpCurrent: 30,
        hpMax: 30,
        speed: 9,
        raceId: 'human',
        strength: 16,
        dexterity: 12,
        inventory: [
          inventoryItem(swordId, 'Espada Longa', 'hand1', {
            weaponType: 'melee',
            weaponCategory: 'martial',
            damageCount: 1,
            damageDie: 8,
            damageType: 'Cortante',
            properties: [],
          }),
        ] as never,
        attacks: [],
      },
    });
    const archer = await prisma.character.create({
      data: {
        userId: allyUser.id,
        name: 'Arqueira Distância',
        hpCurrent: 30,
        hpMax: 30,
        speed: 9,
        raceId: 'human',
        strength: 10,
        dexterity: 16,
        inventory: [
          inventoryItem(bowId, 'Arco Longo', 'hand1', {
            weaponType: 'ranged',
            weaponCategory: 'martial',
            damageCount: 1,
            damageDie: 8,
            damageType: 'Perfurante',
            properties: ['two-handed', 'ammunition'],
            ammoType: 'Flecha',
            rangeNormal: 45,
            rangeLong: 180,
          }),
          {
            ...inventoryItem(arrowsId, 'Flechas', null, { ammoType: 'Flecha' }),
            category: 'Munição',
            quantity: 10,
          },
        ] as never,
        attacks: [],
      },
    });
    const tiny = await prisma.character.create({
      data: {
        userId: fairyUser.id,
        name: 'Fada Distância',
        hpCurrent: 10,
        hpMax: 10,
        speed: 7.5,
        customRaceId: customRace.id,
      },
    });
    characterIds.push(melee.id, archer.id, tiny.id);

    const target = await prisma.creature.create({
      data: {
        name: 'Alvo Distância',
        kind: 'NPC',
        type: 'Humanoide',
        size: 'Medium',
        hpCurrent: 200,
        hpMax: 200,
        speed: 9,
        armorClass: 1,
      },
    });
    const farTarget = await prisma.creature.create({
      data: {
        name: 'Alvo Distante',
        kind: 'NPC',
        type: 'Humanoide',
        size: 'Medium',
        hpCurrent: 200,
        hpMax: 200,
        speed: 9,
        armorClass: 1,
      },
    });
    const hidden = await prisma.creature.create({
      data: {
        name: 'Espião Oculto',
        kind: 'NPC',
        type: 'Humanoide',
        size: 'Medium',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
      },
    });
    creatureIds.push(target.id, farTarget.id, hidden.id);

    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        round: 1,
        currentIndex: 0,
        turnSequence: 1,
        spatialConfig: {
          mode: 'grid-2d',
          widthFeet: 800,
          heightFeet: 800,
          cellSizeFeet: 5,
        } as never,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: melee.id,
              ownerUserId: player.id,
              name: melee.name,
              initiative: 100,
              dexterityMod: 1,
              turnEconomy: onTurnStart(9) as never,
            },
            {
              kind: 'CHARACTER',
              characterId: archer.id,
              ownerUserId: allyUser.id,
              name: archer.name,
              initiative: 90,
              dexterityMod: 3,
              turnEconomy: onTurnStart(9) as never,
            },
            {
              kind: 'CHARACTER',
              characterId: tiny.id,
              ownerUserId: allyUser.id,
              name: tiny.name,
              initiative: 80,
              dexterityMod: 3,
            },
            {
              kind: 'NPC',
              creatureId: target.id,
              name: target.name,
              hpCurrent: 200,
              hpMax: 200,
              armorClass: 1,
              initiative: 30,
              dexterityMod: 1,
              spatialPosition: { xFeet: 5, yFeet: 0 } as never,
            },
            {
              kind: 'NPC',
              creatureId: farTarget.id,
              name: farTarget.name,
              hpCurrent: 200,
              hpMax: 200,
              armorClass: 1,
              initiative: 20,
              dexterityMod: 1,
              spatialPosition: { xFeet: 150, yFeet: 100 } as never,
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
              spatialPosition: { xFeet: 200, yFeet: 200 } as never,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);
    const meleeCombatant = combat.combatants.find((item) => item.characterId === melee.id)!;
    const archerCombatant = combat.combatants.find((item) => item.characterId === archer.id)!;
    const tinyCombatant = combat.combatants.find((item) => item.characterId === tiny.id)!;
    const targetCombatant = combat.combatants.find((item) => item.creatureId === target.id)!;
    const farCombatant = combat.combatants.find((item) => item.creatureId === farTarget.id)!;
    const hiddenCombatant = combat.combatants.find((item) => item.creatureId === hidden.id)!;

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

    async function refresh(): Promise<void> {
      state = (await request('GET', '/combat/active')).data.combat;
    }

    async function place(
      combatantId: string,
      position: Record<string, number> | null,
      auth: string = masterToken,
    ): Promise<HttpResult> {
      const response = await request(
        'PATCH',
        `/combat/${combat.id}/combatants/${combatantId}/spatial-position`,
        { position, ...operation() },
        auth,
      );
      if (response.data.combat) state = response.data.combat;
      return response;
    }

    /**
     * Avança turnos até o combatente pedido (caminho NORMAL do combate) e SEMPRE
     * encerra o turno atual primeiro: o mesmo combatente não ataca duas vezes no
     * próprio turno sem Extra Attack.
     */
    async function advanceTo(combatantId: string): Promise<boolean> {
      for (let attempt = 0; attempt < 9; attempt += 1) {
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

    const distanceRead = (from: string, to: string, auth = masterToken) =>
      request(
        'GET',
        `/combat/${combat.id}/spatial/distance?fromCombatantId=${from}&toCombatantId=${to}`,
        undefined,
        auth,
      );

    const spatialIndexNow = async () =>
      combatSpatialIndex(
        (await prisma.combat.findUniqueOrThrow({
          where: { id: combat.id },
          include: { combatants: true },
        })) as unknown as CombatSourced,
      );

    // ===================================================================
    // M–P — ALINHAMENTO NO PLACEMENT REAL (server-side)
    // ===================================================================
    const misaligned = await place(meleeCombatant.id, { xFeet: 2.5, yFeet: 0 });
    check(
      '89.M.1) placement NOVO de Small+ em 2,5 pés → 400 SPATIAL_POSITION_NOT_GRID_ALIGNED',
      misaligned.status === 400 && misaligned.data.error === 'SPATIAL_POSITION_NOT_GRID_ALIGNED',
      JSON.stringify({ status: misaligned.status, data: misaligned.data }),
    );
    const tinyAligned = await place(tinyCombatant.id, { xFeet: 2.5, yFeet: 0 });
    check(
      '89.N.1) Tiny aceita 2,5 pés e continua Tiny (não vira 1 célula de 5)',
      tinyAligned.status === 200 &&
        tinyAligned.data.combat.combatants.find((item: any) => item.id === tinyCombatant.id).spatial
          .effectiveSize === 'tiny',
    );
    const tinyMisaligned = await place(tinyCombatant.id, { xFeet: 3.5, yFeet: 0 });
    check(
      '89.O.1) Tiny fora de 2,5 pés → 400 (dado novo nunca é arredondado)',
      tinyMisaligned.status === 400 &&
        tinyMisaligned.data.error === 'SPATIAL_POSITION_NOT_GRID_ALIGNED',
    );
    await place(meleeCombatant.id, { xFeet: 0, yFeet: 0 });
    await place(archerCombatant.id, { xFeet: 0, yFeet: 100 });
    await refresh();
    check(
      '89.P.1) posições válidas alinhadas persistem (0,0 e 0,100)',
      state.combatants.find((item: any) => item.id === meleeCombatant.id).spatial.position.xFeet ===
        0 &&
        state.combatants.find((item: any) => item.id === archerCombatant.id).spatial.position
          .yFeet === 100,
    );

    // ===================================================================
    // A–L — DISTÂNCIA REAL VIA READ ENDPOINT
    // ===================================================================
    const adjacent = await distanceRead(meleeCombatant.id, targetCombatant.id);
    check(
      '89.A.1) read endpoint devolve distância PHB-grid conhecida (0,0 ↔ 5,0 = 5 pés)',
      adjacent.status === 200 &&
        adjacent.data.distance.status === 'known' &&
        adjacent.data.distance.distanceFeet === 5 &&
        adjacent.data.distance.algorithm === SPATIAL_DISTANCE_ALGORITHM &&
        adjacent.data.distance.provenance === 'grid-2d',
      JSON.stringify(adjacent.data),
    );
    const diagonalRead = await distanceRead(archerCombatant.id, targetCombatant.id);
    check(
      '89.D.1) diagonal real (0,100 ↔ 5,0) = 100 pés por shortest route',
      diagonalRead.data.distance.distanceFeet === 100,
      JSON.stringify(diagonalRead.data),
    );
    await place(targetCombatant.id, null);
    await refresh();
    const unplacedRead = await distanceRead(meleeCombatant.id, targetCombatant.id);
    check(
      '89.B.1) unplaced via HTTP → `unknown/target-unplaced` (nunca 0 pé)',
      unplacedRead.data.distance.status === 'unknown' &&
        unplacedRead.data.distance.reason === 'target-unplaced' &&
        unplacedRead.data.distance.distanceFeet === null,
    );
    await place(targetCombatant.id, { xFeet: 5, yFeet: 0 });
    await refresh();
    const symmetryRead = await distanceRead(targetCombatant.id, meleeCombatant.id);
    check(
      '89.L.1) simetria no servidor: d(A,B) === d(B,A)',
      symmetryRead.data.distance.distanceFeet === 5 &&
        (await distanceRead(meleeCombatant.id, targetCombatant.id)).data.distance.distanceFeet === 5,
    );

    // ===================================================================
    // R–T / Z — ATAQUE CORPO A CORPO: reach e preservação de custos
    // ===================================================================
    const meleeAttackId = `weapon:${swordId}`;
    const rangedAttackId = `weapon:${bowId}`;
    const meleeHit = await request('POST', '/combat/attack', {
      combatId: combat.id,
      ...operation(),
      attackerCombatantId: meleeCombatant.id,
      targetCombatantId: targetCombatant.id,
      attackId: meleeAttackId,
    });
    state = meleeHit.data.combat ?? state;
    check(
      '89.R.1) melee adjacente (5 pés, reach 5) é aceito e o alcance fica no payload',
      meleeHit.status === 200 &&
        meleeHit.data.result?.range?.status === 'in-range' &&
        meleeHit.data.result?.range?.distanceFeet === 5 &&
        meleeHit.data.result?.range?.reachFeet === 5,
      JSON.stringify({ status: meleeHit.status, range: meleeHit.data.result?.range }),
    );
    check(
      '89.AM.1) alcance PASS NÃO infere cobertura: Cover continua `not-assessed`',
      meleeHit.data.result?.cover?.status === 'not-assessed',
    );
    const actionsAfterMelee = state.combatants.find((item: any) => item.id === meleeCombatant.id)
      .turnEconomy.actionsUsed;
    await place(targetCombatant.id, { xFeet: 10, yFeet: 0 });
    await refresh();
    const outOfReach = await request('POST', '/combat/attack', {
      combatId: combat.id,
      ...operation(),
      attackerCombatantId: meleeCombatant.id,
      targetCombatantId: targetCombatant.id,
      attackId: meleeAttackId,
      advantage: true,
    });
    check(
      '89.T.1) alvo a 10 pés com reach 5 → 409 TARGET_OUT_OF_REACH',
      outOfReach.status === 409 && outOfReach.data.error === 'TARGET_OUT_OF_REACH',
      JSON.stringify({ status: outOfReach.status, data: outOfReach.data }),
    );
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '89.Z.1) fora do reach NÃO gasta Ação nem rola d20 (nem com vantagem)',
      state.combatants.find((item: any) => item.id === meleeCombatant.id).turnEconomy
        .actionsUsed === actionsAfterMelee && outOfReach.data.result === undefined,
    );
    await place(targetCombatant.id, { xFeet: 5, yFeet: 0 });
    await refresh();

    // ===================================================================
    // V–W / Y–AA — ARMA À DISTÂNCIA: normal, longo, além do longo
    // ===================================================================
    check('89.AN.1) a vez passa para a arqueira', await advanceTo(archerCombatant.id));
    const ammoCount = async () => {
      const row = await prisma.character.findUniqueOrThrow({
        where: { id: archer.id },
        select: { inventory: true },
      });
      return ((row.inventory as any[]) ?? []).find((item) => item.id === arrowsId)?.quantity ?? 0;
    };
    const normalBody = {
      combatId: combat.id,
      ...operation(),
      attackerCombatantId: archerCombatant.id,
      targetCombatantId: farCombatant.id,
      attackId: rangedAttackId,
    };
    const normalRange = await request('POST', '/combat/attack', normalBody);
    state = normalRange.data.combat ?? state;
    check(
      '89.V.1) 150 pés = boundary do alcance NORMAL (arco 45 m): aceito sem desvantagem',
      normalRange.status === 200 &&
        normalRange.data.result?.range?.band === 'normal' &&
        normalRange.data.result?.range?.distanceFeet === 150 &&
        normalRange.data.result?.attackRolls?.length === 1 &&
        normalRange.data.result?.disadvantage === false,
      JSON.stringify({ status: normalRange.status, result: normalRange.data.result?.range }),
    );
    const ammoAfterNormal = await ammoCount();
    check(
      '89.Y.1) ataque à distância normal gasta 1 flecha',
      ammoAfterNormal === 9,
      JSON.stringify({ ammoAfterNormal }),
    );
    await place(farCombatant.id, { xFeet: 200, yFeet: 100 });
    await refresh();
    check('89.AN.2) novo turno da arqueira', await advanceTo(archerCombatant.id));
    const longBody = {
      combatId: combat.id,
      ...operation(),
      attackerCombatantId: archerCombatant.id,
      targetCombatantId: farCombatant.id,
      attackId: rangedAttackId,
    };
    const longRange = await request('POST', '/combat/attack', longBody);
    state = longRange.data.combat ?? state;
    check(
      '89.W.1) long range (200 pés, entre normal e longo) gera DESVANTAGEM real',
      longRange.status === 200 &&
        longRange.data.result?.range?.band === 'long' &&
        longRange.data.result?.disadvantage === true &&
        longRange.data.result?.attackRolls?.length === 2,
      JSON.stringify({ status: longRange.status, range: longRange.data.result?.range }),
    );
    const actionsAfterLong = state.combatants.find((item: any) => item.id === archerCombatant.id)
      .turnEconomy.actionsUsed;
    const ammoAfterLong = await ammoCount();
    const retried = await request('POST', '/combat/attack', longBody);
    check(
      '89.AP.1) retry do MESMO operationId devolve o MESMO snapshot sem gastar de novo',
      retried.status === 200 &&
        retried.data.result?.attackRoll === longRange.data.result?.attackRoll &&
        retried.data.result?.damageRolled === longRange.data.result?.damageRolled &&
        (await ammoCount()) === ammoAfterLong &&
        state.combatants.find((item: any) => item.id === archerCombatant.id).turnEconomy
          .actionsUsed === actionsAfterLong,
      JSON.stringify({ status: retried.status, result: retried.data.result?.attackRoll }),
    );
    check('89.AP.2) long range gastou exatamente 1 flecha', ammoAfterLong === 8);
    await place(farCombatant.id, { xFeet: 700, yFeet: 100 });
    await refresh();
    check(
      '89.AN.3) novo turno da arqueira para o teste além do longo',
      await advanceTo(archerCombatant.id),
    );
    const ammoBeforeOut = await ammoCount();
    const beyondLong = await request('POST', '/combat/attack', {
      combatId: combat.id,
      ...operation(),
      attackerCombatantId: archerCombatant.id,
      targetCombatantId: farCombatant.id,
      attackId: rangedAttackId,
    });
    check(
      '89.X.1) além do long range (700 pés > 600) → 409 TARGET_OUT_OF_RANGE',
      beyondLong.status === 409 && beyondLong.data.error === 'TARGET_OUT_OF_RANGE',
      JSON.stringify({ status: beyondLong.status, data: beyondLong.data }),
    );
    state = (await request('GET', '/combat/active')).data.combat;
    check(
      '89.Y.2) além do alcance NÃO gasta munição',
      (await ammoCount()) === ammoBeforeOut && ammoBeforeOut === 8,
      JSON.stringify({ before: ammoBeforeOut, after: await ammoCount() }),
    );
    check(
      '89.AA.1) além do alcance NÃO rola d20 nem gasta Ação',
      beyondLong.data.result === undefined &&
        state.combatants.find((item: any) => item.id === archerCombatant.id).turnEconomy
          .actionsUsed === 0,
    );

    // ===================================================================
    // AS–AT / AQ — REPOSICIONAMENTO, SEM CACHE E PRIVACIDADE
    // ===================================================================
    await place(farCombatant.id, { xFeet: 150, yFeet: 100 });
    await refresh();
    check(
      '89.AQ.1) reposicionamento muda a leitura seguinte (nenhum cache de distância)',
      (await distanceRead(archerCombatant.id, farCombatant.id)).data.distance.distanceFeet === 150,
    );
    const playerToCreature = await distanceRead(meleeCombatant.id, hiddenCombatant.id, playerToken);
    check(
      '89.AR.1) PLAYER NÃO consulta distância até criatura/NPC (unknown, sem oráculo)',
      playerToCreature.status === 200 &&
        playerToCreature.data.distance.status === 'unknown' &&
        playerToCreature.data.distance.reason === 'not-visible',
      JSON.stringify(playerToCreature.data),
    );
    check(
      '89.AS.1) a resposta privada não vaza distância nem coordenada',
      playerToCreature.data.distance.distanceFeet === null &&
        !('position' in playerToCreature.data.distance) &&
        !('xFeet' in playerToCreature.data.distance),
    );
    const playerToCharacter = await distanceRead(
      meleeCombatant.id,
      archerCombatant.id,
      playerToken,
    );
    check(
      '89.AT.1) PLAYER recebe a distância correta entre PERSONAGENS',
      playerToCharacter.data.distance.status === 'known' &&
        playerToCharacter.data.distance.distanceFeet === 100,
    );

    // ===================================================================
    // AB–AK — ALCANCE DE MAGIA (provider real + validação de produção)
    // ===================================================================
    const casterEntity = await loadEntity({ kind: 'combatant', id: meleeCombatant.id }, prisma);
    const sacred = spellExecutionDefinition(SACRED_FLAME_SPELL_ID)!;
    const sacredTargeting = sacred.targeting.kind === 'creatures' ? sacred.targeting : null;
    /** Índice espacial a partir do DTO atual (opcionalmente com UMA posição trocada). */
    const makeIndex = (override?: { id: string; position: { xFeet: number; yFeet: number } }) =>
      combatSpatialIndex({
        id: combat.id,
        version: 1,
        status: 'ACTIVE',
        round: 1,
        currentIndex: 0,
        createdAt: new Date(),
        endedAt: null,
        locality: null,
        economyLog: [],
        spatialConfig: state.spatial,
        combatants: (state.combatants as any[]).map((item) => ({
          ...item,
          character: null,
          creature: null,
          effectModifiers: undefined,
          spatialPosition:
            override && item.id === override.id
              ? override.position
              : (item.spatial?.position ?? null),
          baseSize: item.spatial?.baseSize ?? 'medium',
        })),
      } as unknown as CombatSourced);
    const targetEntity = await loadEntity({ kind: 'combatant', id: farCombatant.id }, prisma);
    const atDistance = (feet: number) =>
      makeIndex({ id: farCombatant.id, position: { xFeet: feet, yFeet: 0 } });
    check(
      '89.AB.1) Chama Sagrada (60 pés) exatamente no boundary → PASS (inclusive)',
      gridSpatialProvider(atDistance(60)).evaluateRange(
        casterEntity.entity,
        targetEntity.entity,
        60,
      ) === 'pass',
    );
    const at65 = atDistance(65);
    check(
      '89.AC.1) 65 pés > 60 → FAIL autoritativo (mesmo provider do pipeline)',
      gridSpatialProvider(at65).evaluateRange(casterEntity.entity, targetEntity.entity, 60) ===
        'fail',
    );
    const castsBefore = await prisma.spellCast.count({ where: { combatId: combat.id } });
    const pendingsBefore = await prisma.pendingEffectSave.count({
      where: { targetEntityId: farCombatant.id },
    });
    let sacredRejected = '';
    try {
      await validateTargeting({
        db: prisma,
        targeting: sacredTargeting!,
        caster: casterEntity,
        targets: [targetEntity],
        castAtLevel: 0,
        provider: gridSpatialProvider(at65),
      });
    } catch (error) {
      sacredRejected = (error as { code?: string }).code ?? 'unknown';
    }
    check(
      '89.AC.2) a validação de PRODUÇÃO recusa com SPELL_TARGET_OUT_OF_RANGE (antes do COMMIT)',
      sacredRejected === 'SPELL_TARGET_OUT_OF_RANGE' &&
        (await prisma.spellCast.count({ where: { combatId: combat.id } })) === castsBefore &&
        (await prisma.pendingEffectSave.count({ where: { targetEntityId: farCombatant.id } })) ===
          pendingsBefore,
      sacredRejected,
    );
    check(
      '89.AD.1) Palavra Curativa declara 60 pés (mesmo limite validado)',
      spellExecutionDefinition(HEALING_WORD_SPELL_ID)?.targeting.kind === 'creatures' &&
        (spellExecutionDefinition(HEALING_WORD_SPELL_ID)!.targeting as any).range.feet === 60,
    );
    check(
      '89.AF.1) Imobilizar Pessoa declara 60 pés e continua save de Sabedoria',
      (spellExecutionDefinition(HOLD_PERSON_SPELL_ID)!.targeting as any).range.feet === 60 &&
        spellExecutionDefinition(HOLD_PERSON_SPELL_ID)!.resolution.kind === 'save-effect',
    );
    const blessDistance = evaluateEntityRange(
      makeIndex(),
      { kind: 'combatant', id: meleeCombatant.id },
      { kind: 'combatant', id: archerCombatant.id },
      { normalRangeFeet: 30 },
    );
    check(
      '89.AH.1) Bless (30 pés) usa a MESMA avaliação: 100 pés → out-of-range',
      (spellExecutionDefinition(BLESS_SPELL_ID)!.targeting as any).range.feet === 30 &&
        blessDistance.status === 'out-of-range',
      JSON.stringify(blessDistance),
    );
    const freshIndex = await spatialIndexNow();
    const spellAttackRange = evaluateEntityRange(
      freshIndex,
      { kind: 'combatant', id: archerCombatant.id },
      { kind: 'combatant', id: farCombatant.id },
      { normalRangeFeet: 120 },
    );
    check(
      '89.AI.1) ataque mágico com alcance conhecido valida a distância antes do d20',
      spellAttackRange.status === 'out-of-range' && spellAttackRange.distanceFeet === 150,
      JSON.stringify(spellAttackRange),
    );
    const assignmentDistance = (combatantId: string): number | null => {
      const evaluation = evaluateEntityDistance(
        freshIndex,
        { kind: 'combatant', id: archerCombatant.id },
        { kind: 'combatant', id: combatantId },
      );
      return evaluation.status === 'known' ? evaluation.distanceFeet : null;
    };
    check(
      '89.AJ.1) assignments são avaliados como CONJUNTO antes do COMMIT (nenhum gasto parcial)',
      assignmentDistance(farCombatant.id) === 150 &&
        assignmentDistance(targetCombatant.id) === 100,
    );
    const areaProvider = gridAreaSpatialProvider(freshIndex);
    const areaNear = areaProvider.evaluateOriginRange(casterEntity.entity, targetEntity.entity, {
      kind: 'point',
      rangeFeet: 200,
      requiresSight: false,
    });
    const areaFar = areaProvider.evaluateOriginRange(casterEntity.entity, targetEntity.entity, {
      kind: 'point',
      rangeFeet: 10,
      requiresSight: false,
    });
    check(
      '89.AK.1) área: alcance até a ORIGEM resolvida (aqui 150: 200 passa, 10 falha)',
      areaNear === 'pass' && areaFar === 'fail',
    );
    check(
      '89.AK.2) membership geométrica de área continua UNKNOWN (6.6L.6)',
      areaProvider.evaluateMembership({
        origin: casterEntity.entity,
        target: targetEntity.entity,
        shape: { kind: 'sphere', radiusFeet: 200 },
        includeOrigin: true,
      }) === 'unknown',
    );

    // ===================================================================
    // BACKWARD COMPATIBILITY — assisted continua UNKNOWN
    // ===================================================================
    const toAssisted = await request('PATCH', `/combat/${combat.id}/spatial-config`, {
      mode: 'assisted',
      ...operation(),
    });
    state = toAssisted.data.combat ?? state;
    const assistedRead = await distanceRead(meleeCombatant.id, targetCombatant.id);
    check(
      '89.AT.2) cena assistida → `not-assessed` (nunca FAIL) e posições preservadas',
      toAssisted.status === 200 &&
        assistedRead.data.distance.status === 'not-assessed' &&
        assistedRead.data.distance.reason === 'assisted-mode' &&
        state.combatants.find((item: any) => item.id === targetCombatant.id).spatial.position
          .xFeet === 5,
    );
    check(
      '89.AU.1) nenhuma matriz de distância entra no DTO e nenhum Movement/LoS/AoE existe',
      !('distances' in state) &&
        !('distanceMatrix' in state) &&
        !('movementRemaining' in state) &&
        !('lineOfSight' in state) &&
        !('areaOfEffect' in state),
    );

    // ===================================================================
    // AV–BE — RANGE PREVIEW READ-ONLY (6.6M.2)
    // ===================================================================
    // A UI mede com `GET /spatial/distance` e pede a faixa de alcance a
    // `GET /spatial/range-preview`, mandando só IDs. O servidor resolve a AÇÃO
    // (ataque/arma), o reach e os alcances — e nada é gasto.
    await (async () => {
      const backToGrid = await request('PATCH', `/combat/${combat.id}/spatial-config`, {
        mode: 'grid-2d',
        widthFeet: 800,
        heightFeet: 800,
        ...operation(),
      });
      if (backToGrid.data.combat) state = backToGrid.data.combat;
      await place(meleeCombatant.id, { xFeet: 0, yFeet: 0 });
      await place(targetCombatant.id, { xFeet: 5, yFeet: 0 });
      await place(farCombatant.id, { xFeet: 200, yFeet: 100 });
      await place(hiddenCombatant.id, { xFeet: 10, yFeet: 0 });
      await refresh();

      const previewOf = (from: string, to: string, attackId: string, auth = masterToken) =>
        request(
          'GET',
          `/combat/${combat.id}/spatial/range-preview?fromCombatantId=${from}&toCombatantId=${to}` +
            `&attackId=${encodeURIComponent(attackId)}`,
          undefined,
          auth,
        );

      const inReach = await previewOf(meleeCombatant.id, targetCombatant.id, meleeAttackId);
      check(
        '89.AV.1) range-preview melee adjacente → in-range com reach do servidor e nome da ação',
        inReach.status === 200 &&
          inReach.data.range.status === 'in-range' &&
          inReach.data.range.distanceFeet === 5 &&
          inReach.data.range.reachFeet === 5 &&
          typeof inReach.data.range.actionName === 'string' &&
          inReach.data.range.actionName.length > 0,
        JSON.stringify(inReach.data),
      );
      const outOfReach = await previewOf(meleeCombatant.id, farCombatant.id, meleeAttackId);
      check(
        '89.AW.1) melee fora do reach → out-of-range (mesma conta do ataque)',
        outOfReach.data.range.status === 'out-of-range' &&
          outOfReach.data.range.band === 'out' &&
          outOfReach.data.range.distanceFeet === 200,
        JSON.stringify(outOfReach.data),
      );
      const longRangePreview = await previewOf(archerCombatant.id, farCombatant.id, rangedAttackId);
      check(
        '89.AX.1) arco a 200 pés → long-range (normal 150 / longo 600 do dado estruturado)',
        longRangePreview.data.range.status === 'long-range' &&
          longRangePreview.data.range.band === 'long' &&
          longRangePreview.data.range.normalRangeFeet === 150 &&
          longRangePreview.data.range.longRangeFeet === 600,
        JSON.stringify(longRangePreview.data),
      );
      await place(farCombatant.id, { xFeet: 700, yFeet: 100 });
      await refresh();
      const beyondPreview = await previewOf(archerCombatant.id, farCombatant.id, rangedAttackId);
      check(
        '89.AY.1) arco além do longo → out-of-range (nunca aparece como válido)',
        beyondPreview.data.range.status === 'out-of-range' &&
          beyondPreview.data.range.distanceFeet === 700,
        JSON.stringify(beyondPreview.data),
      );
      await place(farCombatant.id, { xFeet: 200, yFeet: 100 });
      await refresh();

      const invalidAction = await previewOf(meleeCombatant.id, targetCombatant.id, 'weapon:nao-existe');
      check(
        '89.AZ.1) referência de ação inexistente → 404 ATTACK_NOT_FOUND (sem distância)',
        invalidAction.status === 404 &&
          invalidAction.data.error === 'ATTACK_NOT_FOUND' &&
          invalidAction.data.range === undefined,
        JSON.stringify({ status: invalidAction.status, data: invalidAction.data }),
      );
      const overrideAttempt = await request(
        'GET',
        `/combat/${combat.id}/spatial/range-preview?fromCombatantId=${meleeCombatant.id}` +
          `&toCombatantId=${farCombatant.id}&attackId=${encodeURIComponent(meleeAttackId)}` +
          '&normalRangeFeet=9999&longRangeFeet=9999&reachFeet=9999&distanceFeet=5&band=normal',
      );
      check(
        '89.BA.1) números enviados pelo cliente são IGNORADOS (servidor resolve alcance/distância)',
        overrideAttempt.data.range.status === 'out-of-range' &&
          overrideAttempt.data.range.distanceFeet !== 5 &&
          overrideAttempt.data.range.reachFeet === 5,
        JSON.stringify(overrideAttempt.data),
      );
      const unarmedPreview = await previewOf(meleeCombatant.id, targetCombatant.id, 'unarmed');
      check(
        '89.BB.1) ação sem alcance estruturado → unknown/range-not-declared (não inventa 5 pés)',
        unarmedPreview.data.range.status === 'unknown' &&
          unarmedPreview.data.range.reason === 'range-not-declared' &&
          unarmedPreview.data.range.reachFeet === null,
        JSON.stringify(unarmedPreview.data),
      );
      const playerToCreature = await previewOf(
        meleeCombatant.id,
        hiddenCombatant.id,
        meleeAttackId,
        playerToken,
      );
      check(
        '89.BC.1) PLAYER não descobre alvo oculto pelo range-preview (unknown/not-visible)',
        playerToCreature.data.range.status === 'unknown' &&
          playerToCreature.data.range.reason === 'not-visible' &&
          playerToCreature.data.range.distanceFeet === null &&
          playerToCreature.data.range.actionName === null &&
          playerToCreature.data.range.normalRangeFeet === null &&
          playerToCreature.data.range.longRangeFeet === null,
        JSON.stringify(playerToCreature.data),
      );
      const playerToCharacter = await previewOf(
        archerCombatant.id,
        meleeCombatant.id,
        rangedAttackId,
        playerToken,
      );
      check(
        '89.BD.1) PLAYER recebe a faixa correta entre PERSONAGENS (100 pés → in-range)',
        playerToCharacter.data.range.status === 'in-range' &&
          playerToCharacter.data.range.distanceFeet === 100 &&
          playerToCharacter.data.range.band === 'normal',
        JSON.stringify(playerToCharacter.data),
      );

      // Leitura PURA: nenhuma versão, Ação ou munição muda.
      await refresh();
      const versionBefore = state.version;
      const ammoBeforePreview = await ammoCount();
      const actionsBeforePreview = state.combatants.find(
        (item: any) => item.id === archerCombatant.id,
      ).turnEconomy.actionsUsed;
      await previewOf(archerCombatant.id, farCombatant.id, rangedAttackId);
      await previewOf(archerCombatant.id, farCombatant.id, rangedAttackId);
      await refresh();
      check(
        '89.BE.1) range-preview é READ-ONLY: versão, Ação e munição intactas',
        state.version === versionBefore &&
          (await ammoCount()) === ammoBeforePreview &&
          state.combatants.find((item: any) => item.id === archerCombatant.id).turnEconomy
            .actionsUsed === actionsBeforePreview,
        JSON.stringify({ before: versionBefore, after: state.version }),
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
