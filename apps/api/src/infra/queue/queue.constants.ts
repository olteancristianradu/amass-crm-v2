/**
 * Stable BullMQ queue names. Keep these as constants so producers (services)
 * and consumers (processors) can never disagree on the spelling.
 */
export const QUEUE_IMPORT = 'import';
export const QUEUE_REMINDERS = 'reminders';
export const QUEUE_EMAIL = 'email';
export const QUEUE_AI_CALLS = 'ai-calls';
export const QUEUE_WORKFLOWS = 'workflow-runs';
export const QUEUE_LEAD_SCORING = 'lead-scoring';
export const QUEUE_EXPORT = 'exports';
export const QUEUE_FX_RATES = 'fx-rates';

/**
 * Phase 1 F2 — campaign builder. Per-campaign dispatch orchestration. The
 * `email` queue stays unchanged for per-message SMTP sends; this queue
 * carries the higher-level "fan out N recipients respecting the per-tenant
 * 50/sec + burst 200 rate" job. Delayed jobs use a deterministic jobId
 * (`campaign-<id>`) so cancel/pause can locate them with `getJob`.
 */
export const QUEUE_CAMPAIGN_DISPATCH = 'campaign-dispatch';

/**
 * Phase 1 F3 — outbox pattern poller. A single repeat job ('drain') on this
 * queue ticks every 5s and dispatches PENDING OutboxEvent rows. Concurrency
 * is intentionally 1 so we never race two drainers fan-out the same row
 * twice (the row update from PENDING→PUBLISHED is the dedup boundary).
 */
export const QUEUE_OUTBOX_POLL = 'outbox-poll';

/**
 * Phase 1 F3 — per-(endpoint, event) webhook delivery worker. The outbox
 * poller enqueues one job per matching subscription so failed deliveries
 * to endpoint A don't block delivery to endpoint B. BullMQ attempts +
 * exponential backoff drive retries; on terminal failure the
 * WebhookDelivery row is marked deadLetter=true for admin replay.
 */
export const QUEUE_WEBHOOK_DELIVERY = 'webhook-delivery';

/**
 * Phase 1 F1 — daily GDPR PII anonymization for email_tracks rows.
 * Cron fans out one job at 03:00 Europe/Bucharest; the processor walks the
 * partial index `email_tracks_pii_pending_idx` in 1k-row batches,
 * nullifies ip_address + user_agent on rows older than 90 days, and stamps
 * pii_hashed_at. Mitigates T-MAIL-I-01 (long-term PII retention).
 */
export const QUEUE_EMAIL_TRACKS_PII = 'email-tracks-pii';

/**
 * Phase 2 F2 — multi-step approval SLA expiry sweep. A single repeat job
 * ('sla-sweep') ticks every 15min and walks PENDING/IN_PROGRESS requests
 * whose `expiresAt < now()`, flipping them to EXPIRED and notifying the
 * requester. Concurrency is 1 so two pods can never race the same request
 * (the UPDATE ... WHERE status IN ('PENDING','IN_PROGRESS') AND expiresAt
 * predicate is the dedup boundary). Idempotent: re-running on a row that
 * already EXPIRED is a no-op.
 */
export const QUEUE_APPROVAL_SLA = 'approval-sla';

/**
 * Phase 2 F1 — contract e-sign reminder cron. Daily at 09:00 Europe/Bucharest
 * a single 'reminder-sweep' job fans out per-signer reminder emails for any
 * ContractSignature still PENDING/SENT/VIEWED that crosses one of the
 * configured offsets (default 3/7/12 days). JobId is deterministic per day
 * (`contract-reminder-YYYYMMDD`) so two cron fires on the same day collapse.
 * Concurrency 1 — sweep iterates tenants serially under app_user.
 */
export const QUEUE_CONTRACT_REMINDER = 'contract-reminder';

/**
 * Phase 2 F1 — contract ceremony expiry. Hourly cron walks ContractSignature
 * rows whose `expires_at < NOW()` AND status IN ('PENDING','SENT','VIEWED'),
 * flips them to EXPIRED, and (if ALL signers EXPIRED) cascades the parent
 * Contract to status DECLINED. Idempotent: re-running on already-EXPIRED
 * rows is a no-op (the WHERE clause filters them out).
 */
export const QUEUE_CONTRACT_EXPIRE = 'contract-expire';
