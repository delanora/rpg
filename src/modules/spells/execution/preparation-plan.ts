import { normalizeClassEntries, effectiveSpellcasting, findSubclass, getClassDefinition } from '../../shared/classes.js';
import type { AbilityKey } from '../../shared/dnd5e.js';
import { abilityModifier } from '../../shared/dnd5e.js';
import type { SpellsStateInput } from '../../characters/characters.schema.js';

/** Linha de magia da ficha (formato canônico de `spells.list`). */
type SpellRow = SpellsStateInput['list'][number];
import {
  alwaysPreparedSpellIds,
  manualPreparationLimit,
  maxSpellLevelForSource,
  planCandidates,
  planPreparationProblem,
  repertoireDefinitionFor,
} from '../../shared/spells/repertoire.js';

/**
 * FASE 6.6F — ATIVAÇÃO do plano de preparação no Descanso Longo.
 *
 * Decisão de produto do projeto: o jogador PLANEJA quando quiser; a preparação
 * MECÂNICA (ACTIVE) só muda ao concluir um Descanso Longo VÁLIDO. Não existe
 * timer, nem "minuto por magia": a conclusão do descanso é a fronteira.
 *
 * O plano é REVALIDADO aqui porque o mundo mudou desde que foi salvo: atributo
 * pode ter caído, nível de classe pode ter descido, a subclasse pode ter mudado
 * ou o grimório encolheu. Se o plano ficou inválido, o Descanso Longo NÃO é
 * corrompido: a preparação ACTIVE anterior é preservada, o plano continua
 * gravado (o jogador corrige) e a fonte é reportada como inválida — nada é
 * escolhido no lugar dele.
 */

export interface PreparationActivation {
  /** Lista nova (pronta para gravar). */
  list: SpellRow[];
  /** Fontes cujo plano virou ACTIVE. */
  activated: { sourceId: string; spellIds: string[] }[];
  /** Fontes cujo plano foi recusado (active preservado). */
  invalid: { sourceId: string; reason: string }[];
}

export function activatePreparationPlans(input: {
  spells: SpellsStateInput;
  classes: unknown;
  abilityScores: Record<AbilityKey, number>;
}): PreparationActivation {
  const list: SpellRow[] = input.spells.list.map((spell) => ({ ...spell }));
  const activated: PreparationActivation['activated'] = [];
  const invalid: PreparationActivation['invalid'] = [];

  for (const entry of normalizeClassEntries(input.classes)) {
    const definition = getClassDefinition(entry.classKey);
    if (!definition) continue;
    const config = effectiveSpellcasting(entry);
    if (!config || config.type === 'none' || config.ability === null) continue;
    const subclassDefinition = findSubclass(definition, entry.subclass);
    const subclassId = subclassDefinition?.spellcasting ? subclassDefinition.id : null;
    const repertoire = repertoireDefinitionFor({ classKey: entry.classKey, subclassId });
    if (!repertoire || repertoire.preparation === null) continue;

    const rows = list.filter((spell) => spell.classKey === entry.classKey);
    // Sem plano salvo (`preparedPlanned` ausente em todas as linhas) = active é
    // a verdade e o descanso não mexe.
    if (!rows.some((spell) => spell.preparedPlanned !== undefined)) continue;

    const sourceId = subclassId ?? entry.classKey;
    const plannedIds = rows.filter((spell) => spell.preparedPlanned === true).map((spell) => spell.id);
    const alwaysPrepared = alwaysPreparedSpellIds({
      classKey: entry.classKey,
      subclassId,
      classLevel: entry.level,
    });
    // Magias sempre preparadas não ocupam o limite manual.
    const manualIds = plannedIds.filter((spellId) => !alwaysPrepared.includes(spellId));
    const limit = manualPreparationLimit({
      formula: repertoire.preparation,
      level: entry.level,
      abilityModifier: abilityModifier(input.abilityScores[config.ability]),
    });

    const candidates = planCandidates({
      definition: repertoire,
      maxSpellLevel: maxSpellLevelForSource({
        classKey: entry.classKey,
        subclassId,
        level: entry.level,
      }),
      rows: rows.map((spell) => ({ spellId: spell.id, level: spell.level })),
    });

    const problem = planPreparationProblem({
      definition: repertoire,
      spells: candidates,
      spellIds: manualIds,
      maxSpellLevel: maxSpellLevelForSource({
        classKey: entry.classKey,
        subclassId,
        level: entry.level,
      }),
      manualLimit: limit,
    });

    if (problem) {
      invalid.push({ sourceId, reason: problem });
      continue;
    }

    for (const spell of rows) {
      spell.prepared = spell.preparedPlanned === true;
      delete spell.preparedPlanned;
    }
    activated.push({ sourceId, spellIds: plannedIds });
  }

  return { list, activated, invalid };
}
