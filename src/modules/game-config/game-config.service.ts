import type { GameConfig } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { LEVEL_MAX, LEVEL_MIN } from '../shared/dnd5e.js';
import { ServerEvents, type GameConfigPayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { republishOpenLongRestRequest } from '../rest/long-rest.service.js';
import {
  CAMP_SUPPLY_COST_MAX,
  CAMP_SUPPLY_COST_MIN,
} from '../shared/camp-supplies.js';
import type { GameConfigDto, MasterNotesDto } from './game-config.dto.js';

/** Linha única da configuração da mesa. */
const CONFIG_ID = 'main';

export { CAMP_SUPPLY_COST_MAX, CAMP_SUPPLY_COST_MIN };

function toGameConfigDto(config: GameConfig): GameConfigDto {
  return {
    levelUpRelease: config.levelUpRelease,
    startingLevel: config.startingLevel,
    extraCoins: config.extraCoins,
    campSuppliesEnabled: config.campSuppliesEnabled,
    campSupplyCostPerParticipant: config.campSupplyCostPerParticipant,
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

/**
 * Anotações privadas do mestre sobre a mesa.
 *
 * Vivem na MESMA linha única da configuração, mas fora do `GameConfigDto` (o
 * jogador recebe a configuração no GET /api/game e não pode ver as anotações):
 * só as rotas exclusivas de MASTER chegam aqui. Sem publicação em tempo real —
 * é texto privado de um único usuário.
 */
export async function getMasterNotes(): Promise<MasterNotesDto> {
  const config = await prisma.gameConfig.upsert({
    where: { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID },
  });

  return { notes: config.masterNotes };
}

/** Grava as anotações do mestre (substituição integral do texto). */
export async function setMasterNotes(notes: string): Promise<MasterNotesDto> {
  await getGameConfig();
  const config = await prisma.gameConfig.update({
    where: { id: CONFIG_ID },
    data: { masterNotes: notes },
  });

  return { notes: config.masterNotes };
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
 * Libera UM Level Up para cada jogador que ainda não usou a liberação atual.
 *
 * Cada clique incrementa `levelUpRelease`. Quem já subiu de nível fica de fora
 * até o mestre liberar de novo — e isso NÃO exige bloquear antes: basta clicar
 * em "Liberar Level Up" outra vez. O incremento é atômico (`increment`), então
 * dois cliques simultâneos contam como duas liberações, nunca uma só.
 */
export async function releaseLevelUp(): Promise<GameConfigDto> {
  await getGameConfig();
  const config = await prisma.gameConfig.update({
    where: { id: CONFIG_ID },
    data: { levelUpRelease: { increment: 1 } },
  });

  const dto = toGameConfigDto(config);
  broadcast(dto);
  return dto;
}

/**
 * Liga/desliga a exibição das denominações extras (PL e PE) no bloco de moedas.
 *
 * Só muda o que a interface mostra: os valores das cinco denominações existem
 * sempre na ficha. Publica `game:config` para a mesa inteira.
 */
export async function setExtraCoins(enabled: boolean): Promise<GameConfigDto> {
  await getGameConfig();
  const config = await prisma.gameConfig.update({
    where: { id: CONFIG_ID },
    data: { extraCoins: enabled },
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

/**
 * Liga/desliga e/ou ajusta o custo dos RECURSOS DE ACAMPAMENTO (mecânica
 * OPCIONAL do Descanso Longo coletivo).
 *
 * A configuração é a fonte ÚNICA: o DTO do Long Rest aberto lê o valor ATUAL
 * (PASSO 29). Por isso, além de publicar `game:config`, recalculamos e
 * republicamos a solicitação aberta (se houver) para os participantes verem o
 * `required`/`satisfied` já com o novo valor. Publicar `game:config` e depois a
 * solicitação garante que os clientes recebam a config antes do DTO derivado.
 */
export async function setCampSupplies(input: {
  enabled?: boolean;
  costPerParticipant?: number;
}): Promise<GameConfigDto> {
  await getGameConfig();

  const data: { campSuppliesEnabled?: boolean; campSupplyCostPerParticipant?: number } = {};
  if (input.enabled !== undefined) data.campSuppliesEnabled = input.enabled;
  if (input.costPerParticipant !== undefined) {
    data.campSupplyCostPerParticipant = Math.min(
      CAMP_SUPPLY_COST_MAX,
      Math.max(CAMP_SUPPLY_COST_MIN, Math.floor(input.costPerParticipant)),
    );
  }

  const config = await prisma.gameConfig.update({ where: { id: CONFIG_ID }, data });

  const dto = toGameConfigDto(config);
  broadcast(dto);
  // O Long Rest aberto reflete a config ATUAL — republica o DTO recalculado.
  await republishOpenLongRestRequest();
  return dto;
}
