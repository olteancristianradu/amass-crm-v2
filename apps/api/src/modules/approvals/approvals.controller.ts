import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateApprovalPolicySchema, CreateApprovalPolicyDto,
  UpdateApprovalPolicySchema, UpdateApprovalPolicyDto,
  MakeApprovalDecisionSchema, MakeApprovalDecisionDto,
} from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  // ─── Policies ──────────────────────────────────────────────────────────────

  @Get('policies')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  listPolicies() { return this.svc.listPolicies(); }

  @Post('policies')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createPolicy(@Body(new ZodValidationPipe(CreateApprovalPolicySchema)) dto: CreateApprovalPolicyDto) {
    return this.svc.createPolicy(dto);
  }

  @Patch('policies/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updatePolicy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateApprovalPolicySchema)) dto: UpdateApprovalPolicyDto,
  ) { return this.svc.updatePolicy(id, dto); }

  @Delete('policies/:id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  removePolicy(@Param('id') id: string) { return this.svc.removePolicy(id); }

  // ─── Requests ──────────────────────────────────────────────────────────────

  @Get('requests')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  listRequests(@Query('quoteId') quoteId?: string) {
    return this.svc.listRequests(quoteId);
  }

  @Post('requests/:id/decide')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MakeApprovalDecisionSchema)) dto: MakeApprovalDecisionDto,
  ) { return this.svc.decide(id, dto); }
}
