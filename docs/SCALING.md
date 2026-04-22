# Scaling primitives

Operational primitives wired into the monolith so we can scale without a
rewrite. Everything here is **opt-in via env vars** — unset = dev behaviour.

Thresholds for when to unblock deferred tech (K8s, Kafka, Citus, microservices,
Meilisearch) live in [`CLAUDE.md`](../CLAUDE.md#deferred-tech-not-never--not-until-metrics-justify-it).
This doc covers what's already wired and how to flip it on.

---

## Multi-tenancy defense-in-depth

Three layers, in order of the request lifecycle:

1. **Auth + ALS context** — `JwtAuthGuard` + `RolesGuard` + `TenantContextMiddleware` populate `tenantStorage` (AsyncLocalStorage) with `{ tenantId, userId, role }`. No `TenantGuard` class exists; the three collaborators above do the job together.
2. **`tenantExtension` Prisma extension** — wired globally in `PrismaService.onModuleInit` via `$extends`. Every tx opened through `runWithTenant(tenantId, mode, fn)` inherits the extension, which auto-injects `tenantId` into `where`/`data` for tenant-scoped models. The mutation rule is factored into pure `applyTenantScope()` and unit-tested in `prisma.service.spec.ts`.
3. **Postgres RLS** — `runWithTenant` issues `SET LOCAL app.tenant_id = '<id>'` + `SET LOCAL ROLE app_user` (NOSUPERUSER, NOBYPASSRLS). Policies are defined per-table in migrations.

**Services that bypass `runWithTenant`** (direct `this.prisma.xxx` calls): `ai/deal-ai`, `ai/embedding`, `ai/search`, `auth/auth`, `auth/totp`, `sso/sso`, `reports/reports`. Each filters by `tenantId` manually in `WHERE`. They get **Layer 1 + Layer 3 only, not Layer 2** — a bug in one of their queries skips the auto-inject safety net. Converting them is a tracked follow-up.

---

## Read-replica routing

`PrismaService.runWithTenant` takes an optional `'ro' | 'rw'` mode. Reads
routed with `'ro'` go to a separate `PrismaClient` built from
`DATABASE_REPLICA_URL` when set; writes always hit the primary.

```ts
// read — routed to replica when DATABASE_REPLICA_URL is set
await this.prisma.runWithTenant(tenantId, 'ro', (tx) =>
  tx.deal.findMany({ where: { stageId } }),
);

// write — always primary (default mode = 'rw')
await this.prisma.runWithTenant(tenantId, (tx) =>
  tx.deal.update({ where: { id }, data: { value } }),
);
```

Enable:
```
DATABASE_REPLICA_URL=postgresql://readonly:<pw>@replica.host:5432/amass_crm?schema=public
```

The transaction enables `SET LOCAL transaction_read_only = on` when mode is
`ro` — accidental writes throw immediately instead of silently fan-out.

---

## PgBouncer (transaction pooling)

The `pgbouncer` service lives in `infra/docker-compose.yml` under the `prod`
profile. Start it with:

```
docker compose --profile prod up -d pgbouncer
```

Point the app at it by setting `DATABASE_URL` to the PgBouncer DSN (port 6432
by default) and appending the Prisma-specific flags:

```
DATABASE_URL=postgresql://postgres:<pw>@pgbouncer:5432/amass_crm?pgbouncer=true&statement_cache_size=0
```

Prisma migrations still need a direct connection — point `DATABASE_DIRECT_URL`
at the primary Postgres host for `prisma migrate`.

---

## Redis Sentinel

`buildRedisConnection()` (in `src/infra/redis/redis-connection.ts`) upgrades
the BullMQ + `RedisService` connections to a Sentinel pool when both of these
are set:

```
REDIS_SENTINEL_HOSTS=sentinel-a:26379,sentinel-b:26379,sentinel-c:26379
REDIS_SENTINEL_MASTER=mymaster
REDIS_SENTINEL_PASSWORD=<optional>
```

Unset = single-node `REDIS_URL` (dev behaviour). No code changes in call
sites.

---

## Per-tenant rate limiting

`TenantThrottlerGuard` (registered globally in `app.module.ts`) keys
throttler counters by `t:<tenantId>:u:<userId>` for authed requests, by
`t:<tenantId>` for pre-auth tenant-scoped routes (slug lookups), and falls
back to IP for unauthenticated paths.

Consequence: one noisy tenant can't starve others, but co-located employees
behind a single NAT don't share a counter.

Verified by `src/common/guards/tenant-throttler.guard.spec.ts`.

---

## Circuit breakers

`src/common/resilience/circuit-breaker.ts` — tiny dep-free breaker,
`getBreaker(name, opts?)` returns a singleton per name.

Currently wrapped:

| Name | Wraps | Where |
|---|---|---|
| `twilio` | `client.calls.create` | `modules/calls/twilio.client.ts` |
| `anthropic` | `messages.create` | `modules/ai/deal-ai.service.ts`, `modules/ai/enrichment.service.ts` |
| `gemini` | `generateContent`, `embedContent` | `modules/ai/enrichment.service.ts`, `modules/ai/embedding.service.ts` |
| `openai` | `embeddings.create` | `modules/ai/embedding.service.ts` |
| `stripe` | `customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create` | `modules/billing/billing.service.ts` |
| `anaf` | `fetch(...)` on token/upload/status | `modules/anaf/anaf.service.ts` |
| `siem` | fire-and-forget webhook | `modules/audit/audit.service.ts` |

Defaults: `failureThreshold: 5`, `resetAfterMs: 30_000`. Override per-call
at first `getBreaker('name', { ... })`. State surfaced in
`GET /api/v1/health/detailed`.

---

## Detailed health endpoint

`GET /api/v1/health/detailed`:

- `checks.db` — `SELECT 1` round-trip
- `checks.redis` — `PING` round-trip
- `checks.breakers` — current state of each registered breaker
- `status` — `up` | `degraded` (any breaker open) | `down` (DB or Redis down → HTTP 503)

Liveness (`/health`) and readiness (`/health/ready`) unchanged.

---

## Audit → SIEM forwarding + retention

`AuditService.log()` writes the row, then fires a non-blocking webhook to:

1. `tenants.siemWebhookUrl` (per-tenant override), else
2. `SIEM_WEBHOOK_URL` (env fallback), else
3. nothing.

Breaker: `siem` with 10 failures / 60s cooldown. Failures are swallowed
(logged + counted in breaker state) so the audit write always commits.

Retention: `MaintenanceScheduler.handleAuditRetentionSweep` runs daily at
03:30 UTC and deletes entries older than `tenants.auditRetentionDays` (per
tenant), falling back to `AUDIT_RETENTION_DAYS_DEFAULT` (env, default 2555 ≈
7 years).

---

## Shard key (prep, not active)

`tenants.shardId` (0..1023) is backfilled via
`substr(md5(id), 1, 8)::bit(32)::int & 1023`. New tenants get a value
immediately. Not read by anything today — it's present so a future Citus /
Vitess migration doesn't need to rewrite every query with a shard-routing
WHERE clause. Hooking it up is gated on the sharding threshold in
`CLAUDE.md`.
