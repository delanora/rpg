import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { availableAttacks } from '../ammo';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { PresentationOverlay } from '../components/PresentationOverlay';
import { ConfigTab } from '../components/master/ConfigTab';
import { CreaturesTab } from '../components/master/CreaturesTab';
import { MasterNotes } from '../components/master/MasterNotes';
import { RollLogPanel } from '../components/master/RollLogPanel';
import { ItemsTab } from '../components/master/ItemsTab';
import { RegionsTab } from '../components/master/RegionsTab';
import { SheetsTab } from '../components/master/SheetsTab';
import { CombatStartDialog } from '../combat/CombatStartDialog';
import { CombatTracker } from '../combat/CombatTracker';
import { fetchActiveCombat, startCombat, type CombatCreatureEntry } from '../combat/combatApi';
import { useCombatState } from '../combat/useCombatState';
import { DiceDock } from '../dice/DiceDock';
import { useDiceRoller } from '../dice/useDiceRoller';
import { fetchGameConfig, releaseLevelUp, setExtraCoins, setStartingLevel } from '../gameApi';
import { closePresentation } from '../presentationApi';
import type {
  Attack,
  Character,
  CharacterPatch,
  Creature,
  CreatureKind,
  CreaturePatch,
  GameConfig,
  Item,
  ItemPatch,
  LevelDownRequest,
  LevelDownResult,
  Locality,
  LocalityPatch,
  Presentation,
  Region,
  RegionPatch,
  SessionUser,
} from '../types';
import { useRealtime } from '../useRealtime';

type Tab = 'sheets' | 'creatures' | 'npcs' | 'regions' | 'items' | 'config';

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

