import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SubjectType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { getTenantContext } from '../../infra/prisma/tenant-context';

export interface ActivityEntry {
  subjectType: SubjectType;
  subjectId: string;
  action: string;
  metadata?: Record<string, unknown>;
  /**
   * Fallback tenant for callers that don't have AsyncLocalStorage context —
   * notably Twilio/Stripe webhook handlers (which run outside JWT middleware).
   * If provided, used when getTenantContext() returns null. Without this,
   * webhook-triggered events silently drop with a "no tenant context" warning.
   */
  tenantId?: string;
  actorId?: string | null;
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
    // Prefer explicit fallback for webhook callers; fall back to ALS context.
    const tenantId = entry.tenantId ?? ctx?.tenantId;
    const actorId = entry.actorId !== undefined ? entry.actorId : ctx?.userId ?? null;
    if (!tenantId) {
      this.logger.warn(`Activity dropped — no tenant context for action=${entry.action}`);
      return;
    }
    try {
      await this.prisma.runWithTenant(tenantId, async (tx) => {
        await tx.activity.create({
          data: {
            tenantId,
            subjectType: entry.subjectType,
            subjectId: entry.subjectId,
            actorId,
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
