import { z } from 'zod';

/** Elevação absoluta da superfície; grade de 5 pés. Não representa altura corporal. */
export const elevationCellSchema = z
  .object({
    xFeet: z.number().finite().nonnegative().max(100_000).multipleOf(5),
    yFeet: z.number().finite().nonnegative().max(100_000).multipleOf(5),
    elevationFeet: z.number().finite().min(-10_000).max(10_000),
  })
  .strict();
export type ElevationCell = z.infer<typeof elevationCellSchema>;
export const elevationCellsSchema = z
  .array(elevationCellSchema)
  .max(10_000)
  .superRefine((cells, ctx) => {
    const keys = new Set<string>();
    for (const cell of cells) {
      const key = `${cell.xFeet}:${cell.yFeet}`;
      if (keys.has(key))
        ctx.addIssue({
          code: 'custom',
          message: 'Um quadrado só pode ter uma elevação.',
        });
      keys.add(key);
    }
  });
