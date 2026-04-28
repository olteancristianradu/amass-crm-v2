import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateChatterPostSchema,
  ListChatterQuerySchema,
  UpdateChatterPostSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ChatterService } from './chatter.service';

@Controller('chatter')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ChatterController {
  constructor(private readonly chatter: ChatterService) {}

  @Post()
  @RequireCedar({ action: 'chatter::create', resource: 'Chatter::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateChatterPostSchema)) body: Parameters<ChatterService['create']>[0]) {
    return this.chatter.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListChatterQuerySchema)) q: Parameters<ChatterService['list']>[0]) {
    return this.chatter.list(q);
  }

  @Patch(':id')
  @RequireCedar({
    action: 'chatter::update',
    resource: (req) => `Chatter::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChatterPostSchema)) body: Parameters<ChatterService['update']>[1],
  ) {
    return this.chatter.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'chatter::delete',
    resource: (req) => `Chatter::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) {
    return this.chatter.remove(id);
  }
}
