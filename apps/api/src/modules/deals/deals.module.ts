import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

/**
 * DealsModule — the kanban data layer. Depends on PipelinesModule
 * (which is @Global) for stage lookups during move + default pipeline
 * resolution. ActivitiesService + AuditService are @Global so no import
 * is needed for them.
 */
@Module({
  imports: [AuthModule, WorkflowsModule, ProjectsModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
