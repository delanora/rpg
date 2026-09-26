import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { itemDetailsSchema, type ItemDetails } from '../shared/item-details.js';
import { parseJson } from '../shared/json.js';

/**
 * O inventário da ficha **espelha** o catálogo do mestre.
 *
 * Guardamos apenas o que é do jogador (quantidade, "equipado" e o vínculo
 * `itemId`); nome, descrição, peso, categoria, sprite e atributos são lidos do
 * catálogo no momento de montar o DTO. Assim, quando o mestre corrige um item,
 * todas as fichas que o possuem passam a mostrar o valor novo — sem cópias
 * divergentes. Itens avulsos (sem vínculo) seguem com os dados próprios.
 */

/** Dados do catálogo que substituem a cópia guardada no inventário. */
export interface CatalogSnapshot {
  name: string;
  description: string;
  weight: number;
  category: string;
  imageUrl: string;
  details: ItemDetails;
}

/** Mínimo que um item de inventário precisa ter para ser sincronizado. */
interface SyncableItem {
  itemId: string;
  name: string;
  description: string;
  weight: number;
  category: string;
  imageUrl: string;
  details: ItemDetails;
}

/** Leitura tolerante do JSONB: só precisamos dos vínculos com o catálogo. */
const catalogRefSchema = z.array(z.object({ itemId: z.string().optional() }));

/** Ids do catálogo referenciados pelos inventários informados. */
export function catalogItemIds(inventories: unknown[]): string[] {
  const ids = new Set<string>();

  for (const inventory of inventories) {
    for (const entry of parseJson<z.infer<typeof catalogRefSchema>>(catalogRefSchema, inventory, [])) {
      if (entry.itemId) ids.add(entry.itemId);
    }
  }

  return [...ids];
}

/** Carrega os itens do catálogo usados por um ou mais inventários. */
export async function loadCatalogLookup(
  inventories: unknown[],
): Promise<Map<string, CatalogSnapshot>> {
  const ids = catalogItemIds(inventories);
  if (ids.length === 0) return new Map();

  const items = await prisma.item.findMany({ where: { id: { in: ids } } });

  return new Map(
    items.map((item) => [
      item.id,
      {
        name: item.name,
        description: item.description,
        weight: item.weight,
        category: item.category,
        imageUrl: item.imageUrl,
        details: parseJson<ItemDetails>(itemDetailsSchema, item.details, {}),
      },
    ]),
  );
}

/**
 * Aplica os dados atuais do catálogo sobre as cópias do inventário.
 * Se o item saiu do catálogo, a cópia antiga é mantida (a ficha não perde nada).
 */
export function syncInventory<T extends SyncableItem>(
  inventory: T[],
  catalog: Map<string, CatalogSnapshot>,
): T[] {
  return inventory.map((entry) => {
    const snapshot = entry.itemId ? catalog.get(entry.itemId) : undefined;
    if (!snapshot) return entry;

    return {
      ...entry,
      name: snapshot.name,
      description: snapshot.description,
      weight: snapshot.weight,
      category: snapshot.category,
      imageUrl: snapshot.imageUrl,
      details: snapshot.details,
    };
  });
}
