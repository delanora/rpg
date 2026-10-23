import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import type { Creature, Locality, Region } from '../types';
import type { CombatCreatureEntry } from './combatApi';

interface CombatStartDialogProps {
  localities: Locality[];
  /** Regiões, para mostrar a qual delas cada localidade pertence. */
  regions: Region[];
  /** Criaturas-template E NPCs persistentes (o `kind` separa os dois). */
  creatures: Creature[];
  onCancel: () => void;
  onStart: (input: {
    localityId?: string;
    entries: CombatCreatureEntry[];
  }) => Promise<void>;
}

const MAX_QUANTITY = 30;

type KindFilter = 'ALL' | 'CREATURE' | 'NPC';

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'ALL', label: 'Todos' },
  { key: 'CREATURE', label: 'Criaturas' },
  { key: 'NPC', label: 'NPCs' },
];

/**
 * Preparação do combate.
 *
 * TRÊS filtros CUMULATIVOS:
 * • TIPO (Todos / Criaturas / NPCs);
 * • LOCALIDADE (o seletor de antes continua; sem localidade a busca é global);
 * • NOME (busca parcial, sem diferenciar maiúsculas).
 *
 * Regra de quantidade:
 * • criatura-template gera N cópias independentes (Goblin 1, Goblin 2...);
 * • NPC persistente entra UMA única vez — a interface só permite selecionar,
 *   e o SERVIDOR recusa duplicata/quantidade > 1 (409 com mensagem clara).
 */
