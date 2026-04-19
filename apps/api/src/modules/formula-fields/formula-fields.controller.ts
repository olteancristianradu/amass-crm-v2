import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateFormulaFieldSchema,
  EvaluateFormulaSchema,
  UpdateFormulaFieldSchema,
  ValidationEntityTypeSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { FormulaFieldsService } from './formula-fields.service';

@Controller('formula-fields')
@UseGuards(JwtAuthGuard)
export class FormulaFieldsController {
  constructor(private readonly formulas: FormulaFieldsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateFormulaFieldSchema)) body: Parameters<FormulaFieldsService['create']>[0]) {
    return this.formulas.create(body);
  }

  @Get()
  findAll(@Query('entityType') entityType?: string) {
    const parsed = entityType ? ValidationEntityTypeSchema.parse(entityType) : undefined;
    return this.formulas.findAll(parsed);
  }

  @Post('evaluate')
  evaluate(@Body(new ZodValidationPipe(EvaluateFormulaSchema)) body: { expression: string; context: Record<string, unknown> }) {
    return { result: this.formulas.evaluate(body.expression, body.context) };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.formulas.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateFormulaFieldSchema)) body: Parameters<FormulaFieldsService['update']>[1],
  ) {
    return this.formulas.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.formulas.remove(id);
  }
}
