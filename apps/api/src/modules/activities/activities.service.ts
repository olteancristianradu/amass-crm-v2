import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SubjectType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { getTenantContext } from '../../infra/prisma/tenant-context';

export interface ActivityEntry {
  subjectType: SubjectType;
  subjectId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * Domain-level activity log. Distinct from `audit_logs`:
 *   - audit_logs = security/compliance events (auth.login, role changes)
 *   - activities = user-visible timeline events (company.created, note.added)
 *
 * Best-effort writes — never throws. A failure to log a timeline event must
 * NOT break the underlying business operation (matches AuditService pattern).
 */
@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: ActivityEntry): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx) {
      this.logger.warn(`Activity dropped — no tenant context for action=${entry.action}`);
      return;
    }
    try {
      await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
        await tx.activity.create({
          data: {
            tenantId: ctx.tenantId,
            subjectType: entry.subjectType,
            subjectId: entry.subjectId,
            actorId: ctx.userId ?? null,
            action: entry.action,
            metadata: entry.metadata
              ? (entry.metadata as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });
      });
    } catch (err) {
      this.logger.error(`Activity write failed: ${(err as Error).message}`);
    }
  }
}
