import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { MechanicalEntity } from './conditions.js';
import { abilityModifier, normalizeSaves, proficiencyBonus, type AbilityKey } from './dnd5e.js';
import { getClassDefinition, normalizeClassEntries, totalCharacterLevel } from './classes.js';
import { characterClassAdjustments } from '../characters/characters.dto.js';

/**
 * SALVAGUARDA — bônus BASE calculado no SERVIDOR.
 *
 * É a MESMA conta da ficha: modificador do atributo + proficiência (classe/
 * feature/talento) + bônus de salvaguarda de features. Existe para pipelines
 * que NÃO podem aceitar o bônus do cliente (Hoje: o save de uma aplicação de
 * efeito pendente — 6.5H); a bandeja genérica continua usando o bônus da ficha.
 *
 * Não aplica Condições, vantagem/desvantagem nem modificadores de Effect: cada
 * um desses é resolvido pelo pipeline que chama (`deriveSaveEffects` e o
 * resolvedor de efeitos), sem segunda cópia da regra.
 */
export async function savingThrowBonus(
  entity: MechanicalEntity,
  ability: AbilityKey,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    const entries = normalizeClassEntries(row.classes);
    const adjustments = characterClassAdjustments(row);
    // PHB: as salvaguardas proficientes vêm da PRIMEIRA classe; as demais
    // entram por feature/talento (`saveProficiencies`). Mesma regra do DTO.
    const locked = [
      ...(entries[0] ? (getClassDefinition(entries[0].classKey)?.savingThrows ?? []) : []),
      ...adjustments.saveProficiencies,
    ];
    const proficient = normalizeSaves(row.saves)[ability] || locked.includes(ability);
    return (
      abilityModifier(row[ability]) +
      (proficient ? proficiencyBonus(totalCharacterLevel(entries)) : 0) +
      adjustments.saveBonus
    );
  }

  const creature =
    entity.kind === 'creature'
      ? await db.creature.findUnique({ where: { id: entity.id } })
      : await db.combatant
          .findUnique({ where: { id: entity.id }, include: { creature: true } })
          .then((row) => row?.creature ?? null);
  if (!creature) throw new HttpError('Criatura não encontrada.', 404);
  return abilityModifier(creature[ability]);
}
