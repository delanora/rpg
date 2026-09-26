import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { PresentationOverlay } from '../components/PresentationOverlay';
import { CreaturesTab } from '../components/master/CreaturesTab';
import { ItemsTab } from '../components/master/ItemsTab';
import { LocalitiesTab } from '../components/master/LocalitiesTab';
import { SheetsTab } from '../components/master/SheetsTab';
import { CombatStartDialog } from '../combat/CombatStartDialog';
import { CombatTracker } from '../combat/CombatTracker';
import { fetchActiveCombat, startCombat, type CombatCreatureEntry } from '../combat/combatApi';
import { useCombatState } from '../combat/useCombatState';
import { closePresentation } from '../presentationApi';
import type {
  Attack,
  Character,
  CharacterPatch,
  Creature,
  CreatureKind,
  CreaturePatch,
  Item,
  ItemPatch,
  Locality,
  LocalityPatch,
  Presentation,
  SessionUser,
} from '../types';
import { useRealtime } from '../useRealtime';

type Tab = 'sheets' | 'creatures' | 'npcs' | 'localities' | 'items';

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

export function MasterPanel({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('sheets');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [presentation, setPresentation] = useState<Presentation | null>(null);

  const combatState = useCombatState(user.id);
  const { combat, log, turnAlert, dismissTurnAlert } = combatState;

  const { connection, online, lastEventAt } = useRealtime({
    ...combatState.handlers,

    // Fichas dos jogadores chegam ao vivo — é o requisito central do painel.
    onSheetUpdated: (payload) => {
      setCharacters((prev) => {
        const index = prev.findIndex((character) => character.id === payload.character.id);
        if (index === -1) {
          return [...prev, payload.character].sort(byName);
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

    onLocalityCreated: (payload) => {
      setLocalities((prev) =>
        prev.some((locality) => locality.id === payload.locality.id)
          ? prev
          : [...prev, payload.locality].sort(byName),
      );
    },
    onLocalityUpdated: (payload) => {
      setLocalities((prev) =>
        prev.map((locality) => (locality.id === payload.locality.id ? payload.locality : locality)),
      );
    },
    onLocalityDeleted: (payload) => {
      setLocalities((prev) => prev.filter((locality) => locality.id !== payload.localityId));
    },

    onItemCreated: (payload) => {
      setItems((prev) =>
        prev.some((item) => item.id === payload.item.id)
          ? prev
          : [...prev, payload.item].sort(byName),
      );
    },
    onItemUpdated: (payload) => {
      setItems((prev) => prev.map((item) => (item.id === payload.item.id ? payload.item : item)));
    },
    onItemDeleted: (payload) => {
      setItems((prev) => prev.filter((item) => item.id !== payload.itemId));
    },

    // Imagem que este mestre mostrou para a mesa (também aparece para ele,
    // que é quem fecha).
    onPresentationShown: (payload) => setPresentation(payload.presentation),
    onPresentationClosed: () => setPresentation(null),
  });

  // Carga inicial: fichas, bestiário, localidades e eventual combate em andamento.
  useEffect(() => {
    let active = true;

    Promise.all([
      api<{ characters: Character[] }>('/api/characters'),
      api<{ creatures: Creature[] }>('/api/creatures'),
      api<{ localities: Locality[] }>('/api/localities'),
      api<{ items: Item[] }>('/api/items'),
      fetchActiveCombat(),
    ])
      .then(([charactersResult, creaturesResult, localitiesResult, itemsResult, activeCombat]) => {
        if (!active) return;
        setCharacters(charactersResult.characters);
        setCreatures(creaturesResult.creatures);
        setLocalities(localitiesResult.localities);
        setItems(itemsResult.items);
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

  /** Fechamento da imagem apresentada — só o mestre tem esta ação. */
  const closePresentedImage = useCallback(() => {
    void closePresentation().catch(() => setPresentation(null));
  }, []);

  const createCreature = useCallback(
    async (localityId: string): Promise<Creature> => {
      const kind: CreatureKind = tab === 'npcs' ? 'NPC' : 'CREATURE';
      const { creature } = await api<{ creature: Creature }>('/api/creatures', {
        method: 'POST',
        body: { kind, localityIds: [localityId] },
      });
      setCreatures((prev) =>
        prev.some((item) => item.id === creature.id) ? prev : [...prev, creature].sort(byName),
      );
      return creature;
    },
    [tab],
  );

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

  const createLocality = useCallback(async (): Promise<Locality> => {
    const { locality } = await api<{ locality: Locality }>('/api/localities', {
      method: 'POST',
      body: { name: 'Nova localidade' },
    });
    setLocalities((prev) =>
      prev.some((item) => item.id === locality.id) ? prev : [...prev, locality].sort(byName),
    );
    return locality;
  }, []);

  const patchLocality = useCallback(async (id: string, patch: LocalityPatch) => {
    setLocalities((prev) =>
      prev.map((locality) => (locality.id === id ? { ...locality, ...patch } : locality)),
    );

    try {
      const { locality } = await api<{ locality: Locality }>(`/api/localities/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      setLocalities((prev) => prev.map((item) => (item.id === id ? locality : item)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a localidade.');
    }
  }, []);

  const deleteLocality = useCallback(async (id: string) => {
    setLocalities((prev) => prev.filter((locality) => locality.id !== id));

    try {
      await api(`/api/localities/${id}`, { method: 'DELETE' });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover a localidade.');
    }
  }, []);

  /**
   * Edição da ficha de um jogador pelo mestre.
   *
   * Otimista como as demais: a tela muda na hora e a resposta do servidor
   * (com os valores derivados recalculados) confirma. Se outra alteração mais
   * nova chegar antes, ela prevalece.
   */
  const patchCharacter = useCallback(async (id: string, patch: CharacterPatch) => {
    setCharacters((prev) =>
      prev.map((character) => (character.id === id ? { ...character, ...patch } : character)),
    );

    try {
      const { character } = await api<{ character: Character }>(`/api/characters/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      setCharacters((prev) =>
        prev.map((entry) =>
          entry.id === id && character.version >= entry.version ? character : entry,
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a ficha do jogador.');

      // Recarrega a lista para desfazer a alteração otimista que não subiu.
      try {
        const fresh = await api<{ characters: Character[] }>('/api/characters');
        setCharacters(fresh.characters);
      } catch {
        // Sem rede: mantém o estado local e mostra o erro acima.
      }
    }
  }, []);

  const createItem = useCallback(async (): Promise<Item> => {
    const { item } = await api<{ item: Item }>('/api/items', {
      method: 'POST',
      body: { name: 'Novo item' },
    });
    setItems((prev) =>
      prev.some((entry) => entry.id === item.id) ? prev : [...prev, item].sort(byName),
    );
    return item;
  }, []);

  const patchItem = useCallback(async (id: string, patch: ItemPatch) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

    try {
      const { item } = await api<{ item: Item }>(`/api/items/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      setItems((prev) => prev.map((entry) => (entry.id === id ? item : entry)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o item.');
    }
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));

    try {
      await api(`/api/items/${id}`, { method: 'DELETE' });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover o item.');
    }
  }, []);

  const sendItem = useCallback(
    async (itemId: string, characterId: string, quantity: number) => {
      await api(`/api/items/${itemId}/send`, {
        method: 'POST',
        body: { characterId, quantity },
      });
    },
    [],
  );

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

  async function handleStartCombat(input: {
    localityId?: string;
    entries: CombatCreatureEntry[];
  }): Promise<void> {
    const started = await startCombat(input);
    combatState.setCombat(started);
    setShowStartDialog(false);
  }

  const monsters = creatures.filter((creature) => creature.kind === 'CREATURE');
  const npcs = creatures.filter((creature) => creature.kind === 'NPC');

  return (
    <div className={combat ? 'app-shell theme-master combat-active' : 'app-shell theme-master'}>
      <PresentationOverlay
        presentation={presentation}
        isMaster={user.role === 'MASTER'}
        onClose={closePresentedImage}
      />

      <AppHeader
        title={combat ? 'Modo de combate' : 'Painel do Mestre'}
        subtitle={
          combat
            ? `rodada ${combat.round} · ${combat.combatants.length} combatente(s)`
            : `${characters.length} ficha(s) · ${monsters.length} criatura(s) · ${npcs.length} NPC(s)`
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
            <Icon name="users" size={16} /> Fichas
          </button>
          <button
            type="button"
            className={tab === 'creatures' ? 'tab active' : 'tab'}
            onClick={() => setTab('creatures')}
          >
            <Icon name="flame" size={16} /> Criaturas
          </button>
          <button
            type="button"
            className={tab === 'npcs' ? 'tab active' : 'tab'}
            onClick={() => setTab('npcs')}
          >
            <Icon name="crown" size={16} /> NPCs
          </button>
          <button
            type="button"
            className={tab === 'localities' ? 'tab active' : 'tab'}
            onClick={() => setTab('localities')}
          >
            <Icon name="scroll" size={16} /> Localidades
          </button>
          <button
            type="button"
            className={tab === 'items' ? 'tab active' : 'tab'}
            onClick={() => setTab('items')}
          >
            <Icon name="flask" size={16} /> Itens
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
          <SheetsTab characters={characters} onUpdate={patchCharacter} />
        ) : tab === 'localities' ? (
          <LocalitiesTab
            localities={localities}
            creatures={creatures}
            onCreate={createLocality}
            onPatch={patchLocality}
            onDelete={deleteLocality}
          />
        ) : tab === 'items' ? (
          <ItemsTab
            items={items}
            characters={characters}
            onCreate={createItem}
            onPatch={patchItem}
            onDelete={deleteItem}
            onSend={sendItem}
          />
        ) : (
          <CreaturesTab
            kind={tab === 'npcs' ? 'NPC' : 'CREATURE'}
            creatures={tab === 'npcs' ? npcs : monsters}
            localities={localities}
            onCreate={createCreature}
            onPatch={patchCreature}
            onDelete={deleteCreature}
          />
        )}
      </main>

      {showStartDialog ? (
        <CombatStartDialog
          localities={localities}
          creatures={monsters}
          onCancel={() => setShowStartDialog(false)}
          onStart={handleStartCombat}
        />
      ) : null}
    </div>
  );
}
