import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { movementBlockedByWalls } from '../modules/combat/spatial/movement-walls.js';
import type { SpatialSize } from '../modules/combat/spatial/spatial.types.js';

/** Regressão do traçado em lote e colisão real; somente fixtures próprias em schema de smoke. */
export async function smokeWallMovement(base: string, check: (label: string, ok: boolean, detail?: string) => void) {
  const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '';
  if (!/^smoke_[a-z0-9_]+$/.test(schema)) throw new Error('Este smoke exige schema smoke_<nome> explícito.');
  const point = (xFeet: number, yFeet: number) => ({ xFeet, yFeet });
  const wall = (x1: number, y1: number, x2: number, y2: number, blocksMovement = true) => ({
    start: point(x1, y1), end: point(x2, y2), blocksMovement, blocksSight: true,
  });
  for (const [size, width] of [['tiny', 2.5], ['small', 5], ['medium', 5], ['large', 10], ['huge', 15], ['gargantuan', 20]] as [SpatialSize, number][]) {
    check(`WM1.${size}) parede bloqueia o footprint inteiro`, movementBlockedByWalls(point(0, 0), point(5, 0), size, [wall(width + 1, 0, width + 1, 1)]));
    check(`WM2.${size}) pode encostar e andar paralelo`, !movementBlockedByWalls(point(0, 0), point(0, 5), size, [wall(width, 0, width, 50)]));
  }
  check('WM3) diagonal não atravessa canto de parede', movementBlockedByWalls(point(0, 0), point(5, 5), 'medium', [wall(5, 0, 5, 5)]));
  check('WM4) usa varredura real, não retângulo maior que prende a diagonal', !movementBlockedByWalls(point(0, 0), point(5, 5), 'medium', [wall(0, 8, 1, 9)]));
  check('WM5) parede só de visão não impede movimento', !movementBlockedByWalls(point(0, 0), point(5, 0), 'medium', [wall(5, 0, 5, 20, false)]));
  check('WM6) pode afastar-se de parede adjacente', !movementBlockedByWalls(point(5, 5), point(0, 5), 'medium', [wall(10, 0, 10, 20)]));
  check('WM7) parede curta no flanco bloqueia Large mesmo sem cruzar trajetória do centro', movementBlockedByWalls(point(0, 0), point(5, 0), 'large', [wall(12, 0, 12, 2)]));
  check('WM8) parede diagonal é sólida', movementBlockedByWalls(point(0, 0), point(5, 0), 'medium', [wall(6, 0, 9, 5)]));

  const suffix = randomUUID().slice(0, 8);
  const users: string[] = [];
  let regionId: string | undefined, sceneId: string | undefined, localityId: string | undefined;
  let creatureId: string | undefined, combatId: string | undefined;
  try {
    const master = await prisma.user.create({ data: { username: `wm_m_${suffix}`, displayName: 'Mestre Parede', passwordHash: 'fixture', role: 'MASTER' } }); users.push(master.id);
    const player = await prisma.user.create({ data: { username: `wm_p_${suffix}`, displayName: 'Jogador Parede', passwordHash: 'fixture', role: 'PLAYER' } }); users.push(player.id);
    const hero = await prisma.character.create({ data: { userId: player.id, name: 'Herói Parede', speed: 9, hpMax: 30, hpCurrent: 30, raceId: 'human' } });
    const token = (user: typeof master) => signToken({ sub: user.id, username: user.username, displayName: user.displayName, role: user.role });
    const masterToken = token(master), playerToken = token(player);
    async function http(path: string, method = 'GET', body?: unknown, auth = masterToken) {
      const res = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json() as any };
    }
    const sentinel = await http('/characters/me', 'GET', undefined, playerToken);
    if (sentinel.data.character?.id !== hero.id) throw new Error('Servidor não compartilha o schema de teste.');
    const region = await prisma.region.create({ data: { name: `Região WM ${suffix}` } }); regionId = region.id;
    const locality = await prisma.locality.create({ data: { name: 'Local WM', regionId } }); localityId = locality.id;
    let scene = await prisma.scene.create({ data: { name: 'Mapa WM', localityId, spatialConfig: { mode: 'grid-2d', widthFeet: 80, heightFeet: 80, cellSizeFeet: 5 } }, include: { obstacles: true } }); sceneId = scene.id;
    const batchPath = `/scenes/${sceneId}/spatial/obstacles/batch`;
    const walls = [wall(10, 0, 10, 20), wall(10, 30, 10, 40, false), wall(12, 50, 12, 52)];
    const batch = { expectedVersion: scene.version, operationId: randomUUID(), walls };
    const created = await http(batchPath, 'POST', batch);
    check('WM9) um traçado salva todos os segmentos e incrementa a versão uma vez', created.status === 200 && created.data.scene.obstacles.length === 3 && created.data.scene.version === scene.version + 1);
    const replay = await http(batchPath, 'POST', batch);
    check('WM10) repetir traçado não duplica paredes', replay.status === 200 && isDeepStrictEqual(replay.data, created.data) && await prisma.spatialObstacle.count({ where: { sceneId } }) === 3, JSON.stringify({ status: replay.status, version: replay.data.scene?.version, ids: replay.data.scene?.obstacles?.map((wall: any) => wall.id) }));
    const reused = await http(batchPath, 'POST', { ...batch, walls: [wall(5, 0, 5, 10)] });
    check('WM11) mesma intenção com traçado diferente é recusada', reused.status === 409 && reused.data.error === 'IDEMPOTENCY_KEY_REUSED');
    scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId }, include: { obstacles: true } });
    const invalid = await http(batchPath, 'POST', { expectedVersion: scene.version, operationId: randomUUID(), walls: [wall(60, 0, 60, 10), wall(5, 5, 5, 5)] });
    const unchanged = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId }, include: { obstacles: true } });
    check('WM12) segmento inválido recusa lote inteiro sem consumo de versão nem criação parcial', invalid.status === 400 && unchanged.version === scene.version && unchanged.obstacles.length === 3);
    const denied = await http(batchPath, 'POST', { expectedVersion: scene.version, operationId: randomUUID(), walls }, playerToken);
    check('WM13) jogador não administra traçados', denied.status === 403);
    const npc = await prisma.creature.create({ data: { name: 'Grande Parede', kind: 'CREATURE', size: 'Large', speed: 9, hpMax: 30, hpCurrent: 30 } }); creatureId = npc.id;
    const combat = await prisma.combat.create({ data: { status: 'ACTIVE', round: 1, turnSequence: 1, sceneId, localityId,
      combatants: { create: [
        { kind: 'CHARACTER', characterId: hero.id, ownerUserId: player.id, name: hero.name, initiative: 20, dexterityMod: 0, spatialPosition: point(0, 5), turnEconomy: onTurnStart(9) },
        { kind: 'CREATURE', creatureId, name: npc.name, hpMax: 30, hpCurrent: 30, armorClass: 10, initiative: 10, dexterityMod: 0, spatialPosition: point(0, 50), turnEconomy: onTurnStart(9) },
      ] } }, include: { combatants: true } }); combatId = combat.id;
    const heroId = combat.combatants.find(c => c.characterId === hero.id)!.id;
    const npcId = combat.combatants.find(c => c.creatureId === creatureId)!.id;
    let state = (await http('/combat/active')).data.combat;
    const movement = (path: { xFeet: number; yFeet: number }[], id = heroId, auth = playerToken) => ({ combatantId: id, path, expectedVersion: state.version, operationId: randomUUID(), auth });
    async function move(input: ReturnType<typeof movement>) {
      const { auth, ...body } = input;
      const res = await http(`/combat/${combatId}/spatial/movement`, 'POST', body, auth);
      if (res.data.combat) state = res.data.combat;
      return res;
    }
    const prefix = await move(movement([point(5, 5)]));
    check('WM14) token pode parar junto à parede sem atravessar', prefix.status === 200 && prefix.data.movement.movementRemainingAfterFeet === 25);
    const before = await prisma.combatant.findUniqueOrThrow({ where: { id: heroId } });
    const beforeVersion = state.version;
    const preview = await http(`/combat/${combatId}/spatial/movement-preview`, 'POST', { combatantId: heroId, path: [point(10, 5)] }, playerToken);
    const blocked = await move(movement([point(10, 5)]));
    const after = await prisma.combatant.findUniqueOrThrow({ where: { id: heroId } });
    const persistedCombat = await prisma.combat.findUniqueOrThrow({ where: { id: combatId } });
    check('WM15) preview e commit recusam atravessar a parede', preview.data.movement?.blocker?.code === 'MOVEMENT_WALL_BLOCKED' && blocked.status === 409 && blocked.data.error === 'MOVEMENT_WALL_BLOCKED');
    check('WM16) recusa não muda posição, gasto ou versão', JSON.stringify(before.spatialPosition) === JSON.stringify(after.spatialPosition) && JSON.stringify(before.turnEconomy) === JSON.stringify(after.turnEconomy) && persistedCombat.version === beforeVersion);
    const parallel = await move(movement([point(5, 10)]));
    check('WM17) mover paralelo à parede não prende o personagem', parallel.status === 200);
    // Só resets de fixtures próprias; APIs de movimento continuam autoritativas.
    await prisma.combatant.update({ where: { id: heroId }, data: { spatialPosition: point(0, 5), turnEconomy: onTurnStart(9) } });
    const fullBlock = await move(movement([point(5, 5), point(10, 5)]));
    const fullPosition = await prisma.combatant.findUniqueOrThrow({ where: { id: heroId } });
    check('WM18) parede no segundo passo rejeita o caminho inteiro, sem mover o prefixo', fullBlock.status === 409 && (fullPosition.spatialPosition as any).xFeet === 0 && (fullPosition.turnEconomy as any).movementUsed === 0);
    await prisma.combatant.update({ where: { id: heroId }, data: { spatialPosition: point(5, 30), turnEconomy: onTurnStart(9) } });
    const passable = await move(movement([point(10, 30)]));
    check('WM19) flag só de visão permite atravessar', passable.status === 200);
    await prisma.combat.update({ where: { id: combatId }, data: { currentIndex: 1 } });
    state = (await http('/combat/active')).data.combat;
    const large = await move(movement([point(5, 50)], npcId, masterToken));
    check('WM20) Mestre também respeita parede no movimento de NPC Large pelo flanco', large.status === 409 && large.data.error === 'MOVEMENT_WALL_BLOCKED');
    const locked = await http(batchPath, 'POST', { expectedVersion: scene.version, operationId: randomUUID(), walls: [wall(60, 0, 60, 10)] });
    check('WM21) cena em combate não aceita novos traçados', locked.status === 409 && locked.data.error === 'SCENE_IN_USE');
  } finally {
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    if (sceneId) { await prisma.sceneOperation.deleteMany({ where: { sceneId } }); await prisma.scene.deleteMany({ where: { id: sceneId } }); }
    if (localityId) await prisma.locality.deleteMany({ where: { id: localityId } });
    if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });
    if (creatureId) await prisma.creature.deleteMany({ where: { id: creatureId } });
    await prisma.character.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
}
