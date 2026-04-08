import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

/**
 * NotesModule — polymorphic notes attached to any subject
 * (Company / Contact / Client today, Deal/Task in later sprints).
 *
 * Routes:
 *   POST   /:subjectType/:subjectId/notes      create   (AGENT+)
 *   GET    /:subjectType/:subjectId/notes      list     (VIEWER+)
 *   GET    /:subjectType/:subjectId/timeline   merged note + activity feed
 *   PATCH  /notes/:noteId                      update   (AGENT+)
 *   DELETE /notes/:noteId                      soft del (AGENT+)
 *
 * Polymorphism: every note row has (subjectType, subjectId). The route
 * accepts the subjectType in the URL (lowercase tolerated, normalised
 * via SubjectTypeSchema). SubjectResolver.assertExists() validates the
 * subject is real + in this tenant before any read or write — without
 * that, you'd get cryptic 500s when the FK doesn't exist.
 *
 * Timeline = notes ∪ activities, merged in memory by createdAt desc and
 * paginated with an ISO timestamp cursor. See notes.service.getTimeline().
 *
 * Soft delete via deletedAt — list/timeline filter out deleted rows.
 * Hard delete is intentionally NOT exposed (GDPR sweep happens in S17).
 */
@Module({
  imports: [AuthModule],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
