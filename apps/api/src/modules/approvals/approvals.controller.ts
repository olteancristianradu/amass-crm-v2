import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApprovalSubjectType, UserRole } from '@prisma/client';
import {
  CreateApprovalPolicySchema, CreateApprovalPolicyDto,
  UpdateApprovalPolicySchema, UpdateApprovalPolicyDto,
  MakeApprovalDecisionSchema, MakeApprovalDecisionDto,
  CreateApprovalRequestSchema, CreateApprovalRequestDto,
  WithdrawApprovalRequestSchema, WithdrawApprovalRequestDto,
  ListApprovalRequestsSchema, ListApprovalRequestsDto,
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
  listPolicies(@Query('subjectType') subjectType?: ApprovalSubjectType) {
    return this.svc.listPolicies(subjectType);
  }

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
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  listRequests(@Query(new ZodValidationPipe(ListApprovalRequestsSchema)) filter: ListApprovalRequestsDto) {
    return this.svc.listRequests(filter);
  }

  @Get('requests/my-inbox')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  myInbox() {
    return this.svc.listMyInbox();
  }

  @Get('requests/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  getRequest(@Param('id') id: string) {
    return this.svc.getRequest(id);
  }

  @Post('requests')
  @HttpCode(201)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  @RequireCedar({ action: 'approval-request::create', resource: 'ApprovalRequest::*' })
  createRequest(@Body(new ZodValidationPipe(CreateApprovalRequestSchema)) dto: CreateApprovalRequestDto) {
    return this.svc.createRequest(dto);
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

  @Post('requests/:id/withdraw')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  @RequireCedar({
    action: 'approval-request::withdraw',
    resource: (req) => `ApprovalRequest::${(req as { params: { id: string } }).params.id}`,
  })
  withdraw(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WithdrawApprovalRequestSchema)) dto: WithdrawApprovalRequestDto,
  ) { return this.svc.withdraw(id, dto); }
}