export function CombatStartDialog({
  localities,
  regions,
  creatures,
  onCancel,
  onStart,
}: CombatStartDialogProps) {
  const [localityQuery, setLocalityQuery] = useState('');
  const [localityId, setLocalityId] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [nameQuery, setNameQuery] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = localities.find((locality) => locality.id === localityId) ?? null;
  const regionName = (locality: Locality): string =>
    regions.find((region) => region.id === locality.regionId)?.name ?? '';

  const suggestions = useMemo(() => {
    const term = localityQuery.trim().toLowerCase();
    const pool = term
      ? localities.filter((locality) => locality.name.toLowerCase().includes(term))
      : localities;
    return pool.slice(0, 8);
  }, [localityQuery, localities]);

  /**
   * BUSCA + FILTROS. O dataset já vem inteiro no painel do Mestre (é pequeno),
   * então filtrar no cliente é adequado — nada de endpoint novo.
   */
  const available = useMemo(() => {
    const term = nameQuery.trim().toLowerCase();
    return creatures.filter((creature) => {
      if (kindFilter !== 'ALL' && creature.kind !== kindFilter) return false;
      if (term && !creature.name.toLowerCase().includes(term)) return false;
      if (selected && !creature.localities.some((locality) => locality.id === selected.id)) {
        return false;
      }
      return true;
    });
  }, [creatures, kindFilter, nameQuery, selected]);

  const total = creatures.reduce((sum, creature) => sum + (quantities[creature.id] ?? 0), 0);
  const selectedNpcs = creatures.filter(
    (creature) => creature.kind === 'NPC' && (quantities[creature.id] ?? 0) > 0,
  ).length;

  function chooseLocality(locality: Locality): void {
    setLocalityId(locality.id);
    setLocalityQuery(locality.name);
  }

  function clearLocality(): void {
    setLocalityId('');
    setLocalityQuery('');
  }

  function setQuantity(creature: Creature, value: number): void {
    // NPC: sempre 0 ou 1 — nunca uma segunda cópia.
    const cap = creature.kind === 'NPC' ? 1 : MAX_QUANTITY;
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(cap, Math.trunc(value))) : 0;
    setQuantities((previous) => ({ ...previous, [creature.id]: safe }));
  }

  async function handleStart(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const entries = creatures
        .map((creature) => ({
          creatureId: creature.id,
          // O servidor também normaliza/recusa; aqui já mandamos a regra certa.
          quantity: creature.kind === 'NPC' ? Math.min(1, quantities[creature.id] ?? 0) : quantities[creature.id] ?? 0,
        }))
        .filter((entry) => entry.quantity > 0);

      await onStart({ ...(localityId ? { localityId } : {}), entries });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o combate.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <h2>
          <Icon name="sword" size={20} /> Preparar combate
        </h2>
        <p className="section-subtitle">
          Escolha onde a batalha acontece e quem entra. Os personagens de jogador entram
          automaticamente.
        </p>

        {/* Filtro por TIPO. */}
        <div className="combat-pick-filters" role="group" aria-label="Filtrar por tipo">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={kindFilter === filter.key ? 'btn btn-small active' : 'btn btn-small'}
              aria-pressed={kindFilter === filter.key}
              onClick={() => setKindFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* LOCALIDADE — continua existindo e nunca é substituída pela busca. */}
        <label className="field">
          <span>Localidade</span>
          <input
            type="search"
            className="inline-input"
            value={localityQuery}
            placeholder="digite para buscar a localidade..."
            onChange={(event) => {
              setLocalityQuery(event.target.value);
              setLocalityId('');
            }}
          />
        </label>

        {selected ? (
          <p className="section-note">
            Local escolhido: <strong>{selected.name}</strong>
            {regionName(selected) ? ` · ${regionName(selected)}` : ''}{' '}
            <button type="button" className="btn btn-small" onClick={clearLocality}>
              todas as localidades
            </button>
          </p>
        ) : localityQuery.trim() ? (
          suggestions.length === 0 ? (
            <p className="empty-hint">Nenhuma localidade encontrada.</p>
          ) : (
            <ul className="suggestion-list">
              {suggestions.map((locality) => (
                <li key={locality.id}>
                  <button
                    type="button"
                    className="suggestion"
                    onClick={() => chooseLocality(locality)}
                  >
                    <Icon name="scroll" size={14} />
                    <span className="suggestion-name">{locality.name}</span>
                    <span className="muted">
                      {regionName(locality) ? `${regionName(locality)} · ` : ''}
                      {locality.creatureCount} criatura(s)/NPC(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="section-note">
            Sem localidade selecionada, a busca procura entre todas as criaturas e NPCs.
          </p>
        )}

        {/* BUSCA POR NOME — parcial e sem diferenciar maiúsculas. */}
        <label className="field">
          <span>Buscar por nome</span>
          <input
            type="search"
            className="inline-input"
            value={nameQuery}
            placeholder="ex.: gob, bart..."
            onChange={(event) => setNameQuery(event.target.value)}
          />
        </label>

        {available.length === 0 ? (
          <p className="empty-hint">
            Nenhuma criatura ou NPC corresponde aos filtros. Ajuste o tipo, a localidade
            ou o nome.
          </p>
        ) : (
          <ul className="modal-list combat-pick-list">
            {available.map((creature) => {
              const quantity = quantities[creature.id] ?? 0;
              const isNpc = creature.kind === 'NPC';
              return (
                <li key={creature.id}>
                  <div className="check-row quantity-row">
                    <span className="check-name">
                      <Portrait
                        src={creature.imageUrl}
                        alt=""
                        size="sm"
                        icon={isNpc ? 'scroll' : 'flame'}
                      />
                      <span className="name-text">{creature.name}</span>
                    </span>
                    <span className="combat-pick-meta">
                      <span className={isNpc ? 'tag npc' : 'tag'}>{isNpc ? 'NPC' : 'Criatura'}</span>
                      <span className="muted">
                        {creature.localities.length > 0
                          ? creature.localities.map((locality) => locality.name).join(', ')
                          : 'sem localidade'}
                      </span>
                      <span className="muted">
                        HP {creature.hpMax} · CA {creature.effectiveArmorClass ?? creature.armorClass}
                        {creature.challengeRating ? ` · ND ${creature.challengeRating}` : ''}
                      </span>
                    </span>
                    {isNpc ? (
                      <button
                        type="button"
                        className={quantity > 0 ? 'btn btn-small active' : 'btn btn-small'}
                        aria-pressed={quantity > 0}
                        onClick={() => setQuantity(creature, quantity > 0 ? 0 : 1)}
                      >
                        {quantity > 0 ? 'no combate' : 'adicionar'}
                      </button>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={MAX_QUANTITY}
                        value={quantity}
                        aria-label={`Quantidade de ${creature.name}`}
                        onChange={(event) => setQuantity(creature, Number(event.target.value))}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {selectedNpcs > 0 ? (
          <p className="section-note">
            Cada NPC entra uma única vez no combate; criaturas-template podem ter várias
            cópias.
          </p>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleStart()}
            disabled={busy}
          >
            {busy ? 'iniciando...' : `iniciar combate (${total} combatente(s))`}
          </button>
        </div>
      </div>
    </div>
  );
}
