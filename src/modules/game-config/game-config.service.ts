import type { GameConfig } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { LEVEL_MAX, LEVEL_MIN } from '../shared/dnd5e.js';
import { setExhaustionRuleEnabled } from '../shared/exhaustion-flag.js';
import { ServerEvents, type GameConfigPayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { emitCombat, loadCombatById, publishCharacter } from '../combat/combat.service.js';
import { toCombatDto } from '../combat/combat.dto.js';
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
  // Espelha a regra de Exaustão para o domínio mecânico (funções puras e
  // síncronas não podem consultar o banco). Toda leitura/escrita da configuração
  // passa por aqui, então o espelho acompanha o valor persistido.
  setExhaustionRuleEnabled(config.exhaustionEnabled);
  return {
    levelUpRelease: config.levelUpRelease,
    startingLevel: config.startingLevel,
    extraCoins: config.extraCoins,
    campSuppliesEnabled: config.campSuppliesEnabled,
    campSupplyCostPerParticipant: config.campSupplyCostPerParticipant,
    exhaustionEnabled: config.exhaustionEnabled,
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
 * Carrega a configuração no boot do servidor (e sobe o espelho da Exaustão).
 *
 * Sem isso, o espelho ficaria no padrão do módulo até a primeira requisição. O
 * `getGameConfig` cria a linha única quando ela ainda não existe — uma campanha
 * NOVA nasce com `exhaustionEnabled = false`, exatamente o default da coluna.
 */
export async function primeGameConfig(): Promise<void> {
  await getGameConfig();
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
 * Liga/desliga a REGRA de Exaustão do PHB 2014 (regra OPCIONAL, só o Mestre).
 *
 * A configuração é a fonte ÚNICA: o domínio mecânico lê o espelho (síncrono) e o
 * nível SALVO em cada ficha nunca é apagado — desligar apenas o torna inerte, e
 * religar faz o valor anterior voltar a valer. Como os valores DERIVADOS (PV
 * máximo efetivo, deslocamento efetivo, desvantagens) mudam sem que nenhuma
 * ficha tenha sido editada, republicamos as fichas e o combate ativo depois de
 * gravar: os clientes refletem a mudança sem recarregar a página.
 */
export async function setExhaustion(enabled: boolean): Promise<GameConfigDto> {
  await getGameConfig();
  const config = await prisma.gameConfig.update({
    where: { id: CONFIG_ID },
    data: { exhaustionEnabled: enabled },
  });

  const dto = toGameConfigDto(config);
  broadcast(dto);
  await republishExhaustionDerived();
  return dto;
}

/**
 * Republica o que é DERIVADO da Exaustão: as fichas (PV máximo e deslocamento
 * efetivos) e o combate ativo (deslocamento efetivo dos combatentes). É só
 * notificação: nenhuma ficha é alterada, apenas recalculada para quem está
 * conectado.
 */
async function republishExhaustionDerived(): Promise<void> {
  const characters = await prisma.character.findMany({ select: { id: true } });
  await Promise.all(characters.map((character) => publishCharacter(character.id)));

  const combat = await prisma.combat.findFirst({
    where: { status: { in: ['ACTIVE', 'PENDING_INITIATIVE'] } },
    select: { id: true },
  });
  if (combat) emitCombat(ServerEvents.COMBAT_UPDATED, toCombatDto(await loadCombatById(combat.id), 'MASTER'));
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
