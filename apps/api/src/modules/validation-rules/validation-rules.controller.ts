import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateValidationRuleSchema,
  UpdateValidationRuleSchema,
  ValidationEntityTypeSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ValidationRulesService } from './validation-rules.service';

@Controller('validation-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ValidationRulesController {
  constructor(private readonly rules: ValidationRulesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(CreateValidationRuleSchema)) body: Parameters<ValidationRulesService['create']>[0]) {
    return this.rules.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query('entityType') entityType?: string) {
    const parsed = entityType ? ValidationEntityTypeSchema.parse(entityType) : undefined;
    return this.rules.findAll(parsed);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.rules.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateValidationRuleSchema)) body: Parameters<ValidationRulesService['update']>[1],
  ) {
    return this.rules.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }
}
