/** Converte um texto em inteiro dentro de limites, com valor de reserva. */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Converte um texto em número decimal dentro de limites. */
export function clampFloat(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseFloat(raw.replace(',', '.'));
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Gera um id local para itens de coleções (inventário, magias, ataques...). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Momento atual em ISO — usado para marcar alterações otimistas. */
export function nowIso(): string {
  return new Date().toISOString();
}
