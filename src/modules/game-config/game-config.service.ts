import type { GameConfig } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { LEVEL_MAX, LEVEL_MIN } from '../shared/dnd5e.js';
import { ServerEvents, type GameConfigPayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import type { GameConfigDto } from './game-config.dto.js';

/** Linha única da configuração da mesa. */
const CONFIG_ID = 'main';

function toGameConfigDto(config: GameConfig): GameConfigDto {
  return {
    levelUpUnlocked: config.levelUpUnlocked,
    levelUpRelease: config.levelUpRelease,
    startingLevel: config.startingLevel,
    updatedAt: config.updatedAt.toISOString(),
  };
}

/** Lê a configuração da mesa, criando a linha única se ainda não existir. */
export async function getGameConfig(): Promise<GameConfigDto> {
  const config = await prisma.gameConfig.upsert({
    where: { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID },
  });

  return toGameConfigDto(config);
}

function broadcast(config: GameConfigDto): void {
  try {
    const payload: GameConfigPayload = { config };
    getBroadcaster().toTable(ServerEvents.GAME_CONFIG, payload);
  } catch (error) {
    console.error('[game-config] falha ao publicar a configuração em tempo real:', error);
  }
}

/**
 * Liga/desliga a liberação do Level Up.
 *
 * Cada transição de desligado → ligado incrementa `levelUpRelease`, então quem
 * já usou a liberação anterior volta a ver o botão habilitado só depois que o
 * mestre desligar e ligar de novo.
 */
export async function setLevelUpUnlocked(unlocked: boolean): Promise<GameConfigDto> {
  const current = await getGameConfig();
  const levelUpRelease =
    unlocked && !current.levelUpUnlocked ? current.levelUpRelease + 1 : current.levelUpRelease;

  const config = await prisma.gameConfig.update({
    where: { id: CONFIG_ID },
    data: { levelUpUnlocked: unlocked, levelUpRelease },
  });

  const dto = toGameConfigDto(config);
  broadcast(dto);
  return dto;
}

/**
 * Define o nível em que a mesa começa (1 a 20).
 *
 * Vale para as PRÓXIMAS criações: o assistente de um personagem em montagem lê
 * este valor e aplica os níveis 2..N no passo de progressão. Personagens já
 * finalizados não são tocados.
 */
export async function setStartingLevel(level: number): Promise<GameConfigDto> {
  const clamped = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.floor(level)));

  await getGameConfig();
  const config = await prisma.gameConfig.update({
    where: { id: CONFIG_ID },
    data: { startingLevel: clamped },
  });

  const dto = toGameConfigDto(config);
  broadcast(dto);
  return dto;
}
