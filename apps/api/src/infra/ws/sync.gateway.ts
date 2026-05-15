import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { loadEnv } from '../../config/env';

/**
 * B1 — Realtime data-sync gateway.
 *
 * Foundation only (B1-PR1): handshake JWT verification + per-tenant rooms.
 * Per-mutation publishers (B1-PR3) will inject SyncPublisherService rather
 * than this gateway directly.
 *
 * Namespace: `/sync` — kept distinct from `/notifications` (per-user push)
 * and `/ws` (legacy reminders) so each surface can evolve independently.
 *
 * Multi-tenant isolation: each socket joins `tenant:<tid>` on connect. The
 * broadcast() helper uses `server.to(room).emit(...)` so a tenant A message
 * cannot reach a tenant B socket — this is the security invariant tested in
 * sync.gateway.spec.ts.
 */
const syncCorsOrigins = (() => {
  // CORS list must mirror REST allow-list. Env validation already forbids
  // '*' in production, so wildcard handling only matters in dev.
  const raw = loadEnv().CORS_ALLOWED_ORIGINS;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes('*') ? true : list;
})();

interface SyncJwtPayload {
  sub: string; // userId
  tid: string; // tenantId
}

@WebSocketGateway({
  namespace: '/sync',
  cors: { origin: syncCorsOrigins, credentials: true },
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SyncGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn('sync ws rejected — no token in handshake');
      client.disconnect();
      return;
    }

    try {
      const env = loadEnv();
      const payload = await this.jwt.verifyAsync<SyncJwtPayload>(token, {
        secret: env.JWT_SECRET,
      });
      if (!payload?.tid || !payload.sub) {
        this.logger.warn('sync ws rejected — payload missing tid/sub');
        client.disconnect();
        return;
      }
      await client.join(`tenant:${payload.tid}`);
      client.data['tenantId'] = payload.tid;
      client.data['userId'] = payload.sub;
      this.logger.log(`sync ws connected user=${payload.sub} tenant=${payload.tid}`);
    } catch (err) {
      // Catch-all: JsonWebTokenError, TokenExpiredError, NotBeforeError, etc.
      // Never throw out of handleConnection — Socket.IO would propagate it as
      // an unhandled rejection that crashes the worker.
      this.logger.warn(
        `sync ws rejected — verify failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`sync ws disconnected id=${client.id}`);
  }

  /**
   * Broadcast an event to every socket in the tenant's room. Returns the
   * underlying emitter result so tests can assert call-shape; production
   * callers ignore it.
   */
  broadcast(tenantId: string, event: string, payload: unknown): void {
    if (!this.server) {
      // Boot-race guard: NestJS sets @WebSocketServer after module init. If a
      // publish lands during bootstrap (e.g. a startup job) we'd otherwise NPE.
      this.logger.warn(`sync ws broadcast dropped — server not ready (event=${event})`);
      return;
    }
    this.server.to(`tenant:${tenantId}`).emit(event, payload);
  }

  /**
   * Token extraction tries (in order):
   *   1. handshake.auth.token   — preferred (socket.io client convention)
   *   2. Authorization: Bearer  — REST clients reusing the same header
   *   3. cookie: amass_at=...   — browser clients on same-origin deploys
   * Returns null when none yields a non-empty string.
   */
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const fromAuth = typeof auth?.['token'] === 'string' ? (auth['token'] as string) : '';
    if (fromAuth) return fromAuth;

    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const t = authHeader.slice('Bearer '.length).trim();
      if (t) return t;
    }

    const cookieHeader = client.handshake.headers.cookie;
    if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
      for (const part of cookieHeader.split(';')) {
        const [rawKey, ...rest] = part.split('=');
        if (!rawKey) continue;
        const key = rawKey.trim();
        if (key === 'amass_at' || key === 'access_token') {
          const v = rest.join('=').trim();
          if (v) return decodeURIComponent(v);
        }
      }
    }
    return null;
  }
}
