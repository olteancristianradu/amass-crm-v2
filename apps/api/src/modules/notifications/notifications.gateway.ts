import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';

/**
 * WebSocket gateway for real-time notifications.
 * Clients authenticate by sending their JWT in the handshake auth:
 *   socket = io(url, { auth: { token: '<jwt>' } })
 * On connect the socket joins room `tenant:{tenantId}:user:{userId}`.
 * NotificationsService.emit() pushes to that room.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.['token'] as string | undefined
      ?? (client.handshake.headers.authorization ?? '').replace('Bearer ', '');

    if (!token) { client.disconnect(); return; }

    try {
      const env = loadEnv();
      const payload = this.jwt.verify<{ sub: string; tenantId: string }>(token, { secret: env.JWT_SECRET });
      const room = `tenant:${payload.tenantId}:user:${payload.sub}`;
      await client.join(room);
      client.data['userId'] = payload.sub;
      client.data['tenantId'] = payload.tenantId;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /** Push a notification to a specific user. Called by NotificationsService. */
  emitToUser(tenantId: string, userId: string, event: string, payload: unknown): void {
    this.server.to(`tenant:${tenantId}:user:${userId}`).emit(event, payload);
  }

  @SubscribeMessage('mark-read')
  handleMarkRead(@ConnectedSocket() client: Socket, @MessageBody() data: { id: string }): { ok: boolean } {
    // Lightweight ack — actual DB update goes through REST PATCH /notifications/:id/read
    this.logger.debug(`mark-read from ${client.data['userId'] as string}: ${data.id}`);
    return { ok: true };
  }
}
