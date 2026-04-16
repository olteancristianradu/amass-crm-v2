import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * AuditModule — global, append-only security trail.
 *
 * Distinction from ActivitiesService:
 *   - AuditService = security-grade record (auth events, deletes, role
 *     changes, GDPR exports). Mandatory; if it can't write we should
 *     consider that an alarming condition. Stored in `audit_logs` table.
 *   - ActivitiesService = user-visible "what happened" feed for the
 *     timeline. Best-effort. Stored in `activities` table.
 *
 * Both are tenant-scoped. AuditService is called from auth, companies,
 * contacts, clients, notes, attachments, importer — anywhere we mutate
 * data or do a security-relevant action.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
