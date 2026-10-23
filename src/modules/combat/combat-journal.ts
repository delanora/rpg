import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/**
 * REGISTRO do combate (painel lateral) — escrita PÚBLICA de uma linha.
 *
 * `economyLog` é o log persistido do combate: sobrevive a refresh/reconnect e
 * chega a jogadores e Mestre pelo DTO. Aqui entram os eventos de Teste contra a
 * Morte, estabilização e levantar-se, que antes só existiam em eventos de
 * socket (e por isso sumiam ao recarregar).
 *
 * NUNCA use este caminho para um Teste contra a Morte PRIVADO de NPC/criatura:
 * o registro é público e vazaria o resultado para os jogadores.
 */
export interface CombatJournalEntry {
  id: string;
  actorName: string;
  message: string;
  at: string;
  action?: string;
}

const entrySchema = {
  parse(value: unknown): CombatJournalEntry[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is CombatJournalEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as CombatJournalEntry).id === 'string' &&
        typeof (item as CombatJournalEntry).message === 'string',
    );
  },
};

/**
 * Anexa uma linha ao registro e persiste. Mantém as 100 últimas, igual ao
 * restante do log de combate.
 *
 * A leitura+escrita acontece fora do guard de versão do combate (o registro não
 * é estado de regra): em caso de corrida, tenta de novo com o valor fresco.
 */
export async function appendCombatJournal(
  input: { combatId: string; actorName: string; message: string; action?: string },
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const entry: CombatJournalEntry = {
    id: randomUUID(),
    actorName: input.actorName,
    message: input.message,
    at: new Date().toISOString(),
    ...(input.action ? { action: input.action } : {}),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const combat = await db.combat.findUnique({
      where: { id: input.combatId },
      select: { economyLog: true },
    });
    if (!combat) return;
    const log = [...entrySchema.parse(combat.economyLog), entry].slice(-100);
    await db.combat.update({
      where: { id: input.combatId },
      data: { economyLog: log as unknown as Prisma.InputJsonValue },
    });
    return;
  }
}
