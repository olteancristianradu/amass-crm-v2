import { Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';

/**
 * S11 Email module. Provides:
 *  - Per-user SMTP account management (CRUD, encrypted passwords)
 *  - Email composition + async send via BullMQ
 *  - Sent email list + timeline integration
 *
 * Depends on:
 *  - PrismaModule (global) — DB access
 *  - QueueModule (global) — BullMQ 'email' queue
 *  - ActivitiesModule — timeline entries
 *  - AuditModule — audit log
 */
@Module({
  controllers: [EmailController],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
