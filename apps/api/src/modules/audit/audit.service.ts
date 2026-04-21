import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { getTenantContext } from '../../infra/prisma/tenant-context';
import { loadEnv } from '../../config/env';
import { getBreaker } from '../../common/resilience/circuit-breaker';

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

  /** Paginated audit log for the current tenant. OWNER/ADMIN only. */
  async list(opts: {
    cursor?: string;
    limit: number;
    action?: string;
  }): Promise<{ data: AuditLog[]; nextCursor: string | null }> {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) return { data: [], nextCursor: null };

    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(opts.action ? { action: { contains: opts.action } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > opts.limit;
    const data = hasMore ? rows.slice(0, opts.limit) : rows;
    return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null };
  }

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
      const row = await this.prisma.runWithTenant(tenantId, async (tx) => {
        return tx.auditLog.create({
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
      // E-SIEM: fire-and-forget forward. A slow/broken collector must never
      // slow down the request. Errors are swallowed and surfaced through the
      // breaker state in /health/detailed.
      void this.forwardToSiem(tenantId, row);
    } catch (err) {
      this.logger.error(`Audit write failed: ${(err as Error).message}`);
    }
  }

  /**
   * E-SIEM: forward an audit entry to the tenant's SIEM webhook (or the
   * global fallback set via SIEM_WEBHOOK_URL). Wrapped in the 'siem' circuit
   * breaker so a broken collector can't chain-fail every request thread.
   */
  private async forwardToSiem(tenantId: string, row: AuditLog): Promise<void> {
    const env = loadEnv();
    // Per-tenant override (tenant.siemWebhookUrl) beats the global env fallback.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { siemWebhookUrl: true },
    });
    const url = tenant?.siemWebhookUrl ?? env.SIEM_WEBHOOK_URL;
    if (!url) return;
    try {
      await getBreaker('siem', { failureThreshold: 10, resetAfterMs: 60_000 }).exec(async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            id: row.id,
            action: row.action,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            actorId: row.actorId,
            ipAddress: row.ipAddress,
            userAgent: row.userAgent,
            metadata: row.metadata,
            createdAt: row.createdAt.toISOString(),
          }),
        });
        if (!res.ok) throw new Error(`SIEM webhook returned HTTP ${res.status}`);
      });
    } catch (err) {
      this.logger.warn(`SIEM forward failed: ${(err as Error).message}`);
    }
  }

  /**
   * E-compliance: prune audit entries older than `retentionDays`. Returns
   * the number of rows deleted. Intended to be called by MaintenanceScheduler
   * (daily). Tenant-specific overrides live in the DB and supersede the
   * global default.
   */
  async pruneExpired(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
