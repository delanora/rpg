import { categoryLabel, describeItemDetails, rarityLabel } from '../../dnd';
import type { Character, Compendium, Creature, Item, Locality, Region } from '../../types';
import type { IconName } from '../Icon';
import type { MasterTab } from './MasterHome';
import { matchesSearch } from './search';

/** Um resultado da busca global: o que mostrar e para onde ele leva. */
export interface SearchHit {
  id: string;
  label: string;
  hint: string;
  tab: MasterTab;
  /** Campos consultados pela busca (não aparecem na tela). */
  fields: (string | number | null | undefined)[];
}

/** Uma categoria de resultado — o cabeçalho e os resultados logo abaixo. */
export interface SearchGroup {
  tab: MasterTab;
  label: string;
  icon: IconName;
  hits: SearchHit[];
}

/** Tudo o que a busca consulta; vem do painel, já carregado. */
export interface MasterSearchData {
  characters: Character[];
  creatures: Creature[];
  npcs: Creature[];
  regions: Region[];
  localities: Locality[];
  items: Item[];
  compendium: Compendium | null;
}

/** Teto de resultados por categoria; o resto fica na própria aba. */
export const MAX_PER_GROUP = 6;

/** Junta as partes de uma pista, descartando as vazias. */
function joinHint(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** Encurta textos longos (descrições) para a pista do resultado. */
function clip(text: string | null | undefined, max = 70): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Indexa tudo o que as sub-abas guardam, uma categoria por aba: fichas,
 * criaturas, NPCs, regiões (com as localidades), itens e o compêndio da Mesa.
 *
 * É puro de propósito: nenhuma chamada de rede, só os dados já carregados no
 * painel — e dá para exercitar o índice sem renderizar nada.
 */
export function buildSearchGroups(data: MasterSearchData): SearchGroup[] {
  const { characters, creatures, npcs, regions, localities, items, compendium } = data;
  const regionNameOf = new Map(regions.map((region) => [region.id, region.name]));

  const creatureHits = (list: Creature[], tab: MasterTab): SearchHit[] =>
    list.map((creature) => ({
      id: `${tab}:${creature.id}`,
      label: creature.name,
      hint: joinHint([
        creature.type || 'sem tipo',
        creature.challengeRating ? `ND ${creature.challengeRating}` : null,
        `CA ${creature.armorClass}`,
        creature.localities.map((locality) => locality.name).join(', '),
      ]),
      tab,
      fields: [
        creature.name,
        creature.type,
        creature.challengeRating,
        creature.description,
        ...creature.localities.map((locality) => locality.name),
      ],
    }));

  return [
    {
      tab: 'sheets',
      label: 'Fichas',
      icon: 'users',
      hits: characters.map((character) => ({
        id: `sheets:${character.id}`,
        label: character.name,
        hint: joinHint([
          character.ownerUsername ? `jogador: ${character.ownerUsername}` : null,
          character.className || 'sem classe',
          `Nv ${character.level}`,
          `CA ${character.armorClass}`,
        ]),
        tab: 'sheets',
        fields: [character.name, character.ownerUsername, character.className, character.race],
      })),
    },
    {
      tab: 'creatures',
      label: 'Criaturas',
      icon: 'flame',
      hits: creatureHits(creatures, 'creatures'),
    },
    {
      tab: 'npcs',
      label: 'NPCs',
      icon: 'crown',
      hits: creatureHits(npcs, 'npcs'),
    },
    {
      tab: 'regions',
      label: 'Regiões',
      icon: 'book',
      hits: [
        ...regions.map(
          (region): SearchHit => ({
            id: `region:${region.id}`,
            label: region.name,
            hint: joinHint([`${region.localityCount} localidade(s)`, clip(region.description)]),
            tab: 'regions',
            fields: [region.name, region.description, region.notes],
          }),
        ),
        ...localities.map((locality): SearchHit => {
          const regionName = regionNameOf.get(locality.regionId);
          return {
            id: `locality:${locality.id}`,
            label: locality.name,
            hint: joinHint([
              regionName ? `Localidade de ${regionName}` : 'Localidade',
              clip(locality.description),
            ]),
            tab: 'regions',
            fields: [locality.name, locality.description, regionName],
          };
        }),
      ],
    },
    {
      tab: 'items',
      label: 'Itens',
      icon: 'flask',
      hits: items.map((item) => ({
        id: `items:${item.id}`,
        label: item.name,
        hint: joinHint([
          categoryLabel(item.category),
          rarityLabel(item.rarity),
          describeItemDetails(item.category, item.details),
        ]),
        tab: 'items',
        fields: [
          item.name,
          item.category,
          categoryLabel(item.category),
          rarityLabel(item.rarity),
          item.description,
          describeItemDetails(item.category, item.details),
        ],
      })),
    },
    {
      tab: 'config',
      label: 'Mesa',
      icon: 'gear',
      hits: [
        ...(compendium?.classes ?? []).map(
          (entry): SearchHit => ({
            id: `class:${entry.key}`,
            label: entry.name,
            hint: joinHint(['Classe', `d${entry.hitDie}`, ...entry.subclasses.map((item) => item.name)]),
            tab: 'config',
            fields: [entry.name, entry.description, ...entry.subclasses.map((item) => item.name)],
          }),
        ),
        ...(compendium?.races ?? []).map(
          (race): SearchHit => ({
            id: `race:${race.key}`,
            label: race.name,
            hint: joinHint(['Linhagem', race.baseRace, clip(race.description)]),
            tab: 'config',
            fields: [race.name, race.baseRace, race.description],
          }),
        ),
        ...(compendium?.backgrounds ?? []).map(
          (background): SearchHit => ({
            id: `background:${background.key}`,
            label: background.name,
            hint: joinHint(['Antecedente', ...background.skills]),
            tab: 'config',
            fields: [background.name, background.description, ...background.skills],
          }),
        ),
        ...(compendium?.spells ?? []).map(
          (spell): SearchHit => ({
            id: `spell:${spell.key}`,
            label: spell.name,
            hint: joinHint([
              spell.level === 0 ? 'Truque' : `Magia de ${spell.level}º nível`,
              spell.school,
              spell.damageSummary,
              spell.healingSummary,
            ]),
            tab: 'config',
            fields: [
              spell.name,
              spell.nameEn,
              spell.school,
              spell.description,
              spell.damageSummary,
              spell.healingSummary,
            ],
          }),
        ),
      ],
    },
  ];
}

/**
 * Filtra o índice pela consulta. Cada categoria é filtrada por conta própria:
 * um termo que casa em mais de uma categoria aparece em TODAS elas, e as
 * categorias sem resultado somem da lista.
 */
export function filterSearchGroups(groups: SearchGroup[], query: string): SearchGroup[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return groups
    .map((group) => ({
      ...group,
      hits: group.hits.filter((hit) => matchesSearch(trimmed, ...hit.fields)),
    }))
    .filter((group) => group.hits.length > 0);
}
