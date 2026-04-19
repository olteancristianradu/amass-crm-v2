import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

/**
 * CampaignsModule — marketing outreach tracking with ROI metrics.
 *
 * Routes (all behind JwtAuthGuard):
 *   POST   /campaigns          create
 *   GET    /campaigns          list (filter by status, channel)
 *   GET    /campaigns/:id      get single
 *   PATCH  /campaigns/:id      update (incl. sentCount/conversions/revenue)
 *   DELETE /campaigns/:id      soft delete
 */
@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
