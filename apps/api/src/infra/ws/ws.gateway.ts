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

/**
 * Socket.IO gateway. Clients authenticate with a JWT in the handshake auth
 * and are placed in a tenant-scoped room (`tenant:{tenantId}`) so we can
 * broadcast to all sessions for a given tenant without user enumeration.
 *
 * Path matches the Vite proxy config: /ws
 */
@WebSocketGateway({ path: '/ws', cors: { origin: '*' } })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() readonly server!: Server;
  private readonly logger = new Logger(WsGateway.name);
  private readonly jwt: JwtService;

  constructor() {
    this.jwt = new JwtService({ secret: loadEnv().JWT_SECRET });
  }

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth as Record<string, string | undefined>).token ??
      (client.handshake.headers.authorization ?? '').replace('Bearer ', '');

    try {
      const payload = this.jwt.verify<{ tenantId: string; sub: string }>(token);
      void client.join(`tenant:${payload.tenantId}`);
      this.logger.debug(`WS connected sub=${payload.sub} tenant=${payload.tenantId}`);
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
