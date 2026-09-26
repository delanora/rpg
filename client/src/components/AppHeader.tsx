import { useState } from 'react';
import { useAuth } from '../auth';
import { isMuted, toggleMuted } from '../sound';
import type { OnlineUser, SessionUser } from '../types';
import type { ConnectionState } from '../useRealtime';

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'conectando...',
  online: 'tempo real ativo',
  offline: 'sem conexão em tempo real',
};

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  connection: ConnectionState;
  online: OnlineUser[];
  lastEventAt: string | null;
  user: SessionUser;
}

/** Cabeçalho do app: identidade, conexão, presença e saída. */
export function AppHeader({
  title,
  subtitle,
  connection,
  online,
  lastEventAt,
  user,
}: AppHeaderProps) {
  const { logout } = useAuth();
  const [muted, setMuted] = useState(isMuted());

  return (
    <header className="app-header">
      <div className="app-header-title">
        <h1>🐉 Grimório Digital</h1>
        <span className="character-name">{title}</span>
        {subtitle ? <span className="character-name">{subtitle}</span> : null}
      </div>

      <div className="app-header-meta">
        <span
          className={`connection ${connection}`}
          title={lastEventAt ? `Último evento: ${new Date(lastEventAt).toLocaleTimeString('pt-BR')}` : undefined}
        >
          ● {CONNECTION_LABELS[connection]}
        </span>

        {online.length > 0 ? (
          <span className="online-list" title="Online na mesa">
            {online.map((person) => person.displayName).join(' · ')}
          </span>
        ) : null}

        <span className="user-chip">
          {user.displayName}
          <em className={`role role-${user.role.toLowerCase()}`}>
            {user.role === 'MASTER' ? 'Mestre' : 'Jogador'}
          </em>
        </span>

        <button
          type="button"
          className="btn btn-small"
          title={muted ? 'Ativar sons' : 'Silenciar sons'}
          aria-label={muted ? 'Ativar sons' : 'Silenciar sons'}
          onClick={() => setMuted(toggleMuted())}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        <button type="button" className="btn btn-small" onClick={logout}>
          sair
        </button>
      </div>
    </header>
  );
}
