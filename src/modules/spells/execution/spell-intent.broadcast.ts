import type { SpellCastIntent } from '@prisma/client';
import { toSpellCastIntentDto } from './spell-intent.service.js';

/**
 * Publicação da INTENÇÃO de conjuração (Fase 6.6F).
 *
 * Vai para os Mestres (fila de confirmação espacial) e para o ATOR do pedido —
 * nunca para a mesa toda. O DTO é sanitizado: sem fingerprint, sem versões
 * internas e sem repertório de NPC.
 *
 * A importação do broadcaster é DINÂMICA para não criar dependência circular
 * entre o domínio de conjuração e o hub de tempo real (o hub importa os eventos,
 * e os eventos importam o DTO da intenção).
 */
export async function publishSpellIntent(row: SpellCastIntent): Promise<void> {
  const { getBroadcaster } = await import('../../../realtime/hub.js');
  const broadcaster = getBroadcaster();
  if (!broadcaster) return;
  // 6.6J.3: os Mestres recebem as avaliações por candidato; o ator recebe a
  // visão sanitizada (sem lista de candidatos, que pode conter criatura oculta).
  broadcaster.toMasters('spells:intent-updated', {
    intent: toSpellCastIntentDto(row, 'master'),
  });
  broadcaster.toUser(row.actorUserId, 'spells:intent-updated', {
    intent: toSpellCastIntentDto(row, 'player'),
  });
}
