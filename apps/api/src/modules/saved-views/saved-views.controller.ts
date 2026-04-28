import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateSavedViewDto,
  CreateSavedViewSchema,
  ListSavedViewsQueryDto,
  ListSavedViewsQuerySchema,
  UpdateSavedViewDto,
  UpdateSavedViewSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { SavedViewsService } from './saved-views.service';

/**
 * Saved views — every authenticated role can manage their OWN views.
 * No Cedar guard: ownership is enforced by the service via ctx.userId,
 * so a tenant member can never read or modify another member's view.
 */
@Controller('saved-views')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SavedViewsController {
  constructor(private readonly svc: SavedViewsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  create(@Body(new ZodValidationPipe(CreateSavedViewSchema)) dto: CreateSavedViewDto) {
    return this.svc.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListSavedViewsQuerySchema)) query: ListSavedViewsQueryDto) {
    return this.svc.list(query.resource);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSavedViewSchema)) dto: UpdateSavedViewDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
