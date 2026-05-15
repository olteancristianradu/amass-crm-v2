import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncGateway } from './sync.gateway';

/**
 * Unit tests for SyncGateway. Drives handleConnection / broadcast directly
 * with mock sockets — no real Socket.IO server is started so the tests stay
 * fast and deterministic.
 *
 * Multi-tenant isolation (the critical invariant) is exercised explicitly:
 * we mock `server.to(room).emit(...)` to track which rooms received which
 * events, then assert that a broadcast to tenant A never lands on tenant B.
 */

interface MockSocket {
  handshake: {
    auth?: Record<string, string>;
    headers: Record<string, string | undefined>;
  };
  data: Record<string, unknown>;
  disconnected: boolean;
  joinedRooms: string[];
  join: (room: string) => Promise<void>;
  disconnect: () => void;
}

function makeSocket(): MockSocket {
  const socket: MockSocket = {
    handshake: { headers: {} },
    data: {},
    disconnected: false,
    joinedRooms: [],
    join: vi.fn(async (room: string) => {
      socket.joinedRooms.push(room);
    }),
    disconnect: vi.fn(() => {
      socket.disconnected = true;
    }),
  };
  return socket;
}

const fakeJwt = {
  verifyAsync: vi.fn(),
} as unknown as import('@nestjs/jwt').JwtService;

describe('SyncGateway', () => {
  let gateway: SyncGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new SyncGateway(fakeJwt);
  });

  describe('handleConnection', () => {
    it('joins tenant room when JWT is valid', async () => {
      (fakeJwt.verifyAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        sub: 'user-1',
        tid: 'tenant-A',
      });
      const socket = makeSocket();
      socket.handshake.auth = { token: 'valid.jwt.token' };

      await gateway.handleConnection(socket as never);

      expect(socket.joinedRooms).toEqual(['tenant:tenant-A']);
      expect(socket.data['tenantId']).toBe('tenant-A');
      expect(socket.data['userId']).toBe('user-1');
      expect(socket.disconnected).toBe(false);
    });

    it('disconnects when JWT has expired', async () => {
      (fakeJwt.verifyAsync as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' }),
      );
      const socket = makeSocket();
      socket.handshake.auth = { token: 'expired.jwt.token' };

      await gateway.handleConnection(socket as never);

      expect(socket.disconnected).toBe(true);
      expect(socket.joinedRooms).toEqual([]);
    });

    it('disconnects when no token is supplied', async () => {
      const socket = makeSocket();

      await gateway.handleConnection(socket as never);

      expect(socket.disconnected).toBe(true);
      expect(socket.joinedRooms).toEqual([]);
      expect(fakeJwt.verifyAsync as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('disconnects when JWT is malformed', async () => {
      (fakeJwt.verifyAsync as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('invalid signature'), { name: 'JsonWebTokenError' }),
      );
      const socket = makeSocket();
      socket.handshake.auth = { token: 'not.a.real.jwt' };

      await gateway.handleConnection(socket as never);

      expect(socket.disconnected).toBe(true);
      expect(socket.joinedRooms).toEqual([]);
    });

    it('reads token from Authorization Bearer header when auth.token is absent', async () => {
      (fakeJwt.verifyAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        sub: 'user-2',
        tid: 'tenant-B',
      });
      const socket = makeSocket();
      socket.handshake.headers['authorization'] = 'Bearer header.based.token';

      await gateway.handleConnection(socket as never);

      expect(socket.joinedRooms).toEqual(['tenant:tenant-B']);
      expect(socket.data['tenantId']).toBe('tenant-B');
    });

    it('disconnects when payload lacks tid/sub claims', async () => {
      (fakeJwt.verifyAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        // missing tid + sub
        email: 'x@y.z',
      });
      const socket = makeSocket();
      socket.handshake.auth = { token: 'token.without.claims' };

      await gateway.handleConnection(socket as never);

      expect(socket.disconnected).toBe(true);
      expect(socket.joinedRooms).toEqual([]);
    });
  });

  describe('broadcast', () => {
    it('emits to the per-tenant room', () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      gateway.broadcast('tenant-A', 'deal.updated', { id: 'd1' });

      expect(to).toHaveBeenCalledWith('tenant:tenant-A');
      expect(emit).toHaveBeenCalledWith('deal.updated', { id: 'd1' });
    });

    it('drops the broadcast with a warn when server is not yet mounted', () => {
      // server stays undefined — simulates publish during bootstrap.
      // Should NOT throw.
      expect(() => gateway.broadcast('tenant-A', 'evt', { x: 1 })).not.toThrow();
    });

    /**
     * Critical multi-tenant isolation invariant. Two mock sockets joined to
     * DIFFERENT tenant rooms; broadcast targets tenant A; tenant B's socket
     * MUST NOT see the event. Uses a fake Socket.IO Server that routes emits
     * by joined room so we exercise the real `server.to(room).emit(...)`
     * routing semantics, not just the mock signature.
     */
    it('isolation: broadcast to tenant A does not reach tenant B sockets', () => {
      // Per-socket received-events log so the assertion can prove the
      // negative: tenant B's socket has length 0 after a tenant-A broadcast.
      const aReceived: Array<{ event: string; payload: unknown }> = [];
      const bReceived: Array<{ event: string; payload: unknown }> = [];

      // Sockets, each tracking the room(s) they have joined.
      const socketA = { rooms: new Set<string>(['tenant:tenant-A']), received: aReceived };
      const socketB = { rooms: new Set<string>(['tenant:tenant-B']), received: bReceived };
      const allSockets = [socketA, socketB];

      // Fake Server.to(room) returns an emitter that only delivers to sockets
      // whose `rooms` set contains the target room — exactly how Socket.IO
      // routes room-scoped emits in production.
      const fakeServer = {
        to: (room: string) => ({
          emit: (event: string, payload: unknown) => {
            for (const s of allSockets) {
              if (s.rooms.has(room)) s.received.push({ event, payload });
            }
          },
        }),
      };
      gateway.server = fakeServer as never;

      gateway.broadcast('tenant-A', 'invoice.created', { id: 'inv-1' });

      expect(aReceived).toEqual([{ event: 'invoice.created', payload: { id: 'inv-1' } }]);
      // The critical assertion: tenant B's socket received NOTHING.
      expect(bReceived).toEqual([]);

      // And the reverse direction is symmetric.
      gateway.broadcast('tenant-B', 'invoice.created', { id: 'inv-2' });
      expect(aReceived).toHaveLength(1); // unchanged
      expect(bReceived).toEqual([{ event: 'invoice.created', payload: { id: 'inv-2' } }]);
    });
  });

  describe('handleDisconnect', () => {
    it('does not throw', () => {
      expect(() => gateway.handleDisconnect({ id: 'sock-1' } as never)).not.toThrow();
    });
  });
});
