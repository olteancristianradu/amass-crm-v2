import { Global, Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { SubjectResolver } from './subject-resolver';

/**
 * ActivitiesModule — global, two responsibilities:
 *
 *   1. ActivitiesService.log() — append-only event log shown in the UI
 *      timeline. Best-effort by design: if the activities table is
 *      unreachable we MUST NOT block the user-facing operation. Distinct
 *      from audit_logs (security trail, mandatory).
 *
 *   2. SubjectResolver.assertExists(subjectType, subjectId) — single
 *      source of truth for "does this polymorphic subject exist in my
 *      tenant?". Used by NotesModule, AttachmentsModule, and (soon) any
 *      other polymorphic feature. Throws 404 SUBJECT_NOT_FOUND with a
 *      consistent error code.
 *
 * Made @Global so any feature module can inject these without
 * re-importing — both are write-mostly cross-cutting state.
 */
@Global()
@Module({
  providers: [ActivitiesService, SubjectResolver],
  exports: [ActivitiesService, SubjectResolver],
})
export class ActivitiesModule {}
