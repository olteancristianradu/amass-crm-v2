import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { EmailModule } from '../email/email.module';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowRunProcessor } from './workflow-run.processor';

/**
 * S15 Workflows module. @Global so WorkflowsService can be injected in
 * CompaniesService, ContactsModule, etc. without explicit imports.
 * QueueModule (@Global) already registers the 'workflow-runs' queue.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule, CampaignsModule, EmailModule],
  providers: [WorkflowsService, WorkflowRunProcessor],
  controllers: [WorkflowsController],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
