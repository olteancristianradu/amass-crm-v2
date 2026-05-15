/**
 * MetricsModule — Prometheus metrics via prom-client.
 *
 * Exposes GET /metrics (plain text, Prometheus scrape format).
 * Collects default Node.js metrics (heap, CPU, event loop lag) PLUS the
 * five custom business metrics registered below (see BusinessMetricsService).
 *
 * In production, the /metrics endpoint should be firewalled to only
 * allow Prometheus scraper access (not public-facing).
 */
import { Global, Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { BusinessMetricsService } from './business-metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    // ─── Custom business metrics ───────────────────────────────────────
    // Label cardinality is bounded by design: tenant (UUID, capped per
    // deployment), from_status/to_status (enum), direction (enum), result
    // (success|failure). HTTP route is a template — never a concrete URL.
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds, by method/route/status.',
      labelNames: ['method', 'route', 'status_code'],
      // p50/p95/p99 buckets sized for a CRM (most requests <500ms, long
      // tail at PDF render / Excel export ~2-5s, hard cap watch at 10s).
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    }),
    makeCounterProvider({
      name: 'deal_status_changed_total',
      help: 'Count of deal status transitions, by tenant and from/to status.',
      labelNames: ['tenant', 'from_status', 'to_status'],
    }),
    makeCounterProvider({
      name: 'invoice_status_total',
      help: 'Count of invoice status transitions, by tenant and target status.',
      labelNames: ['tenant', 'status'],
    }),
    makeCounterProvider({
      name: 'call_completed_total',
      help: 'Count of completed calls, by tenant, direction and outcome.',
      labelNames: ['tenant', 'direction', 'outcome'],
    }),
    makeCounterProvider({
      name: 'auth_login_total',
      help: 'Count of login attempts, by tenant and result (success/failure).',
      labelNames: ['tenant', 'result'],
    }),
    BusinessMetricsService,
    HttpMetricsInterceptor,
  ],
  exports: [PrometheusModule, BusinessMetricsService, HttpMetricsInterceptor],
})
export class MetricsModule {}
