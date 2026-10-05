import { CLASS_DEFINITIONS } from '../shared/classes/index.js';
import { BACKGROUND_CATALOG, RACE_CATALOG, type RaceOption } from '../shared/creation.js';
import { allWeapons } from '../shared/weapons/index.js';
import { listCustomRaceOptions } from '../custom-races/custom-races.service.js';
import { damageExpression, damageIsEmpty, type Damage } from '../shared/attacks.js';
import { SPELL_SCHOOL_LABELS, SPELLS, type Spell } from '../shared/spells/index.js';
import type {
  CompendiumBackgroundDto,
  CompendiumClassDto,
  CompendiumDto,
  CompendiumFeatureDto,
  CompendiumRaceDto,
  CompendiumSpellDto,
  CompendiumSubclassDto,
} from './compendium.dto.js';

/** Resumo legível de uma parcela de dano (ex.: "8d6 de fogo"). */
function damageSummaryPart(damage: Damage): string {
  const expression = damageExpression(damage);
  return damage.type ? `${expression} de ${damage.type.toLowerCase()}` : expression;
}

/** Resumo do dano da magia, juntando as parcelas (ex.: "4d6 de fogo + 4d6 de radiante"). */
function spellDamageSummary(spell: Spell): string | null {
  const damages = (spell.damage ?? []).filter((damage) => !damageIsEmpty(damage));
  if (damages.length === 0) return null;
  return damages.map(damageSummaryPart).join(' + ');
}

/** Converte uma magia do catálogo no formato do compêndio. */
function toSpell(spell: Spell): CompendiumSpellDto {
  return {
    key: spell.id,
    name: spell.namePt,
    nameEn: spell.nameEn,
    level: spell.level,
    school: SPELL_SCHOOL_LABELS[spell.school],
    castingTime: spell.castingTime,
    range: spell.range,
    components: spell.componentsText,
    duration: spell.duration,
    concentration: spell.concentration,
    ritual: spell.ritual,
    description: spell.description,
    damageSummary: spellDamageSummary(spell),
    healingSummary:
      spell.healing && !damageIsEmpty(spell.healing) ? damageExpression(spell.healing) : null,
    classes: [...spell.classes],
  };
}

/** Converte uma característica de classe/subclasse no formato do compêndio. */
function toFeature(feature: {
  id: string;
  name: string;
  level: number;
  description: string;
}): CompendiumFeatureDto {
  return {
    id: feature.id,
    name: feature.name,
    level: feature.level,
    description: feature.description,
  };
}

function toClass(definition: (typeof CLASS_DEFINITIONS)[number]): CompendiumClassDto {
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    hitDie: definition.hitDie,
    savingThrows: [...definition.savingThrows],
    subclassLevel: definition.subclassLevel,
    spellcasting: { ...definition.spellcasting },
    features: definition.features.map(toFeature),
    subclasses: definition.subclasses.map(
      (subclass): CompendiumSubclassDto => ({
        id: subclass.id,
        name: subclass.name,
        description: subclass.description,
        features: subclass.features.map(toFeature),
      }),
    ),
  };
}

function toRace(race: RaceOption): CompendiumRaceDto {
  return {
    key: race.key,
    name: race.name,
    baseRace: race.baseRace ?? null,
    description: race.description ?? null,
    abilityBonuses: { ...(race.abilityBonuses ?? {}) },
    abilityChoice: race.abilityChoice ?? 0,
  };
}

function toBackground(background: (typeof BACKGROUND_CATALOG)[number]): CompendiumBackgroundDto {
  return {
    key: background.key,
    name: background.name,
    description: background.description ?? null,
    skills: [...(background.skills ?? [])],
  };
}

/**
 * Monta o compêndio completo.
 *
 * Fonte única do que a aba de configurações mostra. Desde o Prompt 2.10 as
 * RAÇAS vêm do catálogo estruturado (`shared/races/`) mais as raças
 * PERSONALIZADAS do mestre (banco); antecedentes e magias seguem estáticos.
 */
export async function getCompendium(): Promise<CompendiumDto> {
  const customOptions = await listCustomRaceOptions();
  return {
    classes: CLASS_DEFINITIONS.map(toClass),
    races: [...RACE_CATALOG, ...customOptions].map(toRace),
    backgrounds: BACKGROUND_CATALOG.map(toBackground),
    spells: SPELLS.map(toSpell),
    weapons: allWeapons(),
  };
}
