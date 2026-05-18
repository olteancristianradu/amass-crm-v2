import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { QUEUE_CONTRACT_EXPIRE, QUEUE_CONTRACT_REMINDER } from '../../infra/queue/queue.constants';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PdfGeneratorService } from './services/pdf-generator.service';
import { AuditChainService } from './services/audit-chain.service';
import { ContractSweeperService } from './services/contract-sweeper.service';
import { ContractReminderScheduler } from './workers/contract-reminder.scheduler';
import { ContractReminderProcessor } from './workers/contract-reminder.processor';
import { ContractExpireScheduler } from './workers/contract-expire.scheduler';
import { ContractExpireProcessor } from './workers/contract-expire.processor';

/**
 * ContractsModule — legal agreements linked to companies.
 *
 * Phase 2 F1 extensions:
 *  - PdfGeneratorService    — pdfkit renderer (re-used by ContractSignersModule).
 *  - AuditChainService      — append-only hash-chained audit trail
 *                             (single write path for ContractAuditEntry).
 *  - ContractSweeperService — shared cron logic used by reminder+expire processors.
 *  - Two BullMQ crons       — daily reminder cadence (T+3/7/12) and hourly
 *                             ceremony expiry sweep.
 *
 * Routes (all behind JwtAuthGuard):
 *   POST   /contracts          create
 *   GET    /contracts          list
 *   GET    /contracts/:id      get single
 *   PATCH  /contracts/:id      update
 *   DELETE /contracts/:id      soft delete
 *
 * Ceremony routes (POST /contracts/:id/send-for-signature plus public
 * /p/sign/*) live in ContractSignersModule which imports this module
 * for the renderer + audit chain.
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    AccessControlModule,
    BullModule.registerQueue({ name: QUEUE_CONTRACT_REMINDER }),
    BullModule.registerQueue({ name: QUEUE_CONTRACT_EXPIRE }),
  ],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    PdfGeneratorService,
    AuditChainService,
    ContractSweeperService,
    ContractReminderScheduler,
    ContractReminderProcessor,
    ContractExpireScheduler,
    ContractExpireProcessor,
  ],
  exports: [ContractsService, PdfGeneratorService, AuditChainService, ContractSweeperService],
})
export class ContractsModule {}
