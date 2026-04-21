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
 */
const env = loadEnv();
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

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

  /** Emit a reminder:fired event to everyone in the tenant room. */
  emitReminderFired(tenantId: string, payload: { id: string; title: string; body: string | null }): void {
    this.server.to(`tenant:${tenantId}`).emit('reminder:fired', payload);
  }
}
