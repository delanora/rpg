import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AppHeader } from '../components/AppHeader';
import { CreaturesTab } from '../components/master/CreaturesTab';
import { SheetsTab } from '../components/master/SheetsTab';
import type { Character, Creature, CreaturePatch, SessionUser } from '../types';
import { useRealtime } from '../useRealtime';

type Tab = 'sheets' | 'creatures';

const byName = (a: Creature, b: Creature): number => a.name.localeCompare(b.name);

export function MasterPanel({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('sheets');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { connection, online, lastEventAt } = useRealtime({
    // Fichas dos jogadores chegam ao vivo — é o requisito central do painel.
    onSheetUpdated: (payload) => {
      setCharacters((prev) => {
        const index = prev.findIndex((character) => character.id === payload.character.id);
        if (index === -1) return [...prev, payload.character].sort((a, b) => a.name.localeCompare(b.name));

        const next = [...prev];
        if (payload.character.version >= next[index].version) next[index] = payload.character;
        return next;
      });
    },

    onCreatureCreated: (payload) => {
      setCreatures((prev) =>
        prev.some((creature) => creature.id === payload.creature.id)
          ? prev
          : [...prev, payload.creature].sort(byName),
      );
    },
    onCreatureUpdated: (payload) => {
      setCreatures((prev) =>
        prev.map((creature) => (creature.id === payload.creature.id ? payload.creature : creature)),
      );
    },
    onCreatureDeleted: (payload) => {
      setCreatures((prev) => prev.filter((creature) => creature.id !== payload.creatureId));
    },
  });

  // Carga inicial das fichas e do bestiário.
  useEffect(() => {
    let active = true;

    Promise.all([
      api<{ characters: Character[] }>('/api/characters'),
      api<{ creatures: Creature[] }>('/api/creatures'),
    ])
      .then(([charactersResult, creaturesResult]) => {
        if (!active) return;
        setCharacters(charactersResult.characters);
        setCreatures(creaturesResult.creatures);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar o painel.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const createCreature = useCallback(async (): Promise<Creature> => {
    const { creature } = await api<{ creature: Creature }>('/api/creatures', {
      method: 'POST',
      body: {},
    });
    setCreatures((prev) =>
      prev.some((item) => item.id === creature.id) ? prev : [...prev, creature].sort(byName),
    );
    return creature;
  }, []);

  const patchCreature = useCallback(async (id: string, patch: CreaturePatch) => {
    setCreatures((prev) =>
      prev.map((creature) => (creature.id === id ? { ...creature, ...patch } : creature)),
    );

    try {
      const { creature } = await api<{ creature: Creature }>(`/api/creatures/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      setCreatures((prev) => prev.map((item) => (item.id === id ? creature : item)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a criatura.');
    }
  }, []);

  const deleteCreature = useCallback(async (id: string) => {
    setCreatures((prev) => prev.filter((creature) => creature.id !== id));

    try {
      await api(`/api/creatures/${id}`, { method: 'DELETE' });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover a criatura.');
    }
  }, []);

  return (
    <div className="app-shell">
      <AppHeader
        title="Painel do Mestre"
        subtitle={`${characters.length} ficha(s) · ${creatures.length} criatura(s)`}
        connection={connection}
        online={online}
        lastEventAt={lastEventAt}
        user={user}
      />

      <nav className="tabs tabs-inline">
        <button
          type="button"
          className={tab === 'sheets' ? 'tab active' : 'tab'}
          onClick={() => setTab('sheets')}
        >
          Fichas dos jogadores
        </button>
        <button
          type="button"
          className={tab === 'creatures' ? 'tab active' : 'tab'}
          onClick={() => setTab('creatures')}
        >
          Criaturas e NPCs
        </button>
      </nav>

      {error ? (
        <div className="banner banner-error">
          {error}
          <button type="button" className="btn btn-small" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      ) : null}

      <main className="app-main app-main-wide">
        {loading ? (
          <p className="splash">Carregando o painel...</p>
        ) : tab === 'sheets' ? (
          <SheetsTab characters={characters} />
        ) : (
          <CreaturesTab
            creatures={creatures}
            onCreate={createCreature}
            onPatch={patchCreature}
            onDelete={deleteCreature}
          />
        )}
      </main>
    </div>
  );
}
