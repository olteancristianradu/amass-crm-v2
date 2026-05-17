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
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { BusinessMetricsService } from './business-metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

// ─── Custom business metrics ─────────────────────────────────────────
// Label cardinality is bounded by design: tenant (UUID, capped per
// deployment), from_status/to_status (enum), direction (enum), result
// (success|failure). HTTP route is a template — never a concrete URL.
//
// Each Provider object is referenced from BOTH `providers` (so Nest
// instantiates it) AND `exports` (so cross-module @InjectMetric works
// — see HealthModule's BackupHealthService).
const metricProviders = [
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
  // D3-VPS-PR1: unix timestamp of the most recent successful pg_dump+upload.
  // Written by scripts/backup-db.sh → _heartbeat.json in the backup bucket,
  // polled by BackupHealthService every 5 min, alerted on by
  // infra/observability/alerts/backup.yml (BackupStale fires if >25h old).
  // Single-instance — no labels, single backup target per deployment.
  makeGaugeProvider({
    name: 'backup_last_success_timestamp_seconds',
    help: 'Unix timestamp of the last successful database backup (heartbeat from backup-db.sh).',
  }),
  // B2-PR5 polish: count of TOTP backup-code consumptions (a.k.a. recovery
  // codes). Lets dashboards surge-alert on attackers brute-forcing TOTP
  // fallback OR legitimate user-lost-phone incidents.
  makeCounterProvider({
    name: 'totp_backup_code_consumed_total',
    help: 'Count of TOTP backup codes consumed at login, by tenant.',
    labelNames: ['tenant'],
  }),
  // Phase 0 / Feature 2 — multi-currency. ECB fetch outcomes; alerts wire on
  // `status="error"` rate > 1/h to catch ECB outages early (spec 2.1).
  // `source` is fixed at "ECB" for now; FIXER fallback (Phase 1) will add a
  // second label value.
  makeCounterProvider({
    name: 'fx_rates_fetched_total',
    help: 'Count of FX rate rows upserted by the daily ECB cron, by source and status.',
    labelNames: ['source', 'status'],
  }),
  // T-FX-S-01 — fired when a daily rate moves >15% vs the previous day's
  // rate for the same (from, to). We DO insert the row (the alternative —
  // silently using yesterday's rate — would mask a real currency event), but
  // we want a metric so operators can investigate manually.
  makeCounterProvider({
    name: 'fx_rates_sanity_bound_violation_total',
    help: 'Count of FX rate sanity-bound (>15% day-over-day) violations, by pair.',
    labelNames: ['from_currency', 'to_currency'],
  }),
  // Phase 0 / Feature 1 — i18n locale switch. Labels intentionally bounded
  // by the LocaleSchema whitelist (`ro`, `en` today). Dashboards alert on
  // a surge of failed validations from a single tenant — typically an IdP
  // misconfiguration writing a non-standard locale onto the user record.
  makeCounterProvider({
    name: 'i18n_locale_switched_total',
    help: 'Count of user-locale changes via PATCH /users/me/locale, by tenant and from/to.',
    labelNames: ['tenant', 'from', 'to'],
  }),
];

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    ...metricProviders,
    BusinessMetricsService,
    HttpMetricsInterceptor,
  ],
  exports: [
    PrometheusModule,
    BusinessMetricsService,
    HttpMetricsInterceptor,
    // Re-export the metric providers so @InjectMetric works across modules
    // (BackupHealthService in HealthModule needs the gauge token).
    ...metricProviders,
  ],
})
export class MetricsModule {}
