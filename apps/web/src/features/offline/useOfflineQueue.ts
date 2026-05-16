import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { offlineQueue, type QueuedMutation } from './offline-queue';
import { useAuthStore } from '@/stores/auth';

/**
 * B1-PR5 — React hook that exposes the offline queue size + a manual
 * replay trigger, and wires automatic replay to the browser's online
 * event.
 *
 * Replay strategy (intentionally simple):
 *  - Sequential. We don't parallelise because mutations may target the
 *    same entity and racing them re-introduces the conflict problem we
 *    deliberately punted on.
 *  - Exponential backoff on per-mutation failure: 1s, 2s, 4s, 8s, 16s,
 *    capped at 30s. The counter lives on the row (`attempts`) so backoff
 *    survives reloads.
 *  - On 4xx (server rejected the body): drop the mutation and surface the
 *    error. There's no point retrying a 400 — the next attempt will also
 *    fail and the queue would block forever.
 *  - On 5xx / network error: increment attempts and keep the row. The
 *    next 'online' event (or manual `replay()`) re-tries.
 *
 * Why not use TanStack Query's built-in retry? Because the queued
 * mutations don't have a live `useMutation` to attach to — the original
 * call site already resolved with `{ queued: true }`. We do this work
 * outside React Query's lifecycle, then invalidate the matching keys
 * after a successful replay so the UI catches up.
 */

const POLL_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

export interface UseOfflineQueueResult {
  pendingCount: number;
  isReplaying: boolean;
  lastError: string | null;
  /** Manually drain the queue — exposed for the indicator's retry button + tests. */
  replay: () => Promise<void>;
}

function backoffMs(attempts: number): number {
  const base = 1_000 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, MAX_BACKOFF_MS);
}

async function executeReplay(
  row: QueuedMutation,
  token: string | null,
): Promise<{ ok: true } | { ok: false; status?: number; error: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'amass-web',
    ...(row.headers ?? {}),
  };
  if (row.body !== undefined) headers['Content-Type'] = 'application/json';
  // Re-inject the freshest auth token at replay time — the access token may
  // have rotated between enqueue and replay. We deliberately read here
  // (not at enqueue) for the same reason api.ts reads it per-call.
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(row.url, {
      method: row.method,
      headers,
      body: row.body !== undefined ? JSON.stringify(row.body) : undefined,
      credentials: 'same-origin',
    });
    if (res.ok) return { ok: true };
    // 4xx → permanent failure (validation/auth). Surface and drop.
    // 5xx → transient. Keep the row and back off.
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function useOfflineQueue(): UseOfflineQueueResult {
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = React.useState(0);
  const [isReplaying, setIsReplaying] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);
  // Track in-flight replay so two triggers (online event + interval) don't
  // race. A ref avoids the stale-closure problem with state.
  const replayingRef = React.useRef(false);

  const refreshCount = React.useCallback(async () => {
    try {
      const rows = await offlineQueue.peekAll();
      setPendingCount(rows.length);
    } catch {
      // IDB unavailable (private browsing, no indexedDB polyfill in test).
      // The indicator just shows 0 — no need to surface.
      setPendingCount(0);
    }
  }, []);

  const replay = React.useCallback(async (): Promise<void> => {
    if (replayingRef.current) return;
    replayingRef.current = true;
    setIsReplaying(true);
    setLastError(null);
    try {
      const rows = await offlineQueue.peekAll();
      // FIFO drain — peekAll returns ascending id, which == insertion order.
      for (const row of rows) {
        // Honour the row's own backoff window. If we replayed recently and
        // failed N times, skip it on this pass; the next interval tick
        // picks it up once the window has elapsed.
        const sinceCreated = Date.now() - row.createdAt;
        const wait = backoffMs(row.attempts);
        if (row.attempts > 0 && sinceCreated < wait) continue;

        const result = await executeReplay(row, useAuthStore.getState().accessToken);
        if (result.ok) {
          await offlineQueue.dequeue(row.id);
          // Best-effort cache invalidation — the server has a fresher copy.
          // We don't try to be clever about which key to invalidate; the
          // url's first segment after /api/v1 is a usable approximation.
          const match = /\/api\/v1\/([^/?]+)/.exec(row.url);
          if (match?.[1]) {
            void queryClient.invalidateQueries({ queryKey: [match[1]] });
          }
        } else if (result.status && result.status >= 400 && result.status < 500) {
          // Permanent — drop and surface so the user knows their offline
          // edit was rejected. Keeping it would block every later mutation.
          await offlineQueue.dequeue(row.id);
          setLastError(`${row.method} ${row.url}: ${result.error}`);
        } else {
          await offlineQueue.incrementAttempt(row.id, result.error);
          setLastError(result.error);
          // Bail the loop on first transient failure — the next 'online'
          // event or interval tick retries. Continuing would just rack
          // up failed attempts on every row in one burst.
          break;
        }
      }
    } finally {
      await refreshCount();
      replayingRef.current = false;
      setIsReplaying(false);
    }
  }, [queryClient, refreshCount]);

  React.useEffect(() => {
    // Defer the first refresh out of the synchronous effect body so the
    // setState lands on a separate render tick — keeps the
    // react-hooks/set-state-in-effect rule happy and matches React 19's
    // guidance about cascading renders.
    const handle = window.setTimeout(() => {
      void refreshCount();
    }, 0);
    const onOnline = (): void => {
      void replay();
    };
    // Offline event resets the indicator to "you are offline" state by
    // forcing a re-render via the count refresh; the count itself doesn't
    // change but the OfflineIndicator reads `navigator.onLine` directly.
    const onOffline = (): void => {
      void refreshCount();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Periodic refresh: catches the case where another tab enqueued a
    // mutation while this tab was idle. Cheap — just a getAll() count.
    const interval = window.setInterval(() => {
      void refreshCount();
      if (navigator.onLine) void replay();
    }, POLL_MS);

    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(interval);
    };
  }, [refreshCount, replay]);

  return { pendingCount, isReplaying, lastError, replay };
}
