import { z } from 'zod';
import {
  ABILITY_KEYS,
  abilityModifier,
  proficiencyBonus,
  type AbilityKey,
} from '../../shared/dnd5e.js';
import {
  effectiveSpellcasting,
  findSubclass,
  getClassDefinition,
  type ClassEntry,
} from '../../shared/classes.js';
import type { SpellcastingType } from '../../shared/classes/types.js';
import {
  creatureSpellcastingProfileOf,
  hasCreatureSpellcastingProfile,
} from '../../shared/creature-spellcasting.js';

/**
 * FASE 6.6B — SPELLCASTING SOURCE, SPELL SAVE DC e SPELL ATTACK BONUS.
 *
 * A CONJURAÇÃO não tem um atributo único no personagem: ela depende da FONTE
 * pela qual a magia é conjurada (multiclasse Mago/Clérigo usa INT e SAB em
 * fontes diferentes). Por isso a identidade é `{ kind, id }` — nunca o rótulo
 * localizado e nunca uma `spellcastingAbility` global da ficha.
 *
 * Fontes que esta fase resolve de verdade:
 *  • `class` / `subclass` — do registro de classes do personagem (a subclasse
 *    sobrepõe a classe: Cavaleiro Arcano/Trapaceiro Arcano são terço-conjuradores);
 *  • `creature` — perfil EXPLÍCITO do statblock (`saveDc`/`attackBonus`/`ability`).
 *
 * `racial`, `feat`, `item`, `feature` e `manual` ficam no enum (a engine cresce
 * sem migration), mas NÃO são resolvidos nesta fase. Magias raciais continuam no
 * DTO da ficha (selo "Raça") e itens/talentos entram em fase própria.
 *
 * Fonte NÃO é elegibilidade: ela responde "qual matemática de conjuração está
 * sendo usada?", não "o personagem pode legalmente conjurar esta magia?".
 * Known/prepared só existem com o cast de PLAYER (6.6F).
 */

export const SPELLCASTING_SOURCE_KINDS = [
  'class',
  'subclass',
  'creature',
  'racial',
  'feat',
  'item',
  'feature',
  'manual',
] as const;

export type SpellcastingSourceKind = (typeof SPELLCASTING_SOURCE_KINDS)[number];

/** Identidade ESTÁVEL da fonte (`kind` + `id`), usada no request e no snapshot. */
export const spellcastingSourceRefSchema = z.object({
  kind: z.enum(SPELLCASTING_SOURCE_KINDS),
  id: z.string().trim().min(1).max(64),
});
export type SpellcastingSourceRef = z.infer<typeof spellcastingSourceRefSchema>;

export interface SpellcastingSource {
  kind: SpellcastingSourceKind;
  /** `classKey` (classe), id da subclasse ou `statblock` (criatura). */
  id: string;
  /** APRESENTAÇÃO ("Mago"). Nunca identidade. */
  label: string;
  ability: AbilityKey | null;
}

/**
 * Perfil DERIVADO (personagem: PB do nível TOTAL) ou EXPLÍCITO (statblock:
 * valores publicados). Os campos derivados são nulos no modo explícito quando o
 * statblock não os publica — ninguém inventa a matemática de monstro aqui.
 */
export interface SpellcastingProfile {
  mode: 'derived' | 'explicit';
  source: SpellcastingSource;
  ability: AbilityKey | null;
  abilityScore: number | null;
  abilityModifier: number | null;
  proficiencyBonus: number | null;
  /** SEMPRE presente: toda fonte utilizável precisa de uma CD de magia. */
  spellSaveDc: number;
  /** Pode faltar num statblock que só publica a CD. */
  spellAttackBonus: number | null;
}

/** Fonte de uma criatura/NPC: o statblock dela (nunca o template no cast). */
export const CREATURE_STATBLOCK_SOURCE_ID = 'statblock';

/**
 * Nível em que a conjuração daquele TIPO começa (PHB 2014):
 * meio-conjuradores (Paladino/Patrulheiro) no 2º; terço-conjuradores
 * (Cavaleiro Arcano/Trapaceiro Arcano) no 3º; completos/pacto no 1º.
 *
 * Regra CENTRAL derivada do tipo declarado pela classe — não de `if className`.
 */
export function spellcastingStartsAtLevel(type: SpellcastingType): number {
  if (type === 'half') return 2;
  if (type === 'third') return 3;
  return 1;
}

/** CD de magia = 8 + proficiência + modificador do atributo (PHB 2014). */
export function spellSaveDcFrom(proficiency: number, abilityMod: number): number {
  return 8 + proficiency + abilityMod;
}

/** Ataque mágico = proficiência + modificador do atributo (PHB 2014). */
export function spellAttackBonusFrom(proficiency: number, abilityMod: number): number {
  return proficiency + abilityMod;
}

