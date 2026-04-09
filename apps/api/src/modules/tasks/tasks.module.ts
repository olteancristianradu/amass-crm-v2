import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * TasksModule — polymorphic tasks. A task links to EITHER a Deal OR one
 * of the SubjectTypes (Company / Contact / Client). ActivitiesService +
 * SubjectResolver are @Global so no explicit imports are needed.
 */
@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
