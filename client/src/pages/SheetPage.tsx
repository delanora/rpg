import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { AbilitiesSection } from '../components/sections/AbilitiesSection';
import { AttacksSection } from '../components/sections/AttacksSection';
import { FeaturesSection } from '../components/sections/FeaturesSection';
import { IdentitySection } from '../components/sections/IdentitySection';
import { InventorySection } from '../components/sections/InventorySection';
import { NotesSection } from '../components/sections/NotesSection';
import { SkillsSavesSection } from '../components/sections/SkillsSavesSection';
import { SpellsSection } from '../components/sections/SpellsSection';
import { VitalsSection } from '../components/sections/VitalsSection';
import { createSocket } from '../socket';
import type { Character, CharacterPatch, PresencePayload, SessionUser } from '../types';

type ConnectionState = 'connecting' | 'online' | 'offline';

export function SheetPage({ user }: { user: SessionUser }) {
  const { logout } = useAuth();

  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [online, setOnline] = useState<PresencePayload['online']>([]);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  // Carrega a ficha do usuário autenticado.
  useEffect(() => {
    let active = true;

    api<{ character: Character | null }>('/api/characters/me')
      .then((result) => {
        if (active) setCharacter(result.character);
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
  }, []);

  // Conexão de tempo real: presença da mesa e alterações da própria ficha.
  useEffect(() => {
    const socket = createSocket();

    socket.on('connect', () => setConnection('online'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));
    socket.on('presence:update', (payload) => setOnline(payload.online));

    socket.on('sheet:updated', (payload) => {
      setLastEvent(new Date(payload.at).toLocaleTimeString('pt-BR'));
      setCharacter((prev) => {
        // Só aceita a própria ficha e versões mais novas (evita respostas fora de ordem).
        if (!prev || prev.id !== payload.character.id) return prev;
        return payload.character.version >= prev.version ? payload.character : prev;
      });
    });

    return () => {
      socket.close();
    };
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

      // Em caso de erro, recarrega para não deixar a tela divergente do servidor.
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

  const connectionLabel: Record<ConnectionState, string> = {
    connecting: 'conectando...',
    online: 'tempo real ativo',
    offline: 'sem conexão em tempo real',
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-title">
          <h1>🐉 Grimório Digital</h1>
          {character ? <span className="character-name">{character.name}</span> : null}
        </div>

        <div className="app-header-meta">
          <span className={`connection ${connection}`} title={lastEvent ? `Último evento: ${lastEvent}` : undefined}>
            ● {connectionLabel[connection]}
          </span>
          {online.length > 0 ? (
            <span className="online-list" title="Online na mesa">
              {online.map((person) => person.displayName).join(' · ')}
            </span>
          ) : null}
          <span className="user-chip">
            {user.displayName}
            <em className={`role role-${user.role.toLowerCase()}`}>{user.role === 'MASTER' ? 'Mestre' : 'Jogador'}</em>
          </span>
          <button type="button" className="btn btn-small" onClick={logout}>
            sair
          </button>
        </div>
      </header>

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
        ) : !character ? (
          <div className="empty-state">
            <h2>Você ainda não tem uma ficha</h2>
            <p>Crie sua ficha para começar a preencher seus dados de D&amp;D 5e.</p>
            <button type="button" className="btn btn-primary" onClick={createSheet} disabled={busy}>
              {busy ? 'Criando...' : 'Criar minha ficha'}
            </button>
          </div>
        ) : (
          <div className="sheet">
            <IdentitySection character={character} update={update} />
            <AbilitiesSection character={character} update={update} />
            <VitalsSection character={character} update={update} />
            <SkillsSavesSection character={character} update={update} />
            <InventorySection character={character} update={update} />
            <SpellsSection character={character} update={update} />
            <AttacksSection character={character} update={update} />
            <FeaturesSection character={character} update={update} />
            <NotesSection character={character} update={update} />
          </div>
        )}
      </main>
    </div>
  );
}
