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
import { offlineQueue, type HttpMethod } from '@/features/offline/offline-queue';

const API_BASE = '/api/v1';

/**
 * Response shape returned to the caller when a mutation got queued for
 * offline replay instead of hitting the network. React Query mutation
 * `onSuccess` handlers should treat `queued: true` as "optimistic update
 * stays — the replay will commit it later". `queuedId` lets the caller
 * cancel the queued mutation if it's been superseded.
 */
export interface QueuedResponse {
  queued: true;
  queuedId: number;
}

export function isQueuedResponse(value: unknown): value is QueuedResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { queued?: unknown }).queued === true
  );
}

/**
 * Endpoints we MUST NOT queue offline:
 *   - /auth/*  — token issuance is meaningless to replay later.
 *   - /webhooks/* — inbound only, never called by the SPA but defensive.
 *   - /uploads/* presigned PUT issuance — short TTL, would be expired by
 *     replay time. The browser also handles the actual MinIO PUT outside
 *     this api wrapper.
 */
function isQueueableMutation(path: string, method: HttpMethod | 'GET'): boolean {
  if (method === 'GET') return false;
  if (path.startsWith('/auth/')) return false;
  if (path.startsWith('/webhooks/')) return false;
  if (path.startsWith('/uploads/')) return false;
  return true;
}

export interface ApiErrorShape {
  code?: string;
  message?: string;
  details?: unknown;
  traceId?: string;
  timestamp?: string;
}

// Translate technical API error codes to user-friendly Romanian messages.
// Internal codes like "Missing bearer token" should never leak to the UI —
// they indicate transient auth state that the refresh interceptor handles.
const FRIENDLY_MESSAGES: Record<string, string> = {
  NO_TOKEN: 'Sesiunea a expirat. Reîncearcă în câteva secunde.',
  INVALID_TOKEN: 'Sesiunea a expirat. Reconectează-te.',
  TOKEN_EXPIRED: 'Sesiunea a expirat. Reconectează-te.',
  CSRF_HEADER_MISSING: 'Eroare de securitate. Reîncearcă acțiunea.',
  TOO_MANY_REQUESTS: 'Prea multe încercări. Așteaptă un minut.',
  INVALID_CREDENTIALS: 'Email sau parolă incorectă.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly traceId?: string;
  /** Original technical message from API (for logging/debugging). */
  readonly rawMessage?: string;

  constructor(status: number, body: ApiErrorShape | string) {
    const parsed: ApiErrorShape = typeof body === 'string' ? { message: body } : body;
    const code = parsed.code ?? `HTTP_${status}`;
    const friendly = FRIENDLY_MESSAGES[code];
    super(friendly ?? parsed.message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = parsed.details;
    this.traceId = parsed.traceId;
    this.rawMessage = parsed.message;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** When true (internal), do NOT try to refresh on 401 — prevents loops. */
  skipRefresh?: boolean;
  /** Extra query params serialised as URLSearchParams. Arrays become repeated keys. */
  query?: Record<string, string | number | string[] | undefined>;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const state = useAuthStore.getState();
    try {
      // M-10: no body — the refresh token rides along in the httpOnly
      // `amass_rt` cookie. `credentials: 'include'` on the rawFetch below
      // is what actually carries the cookie cross-origin.
      const res = await rawFetch('/auth/refresh', {
        method: 'POST',
        skipRefresh: true,
      });
      const data = res as { tokens: { accessToken: string; expiresIn: number } };
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
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) {
        v.forEach((item) => url.searchParams.append(k, String(item)));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Custom header that cannot be forged cross-origin without CORS
    // preflight — used by the API's CsrfHeaderMiddleware to reject
    // CSRF attempts on cookie-authenticated routes (/auth/refresh,
    // /auth/logout).
    'X-Requested-With': 'amass-web',
  };
  const token = useAuthStore.getState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // M-10: `same-origin` is enough here because the SPA and API share
      // the origin behind Caddy. It makes the httpOnly refresh cookie
      // ride along on /auth/refresh and /auth/logout.
      credentials: 'same-origin',
    });
  } catch (networkErr) {
    // B1-PR5: pure network failure (no Response object — DNS, offline,
    // CORS, etc.). For safe-to-queue mutations we stash the request in
    // IndexedDB and return a synthetic queued response so the calling
    // React Query mutation doesn't roll back its optimistic update.
    // GETs still throw — there's nothing safe to "replay" for a read.
    if (isQueueableMutation(path, method)) {
      try {
        const queuedId = await offlineQueue.enqueue({
          method: method as HttpMethod,
          // Store the absolute URL (including any query string) so replay
          // doesn't have to re-serialise the params. Strip the origin
          // because `fetch` resolves it from `window.location` at replay.
          url: url.pathname + url.search,
          body,
        });
        return { queued: true, queuedId } as unknown as T;
      } catch {
        // IndexedDB unavailable (private mode, quota). Fall through and
        // rethrow the original network error — better the user sees the
        // failure than silently loses the edit.
      }
    }
    throw networkErr;
  }

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
  put: <T = unknown>(path: string, body?: unknown) => rawFetch<T>(path, { method: 'PUT', body }),
  delete: <T = unknown>(path: string) => rawFetch<T>(path, { method: 'DELETE' }),
};