/** Entradas de classe lidas do JSONB da ficha, sem confiar no formato. */
function classEntriesOf(input: unknown): ClassEntry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as { classKey?: unknown; subclass?: unknown; level?: unknown };
    if (typeof item.classKey !== 'string' || item.classKey.trim() === '') return [];
    return [
      {
        classKey: item.classKey,
        subclass: typeof item.subclass === 'string' ? item.subclass : '',
        level: typeof item.level === 'number' ? item.level : 1,
      },
    ];
  });
}

/** Nível TOTAL do personagem (soma das classes), nunca o nível de UMA classe. */
export function characterLevelOf(classes: unknown): number {
  const total = classEntriesOf(classes).reduce((sum, entry) => sum + (entry.level ?? 1), 0);
  return Math.max(1, Math.min(20, total));
}

/**
 * Fontes de conjuração REAIS do personagem.
 *
 * Fighter/Rogue comuns não aparecem (a classe é `none`); o Cavaleiro Arcano e o
 * Trapaceiro Arcano aparecem como fonte de SUBCLASSE, com INT e a partir do
 * nível 3. Paladino/Patrulheiro só a partir do nível 2 da classe.
 */
export function spellcastingSourcesForCharacter(character: { classes: unknown }): SpellcastingSource[] {
  const sources: SpellcastingSource[] = [];
  for (const entry of classEntriesOf(character.classes)) {
    const definition = getClassDefinition(entry.classKey);
    if (!definition) continue;
    const config = effectiveSpellcasting(entry);
    if (!config || config.type === 'none' || config.ability === null) continue;
    const level = entry.level ?? 1;
    if (level < spellcastingStartsAtLevel(config.type)) continue;

    const subclassDefinition = findSubclass(definition, entry.subclass);
    const fromSubclass = Boolean(subclassDefinition?.spellcasting);
    sources.push({
      kind: fromSubclass ? 'subclass' : 'class',
      id: fromSubclass ? subclassDefinition!.id : definition.key,
      label: fromSubclass ? `${definition.name} (${subclassDefinition!.name})` : definition.name,
      ability: config.ability,
    });
  }
  return sources;
}

export interface CharacterSpellcastingRow {
  classes: unknown;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

/**
 * Perfil DERIVADO de um personagem para UMA fonte.
 *
 * O bônus de proficiência vem do nível TOTAL do personagem — Wizard 3 / Cleric 2
 * = nível 5 = +3 para as DUAS fontes. O atributo vem da fonte (INT para Mago,
 * SAB para Clérigo). Modificador negativo é permitido (sem clamp).
 */
export function characterSpellcastingProfile(
  character: CharacterSpellcastingRow,
  source: SpellcastingSource,
): SpellcastingProfile {
  const ability = source.ability;
  const score = ability ? character[ability] : null;
  const abilityMod = score === null ? null : abilityModifier(score);
  const proficiency = proficiencyBonus(characterLevelOf(character.classes));
  if (ability === null || score === null || abilityMod === null) {
    throw new Error('Fonte de conjuração de personagem sem atributo.');
  }
  return {
    mode: 'derived',
    source,
    ability,
    abilityScore: score,
    abilityModifier: abilityMod,
    proficiencyBonus: proficiency,
    spellSaveDc: spellSaveDcFrom(proficiency, abilityMod),
    spellAttackBonus: spellAttackBonusFrom(proficiency, abilityMod),
  };
}

/** Fonte do statblock, quando ele publica uma CD utilizável. */
export function creatureSpellcastingSources(creature: { spellcastingProfile: unknown }): SpellcastingSource[] {
  if (!hasCreatureSpellcastingProfile(creature.spellcastingProfile)) return [];
  const profile = creatureSpellcastingProfileOf(creature.spellcastingProfile);
  return [
    {
      kind: 'creature',
      id: CREATURE_STATBLOCK_SOURCE_ID,
      label: 'Statblock',
      ability: profile.ability ?? null,
    },
  ];
}

/**
 * Perfil EXPLÍCITO do statblock: a CD publicada é a autoridade (mesmo que a
 * fórmula de personagem sugerisse outro número). Sem `ability`, o modificador e
 * a proficiência ficam nulos — o ataque mágico só existe se for explícito.
 */
export function creatureSpellcastingProfile(creature: {
  spellcastingProfile: unknown;
}): SpellcastingProfile | null {
  const stored = creatureSpellcastingProfileOf(creature.spellcastingProfile);
  if (stored.saveDc === undefined) return null;
  const ability = stored.ability ?? null;
  return {
    mode: 'explicit',
    source: {
      kind: 'creature',
      id: CREATURE_STATBLOCK_SOURCE_ID,
      label: 'Statblock',
      ability,
    },
    ability,
    abilityScore: null,
    abilityModifier: null,
    proficiencyBonus: null,
    spellSaveDc: stored.saveDc,
    spellAttackBonus: stored.attackBonus ?? null,
  };
}

/** Lista de atributos aceitos (reexportada para as validações de borda). */
export const SPELLCASTING_ABILITIES = ABILITY_KEYS;
