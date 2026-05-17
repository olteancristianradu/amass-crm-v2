/**
 * BusinessMetricsService — custom Prometheus business metrics.
 *
 * The default Node.js metrics (heap, event-loop lag, CPU) come from
 * @willsoto/nestjs-prometheus + prom-client's `collectDefaultMetrics`.
 * This service adds five domain-shaped counters/histograms that the
 * /metrics endpoint exposes alongside them.
 *
 *   http_request_duration_seconds — global request latency by route+status
 *   deal_status_changed_total     — pipeline movement (won / lost / open)
 *   invoice_status_total          — billing state transitions
 *   call_completed_total          — call lifecycle (Twilio terminal events)
 *   auth_login_total              — login success/failure for abuse detection
 *
 * Every label set is **bounded** — never put unbounded values (user id,
 * tenant slug, email) into a label or Prometheus cardinality explodes
 * and the time-series DB OOMs. `tenant` is intentionally a tenant UUID
 * because we expect at most ~thousands of tenants, not millions.
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class BusinessMetricsService {
  constructor(
    @InjectMetric('http_request_duration_seconds')
    private readonly httpDuration: Histogram<string>,
    @InjectMetric('deal_status_changed_total')
    private readonly dealStatusChanged: Counter<string>,
    @InjectMetric('invoice_status_total')
    private readonly invoiceStatus: Counter<string>,
    @InjectMetric('call_completed_total')
    private readonly callCompleted: Counter<string>,
    @InjectMetric('auth_login_total')
    private readonly authLogin: Counter<string>,
    @Optional()
    @InjectMetric('totp_backup_code_consumed_total')
    private readonly backupCodeConsumed?: Counter<string>,
    // Phase 0 / Feature 2 — multi-currency. @Optional() so legacy specs
    // that hand-build BusinessMetricsService without these providers (a lot
    // of existing fixtures) keep working.
    @Optional()
    @InjectMetric('fx_rates_fetched_total')
    private readonly fxRatesFetched?: Counter<string>,
    @Optional()
    @InjectMetric('fx_rates_sanity_bound_violation_total')
    private readonly fxRatesSanityViolation?: Counter<string>,
    @Optional()
    @InjectMetric('i18n_locale_switched_total')
    private readonly i18nLocaleSwitched?: Counter<string>,
    // Phase 1 F3 — outbox + webhook delivery counters. @Optional() so the
    // existing hand-built fixtures keep instantiating without these providers.
    @Optional()
    @InjectMetric('outbox_events_published_total')
    private readonly outboxPublished?: Counter<string>,
    @Optional()
    @InjectMetric('webhook_delivery_total')
    private readonly webhookDelivery?: Counter<string>,
    @Optional()
    @InjectMetric('outbox_oldest_pending_age_seconds')
    private readonly outboxLag?: Gauge<string>,
  ) {}

  /**
   * Record a user-initiated locale switch. `from`/`to` are short locale
   * codes (`ro`,`en`) — both already validated against LocaleSchema so the
   * label cardinality is bounded by the whitelist (2 today).
   */
  recordLocaleSwitch(tenantId: string, from: string, to: string): void {
    this.i18nLocaleSwitched?.labels(tenantId, from, to).inc();
  }

  /**
   * Observe a finished HTTP request. Called by HttpMetricsInterceptor on
   * both success and error paths so 4xx/5xx show up too.
   *
   * `route` must be the **template** (`/api/v1/deals/:id`), never the
   * concrete URL — otherwise every unique id becomes its own label value.
   */
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.httpDuration
      .labels(method, route, String(statusCode))
      .observe(durationSeconds);
  }

  recordDealStatusChange(
    tenantId: string,
    fromStatus: string,
    toStatus: string,
  ): void {
    this.dealStatusChanged.labels(tenantId, fromStatus, toStatus).inc();
  }

  recordInvoiceStatus(tenantId: string, status: string): void {
    this.invoiceStatus.labels(tenantId, status).inc();
  }

  recordCallCompleted(
    tenantId: string,
    direction: string,
    outcome: string,
  ): void {
    this.callCompleted.labels(tenantId, direction, outcome).inc();
  }

  recordAuthLogin(tenantId: string, success: boolean): void {
    this.authLogin.labels(tenantId, success ? 'success' : 'failure').inc();
  }

  /**
   * TOTP backup code consumed during login — operator-visible signal
   * that a user lost their authenticator and is burning through their
   * one-time fallback codes. Used by dashboards to alert when a tenant
   * sees a surge of backup-code logins (could be legitimate phone-lost
   * incident OR an attacker who got past TOTP).
   *
   * @Optional() on the inject because the metric was added in B2-PR5's
   * polish wave — existing test fixtures that construct BusinessMetrics-
   * Service without the new provider keep working.
   */
  recordBackupCodeConsumed(tenantId: string): void {
    this.backupCodeConsumed?.labels(tenantId).inc();
  }

  /**
   * Phase 0 / Feature 2 — record outcome of an ECB fetch + upsert run.
   * `delta` lets the caller increment by the number of rows touched in one
   * shot (a successful run typically posts +N pairs at once). Sentry +
   * alert wiring keys off the `status=error` rate, not the success count.
   */
  recordFxRatesFetched(source: string, status: 'success' | 'error', delta = 1): void {
    this.fxRatesFetched?.labels(source, status).inc(delta);
  }

  /**
   * T-FX-S-01 — increment when a day-over-day rate move exceeds ±15% for a
   * given pair. We still insert the row (silently substituting yesterday's
   * rate would mask a real currency event), but operators must be alerted
   * so they can sanity-check against a second source.
   */
  recordFxRatesSanityViolation(fromCurrency: string, toCurrency: string): void {
    this.fxRatesSanityViolation?.labels(fromCurrency, toCurrency).inc();
  }

  /**
   * Phase 1 F3 (T-WH-T-05) — record one outbox poller drain outcome.
   * `status` is "published" (enqueued to webhook-delivery), "skipped" (no
   * matching subscription so the event is marked PUBLISHED with no fan-out),
   * or "failed" (enqueue threw, row stays PENDING for retry).
   */
  recordOutboxProcessed(status: 'published' | 'skipped' | 'failed', delta = 1): void {
    this.outboxPublished?.labels(status).inc(delta);
  }

  /**
   * Phase 1 F3 — outcome of a single webhook delivery attempt.
   *   "success"     — endpoint returned 2xx.
   *   "retry"       — non-2xx OR network failure, BullMQ will retry.
   *   "dead_letter" — attempts exhausted OR endpoint returned 410 Gone.
   */
  recordWebhookDelivery(event: string, status: 'success' | 'retry' | 'dead_letter'): void {
    this.webhookDelivery?.labels(event, status).inc();
  }

  /**
   * Phase 1 F3 — outbox queue lag. Caller passes the age in seconds of the
   * oldest PENDING row (the poller computes this each cycle). NaN means no
   * pending rows — Prometheus reads NaN as "no data" which is correct.
   */
  setOutboxLagSeconds(seconds: number): void {
    this.outboxLag?.set(Number.isFinite(seconds) ? seconds : 0);
  }
}
