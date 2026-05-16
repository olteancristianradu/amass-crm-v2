/**
 * OpenTelemetry instrumentation bootstrap.
 *
 * This file initialises tracing BEFORE any other application code so the
 * auto-instrumentations can patch `http`, `express`, `@nestjs/*`,
 * `@prisma/client`, `socket.io`, `ioredis`, etc. at require-time. Must
 * be imported as the FIRST line of main.ts (after `reflect-metadata`).
 *
 * Design intent (per CLAUDE.md "OTel: not wired — deferred until
 * multi-service tracing is justified"):
 *   - Single binary OTel scaffold so adding a collector later is one env
 *     var, not a refactor.
 *   - OFF by default: if OTEL_EXPORTER_OTLP_ENDPOINT is unset, the SDK
 *     never starts — zero perf cost. No console exporter spam.
 *   - Honors the standard OTel env vars (OTEL_SERVICE_NAME,
 *     OTEL_RESOURCE_ATTRIBUTES, OTEL_EXPORTER_OTLP_HEADERS, etc.) so the
 *     operator can wire Tempo, Jaeger, Honeycomb, Grafana Cloud, Datadog
 *     without code changes.
 *   - Pino logger is left untouched — span/trace correlation comes from
 *     the standard `traceId`/`spanId` fields injected by the auto-instr
 *     into Express's req. Add `pino-opentelemetry-transport` later if
 *     we need W3C trace context in logs.
 *
 * Operator wire-up (one-time, when ready to enable tracing):
 *   1. Run an OTel collector (Tempo, Jaeger, Grafana Agent, etc.).
 *   2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318` (HTTP)
 *      or `:4317` (gRPC).
 *   3. Set `OTEL_SERVICE_NAME=amass-api`.
 *   4. Restart the API. No code change.
 *
 * Why not enable by default: with no collector wired, an OTLP exporter
 * either drops silently (acceptable) or retries forever (bad). The
 * SDK-not-started default is the cleanest production posture until
 * the operator has somewhere to ship spans to.
 */

const OTEL_ENABLED = !!process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

/**
 * Idempotently start the OTel SDK. Returns void; the SDK runs in the
 * background. Safe to call multiple times — guarded by a module flag.
 */
let started = false;
export function startOtel(): void {
  if (started) return;
  started = true;

  if (!OTEL_ENABLED) {
    // No collector configured — keep silent. The `!started` guard above
    // means subsequent calls become no-ops; flipping the env var requires
    // a process restart anyway.
    return;
  }

  // Lazy-load so the SDK isn't dragged into the bundle when tracing is
  // off (it's ~7MB of deps).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'amass-api',
      [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '1.0.0-rc.1',
    }),
    traceExporter: new OTLPTraceExporter({
      // OTel's own env-var precedence: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      // beats OTEL_EXPORTER_OTLP_ENDPOINT. The SDK handles that for us.
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Pino is noisy enough on its own; the default instrumentation
        // turns every log line into a span, which is rarely what you want.
        '@opentelemetry/instrumentation-pino': { enabled: false },
        // fs spans are useless 99% of the time and add a lot of noise.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  // Graceful shutdown — flush in-flight spans on SIGTERM / SIGINT.
  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch {
      // Never let shutdown errors mask the real reason the process is exiting.
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  sdk.start();
}
