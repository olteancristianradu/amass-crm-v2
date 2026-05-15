import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncProvider } from './SyncProvider';
import { useAuthStore } from '@/stores/auth';
import { useSyncStore } from '@/stores/sync';

/**
 * In-memory fake socket.io-client. Captures handler registrations so the
 * test can fire arbitrary events via `socket.__emit('deal.moved', payload)`
 * and assert that the right React Query keys got invalidated.
 *
 * We mock the module BEFORE the provider imports it; vi.mock is hoisted so
 * declaration order does not matter.
 */
interface FakeSocket {
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
  disconnected: boolean;
  on: (ev: string, cb: (...args: unknown[]) => void) => FakeSocket;
  off: (ev: string, cb: (...args: unknown[]) => void) => FakeSocket;
  disconnect: () => void;
  /** Test helper — drive an event into the registered handlers. */
  __emit: (ev: string, ...args: unknown[]) => void;
}

let createdSockets: FakeSocket[] = [];
let lastIoArgs: { namespace: string; opts: Record<string, unknown> } | null = null;

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const sock: FakeSocket = {
    handlers,
    disconnected: false,
    on: (ev, cb) => {
      const set = handlers.get(ev) ?? new Set();
      set.add(cb);
      handlers.set(ev, set);
      return sock;
    },
    off: (ev, cb) => {
      handlers.get(ev)?.delete(cb);
      return sock;
    },
    disconnect: () => {
      sock.disconnected = true;
    },
    __emit: (ev, ...args) => {
      for (const cb of handlers.get(ev) ?? []) cb(...args);
    },
  };
  return sock;
}

vi.mock('socket.io-client', () => ({
  io: vi.fn((namespace: string, opts: Record<string, unknown>) => {
    const s = makeFakeSocket();
    createdSockets.push(s);
    lastIoArgs = { namespace, opts };
    return s;
  }),
}));

function wrap(children: React.ReactNode, client: QueryClient): JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <SyncProvider>{children}</SyncProvider>
    </QueryClientProvider>
  );
}

function authedUser(): void {
  useAuthStore.setState({
    user: {
      id: 'u1',
      tenantId: 't1',
      email: 'r@example.com',
      fullName: 'R O',
      role: 'OWNER',
    },
    accessToken: 'jwt-access-token',
  });
}

describe('SyncProvider', () => {
  beforeEach(() => {
    createdSockets = [];
    lastIoArgs = null;
    useAuthStore.setState({ user: null, accessToken: null });
    useSyncStore.setState({ connected: false, lastEventAt: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('on mount with auth: calls io(/sync) with auth.token', () => {
    authedUser();
    const qc = new QueryClient();
    render(wrap(<div>x</div>, qc));

    expect(createdSockets).toHaveLength(1);
    expect(lastIoArgs?.namespace).toBe('/sync');
    expect((lastIoArgs?.opts.auth as { token: string }).token).toBe('jwt-access-token');
  });

  it('does NOT open a socket when unauthenticated', () => {
    const qc = new QueryClient();
    render(wrap(<div>x</div>, qc));
    expect(createdSockets).toHaveLength(0);
    expect(useSyncStore.getState().connected).toBe(false);
  });

  it('on `connect` event: connected flag flips to true', () => {
    authedUser();
    const qc = new QueryClient();
    render(wrap(<div>x</div>, qc));

    act(() => {
      createdSockets[0]!.__emit('connect');
    });
    expect(useSyncStore.getState().connected).toBe(true);
  });

  it('on `deal.moved`: invalidates [\'deals\'] queries', () => {
    authedUser();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(wrap(<div>x</div>, qc));

    act(() => {
      createdSockets[0]!.__emit('deal.moved', { id: 'd1' });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('on `deal.won` and `deal.lost`: both invalidate [\'deals\']', () => {
    authedUser();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(wrap(<div>x</div>, qc));

    act(() => {
      createdSockets[0]!.__emit('deal.won', { id: 'd1' });
      createdSockets[0]!.__emit('deal.lost', { id: 'd2' });
    });

    const dealsInvalidations = spy.mock.calls.filter(
      (call) => JSON.stringify(call[0]) === JSON.stringify({ queryKey: ['deals'] }),
    );
    expect(dealsInvalidations).toHaveLength(2);
  });

  it('on `invoice.status_changed`: invalidates [\'invoices\']', () => {
    authedUser();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(wrap(<div>x</div>, qc));

    act(() => {
      createdSockets[0]!.__emit('invoice.status_changed', { id: 'i1', status: 'PAID' });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['invoices'] });
  });

  it('on `call.completed`: invalidates [\'calls\']', () => {
    authedUser();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(wrap(<div>x</div>, qc));

    act(() => {
      createdSockets[0]!.__emit('call.completed', { id: 'c1' });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['calls'] });
  });

  it('on `disconnect`: connected flag flips to false', () => {
    authedUser();
    const qc = new QueryClient();
    render(wrap(<div>x</div>, qc));

    act(() => {
      createdSockets[0]!.__emit('connect');
    });
    expect(useSyncStore.getState().connected).toBe(true);

    act(() => {
      createdSockets[0]!.__emit('disconnect', 'transport close');
    });
    expect(useSyncStore.getState().connected).toBe(false);
  });

  it('on unmount: disconnects the socket', () => {
    authedUser();
    const qc = new QueryClient();
    const { unmount } = render(wrap(<div>x</div>, qc));

    expect(createdSockets[0]!.disconnected).toBe(false);
    unmount();
    expect(createdSockets[0]!.disconnected).toBe(true);
  });

  it('marks lastEventAt when a sync event lands', () => {
    authedUser();
    const qc = new QueryClient();
    render(wrap(<div>x</div>, qc));

    expect(useSyncStore.getState().lastEventAt).toBeNull();
    act(() => {
      createdSockets[0]!.__emit('deal.moved', { id: 'd1' });
    });
    expect(useSyncStore.getState().lastEventAt).toBeTypeOf('number');
  });
});
