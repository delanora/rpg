import { z } from 'zod';
/** Quadrados ambientais de 5 pés; presença significa terreno difícil. */
export const terrainCellsSchema = z
  .array(
    z
      .object({
        xFeet: z.number().finite().nonnegative().max(100_000).multipleOf(5),
        yFeet: z.number().finite().nonnegative().max(100_000).multipleOf(5),
      })
      .strict(),
  )
  .max(10_000)
  .superRefine((cells, ctx) => {
    const keys = new Set<string>();
    for (const cell of cells) {
      const key = `${cell.xFeet}:${cell.yFeet}`;
      if (keys.has(key))
        ctx.addIssue({
          code: 'custom',
          message: 'Quadrado de terreno duplicado.',
        });
      keys.add(key);
    }
  });
export type TerrainCell = z.infer<typeof terrainCellsSchema>[number];
