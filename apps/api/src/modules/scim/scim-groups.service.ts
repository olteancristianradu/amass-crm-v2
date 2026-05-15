import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  diffGroupMembers,
  GROUP_REMOVAL_FALLBACK_ROLE,
  groupIdToRole,
  parseGroupPatchOps,
  roleToGroupId,
  roleToScimGroup,
  SCIM_GROUP_ROLES,
  type ScimGroup,
  type ScimGroupMemberOp,
} from './scim-mapper';
import {
  SCIM_ERROR_SCHEMA_URN,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
  type ScimGroupReplaceDto,
  type ScimPatchOp,
} from './scim.dto';

/**
 * SCIM 2.0 /Groups service (B3-PR2).
 *
 * Groups are SYNTHETIC: amass-crm has no Group/Team table, so the 5 SCIM
 * groups per tenant are derived 1:1 from the `UserRole` enum:
 *   id `role:OWNER`   ←→ users where User.role = OWNER
 *   id `role:ADMIN`   ←→ users where User.role = ADMIN
 *   id `role:MANAGER` ←→ users where User.role = MANAGER
 *   id `role:AGENT`   ←→ users where User.role = AGENT
 *   id `role:VIEWER`  ←→ users where User.role = VIEWER
 *
 * Membership mutations land on `User.role`:
 *   - Adding a user to group X    → set User.role = X
 *   - Removing a user from group X → set User.role = VIEWER (least-privilege floor)
 *     (removing from VIEWER itself is a no-op — VIEWER is the floor)
 *
 * POST /Groups and DELETE /Groups/:id return **501 Not Implemented** because
 * the group set is FIXED by RBAC — IdPs cannot create or delete a role.
 * Documented in the controller and the architecture doc.
 *
 * All mutations are audited via `AuditService.log` with actions
 * `scim.group.member_added` / `scim.group.member_removed` so the audit log
 * captures every IdP-driven role change.
 *
 * Tenant scoping: every method runs inside `prisma.runWithTenant(tenantId, fn)`
 * — same defense-in-depth pattern as ScimService (tenant extension + RLS).
 */
