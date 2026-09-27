import { api } from '../api';
import type { DiceRollDto, TableRollRequest } from '../types';

/** Rola o pool da janela de dados (livre, perícia ou salvaguarda). */
export async function rollTableDice(request: TableRollRequest): Promise<DiceRollDto> {
  const { roll } = await api<{ roll: DiceRollDto }>('/api/dice/roll', {
    method: 'POST',
    body: request,
  });
  return roll;
}

/** Histórico da sessão — exclusivo do mestre. */
export async function fetchDiceHistory(): Promise<DiceRollDto[]> {
  const { rolls } = await api<{ rolls: DiceRollDto[] }>('/api/dice/history');
  return rolls;
}
