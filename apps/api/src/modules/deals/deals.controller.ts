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
  CreateDealDto,
  CreateDealSchema,
  ListDealsQueryDto,
  ListDealsQuerySchema,
  MoveDealDto,
  MoveDealSchema,
  UpdateDealDto,
  UpdateDealSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { DealsService } from './deals.service';

/**
 * Routes:
 *   POST   /deals             create (with pipelineId + stageId)
 *   GET    /deals             list + filter (cursor pagination)
 *   GET    /deals/:id         single deal
 *   PATCH  /deals/:id         update fields (NOT stageId — use /move)
 *   POST   /deals/:id/move    change stage atomically (+ reorder + status recompute)
 *   DELETE /deals/:id         soft delete
 */
@Controller('deals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateDealSchema)) dto: CreateDealDto) {
    return this.deals.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListDealsQuerySchema)) q: ListDealsQueryDto) {
    return this.deals.list(q);
  }

  @Get('forecast')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  forecast(@Query('pipelineId') pipelineId?: string) {
    return this.deals.forecast(pipelineId);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.deals.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDealSchema)) dto: UpdateDealDto,
  ) {
    return this.deals.update(id, dto);
  }

  @Post(':id/move')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  move(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MoveDealSchema)) dto: MoveDealDto,
  ) {
    return this.deals.move(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  remove(@Param('id') id: string) {
    return this.deals.remove(id);
  }
}
