import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  ComputeCommissionsSchema,
  CreateCommissionPlanSchema,
  MarkCommissionPaidSchema,
  UpdateCommissionPlanSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CommissionsService } from './commissions.service';

@Controller('commissions')
@UseGuards(JwtAuthGuard)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Post('plans')
  createPlan(@Body(new ZodValidationPipe(CreateCommissionPlanSchema)) body: Parameters<CommissionsService['createPlan']>[0]) {
    return this.commissions.createPlan(body);
  }

  @Get('plans')
  listPlans() {
    return this.commissions.listPlans();
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.commissions.getPlan(id);
  }

  @Patch('plans/:id')
  updatePlan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCommissionPlanSchema)) body: Parameters<CommissionsService['updatePlan']>[1],
  ) {
    return this.commissions.updatePlan(id, body);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  deletePlan(@Param('id') id: string) {
    return this.commissions.deletePlan(id);
  }

  @Post('compute')
  compute(@Body(new ZodValidationPipe(ComputeCommissionsSchema)) body: Parameters<CommissionsService['compute']>[0]) {
    return this.commissions.compute(body);
  }

  @Get()
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
  markPaid(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MarkCommissionPaidSchema)) body: { paidAt: Date },
  ) {
    return this.commissions.markPaid(id, body.paidAt);
  }
}