@Injectable()
export class ScimGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listGroups(
    tenantId: string,
    startIndex: number,
    count: number,
    filter?: string,
  ): Promise<{
    schemas: string[];
    totalResults: number;
    startIndex: number;
    itemsPerPage: number;
    Resources: ScimGroup[];
  }> {
    if (filter !== undefined && filter.trim() !== '') {
      // We don't support filter expressions on Groups — the group set is the
      // fixed 5-entry RBAC enum, so filter is mostly meaningless. Fail loud
      // rather than silently ignore (RFC 7644 §3.4.2.2).
      throw new HttpException(
        {
          schemas: [SCIM_ERROR_SCHEMA_URN],
          scimType: 'invalidFilter',
          detail: 'Filter expressions are not supported on /Groups (synthetic role-derived set).',
          status: '400',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.runWithTenant(tenantId, async (tx) => {
      // Pull all users in this tenant once, then bucket by role. With 5 roles
      // this is O(n) per list call; for a 1000-user tenant that's 1000 rows
      // — fine. We can swap for `groupBy({by: role})` + per-group member
      // hydration if a tenant ever crosses ~10k users (none does today).
      const users = await tx.user.findMany({
        select: { id: true, fullName: true, email: true, role: true },
        orderBy: { createdAt: 'asc' },
      });

      const byRole = new Map<UserRole, Array<{ id: string; fullName: string; email: string }>>();
      for (const role of SCIM_GROUP_ROLES) byRole.set(role, []);
      for (const u of users) {
        byRole.get(u.role)?.push({ id: u.id, fullName: u.fullName, email: u.email });
      }

      const allGroups = SCIM_GROUP_ROLES.map((role) =>
        roleToScimGroup(role, byRole.get(role) ?? []),
      );
      const totalResults = allGroups.length; // always 5
      const skip = Math.max(0, startIndex - 1);
      const slice = count === 0 ? [] : allGroups.slice(skip, skip + count);

      return {
        schemas: [SCIM_LIST_RESPONSE_SCHEMA_URN],
        totalResults,
        startIndex,
        itemsPerPage: slice.length,
        Resources: slice,
      };
    });
  }

  async getGroup(tenantId: string, id: string): Promise<ScimGroup> {
    const role = groupIdToRole(id);
    if (!role) throw this.notFound(id);

    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const members = await tx.user.findMany({
        where: { role },
        select: { id: true, fullName: true, email: true },
        orderBy: { createdAt: 'asc' },
      });
      return roleToScimGroup(role, members);
    });
  }

  /**
   * POST is rejected with 501 — synthetic groups cannot be created. We
   * surface it as an HTTP 501 with the SCIM error envelope so IdPs see a
   * structured response rather than a NestJS default 500.
   */
  createGroup(): never {
    throw new HttpException(
      {
        schemas: [SCIM_ERROR_SCHEMA_URN],
        scimType: 'notImplemented',
        detail:
          'Creating SCIM groups is not supported — the group set is fixed by RBAC (OWNER/ADMIN/MANAGER/AGENT/VIEWER).',
        status: '501',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /** DELETE is rejected with 501 — synthetic groups cannot be removed. */
  deleteGroup(): never {
    throw new HttpException(
      {
        schemas: [SCIM_ERROR_SCHEMA_URN],
        scimType: 'notImplemented',
        detail:
          'Deleting SCIM groups is not supported — the group set is fixed by RBAC.',
        status: '501',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * PATCH /Groups/:id — add/remove individual members. Each mutation maps to
   * a single User.role update. The whole patch is executed within one
   * transaction so a partial failure can't leave the role assignments in a
   * half-applied state.
   */
  async patchGroup(tenantId: string, id: string, ops: ScimPatchOp[]): Promise<ScimGroup> {
    const role = groupIdToRole(id);
    if (!role) throw this.notFound(id);

    let parsed: ScimGroupMemberOp[];
    try {
      parsed = parseGroupPatchOps(ops);
    } catch (err) {
      if (err instanceof Error && err.name === 'ScimUnsupportedOp') {
        throw new BadRequestException({
          schemas: [SCIM_ERROR_SCHEMA_URN],
          scimType: 'invalidPath',
          detail:
            'Unsupported PatchOp on /Groups. Only `add` / `remove` on `members` (or `members[value eq "id"]`) is supported.',
          status: '400',
        });
      }
      throw err;
    }

    const auditEntries: Array<{ action: string; userId: string; role: UserRole }> = [];

    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      for (const op of parsed) {
        const target = await tx.user.findFirst({ where: { id: op.userId } });
        if (!target) {
          // Member references must resolve within the same tenant. Cross-
          // tenant or unknown ids → 400 (RFC 7644 §3.5.2 — invalid value).
          throw new BadRequestException({
            schemas: [SCIM_ERROR_SCHEMA_URN],
            scimType: 'invalidValue',
            detail: `Member ${op.userId} does not exist in this tenant.`,
            status: '400',
          });
        }

        if (op.action === 'add') {
          if (target.role !== role) {
            await tx.user.update({ where: { id: target.id }, data: { role } });
            auditEntries.push({ action: 'scim.group.member_added', userId: target.id, role });
          }
        } else {
          // remove: only meaningful if user is currently in THIS group
          if (target.role === role) {
            if (role === UserRole.VIEWER) {
              // Removing from VIEWER is a no-op — there's no role below it.
              continue;
            }
            await tx.user.update({
              where: { id: target.id },
              data: { role: GROUP_REMOVAL_FALLBACK_ROLE },
            });
            auditEntries.push({
              action: 'scim.group.member_removed',
              userId: target.id,
              role,
            });
          }
        }
      }

      // Return updated group state to keep the response consistent with GET.
      const members = await tx.user.findMany({
        where: { role },
        select: { id: true, fullName: true, email: true },
        orderBy: { createdAt: 'asc' },
      });
      return roleToScimGroup(role, members);
    });

    // Audit log writes are best-effort and outside the tx so a SIEM hiccup
    // can't roll back the role change. AuditService.log already swallows
    // its own errors.
    for (const entry of auditEntries) {
      await this.audit.log({
        tenantId,
        action: entry.action,
        subjectType: 'User',
        subjectId: entry.userId,
        metadata: { groupId: roleToGroupId(entry.role), role: entry.role },
      });
    }

    return result;
  }

  /**
   * PUT /Groups/:id — full overwrite of the group's member list. We diff
   * current members vs the desired set and translate the diff into User.role
   * updates: additions set role=group's role; removals downgrade to VIEWER.
   * All updates run in one transaction.
   */
  async replaceGroupMembers(
    tenantId: string,
    id: string,
    dto: ScimGroupReplaceDto,
  ): Promise<ScimGroup> {
    const role = groupIdToRole(id);
    if (!role) throw this.notFound(id);

    const desiredIds = dto.members.map((m) => m.value);
    // Dedup — Okta sometimes sends the same id twice when reconciling.
    const uniqueDesired = [...new Set(desiredIds)];

    const auditEntries: Array<{ action: string; userId: string }> = [];

    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      // Validate every desired member exists in this tenant before mutating
      // anything — fail-fast is friendlier than partial application.
      if (uniqueDesired.length > 0) {
        const found = await tx.user.findMany({
          where: { id: { in: uniqueDesired } },
          select: { id: true },
        });
        const foundIds = new Set(found.map((u) => u.id));
        for (const want of uniqueDesired) {
          if (!foundIds.has(want)) {
            throw new BadRequestException({
              schemas: [SCIM_ERROR_SCHEMA_URN],
              scimType: 'invalidValue',
              detail: `Member ${want} does not exist in this tenant.`,
              status: '400',
            });
          }
        }
      }

      const currentMembers = await tx.user.findMany({
        where: { role },
        select: { id: true },
      });
      const { toAdd, toRemove } = diffGroupMembers(
        currentMembers.map((u) => u.id),
        uniqueDesired,
      );

      for (const userId of toAdd) {
        await tx.user.update({ where: { id: userId }, data: { role } });
        auditEntries.push({ action: 'scim.group.member_added', userId });
      }
      for (const userId of toRemove) {
        // VIEWER group: removing has no lower target — leave the user where
        // they are (matches PATCH remove semantics).
        if (role === UserRole.VIEWER) continue;
        await tx.user.update({
          where: { id: userId },
          data: { role: GROUP_REMOVAL_FALLBACK_ROLE },
        });
        auditEntries.push({ action: 'scim.group.member_removed', userId });
      }

      const members = await tx.user.findMany({
        where: { role },
        select: { id: true, fullName: true, email: true },
        orderBy: { createdAt: 'asc' },
      });
      return roleToScimGroup(role, members);
    });

    for (const entry of auditEntries) {
      await this.audit.log({
        tenantId,
        action: entry.action,
        subjectType: 'User',
        subjectId: entry.userId,
        metadata: { groupId: id, role },
      });
    }

    return result;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      schemas: [SCIM_ERROR_SCHEMA_URN],
      detail: `Group ${id} not found`,
      status: '404',
    });
  }
}
