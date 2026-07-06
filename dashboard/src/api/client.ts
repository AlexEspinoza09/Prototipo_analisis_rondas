import type { TokenPair } from './types';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const STORAGE_KEY = 'rondas_tokens';

export function getTokens(): TokenPair | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

export function setTokens(tokens: TokenPair | null): void {
  if (tokens === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function extractDetail(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    return JSON.stringify(detail);
  }
  return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = (access?: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  const tokens = getTokens();
  let response = await doFetch(tokens?.access_token);

  if (response.status === 401 && tokens?.refresh_token && path !== '/auth/login') {
    const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (refreshResponse.ok) {
      const newTokens = (await refreshResponse.json()) as TokenPair;
      setTokens(newTokens);
      response = await doFetch(newTokens.access_token);
    } else {
      setTokens(null);
    }
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, extractDetail(body, response.statusText));
  }
  return body as T;
}
