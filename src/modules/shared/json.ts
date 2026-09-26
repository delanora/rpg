import type { z } from 'zod';

/**
 * Faz o parse de um valor JSONB com fallback seguro.
 * Protege contra dados antigos ou corrompidos sem derrubar a requisição.
 */
export function parseJson<T>(schema: z.ZodTypeAny, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return (result.success ? result.data : fallback) as T;
}
