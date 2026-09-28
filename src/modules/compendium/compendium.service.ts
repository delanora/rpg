import { CLASS_DEFINITIONS } from '../shared/classes/index.js';
import { BACKGROUND_CATALOG, RACE_CATALOG } from '../shared/creation.js';
import type {
  CompendiumBackgroundDto,
  CompendiumClassDto,
  CompendiumDto,
  CompendiumFeatureDto,
  CompendiumRaceDto,
  CompendiumSpellDto,
  CompendiumSubclassDto,
} from './compendium.dto.js';

/**
 * Catálogo de magias — ainda VAZIO de propósito.
 *
 * O ambiente já está preparado (tipo, rota e aba de consulta no painel do
 * mestre); o conteúdo entra numa etapa seguinte, sem mexer no contrato com o
 * cliente. Enquanto isso, a aba mostra o estado vazio.
 */
const SPELL_CATALOG: CompendiumSpellDto[] = [];

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

function toRace(race: (typeof RACE_CATALOG)[number]): CompendiumRaceDto {
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
 * Fonte única do que a aba de configurações mostra: hoje lê os catálogos
 * estáticos; no futuro, quando o mestre puder criar raças e antecedentes, esta
 * é a única função que precisa mudar de fonte (banco em vez de constante).
 */
export function getCompendium(): CompendiumDto {
  return {
    classes: CLASS_DEFINITIONS.map(toClass),
    races: RACE_CATALOG.map(toRace),
    backgrounds: BACKGROUND_CATALOG.map(toBackground),
    spells: SPELL_CATALOG,
  };
}
