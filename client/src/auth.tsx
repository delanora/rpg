import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchCurrentUser,
  getToken,
  login as apiLogin,
  register as apiRegister,
  setToken,
  type RegisterInput,
} from './api';
import type { SessionUser } from './types';

interface AuthContextValue {
  user: SessionUser | null;
  /** Verdadeiro enquanto a sessão salva é validada na abertura do app. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Ao abrir o app, valida o token guardado e recupera o usuário.
  useEffect(() => {
    let active = true;

    if (!getToken()) {
      setLoading(false);
      return;
    }

    fetchCurrentUser()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {
        setToken(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user: logged } = await apiLogin(username, password);
    setToken(token);
    setUser(logged);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const { token, user: created } = await apiRegister(input);
    setToken(token);
    setUser(created);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return context;
}
