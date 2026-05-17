import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { type Locale, LocaleSchema, resolveLocale } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { BusinessMetricsService } from '../../infra/metrics/business-metrics.service';
import { USER_REVOKED_BEFORE_PREFIX } from '../auth/auth.service';
import { InviteUserDto, UpdateUserRoleDto } from './users.dto';

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  preferredLocale: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    // @Optional-style: the metrics service is `@Global()` so DI always
    // satisfies it. The spec file mocks it explicitly — see users.service.spec.ts.
    private readonly metrics: BusinessMetricsService,
  ) {}

  async listForCurrentTenant() {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) =>
      tx.user.findMany({
        where: { tenantId: ctx.tenantId },
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async getById(userId: string) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: ctx.tenantId },
        select: SAFE_SELECT,
      });
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  /**
   * Minimal lookup for display purposes — returns `{id, fullName}` only for
   * userIds that exist in the current tenant. Designed for the FE
   * PresenceBadge ("Dana editează acest deal") so an AGENT/VIEWER user can
   * resolve a coworker's display name without needing OWNER/ADMIN/MANAGER
   * access to the full /users surface.
   *
   * Privacy: only fullName + id leak — no email, no role, no last-login.
   * The id MUST already be known to the caller (they got it from the
   * presence WebSocket broadcast), so this is not a directory leak.
   *
   * Tenant-scoped: rows from other tenants are filtered out by the
   * tenantExtension; the explicit `tenantId: ctx.tenantId` filter is
   * defense-in-depth.
   */
  async lookupDisplayNames(userIds: string[]) {
    if (userIds.length === 0) return [];
    // Cap at 100 to prevent a malicious or buggy caller from enumerating
    // an entire (large) tenant in one request.
    const capped = userIds.slice(0, 100);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) =>
      tx.user.findMany({
        where: { id: { in: capped }, tenantId: ctx.tenantId },
        select: { id: true, fullName: true },
      }),
    );
  }

  /** Create a new user in the current tenant (OWNER/ADMIN only). */
  async invite(dto: InviteUserDto, actorId: string) {
    const ctx = requireTenantContext();
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const exists = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: ctx.tenantId, email: dto.email.toLowerCase() } },
      });
      if (exists) {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already in use in this tenant' });
      }

      const user = await tx.user.create({
        data: {
          tenantId: ctx.tenantId,
          email: dto.email.toLowerCase(),
          passwordHash,
          fullName: dto.fullName,
          role: dto.role,
        },
        select: SAFE_SELECT,
      });

      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId,
        action: 'user.invite',
        subjectType: 'user',
        subjectId: user.id,
      });

      return user;
    });
  }

  /** Update a user's role (OWNER only — an ADMIN cannot promote to OWNER). */
  async updateRole(userId: string, dto: UpdateUserRoleDto, actorRole: UserRole, actorId: string) {
    const ctx = requireTenantContext();

    // Only OWNER can assign/revoke OWNER role.
    if (dto.role === UserRole.OWNER && actorRole !== UserRole.OWNER) {
      throw new ForbiddenException('Only an OWNER can assign the OWNER role');
    }

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId } });
      if (!target) throw new NotFoundException('User not found');

      // Prevent demoting the last OWNER — tenant would become unmanageable.
      if (target.role === UserRole.OWNER && dto.role !== UserRole.OWNER) {
        const ownerCount = await tx.user.count({ where: { tenantId: ctx.tenantId, role: UserRole.OWNER, isActive: true } });
        if (ownerCount <= 1) {
          throw new ForbiddenException('Cannot demote the last OWNER of the tenant');
        }
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { role: dto.role },
        select: SAFE_SELECT,
      });

      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId,
        action: 'user.role_change',
        subjectType: 'user',
        subjectId: userId,
        metadata: { from: target.role, to: dto.role },
      });

      return updated;
    });
  }

  /** Deactivate a user (soft-delete — sessions revoked on next request). */
  async deactivate(userId: string, actorRole: UserRole, actorId: string) {
    const ctx = requireTenantContext();

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId } });
      if (!target) throw new NotFoundException('User not found');

      if (target.id === actorId) throw new ForbiddenException('Cannot deactivate your own account');

      if (target.role === UserRole.OWNER && actorRole !== UserRole.OWNER) {
        throw new ForbiddenException('Only an OWNER can deactivate another OWNER');
      }

      const ownerCount = await tx.user.count({ where: { tenantId: ctx.tenantId, role: UserRole.OWNER, isActive: true } });
      if (target.role === UserRole.OWNER && ownerCount <= 1) {
        throw new ForbiddenException('Cannot deactivate the last OWNER of the tenant');
      }

      // Revoke all active refresh sessions.
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: SAFE_SELECT,
      });

      // FIX (RED1#1): also kill any LIVE access JWTs by setting the per-user
      // "revoked-before" cutoff to now. JwtAuthGuard rejects tokens with
      // iat < cutoff. Without this, stolen 15-min access tokens kept working
      // even after deactivation. Best-effort — done outside the tx so a Redis
      // hiccup doesn't block the deactivation itself.
      void this.redis.client
        .setex(`${USER_REVOKED_BEFORE_PREFIX}${userId}`, 24 * 3600, String(Math.floor(Date.now() / 1000)))
        .catch((err: unknown) => this.logger.warn(`failed to set revoked-before: ${String(err)}`));

      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId,
        action: 'user.deactivate',
        subjectType: 'user',
        subjectId: userId,
      });

      return updated;
    });
  }

  /**
   * Phase 0 / Feature 1 — user-scoped locale switch.
   *
   * Cascade applied at write-time so a user can't pick a locale the tenant
   * admin has since revoked:
   *   1. Zod has already whitelisted `locale` against `LocaleSchema` at
   *      the controller. Defense-in-depth re-validate here in case a future
   *      caller bypasses the pipe.
   *   2. Tenant's `enabledLocales` must contain the target — else 400
   *      `LOCALE_DISABLED_BY_TENANT`. We don't 403 because the user IS
   *      allowed to manage their own preference; the tenant just doesn't
   *      offer the chosen locale today.
   *   3. On success, emit audit row + Prometheus counter + return the
   *      updated user (FE replaces the local cache).
   */
  async updateMyLocale(userId: string, locale: Locale) {
    const ctx = requireTenantContext();

    // Re-validate (belt-and-braces; Zod at the pipe is the primary gate).
    const parsed = LocaleSchema.safeParse(locale);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_LOCALE', message: 'Locale not supported' });
    }

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { enabledLocales: true, defaultLocale: true },
      });
      if (!tenant.enabledLocales.includes(parsed.data)) {
        throw new BadRequestException({
          code: 'LOCALE_DISABLED_BY_TENANT',
          message: 'This locale is not enabled for your workspace',
        });
      }

      const current = await tx.user.findFirstOrThrow({
        where: { id: userId, tenantId: ctx.tenantId },
        select: { preferredLocale: true },
      });

      // No-op fast path: don't audit a non-change.
      if (current.preferredLocale === parsed.data) {
        const unchanged = await tx.user.findFirstOrThrow({
          where: { id: userId, tenantId: ctx.tenantId },
          select: SAFE_SELECT,
        });
        return unchanged;
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { preferredLocale: parsed.data },
        select: SAFE_SELECT,
      });

      // Metrics + audit. Audit FIRST so a metric blip doesn't silently lose
      // compliance evidence — audit is the harder requirement (T-I18N-R-01).
      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId: userId,
        action: 'user.locale_change',
        subjectType: 'user',
        subjectId: userId,
        metadata: { from: current.preferredLocale, to: parsed.data },
      });

      this.metrics.recordLocaleSwitch(ctx.tenantId, current.preferredLocale, parsed.data);

      return updated;
    });
  }

  /**
   * Read the resolved locale for the current user (cascade: user pref →
   * tenant default → 'ro'). Used by BE-side template rendering hooks that
   * need a single source-of-truth locale lookup without re-implementing the
   * cascade in every service.
   */
  async resolveMyLocale(userId: string): Promise<Locale> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const [user, tenant] = await Promise.all([
        tx.user.findFirstOrThrow({
          where: { id: userId, tenantId: ctx.tenantId },
          select: { preferredLocale: true },
        }),
        tx.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { defaultLocale: true, enabledLocales: true },
        }),
      ]);
      return resolveLocale({
        userPreferred: user.preferredLocale,
        tenantDefault: tenant.defaultLocale,
        enabledLocales: tenant.enabledLocales,
      });
    });
  }

  /** Re-activate a previously deactivated user. */
  async activate(userId: string, actorId: string) {
    const ctx = requireTenantContext();

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId } });
      if (!target) throw new NotFoundException('User not found');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: true },
        select: SAFE_SELECT,
      });

      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId,
        action: 'user.activate',
        subjectType: 'user',
        subjectId: userId,
      });

      return updated;
    });
  }
}
