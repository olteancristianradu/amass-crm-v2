import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsGateway } from './notifications.gateway';

// JwtService is the only collaborator the gateway constructs with. We mock
// `verify` to control the payload shape and assert the gateway uses `tid`
// (matching AuthService.signAsync) instead of the legacy `tenantId` claim.
const fakeJwt = {
  verify: vi.fn(),
} as unknown as import('@nestjs/jwt').JwtService;

describe('NotificationsGateway (SEC-005)', () => {
  let gateway: NotificationsGateway;
  let socket: {
    handshake: { auth?: Record<string, string>; headers: Record<string, string> };
    data: Record<string, string>;
    disconnected: boolean;
    joined: string[];
    join: (room: string) => Promise<void>;
    disconnect: () => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new NotificationsGateway(fakeJwt);
    socket = {
      handshake: { headers: {} },
      data: {},
      disconnected: false,
      joined: [],
      join: vi.fn(async (room: string) => { socket.joined.push(room); }),
      disconnect: vi.fn(() => { socket.disconnected = true; }),
    };
  });

  it('joins room using `tid` claim from JWT (not legacy `tenantId`)', async () => {
    (fakeJwt.verify as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ sub: 'u-1', tid: 'tenant-A' });
    socket.handshake.auth = { token: 'jwt.payload.sig' };

    await gateway.handleConnection(socket as never);

    expect(socket.joined).toEqual(['tenant:tenant-A:user:u-1']);
    expect(socket.data['tenantId']).toBe('tenant-A');
    expect(socket.data['userId']).toBe('u-1');
    expect(socket.disconnected).toBe(false);
  });

  it('disconnects when token is missing', async () => {
    socket.handshake.auth = {};

    await gateway.handleConnection(socket as never);

    expect(socket.disconnected).toBe(true);
    expect(socket.joined).toEqual([]);
  });

  it('disconnects when JWT verify throws', async () => {
    (fakeJwt.verify as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('bad sig'); });
    socket.handshake.auth = { token: 'tampered' };

    await gateway.handleConnection(socket as never);

    expect(socket.disconnected).toBe(true);
  });
});
