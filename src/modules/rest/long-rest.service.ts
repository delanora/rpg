import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { getOnlineUsers } from '../../realtime/presence.js';
import { parseJson } from '../shared/json.js';
import { CAMP_SUPPLY_COST_DEFAULT } from '../shared/camp-supplies.js';
import { inventoryListSchema } from '../characters/characters.schema.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import { loadCatalogLookup, syncInventory } from '../characters/inventory-sync.js';
import { availableQuantity, reservedQuantities } from './camp-supply-reservations.js';
import {
  toLongRestRequestDto,
  type LongRestCampSupplyContributionDto,
  type LongRestCampSuppliesDto,
  type LongRestRequestBaseDto,
  type LongRestRequestDto,
} from './long-rest-request.dto.js';
import type {
  CreateLongRestRequestInput,
  LongRestRequestActionInput,
  RespondLongRestRequestInput,
  SetCampSupplyContributionInput,
} from './long-rest.schema.js';

/**
 * Solicitação COLETIVA de Descanso Longo (consenso da mesa) — SÓ INFRAESTRUTURA.
 *
 * Fluxo: um PLAYER solicita → a lista de convidados é CONGELADA (jogadores
 * PLAYER conectados com ficha) → solicitante nasce ACCEPTED, os demais PENDING →
 * cada um aceita/recusa enquanto a solicitação está PENDING → quando não há mais
 * PENDING ela é resolvida: APPROVED (cria uma `LongRestSession` ACTIVE SÓ para os
 * ACCEPTED) ou CANCELLED (ninguém aceitou). O MESTRE não participa: só pode
 * FORÇAR a aprovação ou CANCELAR.
 *
 * IMPORTANTE: NENHUM benefício de descanso é aplicado nesta etapa. A sessão
 * existe apenas como vínculo persistente de que o personagem entrou no
 * descanso (HP, Dados de Vida, espaços, recursos e inventário não mudam).
 *
 * Idempotência: a solicitação é global/multi-personagem, então NÃO reaproveita
 * `CharacterOperation` (que é por personagem) — usa `LongRestOperation`, com a
 * mesma semântica (chave única + tipo + fingerprint + resultado original).
 */

/** Tipo LÓGICO das operações da solicitação (`LongRestOperation.type`). */
const CREATE_TYPE = 'LONG_REST_REQUEST_CREATE';
const RESPOND_TYPE = 'LONG_REST_REQUEST_RESPOND';
const FORCE_TYPE = 'LONG_REST_REQUEST_FORCE_APPROVE';
const CANCEL_TYPE = 'LONG_REST_REQUEST_CANCEL';
/** Abortar um descanso EM ANDAMENTO (APPROVED) — exclusivo do mestre. */
const ABORT_TYPE = 'LONG_REST_REQUEST_ABORT';
/** Definir/atualizar/remover UMA contribuição de recurso de acampamento. */
const CAMP_SUPPLY_SET_TYPE = 'LONG_REST_CAMP_SUPPLY_SET';

/** Mesma chave idempotente usada para outra operação. */
const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
/** Já existe uma solicitação coletiva aguardando resposta (uma PENDING global). */
const LONG_REST_REQUEST_ALREADY_PENDING = 'LONG_REST_REQUEST_ALREADY_PENDING';
/** A solicitação já foi resolvida (APPROVED/CANCELLED) — não aceita mais mudanças. */
const LONG_REST_REQUEST_CLOSED = 'LONG_REST_REQUEST_CLOSED';
/** Quem chamou não é participante da solicitação. */
const NOT_A_PARTICIPANT = 'NOT_A_PARTICIPANT';
/** Um dos personagens aceitos já tem um Descanso Longo ativo. */
const LONG_REST_SESSION_ALREADY_ACTIVE = 'LONG_REST_SESSION_ALREADY_ACTIVE';
/** Motivo gravado quando todos recusaram (nenhum ACCEPTED). */
const NO_PARTICIPANTS = 'NO_PARTICIPANTS';
/** Motivo gravado quando o mestre ABORTA um descanso em andamento. */
const ABORTED = 'ABORTED';
/** A mecânica de recursos de acampamento está desligada. */
const CAMP_SUPPLIES_DISABLED = 'CAMP_SUPPLIES_DISABLED';
/** O item escolhido não é um recurso de acampamento válido. */
const CAMP_SUPPLY_ITEM_INVALID = 'CAMP_SUPPLY_ITEM_INVALID';
/** A quantidade pedida excede o disponível (descontando reservas). */
const CAMP_SUPPLY_NOT_ENOUGH = 'CAMP_SUPPLY_NOT_ENOUGH';
/** A solicitação não está em andamento (APPROVED) para aceitar contribuições. */
const LONG_REST_NOT_IN_PROGRESS = 'LONG_REST_NOT_IN_PROGRESS';

