import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { normalizeClassEntries, type ClassEntry } from '../../shared/classes.js';
import { effectiveSpellcasting, findSubclass, getClassDefinition } from '../../shared/classes.js';
import { parseJson } from '../../shared/json.js';
import { abilityModifier } from '../../shared/dnd5e.js';
import { spellsStateSchema, type SpellsStateInput } from '../../characters/characters.schema.js';
import { getSpell } from '../../shared/spells/index.js';
import {
  alwaysPreparedSpellIds,
  manualPreparationLimit,
  maxSpellLevelForSource,
  repertoireDefinitionFor,
  spellOnList,
  type SpellRepertoireDefinition,
  type SpellRepertoireMode,
} from '../../shared/spells/repertoire.js';
import {
  creatureSpellRepertoireOf,
  creatureSpellcastingProfileOf,
  hasCreatureSpellcastingProfile,
} from '../../shared/creature-spellcasting.js';
import {
  spellcastingStartsAtLevel,
  CREATURE_STATBLOCK_SOURCE_ID,
  type SpellcastingSource,
} from './spellcasting-source.js';
import type { MechanicalEntity } from '../../shared/conditions.js';

/**
 * FASE 6.6F — LEITURA do repertório por FONTE.
 *
 * Uma `SourceRepertoireView` é a resposta tipada para "o que esta fonte pode
 * conjurar hoje e o que está planejado?". Ela é montada a partir de UMA fonte de
 * verdade só (`Character.spells.list`, com `classKey`), nunca de uma segunda
 * lista paralela — o mesmo JSONB continua guardando o USO dos espaços.
 *
 * O que cada modo lê da linha persistida:
 *  • `known` (Bardo/Patrulheiro/Feiticeiro/Bruxo/terço) → a própria existência;
 *  • `prepared-list` (Clérigo/Druida/Paladino) → `prepared` (ACTIVE) e
 *    `preparedPlanned` (PLANEJADO);
 *  • `spellbook-prepared` (Mago) → a linha É o grimório; `prepared` é o dia;
 *  • `explicit` (NPC) → `Creature.spellRepertoire.spellIds`.
 *
 * `preparedPlanned` AUSENTE = não há plano salvo para aquela fonte (active é a
 * verdade). Quando existe, salvar o plano marca TODAS as linhas da fonte, então
 * "planejado vazio" é distinguível de "sem plano".
 */

export const SOURCE_NOT_SUPPORTED = 'SPELLCASTING_SOURCE_NOT_SUPPORTED';

type Db = Prisma.TransactionClient | typeof prisma;

/** Uma magia vista por uma fonte (linha persistida + fatos derivados). */
export interface RepertoireSpellView {
  spellId: string;
  name: string;
  level: number;
  /** Pertence à Spell List da fonte (ou é concedida por subclasse). */
  onSourceList: boolean;
  known: boolean;
  recorded: boolean;
  preparedActive: boolean;
  preparedPlanned: boolean;
  /** A fonte tem um PLANO salvo (todas as linhas marcadas). */
  planDefined: boolean;
  alwaysPrepared: boolean;
}

/** Repertório de UMA fonte de conjuração. */
export interface SourceRepertoireView {
  source: SpellcastingSource;
  mode: SpellRepertoireMode;
  definition: SpellRepertoireDefinition;
  /** Chave de classe das linhas persistidas (`fighter` no Cavaleiro Arcano). */
  rowsClassKey: string | null;
  /** Nível NAQUELA classe (nunca o nível total). */
  classLevel: number;
  maxSpellLevel: number;
  /** Limite MANUAL de preparadas (`null` = fonte não prepara). */
  manualLimit: number | null;
  rows: RepertoireSpellView[];
  hasPlan: boolean;
  activeCount: number;
  plannedCount: number;
}

export interface RepertoireSnapshot {
  entity: MechanicalEntity;
  /** Linha do personagem (quando houver) — fonte dos perfis derivados. */
  character: {
    id: string;
    classes: unknown;
    spells: unknown;
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  } | null;
  creature: { id: string; spellcastingProfile: unknown; spellRepertoire: unknown } | null;
  views: SourceRepertoireView[];
}

