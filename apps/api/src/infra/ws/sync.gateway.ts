import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { loadEnv } from '../../config/env';
import { PresenceService } from './presence.service';

/**
 * B1 — Realtime data-sync gateway.
 *
 * Foundation only (B1-PR1): handshake JWT verification + per-tenant rooms.
 * Per-mutation publishers (B1-PR2) inject SyncPublisherService rather
 * than this gateway directly. Presence (B1-PR4) handles per-resource
 * "who's looking at this" tracking via PresenceService.
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

/**
 * Payload shape for `presence:enter` / `presence:leave` events from the
 * client. We deliberately do NOT trust client-supplied tenantId/userId —
 * both come from the verified JWT stored on `client.data` at handshake.
 */
interface PresencePayload {
  resourceType: string;
  resourceId: string;
}

@WebSocketGateway({
  namespace: '/sync',
  cors: { origin: syncCorsOrigins, credentials: true },
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SyncGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly presence: PresenceService,
  ) {}

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

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`sync ws disconnected id=${client.id}`);
    // B1-PR4: scrub the per-socket presence index and notify every room the
    // socket was watching so other viewers see "user left" without waiting
    // for the 60s TTL. Wrapped in try/catch because a Redis hiccup on
    // disconnect should never bubble (Socket.IO would treat it as unhandled).
    try {
      const tracked = await this.presence.cleanupSocket(client.id);
      for (const t of tracked) {
        this.server.to(`tenant:${t.tenantId}`).emit('presence:left', {
          resourceType: t.resourceType,
          resourceId: t.resourceId,
          userId: t.userId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `presence cleanup failed for socket ${client.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
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
   * B1-PR4 — client says "I'm viewing this resource".
   *
   * Trust model: tenantId + userId come from `client.data` (set at JWT
   * handshake), NOT the payload. A malicious client cannot spoof presence
   * under another tenant or impersonate another user even with a valid
   * own-JWT — the broadcast room and the Redis key both source from the
   * handshake claim.
   *
   * Idempotent: emitting `presence:enter` twice in a row re-broadcasts
   * `presence:joined` but the Redis SADD is a no-op. That's fine — the
   * FE de-dupes by userId in the local Set.
   */
  @SubscribeMessage('presence:enter')
  async onPresenceEnter(
    @MessageBody() payload: PresencePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const tenantId = client.data['tenantId'] as string | undefined;
    const userId = client.data['userId'] as string | undefined;
    if (!tenantId || !userId) {
      // Should be impossible — handshake disconnects unauthenticated
      // sockets — but defense in depth.
      this.logger.warn(`presence:enter from unauthenticated socket ${client.id}`);
      return;
    }
    if (!payload?.resourceType || !payload?.resourceId) {
      this.logger.warn(`presence:enter with malformed payload from socket ${client.id}`);
      return;
    }

    await this.presence.enter(
      tenantId,
      payload.resourceType,
      payload.resourceId,
      userId,
      client.id,
    );
    this.server.to(`tenant:${tenantId}`).emit('presence:joined', {
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      userId,
    });
  }

  /**
   * B1-PR4 — client says "I'm done with this resource" (tab close, route
   * change). Cleaner UX than waiting for the 60s TTL.
   */
  @SubscribeMessage('presence:leave')
  async onPresenceLeave(
    @MessageBody() payload: PresencePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const tenantId = client.data['tenantId'] as string | undefined;
    const userId = client.data['userId'] as string | undefined;
    if (!tenantId || !userId) return;
    if (!payload?.resourceType || !payload?.resourceId) return;

    await this.presence.leave(
      tenantId,
      payload.resourceType,
      payload.resourceId,
      userId,
    );
    this.server.to(`tenant:${tenantId}`).emit('presence:left', {
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      userId,
    });
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
