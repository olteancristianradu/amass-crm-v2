import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { getTenantContext } from '../../infra/prisma/tenant-context';

export interface AuditEntry {
  action: string;
  subjectType?: string;
  subjectId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  // Override tenant/actor when not running inside a request (e.g. system jobs)
  tenantId?: string;
  actorId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Best-effort audit write. Never throws — failing to log must not break business flows.
   * Tenant + actor are pulled from AsyncLocalStorage if not provided.
   */
  async log(entry: AuditEntry): Promise<void> {
    const ctx = getTenantContext();
    const tenantId = entry.tenantId ?? ctx?.tenantId;
    const actorId = entry.actorId ?? ctx?.userId;

    if (!tenantId) {
      this.logger.warn(`Audit dropped — no tenantId for action=${entry.action}`);
      return;
    }

    try {
      await this.prisma.runWithTenant(tenantId, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actorId ?? null,
            action: entry.action,
            subjectType: entry.subjectType ?? null,
            subjectId: entry.subjectId ?? null,
            metadata: entry.metadata ? (entry.metadata as object) : undefined,
            ipAddress: entry.ipAddress ?? null,
            userAgent: entry.userAgent ?? null,
          },
        });
      });
    } catch (err) {
      this.logger.error(`Audit write failed: ${(err as Error).message}`);
    }
  }
}
