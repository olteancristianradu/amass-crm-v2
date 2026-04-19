import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FormulaField, Prisma } from '@prisma/client';
import {
  CreateFormulaFieldDto,
  UpdateFormulaFieldDto,
  ValidationEntityTypeDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { evaluateFormula } from './formula-evaluator';

@Injectable()
export class FormulaFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateFormulaFieldDto): Promise<FormulaField> {
    // Dry-run the expression on an empty context to catch syntax errors at write time.
    try {
      evaluateFormula(dto.expression, {});
    } catch (e) {
      throw new BadRequestException({
        code: 'FORMULA_PARSE_ERROR',
        message: (e as Error).message,
      });
    }
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.formulaField.create({ data: { ...dto, tenantId: ctx.tenantId } }),
    );
  }

  async findAll(entityType?: ValidationEntityTypeDto): Promise<FormulaField[]> {
    const ctx = requireTenantContext();
    const where: Prisma.FormulaFieldWhereInput = {
      tenantId: ctx.tenantId,
      ...(entityType ? { entityType } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.formulaField.findMany({ where, orderBy: { fieldName: 'asc' } }),
    );
  }

  async findOne(id: string): Promise<FormulaField> {
    const ctx = requireTenantContext();
    const f = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.formulaField.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!f) throw new NotFoundException({ code: 'FORMULA_NOT_FOUND', message: 'Formula field not found' });
    return f;
  }

  async update(id: string, dto: UpdateFormulaFieldDto): Promise<FormulaField> {
    if (dto.expression) {
      try { evaluateFormula(dto.expression, {}); }
      catch (e) {
        throw new BadRequestException({ code: 'FORMULA_PARSE_ERROR', message: (e as Error).message });
      }
    }
    await this.findOne(id);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.formulaField.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.formulaField.delete({ where: { id } }),
    );
  }

  /**
   * Compute all active formula fields for an entity. Returns a map of
   * field_name → computed value. Callers merge into the saved entity (or
   * hydrate on read).
   */
  async computeAll(
    entityType: ValidationEntityTypeDto,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const fields = await this.findAll(entityType);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (!f.isActive) continue;
      try {
        out[f.fieldName] = evaluateFormula(f.expression, context);
      } catch (e) {
        out[f.fieldName] = `#ERR: ${(e as Error).message}`;
      }
    }
    return out;
  }

  evaluate(expression: string, context: Record<string, unknown>): unknown {
    try {
      return evaluateFormula(expression, context);
    } catch (e) {
      throw new BadRequestException({ code: 'FORMULA_PARSE_ERROR', message: (e as Error).message });
    }
  }
}
