import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { ServerEvents, type CombatPingPayload } from '../realtime/events.js';

/** Somente fixtures próprias em banco isolado; HTTP + Socket.io reais. */
export async function smokeCombatPing(base: string) {
  const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '';
  if (!/^smoke_[a-z0-9_]+$/.test(schema)) throw Error('Este smoke exige schema smoke_<nome>.');
  const users: string[] = [], sockets: Socket[] = [];
  let combatId: string | undefined;
  let checks = 0;
  const check = (label: string, ok: unknown) => { assert.ok(ok, label); checks++; console.log(`✔ ${label}`); };
  try {
    const suffix = randomUUID().slice(0, 8);
    const actors = await Promise.all(['MASTER', 'PLAYER', 'PLAYER'].map((role, i) => prisma.user.create({
      data: { username: `ping_${i}_${suffix}`, displayName: `Autor ${i}`, role: role as 'MASTER' | 'PLAYER', passwordHash: 'fixture' },
    })));
    actors.forEach(user => users.push(user.id));
    const tokens = actors.map(user => signToken({ sub: user.id, username: user.username, displayName: 'Nome antigo no token', role: user.role }));
    const hero = await prisma.character.create({ data: { userId: users[1]!, name: 'Sentinela Ping', raceId: 'human', hpMax: 10, hpCurrent: 10 } });
    async function http(path: string, body?: unknown, token = tokens[0]) {
      const res = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json() as any };
    }
    const sentinel = await http('/characters/me', undefined, tokens[1]);
    if (sentinel.data.character?.id !== hero.id) throw Error('Servidor não compartilha o banco isolado.');
    const combat = await prisma.combat.create({ data: { status: 'ACTIVE', spatialConfig: {
      mode: 'grid-2d', widthFeet: 40, heightFeet: 40, cellSizeFeet: 5 }, combatants: { create: {
        kind: 'CHARACTER', characterId: hero.id, ownerUserId: users[1], name: hero.name,
        dexterityMod: 0, initiative: 10, spatialPosition: { xFeet: 0, yFeet: 0 },
      } } }, include: { combatants: true } }); combatId = combat.id;
    const received: CombatPingPayload[][] = [[], [], []];
    await Promise.all(tokens.map((token, i) => new Promise<void>((resolve, reject) => {
      const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false, autoConnect: false });
      sockets.push(socket);
      const timer = setTimeout(() => reject(Error('Conexão realtime demorou.')), 5000);
      socket.on(ServerEvents.COMBAT_PING, payload => received[i]!.push(payload));
      socket.on(ServerEvents.CONNECTION_READY, () => { clearTimeout(timer); resolve(); });
      socket.on('connect_error', reject); socket.connect();
    })));
    const before = JSON.stringify(await prisma.combat.findUnique({ where: { id: combatId }, include: { combatants: true } }));
    const path = `/combat/${combatId}/spatial/ping`;
    const body = { position: { xFeet: 12.5, yFeet: 18.25 } };
    for (const i of [0, 1, 2]) {
      const response = await http(path, body, tokens[i]);
      check(`mestre/jogador ${i} pode marcar sem exigir turno`, response.status === 200);
      await new Promise(resolve => setTimeout(resolve, 70));
      check(`todos recebem a mesma marca de ${i}`, received.every(events => JSON.stringify(events.at(-1)) === JSON.stringify(response.data)));
      check(`autor ${i} vem da conta atual e duração é de três segundos`, response.data.authorName === actors[i]!.displayName && response.data.authorId === actors[i]!.id && response.data.durationMs === 3000 && /^#[0-9a-f]{6}$/i.test(response.data.color));
    }
    check('ping preserva posição, PV, economia e versão', before === JSON.stringify(await prisma.combat.findUnique({ where: { id: combatId }, include: { combatants: true } })));
    const count = received[0]!.length;
    check('não autenticado é recusado', (await http(path, body, '')).status === 401);
    check('não aceita autor forjado', (await http(path, { ...body, authorName: 'Mestre Falso', color: '#fff' })).status === 400);
    check('não aceita posição negativa', (await http(path, { position: { xFeet: -1, yFeet: 0 } })).status === 400);
    check('não aceita ponto fora do mapa', (await http(path, { position: { xFeet: 41, yFeet: 0 } })).status === 400);
    check('não aceita coordenada não numérica', (await http(path, { position: { xFeet: null, yFeet: 0 } })).status === 400);
    await new Promise(resolve => setTimeout(resolve, 70));
    check('requisições inválidas não publicam marcas', received[0]!.length === count);
    await prisma.combat.update({ where: { id: combatId }, data: { status: 'PENDING_INITIATIVE' } });
    check('funciona durante preparação da iniciativa', (await http(path, body, tokens[1])).status === 200);
    await prisma.combat.update({ where: { id: combatId }, data: { spatialConfig: { mode: 'assisted', widthFeet: 40, heightFeet: 40, cellSizeFeet: 5 } } });
    check('modo assistido recusa ping', (await http(path, body, tokens[1])).status === 409);
    await prisma.combat.update({ where: { id: combatId }, data: { status: 'ENDED', spatialConfig: { mode: 'grid-2d', widthFeet: 40, heightFeet: 40, cellSizeFeet: 5 } } });
    check('combate encerrado recusa ping', (await http(path, body, tokens[1])).status === 409);
    await prisma.combat.update({ where: { id: combatId }, data: { status: 'ACTIVE' } });
    const repeat = await http(path, body, tokens[2]);
    check('cor do autor é estável', repeat.data.color === received[2]!.find(event => event.authorId === users[2])?.color);
    let limited = false;
    for (let i = 0; i < 13; i++) { if ((await http(path, body, tokens[2])).status === 429) { limited = true; break; } }
    check('limita rajadas por autor', limited);
    console.log(`${checks} verificações HTTP/realtime de ping aprovadas.`);
  } finally {
    sockets.forEach(socket => socket.close());
    if (combatId) await prisma.combat.delete({ where: { id: combatId } });
    await prisma.character.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
