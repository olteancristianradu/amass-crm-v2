import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AssignTagDto,
  AssignTagSchema,
  CreateTagDto,
  CreateTagSchema,
  ListTagsQueryDto,
  ListTagsQuerySchema,
  UpdateTagDto,
  UpdateTagSchema,
} from '@amass/shared';
import { TagsService } from './tags.service';

@Controller('tags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TagsController {
  constructor(private readonly svc: TagsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateTagSchema)) dto: CreateTagDto) {
    return this.svc.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListTagsQuerySchema)) query: ListTagsQueryDto) {
    return this.svc.list(query);
  }

  /** Returns tags grouped by entityId for a list of entity IDs (batch load). */
  @Get('batch')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  async batchByEntities(
    @Query('entityType') entityType: string,
    @Query('entityIds') entityIds: string | string[],
  ) {
    const ids = Array.isArray(entityIds) ? entityIds : [entityIds].filter(Boolean);
    const map = await this.svc.getTagsForEntities(entityType, ids);
    return Object.fromEntries(map.entries());
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTagSchema)) dto: UpdateTagDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/assign')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  assign(
    @Param('id') tagId: string,
    @Body(new ZodValidationPipe(AssignTagSchema)) dto: AssignTagDto,
  ) {
    return this.svc.assign(tagId, dto);
  }

  @Delete(':id/assign/:entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  unassign(@Param('id') tagId: string, @Param('entityId') entityId: string) {
    return this.svc.unassign(tagId, entityId);
  }
}
