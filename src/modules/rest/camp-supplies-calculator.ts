import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { CAMP_SUPPLY_COST_DEFAULT } from '../shared/camp-supplies.js';
import { parseJson } from '../shared/json.js';
import { inventoryListSchema } from '../characters/characters.schema.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import {
  loadCatalogLookup,
  syncInventory,
  type CatalogSnapshot,
} from '../characters/inventory-sync.js';
import type {
  LongRestCampSupplyContributionDto,
  LongRestCampSuppliesDto,
} from './long-rest-request.dto.js';

/**
 * CÁLCULO e CONSUMO dos RECURSOS DE ACAMPAMENTO (mecânica OPCIONAL do Descanso
 * Longo coletivo — inspirada no fluxo de Baldur's Gate 3, NÃO é regra do PHB
 * 2014).
 *
 * Fica num módulo próprio porque os DOIS lados do fluxo precisam dele:
 *   - a montagem do DTO (a cada leitura da solicitação);
 *   - a CONCLUSÃO do Descanso Longo (revalidação canônica + consumo atômico).
 *
 * A fonte de verdade do que um item VALE é sempre o CATÁLOGO (`campSupplyEnabled`
 * / `campSupplyValue`), lido pelo valor ATUAL — o espelho do inventário é apenas
 * a ponte para achar a pilha (PASSO 19). Nenhum subtotal é persistido.
 */

/** Cliente Prisma (transação ou global) — as leituras aceitam os dois. */
export type Db = Prisma.TransactionClient | typeof prisma;

/** Código de erro: a quantidade pedida excede o que existe na pilha. */
export const CAMP_SUPPLY_NOT_ENOUGH = 'CAMP_SUPPLY_NOT_ENOUGH';

/**
 * Recursos de acampamento da solicitação, calculados AGORA (valor atual da
 * config da mesa, das contribuições e do catálogo).
 *
 * `required` só conta os participantes ACCEPTED efetivos (DECLINED/PENDING do
 * force-approve não pesam). `satisfied` é sempre verdadeiro com a mecânica
 * desligada — o Descanso Longo oficial não muda.
 */
export async function computeCampSupplies(
  client: Db,
  requestId: string,
  acceptedCharacterIds: readonly string[],
): Promise<LongRestCampSuppliesDto> {
  // Config atual da mesa (a linha única pode ainda não existir: usa os padrões).
  const config = await client.gameConfig.findUnique({ where: { id: 'main' } });
  const enabled = config?.campSuppliesEnabled ?? false;
  const costPerParticipant = config?.campSupplyCostPerParticipant ?? CAMP_SUPPLY_COST_DEFAULT;

  const rows = await client.longRestCampSupplyContribution.findMany({ where: { requestId } });

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

  return {
    enabled,
    costPerParticipant,
    required,
    contributed,
    remaining: Math.max(0, required - contributed),
    satisfied: !enabled || contributed >= required,
    byCharacter: [...pointsByCharacter.entries()].map(([characterId, points]) => ({
      characterId,
      points,
    })),
    contributions,
  };
}

/**
 * Uma pilha efetivamente consumida (linha de auditoria do resultado).
 *
 * Além de quem/qual/o quanto, a linha guarda o NOME do item e a quantidade da
 * pilha ANTES e DEPOIS do consumo: é o que permite ao jogador (e ao Mestre)
 * conferir, no resultado do descanso, exatamente o que saiu de cada mochila —
 * sem depender da quantidade que a tela dele mostrava antes.
 */
export interface ConsumedCampSupply {
  characterId: string;
  inventoryItemId: string;
  /** Nome do item no catálogo no instante do consumo. */
  name: string;
  quantity: number;
  /** Quantidade da pilha antes do consumo. */
  quantityBefore: number;
  /** Quantidade restante na pilha (0 = a pilha saiu do inventário). */
  quantityAfter: number;
  points: number;
}

/** Resultado do consumo: pontos gastos + inventários resultantes. */
export interface CampSupplyConsumption {
  consumedPoints: number;
  consumed: ConsumedCampSupply[];
  /** Inventário NOVO apenas de quem teve alguma pilha consumida. */
  inventories: Map<string, InventoryItemDto[]>;
}

/**
 * Consome as pilhas contribuídas, na MESMA transação da conclusão (PASSO 20).
 *
 * Função PURA sobre os dados recebidos: recebe as linhas de contribuição, o
 * inventário atual de cada personagem e o catálogo, e devolve os inventários
 * resultantes + os pontos consumidos. NÃO escreve no banco — quem chama faz a
 * escrita única (inventário + benefícios) com a guarda de versão.
 *
 * Revalidação canônica (PASSO 18/19): a pilha precisa existir, o item precisa
 * ser um recurso de acampamento ATIVO no catálogo e a quantidade reservada
 * precisa existir de verdade na ficha. Qualquer divergência lança 409 e a
 * transação inteira é revertida — nunca há consumo parcial nem benefício sem
 * consumo.
 */
export function consumeCampSupplies(input: {
  rows: readonly { characterId: string; inventoryItemId: string; quantity: number }[];
  inventories: ReadonlyMap<string, InventoryItemDto[]>;
  catalog: Map<string, CatalogSnapshot>;
}): CampSupplyConsumption {
  const nextByCharacter = new Map<string, InventoryItemDto[]>();
  const consumed: ConsumedCampSupply[] = [];
  let consumedPoints = 0;

  for (const row of input.rows) {
    if (row.quantity <= 0) continue;

    const current = nextByCharacter.get(row.characterId) ?? input.inventories.get(row.characterId);
    if (!current) {
      throw new HttpError(
        'Uma contribuição de acampamento aponta para um personagem fora do descanso.',
        409,
        CAMP_SUPPLY_NOT_ENOUGH,
      );
    }

    const inventory = syncInventory(current, input.catalog);
    const item = inventory.find((entry) => entry.id === row.inventoryItemId);
    if (!item || !item.campSupply.enabled || item.campSupply.value <= 0) {
      throw new HttpError(
        `O item reservado para o acampamento não está mais disponível como recurso (${row.inventoryItemId}).`,
        409,
        CAMP_SUPPLY_NOT_ENOUGH,
      );
    }
    if (item.quantity < row.quantity) {
      throw new HttpError(
        `Não há ${row.quantity} unidades de ${item.name} no inventário para consumir ` +
          `(existem ${item.quantity}).`,
        409,
        CAMP_SUPPLY_NOT_ENOUGH,
      );
    }

    const points = row.quantity * item.campSupply.value;
    // Consome a quantidade reservada; a pilha sai da ficha quando zera.
    const remaining = item.quantity - row.quantity;
    consumedPoints += points;
    consumed.push({
      characterId: row.characterId,
      inventoryItemId: row.inventoryItemId,
      name: item.name,
      quantity: row.quantity,
      quantityBefore: item.quantity,
      quantityAfter: remaining,
      points,
    });

    const next = current
      .map((entry) => (entry.id === row.inventoryItemId ? { ...entry, quantity: remaining } : entry))
      .filter((entry) => entry.id !== row.inventoryItemId || remaining > 0);
    nextByCharacter.set(row.characterId, next);
  }

  return { consumedPoints, consumed, inventories: nextByCharacter };
}
