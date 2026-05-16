import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';
import { useSyncStore } from '@/stores/sync';

/**
 * Context that exposes the live Socket.IO instance to descendants.
 * Consumers should use `useSyncSocket()` rather than reading the context
 * directly. Returns `null` when there is no active socket (logged out, or
 * the connection has not been opened yet) — hooks must handle that case.
 */
const SyncSocketContext = React.createContext<Socket | null>(null);

/** Read the live `/sync` Socket.IO instance, or `null` if unauthenticated. */
export function useSyncSocket(): Socket | null {
  return React.useContext(SyncSocketContext);
}

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
  // Expose the live socket through context so feature hooks (presence,
  // future optimistic update channels) can subscribe without re-opening
  // a second connection per consumer. Stored in state, not a ref, so the
  // context re-renders consumers when the socket actually changes.
  const [socket, setSocket] = React.useState<Socket | null>(null);

  React.useEffect(() => {
    // No token yet → bail out and stay disconnected. Once login completes
    // (or the silent refresh in `lib/api.ts` succeeds), `accessToken` flips
    // and this effect re-runs with a real value.
    if (!isAuthenticated || !accessToken) {
      setConnected(false);
      // Intentional: we are exposing the externally-managed Socket.IO
      // instance through React state so descendant hooks can subscribe.
      // On logout the socket must be cleared from context; deriving this
      // from a memo would mean tearing down the Socket.IO connection during
      // render, which is worse.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSocket(null);
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
    // Intentional: the new Socket.IO instance is an external resource we
    // own for the lifetime of this effect. Publishing it through state is
    // the only way for `useSyncSocket()` consumers to re-render when it
    // changes (e.g. on a token refresh that re-opens the connection).
    setSocket(socket);

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
      // Cleanup path; same rationale as above (external resource teardown).
      setSocket(null);
    };
  }, [accessToken, isAuthenticated, queryClient, setConnected, markEvent]);

  return <SyncSocketContext.Provider value={socket}>{children}</SyncSocketContext.Provider>;
}
