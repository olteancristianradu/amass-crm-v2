import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  GetForecastQuerySchema,
  GetTeamForecastQuerySchema,
  SetQuotaSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ForecastingService } from './forecasting.service';

@Controller('forecasting')
@UseGuards(JwtAuthGuard)
export class ForecastingController {
  constructor(private readonly forecasting: ForecastingService) {}

  @Get()
  getForecast(@Query(new ZodValidationPipe(GetForecastQuerySchema)) query: Parameters<ForecastingService['getForecast']>[0]) {
    return this.forecasting.getForecast(query);
  }

  @Get('team')
  getTeamForecast(@Query(new ZodValidationPipe(GetTeamForecastQuerySchema)) query: Parameters<ForecastingService['getTeamForecast']>[0]) {
    return this.forecasting.getTeamForecast(query);
  }

  @Post('quota')
  setQuota(@Body(new ZodValidationPipe(SetQuotaSchema)) body: Parameters<ForecastingService['setQuota']>[0]) {
    return this.forecasting.setQuota(body);
  }
}
