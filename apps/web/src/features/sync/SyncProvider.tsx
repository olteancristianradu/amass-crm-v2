import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';
import { useSyncStore } from '@/stores/sync';

/**
 * B1-PR3 — Frontend Socket.IO consumer.
 *
 * Lifecycle:
 *  - Mounts inside the authed `<AppShell>`. When `isAuthenticated && accessToken`
 *    is true it opens a single socket on the `/sync` namespace and wires the
 *    event → query-key invalidation table below.
 *  - When the user logs out (or the access token is cleared) it disconnects
 *    and clears the connection flag. Connection state lives in `useSyncStore`
 *    so any widget can read `connected` without prop drilling — see
 *    `useSyncStatus()` for the consumer API and `AppShell` for the "Live"
 *    badge.
 *
 * Reconnect strategy: we lean on Socket.IO's native exponential backoff
 * (reconnection: true by default, initial 1s, capped at 5s). We do NOT set
 * `reconnection: false` — losing the websocket should self-heal silently
 * without a UI-level retry policy. The badge flips to grey while it's
 * reconnecting; React Query's normal cache-staleness keeps the UI useful in
 * the meantime.
 *
 * Event mapping (kept in lockstep with `apps/api/src/infra/ws/sync-publisher.service.ts`
 * and the publishers in deals/invoices/calls):
 *
 *   ┌──────────────────────────┬────────────────────────────┐
 *   │ Server event              │ Invalidated query key      │
 *   ├──────────────────────────┼────────────────────────────┤
 *   │ deal.moved                │ ['deals']                  │
 *   │ deal.won                  │ ['deals']                  │
 *   │ deal.lost                 │ ['deals']                  │
 *   │ invoice.status_changed    │ ['invoices']               │
 *   │ call.completed            │ ['calls']                  │
 *   └──────────────────────────┴────────────────────────────┘
 *
 * Why invalidate (not patch in place)?
 *   - Cheapest correct thing. The list/detail queries refetch with the
 *     server as source-of-truth — no risk of skew between the optimistic
 *     local merge and the canonical server projection.
 *   - Optimistic deltas land in B1-PR4/PR5 once we have presence + offline
 *     buffering. For now the network round-trip is fine; payloads are tiny.
 *
 * Returns `<>{children}</>` — this is a side-effect-only provider, it does
 * not render any UI. The "Live" badge is rendered by AppShell consuming
 * `useSyncStatus()`.
 */
export function SyncProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const setConnected = useSyncStore((s) => s.setConnected);
  const markEvent = useSyncStore((s) => s.markEvent);

  React.useEffect(() => {
    // No token yet → bail out and stay disconnected. Once login completes
    // (or the silent refresh in `lib/api.ts` succeeds), `accessToken` flips
    // and this effect re-runs with a real value.
    if (!isAuthenticated || !accessToken) {
      setConnected(false);
      return;
    }

    // `path` defaults to `/socket.io`; the namespace is the first arg.
    // Dev Vite proxy forwards `/socket.io` to :3000 — see vite.config.ts.
    const socket: Socket = io('/sync', {
      auth: { token: accessToken },
      transports: ['websocket'],
      // Socket.IO's default reconnect is fine; we leave it on. Keep these
      // explicit so future readers don't disable them by accident.
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });

    socket.on('connect', () => {
      // eslint-disable-next-line no-console -- intentional one-shot info log
      console.info('[sync] connected', { id: socket.id });
      setConnected(true);
    });

    socket.on('disconnect', (reason) => {
      // eslint-disable-next-line no-console -- intentional one-shot info log
      console.info('[sync] disconnected', { reason });
      setConnected(false);
    });

    socket.on('connect_error', (err: Error) => {
      // Auth failures (server disconnects immediately) show up here. We
      // log but do not surface a toast — the rest of the app already
      // handles 401 via the refresh interceptor.
      // eslint-disable-next-line no-console -- intentional one-shot warn
      console.warn('[sync] connect_error', err.message);
      setConnected(false);
    });

    const invalidateDeals = (): void => {
      markEvent();
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
    };
    const invalidateInvoices = (): void => {
      markEvent();
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    };
    const invalidateCalls = (): void => {
      markEvent();
      void queryClient.invalidateQueries({ queryKey: ['calls'] });
    };

    socket.on('deal.moved', invalidateDeals);
    socket.on('deal.won', invalidateDeals);
    socket.on('deal.lost', invalidateDeals);
    socket.on('invoice.status_changed', invalidateInvoices);
    socket.on('call.completed', invalidateCalls);

    return () => {
      // Disconnect on unmount OR on token change (effect re-runs). Calling
      // `.disconnect()` removes all listeners and prevents the reconnect
      // loop from firing after we've torn down.
      socket.off('deal.moved', invalidateDeals);
      socket.off('deal.won', invalidateDeals);
      socket.off('deal.lost', invalidateDeals);
      socket.off('invoice.status_changed', invalidateInvoices);
      socket.off('call.completed', invalidateCalls);
      socket.disconnect();
      setConnected(false);
    };
  }, [accessToken, isAuthenticated, queryClient, setConnected, markEvent]);

  return <>{children}</>;
}
