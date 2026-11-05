import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { creatureSpellcastingProfileOf } from '../../shared/creature-spellcasting.js';
import { characterLevelOf } from './spellcasting-source.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';

/**
 * FASE 6.6I.2 — NÍVEL DE ESCALONAMENTO DO CONJURADOR.
 *
 * Para PERSONAGEM a fonte canônica é a MESMA do bônus de proficiência:
 * `characterLevelOf` soma as classes e limita a 1..20 (Cleric 1 / Fighter 4 = 5).
 *
 * Para CRIATURA/NPC não existe nível de personagem. O statblock precisa declarar
 * `cantripScalingLevel` no perfil de conjuração; sem isso o cast é RECUSADO
 * antes do COMMIT. Nada é inferido de ND, dados de vida, proficiência, espaços
 * ou atributo — inferir por ND seria uma regra que o PHB 2014 não tem.
 */

export interface CantripScalingLevel {
  level: number;
  source: 'character' | 'creature';
}

type Db = Prisma.TransactionClient | typeof prisma;

function missingLevel(name: string): never {
  throw new HttpError(
    `${name} não possui um nível de personagem explícito para o escalonamento deste truque.`,
    409,
    'SPELL_CANTRIP_SCALING_LEVEL_REQUIRED',
  );
}

export async function cantripScalingLevelOf(
  caster: LoadedEntity,
  db: Db = prisma,
): Promise<CantripScalingLevel> {
  if (caster.entity.kind === 'character') {
    const row = await db.character.findUnique({
      where: { id: caster.entity.id },
      select: { classes: true },
    });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return { level: characterLevelOf(row.classes), source: 'character' };
  }

  if (caster.entity.kind === 'creature') {
    const row = await db.creature.findUnique({
      where: { id: caster.entity.id },
      select: { spellcastingProfile: true },
    });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    const level = creatureSpellcastingProfileOf(row.spellcastingProfile).cantripScalingLevel;
    if (level === undefined) missingLevel(caster.name);
    return { level, source: 'creature' };
  }

  // Combatente de criatura: o perfil é do TEMPLATE (a instância só guarda uso).
  const combatant = await db.combatant.findUnique({
    where: { id: caster.entity.id },
    select: { creature: { select: { spellcastingProfile: true } } },
  });
  if (!combatant) throw new HttpError('Instância não encontrada.', 404);
  const level = creatureSpellcastingProfileOf(
    combatant.creature?.spellcastingProfile,
  ).cantripScalingLevel;
  if (level === undefined) missingLevel(caster.name);
  return { level, source: 'creature' };
}
