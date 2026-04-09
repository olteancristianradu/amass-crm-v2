import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PipelinesService } from './pipelines.service';

/**
 * Pipelines routes. Read-only in S10 — the default pipeline is seeded on
 * tenant register and admins will only be able to edit in a later sprint.
 *
 *   GET /pipelines        → list of pipelines with stages included
 *   GET /pipelines/:id    → single pipeline + stages
 */
@Controller('pipelines')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list() {
    return this.pipelines.listAll();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.pipelines.findOne(id);
  }
}
