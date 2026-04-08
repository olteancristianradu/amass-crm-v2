import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { loadEnv } from '../../config/env';
import { QUEUE_IMPORT } from './queue.constants';

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
      useFactory: () => {
        const env = loadEnv();
        return {
          connection: new IORedis(env.REDIS_URL, {
            // Required by BullMQ workers — connection is shared.
            maxRetriesPerRequest: null,
          }),
        };
      },
    }),
    BullModule.registerQueue({ name: QUEUE_IMPORT }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
