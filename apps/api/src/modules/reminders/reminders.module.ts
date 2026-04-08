import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { RemindersProcessor } from './reminders.processor';

/**
 * RemindersModule — polymorphic reminders attached to Company / Contact /
 * Client (and any future SubjectType). Uses BullMQ delayed jobs to fire
 * at the user-supplied `remindAt`.
 *
 * Lifecycle:
 *   1. RemindersService.create() persists the row + enqueues a delayed
 *      job (jobId = reminder.id, delay = remindAt - now).
 *   2. When the delay elapses, RemindersProcessor.process() re-fetches
 *      the row, skips if not PENDING (dismissed/deleted in the meantime),
 *      flips status → FIRED, writes audit + activity rows.
 *   3. Update with new remindAt → cancel old job (queue.remove(id)) +
 *      re-enqueue. Cannot edit a job's delay in place in BullMQ.
 *   4. Dismiss / delete → cancel the job, mark the row.
 *
 * The DB row is always source of truth; the BullMQ job carries only
 * `{reminderId, tenantId}` so schema migrations don't break in-flight jobs.
 *
 * MVP delivery is "mark FIRED + write activity row". Email/push integrations
 * land in S11 (Email) and S12+ (Twilio). They will hook off the activity
 * row, not off the queue, so this module won't need changes.
 */
@Module({
  imports: [AuthModule, QueueModule],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersProcessor],
})
export class RemindersModule {}
