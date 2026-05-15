import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { RedisModule } from '../redis/redis.module';
import { WsGateway } from './ws.gateway';
import { SyncGateway } from './sync.gateway';
import { SyncPublisherService } from './sync-publisher.service';

/**
 * WS infrastructure module.
 *
 * Two gateways live here:
 *   • WsGateway  (path: /ws)        legacy reminder push (kept compatible
 *                                   with the existing FE client).
 *   • SyncGateway (namespace: /sync) B1 realtime data-sync — JWT handshake,
 *                                   per-tenant rooms, broadcasted by
 *                                   SyncPublisherService (the only thing
 *                                   feature modules should depend on).
 *
 * Why JwtModule.registerAsync here? SyncGateway uses @nestjs/jwt's
 * JwtService.verifyAsync to validate the handshake. We mirror AuthModule's
 * lazy-factory pattern so loadEnv() runs at module-resolution time, not at
 * import time (avoids test-setup ordering issues).
 */
@Module({
  imports: [
    RedisModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: loadEnv().JWT_SECRET }),
    }),
  ],
  providers: [WsGateway, SyncGateway, SyncPublisherService],
  // SyncPublisherService is the public surface — feature modules import
  // WsModule and inject the publisher. WsGateway stays exported for the
  // existing reminders consumer that emits reminder:fired directly.
  exports: [WsGateway, SyncPublisherService],
})
export class WsModule {}
