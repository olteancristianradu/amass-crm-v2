import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTrackingModule } from '../email-tracking/email-tracking.module';
import { EmailSuppressionModule } from '../email-suppression/email-suppression.module';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';

/**
 * S11 Email module. Provides:
 *  - Per-user SMTP account management (CRUD, encrypted passwords)
 *  - Email composition + async send via BullMQ
 *  - Sent email list + timeline integration
 *
 * Phase 1 F1: imports EmailSuppressionModule so the pre-send pipeline can
 * call `EmailSuppressionService.isSuppressed()` before enqueuing.
 *
 * Depends on:
 *  - PrismaModule (global) — DB access
 *  - QueueModule (global) — BullMQ 'email' queue
 *  - ActivitiesModule — timeline entries
 *  - AuditModule — audit log
 */
@Module({
  imports: [AuthModule, EmailTrackingModule, EmailSuppressionModule],
  controllers: [EmailController],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
