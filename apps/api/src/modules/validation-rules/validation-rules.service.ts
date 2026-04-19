import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ValidationRule } from '@prisma/client';
import {
  CreateValidationRuleDto,
  UpdateValidationRuleDto,
  ValidationEntityTypeDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class ValidationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateValidationRuleDto): Promise<ValidationRule> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.validationRule.create({ data: { ...dto, tenantId: ctx.tenantId } }),
    );
  }

  async findAll(entityType?: ValidationEntityTypeDto): Promise<ValidationRule[]> {
    const ctx = requireTenantContext();
    const where: Prisma.ValidationRuleWhereInput = {
      tenantId: ctx.tenantId,
      ...(entityType ? { entityType } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.validationRule.findMany({ where, orderBy: { createdAt: 'desc' } }),
    );
  }

  async findOne(id: string): Promise<ValidationRule> {
    const ctx = requireTenantContext();
    const r = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.validationRule.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!r) throw new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'Validation rule not found' });
    return r;
  }

  async update(id: string, dto: UpdateValidationRuleDto): Promise<ValidationRule> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.validationRule.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.validationRule.delete({ where: { id } }),
    );
  }

  /**
   * Evaluate all active rules against an entity payload. Throws 400 with the
   * first violation found. Call this from entity create/update services.
   */
  async assertValid(entityType: ValidationEntityTypeDto, payload: Record<string, unknown>): Promise<void> {
    const rules = await this.findAll(entityType);
    for (const rule of rules) {
      if (!rule.isActive) continue;
      const raw = payload[rule.field];
      const value = raw == null ? '' : String(raw);
      if (!this.passes(rule, value)) {
        throw new BadRequestException({
          code: 'VALIDATION_RULE_VIOLATED',
          message: rule.errorMessage,
          details: { ruleId: rule.id, field: rule.field, operator: rule.operator },
        });
      }
    }
  }

  private passes(rule: ValidationRule, value: string): boolean {
    switch (rule.operator) {
      case 'REGEX':
        try {
          return new RegExp(rule.value).test(value);
        } catch {
          // Invalid regex stored — treat as pass to avoid blocking all writes.
          return true;
        }
      case 'MIN_LENGTH':
        return value.length >= Number(rule.value);
      case 'MAX_LENGTH':
        return value.length <= Number(rule.value);
      case 'EQUALS':
        return value === rule.value;
      case 'NOT_EQUALS':
        return value !== rule.value;
      default:
        return true;
    }
  }
}
