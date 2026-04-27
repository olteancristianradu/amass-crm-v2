import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateApprovalPolicySchema, CreateApprovalPolicyDto,
  UpdateApprovalPolicySchema, UpdateApprovalPolicyDto,
  MakeApprovalDecisionSchema, MakeApprovalDecisionDto,
} from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  // ─── Policies ──────────────────────────────────────────────────────────────

  @Get('policies')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  listPolicies() { return this.svc.listPolicies(); }

  @Post('policies')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @RequireCedar({ action: 'approval-policy::create', resource: 'ApprovalPolicy::*' })
  createPolicy(@Body(new ZodValidationPipe(CreateApprovalPolicySchema)) dto: CreateApprovalPolicyDto) {
    return this.svc.createPolicy(dto);
  }

  @Patch('policies/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @RequireCedar({
    action: 'approval-policy::update',
    resource: (req) => `ApprovalPolicy::${(req as { params: { id: string } }).params.id}`,
  })
  updatePolicy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateApprovalPolicySchema)) dto: UpdateApprovalPolicyDto,
  ) { return this.svc.updatePolicy(id, dto); }

  @Delete('policies/:id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @RequireCedar({
    action: 'approval-policy::delete',
    resource: (req) => `ApprovalPolicy::${(req as { params: { id: string } }).params.id}`,
  })
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
  @RequireCedar({
    action: 'approval-request::decide',
    resource: (req) => `ApprovalRequest::${(req as { params: { id: string } }).params.id}`,
  })
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MakeApprovalDecisionSchema)) dto: MakeApprovalDecisionDto,
  ) { return this.svc.decide(id, dto); }
}
