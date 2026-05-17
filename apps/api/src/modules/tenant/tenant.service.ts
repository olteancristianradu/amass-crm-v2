import { BadRequestException, Injectable } from '@nestjs/common';
import { type Locale, LocaleSchema } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { UpdateTenantLocaleDto } from './tenant.dto';

/**
 * Phase 0 / Feature 1 — tenant-wide locale config.
 *
 * Two endpoints (GET + PATCH) wired through TenantController. Both are
 * thin wrappers because the only real logic is the cross-field constraint
 * (`defaultLocale ∈ enabledLocales`), which lives in the Zod schema. The
 * audit row captures the BEFORE state so a tenant admin can see who
 * switched the workspace from RO-only to RO+EN.
 *
 * Out of scope here:
 *   - per-user locale enforcement when a tenant DROPS a locale from
 *     `enabledLocales`. The `resolveLocale()` cascade in @amass/shared
 *     handles that at read-time: a user whose `preferredLocale` is no
 *     longer enabled silently falls back to `tenant.defaultLocale`.
 *     We don't backfill `User.preferredLocale` rows on drop — that would
 *     be destructive and the cascade gives the same UX.
 */
@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Read the tenant-wide locale config for the caller's tenant.
   * Returns short codes (e.g. `ro`, `en`) — the same shape Prisma stores.
   */
  async getLocaleConfig(): Promise<{ defaultLocale: Locale; enabledLocales: Locale[] }> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { defaultLocale: true, enabledLocales: true },
      });
      // Defensive normalise — old rows may have a stray value not in the
      // current whitelist (e.g. operator hand-edit). Filter + fall back.
      const enabled = tenant.enabledLocales.filter((l): l is Locale =>
        LocaleSchema.safeParse(l).success,
      );
      const defaultParsed = LocaleSchema.safeParse(tenant.defaultLocale);
      const defaultLocale: Locale = defaultParsed.success ? defaultParsed.data : 'ro';
      return {
        defaultLocale,
        enabledLocales: enabled.length > 0 ? enabled : ['ro'],
      };
    });
  }

  async updateLocaleConfig(actorId: string, dto: UpdateTenantLocaleDto) {
    const ctx = requireTenantContext();
    // Belt-and-braces: re-check cross-field constraint here so a future
    // bypass of ZodValidationPipe still fails closed.
    if (!dto.enabledLocales.includes(dto.defaultLocale)) {
      throw new BadRequestException({
        code: 'INVALID_LOCALE_CONFIG',
        message: 'defaultLocale must be in enabledLocales',
      });
    }

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { defaultLocale: true, enabledLocales: true },
      });

      const updated = await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          defaultLocale: dto.defaultLocale,
          enabledLocales: dto.enabledLocales,
        },
        select: { defaultLocale: true, enabledLocales: true },
      });

      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId,
        action: 'tenant.locale_config_change',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        metadata: {
          from: before,
          to: { defaultLocale: dto.defaultLocale, enabledLocales: dto.enabledLocales },
        },
      });

      return updated;
    });
  }
}
