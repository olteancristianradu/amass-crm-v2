import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists users in the current tenant. Uses runWithTenant so RLS enforces
   * isolation even if a future bug strips the WHERE clause.
   */
  async listForCurrentTenant() {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) =>
      tx.user.findMany({
        where: { tenantId: ctx.tenantId },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }
}
