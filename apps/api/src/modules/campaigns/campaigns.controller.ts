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
import { UserRole } from '@prisma/client';
import {
  CreateCampaignSchema,
  ListCampaignRecipientsQuerySchema,
  ListCampaignsQuerySchema,
  ScheduleCampaignSchema,
  SendTestCampaignSchema,
  UpdateCampaignSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { CampaignsService } from './campaigns.service';
import { CampaignRecipientsService } from '../campaign-recipients/campaign-recipients.service';

@Controller('campaigns')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly recipients: CampaignRecipientsService,
  ) {}

  @Post()
  @RequireCedar({ action: 'campaign::create', resource: 'Campaign::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body(new ZodValidationPipe(CreateCampaignSchema)) body: Parameters<CampaignsService['create']>[0]) {
    return this.campaigns.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query(new ZodValidationPipe(ListCampaignsQuerySchema)) query: Parameters<CampaignsService['findAll']>[0]) {
    return this.campaigns.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.campaigns.findOne(id);
  }

  @Patch(':id')
  @RequireCedar({
    action: 'campaign::update',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCampaignSchema)) body: Parameters<CampaignsService['update']>[1],
  ) {
    return this.campaigns.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'campaign::delete',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }

  // ─── Phase 1 F2 — lifecycle endpoints ──────────────────────────────────

  /**
   * Send a single test email. Service enforces a per-(campaign, user) Redis
   * counter of 5/h so a runaway FE can't burn the SMTP relay budget.
   */
  @Post(':id/send-test')
  @RequireCedar({
    action: 'campaign::update',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  sendTest(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendTestCampaignSchema)) body: Parameters<CampaignsService['sendTest']>[1],
  ) {
    return this.campaigns.sendTest(id, body);
  }

  /**
   * Move DRAFT/PAUSED → SCHEDULED. Materialises CampaignRecipient rows and
   * enqueues a delayed BullMQ job (deterministic jobId so re-schedule
   * replaces the old job rather than racing).
   */
  @Post(':id/schedule')
  @RequireCedar({
    action: 'campaign::update',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  schedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScheduleCampaignSchema)) body: Parameters<CampaignsService['schedule']>[1],
  ) {
    return this.campaigns.schedule(id, body);
  }

  @Post(':id/cancel')
  @RequireCedar({
    action: 'campaign::update',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  cancel(@Param('id') id: string) {
    return this.campaigns.cancel(id);
  }

  @Post(':id/pause')
  @RequireCedar({
    action: 'campaign::update',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  pause(@Param('id') id: string) {
    return this.campaigns.pause(id);
  }

  @Post(':id/resume')
  @RequireCedar({
    action: 'campaign::update',
    resource: (req) => `Campaign::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  resume(@Param('id') id: string) {
    return this.campaigns.resume(id);
  }

  // Phase 1 F1 / T-MAIL-I-03: campaign engagement aggregates can reveal who
  // a tenant is targeting + how many recipients hard-bounced (= competitive
  // intelligence about churn). Restricted to OWNER/ADMIN/MANAGER per threat
  // model. AGENT + VIEWER intentionally dropped.
  @Get(':id/stats')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  stats(@Param('id') id: string) {
    return this.campaigns.getStats(id);
  }

  @Get(':id/recipients')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listRecipients(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListCampaignRecipientsQuerySchema)) query: Parameters<CampaignRecipientsService['listByCampaign']>[1],
  ) {
    return this.recipients.listByCampaign(id, query);
  }
}