/** Autor da requisição (vem sempre do token). */
export interface Actor {
  userId: string;
  username: string;
  displayName: string;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Violação de unicidade do Prisma (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002';
}

/** Nome do alvo/índice que violou a unicidade (para separar as causas do P2002). */
function uniqueViolationTarget(error: unknown): string {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.join(',');
  return typeof target === 'string' ? target : '';
}

/** Busca a operação idempotente por `operationId` (global). */
function findOperation(operationId: string) {
  return prisma.longRestOperation.findUnique({ where: { operationId } });
}

/**
 * Devolve o snapshot PERSISTIDO de uma operação já existente quando a
 * identidade lógica (tipo + fingerprint) bate — ou lança 409
 * `IDEMPOTENCY_KEY_REUSED` quando a MESMA chave foi usada para outra operação.
 */
function replaySnapshot<T>(
  previous: { type: string; requestFingerprint: string; result: Prisma.JsonValue },
  type: string,
  fingerprint: string,
): T {
  if (previous.type !== type || previous.requestFingerprint !== fingerprint) {
    throw new HttpError(
      'Esta chave de operação já foi usada para outra operação. Gere um novo identificador.',
      409,
      IDEMPOTENCY_KEY_REUSED,
    );
  }
  return previous.result as unknown as T;
}

/**
 * Serializa o acesso a UMA solicitação: trava a linha (`FOR UPDATE`). Assim,
 * responder / forçar / cancelar concorrentes se enfileiram e só uma operação
 * enxerga a solicitação ainda PENDING — sem corrida entre as transições.
 */
async function lockRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "long_rest_requests" WHERE "id" = ${requestId} FOR UPDATE`;
}

/**
 * `include` padrão para montar o DTO: usuários e as SESSÕES da solicitação (de
 * onde sai o `sessionId` de cada participante).
 */
const REQUEST_DTO_INCLUDE = {
  requestedBy: { select: { id: true, username: true, displayName: true } },
  participants: {
    include: { user: { select: { id: true, username: true, displayName: true } } },
  },
  sessions: { select: { id: true, characterId: true } },
} as const;

/**
 * Calcula a seção de RECURSOS DE ACAMPAMENTO (mecânica opcional) para o DTO.
 *
 * A config é lida pelo valor ATUAL (sem snapshot por solicitação — PASSO 29);
 * os pontos de cada contribuição vêm do valor ATUAL do item (`campSupplyValue`),
 * nunca de um subtotal persistido (PASSO 19/20).
 */
async function buildCampSupplies(
  client: Db,
  base: LongRestRequestBaseDto,
): Promise<LongRestCampSuppliesDto> {
  // Config atual da mesa (a linha única pode ainda não existir: usa os padrões).
  const config = await client.gameConfig.findUnique({ where: { id: 'main' } });
  const enabled = config?.campSuppliesEnabled ?? false;
  const costPerParticipant = config?.campSupplyCostPerParticipant ?? CAMP_SUPPLY_COST_DEFAULT;

  // Cota: só os ACCEPTED efetivos contam (DECLINED/PENDING do force-approve não).
  const acceptedCharacterIds = base.participants
    .filter((participant) => participant.response === 'ACCEPTED')
    .map((participant) => participant.characterId);

  const rows = await client.longRestCampSupplyContribution.findMany({
    where: { requestId: base.id },
  });

  // Resolve o valor por item a partir do inventário ATUAL (espelhando o catálogo).
  const characterIds = [...new Set(rows.map((row) => row.characterId))];
  const characters = characterIds.length
    ? await client.character.findMany({
        where: { id: { in: characterIds } },
        select: { id: true, inventory: true },
      })
    : [];
  const inventoryByCharacter = new Map<string, InventoryItemDto[]>(
    characters.map((character) => [
      character.id,
      parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []),
    ]),
  );
  const catalog = await loadCatalogLookup([...inventoryByCharacter.values()]);

  const pointsByCharacter = new Map<string, number>();
  for (const characterId of acceptedCharacterIds) pointsByCharacter.set(characterId, 0);

  const contributions: LongRestCampSupplyContributionDto[] = [];
  let contributed = 0;
  for (const row of rows) {
    const inventory = syncInventory(inventoryByCharacter.get(row.characterId) ?? [], catalog);
    const item = inventory.find((entry) => entry.id === row.inventoryItemId);
    const value = item && item.campSupply.enabled ? item.campSupply.value : 0;
    const points = row.quantity * value;
    contributed += points;
    pointsByCharacter.set(row.characterId, (pointsByCharacter.get(row.characterId) ?? 0) + points);
    contributions.push({
      characterId: row.characterId,
      inventoryItemId: row.inventoryItemId,
      quantity: row.quantity,
      points,
    });
  }

  const required = enabled ? acceptedCharacterIds.length * costPerParticipant : 0;
  const remaining = Math.max(0, required - contributed);
  const satisfied = !enabled || contributed >= required;

  return {
    enabled,
    costPerParticipant,
    required,
    contributed,
    remaining,
    satisfied,
    byCharacter: [...pointsByCharacter.entries()].map(([characterId, points]) => ({
      characterId,
      points,
    })),
    contributions,
  };
}

/** Completa um DTO-base com a seção de recursos de acampamento. */
async function withCampSupplies(
  client: Db,
  base: LongRestRequestBaseDto,
): Promise<LongRestRequestDto> {
  return { ...base, campSupplies: await buildCampSupplies(client, base) };
}

/** Carrega a solicitação já no formato do DTO (com usuários, sessões e camp supplies). */
async function loadRequestDto(client: Db, requestId: string): Promise<LongRestRequestDto> {
  const request = await client.longRestRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: REQUEST_DTO_INCLUDE,
  });
  return withCampSupplies(client, toLongRestRequestDto(request));
}

/**
 * Resolve a solicitação quando não resta nenhum PENDING.
 *
 * `forcedByUserId` (force-approve do mestre) fecha os PENDING como DECLINED com
 * `closedByMaster = true` — NUNCA como aceitação. Sem ACCEPTED, cancela com
 * `NO_PARTICIPANTS`; caso contrário, valida TODOS os ACEITOS contra sessões
 * ativas (falha atômica se algum já tiver), cria as sessões ACTIVE e marca
 * APPROVED. Tudo na MESMA transação de quem chamou.
 *
 * ATENÇÃO: nenhum benefício de descanso é aplicado — apenas o vínculo da sessão.
 */
async function settleIfAnswered(
  tx: Prisma.TransactionClient,
  requestId: string,
  forcedByUserId: string | null,
): Promise<void> {
  if (forcedByUserId) {
    await tx.longRestRequestParticipant.updateMany({
      where: { requestId, response: 'PENDING' },
      data: { response: 'DECLINED', respondedAt: new Date(), closedByMaster: true },
    });
  } else {
    const pending = await tx.longRestRequestParticipant.count({
      where: { requestId, response: 'PENDING' },
    });
    if (pending > 0) return; // a coleta continua
  }

  const participants = await tx.longRestRequestParticipant.findMany({
    where: { requestId },
    select: { characterId: true, response: true },
  });
  const accepted = participants.filter((participant) => participant.response === 'ACCEPTED');

  // Ninguém aceitou → não faz sentido aprovar um descanso sem participantes.
  if (accepted.length === 0) {
    await tx.longRestRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: NO_PARTICIPANTS,
        forcedByUserId,
      },
    });
    return;
  }

  // Conflito: qualquer ACCEPTED com sessão ativa ABORTA tudo (nada parcial).
  const characterIds = accepted.map((participant) => participant.characterId);
  const activeCount = await tx.longRestSession.count({
    where: { characterId: { in: characterIds }, status: 'ACTIVE' },
  });
  if (activeCount > 0) {
    throw new HttpError(
      'Um dos personagens já tem um Descanso Longo ativo; a solicitação não foi aprovada.',
      409,
      LONG_REST_SESSION_ALREADY_ACTIVE,
    );
  }

  // Uma sessão ACTIVE SÓ para cada ACCEPTED. DECLINED fica completamente fora.
  // O vínculo `longRestRequestId` é o que registra o descanso da mesa.
  for (const participant of accepted) {
    await tx.longRestSession.create({
      data: { characterId: participant.characterId, longRestRequestId: requestId },
    });
  }

  await tx.longRestRequest.update({
    where: { id: requestId },
    data: { status: 'APPROVED', approvedAt: new Date(), forcedByUserId },
  });
}

/** Publica o evento da solicitação para a mesa inteira (payload enxuto, sem fichas). */
function publishRequest(request: LongRestRequestDto): void {
  getBroadcaster().toTable(ServerEvents.LONG_REST_REQUEST_UPDATED, { request });
}

/** Resultado padrão de qualquer operação da solicitação. */
export interface LongRestRequestResult extends LongRestRequestDto {
  replayed: boolean;
}

/**
 * Cria a solicitação coletiva.
 *
 * Convidados = o solicitante + jogadores PLAYER CONECTADOS com ficha (o mestre
 * nunca entra; quem está offline não entra). A lista é congelada aqui. Se o
 * solicitante for o único elegível, a solicitação é aprovada na hora (nenhum
 * PENDING sobra) e sua sessão ACTIVE nasce na mesma transação.
 */
export async function createLongRestRequest(
  actor: Actor,
  input: CreateLongRestRequestInput,
): Promise<LongRestRequestResult> {
  const character = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

  const fingerprint = '{}';
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, CREATE_TYPE, fingerprint),
      replayed: true,
    };
  }

  // Elegíveis: o solicitante e os jogadores PLAYER online, todos com ficha.
  const onlineIds = getOnlineUsers()
    .filter((user) => user.role === 'PLAYER')
    .map((user) => user.userId);
  const candidateIds = [...new Set([actor.userId, ...onlineIds])];
  const candidates = await prisma.user.findMany({
    where: { id: { in: candidateIds }, role: 'PLAYER' },
    select: { id: true, character: { select: { id: true } } },
  });
  const eligible = candidates
    .filter((candidate) => candidate.character !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  // O solicitante fica sempre em primeiro (ordem de exibição/gravação).
  eligible.sort((a, b) => (a.id === actor.userId ? -1 : b.id === actor.userId ? 1 : 0));

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.longRestRequest.create({
        data: {
          requestedByUserId: actor.userId,
          participants: {
            create: eligible.map((candidate) => ({
              userId: candidate.id,
              characterId: candidate.character!.id,
              response: candidate.id === actor.userId ? 'ACCEPTED' : 'PENDING',
              respondedAt: candidate.id === actor.userId ? now : null,
            })),
          },
        },
      });

      // Só o solicitante (nenhum PENDING) → resolve na hora.
      await settleIfAnswered(tx, created.id, null);

      const loaded = await loadRequestDto(tx, created.id);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: CREATE_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<LongRestRequestDto>(raced, CREATE_TYPE, fingerprint),
          replayed: true,
        };
      }
      const target = uniqueViolationTarget(error);
      if (target.includes('long_rest_sessions')) {
        throw new HttpError(
          'Um dos personagens já tem um Descanso Longo ativo; a solicitação não foi aprovada.',
          409,
          LONG_REST_SESSION_ALREADY_ACTIVE,
        );
      }
      throw new HttpError(
        'Já existe uma solicitação de Descanso Longo aguardando resposta.',
        409,
        LONG_REST_REQUEST_ALREADY_PENDING,
      );
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * Responde à solicitação (ACCEPTED/DECLINED).
 *
 * Só um participante responde, e só enquanto a solicitação está PENDING — a
 * resposta pode ser TROCADA quantas vezes quiser até a aprovação (a troca é
 * idempotente por `operationId`). Depois de resolver, a mudança é recusada.
 * Quando a última resposta chega, a solicitação é resolvida na mesma transação.
 */
export async function respondToLongRestRequest(
  actor: Actor,
  requestId: string,
  input: RespondLongRestRequestInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId, response: input.response });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, RESPOND_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      const participant = await tx.longRestRequestParticipant.findUnique({
        where: { requestId_userId: { requestId, userId: actor.userId } },
      });
      if (!participant) {
        throw new HttpError(
          'Você não participa desta solicitação de descanso.',
          403,
          NOT_A_PARTICIPANT,
        );
      }

      await tx.longRestRequestParticipant.update({
        where: { requestId_userId: { requestId, userId: actor.userId } },
        data: { response: input.response, respondedAt: new Date(), closedByMaster: false },
      });

      await settleIfAnswered(tx, requestId, null);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: RESPOND_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<LongRestRequestDto>(raced, RESPOND_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * FORÇA a aprovação (exclusivo do mestre).
 *
 * ACCEPTED continua aceito, DECLINED continua recusado e o PENDING vira um NÃO
 * PARTICIPANTE (persistido como DECLINED + `closedByMaster`). Cria sessões
 * apenas para os ACCEPTED; sem nenhum ACCEPTED → CANCELLED / NO_PARTICIPANTS.
 */
export async function forceApproveLongRestRequest(
  actor: Actor,
  requestId: string,
  input: LongRestRequestActionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, FORCE_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      await settleIfAnswered(tx, requestId, actor.userId);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: FORCE_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<LongRestRequestDto>(raced, FORCE_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * CANCELA a solicitação (exclusivo do mestre).
 *
 * PENDING → CANCELLED, sem criar sessões e sem alterar as respostas já dadas.
 */
export async function cancelLongRestRequest(
  actor: Actor,
  requestId: string,
  input: LongRestRequestActionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, CANCEL_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      await tx.longRestRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: CANCEL_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<LongRestRequestDto>(raced, CANCEL_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * Define/atualiza/REMOVE a contribuição de UMA pilha do próprio inventário
 * (mecânica OPCIONAL de recursos de acampamento).
 *
 * Server-authoritative: só um participante ACCEPTED com sessão ACTIVE da MESMA
 * solicitação contribui, apenas com itens do PRÓPRIO inventário, e só quando a
 * mecânica está ligada. O cliente nunca envia valor/subtotal/total. Selecionar
 * NÃO consome: a quantidade fica RESERVADA (as operações de inventário respeitam
 * `quantity − reservado`). `quantity = 0` remove a contribuição.
 *
 * Idempotente por `operationId` (tipo `LONG_REST_CAMP_SUPPLY_SET` + fingerprint
 * `{ requestId, inventoryItemId, quantity }`).
 */
export async function setCampSupplyContribution(
  actor: Actor,
  requestId: string,
  input: SetCampSupplyContributionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({
    requestId,
    inventoryItemId: input.inventoryItemId,
    quantity: input.quantity,
  });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, CAMP_SUPPLY_SET_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'APPROVED') {
        throw new HttpError(
          'Este descanso não está em andamento para receber contribuições.',
          409,
          LONG_REST_NOT_IN_PROGRESS,
        );
      }

      // Config lida DENTRO da transação (valor ATUAL — PASSO 29).
      const config = await tx.gameConfig.findUnique({ where: { id: 'main' } });
      if (!(config?.campSuppliesEnabled ?? false)) {
        throw new HttpError(
          'Os recursos de acampamento estão desligados nesta mesa.',
          403,
          CAMP_SUPPLIES_DISABLED,
        );
      }

      // Só participante ACCEPTED com sessão ACTIVE contribui (PASSO 7).
      const participant = await tx.longRestRequestParticipant.findUnique({
        where: { requestId_userId: { requestId, userId: actor.userId } },
      });
      if (!participant || participant.response !== 'ACCEPTED') {
        throw new HttpError(
          'Você não participa deste descanso como aceito.',
          403,
          NOT_A_PARTICIPANT,
        );
      }
      const session = await tx.longRestSession.findFirst({
        where: {
          characterId: participant.characterId,
          longRestRequestId: requestId,
          status: 'ACTIVE',
        },
      });
      if (!session) {
        throw new HttpError('Sua sessão de descanso não está ativa.', 409, NOT_A_PARTICIPANT);
      }

      // Item do PRÓPRIO inventário — o `characterId` NUNCA vem do cliente (PASSO 8).
      const character = await tx.character.findUnique({
        where: { id: participant.characterId },
        select: { id: true, inventory: true },
      });
      if (!character) throw new HttpError('Personagem não encontrado.', 404);
      const inventory = parseJson<InventoryItemDto[]>(
        inventoryListSchema,
        character.inventory,
        [],
      );
      const catalog = await loadCatalogLookup([inventory]);
      const item = syncInventory(inventory, catalog).find(
        (entry) => entry.id === input.inventoryItemId,
      );
      if (!item) throw new HttpError('Item não encontrado no seu inventário.', 404);

      const current = await tx.longRestCampSupplyContribution.findUnique({
        where: { requestId_inventoryItemId: { requestId, inventoryItemId: input.inventoryItemId } },
      });
      const currentQuantity = current?.quantity ?? 0;

      // quantity = 0 remove a contribuição (libera a reserva na hora).
      if (input.quantity === 0) {
        if (current) {
          await tx.longRestCampSupplyContribution.delete({ where: { id: current.id } });
          await tx.character.update({
            where: { id: character.id },
            data: { version: { increment: 1 } },
          });
        }
        const loaded = await loadRequestDto(tx, requestId);
        await tx.longRestOperation.create({
          data: {
            operationId: input.operationId,
            type: CAMP_SUPPLY_SET_TYPE,
            requestFingerprint: fingerprint,
            result: loaded as unknown as Prisma.InputJsonValue,
          },
        });
        return loaded;
      }

      // O item precisa ser um recurso de acampamento VÁLIDO (PASSO 9.8/9.9).
      if (!item.campSupply.enabled || item.campSupply.value <= 0) {
        throw new HttpError(
          `O item ${item.name} não é um recurso de acampamento.`,
          400,
          CAMP_SUPPLY_ITEM_INVALID,
        );
      }

      // Reservas ATIVAS desta pilha, DESCONTANDO a contribuição desta própria
      // solicitação (que está sendo substituída). Nunca permite overcommit.
      const reserved = await reservedQuantities([item.id]);
      const reservedByOthers = Math.max(0, (reserved.get(item.id) ?? 0) - currentQuantity);
      const available = availableQuantity(item.quantity, reservedByOthers);
      if (input.quantity > available) {
        throw new HttpError(
          `Não há ${input.quantity} unidades de ${item.name} disponíveis para reservar ` +
            `(disponíveis: ${available}).`,
          409,
          CAMP_SUPPLY_NOT_ENOUGH,
        );
      }

      if (current) {
        await tx.longRestCampSupplyContribution.update({
          where: { id: current.id },
          data: { quantity: input.quantity },
        });
      } else {
        await tx.longRestCampSupplyContribution.create({
          data: {
            requestId,
            characterId: character.id,
            inventoryItemId: item.id,
            quantity: input.quantity,
          },
        });
      }
      // As reservas entram no `version` da ficha: qualquer operação que reduza a
      // quantidade revalida contra as reservas ao tentar de novo (evita
      // reservar + consumir simultâneos).
      await tx.character.update({
        where: { id: character.id },
        data: { version: { increment: 1 } },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: CAMP_SUPPLY_SET_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<LongRestRequestDto>(raced, CAMP_SUPPLY_SET_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * ABORTA um Descanso Longo EM ANDAMENTO (APPROVED) — exclusivo do mestre.
 *
 * Encerra as sessões ACTIVE da solicitação (elas viram CANCELLED) e cancela a
 * solicitação com motivo `ABORTED`. As RESERVAS de acampamento deixam de valer
 * imediatamente (o helper só conta contribuições de solicitações APPROVED), sem
 * consumir nem remover nada do inventário. Não confundir com `cancel`, que só
 * vale para uma solicitação PENDING.
 */
export async function abortLongRestRequest(
  actor: Actor,
  requestId: string,
  input: LongRestRequestActionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, ABORT_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'APPROVED') {
        throw new HttpError(
          'Só é possível abortar um Descanso Longo em andamento (aprovado).',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      await tx.longRestSession.updateMany({
        where: { longRestRequestId: requestId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await tx.longRestRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: ABORTED },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: ABORT_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<LongRestRequestDto>(raced, ABORT_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * Republica a solicitação aberta (se houver) — usado quando a CONFIG de recursos
 * de acampamento muda e o `required`/`satisfied` do DTO precisa refletir o valor
 * ATUAL para quem já está com o descanso aberto.
 */
export async function republishOpenLongRestRequest(): Promise<void> {
  try {
    const open = await getOpenLongRestRequest();
    if (open) publishRequest(open);
  } catch (error) {
    console.error('[long-rest] falha ao republicar a solicitação após mudança de config:', error);
  }
}

/**
 * Solicitação "aberta" da mesa: a única PENDING ou, se ela já foi aprovada, a
 * que está EM ANDAMENTO (APPROVED). Devolve `null` quando não há descanso
 * coletivo aberto (COMPLETED/CANCELLED não contam).
 */
export async function getOpenLongRestRequest(): Promise<LongRestRequestDto | null> {
  const pending = await prisma.longRestRequest.findFirst({
    where: { status: 'PENDING' },
    include: REQUEST_DTO_INCLUDE,
  });
  if (pending) return withCampSupplies(prisma, toLongRestRequestDto(pending));

  const approved = await prisma.longRestRequest.findFirst({
    where: { status: 'APPROVED' },
    orderBy: { approvedAt: 'desc' },
    include: REQUEST_DTO_INCLUDE,
  });
  return approved ? withCampSupplies(prisma, toLongRestRequestDto(approved)) : null;
}
