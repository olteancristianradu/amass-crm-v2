import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  GetForecastQuerySchema,
  GetTeamForecastQuerySchema,
  SetQuotaSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ForecastingService } from './forecasting.service';

@Controller('forecasting')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ForecastingController {
  constructor(private readonly forecasting: ForecastingService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  getForecast(@Query(new ZodValidationPipe(GetForecastQuerySchema)) query: Parameters<ForecastingService['getForecast']>[0]) {
    return this.forecasting.getForecast(query);
  }

  @Get('team')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  getTeamForecast(@Query(new ZodValidationPipe(GetTeamForecastQuerySchema)) query: Parameters<ForecastingService['getTeamForecast']>[0]) {
    return this.forecasting.getTeamForecast(query);
  }

  @Post('quota')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'forecast-quota::set', resource: 'ForecastQuota::*' })
  setQuota(@Body(new ZodValidationPipe(SetQuotaSchema)) body: Parameters<ForecastingService['setQuota']>[0]) {
    return this.forecasting.setQuota(body);
  }
}
