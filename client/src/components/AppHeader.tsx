import { useState } from 'react';
import { useAuth } from '../auth';
import { isMuted, toggleMuted } from '../sound';
import { getTheme, toggleTheme, type Theme } from '../theme';
import type { OnlineUser, SessionUser } from '../types';
import type { ConnectionState } from '../useRealtime';
import { Icon } from './Icon';

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

/** Cabeçalho do app: identidade, conexão, presença, tema e saída. */
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
  const [theme, setTheme] = useState<Theme>(getTheme());

  return (
    <header className="app-header">
      <div className="app-header-title">
        <h1>
          <Icon name="dragon" className="brand-mark" size={22} /> Codex do Aventureiro
        </h1>
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
            <Icon name="users" size={14} />
            {online.map((person) => person.displayName).join(' · ')}
          </span>
        ) : null}

        <span className="user-chip">
          {user.displayName}
          <em className={`role role-${user.role.toLowerCase()}`}>
            {user.role === 'MASTER' ? 'Mestre' : 'Jogador'}
          </em>
        </span>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-small theme-toggle"
            title={theme === 'dark' ? 'Modo pergaminho' : 'Grimório amaldiçoado (escuro)'}
            aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            onClick={() => setTheme(toggleTheme())}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>

          <button
            type="button"
            className="btn btn-small"
            title={muted ? 'Ativar sons' : 'Silenciar sons'}
            aria-label={muted ? 'Ativar sons' : 'Silenciar sons'}
            onClick={() => setMuted(toggleMuted())}
          >
            <Icon name={muted ? 'mute' : 'volume'} size={15} />
          </button>

          <button type="button" className="btn btn-small" onClick={logout}>
            sair
          </button>
        </div>
      </div>
    </header>
  );
}
