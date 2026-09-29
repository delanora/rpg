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
 * Anotações privadas do mestre sobre a mesa (somente mestre).
 *
 * Ficam na configuração da mesa, mas fora do `GameConfigDto` de propósito: o
 * jogador também lê a configuração e não pode ver as anotações do mestre.
 */
export async function fetchMasterNotes(): Promise<string> {
  const { notes } = await api<{ notes: string }>('/api/game/notes');
  return notes;
}

/** Grava as anotações do mestre (substituição integral do texto). */
export async function saveMasterNotes(notes: string): Promise<string> {
  const { notes: saved } = await api<{ notes: string }>('/api/game/notes', {
    method: 'PATCH',
    body: { notes },
  });
  return saved;
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
 * Liga/desliga as denominações extras (PL e PE) no bloco de moedas (somente
 * mestre). Só muda a EXIBIÇÃO: os valores das cinco denominações existem sempre.
 */
export async function setExtraCoins(enabled: boolean): Promise<GameConfig> {
  const { config } = await api<{ config: GameConfig }>('/api/game/extra-coins', {
    method: 'POST',
    body: { enabled },
  });
  return config;
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
