import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractTemplate, Prisma } from '@prisma/client';
import {
  CreateContractTemplateDto,
  ListContractTemplatesQueryDto,
  UpdateContractTemplateDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * Phase 2 F1 — reusable, versioned contract templates per tenant.
 *
 * Versioning semantics (per Phase 2 spec §F1 + schema review §B):
 *  - Each (tenantId, name, version) is unique. Bumping `version` is an
 *    explicit republish — the caller PATCHes `bodyMd` or `variables`,
 *    the service detects the change and increments `version`.
 *  - Contract.templateId pins the EXACT version used at send time —
 *    bumping the template never alters in-flight ceremonies.
 *  - Once at least one Contract references a template, the template
 *    becomes "in-use" and we refuse hard updates to `bodyMd` / `variables`
 *    when status=PUBLISHED. Callers must publish a NEW version instead.
 *    DRAFT templates are freely mutable.
 *  - Soft delete only (deletedAt) — we never lose the audit chain.
 */
@Injectable()
export class ContractTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContractTemplateDto): Promise<ContractTemplate> {
    const { tenantId, userId } = requireTenantContext();

    // Variable allow-list defense (T-ESIGN per CLAUDE.md rule #5): we
    // serialise the array as Prisma.InputJsonValue. Schema-level cap of
    // 200 already enforced by Zod, but we re-check uniqueness of keys here
    // to surface a clean error (Postgres unique would be a generic 409).
    this.assertUniqueVariableKeys(dto.variables);

    try {
      return await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.contractTemplate.create({
          data: {
            tenantId,
            name: dto.name,
            description: dto.description ?? null,
            bodyMd: dto.bodyMd,
            variables: dto.variables as unknown as Prisma.InputJsonValue,
            version: 1,
            createdById: userId ?? null,
          },
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'TEMPLATE_NAME_TAKEN',
          message: `Template name "${dto.name}" already exists at version 1`,
        });
      }
      throw err;
    }
  }

  async findAll(q: ListContractTemplatesQueryDto): Promise<CursorPage<ContractTemplate>> {
    const { tenantId } = requireTenantContext();
    const where: Prisma.ContractTemplateWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractTemplate.findMany({ where, ...cursorArgs }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<ContractTemplate> {
    const { tenantId } = requireTenantContext();
    const t = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractTemplate.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!t) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `ContractTemplate ${id} not found`,
      });
    }
    return t;
  }

  async update(id: string, dto: UpdateContractTemplateDto): Promise<ContractTemplate> {
    const existing = await this.findOne(id);
    const { tenantId } = requireTenantContext();

    // Validate variables (if provided) — preserves the create-time invariant.
    if (dto.variables !== undefined) {
      this.assertUniqueVariableKeys(dto.variables);
    }

    // Phase 2 spec §F1: immutability on PUBLISHED + already-in-use templates.
    // Status transitions (e.g. PUBLISHED → ARCHIVED) are always allowed; the
    // body / variable schema mutations are not.
    const isContentChange = dto.bodyMd !== undefined || dto.variables !== undefined;
    if (isContentChange && existing.status === 'PUBLISHED') {
      const usage = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.contract.count({ where: { tenantId, templateId: id } }),
      );
      if (usage > 0) {
        throw new BadRequestException({
          code: 'TEMPLATE_IN_USE',
          message: `Template ${id} is referenced by ${usage} contract(s); publish a new version instead of mutating in place`,
        });
      }
    }

    const data: Prisma.ContractTemplateUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.bodyMd !== undefined ? { bodyMd: dto.bodyMd } : {}),
      ...(dto.variables !== undefined
        ? { variables: dto.variables as unknown as Prisma.InputJsonValue }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractTemplate.update({ where: { id }, data }),
    );
  }

  /**
   * Soft delete. Hard delete would orphan the Contract.templateId FK with
   * SetNull (Prisma schema) which loses the audit trail of which template
   * generated each contract. We prefer the soft delete so historical
   * lookups still work.
   */
  async remove(id: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    const existing = await this.findOne(id);
    if (existing.deletedAt) return; // idempotent

    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      }),
    );
  }

  /**
   * Bump version + body in a single op. Used by FE "publish new revision"
   * flow when the existing template is in use — clones the row with a
   * fresh id, incremented version, and the new body.
   *
   * Returns the NEW template row. The old row stays untouched (so existing
   * Contract.templateId references survive). Both versions show in /list.
   */
  async publishNewVersion(
    id: string,
    body: { bodyMd?: string; variables?: CreateContractTemplateDto['variables'] },
  ): Promise<ContractTemplate> {
    const { tenantId, userId } = requireTenantContext();
    const existing = await this.findOne(id);

    const variables = body.variables ?? (existing.variables as unknown as CreateContractTemplateDto['variables']);
    this.assertUniqueVariableKeys(variables);

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractTemplate.create({
        data: {
          tenantId,
          name: existing.name,
          description: existing.description,
          bodyMd: body.bodyMd ?? existing.bodyMd,
          variables: variables as unknown as Prisma.InputJsonValue,
          status: 'PUBLISHED',
          version: existing.version + 1,
          createdById: userId ?? null,
        },
      }),
    );
  }

  private assertUniqueVariableKeys(
    variables: CreateContractTemplateDto['variables'],
  ): void {
    const seen = new Set<string>();
    for (const v of variables) {
      if (seen.has(v.key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_VARIABLE_KEY',
          message: `Duplicate variable key "${v.key}" — template variable keys must be unique`,
        });
      }
      seen.add(v.key);
    }
  }
}
