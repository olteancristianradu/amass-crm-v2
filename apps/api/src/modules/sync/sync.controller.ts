import { Controller, Get, HttpException, HttpStatus, Query } from '@nestjs/common';

/**
 * F-scaffold: delta-sync API. Mobile + offline clients call
 *   GET /v1/sync?since=<cursor>&types=deal,contact,task
 * and receive the set of creates/updates/tombstones newer than `since`, plus
 * a fresh cursor for the next pull.
 *
 * The cursor format will be opaque base64 (tenantId + lastSeenChangeId).
 * Stub for now — returning 501 ensures we don't accidentally ship a noop
 * "everything is up to date" response that hides broken sync.
 */
@Controller('sync')
export class SyncController {
  @Get()
  delta(@Query('since') _since?: string, @Query('types') _types?: string) {
    throw new HttpException(
      { code: 'SYNC_NOT_IMPLEMENTED', message: 'Delta sync API is scaffolded but not implemented yet' },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