function spellsListOf(raw: unknown): SpellsStateInput['list'] {
  return parseJson<SpellsStateInput>(spellsStateSchema, raw, {
    list: [],
    slotsUsed: {},
    pactMagic: { used: 0 },
  }).list;
}

/** Fontes de conjuração do personagem COM o nível da própria classe. */
function classSourcesOf(entries: readonly ClassEntry[]): {
  entry: ClassEntry;
  source: SpellcastingSource;
  classKey: string;
  subclassId: string | null;
}[] {
  const sources: { entry: ClassEntry; source: SpellcastingSource; classKey: string; subclassId: string | null }[] = [];
  for (const entry of entries) {
    const definition = getClassDefinition(entry.classKey);
    if (!definition) continue;
    const config = effectiveSpellcasting(entry);
    if (!config || config.type === 'none' || config.ability === null) continue;
    if (entry.level < spellcastingStartsAtLevel(config.type)) continue;
    const subclassDefinition = findSubclass(definition, entry.subclass);
    const fromSubclass = Boolean(subclassDefinition?.spellcasting);
    sources.push({
      entry,
      classKey: entry.classKey,
      subclassId: fromSubclass ? subclassDefinition!.id : null,
      source: {
        kind: fromSubclass ? 'subclass' : 'class',
        id: fromSubclass ? subclassDefinition!.id : definition.key,
        label: fromSubclass ? `${definition.name} (${subclassDefinition!.name})` : definition.name,
        ability: config.ability,
      },
    });
  }
  return sources;
}

/**
 * Monta as views de um PERSONAGEM. As linhas de cada fonte são as do seu
 * `classKey` — o Cavaleiro Arcano lê `fighter`, nunca `eldritch-knight`.
 */
function characterViews(row: RepertoireSnapshot['character'] & object): SourceRepertoireView[] {
  const entries = normalizeClassEntries(row.classes);
  const list = spellsListOf(row.spells);
  const views: SourceRepertoireView[] = [];

  for (const { entry, source, classKey, subclassId } of classSourcesOf(entries)) {
    const definition = repertoireDefinitionFor({ classKey, subclassId });
    if (!definition) continue;

    const alwaysPrepared = alwaysPreparedSpellIds({
      classKey,
      subclassId,
      classLevel: entry.level,
    });
    const maxSpellLevel = maxSpellLevelForSource({
      classKey,
      subclassId,
      level: entry.level,
    });

    const rows: RepertoireSpellView[] = [];
    for (const spell of list) {
      if (spell.classKey !== classKey) continue;
      const resolved = getSpell(spell.id);
      // Linha de magia fora do catálogo é ignorada pelo repertório (texto livre
      // não é conjurável pela engine).
      if (!resolved) continue;
      const granted = alwaysPrepared.includes(resolved.id);
      rows.push({
        spellId: resolved.id,
        name: resolved.namePt,
        level: resolved.level,
        // Elegibilidade pela LISTA da fonte, não por rótulo: uma linha
        // persistida em fonte que não lista a magia não autoriza conjuração
        // (a autorização também reconfere — ver `resolveSpellAuthorization`).
        onSourceList:
          granted ||
          (definition.spellListKey
            ? spellOnList(resolved.id, definition.spellListKey)
            : false),
        known: true,
        recorded: true,
        preparedActive: spell.prepared,
        preparedPlanned: spell.preparedPlanned ?? spell.prepared,
        planDefined: spell.preparedPlanned !== undefined,
        alwaysPrepared: granted,
      });
    }

    // Magias de juramento não estão em `spells.list`: entram como linhas
    // DERIVADAS (sempre preparadas, fora do limite manual).
    for (const spellId of alwaysPrepared) {
      if (rows.some((row) => row.spellId === spellId)) continue;
      const resolved = getSpell(spellId);
      if (!resolved) continue;
      rows.push({
        spellId,
        name: resolved.namePt,
        level: resolved.level,
        onSourceList: true,
        known: true,
        recorded: true,
        preparedActive: true,
        preparedPlanned: true,
        planDefined: false,
        alwaysPrepared: true,
      });
    }

    const hasPlan = rows.some((row) => row.planDefined);
    views.push({
      source,
      mode: definition.mode,
      definition,
      rowsClassKey: classKey,
      classLevel: entry.level,
      maxSpellLevel,
      // Limite MANUAL derivado do NÍVEL DA FONTE + modificador da fonte (nunca
      // o nível total: Wizard 3 / Cleric 2 tem dois limites independentes).
      manualLimit:
        definition.preparation === null
          ? null
          : manualPreparationLimit({
              formula: definition.preparation,
              level: entry.level,
              abilityModifier: source.ability ? abilityModifier(row[source.ability]) : 0,
            }),
      rows,
      hasPlan,
      activeCount: rows.filter((row) => row.preparedActive).length,
      plannedCount: rows.filter((row) => row.preparedPlanned).length,
    });
  }
  return views;
}

