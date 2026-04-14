/**
 * MetricsModule — Prometheus metrics via prom-client.
 *
 * Exposes GET /metrics (plain text, Prometheus scrape format).
 * Collects default Node.js metrics (heap, CPU, event loop lag).
 *
 * In production, the /metrics endpoint should be firewalled to only
 * allow Prometheus scraper access (not public-facing).
 */
import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  exports: [PrometheusModule],
})
export class MetricsModule {}
