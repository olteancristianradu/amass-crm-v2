import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { RedisService } from '../redis/redis.service';
import { JwtPayload, JWT_BLOCKLIST_PREFIX } from '../../modules/auth/auth.service';

/**
 * Socket.IO gateway. Clients authenticate with a JWT in the handshake auth
 * and are placed in a tenant-scoped room (`tenant:{tenantId}`) so we can
 * broadcast to all sessions for a given tenant without user enumeration.
 *
 * Path matches the Vite proxy config: /ws
 *
 * Security:
 *   - Allowed origins come from CORS_ALLOWED_ORIGINS (comma-separated).
 *     '*' is rejected at load time in production by env validation.
 *   - JWT is verified on connection AND the jti is checked against the
 *     Redis revocation blocklist so a logged-out user's socket is closed.
 *   - L-03 handshake rate limit: each source IP may open at most
 *     `WS_HANDSHAKE_LIMIT` connections per `WS_HANDSHAKE_WINDOW` seconds.
 *     Counter lives in Redis (per-IP key, TTL = window) so multiple API
 *     replicas share the same view. Defends against an unauthenticated
 *     attacker spamming `io(url, { auth: { token: '...' } })` to burn
 *     CPU on JWT verifies + Redis lookups.
 */
const env = loadEnv();
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const WS_HANDSHAKE_LIMIT = 30;
const WS_HANDSHAKE_WINDOW_SECONDS = 60;

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: true,
  },
})
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() readonly server!: Server;
  private readonly logger = new Logger(WsGateway.name);
  private readonly jwt: JwtService;

  constructor(private readonly redis: RedisService) {
    this.jwt = new JwtService({ secret: env.JWT_SECRET });
  }

  async handleConnection(client: Socket): Promise<void> {
    // Rate-limit handshakes per source IP BEFORE any JWT/Redis work so an
    // attacker can't burn CPU by spamming connections with bad tokens.
    const ip = this.clientIp(client);
    if (ip) {
      const key = `ws:handshake:${ip}`;
      const count = await this.redis.incr(key, WS_HANDSHAKE_WINDOW_SECONDS);
      if (count > WS_HANDSHAKE_LIMIT) {
        this.logger.warn(`WS rejected — handshake rate limit hit for ip=${ip} count=${count}`);
        client.disconnect(true);
        return;
      }
    }

    const token =
      (client.handshake.auth as Record<string, string | undefined>).token ??
      (client.handshake.headers.authorization ?? '').replace('Bearer ', '');

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      if (!payload.jti || !payload.tid) {
        this.logger.warn(`WS rejected — token missing jti/tid`);
        client.disconnect(true);
        return;
      }
      const revoked = await this.redis.client.exists(`${JWT_BLOCKLIST_PREFIX}${payload.jti}`);
      if (revoked) {
        this.logger.warn(`WS rejected — token revoked jti=${payload.jti}`);
        client.disconnect(true);
        return;
      }
      void client.join(`tenant:${payload.tid}`);
      this.logger.debug(`WS connected sub=${payload.sub} tenant=${payload.tid}`);
    } catch {
      this.logger.warn(`WS rejected — invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected id=${client.id}`);
  }

  /**
   * Resolve the source IP of the handshake. We prefer the value Express
   * already parsed via `trust proxy = 1` (set in main.ts), which honours
   * `X-Forwarded-For` from Caddy. Falls back to the raw socket address.
   */
  private clientIp(client: Socket): string | null {
    const req = client.request as { ip?: string };
    if (typeof req.ip === 'string' && req.ip.length > 0) return req.ip;
    return client.handshake.address || null;
  }

  /** Emit a reminder:fired event to everyone in the tenant room. */
  emitReminderFired(tenantId: string, payload: { id: string; title: string; body: string | null }): void {
    this.server.to(`tenant:${tenantId}`).emit('reminder:fired', payload);
  }
}
