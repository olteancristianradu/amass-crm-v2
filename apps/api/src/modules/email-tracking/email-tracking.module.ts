import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { EmailSuppressionModule } from '../email-suppression/email-suppression.module';
import { EmailTrackingController } from './email-tracking.controller';
import { EmailTrackingService } from './email-tracking.service';
import { EmailTracksPiiScheduler } from './email-tracks-pii.scheduler';
import { EmailTracksPiiProcessor } from './email-tracks-pii.processor';

/**
 * S25 + Phase 1 F1 — Email open/click/unsubscribe/bounce tracking.
 *
 * Public endpoints (no auth, HMAC-protected) for pixel + click redirect +
 * one-click unsubscribe. Authed endpoint for per-message stats. EmailService
 * imports this module to call injectTracking() before persisting outbound HTML.
 *
 * The PII purge cron (`EmailTracksPiiScheduler`) + worker
 * (`EmailTracksPiiProcessor`) live here so the bounded `90d` retention is
 * owned by the same module that writes the rows in the first place.
 */
@Module({
  imports: [AuthModule, AuditModule, EmailSuppressionModule],
  controllers: [EmailTrackingController],
  providers: [EmailTrackingService, EmailTracksPiiScheduler, EmailTracksPiiProcessor],
  exports: [EmailTrackingService],
})
export class EmailTrackingModule {}
