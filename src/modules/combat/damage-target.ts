import type { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import type { DamageResolutionTarget } from './damage-resolution.js';

/**
 * Constrói o alvo do núcleo compartilhado de dano/cura.
 *
 * Personagem é a FICHA; criatura/NPC é a INSTÂNCIA de combate (o template nunca
 * recebe HP de combate). Criatura SOLTA do bestiário é o próprio registro — o
 * núcleo distingue os dois casos pela existência da instância.
 *
 * Módulo próprio para que dano por salvaguarda (6.6I.2) e cura imediata
 * (6.6I.3) usem a MESMA leitura, sem duplicar regra de identidade.
 */
export async function damageTargetOf(
  db: Prisma.TransactionClient,
  entity: MechanicalEntity,
): Promise<DamageResolutionTarget> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return { kind: 'CHARACTER', id: row.id, character: row };
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return {
      kind: 'CREATURE',
      id: row.id,
      creature: {
        resistances: row.resistances,
        immunities: row.immunities,
        vulnerabilities: row.vulnerabilities,
        mechanicalState: row.mechanicalState,
        hpMax: row.hpMax,
      },
      mechanicalState: row.mechanicalState,
      hpMax: row.hpMax,
    };
  }
  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    include: { creature: true },
  });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  return {
    kind: 'NPC',
    id: row.id,
    creature: row.creature
      ? {
          resistances: row.creature.resistances,
          immunities: row.creature.immunities,
          vulnerabilities: row.creature.vulnerabilities,
          mechanicalState: row.creature.mechanicalState,
          hpMax: row.creature.hpMax,
        }
      : null,
    mechanicalState: row.mechanicalState,
    hpMax: row.hpMax ?? row.creature?.hpMax ?? 0,
  };
}
