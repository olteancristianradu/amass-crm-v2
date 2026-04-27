import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  AssignTerritorySchema,
  CreateTerritorySchema,
  UpdateTerritorySchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { TerritoriesService } from './territories.service';

@Controller('territories')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class TerritoriesController {
  constructor(private readonly territories: TerritoriesService) {}

  @Post()
  @RequireCedar({ action: 'territory::create', resource: 'Territory::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(CreateTerritorySchema)) body: Parameters<TerritoriesService['create']>[0]) {
    return this.territories.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll() {
    return this.territories.findAll();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.territories.findOne(id);
  }

  @Patch(':id')
  @RequireCedar({
    action: 'territory::update',
    resource: (req) => `Territory::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTerritorySchema)) body: Parameters<TerritoriesService['update']>[1],
  ) {
    return this.territories.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'territory::delete',
    resource: (req) => `Territory::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.territories.remove(id);
  }

  @Post(':id/assignments')
  @RequireCedar({
    action: 'territory::assign',
    resource: (req) => `Territory::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AssignTerritorySchema)) body: { userId: string },
  ) {
    return this.territories.assign(id, body.userId);
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(204)
  @RequireCedar({
    action: 'territory::unassign',
    resource: (req) => `Territory::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  unassign(@Param('id') id: string, @Param('userId') userId: string) {
    return this.territories.unassign(id, userId);
  }
}
