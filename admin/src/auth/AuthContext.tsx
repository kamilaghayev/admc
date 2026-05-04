import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type PublicUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  createdAt: string;
  updatedAt: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

type LoginResult = {
  user: PublicUser;
  tokens: TokenPair;
};

type AuthContextValue = {
  user: PublicUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE = {
  access: "diss.access",
  refresh: "diss.refresh",
  user: "diss.user",
};

function readStored<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(() =>
    readStored<PublicUser>(STORAGE.user),
  );
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE.access)
      : null,
  );
  const [refreshToken, setRefreshToken] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE.refresh)
      : null,
  );
  const [loading, setLoading] = useState<boolean>(false);

  const refreshLockRef = useRef<Promise<string | null> | null>(null);

  const persistTokens = useCallback(
    (tokens: TokenPair | null, u: PublicUser | null) => {
      if (tokens) {
        window.localStorage.setItem(STORAGE.access, tokens.accessToken);
        window.localStorage.setItem(STORAGE.refresh, tokens.refreshToken);
        setAccessToken(tokens.accessToken);
        setRefreshToken(tokens.refreshToken);
      } else {
        window.localStorage.removeItem(STORAGE.access);
        window.localStorage.removeItem(STORAGE.refresh);
        setAccessToken(null);
        setRefreshToken(null);
      }
      if (u) {
        window.localStorage.setItem(STORAGE.user, JSON.stringify(u));
        setUser(u);
      } else {
        window.localStorage.removeItem(STORAGE.user);
        setUser(null);
      }
    },
    [],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      setLoading(true);
      try {
        const r = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`login failed (${r.status}): ${text}`);
        }
        const data = (await r.json()) as LoginResult;
        persistTokens(data.tokens, data.user);
      } finally {
        setLoading(false);
      }
    },
    [persistTokens],
  );

  const logout = useCallback(async () => {
    const rt = refreshToken;
    persistTokens(null, null);
    if (rt) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
      } catch {
        // ignore
      }
    }
  }, [persistTokens, refreshToken]);

  const refresh = useCallback(async (): Promise<string | null> => {
    if (refreshLockRef.current) return refreshLockRef.current;
    const rt = refreshToken;
    if (!rt) return null;
    const promise = (async () => {
      try {
        const r = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!r.ok) {
          persistTokens(null, null);
          return null;
        }
        const data = (await r.json()) as LoginResult;
        persistTokens(data.tokens, data.user);
        return data.tokens.accessToken;
      } catch {
        persistTokens(null, null);
        return null;
      } finally {
        refreshLockRef.current = null;
      }
    })();
    refreshLockRef.current = promise;
    return promise;
  }, [persistTokens, refreshToken]);

  // hydrate user info on mount if we have tokens but stale user
  useEffect(() => {
    if (!accessToken) return;
    if (user) return;
    void (async () => {
      try {
        const r = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r.ok) {
          const me = (await r.json()) as PublicUser;
          window.localStorage.setItem(STORAGE.user, JSON.stringify(me));
          setUser(me);
        }
      } catch {
        // ignore
      }
    })();
  }, [accessToken, user]);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      refreshToken,
      loading,
      login,
      logout,
      refresh,
    }),
    [user, accessToken, refreshToken, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const tokenStorage = STORAGE;
