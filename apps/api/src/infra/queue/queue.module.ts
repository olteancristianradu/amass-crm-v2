import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { buildRedisConnection } from '../redis/redis-connection';
import { QUEUE_AI_CALLS, QUEUE_EMAIL, QUEUE_EXPORT, QUEUE_IMPORT, QUEUE_LEAD_SCORING, QUEUE_REMINDERS, QUEUE_WORKFLOWS } from './queue.constants';

/**
 * Global BullMQ wiring. We share a single ioredis connection across queues
 * because BullMQ workers REQUIRE `maxRetriesPerRequest: null` — if we let
 * each queue construct its own connection without that flag, the worker
 * will error out (`Connection options for Worker must include the
 * "maxRetriesPerRequest: null" option`).
 *
 * Made @Global so any feature module can `BullModule.registerQueue(...)`
 * without re-importing this module.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        // buildRedisConnection honours REDIS_SENTINEL_HOSTS/MASTER when set
        // so a single Sentinel pool backs all queues in prod, while dev keeps
        // working with REDIS_URL. maxRetriesPerRequest:null is required by
        // BullMQ workers — blocking commands must not be cancelled.
        connection: buildRedisConnection({ maxRetriesPerRequest: null }),
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_IMPORT }),
    BullModule.registerQueue({ name: QUEUE_REMINDERS }),
    BullModule.registerQueue({ name: QUEUE_EMAIL }),
    BullModule.registerQueue({ name: QUEUE_AI_CALLS }),
    BullModule.registerQueue({ name: QUEUE_WORKFLOWS }),
    BullModule.registerQueue({ name: QUEUE_LEAD_SCORING }),
    BullModule.registerQueue({ name: QUEUE_EXPORT }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
