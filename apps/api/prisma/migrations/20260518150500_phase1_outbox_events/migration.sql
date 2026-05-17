-- Phase 1 F3 — Outbox pattern for guaranteed webhook delivery.
--
-- Problem: WebhooksService.dispatch() currently calls Promise.allSettled in
-- the request thread → if the process restarts between business-row commit
-- and webhook POST, the event is LOST. CLAUDE.md rule #3 (defense in depth)
-- and threat model T-WH-T-05 mandate the outbox pattern.
--
-- Solution: app code calls OutboxService.publish() inside the same
-- transaction as the business write. INSERT into outbox_events is atomic
-- with the row that triggered it. A separate BullMQ poller (every 5s)
-- drains PENDING rows and enqueues a per-(endpoint, event) delivery job.
--
-- Crash safety: if the API dies mid-poll, the row stays PENDING (no
-- partial UPDATE because the poll uses SELECT...FOR UPDATE SKIP LOCKED on
-- a per-row basis and only flips to PUBLISHED after enqueue succeeds).

CREATE TYPE "OutboxEventStatus" AS ENUM (
  'PENDING',
  'PUBLISHED',
  'FAILED'
);

CREATE TABLE "outbox_events" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  -- VARCHAR(64) instead of an enum so adding a new WebhookEvent enum value
  -- (e.g. Phase 1 EMAIL_OPENED) does NOT require an outbox schema migration.
  -- The poller filters by `events.has(event)` on WebhookEndpoint, so any
  -- unknown string is simply skipped (no subscribers → mark PUBLISHED noop).
  "event_type"     VARCHAR(64) NOT NULL,
  "aggregate_type" VARCHAR(64),
  "aggregate_id"   VARCHAR(64),
  "payload"        JSONB NOT NULL,
  "status"         "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  -- Truncated, app layer strips PII. Diagnostic only — never the source of
  -- truth for "why did it fail" (use audit log + WebhookDelivery instead).
  "last_error"     VARCHAR(512),
  "published_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- Tenant-scoped general index for admin UI ("show me recent outbox events").
CREATE INDEX "outbox_events_tenant_created_idx"
  ON "outbox_events" ("tenant_id", "created_at" DESC);

-- HOT-PATH partial index: the poller runs every 5 seconds with:
--   SELECT id, tenant_id, event_type, payload, attempts
--   FROM outbox_events
--   WHERE status = 'PENDING'
--   ORDER BY created_at
--   LIMIT 100
--   FOR UPDATE SKIP LOCKED;
-- Without the partial WHERE, every PUBLISHED row also sits in the index
-- and the scan widens linearly with history. Partial keeps it O(backlog).
CREATE INDEX "outbox_events_pending_idx"
  ON "outbox_events" ("created_at")
  WHERE "status" = 'PENDING';

-- FK to tenants — CASCADE on tenant delete (outbox is tenant-owned).
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — canonical pattern (matches email_suppressions, webhook_endpoints,
-- audit_log etc.). Fails closed when ALS missing.
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_outbox_events ON "outbox_events"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_events" TO app_user;
