import { api } from '../api';
import { declinePendingEffectSave, rollPendingEffectSave } from '../effectsApi';
import type { CombatResolutionCardDto, ResolutionRequestsPayload } from '../types';

/**
 * 6.6I — CARDS DE RESOLUÇÃO (leitura e ações).
 *
 * O servidor é o read-model: o cliente só PEDE os cards ativos e devolve a
 * INTENÇÃO de resolução. Atributo, CD, bônus, dados e resultado nunca saem
 * daqui — a rolagem continua no endpoint de dados já existente.
 */

export function fetchResolutionRequests(combatId: string): Promise<ResolutionRequestsPayload> {
  return api<ResolutionRequestsPayload>(`/api/combat/${combatId}/resolution-requests`);
}

/**
 * Resolve a salvaguarda de uma magia pelo MESMO pipeline de dados.
 *
 * `selected` são apenas os IDs dos modificadores opcionais oferecidos pelo
 * servidor (ex.: Bless +1d4) e `visibility` só existe para criatura/NPC.
 */
export function resolveSpellSaveCard(
  card: CombatResolutionCardDto,
  input: { selectedEffectModifiers?: string[]; visibility?: 'public' | 'private' } = {},
): Promise<void> {
  const pendingId = card.reference.pendingId;
  if (!pendingId) return Promise.reject(new Error('Card sem pendência de salvaguarda.'));
  return rollPendingEffectSave({
    pendingId,
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.selectedEffectModifiers?.length
      ? { selectedEffectModifiers: input.selectedEffectModifiers }
      : {}),
  });
}

/** Recusa de uma salvaguarda OPCIONAL de fim de turno (nunca em `initial`). */
export function declineSpellSaveCard(card: CombatResolutionCardDto): Promise<unknown> {
  const pendingId = card.reference.pendingId;
  if (!pendingId) return Promise.reject(new Error('Card sem pendência de salvaguarda.'));
  return declinePendingEffectSave(pendingId);
}
