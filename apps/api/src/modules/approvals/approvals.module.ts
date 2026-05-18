import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_APPROVAL_SLA } from '../../infra/queue/queue.constants';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ApprovalsNotifierService } from './approvals-notifier.service';
import { ApprovalsSlaScheduler } from './approvals-sla.scheduler';
import { ApprovalsSlaProcessor } from './approvals-sla.processor';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    NotificationsModule,
    BullModule.registerQueue({ name: QUEUE_APPROVAL_SLA }),
  ],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalsNotifierService,
    ApprovalsSlaScheduler,
    ApprovalsSlaProcessor,
  ],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
