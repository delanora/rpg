import type { Item, Role } from '@prisma/client';
import {
  sanitizeItemDetails,
  type ItemDetails,
  type ItemPrice,
} from '../shared/item-details.js';

/** Item do catálogo enviado ao frontend. */
export interface ItemDto {
  id: string;
  name: string;
  description: string;
  weight: number;
  category: string;
  /** URL pública do sprite ('' = sem imagem). */
  imageUrl: string;
  /** Atributos específicos da categoria (dano, CA, rolagem de efeito...). */
  details: ItemDetails;
  /**
   * Preço em PO/PP/PC. Fica `null` para quem não é mestre — o valor de mercado
   * é informação exclusiva do mestre.
   */
  price: ItemPrice | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Monta o DTO do item. O preço só é incluído para mestres: os jogadores usam o
 * catálogo apenas para buscar itens no inventário.
 */
export function toItemDto(item: Item, viewer: Role): ItemDto {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    weight: item.weight,
    category: item.category,
    imageUrl: item.imageUrl,
    details: sanitizeItemDetails(item.category, item.details),
    price:
      viewer === 'MASTER'
        ? { gold: item.priceGold, silver: item.priceSilver, copper: item.priceCopper }
        : null,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
