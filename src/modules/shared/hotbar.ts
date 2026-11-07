import type { Prisma } from '@prisma/client';

/**
 * PERSONALIZAÇÃO DA HOTBAR (6.6M.6.3.1) — modelo PURO da configuração.
 *
 * A Hotbar do jogador tem 48 posições INDEXADAS (1..48). Cada posição guarda a
 * REFERÊNCIA a uma ação que já existe na ficha (`{ kind, sourceId }`) ou fica
 * vazia (`null`). Nada além da referência é persistido: rótulo, bônus, dano,
 * custo e alcance continuam DERIVADOS da fonte real a cada leitura — a Hotbar é
 * preferência de interface, nunca autoridade mecânica.
 *
 * Dois estados diferentes e igualmente válidos:
 * - `null` (coluna nula) = o personagem NUNCA personalizou → o cliente preenche
 *   automaticamente com os ataques disponíveis (comportamento histórico);
 * - array de 48 posições (mesmo todas nulas) = configuração INTENCIONAL, que o
 *   preenchimento automático não pode mais repovoar.
 *
 * Hoje só existe `kind: 'attack'` porque é a única categoria com execução
 * comprovada na Hotbar. O formato fica aberto para magias/itens quando eles
 * tiverem fluxo real — sem atalho fictício nesta fase.
 */
export const HOTBAR_SLOT_COUNT = 48;

/** Categorias de atalho SUPORTADAS hoje. */
export type HotbarSlotKind = 'attack';

/** Referência persistida de uma posição da Hotbar. */
export interface HotbarSlotRef {
  kind: HotbarSlotKind;
  sourceId: string;
}

/** Identidade canônica do atalho (uma posição por identidade nesta fase). */
export function hotbarRefKey(ref: HotbarSlotRef): string {
  return `${ref.kind}:${ref.sourceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lê UMA referência de JSON desconhecido. Formato inválido vira `null` (posição
 * vazia): dado corrompido nunca "ganha" um atalho executável.
 */
export function parseHotbarRef(value: unknown): HotbarSlotRef | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'attack') return null;
  const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim() : '';
  if (!sourceId || sourceId.length > 120) return null;
  return { kind: 'attack', sourceId };
}

/**
 * Normaliza a coluna JSONB em 48 posições. `null`/`undefined` (nunca
 * personalizada) devolve `null` — a distinção entre "sem configuração" e
 * "configuração vazia" é justamente o que impede o preenchimento automático de
 * ressuscitar atalhos removidos.
 */
export function normalizeHotbarSlots(
  value: Prisma.JsonValue | null | undefined,
): (HotbarSlotRef | null)[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => parseHotbarRef(value[index]));
}

/**
 * UMA posição por identidade de atalho (regra da fase): a PRIMEIRA ocorrência
 * vence e as repetições viram vazio. O cliente já move/troca, então isto é só a
 * garantia do servidor contra payload ambíguo.
 */
export function dedupeHotbarSlots(
  slots: readonly (HotbarSlotRef | null)[],
): (HotbarSlotRef | null)[] {
  const seen = new Set<string>();
  return Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => {
    const ref = parseHotbarRef(slots[index] ?? null);
    if (!ref) return null;
    const key = hotbarRefKey(ref);
    if (seen.has(key)) return null;
    seen.add(key);
    return ref;
  });
}

/** Assinatura canônica da configuração (idempotência por semântica, não por ordem). */
export function hotbarFingerprint(slots: readonly (HotbarSlotRef | null)[]): string {
  return JSON.stringify(
    Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => {
      const ref = slots[index];
      return ref ? hotbarRefKey(ref) : null;
    }),
  );
}
