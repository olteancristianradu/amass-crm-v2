import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  applyScimPatch,
  parseScimFilter,
  scimToUserCreateInput,
  userToScim,
  type ScimUser,
} from './scim-mapper';
import {
  SCIM_ERROR_SCHEMA_URN,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
  type ScimPatchOp,
  type ScimUserCreateDto,
} from './scim.dto';

/**
 * SCIM 2.0 /Users service — tenant-scoped CRUD on the User table.
 *
 * `tenantId` is passed in from the controller (which extracts it from
 * `X-Tenant-Id` for now — temporary scaffolding). In B3-PR3 the controller
 * will swap that header for bearer-token auth that resolves a tenant via a
 * provisioning-token table, but the service contract here stays the same.
 *
 * Every public method calls `runWithTenant(tenantId, fn)` so:
 *   1. The tx is on a Prisma client extended with `tenantExtension`, which
 *      auto-injects `tenantId` into every `where`/`data` (Layer 2 of the
 *      defense-in-depth multi-tenant story).
 *   2. Postgres RLS via `SET LOCAL app.tenant_id` enforces tenant isolation
 *      at the DB level (Layer 3).
 *
 * Soft-delete: the existing User table has no `deletedAt` column, so we use
 * `isActive=false` as the soft-delete marker. Listing/getting filters out
 * inactive rows unless the caller is explicitly fetching by id.
 *
 * Out of scope here: groups (B3-PR2), bearer auth (B3-PR3), audit logging
 * (B3-PR3), ServiceProviderConfig/Schemas meta endpoints (B3-PR4).
 */
@Injectable()
export class ScimService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    tenantId: string,
    startIndex: number,
    count: number,
    filter?: string,
  ): Promise<{
    schemas: string[];
    totalResults: number;
    startIndex: number;
    itemsPerPage: number;
    Resources: ScimUser[];
  }> {
    // SCIM uses 1-based startIndex. Prisma's `skip` is 0-based.
    const skip = Math.max(0, startIndex - 1);

    let whereFilter: { email?: string } = {};
    if (filter !== undefined && filter.trim() !== '') {
      const parsed = parseScimFilter(filter);
      if (!parsed) {
        // RFC 7644 §3.4.2.2: "If the specified attribute or filter contains
        // an illegal expression, return 400 with scimType=invalidFilter."
        throw new HttpException(
          {
            schemas: [SCIM_ERROR_SCHEMA_URN],
            scimType: 'invalidFilter',
            detail: `Unsupported filter expression. Only 'userName eq "value"' is supported.`,
            status: '400',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      whereFilter = { email: parsed.userName };
    }

    return this.prisma.runWithTenant(tenantId, async (tx) => {
      // Total BEFORE pagination — SCIM clients need it for paging math.
      const totalResults = await tx.user.count({ where: whereFilter });
      // `count: 0` is a SCIM idiom for "give me the count only".
      const rows = count === 0
        ? []
        : await tx.user.findMany({
            where: whereFilter,
            orderBy: { createdAt: 'asc' },
            skip,
            take: count,
          });
      return {
        schemas: [SCIM_LIST_RESPONSE_SCHEMA_URN],
        totalResults,
        startIndex,
        itemsPerPage: rows.length,
        Resources: rows.map((r) => userToScim(r)),
      };
    });
  }

  async getUser(tenantId: string, id: string): Promise<ScimUser> {
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id } });
      if (!user) throw this.notFound(id);
      return userToScim(user);
    });
  }

  async createUser(tenantId: string, dto: ScimUserCreateDto): Promise<ScimUser> {
    const data = scimToUserCreateInput(dto);
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      // Pre-flight duplicate check. The unique constraint on
      // (tenantId, email) would also catch this, but a friendly 409
      // beats a generic Prisma error.
      const existing = await tx.user.findFirst({ where: { email: data.email } });
      if (existing) {
        throw new ConflictException({
          schemas: [SCIM_ERROR_SCHEMA_URN],
          scimType: 'uniqueness',
          detail: 'userName already exists in this tenant',
          status: '409',
        });
      }
      // Cast: tenantExtension stamps tenantId at runtime; TS sees this as
      // the unchecked variant minus tenantId, which Prisma's generated type
      // doesn't allow without either the `tenant` relation or `tenantId`.
      // Routing through `as` here is intentional — the runtime guarantee
      // comes from the extension wired in PrismaService.onModuleInit.
      const created = await tx.user.create({ data: data as Prisma.UserUncheckedCreateInput });
      return userToScim(created);
    });
  }

  async replaceUser(tenantId: string, id: string, dto: ScimUserCreateDto): Promise<ScimUser> {
    const incoming = scimToUserCreateInput(dto);
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id } });
      if (!existing) throw this.notFound(id);

      // PUT = full overwrite of mutable fields. We intentionally do NOT
      // touch passwordHash / role / tenantId / id. Email changes are
      // permitted but must not collide with another user in the same tenant.
      if (incoming.email !== existing.email) {
        const collision = await tx.user.findFirst({ where: { email: incoming.email } });
        if (collision && collision.id !== id) {
          throw new ConflictException({
            schemas: [SCIM_ERROR_SCHEMA_URN],
            scimType: 'uniqueness',
            detail: 'userName already exists in this tenant',
            status: '409',
          });
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          email: incoming.email,
          fullName: incoming.fullName,
          isActive: incoming.isActive,
        },
      });
      return userToScim(updated);
    });
  }

  async patchUser(tenantId: string, id: string, ops: ScimPatchOp[]): Promise<ScimUser> {
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id } });
      if (!existing) throw this.notFound(id);

      let update;
      try {
        update = applyScimPatch(existing, ops);
      } catch (err) {
        if (err instanceof Error && err.name === 'ScimUnsupportedOp') {
          throw new BadRequestException({
            schemas: [SCIM_ERROR_SCHEMA_URN],
            scimType: 'invalidPath',
            detail:
              'Unsupported PatchOp. Only `replace` on `active`, `name.givenName`, `name.familyName`, or the primary email value is supported.',
            status: '400',
          });
        }
        throw err;
      }

      // No-op patch — still return the current resource per RFC 7644 §3.5.2.
      if (Object.keys(update).length === 0) {
        return userToScim(existing);
      }

      // Check email collision if the patch changes it.
      if (typeof update.email === 'string' && update.email !== existing.email) {
        const collision = await tx.user.findFirst({ where: { email: update.email } });
        if (collision && collision.id !== id) {
          throw new ConflictException({
            schemas: [SCIM_ERROR_SCHEMA_URN],
            scimType: 'uniqueness',
            detail: 'userName already exists in this tenant',
            status: '409',
          });
        }
      }

      const updated = await tx.user.update({ where: { id }, data: update });
      return userToScim(updated);
    });
  }

  /**
   * Soft-delete: flip isActive=false. Idempotent — calling on an already
   * inactive user is a no-op that still resolves successfully (controller
   * returns 204). We never hard-delete because (a) audit trail and (b)
   * deactivated users may still own deals/leads/tasks via FK relations.
   */
  async deleteUser(tenantId: string, id: string): Promise<void> {
    await this.prisma.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id } });
      if (!existing) throw this.notFound(id);
      if (!existing.isActive) return; // idempotent
      await tx.user.update({ where: { id }, data: { isActive: false } });
    });
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      schemas: [SCIM_ERROR_SCHEMA_URN],
      detail: `User ${id} not found`,
      status: '404',
    });
  }
}
