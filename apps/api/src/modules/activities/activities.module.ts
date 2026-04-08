import { Global, Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { SubjectResolver } from './subject-resolver';

/**
 * Made @Global so any feature module (companies, contacts, clients, notes,
 * future deals/calls) can inject ActivitiesService without re-importing.
 * Activities are write-mostly cross-cutting state — global is appropriate.
 */
@Global()
@Module({
  providers: [ActivitiesService, SubjectResolver],
  exports: [ActivitiesService, SubjectResolver],
})
export class ActivitiesModule {}
