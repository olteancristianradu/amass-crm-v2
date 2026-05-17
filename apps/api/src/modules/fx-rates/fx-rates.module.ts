import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_FX_RATES } from '../../infra/queue/queue.constants';
import { FxRatesController } from './fx-rates.controller';
import { FxRatesProcessor } from './fx-rates.processor';
import { FxRatesScheduler } from './fx-rates.scheduler';
import { FxRatesService } from './fx-rates.service';

/**
 * Phase 0 / Feature 2 — multi-currency stack.
 *
 *   FxRatesController     GET /api/v1/exchange-rates  (lookup, throttled)
 *   FxRatesService        convert() consumed by DealsService for amountBase
 *   FxRatesScheduler      @Cron 06:00 Europe/Bucharest → enqueue daily job
 *   FxRatesProcessor      BullMQ consumer → fetch ECB XML, upsert, metric
 *   ECB client            HTTPS-only, hostname-pinned, 10s AbortSignal
 *
 * @Global() so DealsModule (and any future BillingModule recompute path)
 * can inject FxRatesService without re-importing FxRatesModule everywhere.
 * The Prometheus metric providers used by the processor live in MetricsModule
 * (also @Global) so no extra imports needed.
 *
 * ExchangeRate is NOT in TENANT_SCOPED_MODELS — the table is global and
 * REVOKE-protected at the DB layer (migration 20260517082112). Writes
 * happen on the unscoped PrismaClient (the cron worker runs without ALS
 * tenant context); reads on the public endpoint go through the same
 * unscoped path because there's no tenant column to filter on.
 */
@Global()
@Module({
  imports: [
    AuthModule, // for JwtAuthGuard
    BullModule.registerQueue({ name: QUEUE_FX_RATES }),
  ],
  controllers: [FxRatesController],
  providers: [FxRatesService, FxRatesScheduler, FxRatesProcessor],
  exports: [FxRatesService],
})
export class FxRatesModule {}
