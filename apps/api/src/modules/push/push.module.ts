import { Global, Module } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * F-scaffold: push-notification module. Exposes a no-op PushService so any
 * feature that wants to notify a user's devices can depend on it today,
 * and the only change when the real APNs/FCM clients are wired is inside
 * PushService.send — not at call sites.
 */
@Global()
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
