import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  BulkSetCustomFieldValuesSchema, BulkSetCustomFieldValuesDto,
  CreateCustomFieldDefSchema, CreateCustomFieldDefDto,
  UpdateCustomFieldDefSchema, UpdateCustomFieldDefDto,
  ListCustomFieldDefsQuerySchema, ListCustomFieldDefsQueryDto,
} from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomFieldsService } from './custom-fields.service';

@Controller('custom-fields')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomFieldsController {
  constructor(private readonly svc: CustomFieldsService) {}

  // ─── Definitions ───────────────────────────────────────────────────────────

  @Get('defs')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listDefs(@Query(new ZodValidationPipe(ListCustomFieldDefsQuerySchema)) q: ListCustomFieldDefsQueryDto) {
    return this.svc.listDefs(q);
  }

  @Post('defs')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createDef(@Body(new ZodValidationPipe(CreateCustomFieldDefSchema)) dto: CreateCustomFieldDefDto) {
    return this.svc.createDef(dto);
  }

  @Patch('defs/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updateDef(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCustomFieldDefSchema)) dto: UpdateCustomFieldDefDto,
  ) { return this.svc.updateDef(id, dto); }

  @Delete('defs/:id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  removeDef(@Param('id') id: string) { return this.svc.removeDef(id); }

  // ─── Values (per entity) ───────────────────────────────────────────────────

  @Get('values/:entityId')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  getValues(@Param('entityId') entityId: string) {
    return this.svc.getValues(entityId);
  }

  @Post('values/:entityId')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  bulkSetValues(
    @Param('entityId') entityId: string,
    @Body(new ZodValidationPipe(BulkSetCustomFieldValuesSchema)) dto: BulkSetCustomFieldValuesDto,
  ) { return this.svc.bulkSetValues(entityId, dto); }

  @Delete('values/:entityId/:fieldDefId')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  deleteValue(@Param('entityId') entityId: string, @Param('fieldDefId') fieldDefId: string) {
    return this.svc.deleteValue(entityId, fieldDefId);
  }
}
