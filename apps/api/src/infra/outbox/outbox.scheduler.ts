/**
 * Outbox poller scheduler — installs a single repeatable BullMQ job on
 * boot that fires every 5s. The job is empty (no payload); it exists only
 * to wake the OutboxPoller worker which then drains a batch of PENDING
 * rows. Putting the timing in BullMQ rather than @nestjs/schedule means
 * the tick survives an API replica restart and never duplicates because
 * the repeat key is stable.
 *
 * Why a single repeatable job (not a fresh job each call):
 *   - BullMQ's `repeat: { every }` registers ONE repeat key and emits the
 *     scheduled job at the cadence; subsequent registrations with the same
 *     repeat key are no-ops. So multiple API replicas booting register
 *     the same repeat and only one tick fires per interval (not N).
 *   - The worker has concurrency 1 (see outbox.poller.ts) which means
 *     even if a previous tick is still running, the next tick stalls in
 *     the queue and runs serially — no race on the same PENDING row.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_OUTBOX_POLL } from '../queue/queue.constants';

export const OUTBOX_POLL_INTERVAL_MS = 5_000;
export const OUTBOX_POLL_JOB_NAME = 'drain';
export const OUTBOX_POLL_REPEAT_KEY = 'outbox-drain';

@Injectable()
export class OutboxScheduler implements OnModuleInit {
  private readonly logger = new Logger(OutboxScheduler.name);

  constructor(
    @InjectQueue(QUEUE_OUTBOX_POLL) private readonly queue: Queue,
    @Inject('OUTBOX_POLL_ENABLED') private readonly enabled: boolean,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      // Tests opt out by binding 'OUTBOX_POLL_ENABLED' to false so the
      // BullMQ repeat doesn't keep firing during a vitest run.
      this.logger.debug('Outbox poller disabled (test/dev opt-out)');
      return;
    }
    try {
      await this.queue.add(
        OUTBOX_POLL_JOB_NAME,
        {},
        {
          repeat: { every: OUTBOX_POLL_INTERVAL_MS, key: OUTBOX_POLL_REPEAT_KEY },
          // The tick job carries no business data — keep the history small.
          removeOnComplete: { count: 5 },
          removeOnFail: { count: 20 },
        },
      );
      this.logger.log(
        `Outbox poller registered every=${OUTBOX_POLL_INTERVAL_MS}ms key=${OUTBOX_POLL_REPEAT_KEY}`,
      );
    } catch (err) {
      this.logger.error(
        `Outbox poller registration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // We deliberately don't rethrow — the API can still serve writes
      // (they land in outbox_events), an operator can rerun the registration
      // via a one-shot script. Failing module init would also fail the
      // health endpoint which has worse blast radius than a stalled poller.
    }
  }
}
