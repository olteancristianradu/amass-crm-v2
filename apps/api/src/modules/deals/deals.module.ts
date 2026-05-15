import { Module } from '@nestjs/common';
import { WsModule } from '../../infra/ws/ws.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

/**
 * DealsModule — the kanban data layer. Depends on PipelinesModule
 * (which is @Global) for stage lookups during move + default pipeline
 * resolution. ActivitiesService + AuditService are @Global so no import
 * is needed for them. WsModule exports SyncPublisherService so we can emit
 * deal.moved / deal.won / deal.lost on every kanban mutation (B1-PR2).
 */
@Module({
  imports: [AuthModule, WorkflowsModule, ProjectsModule, AccessControlModule, WsModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
