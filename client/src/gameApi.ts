import { api } from './api';
import type { Compendium, GameConfig } from './types';

/**
 * Configuração global da mesa. Como as demais escritas do domínio, a alteração
 * passa por HTTP; o WebSocket apenas divulga o novo valor para todos.
 */

/** Configuração atual da mesa (usada ao abrir a ficha/painel). */
export async function fetchGameConfig(): Promise<GameConfig> {
  const { config } = await api<{ config: GameConfig }>('/api/game');
  return config;
}

/**
 * Libera UM Level Up para a mesa (somente mestre).
 *
 * Cada chamada é uma liberação nova: quem já subiu de nível fica de fora até o
 * próximo clique. Não existe mais bloquear — basta liberar de novo.
 */
export async function releaseLevelUp(): Promise<GameConfig> {
  const { config } = await api<{ config: GameConfig }>('/api/game/level-up', {
    method: 'POST',
  });
  return config;
}

/**
 * Listas de referência da mesa (classes, raças, antecedentes e magias).
 *
 * Alimenta a aba "Configurações da mesa". Somente leitura por enquanto.
 */
export async function fetchCompendium(): Promise<Compendium> {
  const { compendium } = await api<{ compendium: Compendium }>('/api/compendium');
  return compendium;
}

/**
 * Define o nível inicial da mesa (somente mestre).
 *
 * É o nível em que os personagens novos começam: o assistente de criação aplica
 * os níveis 2 até ele ao concluir a montagem.
 */
export async function setStartingLevel(level: number): Promise<GameConfig> {
  const { config } = await api<{ config: GameConfig }>('/api/game/starting-level', {
    method: 'POST',
    body: { level },
  });
  return config;
}
