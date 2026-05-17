import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { CampaignRecipientsModule } from '../campaign-recipients/campaign-recipients.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

/**
 * CampaignsModule — marketing outreach (S58 scaffold + Phase 1 F2 builder).
 *
 * Routes (all behind JwtAuthGuard + RolesGuard + CedarGuard):
 *   POST   /campaigns                       create (DRAFT)
 *   GET    /campaigns                       list (filter by status, channel)
 *   GET    /campaigns/:id                   get single
 *   PATCH  /campaigns/:id                   update envelope/template/filter
 *   DELETE /campaigns/:id                   soft delete
 *   POST   /campaigns/:id/send-test         test send (rate-limit 5/h/user)
 *   POST   /campaigns/:id/schedule          schedule + materialise recipients
 *   POST   /campaigns/:id/cancel            cancel + remove delayed job
 *   POST   /campaigns/:id/pause             pause + remove delayed job
 *   POST   /campaigns/:id/resume            resume + re-enqueue
 *   GET    /campaigns/:id/recipients        paginated recipients
 *   GET    /campaigns/:id/stats             denormalised counters
 *
 * Deps:
 *   - AuthModule              — JwtAuthGuard
 *   - EmailModule             — EmailService.sendTransactional (test send)
 *   - CampaignRecipientsModule (forwardRef) — audience materialisation +
 *                               token + per-recipient list
 *   - AuditModule (global)    — campaign.* audit events
 *   - RedisModule (global)    — send-test rate-limit counter
 *   - QueueModule (global)    — QUEUE_CAMPAIGN_DISPATCH BullMQ queue
 */
@Module({
  imports: [
    AuthModule,
    EmailModule,
    forwardRef(() => CampaignRecipientsModule),
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
