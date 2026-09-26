import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { CreaturesTab } from '../components/master/CreaturesTab';
import { SheetsTab } from '../components/master/SheetsTab';
import { CombatStartDialog } from '../combat/CombatStartDialog';
import { CombatTracker } from '../combat/CombatTracker';
import { fetchActiveCombat, startCombat } from '../combat/combatApi';
import { useCombatState } from '../combat/useCombatState';
import type { Attack, Character, Creature, CreaturePatch, SessionUser } from '../types';
import { useRealtime } from '../useRealtime';

type Tab = 'sheets' | 'creatures';

const byName = (a: Creature, b: Creature): number => a.name.localeCompare(b.name);

export function MasterPanel({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('sheets');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStartDialog, setShowStartDialog] = useState(false);

  const combatState = useCombatState(user.id);
  const { combat, log, turnAlert, dismissTurnAlert } = combatState;

  const { connection, online, lastEventAt } = useRealtime({
    ...combatState.handlers,

    // Fichas dos jogadores chegam ao vivo — é o requisito central do painel.
    onSheetUpdated: (payload) => {
      setCharacters((prev) => {
        const index = prev.findIndex((character) => character.id === payload.character.id);
        if (index === -1) {
          return [...prev, payload.character].sort((a, b) => a.name.localeCompare(b.name));
        }

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

  // Carga inicial: fichas, bestiário e eventual combate em andamento.
  useEffect(() => {
    let active = true;

    Promise.all([
      api<{ characters: Character[] }>('/api/characters'),
      api<{ creatures: Creature[] }>('/api/creatures'),
      fetchActiveCombat(),
    ])
      .then(([charactersResult, creaturesResult, activeCombat]) => {
        if (!active) return;
        setCharacters(charactersResult.characters);
        setCreatures(creaturesResult.creatures);
        combatState.setCombat(activeCombat);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Localiza os ataques de qualquer combatente para o painel de ataque do mestre. */
  const attacksFor = useCallback(
    (combatantId: string): Attack[] => {
      const combatant = combat?.combatants.find((item) => item.id === combatantId);
      if (!combatant) return [];

      if (combatant.characterId) {
        return (
          characters.find((character) => character.id === combatant.characterId)?.attacks ?? []
        );
      }
      if (combatant.creatureId) {
        return creatures.find((creature) => creature.id === combatant.creatureId)?.attacks ?? [];
      }
      return [];
    },
    [combat, characters, creatures],
  );

  async function handleStartCombat(creatureIds: string[]): Promise<void> {
    const started = await startCombat(creatureIds);
    combatState.setCombat(started);
    setShowStartDialog(false);
  }

  return (
    <div className={combat ? 'app-shell theme-master combat-active' : 'app-shell theme-master'}>
      <AppHeader
        title={combat ? 'Modo de combate' : 'Painel do Mestre'}
        subtitle={
          combat
            ? `rodada ${combat.round} · ${combat.combatants.length} combatente(s)`
            : `${characters.length} ficha(s) · ${creatures.length} criatura(s)`
        }
        connection={connection}
        online={online}
        lastEventAt={lastEventAt}
        user={user}
      />

      {/* Em modo de combate o painel dá lugar ao combate. */}
      {combat ? null : (
        <nav className="tabs tabs-inline">
          <button
            type="button"
            className={tab === 'sheets' ? 'tab active' : 'tab'}
            onClick={() => setTab('sheets')}
          >
            <Icon name="users" size={16} /> Fichas dos jogadores
          </button>
          <button
            type="button"
            className={tab === 'creatures' ? 'tab active' : 'tab'}
            onClick={() => setTab('creatures')}
          >
            <Icon name="flame" size={16} /> Criaturas e NPCs
          </button>

          <button
            type="button"
            className="btn btn-primary btn-combat"
            onClick={() => setShowStartDialog(true)}
          >
            <Icon name="sword" size={16} /> COMBATE
          </button>
        </nav>
      )}

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
        ) : combat ? (
          <CombatTracker
            combat={combat}
            log={log}
            user={user}
            turnAlert={turnAlert}
            onDismissTurnAlert={dismissTurnAlert}
            attacksFor={attacksFor}
            onCombatChange={combatState.setCombat}
            onCombatEnd={() => combatState.setCombat(null)}
            onError={setError}
          />
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

      {showStartDialog ? (
        <CombatStartDialog
          creatures={creatures}
          onCancel={() => setShowStartDialog(false)}
          onStart={handleStartCombat}
        />
      ) : null}
    </div>
  );
}
