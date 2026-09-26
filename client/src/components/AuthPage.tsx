import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { Icon } from './Icon';

type Mode = 'login' | 'register';

export function AuthPage() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register({
          username,
          displayName,
          password,
          ...(inviteCode.trim() ? { masterInviteCode: inviteCode.trim() } : {}),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha inesperada.');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode): void {
    setMode(next);
    setError(null);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-crest">
          <span className="auth-crest-swords">
            <Icon name="sword" size={32} />
            <Icon name="sword" size={32} />
          </span>
        </div>
        <h1>Codex do Aventureiro</h1>

        <div className="tabs">
          <button
            type="button"
            className={mode === 'login' ? 'tab active' : 'tab'}
            onClick={() => switchMode('login')}
          >
            Entrar
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'tab active' : 'tab'}
            onClick={() => switchMode('register')}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field">
            <span>Usuário</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              minLength={3}
            />
          </label>

          {mode === 'register' ? (
            <label className="field">
              <span>Nome de exibição</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Como você aparece na mesa"
                required
              />
            </label>
          ) : null}

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : 1}
            />
          </label>

          {mode === 'register' ? (
            <label className="field">
              <span>Código de mestre (opcional)</span>
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="Preencha apenas se você é o mestre"
              />
            </label>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  );
}
