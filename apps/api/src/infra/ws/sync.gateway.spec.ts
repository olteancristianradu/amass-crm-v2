import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncGateway } from './sync.gateway';
import type { PresenceService } from './presence.service';

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
  id: string;
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

function makeSocket(id = 'sock-default'): MockSocket {
  const socket: MockSocket = {
    id,
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

function makeFakePresence(): {
  presence: PresenceService;
  enter: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  cleanupSocket: ReturnType<typeof vi.fn>;
} {
  const enter = vi.fn(async () => undefined);
  const leave = vi.fn(async () => undefined);
  const cleanupSocket = vi.fn(async () => [] as Array<{ tenantId: string; resourceType: string; resourceId: string; userId: string }>);
  const presence = { enter, leave, cleanupSocket, list: vi.fn() } as unknown as PresenceService;
  return { presence, enter, leave, cleanupSocket };
}

describe('SyncGateway', () => {
  let gateway: SyncGateway;
  let presenceMocks: ReturnType<typeof makeFakePresence>;

  beforeEach(() => {
    vi.clearAllMocks();
    presenceMocks = makeFakePresence();
    gateway = new SyncGateway(fakeJwt, presenceMocks.presence);
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
    it('does not throw', async () => {
      // server stub for broadcast path inside cleanup; cleanupSocket returns []
      // so no broadcasts happen, but we still need server to be set or the
      // emit-by-room call would NPE.
      gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as never;
      await expect(gateway.handleDisconnect({ id: 'sock-1' } as never)).resolves.not.toThrow();
    });

    it('cleans up presence and broadcasts presence:left for every tracked resource', async () => {
      presenceMocks.cleanupSocket.mockResolvedValueOnce([
        { tenantId: 'tenant-A', resourceType: 'company', resourceId: 'co-1', userId: 'user-1' },
        { tenantId: 'tenant-A', resourceType: 'deal', resourceId: 'd-1', userId: 'user-1' },
      ]);
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      await gateway.handleDisconnect({ id: 'sock-disc' } as never);

      expect(presenceMocks.cleanupSocket).toHaveBeenCalledWith('sock-disc');
      // Two broadcasts (one per tracked resource), all addressed to tenant-A's room.
      expect(to).toHaveBeenCalledTimes(2);
      expect(to).toHaveBeenCalledWith('tenant:tenant-A');
      expect(emit).toHaveBeenCalledWith('presence:left', {
        resourceType: 'company',
        resourceId: 'co-1',
        userId: 'user-1',
      });
      expect(emit).toHaveBeenCalledWith('presence:left', {
        resourceType: 'deal',
        resourceId: 'd-1',
        userId: 'user-1',
      });
    });

    it('swallows presence cleanup errors (never throws out of handleDisconnect)', async () => {
      presenceMocks.cleanupSocket.mockRejectedValueOnce(new Error('redis down'));
      gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as never;
      await expect(gateway.handleDisconnect({ id: 'sock-x' } as never)).resolves.not.toThrow();
    });
  });

  describe('presence:enter / presence:leave', () => {
    it('presence:enter records in Redis + broadcasts presence:joined to the tenant room', async () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      const socket = makeSocket('sock-enter');
      socket.data['tenantId'] = 'tenant-A';
      socket.data['userId'] = 'user-1';

      await gateway.onPresenceEnter(
        { resourceType: 'company', resourceId: 'co-42' },
        socket as never,
      );

      expect(presenceMocks.enter).toHaveBeenCalledWith(
        'tenant-A',
        'company',
        'co-42',
        'user-1',
        'sock-enter',
      );
      expect(to).toHaveBeenCalledWith('tenant:tenant-A');
      expect(emit).toHaveBeenCalledWith('presence:joined', {
        resourceType: 'company',
        resourceId: 'co-42',
        userId: 'user-1',
      });
    });

    it('presence:enter from a socket without tenantId/userId is a silent no-op', async () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      // Socket whose handshake never ran (defense in depth).
      const socket = makeSocket('sock-nojwt');

      await gateway.onPresenceEnter(
        { resourceType: 'company', resourceId: 'co-1' },
        socket as never,
      );

      expect(presenceMocks.enter).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('presence:enter ignores malformed payloads', async () => {
      gateway.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as never;
      const socket = makeSocket('sock-bad');
      socket.data['tenantId'] = 'tenant-A';
      socket.data['userId'] = 'user-1';

      await gateway.onPresenceEnter(
        { resourceType: '', resourceId: '' } as never,
        socket as never,
      );

      expect(presenceMocks.enter).not.toHaveBeenCalled();
    });

    it('presence:leave removes from Redis + broadcasts presence:left to the tenant room', async () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      const socket = makeSocket('sock-leave');
      socket.data['tenantId'] = 'tenant-A';
      socket.data['userId'] = 'user-1';

      await gateway.onPresenceLeave(
        { resourceType: 'deal', resourceId: 'd-9' },
        socket as never,
      );

      expect(presenceMocks.leave).toHaveBeenCalledWith(
        'tenant-A',
        'deal',
        'd-9',
        'user-1',
      );
      expect(to).toHaveBeenCalledWith('tenant:tenant-A');
      expect(emit).toHaveBeenCalledWith('presence:left', {
        resourceType: 'deal',
        resourceId: 'd-9',
        userId: 'user-1',
      });
    });
  });
});
