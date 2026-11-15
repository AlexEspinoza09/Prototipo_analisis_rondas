import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { api, getTokens, setTokens } from '../api/client';
import type { TokenPair, User } from '../api/types';
import { setOfflineMode } from '../offline/offlineMode';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** offline = test mode with no backend (only in builds that allow it). */
  login: (email: string, password: string, offline?: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (await getTokens()) {
          setUser(await api<User>('/auth/me'));
        }
      } catch {
        await setTokens(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string, offline = false) => {
    setOfflineMode(offline);
    try {
      const tokens = await api<TokenPair>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await setTokens(tokens);
      setUser(await api<User>('/auth/me'));
    } catch (err) {
      setOfflineMode(false);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await setTokens(null);
    setOfflineMode(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
