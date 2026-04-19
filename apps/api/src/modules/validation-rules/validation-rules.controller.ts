import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateValidationRuleSchema,
  UpdateValidationRuleSchema,
  ValidationEntityTypeSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ValidationRulesService } from './validation-rules.service';

@Controller('validation-rules')
@UseGuards(JwtAuthGuard)
export class ValidationRulesController {
  constructor(private readonly rules: ValidationRulesService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateValidationRuleSchema)) body: Parameters<ValidationRulesService['create']>[0]) {
    return this.rules.create(body);
  }

  @Get()
  findAll(@Query('entityType') entityType?: string) {
    const parsed = entityType ? ValidationEntityTypeSchema.parse(entityType) : undefined;
    return this.rules.findAll(parsed);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rules.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateValidationRuleSchema)) body: Parameters<ValidationRulesService['update']>[1],
  ) {
    return this.rules.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }
}
