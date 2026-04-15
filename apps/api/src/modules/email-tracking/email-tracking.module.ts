import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTrackingController } from './email-tracking.controller';
import { EmailTrackingService } from './email-tracking.service';

/**
 * S25 — Email open/click tracking. Public endpoints for pixel + click
 * redirect, authed endpoint for stats. EmailService imports this module
 * to call injectTracking() before persisting outbound HTML.
 */
@Module({
  imports: [AuthModule],
  controllers: [EmailTrackingController],
  providers: [EmailTrackingService],
  exports: [EmailTrackingService],
})
export class EmailTrackingModule {}
