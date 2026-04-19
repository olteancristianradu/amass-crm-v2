import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ForecastingController } from './forecasting.controller';
import { ForecastingService } from './forecasting.service';

/**
 * ForecastingModule — pipeline-vs-quota reporting.
 *
 * Routes (all behind JwtAuthGuard):
 *   GET  /forecasting        personal forecast for current user
 *   GET  /forecasting/team   aggregate for all users in the tenant
 *   POST /forecasting/quota  set / update quota for a user × period
 */
@Module({
  imports: [AuthModule],
  controllers: [ForecastingController],
  providers: [ForecastingService],
  exports: [ForecastingService],
})
export class ForecastingModule {}
