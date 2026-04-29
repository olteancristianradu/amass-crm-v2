# Service Level Objectives (SLO)

Production targets for AMASS-CRM. These are commitments to customers
on what "working" means, measured continuously.

Last updated: 2026-04-29 · v1.0

## Why SLOs

Without explicit SLOs, "is the service OK?" is opinion. With them,
it's data: either we hit the target or we don't, and we know what to fix.

## Tier-based SLOs

| Tier | Uptime | API p95 latency | Error rate | Voice transcript ready time | Email delivery |
|---|---|---|---|---|---|
| Starter (€19) | 99.5% | <800ms | <0.5% | <90s post-call | best-effort |
| Growth (€39) | 99.5% | <500ms | <0.5% | <60s post-call | <2 min |
| Pro (€69) | 99.9% | <500ms | <0.1% | <60s post-call | <1 min |
| Enterprise | 99.95% custom | <300ms | <0.05% | custom | <30s |

## How they're measured

### Uptime
- Source: external uptime monitor (UptimeRobot — checks /health endpoint every 5 min)
- Period: rolling 30 days
- Excluded: scheduled maintenance windows announced ≥7 days in advance
- Excluded: total platform outages caused by upstream provider (Railway, Cloudflare, ANAF SPV) — these are credited as separate "supply incident"

### API p95 latency
- Source: Prometheus histogram on every authenticated API request
- Excluded endpoints: file upload (S3 presign), AI processing (60-90s expected), batch operations
- Granularity: per endpoint, then aggregated p95

### Error rate
- Source: Sentry error count + Pino structured logs with level=error
- Numerator: 5xx responses + uncaught exceptions
- Denominator: total authenticated requests
- Period: rolling 24h

### Voice transcript ready time
- Source: gap between Twilio recording.completed webhook and EmailTrack/AI summary persistence
- Measured at p95 over rolling 7 days

## Error budgets

For Growth tier (99.5% uptime):
- 30-day budget: ~3.6 hours of downtime
- 7-day budget: ~50 minutes of downtime
- 24-hour budget: ~7 minutes of downtime

If we burn through 50% of the monthly budget in the first 10 days, all
non-critical engineering work pauses to address reliability.

## Customer-facing commitments (in DPA + SaaS Agreement)

- 99.5% monthly uptime measured by `/health` endpoint
- Service credit: 5% of monthly fee per 0.1% under SLA, capped at 20%
- Notification: status page + email within 30 min of incident detection
- Postmortem: published within 7 days for any P0/P1

## Internal alerting thresholds

- API p95 > 800ms for 5 min → page on-call (P1)
- Error rate > 1% for 5 min → page on-call (P1)
- Disk > 80% → email warning (P2)
- Memory > 90% sustained 5 min → page (P2)
- DB connections > 80% pool → page (P2)

## Where we are today (2026-04-29 baseline)

- Uptime: not yet measured externally (UptimeRobot setup pending — needs domain)
- p95 latency: locally <100ms for most endpoints (production unmeasured)
- Error rate: 0 unhandled exceptions in 30-day audit log (zero traffic baseline — meaningless)
- Sentry: SDK installed, DSN not configured (no production tenant yet)

We will measure these from launch onwards. Pre-launch, SLOs are aspirational.
