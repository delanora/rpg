import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { MechanicalEntity } from './conditions.js';

/**
 * TIPO DE CRIATURA — checagem MÍNIMA e canônica.
 *
 * O projeto já guarda o tipo no statblock (`Creature.type`, texto livre como
 * "Humanoide"/"Besta") e trata as raças jogáveis do PHB 2014 como humanoides.
 * Não existe (e não é criada aqui) uma taxonomia paralela: só a leitura
 * normalizada desse dado, usada por regras que restringem alvo (Hold Person).
 */

/** Normaliza acentos/caixa para comparar "Humanoide", "humanoide", "Humanoid". */
function normalizeType(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** O texto do statblock declara um humanoide? */
export function isHumanoidType(value: string | null | undefined): boolean {
  const normalized = normalizeType(value);
  if (!normalized) return false;
  return /(^|[^a-z])(humanoide|humanoid)([^a-z]|$)/.test(normalized);
}

/**
 * A entidade é um humanoide segundo o dado CANÔNICO disponível?
 *
 * • Combatente de PERSONAGEM → a ficha (raças do PHB são humanoides);
 * • Personagem → humanoide;
 * • Criatura/NPC/instância de criatura → `Creature.type`;
 * • Sem informação de tipo → `false` (rejeita: nunca aplicar no escuro).
 */
export async function isHumanoidEntity(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id }, select: { id: true } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return true;
  }

  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id }, select: { type: true } });
    if (!row) throw new HttpError('Criatura não encontrada.', 404);
    return isHumanoidType(row.type);
  }

  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    select: { characterId: true, creature: { select: { type: true } } },
  });
  if (!row) throw new HttpError('Combatente não encontrado.', 404);
  // Personagem em combate: a ficha é a fonte de verdade (sempre humanoide).
  if (row.characterId) return true;
  return isHumanoidType(row.creature?.type);
}
