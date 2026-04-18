import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomFieldDef, CustomFieldEntityType, CustomFieldType, Prisma } from '@prisma/client';
import {
  BulkSetCustomFieldValuesDto,
  CreateCustomFieldDefDto,
  ListCustomFieldDefsQueryDto,
  UpdateCustomFieldDefDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Definitions ───────────────────────────────────────────────────────────

  async createDef(dto: CreateCustomFieldDefDto): Promise<CustomFieldDef> {
    const { tenantId } = requireTenantContext();
    const exists = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldDef.findFirst({
        where: { tenantId, entityType: dto.entityType as CustomFieldEntityType, name: dto.name, deletedAt: null },
      }),
    );
    if (exists) throw new ConflictException({ code: 'CUSTOM_FIELD_EXISTS', message: `Field "${dto.name}" already exists for ${dto.entityType}` });

    if (['SELECT', 'MULTI_SELECT'].includes(dto.fieldType) && (!dto.options || dto.options.length === 0)) {
      throw new BadRequestException({ code: 'OPTIONS_REQUIRED', message: 'SELECT and MULTI_SELECT fields require options' });
    }

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldDef.create({
        data: {
          tenantId,
          entityType: dto.entityType as CustomFieldEntityType,
          fieldType: dto.fieldType as CustomFieldType,
          name: dto.name,
          label: dto.label,
          options: dto.options !== undefined ? dto.options ?? Prisma.DbNull : Prisma.DbNull,
          isRequired: dto.isRequired,
          order: dto.order,
        },
      }),
    );
  }

  async listDefs(query: ListCustomFieldDefsQueryDto): Promise<CustomFieldDef[]> {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldDef.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(query.entityType ? { entityType: query.entityType as CustomFieldEntityType } : {}),
          ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        },
        orderBy: [{ entityType: 'asc' }, { order: 'asc' }, { label: 'asc' }],
      }),
    );
  }

  async updateDef(id: string, dto: UpdateCustomFieldDefDto): Promise<CustomFieldDef> {
    const { tenantId } = requireTenantContext();
    await this.assertDef(tenantId, id);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldDef.update({
        where: { id },
        data: {
          ...(dto.label ? { label: dto.label } : {}),
          ...(dto.options !== undefined ? { options: dto.options ?? Prisma.DbNull } : {}),
          ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      }),
    );
  }

  async removeDef(id: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.assertDef(tenantId, id);
    // cascade deletes values via DB FK; soft-delete the def
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldDef.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    );
  }

  private async assertDef(tenantId: string, id: string) {
    const def = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldDef.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!def) throw new NotFoundException('Custom field definition not found');
    return def;
  }

  // ─── Values ────────────────────────────────────────────────────────────────

  async getValues(entityId: string): Promise<{ fieldDef: CustomFieldDef; value: string }[]> {
    const { tenantId } = requireTenantContext();
    const rows = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldValue.findMany({
        where: { tenantId, entityId },
        include: { fieldDef: true },
        orderBy: { fieldDef: { order: 'asc' } },
      }),
    );
    return rows.map((r) => ({ fieldDef: r.fieldDef, value: r.value }));
  }

  async bulkSetValues(entityId: string, dto: BulkSetCustomFieldValuesDto): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, async (tx) => {
      for (const item of dto.values) {
        const def = await tx.customFieldDef.findFirst({
          where: { id: item.fieldDefId, tenantId, deletedAt: null, isActive: true },
        });
        if (!def) throw new NotFoundException(`Field definition ${item.fieldDefId} not found`);

        this.validateValue(def.fieldType, item.value, def.options as string[] | null);

        await tx.customFieldValue.upsert({
          where: { fieldDefId_entityId: { fieldDefId: item.fieldDefId, entityId } },
          create: { tenantId, fieldDefId: item.fieldDefId, entityId, value: item.value },
          update: { value: item.value },
        });
      }
    });
  }

  async deleteValue(entityId: string, fieldDefId: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.customFieldValue.deleteMany({ where: { tenantId, entityId, fieldDefId } }),
    );
  }

  private validateValue(fieldType: CustomFieldType, value: string, options: string[] | null): void {
    switch (fieldType) {
      case 'NUMBER':
        if (isNaN(Number(value))) throw new BadRequestException(`Value must be a number for NUMBER field`);
        break;
      case 'DATE':
        if (isNaN(Date.parse(value))) throw new BadRequestException(`Value must be a valid ISO date for DATE field`);
        break;
      case 'BOOLEAN':
        if (!['true', 'false'].includes(value)) throw new BadRequestException(`Value must be 'true' or 'false' for BOOLEAN field`);
        break;
      case 'SELECT':
        if (options && !options.includes(value)) throw new BadRequestException(`Value must be one of: ${options.join(', ')}`);
        break;
      case 'MULTI_SELECT': {
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { throw new BadRequestException('MULTI_SELECT value must be a JSON array'); }
        if (!Array.isArray(parsed)) throw new BadRequestException('MULTI_SELECT value must be a JSON array');
        if (options) {
          const invalid = (parsed as string[]).filter((v) => !options.includes(v));
          if (invalid.length) throw new BadRequestException(`Invalid options: ${invalid.join(', ')}`);
        }
        break;
      }
    }
  }
}
