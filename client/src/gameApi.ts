import { api } from './api';
import type { GameConfig } from './types';

/**
 * Configuração global da mesa. Como as demais escritas do domínio, a alteração
 * passa por HTTP; o WebSocket apenas divulga o novo valor para todos.
 */

/** Configuração atual da mesa (usada ao abrir a ficha/painel). */
export async function fetchGameConfig(): Promise<GameConfig> {
  const { config } = await api<{ config: GameConfig }>('/api/game');
  return config;
}

/** Libera/bloqueia o Level Up da mesa (somente mestre). */
export async function setLevelUpUnlocked(unlocked: boolean): Promise<GameConfig> {
  const { config } = await api<{ config: GameConfig }>('/api/game/level-up', {
    method: 'POST',
    body: { unlocked },
  });
  return config;
}