/**
 * View da fonte EXPLÍCITA do statblock. Sem perfil de conjuração utilizável não
 * existe fonte; sem repertório declarado, a view existe mas não autoriza nada.
 */
function creatureViews(row: {
  id: string;
  spellcastingProfile: unknown;
  spellRepertoire: unknown;
}): SourceRepertoireView[] {
  if (!hasCreatureSpellcastingProfile(row.spellcastingProfile)) return [];
  const profile = creatureSpellcastingProfileOf(row.spellcastingProfile);
  const declared = creatureSpellRepertoireOf(row.spellRepertoire).spellIds;
  const rows: RepertoireSpellView[] = [];
  for (const spellId of declared) {
    const spell = getSpell(spellId);
    if (!spell) continue;
    rows.push({
      spellId,
      name: spell.namePt,
      level: spell.level,
      onSourceList: true,
      known: true,
      recorded: true,
      preparedActive: true,
      preparedPlanned: true,
      planDefined: false,
      alwaysPrepared: false,
    });
  }
  return [
    {
      source: {
        kind: 'creature',
        id: CREATURE_STATBLOCK_SOURCE_ID,
        label: 'Statblock',
        ability: profile.ability ?? null,
      },
      mode: 'explicit',
      definition: {
        mode: 'explicit',
        spellListKey: null,
        preparation: null,
        cantripMode: 'known',
      },
      rowsClassKey: null,
      classLevel: 0,
      maxSpellLevel: 9,
      manualLimit: null,
      rows,
      hasPlan: false,
      activeCount: rows.length,
      plannedCount: rows.length,
    },
  ];
}

/**
 * Snapshot do repertório do conjurador, CANONICALIZADO: combatente de personagem
 * lê a FICHA (o mesmo personagem nunca tem dois repertórios), e combatente de
 * criatura lê o TEMPLATE (repertório é do statblock; gasto é da instância).
 */
export async function loadRepertoire(
  entity: MechanicalEntity,
  db: Db = prisma,
): Promise<RepertoireSnapshot> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return { entity, character: row, creature: null, views: characterViews(row) };
  }

  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return { entity, character: null, creature: row, views: creatureViews(row) };
  }

  const combatant = await db.combatant.findUnique({
    where: { id: entity.id },
    include: { creature: true },
  });
  if (!combatant) throw new HttpError('Instância não encontrada.', 404);
  if (combatant.characterId) {
    const row = await db.character.findUnique({ where: { id: combatant.characterId } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return {
      entity: { kind: 'character', id: row.id },
      character: row,
      creature: null,
      views: characterViews(row),
    };
  }
  if (!combatant.creature) return { entity, character: null, creature: null, views: [] };
  return {
    entity,
    character: null,
    creature: combatant.creature,
    views: creatureViews(combatant.creature),
  };
}

/** Linha do repertório de uma magia em uma fonte (`null` = não há linha). */
export function repertoireRowOf(
  view: SourceRepertoireView,
  spellId: string,
): RepertoireSpellView | null {
  return view.rows.find((row) => row.spellId === spellId) ?? null;
}
