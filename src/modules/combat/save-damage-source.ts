import type { Prisma } from '@prisma/client';
import { creatureAreaDefinitionSchema } from '../shared/creature-abilities.js';
import { spellExecutionDefinition } from '../spells/execution/spell-execution-registry.js';
import type { SpellResolutionDefinition } from '../spells/execution/spell-execution-definition.js';
export type SaveDamageSourceKind = 'spell' | 'creature-ability';
/** Adaptador da barreira compartilhada. Habilidades não criam SpellCast nem usam regras de conjuração. */
export async function loadSaveDamageSource(
  id: string,
  db: Prisma.TransactionClient,
  kind: SaveDamageSourceKind = 'spell',
) {
  if (kind === 'spell') {
    const row = await db.spellCast.findUnique({ where: { id } });
    if (!row) return null;
    return {
      ...row,
      kind,
      execution: spellExecutionDefinition(row.spellId),
      label: row.casterLabel ?? row.spellId,
    };
  }
  const row = await db.creatureAreaUse.findUnique({ where: { id } });
  if (!row) return null;
  const definition = creatureAreaDefinitionSchema.parse(row.definition);
  const resolution: SpellResolutionDefinition = {
    kind: 'save-damage',
    ability: definition.saveAbility,
    outcome: { success: definition.onSuccess, failure: 'full' },
    damageRollScope: 'shared',
    damage: { components: definition.damage },
  };
  return {
    ...row,
    kind,
    areaDefinition:definition,
    spellId: row.abilityId,
    execution: { spellId: row.abilityId, resolution },
  };
}
export async function updateSaveDamageSource(
  id: string,
  db: Prisma.TransactionClient,
  kind: SaveDamageSourceKind,
  data: {
    status: string;
    outcome: string;
    resolvedAt: Date;
    resolutionSnapshot: Prisma.InputJsonValue;
  },
) {
  if (kind === 'spell') await db.spellCast.update({ where: { id }, data });
  else await db.creatureAreaUse.update({ where: { id }, data });
}
