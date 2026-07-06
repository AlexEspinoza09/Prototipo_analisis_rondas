import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '../config';
import type { TokenPair } from './types';

const STORAGE_KEY = 'rondas_tokens';

export async function getTokens(): Promise<TokenPair | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

export async function setTokens(tokens: TokenPair | null): Promise<void> {
  if (tokens === null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
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
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

  const tokens = await getTokens();
  let response = await doFetch(tokens?.access_token);

  if (response.status === 401 && tokens?.refresh_token && path !== '/auth/login') {
    const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (refreshResponse.ok) {
      const newTokens = (await refreshResponse.json()) as TokenPair;
      await setTokens(newTokens);
      response = await doFetch(newTokens.access_token);
    } else {
      await setTokens(null);
    }
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, extractDetail(body, response.statusText));
  }
  return body as T;
}
