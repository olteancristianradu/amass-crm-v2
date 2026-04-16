import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { InviteUserDto, UpdateUserRoleDto } from './users.dto';

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

      // Revoke all active sessions.
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: SAFE_SELECT,
      });

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
