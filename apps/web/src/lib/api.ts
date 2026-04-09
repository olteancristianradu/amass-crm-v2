/**
 * Thin typed `fetch` wrapper for the backend API.
 *
 * Invariants:
 *  - Always prefixes `/api/v1`.
 *  - Reads the access token out of the Zustand auth store lazily (to dodge
 *    the classic circular-import trap where api.ts and auth.ts depend on
 *    each other at module-eval time).
 *  - On 401, it attempts ONE silent refresh via the refresh token and
 *    retries the original request. If the refresh itself fails, it wipes
 *    the auth store (forces logout) and bubbles the error up.
 *  - Throws `ApiError` on any non-2xx so TanStack Query's retry/onError
 *    machinery sees a real thrown Error.
 *
 * The refresh race is guarded by a single in-flight Promise — concurrent
 * requests that all hit a 401 at once will share ONE refresh round-trip.
 */
import { useAuthStore } from '@/stores/auth';

const API_BASE = '/api/v1';

export interface ApiErrorShape {
  code?: string;
  message?: string;
  details?: unknown;
  traceId?: string;
  timestamp?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly traceId?: string;

  constructor(status: number, body: ApiErrorShape | string) {
    const parsed: ApiErrorShape = typeof body === 'string' ? { message: body } : body;
    super(parsed.message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = parsed.code ?? `HTTP_${status}`;
    this.details = parsed.details;
    this.traceId = parsed.traceId;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** When true (internal), do NOT try to refresh on 401 — prevents loops. */
  skipRefresh?: boolean;
  /** Extra query params serialised as URLSearchParams. */
  query?: Record<string, string | number | undefined>;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const state = useAuthStore.getState();
    if (!state.refreshToken) return false;
    try {
      const res = await rawFetch('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: state.refreshToken },
        skipRefresh: true,
      });
      const data = res as { tokens: { accessToken: string; refreshToken: string; expiresIn: number } };
      state.setTokens(data.tokens);
      return true;
    } catch {
      state.clear();
      return false;
    } finally {
      // Clear the gate so later 401s can trigger another refresh cycle.
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function rawFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipRefresh = false, query } = opts;

  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const token = useAuthStore.getState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !skipRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return rawFetch<T>(path, { ...opts, skipRefresh: true });
    }
  }

  // 204 No Content — nothing to parse.
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data: unknown = text ? safeJson(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, (data as ApiErrorShape) ?? text);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T = unknown>(path: string, query?: RequestOptions['query']) =>
    rawFetch<T>(path, { method: 'GET', query }),
  post: <T = unknown>(path: string, body?: unknown) => rawFetch<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body?: unknown) => rawFetch<T>(path, { method: 'PATCH', body }),
  delete: <T = unknown>(path: string) => rawFetch<T>(path, { method: 'DELETE' }),
};
