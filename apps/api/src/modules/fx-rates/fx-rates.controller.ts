import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ExchangeRateQueryDto,
  ExchangeRateQuerySchema,
  ExchangeRateResponseDto,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { FxRatesService } from './fx-rates.service';

/**
 * `GET /api/v1/exchange-rates?from=EUR&to=RON[&date=YYYY-MM-DD]`
 *
 * Returns the most recent exchange rate ≤ `date` (defaults to today)
 * for the requested pair. Rates are GLOBAL — every tenant sees the same
 * value — but the endpoint still requires a valid JWT so we can
 * rate-limit per tenant via the existing TenantThrottlerGuard
 * (T-FX-D-02 mitigation).
 *
 * Per-route Throttle override caps the abuse window tighter than the
 * default 60/min: 100/min is generous for FE-driven dashboards that may
 * fetch the rate per visible currency on a kanban filter change.
 */
@Controller('exchange-rates')
@UseGuards(JwtAuthGuard)
export class FxRatesController {
  constructor(private readonly svc: FxRatesService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  async getRate(
    @Query(new ZodValidationPipe(ExchangeRateQuerySchema)) q: ExchangeRateQueryDto,
  ): Promise<ExchangeRateResponseDto> {
    const date = q.date ? new Date(`${q.date}T00:00:00.000Z`) : undefined;
    return this.svc.lookup(q.from, q.to, date);
  }
}
