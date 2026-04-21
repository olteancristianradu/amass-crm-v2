import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateFormulaFieldSchema,
  EvaluateFormulaSchema,
  UpdateFormulaFieldSchema,
  ValidationEntityTypeSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FormulaFieldsService } from './formula-fields.service';

@Controller('formula-fields')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FormulaFieldsController {
  constructor(private readonly formulas: FormulaFieldsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(CreateFormulaFieldSchema)) body: Parameters<FormulaFieldsService['create']>[0]) {
    return this.formulas.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query('entityType') entityType?: string) {
    const parsed = entityType ? ValidationEntityTypeSchema.parse(entityType) : undefined;
    return this.formulas.findAll(parsed);
  }

  @Post('evaluate')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  evaluate(@Body(new ZodValidationPipe(EvaluateFormulaSchema)) body: { expression: string; context: Record<string, unknown> }) {
    return { result: this.formulas.evaluate(body.expression, body.context) };
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.formulas.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateFormulaFieldSchema)) body: Parameters<FormulaFieldsService['update']>[1],
  ) {
    return this.formulas.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.formulas.remove(id);
  }
}
