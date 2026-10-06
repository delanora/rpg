import { useMemo, useState } from 'react';
import type { Character, Compendium, Creature, Item, Locality, Region } from '../../types';
import { Icon } from '../Icon';
import type { MasterTab } from './MasterHome';
import { MAX_PER_GROUP, buildSearchGroups, filterSearchGroups } from './masterSearchIndex';
import { SearchField } from './SearchField';

interface MasterSearchProps {
  characters: Character[];
  creatures: Creature[];
  npcs: Creature[];
  regions: Region[];
  localities: Locality[];
  items: Item[];
  compendium: Compendium | null;
  /** Abre a aba de onde o resultado veio. */
  onOpenTab: (tab: MasterTab) => void;
}

/**
 * Busca global do salão do mestre.
 *
 * Fica ACIMA do salão e procura em tudo o que as sub-abas guardam (fichas,
 * criaturas, NPCs, regiões com as localidades, itens e o compêndio da Mesa),
 * sobre os dados já carregados no painel — sem rota nova. O resultado sai
 * agrupado por categoria (o cabeçalho e, abaixo, os resultados): um termo que
 * casa em mais de uma categoria aparece em todas elas.
 */
export function MasterSearch({
  characters,
  creatures,
  npcs,
  regions,
  localities,
  items,
  compendium,
  onOpenTab,
}: MasterSearchProps) {
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () => buildSearchGroups({ characters, creatures, npcs, regions, localities, items, compendium }),
    [characters, creatures, npcs, regions, localities, items, compendium],
  );

  const trimmed = query.trim();
  const results = useMemo(() => filterSearchGroups(groups, trimmed), [groups, trimmed]);
  const total = results.reduce((sum, group) => sum + group.hits.length, 0);

  return (
    <div className="home-search">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Buscar em fichas, criaturas, NPCs, regiões, itens e no compêndio"
        label="Buscar em todo o painel do mestre"
      />

      {trimmed ? (
        results.length === 0 ? (
          <p className="home-search-empty">Nada encontrado para “{trimmed}”.</p>
        ) : (
          <div className="home-search-results">
            <p className="home-search-count">
              {total} resultado(s) em {results.length} categoria(s)
            </p>

            {results.map((group) => (
              <section key={group.tab} className="home-search-group">
                <h3 className="home-search-category">
                  <Icon name={group.icon} size={14} /> {group.label}
                  <span className="home-search-badge">{group.hits.length}</span>
                </h3>

                <ul className="home-search-list">
                  {group.hits.slice(0, MAX_PER_GROUP).map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="home-search-hit"
                        title={`Abrir ${group.label}`}
                        onClick={() => onOpenTab(hit.tab)}
                      >
                        <span className="home-search-hit-label">{hit.label}</span>
                        {hit.hint ? (
                          <span className="home-search-hit-hint">{hit.hint}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}

                  {group.hits.length > MAX_PER_GROUP ? (
                    <li className="home-search-more">
                      +{group.hits.length - MAX_PER_GROUP} resultado(s) — abra “{group.label}” para
                      ver todos
                    </li>
                  ) : null}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
