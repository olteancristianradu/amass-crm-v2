import { Module } from '@nestjs/common';
import { ContactSegmentsModule } from '../contact-segments/contact-segments.module';
import { CampaignRecipientsService } from './campaign-recipients.service';

/**
 * Phase 1 F2 — campaign per-recipient module. Owns:
 *   - HMAC tracking token generation/verification.
 *   - Audience materialisation (filter → CampaignRecipient rows).
 *   - Per-recipient event ingestion (open/click) → counter bumps.
 *
 * No controller here in Phase 1. CampaignRecipientsService is exposed only
 * to:
 *   - CampaignsService (schedule()) — materialise audience
 *   - CampaignsController (list recipients endpoint) — paginated read
 *   - EmailTrackingService — recordEvent() on open/click
 *
 * AuditModule is @Global so AuditService is auto-available even though we
 * don't list it explicitly here.
 */
@Module({
  imports: [ContactSegmentsModule],
  providers: [CampaignRecipientsService],
  exports: [CampaignRecipientsService],
})
export class CampaignRecipientsModule {}
