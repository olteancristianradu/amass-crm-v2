import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BusinessMetricsService } from '../../infra/metrics/business-metrics.service';
import { QUEUE_FX_RATES } from '../../infra/queue/queue.constants';
import { fetchEcbDailyRates } from './ecb.client';
import { FxRatesService } from './fx-rates.service';

interface FxDailyPayload {
  /** YYYY-MM-DD in Europe/Bucharest — logged for traceability, not used to drive logic. */
  localDate: string;
}

/**
 * BullMQ consumer for `fx-rates-daily` jobs.
 *
 * Flow:
 *   1. Fetch ECB XML (10s timeout, native fetch + AbortController).
 *   2. Parse via `parseEcbDailyXml` — strict regex, throws on malformed.
 *   3. Hand parsed (asOf, rates) to FxRatesService.upsertEcbPayload which
 *      computes cross-rates, runs sanity bounds, and upserts.
 *   4. Increment `fx_rates_fetched_total{status="success"} +N`.
 *
 * On any throw, BullMQ honours `attempts: 3 + backoff: exponential` from
 * the scheduler — we just rethrow. The `@OnWorkerEvent('failed')` hook
 * increments the error counter so dashboards have the absolute count
 * without re-reading the failed set.
 *
 * Concurrency: 1. ECB publishes one file per day; running multiple workers
 * against the same jobId would just upsert the same rows. BullMQ jobId
 * dedup + Postgres UNIQUE makes that safe, but we keep the worker single
 * so the timing logs are easy to read.
 */
@Processor(QUEUE_FX_RATES, {
  concurrency: 1,
  // ECB request bounded at 10s; upsert loop runs ~30 rows = a few hundred
  // ms locally. 30s lock duration leaves plenty of headroom for slow DB
  // tail latency without leaving a stuck job locked.
  lockDuration: 30_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class FxRatesProcessor extends WorkerHost {
  private readonly logger = new Logger(FxRatesProcessor.name);

  constructor(
    private readonly svc: FxRatesService,
    private readonly metrics: BusinessMetricsService,
  ) {
    super();
  }

  async process(job: Job<FxDailyPayload>): Promise<void> {
    if (job.name !== 'fx-rates-daily') {
      this.logger.warn(`Unknown job name on ${QUEUE_FX_RATES}: ${job.name}`);
      return;
    }
    const { localDate } = job.data;
    this.logger.log(`fx-rates-daily start localDate=${localDate} jobId=${job.id}`);

    const payload = await fetchEcbDailyRates();
    // ECB asOf is a YYYY-MM-DD in CET — we store it as a Date at UTC
    // midnight so the unique (from, to, asOf) tuple is deterministic
    // regardless of the server's TZ.
    const asOf = new Date(`${payload.asOf}T00:00:00.000Z`);
    const { written, sanityViolations } = await this.svc.upsertEcbPayload(
      asOf,
      payload.rates,
    );

    if (sanityViolations.length > 0) {
      for (const v of sanityViolations) {
        this.metrics.recordFxRatesSanityViolation(v.from, v.to);
      }
    }
    this.metrics.recordFxRatesFetched('ECB', 'success', written);
    this.logger.log(
      `fx-rates-daily done asOf=${payload.asOf} written=${written} sanityViolations=${sanityViolations.length}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `fx-rates job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`,
    );
    // Increment by 1 — one fail = one outcome row, regardless of which
    // pair was being upserted when the throw happened.
    this.metrics.recordFxRatesFetched('ECB', 'error', 1);
  }
}