export function MasterPanel({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('sheets');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  // Configuração da mesa: controle de Level Up liberado.
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  // Painéis flutuantes do mestre: o log de rolagens e as anotações da mesa.
  // Abrem UM por vez, no mesmo espaço acima dos botões flutuantes.
  const [logOpen, setLogOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const combatState = useCombatState(user.id);
  const { combat, log, turnAlert, dismissTurnAlert } = combatState;

  // Janela de dados: rolagem livre (pública/privada), avisos e log da sessão.
  const dice = useDiceRoller(user);

  const { connection, online, lastEventAt } = useRealtime({
    ...combatState.handlers,
    ...dice.handlers,

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

    // O mestre excluiu um personagem (junto com a conta do jogador): a ficha
    // sai da lista e o combatente dela sai do combate em andamento.
    onCharacterDeleted: (payload) => {
      setCharacters((prev) => prev.filter((character) => character.id !== payload.characterId));
      if (combat) {
        void fetchActiveCombat()
          .then(combatState.setCombat)
          .catch(() => undefined);
      }
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

    onRegionCreated: (payload) => {
      setRegions((prev) =>
        prev.some((region) => region.id === payload.region.id)
          ? prev
          : [...prev, payload.region].sort(byName),
      );
    },
    onRegionUpdated: (payload) => {
      setRegions((prev) =>
        prev.map((region) => (region.id === payload.region.id ? payload.region : region)),
      );
    },
    onRegionDeleted: (payload) => {
      setRegions((prev) => prev.filter((region) => region.id !== payload.regionId));
      // As localidades da região caem junto (cascade no banco).
      setLocalities((prev) => prev.filter((locality) => locality.regionId !== payload.regionId));
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

    // Configuração da mesa (Level Up liberado) — acompanha mudanças.
    onGameConfig: (payload) => setGameConfig(payload.config),
  });

  // Carga inicial: fichas, bestiário, localidades e eventual combate em andamento.
  useEffect(() => {
    let active = true;

    Promise.all([
      api<{ characters: Character[] }>('/api/characters'),
      api<{ creatures: Creature[] }>('/api/creatures'),
      api<{ regions: Region[] }>('/api/regions'),
      api<{ localities: Locality[] }>('/api/localities'),
      api<{ items: Item[] }>('/api/items'),
      fetchActiveCombat(),
      fetchGameConfig().catch(() => null),
    ])
      .then(
        ([
          charactersResult,
          creaturesResult,
          regionsResult,
          localitiesResult,
          itemsResult,
          activeCombat,
          config,
        ]) => {
          if (!active) return;
          setCharacters(charactersResult.characters);
          setCreatures(creaturesResult.creatures);
          setRegions(regionsResult.regions);
          setLocalities(localitiesResult.localities);
          setItems(itemsResult.items);
          combatState.setCombat(activeCombat);
          setGameConfig(config);
        },
      )
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

  /**
   * Libera UM Level Up para a mesa. Cada clique é uma liberação nova, então o
   * mestre não precisa bloquear nada antes: quem já subiu de nível volta a ver
   * o botão habilitado no próximo clique.
   */
  const releaseLevelUpForTable = useCallback(async () => {
    try {
      const config = await releaseLevelUp();
      setGameConfig(config);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao liberar o Level Up.');
    }
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

  const createRegion = useCallback(async (): Promise<Region> => {
    const { region } = await api<{ region: Region }>('/api/regions', {
      method: 'POST',
      body: { name: 'Nova região' },
    });
    setRegions((prev) =>
      prev.some((item) => item.id === region.id) ? prev : [...prev, region].sort(byName),
    );
    return region;
  }, []);

  const patchRegion = useCallback(async (id: string, patch: RegionPatch) => {
    setRegions((prev) => prev.map((region) => (region.id === id ? { ...region, ...patch } : region)));

    try {
      const { region } = await api<{ region: Region }>(`/api/regions/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      setRegions((prev) => prev.map((item) => (item.id === id ? region : item)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a região.');
    }
  }, []);

  const deleteRegion = useCallback(async (id: string) => {
    setRegions((prev) => prev.filter((region) => region.id !== id));
    // As localidades dentro dela somem junto (cascade no banco).
    setLocalities((prev) => prev.filter((locality) => locality.regionId !== id));

    try {
      await api(`/api/regions/${id}`, { method: 'DELETE' });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover a região.');
    }
  }, []);

  /** Cria uma localidade já dentro da região aberta. */
  const createLocality = useCallback(async (regionId: string): Promise<Locality> => {
    const { locality } = await api<{ locality: Locality }>('/api/localities', {
      method: 'POST',
      body: { name: 'Nova localidade', regionId },
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
      prev.map((character) =>
        character.id === id ? { ...character, ...patch, classes: character.classes } : character,
      ),
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

  /**
   * Exclui um personagem: no servidor vão embora a ficha **e a conta do
   * jogador** (`DELETE /api/characters/:id`). A confirmação fica no diálogo da
   * aba Fichas; aqui não tratamos o erro de propósito — ele é do diálogo, que
   * precisa continuar aberto para o mestre tentar de novo.
   */
  const deleteCharacter = useCallback(async (id: string) => {
    await api(`/api/characters/${id}`, { method: 'DELETE' });
    // Otimista: o evento `character:deleted` confirma e mantém as outras abas
    // em dia (o servidor também refaz o combate anunciado).
    setCharacters((prev) => prev.filter((character) => character.id !== id));
  }, []);

  /**
   * Devolve a ficha ao assistente de criação: `creationFinalized` volta para
   * `false` e o jogador reencontra o wizard no próximo acesso, com o que já
   * existia preenchido. Só o mestre pode fazer isso.
   */
  const reopenCreation = useCallback(async (id: string) => {
    try {
      const { character } = await api<{ character: Character }>(
        `/api/characters/${id}/creation/reopen`,
        { method: 'POST' },
      );
      setCharacters((prev) =>
        prev.map((item) => (item.id === id ? character : item)),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reabrir a criação.');
    }
  }, []);

  /**
   * Ação de moedas devolve a ficha inteira (gastar/trocar/transferir/dar): a
   * lista do painel adota a versão nova.
   */
  /**
   * O mestre REDUZ um nível de um personagem (`POST /api/characters/:id/level-down`).
   *
   * É o inverso do Level Up: o servidor desfaz o que aquele nível concedeu (PV
   * rolado, Aumento de Atributo/Talento, escolhas, subclasse, perícia e
   * proficiências) e devolve a ficha já revertida, que a lista adota.
   *
   * O erro NÃO é engolido aqui: a janela do downgrade mostra a mensagem.
   */
  const levelDown = useCallback(
    async (id: string, request: LevelDownRequest): Promise<LevelDownResult> => {
      const result = await api<LevelDownResult>(`/api/characters/${id}/level-down`, {
        method: 'POST',
        body: request,
      });
      setCharacters((prev) => prev.map((item) => (item.id === id ? result.character : item)));
      return result;
    },
    [],
  );

  const adoptCoins = useCallback((character: Character) => {
    setCharacters((prev) => prev.map((item) => (item.id === character.id ? character : item)));
  }, []);

  /** Liga/desliga PL e PE no bloco de moedas das fichas. */
  const changeExtraCoins = useCallback(async (enabled: boolean) => {
    try {
      const config = await setExtraCoins(enabled);
      setGameConfig(config);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alternar as moedas extras.');
    }
  }, []);

  /** Nível inicial da mesa: o assistente de criação aplica os níveis até ele. */
  const changeStartingLevel = useCallback(async (level: number) => {
    try {
      const config = await setStartingLevel(level);
      setGameConfig(config);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao definir o nível inicial.');
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
        const character = characters.find((item) => item.id === combatant.characterId);
        if (!character) return [];
        // Ataques de arma não equipada não aparecem (regra da munição); os
        // derivados das armas equipadas entram junto (e os bloqueados somem).
        return availableAttacks(
          [...character.attacks, ...character.derivedAttacks],
          character.inventory,
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
            className={tab === 'regions' ? 'tab active' : 'tab'}
            onClick={() => setTab('regions')}
          >
            <Icon name="book" size={16} /> Regiões
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
            className={tab === 'config' ? 'tab active' : 'tab'}
            onClick={() => setTab('config')}
          >
            <Icon name="table" size={16} /> Mesa
          </button>

          {/* Cada clique libera UM Level Up por jogador: não há mais bloquear. */}
          <button
            type="button"
            className="btn btn-levelup"
            onClick={() => void releaseLevelUpForTable()}
            title={`Libera um Level Up para quem ainda não usou a liberação atual. Liberações dadas: ${gameConfig?.levelUpRelease ?? 0}.`}
          >
            <Icon name="sparkle" size={16} /> LIBERAR LEVEL UP
            {gameConfig ? <span className="config-count">{gameConfig.levelUpRelease}</span> : null}
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
          <SheetsTab
            characters={characters}
            onUpdate={patchCharacter}
            onDelete={deleteCharacter}
            onReopenCreation={reopenCreation}
            onLevelDown={levelDown}
            extraCoins={gameConfig?.extraCoins ?? false}
            onCoinsChange={adoptCoins}
          />
        ) : tab === 'regions' ? (
          <RegionsTab
            regions={regions}
            localities={localities}
            creatures={creatures}
            onCreate={createRegion}
            onPatch={patchRegion}
            onDelete={deleteRegion}
            onCreateLocality={createLocality}
            onPatchLocality={patchLocality}
            onDeleteLocality={deleteLocality}
          />
        ) : tab === 'config' ? (
          <ConfigTab
            startingLevel={gameConfig?.startingLevel ?? 1}
            onChangeStartingLevel={changeStartingLevel}
            extraCoins={gameConfig?.extraCoins ?? false}
            onChangeExtraCoins={changeExtraCoins}
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
            regions={regions}
            onCreate={createCreature}
            onPatch={patchCreature}
            onDelete={deleteCreature}
          />
        )}
      </main>

      {showStartDialog ? (
        <CombatStartDialog
          localities={localities}
          regions={regions}
          creatures={monsters}
          onCancel={() => setShowStartDialog(false)}
          onStart={handleStartCombat}
        />
      ) : null}

      {/* Botão "Dados" sempre disponível, inclusive em combate. */}
      <DiceDock roller={dice} />

      {/* Pilha flutuante do mestre, no canto inferior esquerdo: o LOG abre
          acima do botão dos dados e as ANOTAÇÕES ficam abaixo dele. */}
      <RollLogPanel
        history={dice.history}
        open={logOpen}
        onToggle={() => {
          setNotesOpen(false);
          setLogOpen((value) => !value);
        }}
        onClose={() => setLogOpen(false)}
        onClear={dice.clearHistory}
      />
      <MasterNotes
        open={notesOpen}
        onToggle={() => {
          setLogOpen(false);
          setNotesOpen((value) => !value);
        }}
        onClose={() => setNotesOpen(false)}
      />
    </div>
  );
}
