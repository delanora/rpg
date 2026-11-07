import { api } from './api';
import { newId } from './utils';
import type { Character, HotbarSlotRef } from './types';

/** Resposta de `PUT /api/characters/me/hotbar`. */
export interface SaveHotbarResponse {
  /** Configuração CONFIRMADA pelo servidor (48 posições). */
  hotbar: { slots: (HotbarSlotRef | null)[] };
  /** Versão da ficha depois da escrita (próximo `expectedVersion`). */
  version: number;
  character: Character;
  /** `true` quando o servidor só devolveu o resultado de um reenvio. */
  replayed: boolean;
}

/**
 * PERSONALIZAÇÃO DA HOTBAR (6.6M.6.3.1) — salva as 48 posições.
 *
 * Manda só REFERÊNCIAS (`kind` + `sourceId`), a versão da ficha em mãos e a
 * chave de idempotência. `expectedVersion` faz uma segunda aba receber 409 em
 * vez de sobrescrever; `operationId` garante que um reenvio (rede instável) não
 * aplique duas vezes. Nenhum ataque é executado por esta rota.
 */
export async function saveHotbarLayout(
  slots: readonly (HotbarSlotRef | null)[],
  expectedVersion: number,
): Promise<SaveHotbarResponse> {
  return api<SaveHotbarResponse>('/api/characters/me/hotbar', {
    method: 'PUT',
    body: { slots, expectedVersion, operationId: newId() },
  });
}
