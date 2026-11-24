import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, api } from './api';
import { sessionStorageToken } from './session-storage';
import type { AuthenticatedUser } from './types';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  status: AuthStatus;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestApi<T>(operation: (token: string) => Promise<T>): Promise<T>;
  retrySession(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);

  const clearSession = useCallback(() => {
    sessionStorageToken.clear();
    setToken(null);
    setUser(null);
    setError(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const storedToken = sessionStorageToken.get();
        if (!storedToken) {
          if (active) setStatus('anonymous');
          return;
        }
        const currentUser = await api.me(storedToken);
        if (active) {
          setToken(storedToken);
          setUser(currentUser);
          setStatus('authenticated');
        }
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) {
          clearSession();
          return;
        }
        setError(reason instanceof Error ? reason.message : 'No se pudo validar la sesión.');
        setStatus('error');
      }
    };
    void restoreSession();
    return () => {
      active = false;
    };
  }, [clearSession, validationAttempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    sessionStorageToken.set(result.token);
    setToken(result.token);
    try {
      const currentUser = await api.me(result.token);
      setUser(currentUser);
      setError(null);
      setStatus('authenticated');
    } catch (reason) {
      clearSession();
      throw reason;
    }
  }, [clearSession]);

  const signOut = useCallback(async () => {
    const currentToken = token;
    try {
      if (currentToken) await api.logout(currentToken);
    } finally {
      clearSession();
    }
  }, [clearSession, token]);

  const requestApi = useCallback(async <T,>(
    operation: (sessionToken: string) => Promise<T>,
  ): Promise<T> => {
    if (!token) throw new Error('La sesión no está disponible.');
    try {
      return await operation(token);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) clearSession();
      throw reason;
    }
  }, [clearSession, token]);

  const retrySession = useCallback(() => {
    setError(null);
    setStatus('loading');
    setValidationAttempt((attempt) => attempt + 1);
  }, []);

  const value = useMemo(
    () => ({ user, status, error, signIn, signOut, requestApi, retrySession }),
    [user, status, error, signIn, signOut, requestApi, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
