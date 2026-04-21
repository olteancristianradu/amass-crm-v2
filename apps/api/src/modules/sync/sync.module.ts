import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';

/**
 * F-scaffold: delta-sync placeholder. Real implementation requires a
 * `changes` table populated by Prisma middleware on every mutation of
 * sync-eligible models, plus a tombstone row for deletes. Deferred.
 */
@Module({
  controllers: [SyncController],
})
export class SyncModule {}
