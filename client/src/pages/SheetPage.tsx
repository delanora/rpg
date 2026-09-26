import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AppHeader } from '../components/AppHeader';
import { SheetView } from '../components/SheetView';
import { CombatTracker } from '../combat/CombatTracker';
import { fetchActiveCombat } from '../combat/combatApi';
import { useCombatState } from '../combat/useCombatState';
import type { Character, CharacterPatch, SessionUser } from '../types';
import { useRealtime } from '../useRealtime';

export function SheetPage({ user }: { user: SessionUser }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const combatState = useCombatState(user.id);
  const { combat, log, turnAlert, dismissTurnAlert } = combatState;

  const { connection, online, lastEventAt } = useRealtime({
    ...combatState.handlers,

    onSheetUpdated: (payload) => {
      // Só aceita a própria ficha e versões mais novas (evita respostas fora de ordem).
      // Também é por aqui que o dano do combate chega ao HP do jogador.
      setCharacter((prev) => {
        if (!prev || prev.id !== payload.character.id) return prev;
        return payload.character.version >= prev.version ? payload.character : prev;
      });
    },
  });

  // Carrega a ficha do usuário e o eventual combate em andamento.
  useEffect(() => {
    let active = true;

    Promise.all([
      api<{ character: Character | null }>('/api/characters/me'),
      fetchActiveCombat().catch(() => null),
    ])
      .then(([characterResult, activeCombat]) => {
        if (!active) return;
        setCharacter(characterResult.character);
        combatState.setCombat(activeCombat);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar a ficha.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Aplica a edição inline: atualiza a tela na hora (otimista) e envia o PATCH.
   * A resposta do servidor é a fonte de verdade (traz os valores derivados).
   */
  const update = useCallback(async (patch: CharacterPatch) => {
    setCharacter((prev) => (prev ? { ...prev, ...patch } : prev));

    try {
      const { character: saved } = await api<{ character: Character }>('/api/characters/me', {
        method: 'PATCH',
        body: patch,
      });
      setCharacter((prev) => (!prev || saved.version >= prev.version ? saved : prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a alteração.');

      try {
        const fresh = await api<{ character: Character | null }>('/api/characters/me');
        if (fresh.character) {
          setCharacter((prev) =>
            !prev || fresh.character!.version >= prev.version ? fresh.character : prev,
          );
        }
      } catch {
        // Sem rede: mantém o estado local e exibe o erro acima.
      }
    }
  }, []);

  const createSheet = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const { character: created } = await api<{ character: Character }>('/api/characters/me', {
        method: 'POST',
        body: {},
      });
      setCharacter(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a ficha.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="app-shell">
      <AppHeader
        title={combat ? `${character?.name ?? 'Sem ficha'} · em combate` : character ? character.name : 'Sem ficha'}
        connection={connection}
        online={online}
        lastEventAt={lastEventAt}
        user={user}
      />

      {error ? (
        <div className="banner banner-error">
          {error}
          <button type="button" className="btn btn-small" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      ) : null}

      <main className="app-main">
        {loading ? (
          <p className="splash">Carregando a ficha...</p>
        ) : (
          <>
            {combat ? (
              <CombatTracker
                combat={combat}
                log={log}
                user={user}
                turnAlert={turnAlert}
                onDismissTurnAlert={dismissTurnAlert}
                characterAttacks={character?.attacks ?? []}
                onCombatChange={combatState.setCombat}
                onCombatEnd={() => combatState.setCombat(null)}
                onError={setError}
              />
            ) : null}

            {!character ? (
              <div className="empty-state">
                <h2>Você ainda não tem uma ficha</h2>
                <p>Crie sua ficha para começar a preencher seus dados de D&amp;D 5e.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={createSheet}
                  disabled={busy}
                >
                  {busy ? 'Criando...' : 'Criar minha ficha'}
                </button>
              </div>
            ) : (
              <SheetView character={character} update={update} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
