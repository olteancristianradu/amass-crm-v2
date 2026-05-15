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
import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';

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
  ) {}

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
}
