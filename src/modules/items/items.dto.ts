import type { Item } from '@prisma/client';

/** Item do catálogo enviado ao frontend (painel do mestre e busca do jogador). */
export interface ItemDto {
  id: string;
  name: string;
  description: string;
  weight: number;
  category: string;
  /** URL pública do sprite ('' = sem imagem). */
  imageUrl: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toItemDto(item: Item): ItemDto {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    weight: item.weight,
    category: item.category,
    imageUrl: item.imageUrl,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
