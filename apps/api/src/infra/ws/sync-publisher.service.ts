import { Injectable, Logger } from '@nestjs/common';
import { SyncGateway } from './sync.gateway';

/**
 * Thin facade over SyncGateway. Feature modules (B1-PR3) inject this — not
 * the gateway — so they:
 *   • don't pull in the @WebSocketServer decorator chain in test bundles
 *   • can be unit-tested with a trivial mock object
 *   • survive boot-race conditions where the gateway exists but @WebSocketServer
 *     has not been populated yet (Socket.IO server is null)
 *
 * Intentionally synchronous: Socket.IO's emit is fire-and-forget; making
 * publish() async would mislead callers into awaiting a delivery that
 * doesn't happen here.
 */
@Injectable()
export class SyncPublisherService {
  private readonly logger = new Logger(SyncPublisherService.name);

  constructor(private readonly gateway: SyncGateway) {}

  /**
   * Publish a domain event to every socket in `tenant:<tenantId>`. Drops
   * the message with a warn log if the gateway's Socket.IO server isn't
   * mounted yet (boot race). Never throws.
   */
  publish(tenantId: string, event: string, payload: unknown): void {
    if (!this.gateway?.server) {
      this.logger.warn(
        `sync publish dropped — gateway not ready (tenant=${tenantId} event=${event})`,
      );
      return;
    }
    this.gateway.broadcast(tenantId, event, payload);
  }
}
