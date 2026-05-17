import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailSuppressionController } from './email-suppression.controller';

/**
 * Phase 1 F1 — Email suppression list module (GDPR "do not contact").
 *
 * Exports the service so EmailService (pre-send check) and EmailTrackingService
 * (unsubscribe endpoint, bounce webhook handler) can call into it without
 * re-importing the controller.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [EmailSuppressionController],
  providers: [EmailSuppressionService],
  exports: [EmailSuppressionService],
})
export class EmailSuppressionModule {}
