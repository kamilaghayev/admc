import { tokenStorage } from "./AuthContext";

let refreshPromise: Promise<string | null> | null = null;

function readAccess(): string | null {
  return localStorage.getItem(tokenStorage.access);
}

function readRefresh(): string | null {
  return localStorage.getItem(tokenStorage.refresh);
}

function clearAuth(): void {
  localStorage.removeItem(tokenStorage.access);
  localStorage.removeItem(tokenStorage.refresh);
  localStorage.removeItem(tokenStorage.user);
  window.dispatchEvent(new Event("diss:auth:logout"));
}

async function doRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const rt = readRefresh();
  if (!rt) return null;
  refreshPromise = (async () => {
    try {
      const r = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!r.ok) {
        clearAuth();
        return null;
      }
      const data = (await r.json()) as {
        tokens: { accessToken: string; refreshToken: string };
        user: unknown;
      };
      localStorage.setItem(tokenStorage.access, data.tokens.accessToken);
      localStorage.setItem(tokenStorage.refresh, data.tokens.refreshToken);
      localStorage.setItem(tokenStorage.user, JSON.stringify(data.user));
      window.dispatchEvent(new Event("diss:auth:refresh"));
      return data.tokens.accessToken;
    } catch {
      clearAuth();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function withAuthHeader(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = readAccess();
  let response = await fetch(input, withAuthHeader(init, token));
  if (response.status !== 401) return response;
  const newToken = await doRefresh();
  if (!newToken) return response;
  response = await fetch(input, withAuthHeader(init, newToken));
  return response;
}
