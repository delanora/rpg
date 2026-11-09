import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { getBroadcaster } from '../../../realtime/hub.js';
import { ServerEvents, type CombatPingPayload } from '../../../realtime/events.js';
import { effectiveSceneConfigOf, type SpatialPosition2D } from './spatial.types.js';

const COLORS = ['#eab308', '#22d3ee', '#f472b6', '#a78bfa', '#4ade80', '#fb923c'];

/** O ping é apresentação: não persiste, não gasta recursos e não muda versões. */
export async function sendCombatPing(combatId: string, position: SpatialPosition2D,
  author: { sub: string }): Promise<CombatPingPayload> {
  const combat = await prisma.combat.findUnique({ where: { id: combatId },
    select: { status: true, spatialConfig: true, scene: { select: { spatialConfig: true } } } });
  if (!combat) throw new HttpError('Combate não encontrado.', 404, 'NOT_FOUND');
  const scene = effectiveSceneConfigOf(combat);
  if (combat.status === 'ENDED' || scene.mode !== 'grid-2d') {
    throw new HttpError('O ping exige um combate aberto com grid.', 409, 'COMBAT_PING_UNAVAILABLE');
  }
  if (position.xFeet > scene.widthFeet || position.yFeet > scene.heightFeet) {
    throw new HttpError('Marque um ponto dentro do tabuleiro.', 400, 'COMBAT_PING_OUTSIDE_SCENE');
  }
  // Identidade atual da ficha, nunca o nome enviado pelo cliente ou gravado no token.
  const account = await prisma.user.findUnique({ where: { id: author.sub },
    select: { role: true, character: { select: { name: true } } } });
  if (!account) throw new HttpError('Conta não encontrada.', 403, 'FORBIDDEN');
  const authorName = account.role === 'MASTER' ? 'Mestre' : account.character?.name.trim() || 'Jogador';
  const payload: CombatPingPayload = { id: randomUUID(), combatId, position,
    authorId: author.sub, authorName,
    color: COLORS[createHash('sha256').update(author.sub).digest().readUInt32BE(0) % COLORS.length]!,
    durationMs: 3000 };
  getBroadcaster().toTable(ServerEvents.COMBAT_PING, payload);
  return payload;
}
