import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * AttachmentsModule — polymorphic file attachments on any subject.
 *
 * Two-step upload (per CLAUDE.md mandate):
 *   1. POST /:subjectType/:subjectId/attachments/presign
 *      → returns {storageKey, uploadUrl, expiresIn}
 *   2. FE PUTs the bytes DIRECTLY to MinIO at uploadUrl (bypassing the API)
 *   3. POST /:subjectType/:subjectId/attachments
 *      → API verifies the object exists + persists the metadata row
 *
 * Why two-step: the API never sees the file body, so we can support
 * 100MB+ uploads without buffering. The complete() step calls
 * storage.exists() so we don't create dangling rows for half-uploads.
 *
 * Storage key layout: <tenantId>/<subjectType>/<subjectId>/<uuid><ext>
 *   - tenantId prefix → defense in depth (forged keys from other tenants
 *     are rejected with 400 INVALID_STORAGE_KEY)
 *   - uuid basename → never trust user input in object names
 *   - extension preserved for MinIO Content-Type inference + UX
 *
 * Downloads use presigned GET URLs (15-min TTL) — same direct-to-MinIO
 * pattern. The API only ever returns the URL, never the bytes.
 *
 * Soft delete: deletedAt + best-effort MinIO removeObject. Orphan sweep
 * job lands in S18 (backup + observability sprint).
 */
@Module({
  imports: [AuthModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
