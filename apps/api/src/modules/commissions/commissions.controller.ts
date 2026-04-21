import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ComputeCommissionsSchema,
  CreateCommissionPlanSchema,
  MarkCommissionPaidSchema,
  UpdateCommissionPlanSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommissionsService } from './commissions.service';

@Controller('commissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Post('plans')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createPlan(@Body(new ZodValidationPipe(CreateCommissionPlanSchema)) body: Parameters<CommissionsService['createPlan']>[0]) {
    return this.commissions.createPlan(body);
  }

  @Get('plans')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  listPlans() {
    return this.commissions.listPlans();
  }

  @Get('plans/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  getPlan(@Param('id') id: string) {
    return this.commissions.getPlan(id);
  }

  @Patch('plans/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updatePlan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCommissionPlanSchema)) body: Parameters<CommissionsService['updatePlan']>[1],
  ) {
    return this.commissions.updatePlan(id, body);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  deletePlan(@Param('id') id: string) {
    return this.commissions.deletePlan(id);
  }

  @Post('compute')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  compute(@Body(new ZodValidationPipe(ComputeCommissionsSchema)) body: Parameters<CommissionsService['compute']>[0]) {
    return this.commissions.compute(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  list(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.commissions.list(
      year ? Number(year) : undefined,
      month ? Number(month) : undefined,
    );
  }

  @Post(':id/mark-paid')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  markPaid(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MarkCommissionPaidSchema)) body: { paidAt: Date },
  ) {
    return this.commissions.markPaid(id, body.paidAt);
  }
}
