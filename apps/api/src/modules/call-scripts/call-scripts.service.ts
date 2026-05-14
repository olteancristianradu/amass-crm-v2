import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * Read/write the current tenant's `defaultCallScript`. The schema field is
 * Json (nullable). The service normalises to `string[]` on read and stores
 * `null` when the caller passes an empty list (= disable feature).
 */
@Injectable()
export class CallScriptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the current list (possibly empty) — never NULL. */
  async getDefault(): Promise<{ points: string[] }> {
    const { tenantId } = requireTenantContext();
    // Direct prisma.tenant.findUnique — Tenant is NOT tenant-scoped (it IS the
    // tenant). runWithTenant would still work but adds RLS overhead unnecessarily.
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultCallScript: true },
    });
    if (!t) throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
    const raw = t.defaultCallScript;
    const points = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    return { points };
  }

  /**
   * Replace the list wholesale. Empty list → store NULL so the recording
   * webhook handler knows to skip script-compliance evaluation entirely
   * (cheaper than enqueuing a no-op AI step).
   */
  async setDefault(points: string[]): Promise<{ points: string[] }> {
    const { tenantId } = requireTenantContext();
    const cleaned = (points ?? [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0)
      .slice(0, 50); // hard cap to keep Claude prompt size bounded
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        defaultCallScript:
          cleaned.length > 0
            ? (cleaned as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
    return { points: cleaned };
  }
}
