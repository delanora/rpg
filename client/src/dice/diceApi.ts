import { api } from '../api';
import type {
  AbilityKey,
  DiceRollDto,
  EffectOptionalModifierDto,
  MechanicalEntity,
  TableRollActivePayload,
  TableRollActiveRequest,
  TableRollRequest,
} from '../types';

/** Rola o pool da janela de dados (livre, perícia ou salvaguarda). */
export async function rollTableDice(request: TableRollRequest): Promise<DiceRollDto> {
  const { roll } = await api<{ roll: DiceRollDto }>('/api/dice/roll', {
    method: 'POST',
    body: request,
  });
  return roll;
}

/**
 * OPÇÕES OPCIONAIS de efeito para uma rolagem (6.5G).
 *
 * O servidor deriva dos efeitos ATIVOS do alvo; a bandeja só mostra o que ele
 * oferece. O cliente nunca monta um modificador sozinho.
 */
export function fetchEffectOptions(
  entity: MechanicalEntity,
  roll: 'attack' | 'save' | 'check',
  ability?: AbilityKey,
): Promise<EffectOptionalModifierDto[]> {
  const query = new URLSearchParams({ roll, ...(ability ? { ability } : {}) });
  return api<{ options: EffectOptionalModifierDto[] }>(
    `/api/dice/options/${entity.kind}/${entity.id}?${query.toString()}`,
  ).then((result) => result.options);
}

/**
 * Avisa a mesa que a janela de dados abriu (ou fechou).
 *
 * Quem recebe vê a faixa "está realizando um teste" no topo do tabuleiro. A
 * rolagem privada do mestre não é divulgada.
 */
export async function announceActiveRoll(
  request: TableRollActiveRequest,
): Promise<TableRollActivePayload | null> {
  const { activeRoll } = await api<{ activeRoll: TableRollActivePayload | null }>(
    '/api/dice/active',
    { method: 'POST', body: request },
  );
  return activeRoll;
}

/** Quem está com a janela de dados aberta agora (ou `null`). */
export async function fetchActiveRoll(): Promise<TableRollActivePayload | null> {
  const { activeRoll } = await api<{ activeRoll: TableRollActivePayload | null }>(
    '/api/dice/active',
  );
  return activeRoll;
}

/** Histórico da sessão — exclusivo do mestre. */
export async function fetchDiceHistory(): Promise<DiceRollDto[]> {
  const { rolls } = await api<{ rolls: DiceRollDto[] }>('/api/dice/history');
  return rolls;
}

/** Zera o histórico da sessão — exclusivo do mestre. */
export async function clearDiceHistory(): Promise<void> {
  await api('/api/dice/history', { method: 'DELETE' });
}
